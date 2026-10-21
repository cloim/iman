import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AppDownload } from '../components/AppDownload'
import { Wordmark } from '../components/brand/Comma'
import { api, ApiError, errorText } from '../lib/api'
import { useMe } from '../lib/queries'
import { APP_LEVEL_NOTE, ROLE_LABEL, VISIBILITY_HINT, VISIBILITY_LABEL, type Role, type Visibility } from '../lib/types'

interface Preview {
  role: Role
  groupName: string
  emoji: string
  visibility: Visibility
  leaderName: string
  memberCount: number
}

export default function JoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMe()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = useQuery({ queryKey: ['invite', code], queryFn: () => api<Preview>(`/api/invites/${code}`), retry: false })
  useEffect(() => {
    document.title = '그룹 초대 | 이만,'
  }, [])
  const signedIn = !!me.data
  const loggedOut = me.error instanceof ApiError && me.error.status === 401

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/invites/${code}/accept`, { method: 'POST' })
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate(preview.data?.role === 'viewer' ? '/board' : '/role', { replace: true })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4 pt-[calc(32px+env(safe-area-inset-top))] pb-8">
      <div className="grid w-full max-w-[420px] justify-items-center gap-5 text-center">
        <Wordmark size={40} />
        {preview.isPending ? (
          <div className="card grid gap-4 w-full">
            <span className="skeleton-text w-[50%] h-[24px]" />
            <span className="skeleton-text w-[80%]" />
          </div>
        ) : preview.error ? (
          <div className="empty">
            <p>{errorText(preview.error)}</p>
            <Link to="/role" className="btn btn-ghost">
              역할 선택으로
            </Link>
          </div>
        ) : (
          <>
            <div className="card grid gap-4 w-full text-left">
              <div className="flex items-center gap-3">
                <span className="text-[34px]" aria-hidden>
                  {preview.data.emoji}
                </span>
                <div>
                  <h2 className="text-[24px]">{preview.data.groupName}</h2>
                  <p className="text-ink-3">
                    {preview.data.leaderName}님이 {ROLE_LABEL[preview.data.role]}(으)로 초대했어요. 지금 {preview.data.memberCount}명이 함께해요.
                  </p>
                </div>
              </div>
              <div className="card card-tint grid gap-[6px]">
                <p className="flex items-center gap-2 font-bold">
                  <ShieldCheck size={18} aria-hidden /> 공개 수준: {VISIBILITY_LABEL[preview.data.visibility]}
                </p>
                <p className="text-[13px] text-ink-2">
                  그룹 구성원과 대시보드에 {VISIBILITY_HINT[preview.data.visibility]}이 보여요. 공개 수준은 관리자가 정하며, 내 설정 화면에서 언제든 확인할 수 있어요.
                  {preview.data.visibility === 'app' && ` ${APP_LEVEL_NOTE}`}
                </p>
              </div>
            </div>
            {signedIn ? (
              me.data.group ? (
                <p className="text-[13px] text-over-ink">{errorText(new ApiError(409, 'already_in_group'))}</p>
              ) : (
                <button type="button" className="btn btn-comma btn-block" onClick={accept} disabled={busy}>
                  동의하고 참여하기
                </button>
              )
            ) : loggedOut ? (
              <Link className="btn btn-block" to={`/login?next=${encodeURIComponent(`/join/${code}`)}`}>
                구글 로그인하고 참여하기
              </Link>
            ) : null}
            {error && <p className="text-[13px] text-over-ink" role="alert">{error}</p>}
            <AppDownload compact />
          </>
        )}
      </div>
    </div>
  )
}
