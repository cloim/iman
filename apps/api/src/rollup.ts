import {
  bucketize,
  dayRange,
  evaluateGoal,
  hourBoundaries,
  isGoalActiveOn,
  isGoalType,
  summarize,
  type Goal,
  type LocalDate,
  type UsageSession,
} from '@iman/core'
import type { Tx } from './db'

interface GoalRow {
  id: string
  type: Goal['type']
  target: number
  scope_ref: string | null
  days_of_week: number
  quiet_from: string | null
  quiet_to: string | null
}

export const toGoal = (g: GoalRow): Goal => ({
  id: g.id,
  type: g.type,
  target: g.target,
  scopeRef: g.scope_ref,
  daysOfWeek: g.days_of_week,
})

/** 집계용 세션. 관리자가 정한 예외 앱은 원본에 남기고 여기서 뺀다 */
export async function loadSessions(c: Tx, userId: string, from: number, to: number): Promise<UsageSession[]> {
  const r = await c.query<{ device_id: string; package_name: string; started_at: Date; ended_at: Date | null }>(
    `select device_id, package_name, started_at, ended_at
     from usage_sessions
     where user_id = $1 and span && tstzrange($2, $3) and started_at < $3
       and not (package_name = any (excluded_packages_of($1)))`,
    [userId, new Date(from), new Date(to)],
  )
  return r.rows.map((s) => ({
    deviceId: s.device_id,
    packageName: s.package_name,
    startedAt: s.started_at.getTime(),
    endedAt: s.ended_at?.getTime() ?? null,
  }))
}

export async function categoryMap(c: Tx, packages: string[]): Promise<Map<string, string>> {
  if (packages.length === 0) return new Map()
  const r = await c.query<{ package_name: string; category: string }>(
    'select package_name, category from apps where package_name = any($1)',
    [packages],
  )
  return new Map(r.rows.map((a) => [a.package_name, a.category]))
}

/** 사용자 하루 집계를 다시 계산하고 목표 결과를 갱신한다 */
export async function refreshRollup(c: Tx, userId: string, timeZone: string, date: LocalDate, now = Date.now()) {
  const [from, to] = dayRange(date, timeZone)
  const sessions = await loadSessions(c, userId, from, to)
  const cats = await categoryMap(c, [...new Set(sessions.map((s) => s.packageName))])
  const s = summarize(sessions, { from, to, now }, (p) => cats.get(p) ?? 'other')
  const byHour = bucketize(s.union, hourBoundaries(from, to))
  const compact = (rec: Record<string, { totalMs: number; actualMs: number }>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, { t: v.totalMs, a: v.actualMs }]))

  await c.query(
    `insert into daily_rollups (user_id, local_date, total_ms, actual_ms, pickups, by_app, by_category, by_device, by_hour, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (user_id, local_date) do update set
       total_ms = excluded.total_ms, actual_ms = excluded.actual_ms, pickups = excluded.pickups,
       by_app = excluded.by_app, by_category = excluded.by_category, by_device = excluded.by_device,
       by_hour = excluded.by_hour, updated_at = now()`,
    [userId, date, s.totalMs, s.actualMs, s.pickups, compact(s.byApp), compact(s.byCategory), compact(s.byDevice), byHour],
  )

  // 꺼 둔 목표도 이미 판정이 있는 날은 다시 판정한다(예외 앱 변경을 과거 결과에도 반영)
  const goals = await c.query<GoalRow & { active: boolean }>(
    `select id, type, target, scope_ref, days_of_week, quiet_from, quiet_to, active
     from goals g where user_id = $1
       and (active or exists (select 1 from goal_results r where r.goal_id = g.id and r.local_date = $2))`,
    [userId, date],
  )
  for (const row of goals.rows) {
    if (!isGoalType(row.type)) continue
    const goal = toGoal(row)
    if (row.active && !isGoalActiveOn(goal, date)) continue
    const ev = evaluateGoal(goal, s)
    await c.query(
      `insert into goal_results (goal_id, local_date, status, value) values ($1, $2, $3, $4)
       on conflict (goal_id, local_date) do update set status = excluded.status, value = excluded.value`,
      [goal.id, date, ev.status, Math.round(ev.value)],
    )
  }
  return s
}

export async function excludedPackagesOf(c: Tx, userId: string): Promise<string[]> {
  return (await c.query<{ p: string[] }>('select excluded_packages_of($1) as p', [userId])).rows[0]!.p
}

/**
 * 예외 앱 적용 대상이 바뀐 사용자들의 모든 날짜를 원본 세션에서 다시 집계한다.
 * 원본이 걸친 날, 이미 집계나 목표 판정이 있는 날을 모두 덮어써서 이전 정책 값이 남지 않게 한다.
 * 호출하는 쪽이 lockUsers 로 대상 사용자를 잠근 트랜잭션(시스템 컨텍스트) 안에서 부른다
 */
export async function refreshAllRollups(c: Tx, userIds: string[]) {
  const now = Date.now()
  for (const userId of userIds) {
    const tz = (await c.query<{ timezone: string }>('select timezone from users where id = $1', [userId])).rows[0]?.timezone ?? 'Asia/Seoul'
    const dates = await c.query<{ d: string }>(
      `select distinct generate_series((started_at at time zone $2::text)::date,
                                       (coalesce(ended_at, now()) at time zone $2::text)::date,
                                       interval '1 day')::date::text as d
       from usage_sessions where user_id = $1
       union select local_date::text from daily_rollups where user_id = $1
       union select r.local_date::text from goal_results r join goals g on g.id = r.goal_id where g.user_id = $1`,
      [userId, tz],
    )
    for (const { d } of dates.rows) await refreshRollup(c, userId, tz, d, now)
  }
}
