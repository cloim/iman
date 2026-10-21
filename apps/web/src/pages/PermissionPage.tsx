import { App as CapApp } from '@capacitor/app'
import { BellRing, ChartNoAxesGantt, Check } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { Wordmark } from '../components/brand/Comma'
import { isNative, native, type NativeStatus } from '../lib/native'

/** 앱 첫 실행: 사용 기록 접근 권한 고지와 설정 이동, 알림 권한 */
export default function PermissionPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<NativeStatus | null>(null)
  const refresh = useCallback(() => native.getStatus().then(setStatus), [])

  useEffect(() => {
    document.title = '권한 안내 | 이만,'
    if (!isNative) return
    void refresh()
    const sub = CapApp.addListener('resume', () => void refresh())
    return () => {
      void sub.then((h) => h.remove())
    }
  }, [refresh])

  if (!isNative) return <Navigate to="/me" replace />
  if (status?.usagePermission && status.notificationPermission) return <Navigate to="/me" replace />

  return (
    <div className="grid min-h-full place-items-center px-4 pt-[calc(32px+env(safe-area-inset-top))] pb-8">
      <div className="grid w-full max-w-[420px] justify-items-center gap-5 text-left">
        <Wordmark size={36} />
        <h2 className="text-[24px] justify-self-start">시작하기 전에 두 가지만 허용해 주세요</h2>

        <div className="card grid w-full gap-[10px]">
          <p className="flex items-center gap-3 font-bold">
            <ChartNoAxesGantt size={20} aria-hidden /> 사용 기록 접근
            {status?.usagePermission && <Check size={18} color="var(--comma-deep)" aria-label="허용됨" />}
          </p>
          <p className="text-[13px] text-ink-2">
            이만은 안드로이드 사용 기록에서 <strong>어떤 앱을 언제부터 언제까지 화면에 띄웠는지</strong>만 읽어요. 메시지 내용, 화면 내용, 위치는 읽지 않아요.
            기록은 내 계정에 저장되고, 그룹에는 그룹대표가 정한 공개 수준만큼만 보여요.
          </p>
          {!status?.usagePermission && (
            <button type="button" className="btn btn-comma" onClick={() => void native.openUsageSettings()}>
              설정에서 이만 허용하기
            </button>
          )}
        </div>

        <div className="card grid w-full gap-[10px]">
          <p className="flex items-center gap-3 font-bold">
            <BellRing size={20} aria-hidden /> 알림
            {status?.notificationPermission && <Check size={18} color="var(--comma-deep)" aria-label="허용됨" />}
          </p>
          <p className="text-[13px] text-ink-2">
            목표에 가까워지면 "오늘은 이만, 쉬어 갈까요?"처럼 부드럽게 알려 드리고, 함께 쉬기 초대를 받을 수 있어요.
          </p>
          {!status?.notificationPermission && (
            <button type="button" className="btn btn-ghost" onClick={() => void native.requestNotificationPermission().then(refresh)}>
              알림 허용하기
            </button>
          )}
        </div>

        <button type="button" className="btn btn-block" disabled={!status?.usagePermission} onClick={() => navigate('/me', { replace: true })}>
          {status?.usagePermission ? '시작하기' : '사용 기록 접근을 허용하면 시작할 수 있어요'}
        </button>
      </div>
    </div>
  )
}
