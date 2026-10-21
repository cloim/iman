// 안드로이드 APK 를 이 PC 에서 서명 빌드하여 GitHub Releases(<owner>/iman)에 올린다.
// 사용: pnpm release:android -- --notes "변경 내용" [--dry-run] [--skip-tests]
// 버전은 루트 package.json 의 version 을 쓴다. 올리기 전에 버전을 먼저 올려 두어야 한다.
// 서명 키는 저장소 밖 속성 파일(IMAN_SIGNING_PROPERTIES, 기본 </path/to/signing.properties>)에서 읽는다.
// 앱은 최신 Release 의 latest.json 을 읽어 버전을 비교하고, APK 의 sha256 과 서명 인증서를 확인한 뒤 설치한다.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = '<owner>/iman'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const web = join(root, 'apps', 'web')
const android = join(web, 'android')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = `v${version}`
const [major, minor, patch] = version.split('.').map(Number)
const versionCode = major * 10000 + minor * 100 + patch
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const skipTests = args.includes('--skip-tests')
const notesIndex = args.indexOf('--notes')
const notes = notesIndex >= 0 ? args[notesIndex + 1] : `이만 ${tag}`

const signing = process.env.IMAN_SIGNING_PROPERTIES ?? '</path/to/signing.properties>'
if (!existsSync(signing)) throw new Error(`서명 속성 파일이 없습니다: ${signing}`)
if (!existsSync(join(android, 'app', 'google-services.json'))) throw new Error('apps/web/android/app/google-services.json 이 필요합니다(FCM).')

// 운영 설정의 구글 웹 클라이언트 ID 를 앱 빌드에 넣는다
const deployEnv = readFileSync(join(root, 'deploy', '.env'), 'utf8')
const clientId = /^GOOGLE_WEB_CLIENT_ID=(.+)$/m.exec(deployEnv)?.[1]?.trim()
if (!clientId) throw new Error('deploy/.env 에 GOOGLE_WEB_CLIENT_ID 가 필요합니다.')

// Windows 의 .cmd/.bat(pnpm, npx, gradlew)은 셸이 필요하고, gh 같은 실행 파일은 셸 없이 부른다
const run = (cmd, cmdArgs, cwd, env = {}, shell = process.platform === 'win32') => {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}`)
  execFileSync(cmd, cmdArgs, { cwd, stdio: ['ignore', 'inherit', 'inherit'], shell, env: { ...process.env, ...env } })
}

const existing = (() => {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
if (existing && !dryRun) throw new Error(`${tag} 릴리스가 이미 있습니다. package.json 버전을 올려 주세요.`)

if (!skipTests) {
  run('pnpm', ['typecheck'], root)
  run('pnpm', ['test'], root)
}
run('pnpm', ['--filter', '@iman/web', 'build'], root)
run('npx', ['cap', 'sync', 'android'], web)
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['testReleaseUnitTest', 'assembleRelease', '--no-daemon', '-q'], android, {
  IMAN_SIGNING_PROPERTIES: signing,
  IMAN_VERSION_NAME: version,
  IMAN_VERSION_CODE: String(versionCode),
  IMAN_GOOGLE_WEB_CLIENT_ID: clientId,
})

const outDir = join(root, 'release')
mkdirSync(outDir, { recursive: true })
const apkName = `iman-${tag}.apk`
const apk = join(outDir, apkName)
copyFileSync(join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), apk)
const sha256 = createHash('sha256').update(readFileSync(apk)).digest('hex')
const latest = join(outDir, 'latest.json')
writeFileSync(
  latest,
  JSON.stringify(
    {
      versionName: version,
      versionCode,
      apkUrl: `https://github.com/${REPO}/releases/download/${tag}/${apkName}`,
      sha256,
      minSupported: Number(process.env.IMAN_MIN_SUPPORTED ?? 0),
      notes,
    },
    null,
    2,
  ),
)
console.log(`APK: ${apk}\nsha256: ${sha256}`)

if (dryRun) {
  console.log('dry-run: 릴리스 업로드를 건너뜁니다.')
} else {
  run('gh', ['release', 'create', tag, apk, latest, '--repo', REPO, '--title', `이만 ${tag}`, '--notes', notes], root, {}, false)
}
