import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { isNative, native } from './native'

interface AndroidRelease {
  available: boolean
  versionName?: string
  releaseUrl?: string
}

const isNewer = (candidate: string, current: string) => {
  const a = candidate.split('.').map((x) => Number(x) || 0)
  const b = current.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/**
 * 앱에서만: 이 앱 버전과 GitHub 최신 릴리스를 비교한다. 앱을 켤 때 한 번 확인하고,
 * 새 버전이 있으면 릴리스 페이지에서 내려받아 지금 앱 위에 설치한다
 */
export function useAppUpdate() {
  const q = useQuery({
    queryKey: ['app-update'],
    queryFn: async () => {
      const [{ appVersion }, latest] = await Promise.all([native.getStatus(), api<AndroidRelease>('/api/app/android')])
      const newer = !!latest.versionName && !!latest.releaseUrl && isNewer(latest.versionName, appVersion)
      return { current: appVersion, latest: newer ? latest.versionName! : null, url: newer ? latest.releaseUrl! : null }
    },
    enabled: isNative,
    staleTime: Infinity,
    retry: false,
  })
  return q.data
}

export const openRelease = (url: string) => window.open(url, '_blank')
