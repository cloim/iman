import pg from 'pg'

// 개발 DB 와 분리된 iman_test 데이터베이스를 매번 새로 만든다
process.loadEnvFile(new URL('../.env.local', import.meta.url))
const owner = new URL(process.env.DATABASE_OWNER_URL!)
const app = new URL(process.env.DATABASE_URL!)

const admin = new pg.Client({ connectionString: owner.toString() })
await admin.connect()
await admin.query(
  `select pg_terminate_backend(pid) from pg_stat_activity where datname = 'iman_test' and pid <> pg_backend_pid()`,
)
await admin.query('drop database if exists iman_test')
await admin.query('create database iman_test')
await admin.end()

owner.pathname = '/iman_test'
app.pathname = '/iman_test'
process.env.DATABASE_OWNER_URL = owner.toString()
process.env.DATABASE_URL = app.toString()
process.env.DEV_LOGIN = '1'
process.env.NODE_ENV = 'test'
