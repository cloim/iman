import { addDays, localDateOf, localDatesBetween, localParts, weekdayOf } from '@iman/core'
import type { FastifyBaseLogger } from 'fastify'
import { tx } from './db'
import { env } from './env'
import { ensurePartitions } from './migrate'
import { membership } from './membership'
import { pushToUsers } from './push'
import { publish } from './realtime'
import { refreshRollup } from './rollup'
import { weeklyReport } from './routes/me'

/** 동기화가 끊긴 기기의 진행 중 세션을 마지막 동기화 시각에서 마감 */
const STALE_OPEN_MS = 30 * 60_000

async function closeStaleSessions(log: FastifyBaseLogger) {
  const closed = await tx({ kind: 'system' }, async (c) => {
    const r = await c.query<{ user_id: string; started_at: Date; ended_at: Date; timezone: string }>(
      `update usage_sessions s set ended_at = greatest(s.started_at, d.last_synced_at)
       from devices d
       where d.id = s.device_id and s.ended_at is null
         and coalesce(d.last_synced_at, s.received_at) < now() - make_interval(secs => $1 / 1000.0)
       returning s.user_id, s.started_at, s.ended_at,
                 (select timezone from users u where u.id = s.user_id) as timezone`,
      [STALE_OPEN_MS],
    )
    const touched = new Map<string, { tz: string; dates: Set<string> }>()
    for (const row of r.rows) {
      const t = touched.get(row.user_id) ?? { tz: row.timezone, dates: new Set() }
      for (const d of localDatesBetween(row.started_at.getTime(), Math.max(row.started_at.getTime() + 1, Date.now()), row.timezone))
        t.dates.add(d)
      touched.set(row.user_id, t)
    }
    const events: { groupId: string | undefined; userId: string; date: string }[] = []
    for (const [userId, t] of touched) {
      const groupId = (await membership(c, userId))?.groupId
      for (const d of t.dates) {
        await refreshRollup(c, userId, t.tz, d)
        events.push({ groupId, userId, date: d })
      }
    }
    return events
  })
  for (const e of closed) publish(e.groupId, { type: 'rollup', userId: e.userId, date: e.date })
  if (closed.length) log.info({ count: closed.length }, 'closed stale sessions')
}

/** 매주 그룹의 주 시작 요일 오전 9시(현지)에 지난주 리포트를 만들고 알림 */
async function weeklyReports(log: FastifyBaseLogger) {
  const now = Date.now()
  const users = await tx({ kind: 'system' }, (c) =>
    c.query<{ id: string; timezone: string; week_start: number | null }>(
      `select u.id, u.timezone, g.week_start from users u
       left join group_members gm on gm.user_id = u.id left join groups g on g.id = gm.group_id
       where coalesce(gm.role, 'member') <> 'viewer'`,
    ),
  )
  for (const u of users.rows) {
    const today = localDateOf(now, u.timezone)
    if (weekdayOf(today) !== (u.week_start ?? 0) || localParts(now, u.timezone).hour < 9) continue
    const weekStart = addDays(today, -7)
    const created = await tx({ kind: 'user', userId: u.id }, async (c) => {
      const exists = await c.query('select 1 from weekly_reports where user_id = $1 and week_start = $2', [u.id, weekStart])
      if (exists.rowCount) return null
      const report = await weeklyReport(c, u.id, weekStart)
      await c.query('insert into weekly_reports (user_id, week_start, data) values ($1, $2, $3)', [u.id, weekStart, report])
      return report
    })
    if (!created) continue
    const change =
      created.changeRatio === null
        ? ''
        : created.changeRatio <= 0
          ? ` 지난주보다 ${Math.round(-created.changeRatio * 100)}% 줄었어요.`
          : ` 지난주보다 ${Math.round(created.changeRatio * 100)}% 늘었어요.`
    await pushToUsers([u.id], {
      title: '이번 주 쉼표 리포트',
      body: `지난주 쉼표 ${created.rests}번.${change}`,
      data: { kind: 'weekly', weekStart },
    }).catch((e) => log.warn(e, 'weekly push failed'))
  }
}

async function cleanup() {
  await tx({ kind: 'system' }, async (c) => {
    await c.query(`delete from kiosk_pairings where approved_at is null and code_expires_at < now() - interval '1 day'`)
    await c.query(`delete from refresh_tokens where expires_at < now() - interval '7 days'`)
  })
}

export function startScheduler(log: FastifyBaseLogger) {
  let lastHourly = 0
  const tick = async () => {
    try {
      await closeStaleSessions(log)
      await weeklyReports(log)
      if (Date.now() - lastHourly > 3_600_000) {
        lastHourly = Date.now()
        await ensurePartitions(env.databaseOwnerUrl)
        await cleanup()
      }
    } catch (e) {
      log.error(e, 'scheduler tick failed')
    }
  }
  void tick()
  return setInterval(tick, 5 * 60_000)
}
