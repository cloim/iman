import { useQuery } from '@tanstack/react-query'
import { Download, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { isNative } from '../lib/native'

interface AndroidApp {
  available: boolean
  versionName?: string
  downloadPath?: string
}

const isAndroidBrowser = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

/**
 * 안드로이드 앱 받기 안내. 앱(WebView) 안에서는 숨기고,
 * 안드로이드 브라우저에서는 바로 받는 버튼, PC 에서는 휴대폰으로 찍을 QR 을 보여 준다.
 */
export function AppDownload({ compact = false }: { compact?: boolean }) {
  const app = useQuery({
    queryKey: ['app-android'],
    queryFn: () => api<AndroidApp>('/api/app/android'),
    enabled: !isNative,
    staleTime: 10 * 60_000,
  })
  const [qr, setQr] = useState('')
  const url = app.data?.downloadPath ? `${window.location.origin}${app.data.downloadPath}` : ''

  useEffect(() => {
    if (!url || isAndroidBrowser) return
    void QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#3c3e41', light: '#fffdf7' } }).then(setQr)
  }, [url])

  if (isNative || !app.data?.available || !url) return null

  const hint = '처음 설치할 때 "이 출처의 앱 설치 허용"을 켜 주세요. 설치 후에는 앱 설정 화면에서 바로 업데이트할 수 있어요.'

  if (isAndroidBrowser) {
    return (
      <div className={`grid w-full gap-2 ${compact ? 'text-center' : ''}`}>
        <a className="btn btn-comma" href={url}>
          <Download size={18} aria-hidden /> 안드로이드 앱 받기 <span className="num text-sm opacity-70">v{app.data.versionName}</span>
        </a>
        <p className="text-[13px] text-ink-3">{hint}</p>
      </div>
    )
  }

  return (
    <div className={`flex w-full items-center gap-4 rounded-panel bg-surface-2 p-4 text-left ${compact ? '' : 'flex-wrap'}`}>
      <div className="qr size-[112px] flex-none p-1.5" role="img" aria-label="안드로이드 앱 다운로드 QR 코드" dangerouslySetInnerHTML={{ __html: qr }} />
      <div className="grid min-w-0 gap-1">
        <p className="flex items-center gap-1.5 font-bold">
          <Smartphone size={18} aria-hidden /> 안드로이드 앱 <span className="num text-sm text-ink-3">v{app.data.versionName}</span>
        </p>
        <p className="text-[13px] text-ink-2">휴대폰 카메라로 QR 을 찍으면 바로 내려받아요. 사용 기록 수집과 위젯은 앱에서 동작해요.</p>
        <a className="text-[13px] text-comma-deep" href={url}>
          APK 직접 받기
        </a>
      </div>
    </div>
  )
}
