import { fileURLToPath } from 'node:url'
import { env } from './env'
import { migrate } from './migrate'

const dir = fileURLToPath(new URL('../../../db/migrations', import.meta.url))
await migrate(env.databaseOwnerUrl, dir, env.appDbPassword)
console.log('migrations up to date')
