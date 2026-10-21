// @iman/core 같은 워크스페이스 TS 소스는 번들에 넣고, npm 의존성만 외부로 둔다
import { cpSync, readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: 'dist/index.js',
  external: Object.keys(pkg.dependencies),
})
cpSync('../../db/migrations', 'dist/migrations', { recursive: true })
