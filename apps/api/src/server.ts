import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { pool } from './db'
import { env } from './env'
import { HttpError } from './http'
import authRoutes from './routes/auth'
import deviceRoutes from './routes/devices'
import goalRoutes from './routes/goals'
import groupRoutes from './routes/group'
import meRoutes from './routes/me'

const APP_ORIGIN = 'https://localhost'

export async function buildServer() {
  const app = Fastify({
    logger: { level: env.production ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  })

  // 기기 동기화는 gzip 본문을 보낸다
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    try {
      const raw = req.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body
      done(null, raw.length ? JSON.parse(raw.toString('utf8')) : {})
    } catch {
      done(new HttpError(400, 'invalid_json'), undefined)
    }
  })

  // 안드로이드 앱 WebView(https://localhost)는 Bearer 토큰으로만 호출하므로 쿠키 없이 CORS 허용
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin !== APP_ORIGIN || !req.url.startsWith('/api/')) return
    reply.header('access-control-allow-origin', APP_ORIGIN)
    reply.header('vary', 'origin')
    if (req.method === 'OPTIONS') {
      reply
        .header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE')
        .header('access-control-allow-headers', 'authorization, content-type, content-encoding')
        .header('access-control-max-age', '86400')
        .status(204)
        .send()
    }
  })

  // 쿠키 인증을 쓰는 변경 요청은 같은 출처에서만 허용(CSRF 방지)
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || !req.url.startsWith('/api/')) return
    if (req.headers.authorization) return
    const origin = req.headers.origin
    if (origin && origin !== env.publicOrigin && !(!env.production && origin.startsWith('http://localhost')))
      throw new HttpError(403, 'bad_origin')
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code })
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500)
      return reply.status((err as { statusCode: number }).statusCode).send({ error: 'bad_request' })
    if ((err as { code?: string }).code === '42501') return reply.status(403).send({ error: 'forbidden' })
    req.log.error(err)
    return reply.status(500).send({ error: 'internal' })
  })

  await app.register(cookie)
  await app.register(authRoutes)
  await app.register(meRoutes)
  await app.register(goalRoutes)
  await app.register(deviceRoutes)
  await app.register(groupRoutes)

  app.get('/api/config', async () => ({
    googleWebClientId: env.googleWebClientId || null,
    devLogin: env.devLogin,
  }))

  app.get('/api/health', async () => {
    await pool.query('select 1')
    return { ok: true }
  })

  if (env.webDist && existsSync(join(env.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: env.webDist,
      wildcard: false,
      setHeaders(res, path) {
        res.setHeader(
          'cache-control',
          path.includes(`${join('assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
      },
    })
    // SPA: API 가 아닌 경로는 index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not_found' })
      return reply.header('cache-control', 'no-cache').sendFile('index.html')
    })
  }

  return app
}
