import pg from 'pg'
import { env } from './env'

// bigint(int8) 집계값을 number 로 받는다. ms 단위라 안전 범위 안에 있다
pg.types.setTypeParser(20, (v) => Number(v))
// date 는 'YYYY-MM-DD' 문자열 그대로
pg.types.setTypeParser(1082, (v) => v)

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 })

export type Tx = pg.PoolClient

export type DbContext =
  | { kind: 'user'; userId: string }
  | { kind: 'kiosk'; dashboardId: string }
  | { kind: 'system' }

/** RLS 컨텍스트를 지정한 트랜잭션 */
export async function tx<T>(ctx: DbContext, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(
      `select set_config('app.user_id', $1, true),
              set_config('app.kiosk_dashboard', $2, true),
              set_config('app.system', $3, true)`,
      [
        ctx.kind === 'user' ? ctx.userId : '',
        ctx.kind === 'kiosk' ? ctx.dashboardId : '',
        ctx.kind === 'system' ? 'on' : '',
      ],
    )
    const result = await fn(c)
    await c.query('commit')
    return result
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
