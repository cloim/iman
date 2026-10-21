import { fileURLToPath } from 'node:url'
import { env } from './env'
import { migrate } from './migrate'
import { startScheduler } from './scheduler'
import { buildServer } from './server'

// 번들 실행 시 dist/migrations, 개발 실행 시 저장소 db/migrations
const bundled = fileURLToPath(new URL('./migrations', import.meta.url))
const source = fileURLToPath(new URL('../../../db/migrations', import.meta.url))
const { existsSync } = await import('node:fs')

const app = await buildServer()
await migrate(env.databaseOwnerUrl, existsSync(bundled) ? bundled : source, env.appDbPassword, (m) => app.log.info(m))
if (env.scheduler) startScheduler(app.log)
await app.listen({ host: env.host, port: env.port })
