import { randomInt } from 'node:crypto'
import { dayRange, localDateOf } from '@iman/core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomToken, requireUser, requireViewer, sha256 } from '../auth'
import { tx, type DbContext, type Tx } from '../db'
import { HttpError, parse } from '../http'
import {
  groupTimeZone,
  membership,
  minVisibility,
  requireMember,
  type Role,
  type Visibility,
} from '../membership'
import { pushToUsers } from '../push'
import { publish, subscribe } from '../realtime'
import { daysReport, todayReport, weeklyReport } from './me'

const Uuid = z.string().uuid()
const VisibilityEnum = z.enum(['summary', 'category', 'app'])
const ACTIVE_WINDOW_MS = 20 * 60_000

export async function effectiveVisibilityOf(c: Tx, userId: string): Promise<Visibility | null> {
  const r = await c.query<{ v: Visibility | null }>('select effective_visibility($1) as v', [userId])
  return r.rows[0]?.v ?? null
}

interface RollupRow {
  user_id: string
  total_ms: number
  actual_ms: number
  pickups: number
  by_app: Record<string, { t: number; a: number }>
  by_category: Record<string, { t: number; a: number }>
  by_hour: number[]
}

/**
 * 그룹 현황 보드. 공개 수준(관리자 정책, 대시보드 표시 수준)에 맞춰 세부 항목을 걸러 낸다.
 * 본인 카드는 항상 전체 공개
 */
export async function buildBoard(
  ctx: DbContext,
  groupId: string,
  dashboard: { id: string; display_level: Visibility; privacy_blur: boolean } | null,
  date?: string,
) {
  const viewerId = ctx.kind === 'user' ? ctx.userId : null
  const data = await tx(ctx, async (c) => {
    const tz = await groupTimeZone(c, groupId)
    const day = date ?? localDateOf(Date.now(), tz)
    const g = await c.query('select id, name, emoji, visibility, baseline_min as "baselineMin" from groups where id = $1', [groupId])
    if (!g.rows[0]) throw new HttpError(404, 'not_found')
    const members = await c.query<{
      user_id: string
      role: Role
      name: string
      avatar_url: string | null
      visibility: Visibility
    }>(
      `select gm.user_id, gm.role, coalesce(gm.nickname, u.display_name) as name, u.avatar_url,
              coalesce(gm.visibility_override, gr.visibility) as visibility
       from group_members gm join users u on u.id = gm.user_id join groups gr on gr.id = gm.group_id
       where gm.group_id = $1 and gm.role <> 'viewer'
       order by gm.role, gm.joined_at`,
      [groupId],
    )
    const ids = members.rows.map((m) => m.user_id)
    const rollups = await c.query<RollupRow>(
      `select user_id, total_ms, actual_ms, pickups, by_app, by_category, by_hour
       from daily_rollups where user_id = any($1) and local_date = $2`,
      [ids, day],
    )
    const goals = await c.query<{ user_id: string; target: number; status: string | null }>(
      `select g.user_id, g.target, r.status from goals g
       left join goal_results r on r.goal_id = g.id and r.local_date = $2
       where g.user_id = any($1) and g.active and g.type = 'daily_actual'`,
      [ids, day],
    )
    const labels = await c.query<{ package_name: string; label: string }>(
      `select package_name, label from apps where package_name in (
         select jsonb_object_keys(by_app) from daily_rollups where user_id = any($1) and local_date = $2)`,
      [ids, day],
    )
    const pause = await c.query(
      `select id, started_by as "startedBy", starts_at as "startsAt", ends_at as "endsAt"
       from pauses p where group_id = $1 and ends_at > now() order by starts_at desc limit 1`,
      [groupId],
    )
    return { tz, day, group: g.rows[0], members: members.rows, rollups: rollups.rows, goals: goals.rows, labels: labels.rows, pause: pause.rows[0] ?? null }
  })

  // 현재 사용 여부와 쉬는 중 여부는 원본 세션을 노출하지 않고 시스템 컨텍스트에서 불리언만 계산
  const live = await tx({ kind: 'system' }, async (c) => {
    const r = await c.query<{ user_id: string; active_now: boolean; last_active: Date | null; resting: boolean }>(
      `select m.user_id,
              exists (select 1 from usage_sessions s join devices d on d.id = s.device_id
                      where s.user_id = m.user_id and s.ended_at is null
                        and s.started_at > now() - interval '1 day'
                        and d.last_synced_at > now() - make_interval(secs => $2 / 1000.0)) as active_now,
              (select max(coalesce(ended_at, started_at)) from usage_sessions s
                where s.user_id = m.user_id and s.started_at > now() - interval '1 day') as last_active,
              exists (select 1 from rests r where r.user_id = m.user_id and now() between r.starts_at and r.ends_at) as resting
       from group_members m where m.group_id = $1`,
      [groupId, ACTIVE_WINDOW_MS],
    )
    const participants = data.pause
      ? (await c.query<{ user_id: string }>('select distinct user_id from rests where pause_id = $1', [data.pause.id])).rows.map((x) => x.user_id)
      : []
    return { byUser: new Map(r.rows.map((x) => [x.user_id, x])), participants }
  })

  const rollupBy = new Map(data.rollups.map((r) => [r.user_id, r]))
  const goalBy = new Map(data.goals.map((g) => [g.user_id, g]))
  const labelBy = Object.fromEntries(data.labels.map((l) => [l.package_name, l.label]))
  const blur = dashboard?.privacy_blur ?? false

  const members = data.members.map((m) => {
    const level: Visibility =
      m.user_id === viewerId ? 'app' : dashboard ? minVisibility(m.visibility, dashboard.display_level) : m.visibility
    const r = rollupBy.get(m.user_id)
    const g = goalBy.get(m.user_id)
    const l = live.byUser.get(m.user_id)
    const top = (rec: Record<string, { t: number; a: number }> | undefined, labeler: (k: string) => string) =>
      Object.entries(rec ?? {})
        .sort((a, b) => b[1].a - a[1].a)
        .slice(0, 5)
        .map(([k, v]) => ({ key: k, label: labeler(k), actualMs: v.a, totalMs: v.t }))
    return {
      userId: m.user_id,
      role: m.role,
      name: blur ? Array.from(m.name)[0] ?? '?' : m.name,
      avatarUrl: blur ? null : m.avatar_url,
      level,
      totalMs: r?.total_ms ?? 0,
      actualMs: r?.actual_ms ?? 0,
      pickups: r?.pickups ?? 0,
      // bigint[] 는 pg 드라이버가 문자열 배열로 넘기므로 숫자로 바꿔 보낸다
      byHour: (r?.by_hour ?? []).map(Number),
      goal: g ? { targetMin: g.target, status: g.status ?? 'met' } : null,
      categories: level === 'summary' ? null : top(r?.by_category, (k) => k),
      apps: level === 'app' ? top(r?.by_app, (k) => labelBy[k] ?? k) : null,
      activeNow: l?.active_now ?? false,
      resting: l?.resting ?? false,
      lastActiveAt: l?.last_active?.getTime() ?? null,
    }
  })
  return {
    date: data.day,
    timeZone: data.tz,
    group: data.group,
    dashboard,
    pause: data.pause && { ...data.pause, participants: live.participants },
    members,
  }
}

const ownerOf = async (c: Tx, groupId: string) =>
  (await c.query<{ owner_id: string }>('select owner_id from groups where id = $1', [groupId])).rows[0]?.owner_id

async function loadDashboard(c: Tx, id: string) {
  const r = await c.query(
    `select id, group_id, name, layout, theme, display_level, privacy_blur, night_dim from dashboards where id = $1`,
    [id],
  )
  if (!r.rows[0]) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

/** 혼동하기 쉬운 문자를 뺀 초대 코드 */
function inviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join('')
}

const approveAttempts = new Map<string, { n: number; reset: number }>()

export default async function groupRoutes(app: FastifyInstance) {
  // ── 그룹 생성과 설정 ──
  app.post('/api/groups', async (req) => {
    const ctx = await requireUser(req)
    const b = parse(z.object({ name: z.string().trim().min(1).max(40), emoji: z.string().max(8).default('🌿') }), req.body)
    return tx({ kind: 'system' }, async (c) => {
      if (await membership(c, ctx.userId)) throw new HttpError(409, 'already_in_group')
      const g = await c.query<{ id: string }>(
        'insert into groups (name, emoji, owner_id) values ($1, $2, $3) returning id',
        [b.name, b.emoji, ctx.userId],
      )
      const groupId = g.rows[0]!.id
      await c.query(`insert into group_members (user_id, group_id, role) values ($1, $2, 'leader')`, [ctx.userId, groupId])
      await c.query(`insert into dashboards (group_id, name) values ($1, $2)`, [groupId, b.name])
      await c.query(`update users set last_role = 'leader' where id = $1`, [ctx.userId])
      return { id: groupId }
    })
  })

  app.patch('/api/group', async (req) => {
    const ctx = await requireUser(req)
    const b = parse(
      z.object({
        name: z.string().trim().min(1).max(40).optional(),
        emoji: z.string().max(8).optional(),
        weekStart: z.number().int().min(0).max(6).optional(),
        visibility: VisibilityEnum.optional(),
        baselineMin: z.number().int().min(30).max(1440).optional(),
      }),
      req.body,
    )
    const groupId = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      await c.query(
        `update groups set name = coalesce($2, name), emoji = coalesce($3, emoji),
           week_start = coalesce($4, week_start), visibility = coalesce($5, visibility),
           baseline_min = coalesce($6, baseline_min) where id = $1`,
        [m.groupId, b.name ?? null, b.emoji ?? null, b.weekStart ?? null, b.visibility ?? null, b.baselineMin ?? null],
      )
      return m.groupId
    })
    publish(groupId, { type: 'members' })
    return { ok: true }
  })

  /** 그룹 삭제(그룹을 만든 사람) 또는 탈퇴(다른 관리자와 구성원) */
  app.post('/api/group/leave', async (req) => {
    const ctx = await requireUser(req)
    const groupId = await tx({ kind: 'system' }, async (c) => {
      const m = await requireMember(c, ctx.userId)
      if ((await ownerOf(c, m.groupId)) === ctx.userId) await c.query('delete from groups where id = $1', [m.groupId])
      else await c.query('delete from group_members where user_id = $1', [ctx.userId])
      return m.groupId
    })
    publish(groupId, { type: 'members' })
    return { ok: true }
  })

  // ── 구성원 ──
  app.get('/api/group/members', async (req) => {
    const ctx = await requireUser(req)
    return tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId)
      const r = await c.query(
        `select gm.user_id as "userId", gm.role, gm.nickname, gm.visibility_override as "visibilityOverride",
                gm.joined_at as "joinedAt", u.display_name as "displayName", u.email, u.avatar_url as "avatarUrl",
                (select count(*)::int from devices d where d.user_id = gm.user_id and d.active) as devices,
                (select max(last_synced_at) from devices d where d.user_id = gm.user_id) as "lastSyncedAt"
         from group_members gm join users u on u.id = gm.user_id
         where gm.group_id = $1 order by gm.role, gm.joined_at`,
        [m.groupId],
      )
      return { members: r.rows }
    })
  })

  app.patch('/api/group/members/:userId', async (req) => {
    const ctx = await requireUser(req)
    const { userId } = parse(z.object({ userId: Uuid }), req.params)
    const b = parse(
      z.object({
        role: z.enum(['leader', 'member', 'viewer']).optional(),
        nickname: z.string().trim().max(20).nullable().optional(),
        visibilityOverride: VisibilityEnum.nullable().optional(),
      }),
      req.body,
    )
    const groupId = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      if (userId === ctx.userId && b.role) throw new HttpError(400, 'cannot_change_own_role')
      // 그룹을 만든 사람은 항상 관리자로 남는다
      if (b.role && userId === (await ownerOf(c, m.groupId))) throw new HttpError(400, 'owner_role_fixed')
      const r = await c.query(
        `update group_members set
           role = coalesce($3, role),
           nickname = case when $4 then $5 else nickname end,
           visibility_override = case when $6 then $7::visibility_level else visibility_override end
         where user_id = $1 and group_id = $2`,
        [userId, m.groupId, b.role ?? null, b.nickname !== undefined, b.nickname ?? null, b.visibilityOverride !== undefined, b.visibilityOverride ?? null],
      )
      if (!r.rowCount) throw new HttpError(404, 'not_found')
      return m.groupId
    })
    publish(groupId, { type: 'members' })
    return { ok: true }
  })

  /** 관리자인지와 대상이 같은 그룹의 구성원인지 확인하고, 대상에게 적용된 공개 수준을 돌려준다(본인은 전부) */
  const memberLevel = (ctx: { kind: 'user'; userId: string }, userId: string) =>
    tx(ctx, async (c): Promise<Visibility> => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      const t = await c.query<{ role: Role }>('select role from group_members where user_id = $1 and group_id = $2', [userId, m.groupId])
      if (!t.rows[0] || t.rows[0].role === 'viewer') throw new HttpError(404, 'not_found')
      return userId === ctx.userId ? 'app' : ((await effectiveVisibilityOf(c, userId)) ?? 'summary')
    })
  const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

  // 관리자가 구성원의 내역을 본다. 원본 기록은 본인 행만 보이므로 권한과 공개 수준을 확인한 뒤
  // 시스템 컨텍스트에서 읽고, 그 구성원에게 적용된 공개 수준만큼만 걸러 보낸다
  // (요약만: 총량과 시간대, 카테고리까지: + 카테고리별, 앱까지: + 앱별, 타임라인, 기기)
  app.get('/api/group/members/:userId/day', async (req) => {
    const ctx = await requireUser(req)
    const { userId } = parse(z.object({ userId: Uuid }), req.params)
    const q = parse(z.object({ date: DateStr.optional() }), req.query)
    const lv = await memberLevel(ctx, userId)
    const d = await tx({ kind: 'system' }, (c) => todayReport(c, userId, q.date))
    const app = lv === 'app'
    return {
      ...d,
      level: lv,
      byApp: app ? d.byApp : {},
      apps: app ? d.apps : {},
      sessions: app ? d.sessions : [],
      byDevice: app ? d.byDevice : {},
      devices: app ? d.devices : [],
      byCategory: lv === 'summary' ? {} : d.byCategory,
      // 하루 사용 목표만 공개하고, 앱이나 카테고리 이름이 드러나는 목표와 넛지 설정은 뺀다
      goals: d.goals.filter((g) => g.type === 'daily_actual').map((g) => ({ ...g, nudge: undefined })),
    }
  })

  /** 기록 캘린더: 하루 총량과 하루 사용 목표 판정은 요약 수준이라 공개 수준과 상관없이 보인다 */
  app.get('/api/group/members/:userId/days', async (req) => {
    const ctx = await requireUser(req)
    const { userId } = parse(z.object({ userId: Uuid }), req.params)
    const q = parse(z.object({ from: DateStr, to: DateStr }), req.query)
    await memberLevel(ctx, userId)
    const d = await tx({ kind: 'system' }, (c) => daysReport(c, userId, q.from, q.to))
    return {
      days: d.days.map(({ date, totalMs, actualMs }: { date: string; totalMs: number; actualMs: number }) => ({ date, totalMs, actualMs })),
      goalResults: d.goalResults.filter((r: { type: string }) => r.type === 'daily_actual'),
      rests: d.rests,
    }
  })

  /** 주간 리포트: 가장 늘어난 앱은 앱까지 공개일 때만 */
  app.get('/api/group/members/:userId/weekly', async (req) => {
    const ctx = await requireUser(req)
    const { userId } = parse(z.object({ userId: Uuid }), req.params)
    const q = parse(z.object({ weekStart: DateStr }), req.query)
    const lv = await memberLevel(ctx, userId)
    const w = await tx({ kind: 'system' }, (c) => weeklyReport(c, userId, q.weekStart))
    return { ...w, topIncrease: lv === 'app' ? w.topIncrease : null }
  })

  app.delete('/api/group/members/:userId', async (req) => {
    const ctx = await requireUser(req)
    const { userId } = parse(z.object({ userId: Uuid }), req.params)
    const groupId = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      if (userId === ctx.userId) throw new HttpError(400, 'cannot_remove_self')
      if (userId === (await ownerOf(c, m.groupId))) throw new HttpError(400, 'owner_role_fixed')
      await c.query('delete from group_members where user_id = $1 and group_id = $2', [userId, m.groupId])
      return m.groupId
    })
    publish(groupId, { type: 'members' })
    return { ok: true }
  })

  // ── 초대 ──
  app.get('/api/group/invites', async (req) => {
    const ctx = await requireUser(req)
    return tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      const r = await c.query(
        `select id, code, email, role, expires_at as "expiresAt", max_uses as "maxUses", used_count as "usedCount"
         from invites where group_id = $1 and revoked_at is null and expires_at > now() and used_count < max_uses
         order by created_at desc`,
        [m.groupId],
      )
      return { invites: r.rows }
    })
  })

  app.post('/api/group/invites', async (req) => {
    const ctx = await requireUser(req)
    const b = parse(
      z.object({
        role: z.enum(['member', 'viewer']).default('member'),
        email: z.string().email().optional(),
        // 화면에서는 인원 제한 없이 만들고, 유효 기간으로만 초대를 닫는다
        maxUses: z.number().int().min(1).max(10_000).default(10_000),
        ttlHours: z.number().int().min(1).max(24 * 14).default(72),
      }),
      req.body,
    )
    return tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      const r = await c.query(
        `insert into invites (group_id, code, email, role, expires_at, max_uses, created_by)
         values ($1, $2, $3, $4, now() + make_interval(hours => $5), $6, $7)
         returning id, code, role, expires_at as "expiresAt", max_uses as "maxUses"`,
        [m.groupId, inviteCode(), b.email ?? null, b.role, b.ttlHours, b.maxUses, ctx.userId],
      )
      return r.rows[0]
    })
  })

  app.delete('/api/group/invites/:id', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: Uuid }), req.params)
    await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      await c.query('update invites set revoked_at = now() where id = $1 and group_id = $2', [id, m.groupId])
    })
    return { ok: true }
  })

  /** 초대 미리보기(로그인 전에도 그룹 이름과 공개 수준을 안내) */
  app.get('/api/invites/:code', async (req) => {
    const { code } = parse(z.object({ code: z.string().min(4).max(20) }), req.params)
    return tx({ kind: 'system' }, async (c) => {
      const r = await c.query(
        `select i.role, i.expires_at as "expiresAt", g.name as "groupName", g.emoji, g.visibility,
                u.display_name as "leaderName",
                (select count(*)::int from group_members where group_id = g.id) as "memberCount"
         from invites i join groups g on g.id = i.group_id join users u on u.id = g.owner_id
         where i.code = $1 and i.revoked_at is null and i.expires_at > now() and i.used_count < i.max_uses`,
        [code.toUpperCase()],
      )
      if (!r.rows[0]) throw new HttpError(404, 'invite_invalid')
      return r.rows[0]
    })
  })

  app.post('/api/invites/:code/accept', async (req) => {
    const ctx = await requireUser(req)
    const { code } = parse(z.object({ code: z.string().min(4).max(20) }), req.params)
    const groupId = await tx({ kind: 'system' }, async (c) => {
      if (await membership(c, ctx.userId)) throw new HttpError(409, 'already_in_group')
      const r = await c.query<{ id: string; group_id: string; role: Role; email: string | null }>(
        `select id, group_id, role, email from invites
         where code = $1 and revoked_at is null and expires_at > now() and used_count < max_uses for update`,
        [code.toUpperCase()],
      )
      const inv = r.rows[0]
      if (!inv) throw new HttpError(404, 'invite_invalid')
      if (inv.email) {
        const u = await c.query<{ email: string }>('select email from users where id = $1', [ctx.userId])
        if (u.rows[0]?.email.toLowerCase() !== inv.email.toLowerCase()) throw new HttpError(403, 'invite_email_mismatch')
      }
      await c.query('insert into group_members (user_id, group_id, role) values ($1, $2, $3)', [ctx.userId, inv.group_id, inv.role])
      await c.query('update invites set used_count = used_count + 1 where id = $1', [inv.id])
      await c.query('update users set last_role = $2 where id = $1', [ctx.userId, inv.role])
      return inv.group_id
    })
    publish(groupId, { type: 'members' })
    return { ok: true }
  })

  // ── 대시보드 설정 ──
  const DashboardBody = z.object({
    name: z.string().trim().min(1).max(40),
    layout: z.object({
      metric: z.enum(['actual', 'total']),
      showRibbon: z.boolean(),
      showRanking: z.boolean(),
    }),
    theme: z.enum(['paper', 'night', 'auto']),
    displayLevel: VisibilityEnum,
    privacyBlur: z.boolean(),
    nightDim: z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }).nullable(),
  })
  const dashboardColumns = `id, name, layout, theme, display_level as "displayLevel", privacy_blur as "privacyBlur", night_dim as "nightDim"`

  app.get('/api/group/dashboards', async (req) => {
    const ctx = await requireUser(req)
    return tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId)
      const r = await c.query(`select ${dashboardColumns} from dashboards where group_id = $1 order by created_at`, [m.groupId])
      return { dashboards: r.rows }
    })
  })

  app.post('/api/group/dashboards', async (req) => {
    const ctx = await requireUser(req)
    const b = parse(DashboardBody, req.body)
    return tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      const r = await c.query(
        `insert into dashboards (group_id, name, layout, theme, display_level, privacy_blur, night_dim)
         values ($1, $2, $3, $4, $5, $6, $7) returning ${dashboardColumns}`,
        [m.groupId, b.name, b.layout, b.theme, b.displayLevel, b.privacyBlur, b.nightDim],
      )
      return r.rows[0]
    })
  })

  app.put('/api/group/dashboards/:id', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: Uuid }), req.params)
    const b = parse(DashboardBody, req.body)
    const groupId = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      const r = await c.query(
        `update dashboards set name = $3, layout = $4, theme = $5, display_level = $6, privacy_blur = $7, night_dim = $8
         where id = $1 and group_id = $2`,
        [id, m.groupId, b.name, b.layout, b.theme, b.displayLevel, b.privacyBlur, b.nightDim],
      )
      if (!r.rowCount) throw new HttpError(404, 'not_found')
      return m.groupId
    })
    publish(groupId, { type: 'members' })
    return { ok: true }
  })

  app.delete('/api/group/dashboards/:id', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: Uuid }), req.params)
    await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      await c.query('delete from dashboards where id = $1 and group_id = $2', [id, m.groupId])
    })
    return { ok: true }
  })

  // ── 키오스크 승인과 해제(관리자) ──
  app.get('/api/group/kiosks', async (req) => {
    const ctx = await requireUser(req)
    const groupId = await tx(ctx, async (c) => (await requireMember(c, ctx.userId, ['leader'])).groupId)
    return tx({ kind: 'system' }, async (c) => ({
      kiosks: (
        await c.query(
          `select k.id, k.device_label as "deviceLabel", k.dashboard_id as "dashboardId", d.name as "dashboardName",
                  k.approved_at as "approvedAt", k.last_seen_at as "lastSeenAt"
           from kiosk_pairings k join dashboards d on d.id = k.dashboard_id
           where d.group_id = $1 and k.revoked_at is null order by k.approved_at desc`,
          [groupId],
        )
      ).rows,
    }))
  })

  app.post('/api/group/kiosks', async (req) => {
    const ctx = await requireUser(req)
    const b = parse(
      z.object({ code: z.string().regex(/^\d{6}$/), dashboardId: Uuid, deviceLabel: z.string().trim().min(1).max(30) }),
      req.body,
    )
    const now = Date.now()
    const a = approveAttempts.get(ctx.userId)
    if (a && a.reset > now && a.n >= 10) throw new HttpError(429, 'too_many_attempts')
    approveAttempts.set(ctx.userId, a && a.reset > now ? { n: a.n + 1, reset: a.reset } : { n: 1, reset: now + 60_000 })

    const groupId = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader'])
      await loadDashboard(c, b.dashboardId)
      return m.groupId
    })
    const kioskId = await tx({ kind: 'system' }, async (c) => {
      const d = await c.query('select 1 from dashboards where id = $1 and group_id = $2', [b.dashboardId, groupId])
      if (!d.rowCount) throw new HttpError(404, 'not_found')
      const r = await c.query<{ id: string }>(
        `update kiosk_pairings set dashboard_id = $2, device_label = $3, approved_by = $4, approved_at = now()
         where id = (select id from kiosk_pairings where pair_code_hash = $1 and approved_at is null
                     and revoked_at is null and code_expires_at > now() order by created_at desc limit 1)
         returning id`,
        [sha256(b.code), b.dashboardId, b.deviceLabel, ctx.userId],
      )
      if (!r.rows[0]) throw new HttpError(404, 'pair_code_invalid')
      return r.rows[0].id
    })
    publish(`kiosk:${kioskId}`, { type: 'members' })
    return { id: kioskId }
  })

  app.delete('/api/group/kiosks/:id', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: Uuid }), req.params)
    const groupId = await tx(ctx, async (c) => (await requireMember(c, ctx.userId, ['leader'])).groupId)
    await tx({ kind: 'system' }, (c) =>
      c.query(
        `update kiosk_pairings set revoked_at = now()
         where id = $1 and dashboard_id in (select id from dashboards where group_id = $2)`,
        [id, groupId],
      ),
    )
    publish(groupId, { type: 'kiosk_revoked', kioskId: id })
    publish(`kiosk:${id}`, { type: 'kiosk_revoked', kioskId: id })
    return { ok: true }
  })

  // ── 함께 쉬기 ──
  app.post('/api/group/pauses', async (req) => {
    const ctx = await requireUser(req)
    const b = parse(z.object({ minutes: z.number().int().min(5).max(180) }), req.body)
    const res = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader', 'member'])
      const active = await c.query('select 1 from pauses where group_id = $1 and ends_at > now()', [m.groupId])
      if (active.rowCount) throw new HttpError(409, 'pause_active')
      const p = await c.query<{ id: string; starts_at: Date; ends_at: Date }>(
        `insert into pauses (group_id, started_by, ends_at) values ($1, $2, now() + make_interval(mins => $3))
         returning id, starts_at, ends_at`,
        [m.groupId, ctx.userId, b.minutes],
      )
      const pause = p.rows[0]!
      await c.query(
        `insert into rests (user_id, pause_id, source, starts_at, ends_at) values ($1, $2, 'group', $3, $4)`,
        [ctx.userId, pause.id, pause.starts_at, pause.ends_at],
      )
      const others = await c.query<{ user_id: string }>(
        `select user_id from group_members where group_id = $1 and user_id <> $2 and role <> 'viewer'`,
        [m.groupId, ctx.userId],
      )
      const me = await c.query<{ display_name: string }>('select display_name from users where id = $1', [ctx.userId])
      return { groupId: m.groupId, pause, others: others.rows.map((r) => r.user_id), starter: me.rows[0]!.display_name }
    })
    publish(res.groupId, { type: 'pause', pauseId: res.pause.id })
    void pushToUsers(res.others, {
      title: '함께 쉬기',
      body: `${res.starter}님이 ${b.minutes}분 함께 쉬기를 시작했어요.`,
      data: { kind: 'pause', pauseId: res.pause.id, endsAt: String(res.pause.ends_at.getTime()) },
    }).catch((e) => app.log.warn(e, 'push failed'))
    return { id: res.pause.id, startsAt: res.pause.starts_at, endsAt: res.pause.ends_at }
  })

  app.post('/api/group/pauses/:id/join', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: Uuid }), req.params)
    const groupId = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader', 'member'])
      const p = await c.query<{ ends_at: Date }>(
        'select ends_at from pauses where id = $1 and group_id = $2 and ends_at > now()',
        [id, m.groupId],
      )
      if (!p.rows[0]) throw new HttpError(404, 'pause_ended')
      await c.query(
        `insert into rests (user_id, pause_id, source, starts_at, ends_at) values ($1, $2, 'group', now(), $3)
         on conflict (user_id, starts_at) do nothing`,
        [ctx.userId, id, p.rows[0].ends_at],
      )
      return m.groupId
    })
    publish(groupId, { type: 'pause', pauseId: id })
    return { ok: true }
  })

  /** 함께 쉬기 일찍 마치기: 시작한 사람이나 관리자만. 참여자들의 쉬기 기록도 지금 시각에서 끝낸다 */
  app.post('/api/group/pauses/:id/end', async (req) => {
    const ctx = await requireUser(req)
    const { id } = parse(z.object({ id: Uuid }), req.params)
    const res = await tx(ctx, async (c) => {
      const m = await requireMember(c, ctx.userId, ['leader', 'member'])
      const p = await c.query<{ started_by: string }>(
        'select started_by from pauses where id = $1 and group_id = $2 and ends_at > now()',
        [id, m.groupId],
      )
      if (!p.rows[0]) throw new HttpError(404, 'pause_ended')
      if (m.role !== 'leader' && p.rows[0].started_by !== ctx.userId) throw new HttpError(403, 'forbidden_role')
      await c.query('update pauses set ends_at = now() where id = $1', [id])
      const members = await c.query<{ user_id: string }>(
        `select user_id from group_members where group_id = $1 and role <> 'viewer'`,
        [m.groupId],
      )
      const me = await c.query<{ display_name: string }>('select display_name from users where id = $1', [ctx.userId])
      return { groupId: m.groupId, members: members.rows.map((r) => r.user_id), ender: me.rows[0]!.display_name }
    })
    // 다른 참여자의 쉬기 기록은 본인 행만 보이므로 권한 확인 뒤 시스템 컨텍스트에서 마감
    await tx({ kind: 'system' }, (c) =>
      c.query('update rests set ends_at = greatest(starts_at, now()) where pause_id = $1 and ends_at > now()', [id]),
    )
    publish(res.groupId, { type: 'pause', pauseId: id })
    // 참여자 휴대폰의 쉬기 타이머와 초대 알림을 끄도록 마친 사람의 다른 기기까지 모두에게 알린다
    void pushToUsers(res.members, {
      title: '함께 쉬기',
      body: `${res.ender}님이 함께 쉬기를 마쳤어요.`,
      data: { kind: 'pause_end', pauseId: id },
    }).catch((e) => app.log.warn(e, 'push failed'))
    return { ok: true }
  })

  // ── 보드와 실시간 ──
  app.get('/api/board', async (req) => {
    const ctx = await requireUser(req)
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query)
    const groupId = await tx(ctx, async (c) => (await requireMember(c, ctx.userId)).groupId)
    return buildBoard(ctx, groupId, null, q.date)
  })

  /** 대시보드 화면(구글 로그인 구성원 또는 승인된 키오스크) */
  app.get('/api/boards/:id', async (req) => {
    const ctx = await requireViewer(req)
    const { id } = parse(z.object({ id: Uuid }), req.params)
    const d = await tx(ctx, (c) => loadDashboard(c, id))
    if (ctx.kind === 'kiosk' && ctx.dashboardId !== id) throw new HttpError(403, 'forbidden')
    if (ctx.kind === 'user') await tx(ctx, (c) => requireMember(c, ctx.userId))
    const board = await buildBoard(ctx, d.group_id, d, undefined)
    const [, end] = dayRange(board.date, board.timeZone)
    return { ...board, dashboard: { ...d, group_id: undefined }, dayEnd: end }
  })

  app.get('/api/events', async (req, reply) => {
    const ctx = await requireViewer(req)
    const groupId =
      ctx.kind === 'user'
        ? await tx(ctx, async (c) => (await requireMember(c, ctx.userId)).groupId)
        : await tx(ctx, async (c) => (await loadDashboard(c, (ctx as { dashboardId: string }).dashboardId)).group_id)
    const channels = [groupId]
    if (ctx.kind === 'kiosk') {
      const k = await tx({ kind: 'system' }, (c) =>
        c.query<{ id: string }>('select id from kiosk_pairings where dashboard_id = $1 and revoked_at is null', [ctx.dashboardId]),
      )
      channels.push(...k.rows.map((row) => `kiosk:${row.id}`))
    }
    subscribe(channels, reply)
  })

  // ── 키오스크 페어링(로그인 불필요) ──
  app.post('/api/kiosk/pairings', async () => {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const token = `kiosk_${randomToken()}`
    const r = await tx({ kind: 'system' }, (c) =>
      c.query<{ id: string; code_expires_at: Date }>(
        `insert into kiosk_pairings (pair_code_hash, code_expires_at, token_hash)
         values ($1, now() + interval '5 minutes', $2) returning id, code_expires_at`,
        [sha256(code), sha256(token)],
      ),
    )
    return { id: r.rows[0]!.id, code, token, expiresAt: r.rows[0]!.code_expires_at.getTime() }
  })

  app.get('/api/kiosk/me', async (req) => {
    const ctx = await requireViewer(req).catch((e: HttpError) => {
      if (e.code === 'kiosk_pending') return null
      throw e
    })
    if (!ctx) return { status: 'pending' as const }
    if (ctx.kind !== 'kiosk') throw new HttpError(400, 'not_kiosk')
    return { status: 'approved' as const, dashboardId: ctx.dashboardId }
  })

  /** 승인 대기 중인 키오스크가 승인을 즉시 받도록 페어링 전용 SSE */
  app.get('/api/kiosk/pairings/:id/events', async (req, reply) => {
    const { id } = parse(z.object({ id: Uuid }), req.params)
    const q = parse(z.object({ token: z.string().startsWith('kiosk_') }), req.query)
    const ok = await tx({ kind: 'system' }, (c) =>
      c.query('select 1 from kiosk_pairings where id = $1 and token_hash = $2 and revoked_at is null', [id, sha256(q.token)]),
    )
    if (!ok.rowCount) throw new HttpError(404, 'not_found')
    subscribe([`kiosk:${id}`], reply)
  })
}
