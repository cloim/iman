import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'

/** db/migrations 의 SQL 을 이름 순으로 한 번씩 적용하고 iman_app 비밀번호를 맞춘다 */
export async function migrate(ownerUrl: string, dir: string, appPassword: string, log = console.log) {
  const c = new pg.Client({ connectionString: ownerUrl })
  await c.connect()
  try {
    await c.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`)
    const done = new Set(
      (await c.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name),
    )
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    for (const f of files) {
      if (done.has(f)) continue
      const sql = await readFile(join(dir, f), 'utf8')
      await c.query('begin')
      try {
        await c.query(sql)
        await c.query('insert into schema_migrations (name) values ($1)', [f])
        await c.query('commit')
        log(`migrated ${f}`)
      } catch (e) {
        await c.query('rollback')
        throw new Error(`${f} 적용 실패: ${(e as Error).message}`)
      }
    }
    await c.query(`alter role iman_app password ${c.escapeLiteral(appPassword)}`)
  } finally {
    await c.end()
  }
}

/** 다음 달들 파티션을 미리 만든다(소유자 권한 필요) */
export async function ensurePartitions(ownerUrl: string) {
  const c = new pg.Client({ connectionString: ownerUrl })
  await c.connect()
  try {
    await c.query('select ensure_usage_partitions(1, 3)')
  } finally {
    await c.end()
  }
}
