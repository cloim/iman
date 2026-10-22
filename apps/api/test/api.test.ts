import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/intervals/cases.json'

let app: FastifyInstance
let tx: typeof import('../src/db').tx
let pool: typeof import('../src/db').pool

beforeAll(async () => {
  const { migrate } = await import('../src/migrate')
  const { env } = await import('../src/env')
  await migrate(env.databaseOwnerUrl, fileURLToPath(new URL('../../../db/migrations', import.meta.url)), env.appDbPassword, () => {})
  ;({ tx, pool } = await import('../src/db'))
  const { buildServer } = await import('../src/server')
  app = await buildServer()
  app.log.level = 'warn'
})

afterAll(async () => {
  await app?.close()
  await pool?.end()
})

/** 개발 로그인으로 앱용 액세스 토큰을 받는다 */
async function login(email: string, name = email.split('@')[0]!) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { email, name, client: 'app' } })
  expect(r.statusCode).toBe(200)
  const token = r.json().accessToken as string
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } })
    return { status: res.statusCode, body: res.body ? res.json() : null }
  }
  const me = await call('GET', '/api/me')
  return { token, call, userId: me.body.user.id as string, refreshToken: r.json().refreshToken as string }
}

describe('개인 쉬기 취소', () => {
  it('이전 위젯 기록도 취소하며 다른 사용자, 다른 타이머와 그룹 쉬기는 보존한다', async () => {
    const owner = await login('rest-owner@test.dev')
    const other = await login('rest-other@test.dev')
    const now = Date.now()
    const end = now + 30 * 60_000
    const cancelled = now - 1_000
    for (const [startsAt, endsAt, source] of [
      [now - 60_000, end, 'widget'],
      [now - 50_000, end + 1_000, 'app'],
      [now - 40_000, end, 'group'],
    ] as const) {
      expect((await owner.call('POST', '/api/me/rests', { startsAt, endsAt, source })).status).toBe(200)
    }
    expect((await other.call('POST', '/api/me/rests', { startsAt: now - 60_000, endsAt: end, source: 'widget' })).status).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/me/rests/end', payload: { endsAt: end, cancelledAt: cancelled } })).statusCode).toBe(401)
    expect((await owner.call('POST', '/api/me/rests/end', { endsAt: end, cancelledAt: end + 1 })).status).toBe(400)
    expect((await owner.call('POST', '/api/me/rests/end', { endsAt: end, cancelledAt: cancelled })).status).toBe(200)
    // 같은 취소 요청을 재전송해도 결과가 유지된다.
    expect((await owner.call('POST', '/api/me/rests/end', { endsAt: end, cancelledAt: cancelled })).status).toBe(200)
    const records = (await owner.call('GET', '/api/me/today')).body.rests as { source: string; endsAt: string }[]
    expect(Date.parse(records.find((r) => r.source === 'widget')!.endsAt)).toBe(cancelled)
    expect(Date.parse(records.find((r) => r.source === 'app')!.endsAt)).toBe(end + 1_000)
    expect(Date.parse(records.find((r) => r.source === 'group')!.endsAt)).toBe(end)
    const otherRecords = (await other.call('GET', '/api/me/today')).body.rests as { endsAt: string }[]
    expect(Date.parse(otherRecords[0]!.endsAt)).toBe(end)
  })

  it('오프라인 취소를 늦게 재전송해도 실제 취소시각을 보존한다', async () => {
    const user = await login('rest-offline@test.dev')
    const end = Date.now() - 60_000
    const start = end - 30 * 60_000
    const cancelled = start + 5 * 60_000
    await user.call('POST', '/api/me/rests', { startsAt: start, endsAt: end, source: 'nudge' })
    expect((await user.call('POST', '/api/me/rests/end', { endsAt: end, cancelledAt: cancelled })).status).toBe(200)
    const records = (await user.call('GET', '/api/me/today')).body.rests as { endsAt: string }[]
    expect(Date.parse(records[0]!.endsAt)).toBe(cancelled)
  })
})

describe('SQL 집계가 골든 픽스처와 일치', () => {
  it('usage_totals', async () => {
    const u = await login('golden@test.dev')
    const devices: Record<string, string> = {}
    for (const name of ['phone', 'tablet']) {
      const r = await u.call('POST', '/api/devices', { installId: `install-${name}-golden`, model: name })
      devices[name] = r.body.id
    }
    for (const c of fixture.cases) {
      await tx({ kind: 'system' }, (db) => db.query('delete from usage_sessions where user_id = $1', [u.userId]))
      await tx({ kind: 'system' }, async (db) => {
        for (const [dev, pkg, s, e] of c.sessions as [string, string, string, string | null][]) {
          await db.query(
            `insert into usage_sessions (user_id, device_id, package_name, started_at, ended_at) values ($1, $2, $3, $4, $5)
             on conflict do nothing`,
            [u.userId, devices[dev], pkg, s, e],
          )
        }
      })
      const r = await tx({ kind: 'user', userId: u.userId }, (db) =>
        db.query('select * from usage_totals($1, $2, $3, $4)', [u.userId, c.window[0], c.window[1], c.now]),
      )
      const row = r.rows[0]
      expect({ name: c.name, total: row.total_ms / 60_000, actual: row.actual_ms / 60_000, pickups: row.pickups }).toEqual({
        name: c.name,
        total: c.expect.totalMin,
        actual: c.expect.actualMin,
        pickups: c.expect.pickups,
      })
    }
  })
})

describe('실시간(SSE)', () => {
  it('키오스크가 그룹과 키오스크 채널을 함께 구독해도 서버가 안정적', async () => {
    const leader = await login('sse-leader@test.dev')
    await leader.call('POST', '/api/groups', { name: 'SSE' })
    const dashboardId = (await leader.call('GET', '/api/group/dashboards')).body.dashboards[0].id
    const pair = (await app.inject({ method: 'POST', url: '/api/kiosk/pairings' })).json()
    await leader.call('POST', '/api/group/kiosks', { code: pair.code, dashboardId, deviceLabel: 'TV' })
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const ctrl = new AbortController()
    const res = await fetch(`${address}/api/events?token=${pair.token}`, { signal: ctrl.signal })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('retry')
    await leader.call('POST', '/api/group/pauses', { minutes: 10 })
    const next = new TextDecoder().decode((await reader.read()).value)
    expect(next).toContain('event: pause')
    ctrl.abort()
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })
})

describe('인증', () => {
  it('리프레시 토큰 회전과 재사용 탐지', async () => {
    const u = await login('rotate@test.dev')
    const first = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: u.refreshToken } })
    expect(first.statusCode).toBe(200)
    const reused = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: u.refreshToken } })
    expect(reused.json().error).toBe('refresh_reused')
    const next = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.json().refreshToken } })
    expect(next.statusCode).toBe(401)
  })
  it('토큰 없으면 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me' })
    expect(r.statusCode).toBe(401)
  })
})

describe('요일별 목표', () => {
  it('그룹 카드와 오늘 판정은 오늘 적용되는 목표만 사용한다', async () => {
    const user = await login('weekday-goal@test.dev')
    await user.call('POST', '/api/groups', { name: '요일별 목표' })
    const today = await user.call('GET', '/api/me/today')
    const weekday = (new Date(`${today.body.date}T12:00:00Z`).getUTCDay() + 6) % 7
    const daysOfWeek = 1 << weekday
    const current = await user.call('POST', '/api/me/goals', { type: 'daily_actual', target: 120, daysOfWeek })
    expect(current.status).toBe(200)
    // 나중에 저장한 다른 요일 목표가 오늘 목표를 덮어쓰지 않아야 한다.
    await user.call('POST', '/api/me/goals', { type: 'daily_actual', target: 240, daysOfWeek: 127 ^ daysOfWeek })
    const board = await user.call('GET', '/api/board')
    expect(board.body.members.find((m: { userId: string }) => m.userId === user.userId).goal.targetMin).toBe(120)
    const report = await user.call('GET', '/api/me/today')
    expect(report.body.goals.filter((g: { activeToday: boolean }) => g.activeToday).map((g: { target: number }) => g.target)).toEqual([120])
    await user.call('DELETE', `/api/me/goals/${current.body.id}`)
    const withoutToday = await user.call('GET', '/api/board')
    expect(withoutToday.body.members.find((m: { userId: string }) => m.userId === user.userId).goal).toBeNull()
  })
})

describe('예외 앱', () => {
  it('공통과 구성원별 예외 앱을 과거 기록까지 집계에서 빼고, 풀리면 원래대로 돌아온다', async () => {
    const leader = await login('ex-leader@test.dev')
    const member = await login('ex-member@test.dev')
    const YT = 'com.google.android.youtube'
    const KT = 'com.kakao.talk'
    await leader.call('POST', '/api/groups', { name: '예외' })
    const inv = await leader.call('POST', '/api/group/invites', { role: 'member' })
    await member.call('POST', `/api/invites/${inv.body.code}/accept`)

    const dev = await member.call('POST', '/api/devices', { installId: 'install-ex-1', model: 'Galaxy' })
    const now = Date.now()
    // 며칠 전 서울 정오(03:00 UTC)에 시작해 자정을 넘지 않는 과거 세션
    const d = new Date(now - 3 * 86_400_000)
    const past = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3)
    await member.call('POST', '/api/sessions/ingest', {
      deviceId: dev.body.id,
      sentAt: now,
      apps: [
        { packageName: YT, label: 'YouTube', category: 'video' },
        { packageName: KT, label: '카카오톡', category: 'social' },
      ],
      sessions: [
        { packageName: YT, startedAt: now - 30 * 60_000, endedAt: now - 10 * 60_000 },
        { packageName: KT, startedAt: now - 20 * 60_000, endedAt: now - 5 * 60_000 },
        { packageName: YT, startedAt: past, endedAt: past + 60 * 60_000 },
      ],
    })
    await member.call('POST', '/api/me/goals', { type: 'daily_actual', target: 20 })
    const minutes = async () => {
      const t = await member.call('GET', '/api/me/today')
      const summary = await member.call('GET', `/api/me/summary?from=${t.body.dayStart}&to=${t.body.dayEnd}`)
      const pastDate = new Date(past).toLocaleDateString('sv-SE', { timeZone: t.body.timeZone })
      const days = await member.call('GET', `/api/me/days?from=${pastDate}&to=${t.body.date}`)
      const byDate = Object.fromEntries(days.body.days.map((d: { date: string; actualMs: number }) => [d.date, d.actualMs / 60_000]))
      const goal = days.body.goalResults.find((r: { date: string }) => r.date === t.body.date)
      return {
        today: Math.round(t.body.actualMs / 60_000),
        total: Math.round(t.body.totalMs / 60_000),
        summary: Math.round(summary.body.actualMs / 60_000),
        past: Math.round(byDate[pastDate] ?? 0),
        rollup: Math.round(byDate[t.body.date] ?? 0),
        goal: goal?.status,
        excluded: t.body.excludedPackages,
      }
    }
    expect(await minutes()).toMatchObject({ today: 25, total: 35, summary: 25, past: 60, rollup: 25, goal: 'over', excluded: [] })

    // 관리자만 바꾸고 앱을 찾을 수 있으며, 패키지 이름 형식을 확인한다
    expect((await member.call('PATCH', '/api/group', { excludedPackages: [YT] })).status).toBe(403)
    expect((await member.call('PATCH', `/api/group/members/${member.userId}`, { excludedPackages: [YT] })).status).toBe(403)
    expect((await member.call('GET', '/api/group/app-catalog?q=You')).status).toBe(403)
    expect((await leader.call('PATCH', '/api/group', { excludedPackages: ['not a package'] })).status).toBe(400)
    const catalog = await leader.call('GET', '/api/group/app-catalog?q=You')
    expect(catalog.body.apps).toContainEqual({ packageName: YT, label: 'YouTube' })

    // 공통 예외: 겹친 구간을 빼고 다시 계산하며 과거 기록과 목표 판정에도 적용된다
    expect((await leader.call('PATCH', '/api/group', { excludedPackages: [YT, YT] })).status).toBe(200)
    expect(await minutes()).toMatchObject({ today: 15, total: 15, summary: 15, past: 0, rollup: 15, excluded: [YT] })
    expect((await minutes()).goal).not.toBe('over')
    const memberMe = await member.call('GET', '/api/me')
    expect(memberMe.body.group).toMatchObject({ excludedPackages: [YT], myExcludedPackages: [], appLabels: { [YT]: 'YouTube' } })

    // 구성원별 예외는 공통 목록에 더해 그 구성원에게만
    expect((await leader.call('PATCH', `/api/group/members/${member.userId}`, { excludedPackages: [KT] })).status).toBe(200)
    expect(await minutes()).toMatchObject({ today: 0, total: 0, past: 0, excluded: [YT, KT].sort() })
    const board = await leader.call('GET', '/api/board')
    const card = board.body.members.find((m: { userId: string }) => m.userId === member.userId)
    expect(card).toMatchObject({ actualMs: 0, activeNow: false })
    expect((await leader.call('GET', '/api/me/today')).body.excludedPackages).toEqual([YT])
    const asLeader = await leader.call('GET', '/api/group/members')
    expect(asLeader.body.members.find((m: { userId: string }) => m.userId === member.userId).excludedPackages).toEqual([KT])
    expect(asLeader.body.appLabels[KT]).toBe('카카오톡')
    const asMember = await member.call('GET', '/api/group/members')
    expect(asMember.body.members.every((m: { excludedPackages: unknown }) => m.excludedPackages === null)).toBe(true)

    // 예외를 풀면 원본에서 다시 계산한다
    expect((await leader.call('PATCH', `/api/group/members/${member.userId}`, { excludedPackages: [] })).status).toBe(200)
    expect(await minutes()).toMatchObject({ today: 15, past: 0 })

    // 그룹을 나가면 그룹 예외도 풀린다
    expect((await member.call('POST', '/api/group/leave')).status).toBe(200)
    expect(await minutes()).toMatchObject({ today: 25, total: 35, past: 60, rollup: 25, goal: 'over', excluded: [] })
  })
})

describe('그룹, 수집, 공개 수준, 키오스크', () => {
  it('전체 흐름', async () => {
    const leader = await login('leader@test.dev', '엄마')
    const member = await login('member@test.dev', '첫째')
    const outsider = await login('outsider@test.dev', '남')

    expect((await leader.call('POST', '/api/groups', { name: '우리집' })).status).toBe(200)
    expect((await leader.call('POST', '/api/groups', { name: '두번째' })).body.error).toBe('already_in_group')

    // 초대와 수락
    const inv = await leader.call('POST', '/api/group/invites', { role: 'member', maxUses: 2 })
    expect(inv.status).toBe(200)
    const preview = await app.inject({ method: 'GET', url: `/api/invites/${inv.body.code}` })
    expect(preview.json()).toMatchObject({ groupName: '우리집', visibility: 'category' })
    expect((await member.call('POST', `/api/invites/${inv.body.code}/accept`)).status).toBe(200)
    expect((await member.call('POST', `/api/invites/${inv.body.code}/accept`)).body.error).toBe('already_in_group')

    // 구성원은 그룹 설정, 공개 수준, 기본 기준시간을 바꿀 수 없다
    expect((await member.call('PATCH', '/api/group', { visibility: 'app' })).status).toBe(403)
    expect((await member.call('PATCH', '/api/group', { baselineMin: 180 })).status).toBe(403)
    expect((await member.call('PATCH', `/api/group/members/${member.userId}`, { visibilityOverride: 'summary' })).status).toBe(403)

    // 관리자가 기본 기준시간을 180분으로 변경하면 구성원에게도 반영된다
    expect((await leader.call('PATCH', '/api/group', { baselineMin: 180 })).status).toBe(200)
    const memberMeUpdated = await member.call('GET', '/api/me')
    expect(memberMeUpdated.body.group.baselineMin).toBe(180)

    // 기기 등록과 세션 수집(분할 화면 겹침 + 진행 중 세션)
    const dev = await member.call('POST', '/api/devices', { installId: 'install-member-1', model: 'Galaxy' })
    const now = Date.now()
    const ingest = await member.call('POST', '/api/sessions/ingest', {
      deviceId: dev.body.id,
      sentAt: now,
      apps: [
        { packageName: 'com.google.android.youtube', label: 'YouTube', category: 'video' },
        { packageName: 'com.kakao.talk', label: '카카오톡', category: 'social' },
      ],
      sessions: [
        { packageName: 'com.google.android.youtube', startedAt: now - 30 * 60_000, endedAt: now - 10 * 60_000 },
        { packageName: 'com.kakao.talk', startedAt: now - 20 * 60_000, endedAt: now - 5 * 60_000 },
        { packageName: 'com.kakao.talk', startedAt: now - 2 * 60_000, endedAt: null },
      ],
    })
    expect(ingest.body.accepted).toBe(3)
    // 재전송은 멱등
    await member.call('POST', '/api/sessions/ingest', {
      deviceId: dev.body.id,
      sentAt: now,
      sessions: [{ packageName: 'com.kakao.talk', startedAt: now - 2 * 60_000, endedAt: now - 1 * 60_000 }],
    })
    const today = await member.call('GET', '/api/me/today')
    expect(today.body.baselineMin).toBe(180)
    expect(Math.round(today.body.totalMs / 60_000)).toBe(20 + 15 + 1)
    expect(Math.round(today.body.actualMs / 60_000)).toBe(25 + 1)

    // 다른 사람의 원본 세션은 직접 읽을 수 없다
    const leak = await tx({ kind: 'user', userId: outsider.userId }, (db) =>
      db.query('select count(*)::int as n from usage_sessions where user_id = $1', [member.userId]),
    )
    expect(leak.rows[0].n).toBe(0)
    const leak2 = await tx({ kind: 'user', userId: leader.userId }, (db) =>
      db.query('select count(*)::int as n from usage_sessions where user_id = $1', [member.userId]),
    )
    expect(leak2.rows[0].n).toBe(0)
    await expect(
      tx({ kind: 'user', userId: leader.userId }, (db) =>
        db.query('select * from member_sessions($1, now() - interval \'1 day\', now())', [member.userId]),
      ),
    ).rejects.toThrow('forbidden')

    // 공개 수준 category: 카테고리는 보이고 앱은 안 보인다
    let board = await leader.call('GET', '/api/board')
    let card = board.body.members.find((m: { userId: string }) => m.userId === member.userId)
    expect(card.level).toBe('category')
    expect(card.categories.map((c: { key: string }) => c.key).sort()).toEqual(['social', 'video'])
    expect(card.apps).toBeNull()
    // 관리자가 보는 구성원 하루 내역도 같은 공개 수준만큼만
    let day = await leader.call('GET', `/api/group/members/${member.userId}/day`)
    expect(day.body.level).toBe('category')
    expect(Math.round(day.body.actualMs / 60_000)).toBe(26)
    expect(Object.keys(day.body.byCategory).sort()).toEqual(['social', 'video'])
    expect(day.body.sessions).toEqual([])
    expect(day.body.byApp).toEqual({})
    // 기록 캘린더와 주간 리포트도 볼 수 있고, 가장 늘어난 앱은 앱까지 공개일 때만
    const memberDays = await leader.call('GET', `/api/group/members/${member.userId}/days?from=${day.body.date}&to=${day.body.date}`)
    expect(memberDays.body.days).toHaveLength(1)
    expect(memberDays.body.days[0].byCategory).toBeUndefined()
    let memberWeek = await leader.call('GET', `/api/group/members/${member.userId}/weekly?weekStart=${day.body.date}`)
    expect(memberWeek.body.days[0].actualMs).toBe(day.body.actualMs)
    expect(memberWeek.body.topIncrease).toBeNull()
    // 구성원은 다른 사람의 내역을 볼 수 없다
    expect((await member.call('GET', `/api/group/members/${leader.userId}/day`)).status).toBe(403)

    // 그룹대표가 앱까지 공개로 바꾸면 앱 이름이 보인다
    expect((await leader.call('PATCH', '/api/group', { visibility: 'app' })).status).toBe(200)
    board = await leader.call('GET', '/api/board')
    card = board.body.members.find((m: { userId: string }) => m.userId === member.userId)
    expect(card.apps.map((a: { label: string }) => a.label)).toEqual(['YouTube', '카카오톡'])
    day = await leader.call('GET', `/api/group/members/${member.userId}/day`)
    expect(day.body.sessions).toHaveLength(3)
    expect(day.body.apps['com.kakao.talk'].label).toBe('카카오톡')
    memberWeek = await leader.call('GET', `/api/group/members/${member.userId}/weekly?weekStart=${day.body.date}`)
    expect(memberWeek.body.topIncrease.label).toBeTruthy()
    expect((await member.call('GET', `/api/group/members/${leader.userId}/weekly?weekStart=${day.body.date}`)).status).toBe(403)

    // 관리자는 구성원을 관리자로 올릴 수 있고, 그룹을 만든 사람의 역할은 바뀌지 않는다
    expect((await leader.call('PATCH', `/api/group/members/${member.userId}`, { role: 'leader' })).status).toBe(200)
    expect((await member.call('PATCH', `/api/group/members/${leader.userId}`, { role: 'member' })).body.error).toBe('owner_role_fixed')
    expect((await member.call('DELETE', `/api/group/members/${leader.userId}`)).body.error).toBe('owner_role_fixed')
    expect((await member.call('GET', `/api/group/members/${leader.userId}/day`)).status).toBe(200)
    expect((await leader.call('PATCH', `/api/group/members/${member.userId}`, { role: 'member' })).status).toBe(200)

    // 바깥 사람은 보드를 볼 수 없다
    expect((await outsider.call('GET', '/api/board')).status).toBe(403)

    // 키오스크: 대시보드 표시 수준(summary)이 그룹 수준보다 우선
    const dashboards = await leader.call('GET', '/api/group/dashboards')
    const dashboardId = dashboards.body.dashboards[0].id
    const pair = (await app.inject({ method: 'POST', url: '/api/kiosk/pairings' })).json()
    const kioskCall = (url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${pair.token}` } })
    expect((await kioskCall('/api/kiosk/me')).json().status).toBe('pending')
    expect((await kioskCall(`/api/boards/${dashboardId}`)).statusCode).toBe(403)
    expect((await member.call('POST', '/api/group/kiosks', { code: pair.code, dashboardId, deviceLabel: '거실 TV' })).status).toBe(403)
    const approved = await leader.call('POST', '/api/group/kiosks', { code: pair.code, dashboardId, deviceLabel: '거실 TV' })
    expect(approved.status).toBe(200)
    expect((await kioskCall('/api/kiosk/me')).json()).toEqual({ status: 'approved', dashboardId })
    const kb = (await kioskCall(`/api/boards/${dashboardId}`)).json()
    const kcard = kb.members.find((m: { userId: string }) => m.userId === member.userId)
    expect(kcard.level).toBe('summary')
    expect(kcard.categories).toBeNull()
    expect(kcard.activeNow).toBe(false)
    // 같은 코드는 한 번만
    expect((await leader.call('POST', '/api/group/kiosks', { code: pair.code, dashboardId, deviceLabel: 'x' })).status).toBe(404)
    // 해제하면 즉시 차단
    await leader.call('DELETE', `/api/group/kiosks/${approved.body.id}`)
    expect((await kioskCall(`/api/boards/${dashboardId}`)).statusCode).toBe(401)

    // 함께 쉬기
    const pause = await member.call('POST', '/api/group/pauses', { minutes: 30 })
    expect(pause.status).toBe(200)
    expect((await leader.call('POST', `/api/group/pauses/${pause.body.id}/join`)).status).toBe(200)
    board = await leader.call('GET', '/api/board')
    expect(board.body.pause.participants.sort()).toEqual([leader.userId, member.userId].sort())
    expect(board.body.members.flatMap((m: { byHour: unknown[] }) => m.byHour).every((v: unknown) => typeof v === 'number')).toBe(true)
    // 일찍 마치면 보드에서 사라지고 다시 시작할 수 있다
    expect((await leader.call('POST', `/api/group/pauses/${pause.body.id}/end`)).status).toBe(200)
    board = await leader.call('GET', '/api/board')
    expect(board.body.pause).toBeNull()
    expect((await member.call('POST', `/api/group/pauses/${pause.body.id}/end`)).status).toBe(404)

    // 목표와 판정
    const goal = await member.call('POST', '/api/me/goals', { type: 'daily_actual', target: 30 })
    expect(goal.status).toBe(200)
    const t2 = await member.call('GET', '/api/me/today')
    expect(t2.body.goals[0].evaluation.status).toBe('near')

    // 주간 리포트: 일자별 실제 사용과 평균
    const weekly = await member.call('GET', `/api/me/weekly?weekStart=${t2.body.date}`)
    expect(weekly.status).toBe(200)
    expect(weekly.body.days).toHaveLength(7)
    expect(weekly.body.days[0]).toMatchObject({ date: t2.body.date, actualMs: t2.body.actualMs, goal: { status: 'near', targetMin: 30 } })
    expect(weekly.body.avgActualMs).toBe(t2.body.actualMs)
    expect(weekly.body.goalDaysMet).toBe(1)
  })
})
