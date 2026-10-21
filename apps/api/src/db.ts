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

/**
 * 사용자 집계를 바꾸는 작업(수집, 예외 앱 변경, 목표 변경, 세션 마감)을 사용자 단위로 직렬화한다.
 * 교착을 피하려고 항상 id 순서로 잡고, 트랜잭션이 끝나면 풀린다
 */
export async function lockUsers(c: Tx, userIds: string[]) {
  for (const id of [...new Set(userIds)].sort())
    await c.query(`select pg_advisory_xact_lock(hashtextextended('usage:' || $1, 0))`, [id])
}

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
