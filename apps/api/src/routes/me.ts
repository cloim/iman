import {
  addDays,
  atLocalTime,
  bucketize,
  dayRange,
  evaluateGoal,
  isGoalType,
  hourBoundaries,
  isGoalActiveOn,
  localDateOf,
  overlapLength,
  summarize,
  unionIntervals,
  type Interval,
} from '@iman/core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth'
import { tx, type Tx } from '../db'
import { HttpError, parse } from '../http'
import { effectiveVisibilityOf } from './group'
import { membership, userTimeZone } from '../membership'
import { categoryMap, excludedPackagesOf, loadSessions, toGoal } from '../rollup'

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Ms = z.coerce.number().int().nonnegative()
const MAX_RANGE_MS = 93 * 86_400_000

export async function appLabels(c: Tx, packages: string[]) {
  if (packages.length === 0) return {}
  const r = await c.query<{ package_name: string; label: string; category: string }>(
    'select package_name, label, category from apps where package_name = any($1)',
    [packages],
  )
  return Object.fromEntries(r.rows.map((a) => [a.package_name, { label: a.label, category: a.category }]))
}

export default async function meRoutes(app: FastifyInstance) {
  app.get('/api/me', async (req) => {
    const ctx = await requireUser(req)
    return tx(ctx, async (c) => {
      const u = await c.query(
        `select id, email, display_name as "displayName", avatar_url as "avatarUrl", timezone, last_role as "lastRole"
         from users where id = $1`,
        [ctx.userId],
      )
      // 토큰은 유효하지만 이 DB에 없는 사용자(다른 DB에서 발급, 삭제된 계정)는 다시 로그인하게 한다
      if (!u.rows[0]) throw new HttpError(401, 'unauthenticated')
      const m = await membership(c, ctx.userId)
      let group = null
      if (m) {
        const g = await c.query(
          `select id, name, emoji, visibility, week_start as "weekStart", owner_id as "ownerId", baseline_min as "baselineMin",
                  excluded_packages as "excludedPackages" from groups where id = $1`,
          [m.groupId],
        )
        const mine = await c.query<{ p: string[] }>('select excluded_packages as p from group_members where user_id = $1', [ctx.userId])
        const myExcludedPackages = mine.rows[0]?.p ?? []
        const labels = await appLabels(c, [...g.rows[0].excludedPackages, ...myExcludedPackages])
        group = {
          ...g.rows[0],
          role: m.role,
          myVisibility: await effectiveVisibilityOf(c, ctx.userId),
          myExcludedPackages,
          appLabels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.label])),
        }
      }
      return { user: u.rows[0], group }
    })
  })

  app.patch('/api/me', async (req) => {
    const ctx = await requireUser(req)
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1).max(30).optional(),
        timezone: z
          .string()
          .refine((tz) => {
            try {
              new Intl.DateTimeFormat('en', { timeZone: tz })
              return true
            } catch {
              return false
            }
          })
          .optional(),
      }),
      req.body,
    )
    await tx(ctx, (c) =>
      c.query(
        `update users set display_name = coalesce($2, display_name), timezone = coalesce($3, timezone) where id = $1`,
        [ctx.userId, body.displayName ?? null, body.timezone ?? null],
      ),
    )
    return { ok: true }
  })

  /** 임의 범위의 총/실제 사용시간. 합계는 SQL(range_agg), 세부 분류는 core 로 계산 */
  app.get('/api/me/summary', async (req) => {
    const ctx = await requireUser(req)
    const q = parse(
      z.object({ from: Ms, to: Ms, devices: z.string().optional(), packages: z.string().optional() }),
      req.query,
    )
    if (q.to <= q.from || q.to - q.from > MAX_RANGE_MS) throw new HttpError(400, 'invalid_range')
    const devices = q.devices ? q.devices.split(',') : null
    const packages = q.packages ? q.packages.split(',') : null
    return tx(ctx, async (c) => {
      const now = Date.now()
      const totals = await c.query<{ total_ms: number; actual_ms: number; pickups: number }>(
        'select * from usage_totals($1, $2, $3, $4, $5, $6)',
        [ctx.userId, new Date(q.from), new Date(q.to), new Date(now), devices, packages],
      )
      const sessions = (await loadSessions(c, ctx.userId, q.from, q.to)).filter(
        (s) => (!devices || devices.includes(s.deviceId)) && (!packages || packages.includes(s.packageName)),
      )
      const cats = await categoryMap(c, [...new Set(sessions.map((s) => s.packageName))])
      const s = summarize(sessions, { from: q.from, to: q.to, now }, (p) => cats.get(p) ?? 'other')
      const t = totals.rows[0]!
      return {
        totalMs: t.total_ms,
        actualMs: t.actual_ms,
        overlapMs: t.total_ms - t.actual_ms,
        pickups: t.pickups,
        byApp: s.byApp,
        byDevice: s.byDevice,
        byCategory: s.byCategory,
        apps: await appLabels(c, Object.keys(s.byApp)),
      }
    })
  })

  app.get('/api/me/sessions', async (req) => {
    const ctx = await requireUser(req)
    const q = parse(z.object({ from: Ms, to: Ms }), req.query)
    if (q.to <= q.from || q.to - q.from > 31 * 86_400_000) throw new HttpError(400, 'invalid_range')
    return tx(ctx, async (c) => {
      const sessions = await loadSessions(c, ctx.userId, q.from, q.to)
      sessions.sort((a, b) => a.startedAt - b.startedAt)
      return { sessions, apps: await appLabels(c, [...new Set(sessions.map((s) => s.packageName))]) }
    })
  })

  /** 오늘 홈 */
  app.get('/api/me/today', async (req) => {
    const ctx = await requireUser(req)
    const q = parse(z.object({ date: DateStr.optional() }), req.query)
    return tx(ctx, (c) => todayReport(c, ctx.userId, q.date))
  })

  app.get('/api/me/days', async (req) => {
    const ctx = await requireUser(req)
    const q = parse(z.object({ from: DateStr, to: DateStr }), req.query)
    return tx(ctx, (c) => daysReport(c, ctx.userId, q.from, q.to))
  })

  /** 주간 쉼표 리포트: 지난주 대비 변화, 가장 늘어난 앱, 가장 길게 쉰 구간, 쉼표 횟수 */
  app.get('/api/me/weekly', async (req) => {
    const ctx = await requireUser(req)
    const q = parse(z.object({ weekStart: DateStr }), req.query)
    return tx(ctx, (c) => weeklyReport(c, ctx.userId, q.weekStart))
  })

  app.post('/api/me/rests', async (req) => {
    const ctx = await requireUser(req)
    const body = parse(
      z.object({
        startsAt: Ms,
        endsAt: Ms,
        source: z.enum(['nudge', 'widget', 'app', 'group']),
        pauseId: z.string().uuid().optional(),
      }),
      req.body,
    )
    if (body.endsAt <= body.startsAt || body.endsAt - body.startsAt > 6 * 3_600_000)
      throw new HttpError(400, 'invalid_range')
    await tx(ctx, (c) =>
      c.query(
        `insert into rests (user_id, pause_id, source, starts_at, ends_at) values ($1, $2, $3, $4, $5)
         on conflict (user_id, starts_at) do update set ends_at = excluded.ends_at`,
        [ctx.userId, body.pauseId ?? null, body.source, new Date(body.startsAt), new Date(body.endsAt)],
      ),
    )
    return { ok: true }
  })

  app.post('/api/me/rests/end', async (req) => {
    const ctx = await requireUser(req)
    const body = parse(z.object({ endsAt: Ms, cancelledAt: Ms }), req.body)
    if (body.cancelledAt > body.endsAt) throw new HttpError(400, 'invalid_range')
    await tx(ctx, (c) => c.query(
      `UPDATE rests
          SET ends_at = GREATEST(starts_at, LEAST(ends_at, $3, CURRENT_TIMESTAMP))
        WHERE user_id = $1
          AND ends_at = $2
          AND pause_id IS NULL
          AND source <> 'group'`,
      [ctx.userId, new Date(body.endsAt), new Date(body.cancelledAt)],
    ))
    return { ok: true }
  })
}

export async function weeklyReport(c: Tx, userId: string, weekStart: string) {
  const tz = await userTimeZone(c, userId)
  const prevStart = addDays(weekStart, -7)
  const from = dayRange(prevStart, tz)[0]
  const to = dayRange(addDays(weekStart, 6), tz)[1]
  const sessions = await loadSessions(c, userId, from, to)
  const thisFrom = dayRange(weekStart, tz)[0]
  const now = Date.now()
  const cur = summarize(sessions, { from: thisFrom, to, now })
  const prev = summarize(sessions, { from, to: thisFrom, now })

  let topIncrease: { packageName: string; deltaMs: number } | null = null
  for (const [pkg, v] of Object.entries(cur.byApp)) {
    const delta = v.actualMs - (prev.byApp[pkg]?.actualMs ?? 0)
    if (delta > 0 && (!topIncrease || delta > topIncrease.deltaMs)) topIncrease = { packageName: pkg, deltaMs: delta }
  }

  // 깨어 있는 시간(07~23시) 중 가장 길게 쓰지 않은 구간
  let longestBreak: { from: number; to: number } | null = null
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i)
    const wakeFrom = atLocalTime(d, '07:00', tz)
    const wakeTo = Math.min(atLocalTime(d, '23:00', tz), now)
    if (wakeTo <= wakeFrom) continue
    const inDay: Interval[] = unionIntervals(
      cur.union
        .map(([s, e]) => [Math.max(s, wakeFrom), Math.min(e, wakeTo)] as Interval)
        .filter(([s, e]) => e > s),
    )
    let cursor = wakeFrom
    for (const [s, e] of [...inDay, [wakeTo, wakeTo] as Interval]) {
      if (s - cursor > (longestBreak ? longestBreak.to - longestBreak.from : 0)) longestBreak = { from: cursor, to: s }
      cursor = Math.max(cursor, e)
    }
  }

  const rests = await c.query<{ n: number }>(
    'select count(*)::int as n from rests where user_id = $1 and starts_at >= $2 and starts_at < $3',
    [userId, new Date(thisFrom), new Date(to)],
  )
  const results = await c.query<{ date: string; status: 'met' | 'near' | 'over'; target: number }>(
    `select r.local_date::text as date, r.status, g.target from goal_results r join goals g on g.id = r.goal_id
     where g.user_id = $1 and g.type = 'daily_actual' and r.local_date between $2 and $3`,
    [userId, weekStart, addDays(weekStart, 6)],
  )
  const resultBy = new Map(results.rows.map((r) => [r.date, r]))

  // 일자별 실제 사용. 평균은 이번 주에서 오늘까지 지난 날 수로 나눈다
  const today = localDateOf(now, tz)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    const r = resultBy.get(date)
    return {
      date,
      actualMs: overlapLength(cur.union, [dayRange(date, tz)]),
      goal: r ? { status: r.status, targetMin: r.target } : null,
    }
  })
  const elapsed = days.filter((d) => d.date <= today).length
  return {
    weekStart,
    actualMs: cur.actualMs,
    totalMs: cur.totalMs,
    prevActualMs: prev.actualMs,
    changeRatio: prev.actualMs > 0 ? (cur.actualMs - prev.actualMs) / prev.actualMs : null,
    topIncrease: topIncrease && { ...topIncrease, ...(await appLabels(c, [topIncrease.packageName]))[topIncrease.packageName] },
    longestBreak,
    rests: rests.rows[0]!.n,
    goalDaysMet: results.rows.filter((r) => r.status !== 'over').length,
    days,
    avgActualMs: elapsed > 0 ? Math.round(cur.actualMs / elapsed) : 0,
  }
}

/** 하루 집계: 실시간 집계, 시간대 분포, 목표 판정, 쉬기 기록. 날짜를 비우면 그 사용자의 오늘 */
export async function todayReport(c: Tx, userId: string, day?: string) {
  const tz = await userTimeZone(c, userId)
  const now = Date.now()
  const date = day ?? localDateOf(now, tz)
  const [from, to] = dayRange(date, tz)
  const sessions = await loadSessions(c, userId, from, to)
  const cats = await categoryMap(c, [...new Set(sessions.map((s) => s.packageName))])
  const s = summarize(sessions, { from, to, now }, (p) => cats.get(p) ?? 'other')
  const grp = await c.query<{ baseline_min: number }>(
    `select g.baseline_min from group_members gm join groups g on g.id = gm.group_id where gm.user_id = $1`,
    [userId],
  )
  const baselineMin = grp.rows[0]?.baseline_min ?? 240
  const goals = await c.query(
    `select id, type, target, scope_ref, days_of_week, quiet_from, quiet_to, nudge from goals
     where user_id = $1 and active order by created_at`,
    [userId],
  )
  const rests = await c.query(
    `select id, source, starts_at as "startsAt", ends_at as "endsAt" from rests
     where user_id = $1 and starts_at < $3 and ends_at > $2 order by starts_at`,
    [userId, new Date(from), new Date(to)],
  )
  const devices = await c.query(
    `select id, coalesce(alias, model) as name, last_synced_at as "lastSyncedAt" from devices
     where user_id = $1 and active order by created_at`,
    [userId],
  )
  return {
    date,
    baselineMin,
    // 기기의 넛지(연속 사용, 앱 한도)도 같은 예외 앱을 빼도록 함께 보낸다
    excludedPackages: await excludedPackagesOf(c, userId),
    timeZone: tz,
    dayStart: from,
    dayEnd: to,
    now,
    totalMs: s.totalMs,
    actualMs: s.actualMs,
    overlapMs: s.overlapMs,
    pickups: s.pickups,
    activeNow: sessions.some((x) => x.endedAt === null),
    byApp: s.byApp,
    byDevice: s.byDevice,
    byCategory: s.byCategory,
    byHour: bucketize(s.union, hourBoundaries(from, to)),
    sessions,
    apps: await appLabels(c, Object.keys(s.byApp)),
    devices: devices.rows,
    rests: rests.rows,
    goals: goals.rows.filter((g) => isGoalType(g.type)).map((g) => {
      const goal = toGoal(g)
      return {
        ...goal,
        nudge: g.nudge,
        active: true,
        activeToday: isGoalActiveOn(goal, date),
        evaluation: evaluateGoal(goal, s),
      }
    }),
  }
}

/** 날짜 범위의 하루 집계, 목표 판정, 쉬기 횟수(기록 캘린더용) */
export async function daysReport(c: Tx, userId: string, from: string, to: string) {
  const days = await c.query(
    `select local_date as date, total_ms as "totalMs", actual_ms as "actualMs", pickups,
            by_category as "byCategory", by_hour as "byHour"
     from daily_rollups where user_id = $1 and local_date between $2 and $3 order by local_date`,
    [userId, from, to],
  )
  const results = await c.query(
    `select r.local_date as date, r.status, r.value, g.type, g.target
     from goal_results r join goals g on g.id = r.goal_id
     where g.user_id = $1 and r.local_date between $2 and $3`,
    [userId, from, to],
  )
  const rests = await c.query<{ d: string; n: number }>(
    `select (starts_at at time zone u.timezone)::date::text as d, count(*)::int as n
     from rests r join users u on u.id = r.user_id
     where r.user_id = $1 and (starts_at at time zone u.timezone)::date between $2 and $3 group by 1`,
    [userId, from, to],
  )
  return { days: days.rows, goalResults: results.rows.filter((r) => isGoalType(r.type)), rests: Object.fromEntries(rests.rows.map((r) => [r.d, r.n])) }
}
