import { GOAL_TYPES, isGoalType, localDateOf } from '@iman/core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth'
import { lockUsers, tx } from '../db'
import { HttpError, parse } from '../http'
import { userTimeZone } from '../membership'
import { refreshRollup } from '../rollup'

const GoalBody = z
  .object({
    type: z.enum(GOAL_TYPES),
    target: z.number().int().min(0).max(24 * 60),
    scopeRef: z.string().max(200).nullable().default(null),
    daysOfWeek: z.number().int().min(1).max(127).default(127),
    nudge: z
      .object({
        enabled: z.boolean(),
        near: z.boolean().default(true),
        tone: z.enum(['plain', 'warm']).default('warm'),
      })
      .default({ enabled: true, near: true, tone: 'warm' }),
    active: z.boolean().default(true),
  })
  .refine((g) => (g.type === 'app_limit' || g.type === 'category_limit' ? !!g.scopeRef : true))

const columns = `id, type, target, scope_ref as "scopeRef", days_of_week as "daysOfWeek",
  quiet_from as "quietFrom", quiet_to as "quietTo", nudge, active`

export default async function goalRoutes(app: FastifyInstance) {
  app.get('/api/me/goals', async (req) => {
    const ctx = await requireUser(req)
    return tx(ctx, async (c) => ({
      goals: (await c.query(`select ${columns} from goals where user_id = $1 order by created_at`, [ctx.userId])).rows.filter((g) => isGoalType(g.type)),
    }))
  })

  // 목표 변경 후 오늘 결과를 바로 다시 판정
  const refreshToday = async (c: Parameters<Parameters<typeof tx>[1]>[0], userId: string) => {
    await lockUsers(c, [userId])
    const tz = await userTimeZone(c, userId)
    await refreshRollup(c, userId, tz, localDateOf(Date.now(), tz))
  }

  app.post('/api/me/goals', async (req) => {
    const ctx = await requireUser(req)
    const g = parse(GoalBody, req.body)
    return tx(ctx, async (c) => {
      const r = await c.query(
        `insert into goals (user_id, type, target, scope_ref, days_of_week, quiet_from, quiet_to, nudge, active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${columns}`,
        [ctx.userId, g.type, g.target, g.scopeRef, g.daysOfWeek, null, null, g.nudge, g.active],
      )
      await refreshToday(c, ctx.userId)
      return r.rows[0]
    })
  })

  app.put('/api/me/goals/:id', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params)
    const g = parse(GoalBody, req.body)
    return tx(ctx, async (c) => {
      const r = await c.query(
        `update goals set type = $3, target = $4, scope_ref = $5, days_of_week = $6, quiet_from = $7,
           quiet_to = $8, nudge = $9, active = $10
         where id = $1 and user_id = $2 returning ${columns}`,
        [id, ctx.userId, g.type, g.target, g.scopeRef, g.daysOfWeek, null, null, g.nudge, g.active],
      )
      if (!r.rows[0]) throw new HttpError(404, 'not_found')
      await c.query('delete from goal_results where goal_id = $1 and local_date >= current_date - 1', [id])
      await refreshToday(c, ctx.userId)
      return r.rows[0]
    })
  })

  app.delete('/api/me/goals/:id', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params)
    await tx(ctx, (c) => c.query('delete from goals where id = $1 and user_id = $2', [id, ctx.userId]))
    return { ok: true }
  })
}
