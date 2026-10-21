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

    // 구성원은 그룹 설정, 공개 수준을 바꿀 수 없다
    expect((await member.call('PATCH', '/api/group', { visibility: 'app' })).status).toBe(403)
    expect((await member.call('PATCH', `/api/group/members/${member.userId}`, { visibilityOverride: 'summary' })).status).toBe(403)

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

    // 그룹대표가 앱까지 공개로 바꾸면 앱 이름이 보인다
    expect((await leader.call('PATCH', '/api/group', { visibility: 'app' })).status).toBe(200)
    board = await leader.call('GET', '/api/board')
    card = board.body.members.find((m: { userId: string }) => m.userId === member.userId)
    expect(card.apps.map((a: { label: string }) => a.label)).toEqual(['YouTube', '카카오톡'])

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

    // 목표와 판정
    const goal = await member.call('POST', '/api/me/goals', { type: 'daily_actual', target: 30 })
    expect(goal.status).toBe(200)
    const t2 = await member.call('GET', '/api/me/today')
    expect(t2.body.goals[0].evaluation.status).toBe('near')
  })
})
