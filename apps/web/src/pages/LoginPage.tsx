import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AppDownload } from '../components/AppDownload'
import { Wordmark } from '../components/brand/Comma'
import { api, errorText } from '../lib/api'
import { isNative, native } from '../lib/native'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void
          renderButton(el: HTMLElement, o: Record<string, unknown>): void
        }
      }
    }
  }
}

function loadGis(): Promise<void> {
  if (window.google) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('gis'))
    document.head.appendChild(s)
  })
}

export default function LoginPage() {
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/role'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ googleWebClientId: string | null; devLogin: boolean }>('/api/config'),
  })

  useEffect(() => {
    document.title = '로그인 | 이만,'
  }, [])

  const done = async () => {
    await qc.resetQueries({ queryKey: ['me'] })
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    await api('/api/me', { method: 'PATCH', body: { timezone: tz } }).catch(() => {})
    navigate(next, { replace: true })
  }

  useEffect(() => {
    const clientId = config.data?.googleWebClientId
    if (isNative || !clientId || !buttonRef.current) return
    let cancelled = false
    loadGis()
      .then(() => {
        if (cancelled || !buttonRef.current) return
        window.google!.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            setBusy(true)
            setError('')
            try {
              await api('/api/auth/google', { method: 'POST', body: { idToken: credential, client: 'web' } })
              await done()
            } catch (e) {
              setError(errorText(e))
            } finally {
              setBusy(false)
            }
          },
        })
        window.google!.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          locale: 'ko',
          width: 300,
        })
      })
      .catch(() => setError('구글 로그인을 불러오지 못했어요. 네트워크를 확인해 주세요.'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data?.googleWebClientId])

  const nativeSignIn = async () => {
    setBusy(true)
    setError('')
    try {
      await native.signIn()
      await done()
    } catch (e) {
      setError(e instanceof Error && e.message === 'cancelled' ? '' : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const devSignIn = async (form: FormData) => {
    try {
      await api('/api/auth/dev', { method: 'POST', body: { email: form.get('email'), name: form.get('name'), client: 'web' } })
      await done()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4 pt-[calc(32px+env(safe-area-inset-top))] pb-8">
      <div className="grid w-full max-w-[420px] justify-items-center gap-5 text-center">
        <Wordmark size={56} />
        <p className="text-lg leading-relaxed text-ink-2">
          내 모든 기기의 화면 시간을
          <br />
          쉼표로 기록하고, 함께 쉬어 가요.
        </p>
        <div className="grid min-h-[52px] w-full justify-items-center gap-2.5">
          {isNative ? (
            <button type="button" className="btn btn-block" onClick={nativeSignIn} disabled={busy}>
              구글 계정으로 계속하기
            </button>
          ) : config.isPending ? (
            <div className="skeleton w-[300px] h-[44px] rounded-full" />
          ) : config.data?.googleWebClientId ? (
            <div ref={buttonRef} aria-busy={busy} />
          ) : (
            <p className="text-[13px] text-ink-3">구글 로그인 설정이 아직 준비되지 않았어요.</p>
          )}
          {error && (
            <p className="text-[13px] text-over-ink" role="alert">
              {error}
            </p>
          )}
        </div>
        {config.data?.devLogin && (
          <form className="grid w-full gap-2 rounded-panel bg-surface-2 p-4" action={devSignIn}>
            <p className="text-[13px] text-ink-3">개발용 로그인</p>
            <input className="input" name="email" type="email" placeholder="email@test.dev" required />
            <input className="input" name="name" placeholder="이름" required />
            <button className="btn btn-ghost btn-sm">개발 계정으로 로그인</button>
          </form>
        )}
        <AppDownload compact />
        <p className="text-[13px] text-ink-3">
          로그인하면 사용 기록은 본인과, 관리자가 정한 공개 수준 안에서만 그룹에 공유돼요. <a href="/privacy">개인정보처리방침</a>
        </p>
      </div>
    </div>
  )
}
