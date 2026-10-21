import { env } from './env'

export interface AndroidRelease {
  versionName: string
  versionCode: number
  apkUrl: string
  notes: string
}

const TTL_MS = 10 * 60_000
let cache: { at: number; value: AndroidRelease | null } | null = null

/** GitHub 최신 릴리스의 latest.json(로컬 릴리스 스크립트가 올림). 10분 캐시 */
export async function latestAndroidRelease(): Promise<AndroidRelease | null> {
  if (!env.releaseRepo) return null
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  try {
    const res = await fetch(`https://github.com/${env.releaseRepo}/releases/latest/download/latest.json`, {
      signal: AbortSignal.timeout(10_000),
    })
    const j = res.ok ? ((await res.json()) as AndroidRelease) : null
    cache = { at: Date.now(), value: j && j.apkUrl ? j : null }
  } catch {
    // 일시적 실패는 이전 값을 유지하고 1분 뒤 다시 시도
    cache = { at: Date.now() - TTL_MS + 60_000, value: cache?.value ?? null }
  }
  return cache.value
}
