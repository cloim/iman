import { localDatesBetween } from '@iman/core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth'
import { tx } from '../db'
import { HttpError, parse } from '../http'
import { membership, userTimeZone } from '../membership'
import { publish } from '../realtime'
import { refreshRollup } from '../rollup'

const MAX_AGE_MS = 60 * 86_400_000
const SKEW_TOLERANCE_MS = 2 * 60_000

const Ingest = z.object({
  deviceId: z.string().uuid(),
  sentAt: z.number().int(),
  apps: z
    .array(z.object({ packageName: z.string().max(200), label: z.string().max(100), category: z.string().max(30) }))
    .max(2000)
    .default([]),
  sessions: z
    .array(
      z.object({
        packageName: z.string().max(200),
        startedAt: z.number().int(),
        endedAt: z.number().int().nullable(),
      }),
    )
    .max(5000),
})

export default async function deviceRoutes(app: FastifyInstance) {
  app.post('/api/devices', async (req) => {
    const ctx = await requireUser(req)
    const b = parse(
      z.object({
        installId: z.string().min(8).max(100),
        model: z.string().max(100),
        osVersion: z.string().max(40).optional(),
        appVersion: z.string().max(40).optional(),
      }),
      req.body,
    )
    return tx(ctx, async (c) => {
      const r = await c.query(
        `insert into devices (user_id, install_id, model, os_version, app_version)
         values ($1, $2, $3, $4, $5)
         on conflict (user_id, install_id) do update set
           model = excluded.model, os_version = excluded.os_version, app_version = excluded.app_version, active = true
         returning id`,
        [ctx.userId, b.installId, b.model, b.osVersion ?? null, b.appVersion ?? null],
      )
      return { id: r.rows[0].id }
    })
  })

  app.get('/api/devices', async (req) => {
    const ctx = await requireUser(req)
    return tx(ctx, async (c) => ({
      devices: (
        await c.query(
          `select id, model, alias, os_version as "osVersion", app_version as "appVersion",
                  last_synced_at as "lastSyncedAt", clock_skew_ms as "clockSkewMs", active, created_at as "createdAt"
           from devices where user_id = $1 order by created_at`,
          [ctx.userId],
        )
      ).rows,
    }))
  })

  app.patch('/api/devices/:id', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params)
    const b = parse(z.object({ alias: z.string().trim().max(30).nullable().optional(), active: z.boolean().optional() }), req.body)
    const r = await tx(ctx, (c) =>
      c.query(
        `update devices set alias = case when $3 then $4 else alias end, active = coalesce($5, active)
         where id = $1 and user_id = $2`,
        [id, ctx.userId, b.alias !== undefined, b.alias ?? null, b.active ?? null],
      ),
    )
    if (r.rowCount === 0) throw new HttpError(404, 'not_found')
    return { ok: true }
  })

  app.put('/api/devices/:id/push', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params)
    const b = parse(z.object({ token: z.string().min(10).max(4096) }), req.body)
    await tx(ctx, (c) =>
      c.query(
        `insert into push_tokens (device_id, fcm_token) select id, $3 from devices where id = $1 and user_id = $2
         on conflict (device_id) do update set fcm_token = excluded.fcm_token, updated_at = now()`,
        [id, ctx.userId, b.token],
      ),
    )
    return { ok: true }
  })

  /** 기기에서 복원한 앱 세션 업서트. 같은 (기기, 앱, 시작) 은 종료 시각만 갱신하므로 재전송해도 안전 */
  app.post('/api/sessions/ingest', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const ctx = await requireUser(req)
    const b = parse(Ingest, req.body)
    const now = Date.now()
    const skew = now - b.sentAt
    const shift = Math.abs(skew) > SKEW_TOLERANCE_MS ? skew : 0
    const sessions = b.sessions
      .map((s) => ({
        packageName: s.packageName,
        startedAt: s.startedAt + shift,
        endedAt: s.endedAt === null ? null : s.endedAt + shift,
      }))
      .filter(
        (s) =>
          s.startedAt > now - MAX_AGE_MS &&
          s.startedAt <= now + 60_000 &&
          (s.endedAt === null || (s.endedAt >= s.startedAt && s.endedAt <= now + 60_000)),
      )

    const result = await tx(ctx, async (c) => {
      const dev = await c.query('select 1 from devices where id = $1 and user_id = $2', [b.deviceId, ctx.userId])
      if (!dev.rowCount) throw new HttpError(404, 'device_not_found')

      if (b.apps.length) {
        await c.query(
          `insert into apps (package_name, label, category)
           select * from unnest($1::text[], $2::text[], $3::text[])
           on conflict (package_name) do update set label = excluded.label, category = excluded.category, updated_at = now()`,
          [b.apps.map((a) => a.packageName), b.apps.map((a) => a.label), b.apps.map((a) => a.category)],
        )
      }
      if (sessions.length) {
        await c.query(
          `insert into usage_sessions (user_id, device_id, package_name, started_at, ended_at)
           select $1, $2, p, s, e
           from unnest($3::text[], $4::timestamptz[], $5::timestamptz[]) as t(p, s, e)
           on conflict (device_id, package_name, started_at) do update set ended_at = excluded.ended_at, received_at = now()`,
          [
            ctx.userId,
            b.deviceId,
            sessions.map((s) => s.packageName),
            sessions.map((s) => new Date(s.startedAt)),
            sessions.map((s) => (s.endedAt === null ? null : new Date(s.endedAt))),
          ],
        )
      }
      await c.query('update devices set last_synced_at = now(), clock_skew_ms = $2 where id = $1', [b.deviceId, skew])

      const tz = await userTimeZone(c, ctx.userId)
      const dates = new Set<string>()
      for (const s of sessions) for (const d of localDatesBetween(s.startedAt, Math.max(s.startedAt + 1, s.endedAt ?? now), tz)) dates.add(d)
      for (const d of dates) await refreshRollup(c, ctx.userId, tz, d, now)
      return { dates: [...dates], groupId: (await membership(c, ctx.userId))?.groupId }
    })
    for (const date of result.dates) publish(result.groupId, { type: 'rollup', userId: ctx.userId, date })
    return { accepted: sessions.length, rejected: b.sessions.length - sessions.length, serverTime: now }
  })
}
