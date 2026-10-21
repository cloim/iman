import {
  bucketize,
  dayRange,
  evaluateGoal,
  hourBoundaries,
  isGoalActiveOn,
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
  quietFrom: g.quiet_from,
  quietTo: g.quiet_to,
})

export async function loadSessions(c: Tx, userId: string, from: number, to: number): Promise<UsageSession[]> {
  const r = await c.query<{ device_id: string; package_name: string; started_at: Date; ended_at: Date | null }>(
    `select device_id, package_name, started_at, ended_at
     from usage_sessions
     where user_id = $1 and span && tstzrange($2, $3) and started_at < $3`,
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

  const goals = await c.query<GoalRow>(
    `select id, type, target, scope_ref, days_of_week, quiet_from, quiet_to
     from goals where user_id = $1 and active`,
    [userId],
  )
  for (const row of goals.rows) {
    const goal = toGoal(row)
    if (!isGoalActiveOn(goal, date)) continue
    const ev = evaluateGoal(goal, s, date, timeZone)
    await c.query(
      `insert into goal_results (goal_id, local_date, status, value) values ($1, $2, $3, $4)
       on conflict (goal_id, local_date) do update set status = excluded.status, value = excluded.value`,
      [goal.id, date, ev.status, Math.round(ev.value)],
    )
  }
  return s
}
