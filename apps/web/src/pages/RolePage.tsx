import { useQueryClient } from '@tanstack/react-query'
import { Crown, MonitorSmartphone, UserRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Wordmark } from '../components/brand/Comma'
import { api, errorText } from '../lib/api'
import { isNative } from '../lib/native'
import { useMe } from '../lib/queries'

const EMOJIS = ['🌿', '🏡', '☕', '📚', '🌙', '🐾']

function CodeForm({ label }: { label: string }) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  return (
    <form
      className="grid gap-2.5 px-1 pt-1 pb-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (code.trim()) navigate(`/join/${code.trim().toUpperCase()}`)
      }}
    >
      <label className="field">
        <span>{label}</span>
        <input className="input num" value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: K7MP2QXR" autoCapitalize="characters" maxLength={12} required />
      </label>
      <button className="btn">초대 확인하기</button>
    </form>
  )
}

function CreateGroupForm() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJIS[0]!)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="grid gap-2.5 px-1 pt-1 pb-2"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
          await api('/api/groups', { method: 'POST', body: { name, emoji } })
          await qc.invalidateQueries({ queryKey: ['me'] })
          navigate('/group?invite=welcome', { replace: true })
        } catch (err) {
          setError(errorText(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="field">
        <span>그룹 이름</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 우리집" maxLength={40} required />
      </label>
      <div className="field">
        <span>그룹 표시</span>
        <div className="flex items-center gap-3 flex-wrap" role="radiogroup" aria-label="그룹 표시 이모지">
          {EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              role="radio"
              aria-checked={emoji === em}
              className="emoji-pick"
              onClick={() => setEmoji(em)}
            >
              {em}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-[13px] text-over-ink" role="alert">{error}</p>}
      <button className="btn btn-comma" disabled={busy}>
        그룹 만들기
      </button>
    </form>
  )
}

export default function RolePage() {
  const me = useMe()
  const [open, setOpen] = useState<'leader' | 'member' | 'viewer' | null>(null)
  useEffect(() => {
    document.title = '역할 선택 | 이만,'
  }, [])
  const group = me.data?.group
  if (group) {
    if (group.role === 'viewer') return <Navigate to="/board" replace />
    return <Navigate to={isNative ? '/onboarding/permission' : '/me'} replace />
  }

  const card = (key: 'leader' | 'member' | 'viewer', icon: ReactNode, title: string, desc: string, body: ReactNode) => (
    <div className="grid gap-2">
      <button
        type="button"
        className="grid cursor-pointer grid-cols-[48px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1 rounded-card border-0 bg-surface p-[18px] text-left shadow-[0_0_0_1px_var(--line)] aria-expanded:shadow-[0_0_0_2px_var(--comma)]"
        aria-expanded={open === key}
        onClick={() => setOpen(open === key ? null : key)}
      >
        <span className="row-span-2 grid size-12 place-items-center rounded-2xl bg-comma-tint text-comma-deep">{icon}</span>
        <strong className="font-display text-[19px] font-normal">{title}</strong>
        <span className="text-sm text-ink-3">{desc}</span>
      </button>
      {open === key && body}
    </div>
  )

  return (
    <div className="grid min-h-full place-items-center px-4 pt-[calc(32px+env(safe-area-inset-top))] pb-8">
      <div className="grid w-full max-w-[420px] justify-items-center gap-5 text-center">
        <Wordmark size={40} />
        <p className="text-lg leading-relaxed text-ink-2">
          {me.data?.user.displayName}님, 어떤 역할로 함께할까요?
          <br />
          <span className="text-[13px] text-ink-3">한 계정은 한 그룹에만 함께할 수 있어요.</span>
        </p>
        <div className="grid w-full gap-3 text-left">
          {card('leader', <Crown size={22} aria-hidden />, '관리자', '그룹을 만들고 구성원과 대시보드를 관리해요. 내 사용량도 함께 기록돼요.', <CreateGroupForm />)}
          {card('member', <UserRound size={22} aria-hidden />, '구성원', '초대받은 그룹에 참여하고 나만의 목표를 세워요.', <CodeForm label="초대 코드" />)}
          {card(
            'viewer',
            <MonitorSmartphone size={22} aria-hidden />,
            '대시보드',
            'TV나 태블릿에 그룹 전체 현황을 띄워요.',
            <div className="grid gap-2">
              <CodeForm label="대시보드 초대 코드" />
              <p className="text-[13px] text-ink-3 text-center">
                공용 화면이라면 계정 없이 <Link to="/pair">키오스크로 연결</Link>하는 방법이 더 안전해요.
              </p>
            </div>,
          )}
        </div>
      </div>
    </div>
  )
}
