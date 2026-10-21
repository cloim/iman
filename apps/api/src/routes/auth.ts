import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  RT_COOKIE,
  clearWebCookies,
  issueTokens,
  revokeRefresh,
  rotateRefresh,
  setWebCookies,
  upsertUser,
  verifyGoogleIdToken,
  type GoogleProfile,
  type TokenPair,
} from '../auth'
import { tx } from '../db'
import { env } from '../env'
import { HttpError, parse } from '../http'

const Client = z.enum(['web', 'app'])

export default async function authRoutes(app: FastifyInstance) {
  async function login(profile: GoogleProfile, client: 'web' | 'app') {
    return tx({ kind: 'system' }, async (c) => {
      const userId = await upsertUser(c, profile)
      return issueTokens(c, userId, client)
    })
  }

  const respond = (client: 'web' | 'app', pair: TokenPair, reply: Parameters<typeof setWebCookies>[0]) => {
    if (client === 'web') {
      setWebCookies(reply, pair)
      return { ok: true }
    }
    return pair
  }

  app.post('/api/auth/google', async (req, reply) => {
    const body = parse(z.object({ idToken: z.string().min(10), client: Client }), req.body)
    const profile = await verifyGoogleIdToken(body.idToken)
    return respond(body.client, await login(profile, body.client), reply)
  })

  if (env.devLogin) {
    app.post('/api/auth/dev', async (req, reply) => {
      const body = parse(
        z.object({ email: z.string().email(), name: z.string().min(1), client: Client.default('web') }),
        req.body,
      )
      const profile = { sub: `dev:${body.email}`, email: body.email, name: body.name, picture: null }
      return respond(body.client, await login(profile, body.client), reply)
    })
  }

  app.post('/api/auth/refresh', async (req, reply) => {
    const body = parse(z.object({ refreshToken: z.string().optional() }).default({}), req.body ?? {})
    const fromCookie = req.cookies[RT_COOKIE]
    const token = body.refreshToken ?? fromCookie
    if (!token) throw new HttpError(401, 'invalid_refresh')
    try {
      const pair = await rotateRefresh(token)
      return respond(body.refreshToken ? 'app' : 'web', pair, reply)
    } catch (e) {
      if (!body.refreshToken) clearWebCookies(reply)
      throw e
    }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const body = parse(z.object({ refreshToken: z.string().optional() }).default({}), req.body ?? {})
    const token = body.refreshToken ?? req.cookies[RT_COOKIE]
    if (token) await revokeRefresh(token)
    clearWebCookies(reply)
    return { ok: true }
  })
}
