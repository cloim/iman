import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { OAuth2Client } from 'google-auth-library'
import { SignJWT, jwtVerify } from 'jose'
import { tx, type DbContext, type Tx } from './db'
import { env } from './env'
import { HttpError } from './http'

const ACCESS_TTL_SEC = 15 * 60
const REFRESH_TTL_DAYS = 60
export const AT_COOKIE = 'iman_at'
export const RT_COOKIE = 'iman_rt'

const google = new OAuth2Client()

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export interface GoogleProfile {
  sub: string
  email: string
  name: string
  picture: string | null
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!env.googleWebClientId) throw new HttpError(503, 'google_not_configured')
  const ticket = await google
    .verifyIdToken({ idToken, audience: env.googleWebClientId })
    .catch(() => {
      throw new HttpError(401, 'invalid_google_token')
    })
  const p = ticket.getPayload()
  if (!p?.sub || !p.email || !p.email_verified) throw new HttpError(401, 'invalid_google_token')
  return { sub: p.sub, email: p.email, name: p.name ?? p.email.split('@')[0]!, picture: p.picture ?? null }
}

export async function upsertUser(c: Tx, p: GoogleProfile): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into users (google_sub, email, display_name, avatar_url)
     values ($1, $2, $3, $4)
     on conflict (google_sub) do update
       set email = excluded.email, avatar_url = excluded.avatar_url
     returning id`,
    [p.sub, p.email, p.name, p.picture],
  )
  return r.rows[0]!.id
}

export async function signAccess(userId: string): Promise<string> {
  return new SignJWT({ typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(env.jwtSecret)
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
}

export async function issueTokens(c: Tx, userId: string, client: 'web' | 'app'): Promise<TokenPair> {
  const refreshToken = randomToken()
  await c.query(
    `insert into refresh_tokens (user_id, token_hash, client, expires_at)
     values ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, sha256(refreshToken), client, REFRESH_TTL_DAYS],
  )
  return {
    accessToken: await signAccess(userId),
    refreshToken,
    accessExpiresAt: Date.now() + ACCESS_TTL_SEC * 1000,
  }
}

/** 회전 발급. 이미 회전된 토큰이 다시 쓰이면 탈취로 보고 그 사용자의 토큰을 모두 폐기 */
export async function rotateRefresh(refreshToken: string): Promise<TokenPair & { userId: string }> {
  const result = await tx({ kind: 'system' }, async (c) => {
    const r = await c.query<{ id: string; user_id: string; client: 'web' | 'app'; revoked_at: Date | null; expires_at: Date }>(
      'select id, user_id, client, revoked_at, expires_at from refresh_tokens where token_hash = $1 for update',
      [sha256(refreshToken)],
    )
    const row = r.rows[0]
    if (!row) return { error: 'invalid_refresh' } as const
    if (row.revoked_at) {
      // 폐기는 커밋되어야 하므로 오류는 트랜잭션 밖에서 던진다
      await c.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [row.user_id])
      return { error: 'refresh_reused' } as const
    }
    if (row.expires_at.getTime() < Date.now()) return { error: 'refresh_expired' } as const
    const pair = await issueTokens(c, row.user_id, row.client)
    await c.query('update refresh_tokens set revoked_at = now() where id = $1', [row.id])
    return { ...pair, userId: row.user_id }
  })
  if ('error' in result && result.error) throw new HttpError(401, result.error)
  return result
}

export async function revokeRefresh(refreshToken: string) {
  await tx({ kind: 'system' }, (c) =>
    c.query('update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null', [
      sha256(refreshToken),
    ]),
  )
}

export function setWebCookies(reply: FastifyReply, pair: TokenPair) {
  const secure = env.production
  reply.setCookie(AT_COOKIE, pair.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SEC,
  })
  reply.setCookie(RT_COOKIE, pair.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH_TTL_DAYS * 86400,
  })
}

export function clearWebCookies(reply: FastifyReply) {
  reply.clearCookie(AT_COOKIE, { path: '/' })
  reply.clearCookie(RT_COOKIE, { path: '/api/auth' })
}

export const KIOSK_PREFIX = 'kiosk_'

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7)
  const q = (req.query as Record<string, unknown> | undefined)?.token
  return typeof q === 'string' ? q : null
}

/** 로그인 사용자 컨텍스트. 웹은 쿠키, 앱은 Bearer */
export async function requireUser(req: FastifyRequest): Promise<{ kind: 'user'; userId: string }> {
  const token = bearer(req) ?? req.cookies[AT_COOKIE]
  if (!token || token.startsWith(KIOSK_PREFIX)) throw new HttpError(401, 'unauthenticated')
  try {
    const { payload } = await jwtVerify(token, env.jwtSecret, { algorithms: ['HS256'] })
    if (payload.typ !== 'access' || !payload.sub) throw new Error()
    return { kind: 'user', userId: payload.sub }
  } catch {
    throw new HttpError(401, 'unauthenticated')
  }
}

/** 키오스크 토큰 확인. 승인 전이면 dashboardId 가 null */
export async function resolveKiosk(req: FastifyRequest): Promise<{ id: string; dashboardId: string | null }> {
  const token = bearer(req)
  if (!token?.startsWith(KIOSK_PREFIX)) throw new HttpError(401, 'unauthenticated')
  const row = await tx({ kind: 'system' }, async (c) => {
    const r = await c.query<{ id: string; dashboard_id: string | null }>(
      `update kiosk_pairings set last_seen_at = now()
       where token_hash = $1 and revoked_at is null
       returning id, dashboard_id`,
      [sha256(token)],
    )
    return r.rows[0]
  })
  if (!row) throw new HttpError(401, 'kiosk_revoked')
  return { id: row.id, dashboardId: row.dashboard_id }
}

/** 사용자 또는 승인된 키오스크 */
export async function requireViewer(req: FastifyRequest): Promise<DbContext> {
  const token = bearer(req)
  if (token?.startsWith(KIOSK_PREFIX)) {
    const k = await resolveKiosk(req)
    if (!k.dashboardId) throw new HttpError(403, 'kiosk_pending')
    return { kind: 'kiosk', dashboardId: k.dashboardId }
  }
  return requireUser(req)
}
