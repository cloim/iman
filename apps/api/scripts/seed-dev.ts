/**
 * 개발 DB 에 데모 그룹과 최근 14일 사용 기록을 넣는다. 개발 로그인(DEV_LOGIN=1) API 를 통해서만 쓴다.
 * 실행: pnpm --filter @iman/api exec tsx scripts/seed-dev.ts http://127.0.0.1:47211
 */
const base = process.argv[2] ?? 'http://127.0.0.1:47211'

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${text}`)
  return text ? JSON.parse(text) : (undefined as T)
}

async function login(email: string, name: string) {
  const r = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name, client: 'app' }),
  })
  if (!r.ok) throw new Error(`login ${r.status}`)
  return ((await r.json()) as { accessToken: string }).accessToken
}

const APPS = [
  { packageName: 'com.google.android.youtube', label: 'YouTube', category: 'video' },
  { packageName: 'com.kakao.talk', label: '카카오톡', category: 'social' },
  { packageName: 'com.instagram.android', label: 'Instagram', category: 'social' },
  { packageName: 'com.nhn.android.webtoon', label: '네이버 웹툰', category: 'image' },
  { packageName: 'com.supercell.clashroyale', label: '클래시 로얄', category: 'game' },
  { packageName: 'com.spotify.music', label: 'Spotify', category: 'audio' },
  { packageName: 'com.google.android.apps.maps', label: 'Google 지도', category: 'maps' },
  { packageName: 'com.notion.id', label: 'Notion', category: 'productivity' },
]

// 결정적 의사 난수
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

function daySessions(dayStart: number, intensity: number, now: number) {
  const out: { packageName: string; startedAt: number; endedAt: number | null }[] = []
  const blocks = Math.round(6 + intensity * 10)
  for (let b = 0; b < blocks; b++) {
    let t = dayStart + (7 + rnd() * 16) * 3_600_000
    const len = (5 + rnd() * 40 * intensity) * 60_000
    const app = APPS[Math.floor(rnd() * APPS.length)]!
    if (t + len > now) continue
    out.push({ packageName: app.packageName, startedAt: Math.round(t), endedAt: Math.round(t + len) })
    // 분할 화면이나 PIP 처럼 겹쳐 쓰는 구간
    if (rnd() < 0.3) {
      const other = APPS[Math.floor(rnd() * APPS.length)]!
      if (other.packageName !== app.packageName) {
        t += len * 0.3
        out.push({ packageName: other.packageName, startedAt: Math.round(t), endedAt: Math.round(t + len * 0.5) })
      }
    }
  }
  return out
}

const people = [
  { email: 'mom@iman.dev', name: '엄마', intensity: 0.5, devices: ['Galaxy S25'] },
  { email: 'dad@iman.dev', name: '아빠', intensity: 0.8, devices: ['Pixel 9', 'Galaxy Tab S10'] },
  { email: 'yuna@iman.dev', name: '유나', intensity: 1.1, devices: ['Galaxy A56'] },
  { email: 'jun@iman.dev', name: '준', intensity: 0.7, devices: ['Galaxy Z Flip7'] },
]

const now = Date.now()
const tokens: string[] = []
for (const p of people) tokens.push(await login(p.email, p.name))

const leader = tokens[0]!
await call(leader, 'POST', '/api/groups', { name: '우리집', emoji: '🏡' }).catch(() => {})
const inv = await call<{ code: string }>(leader, 'POST', '/api/group/invites', { role: 'member', maxUses: 10 })
for (const t of tokens.slice(1)) await call(t, 'POST', `/api/invites/${inv.code}/accept`).catch(() => {})
await call(leader, 'PATCH', '/api/group', { visibility: 'category' })

const KST = 9 * 3_600_000
const todayStart = Math.floor((now + KST) / 86_400_000) * 86_400_000 - KST
for (const [i, p] of people.entries()) {
  const token = tokens[i]!
  for (const [d, model] of p.devices.entries()) {
    const dev = await call<{ id: string }>(token, 'POST', '/api/devices', { installId: `seed-${p.email}-${d}`, model, osVersion: '16', appVersion: '0.1.0' })
    const sessions = []
    for (let day = 13; day >= 0; day--) sessions.push(...daySessions(todayStart - day * 86_400_000, p.intensity / p.devices.length, now))
    if (i === 2 && d === 0) sessions.push({ packageName: 'com.google.android.youtube', startedAt: now - 12 * 60_000, endedAt: null })
    await call(token, 'POST', '/api/sessions/ingest', { deviceId: dev.id, sentAt: Date.now(), apps: APPS, sessions })
  }
  await call(token, 'POST', '/api/me/goals', { type: 'daily_actual', target: [150, 180, 120, 160][i] }).catch(() => {})
}
await call(tokens[1]!, 'POST', '/api/me/goals', { type: 'quiet_hours', target: 0, quietFrom: '23:00', quietTo: '07:00' })
await call(tokens[2]!, 'POST', '/api/me/goals', { type: 'category_limit', target: 60, scopeRef: 'video' })
console.log(`seeded ${people.length} people, invite ${inv.code}`)
