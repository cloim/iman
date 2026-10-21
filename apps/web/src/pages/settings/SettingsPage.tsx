import { formatDuration } from '@iman/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, LogOut, Pencil, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AppDownload } from '../../components/AppDownload'
import { useAppBar } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { api, errorText } from '../../lib/api'
import { openRelease, useAppUpdate } from '../../lib/appUpdate'
import { isNative, native, type NativeStatus } from '../../lib/native'
import { useMe } from '../../lib/queries'
import { applyTheme, storedTheme, type ThemePref } from '../../lib/theme'
import { APP_LEVEL_NOTE, ROLE_LABEL, VISIBILITY_HINT, VISIBILITY_LABEL } from '../../lib/types'
import { DashboardSettings } from './DashboardSettings'
import { GroupSettings } from './GroupSettings'
import { WidgetSettings } from './WidgetSettings'

interface Device {
  id: string
  model: string
  alias: string | null
  osVersion: string | null
  appVersion: string | null
  lastSyncedAt: string | null
  active: boolean
}

const ago = (iso: string | null) => {
  if (!iso) return '아직 동기화 전'
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return '방금 동기화'
  if (min < 60) return `${min}분 전 동기화`
  if (min < 1440) return `${Math.round(min / 60)}시간 전 동기화`
  return `${Math.round(min / 1440)}일 전 동기화`
}

function DeviceRow({ d }: { d: Device }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [alias, setAlias] = useState(d.alias ?? '')
  const stale = !d.lastSyncedAt || Date.now() - Date.parse(d.lastSyncedAt) > 6 * 3_600_000
  const save = async (body: Partial<Pick<Device, 'alias' | 'active'>>) => {
    await api(`/api/devices/${d.id}`, { method: 'PATCH', body })
    setEditing(false)
    void qc.invalidateQueries({ queryKey: ['devices'] })
  }
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-line py-2.5 last:border-b-0">
      <Smartphone size={22} aria-hidden />
      <div className="grid justify-items-start gap-1">
        {editing ? (
          <form
            className="flex items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void save({ alias: alias.trim() || null })
            }}
          >
            <input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={d.model} maxLength={30} aria-label="기기 별칭" autoFocus />
            <button className="icon-btn" aria-label="저장">
              <Check size={18} aria-hidden />
            </button>
          </form>
        ) : (
          <strong>{d.alias ?? d.model}</strong>
        )}
        <span className="text-[13px] text-ink-3">
          {d.model}, Android {d.osVersion ?? '?'}, 앱 {d.appVersion ?? '?'}
        </span>
        <span className={`chip ${stale ? 'chip-near' : 'chip-met'}`}>{ago(d.lastSyncedAt)}</span>
      </div>
      {!editing && (
        <button type="button" className="icon-btn" aria-label="별칭 바꾸기" onClick={() => setEditing(true)}>
          <Pencil size={18} aria-hidden />
        </button>
      )}
    </li>
  )
}

function NativeSection() {
  const [status, setStatus] = useState<NativeStatus | null>(null)
  const update = useAppUpdate()
  useEffect(() => {
    void native.getStatus().then(setStatus)
  }, [])
  if (!status) return <div className="skeleton h-[120px]" />
  return (
    <section className="card grid gap-4">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">이 기기</h2>
      <div className="flex items-center justify-between gap-3">
        <span>사용 기록 접근</span>
        {status.usagePermission ? (
          <span className="chip chip-met">허용됨</span>
        ) : (
          <button type="button" className="btn btn-sm btn-comma" onClick={() => void native.openUsageSettings()}>
            허용하기
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>알림</span>
        {status.notificationPermission ? (
          <span className="chip chip-met">허용됨</span>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void native.requestNotificationPermission().then(() => native.getStatus().then(setStatus))}>
            허용하기
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>
          앱 버전 <span className="num">{status.appVersion}</span>
        </span>
        {update?.url ? (
          <button type="button" className="btn btn-sm btn-comma" onClick={() => openRelease(update.url!)}>
            <Download size={16} aria-hidden /> {update.latest} 내려받기
          </button>
        ) : (
          update && <span className="chip chip-met">최신 버전이에요</span>
        )}
      </div>
    </section>
  )
}

type Tab = 'general' | 'group' | 'dashboard' | 'device'
const TAB_LABEL: Record<Tab, string> = { general: '일반', group: '그룹', dashboard: '대시보드', device: '기기' }

export default function SettingsPage() {
  useAppBar('설정')
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [theme, setTheme] = useState<ThemePref>(storedTheme())
  const [leaving, setLeaving] = useState(false)
  const [name, setName] = useState('')
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<{ devices: Device[] }>('/api/devices') })
  useEffect(() => setName(me.data?.user.displayName ?? ''), [me.data?.user.displayName])

  const leave = useMutation({
    mutationFn: () => api('/api/group/leave', { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate('/role', { replace: true })
    },
  })

  const logout = async () => {
    if (isNative) await native.signOut()
    else await api('/api/auth/logout', { method: 'POST' })
    qc.clear()
    navigate('/login', { replace: true })
  }

  const group = me.data?.group
  const isLeader = group?.role === 'leader'
  // 그룹 삭제는 그룹을 만든 사람만. 다른 관리자와 구성원은 그룹에서 나간다
  const isOwner = !!group && group.ownerId === me.data?.user.id
  const tabs: Tab[] = ['general']
  if (group) tabs.push('group')
  if (isLeader) tabs.push('dashboard')
  tabs.push('device')
  const asked = params.get('tab') as Tab | null
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'general'

  return (
    <div className="grid gap-4">
      <div className="tabs" role="tablist" aria-label="설정 분류">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" className="tab" aria-selected={tab === t} onClick={() => setParams(t === 'general' ? {} : { tab: t }, { replace: true })}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <section className="card grid gap-4">
            <h2 className="text-lg">프로필</h2>
            <form
              className="flex items-center gap-3"
              onSubmit={async (e) => {
                e.preventDefault()
                await api('/api/me', { method: 'PATCH', body: { displayName: name } })
                void qc.invalidateQueries({ queryKey: ['me'] })
              }}
            >
              <label className="field flex-1">
                <span>표시 이름</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
              </label>
              <button className="btn btn-sm btn-ghost self-end" disabled={!name.trim() || name === me.data?.user.displayName}>
                저장
              </button>
            </form>
            <p className="text-[13px] text-ink-3">
              {me.data?.user.email}, 시간대 {me.data?.user.timezone}
            </p>
          </section>

          <section className="card flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[18px]">화면</h2>
            <div className="segmented" role="group" aria-label="화면 모드">
              {(['auto', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={theme === t}
                  onClick={() => {
                    setTheme(t)
                    applyTheme(t)
                  }}
                >
                  {t === 'auto' ? '자동' : t === 'light' ? '종이' : '밤 종이'}
                </button>
              ))}
            </div>
          </section>

          <button type="button" className="btn btn-ghost" onClick={logout}>
            <LogOut size={18} aria-hidden /> 로그아웃
          </button>
        </>
      )}

      {tab === 'group' && group && (
        <>
          <section className="card grid gap-4">
            <h2 className="flex items-baseline justify-between gap-3 text-lg">
              내 그룹 <span className="chip">{ROLE_LABEL[group.role]}</span>
            </h2>
            <p className="text-[18px]">
              {group.emoji} {group.name}
            </p>
            <div className="card card-tint grid gap-2 p-[14px]">
              <div>
                <p className="font-bold">나에게 적용된 공개 수준: {VISIBILITY_LABEL[group.myVisibility]}</p>
                <p className="text-[13px] text-ink-2">그룹에 {VISIBILITY_HINT[group.myVisibility]}이 보여요. 공개 수준은 관리자가 정해요.{group.myVisibility === 'app' && ` ${APP_LEVEL_NOTE}`}</p>
              </div>
              <div className="border-t border-line/60 pt-2">
                <p className="font-bold">기본 기준시간: {formatDuration((group.baselineMin ?? 240) * 60_000)}</p>
                <p className="text-[13px] text-ink-2">하루 목표를 정하지 않았을 때 쉼표 게이지의 채움 기준이 돼요.</p>
              </div>
            </div>
          </section>
          {isLeader ? (
            <GroupSettings>
              <button type="button" className="btn btn-danger" onClick={() => setLeaving(true)}>
                {isOwner ? '그룹 삭제' : '그룹 나가기'}
              </button>
            </GroupSettings>
          ) : (
            <button type="button" className="btn btn-danger justify-self-start" onClick={() => setLeaving(true)}>
              그룹 나가기
            </button>
          )}
        </>
      )}

      {tab === 'dashboard' && isLeader && <DashboardSettings />}

      {tab === 'device' && (
        <>
          <section className="card">
            <h2 className="mb-3 text-lg">내 기기</h2>
            {devices.isPending ? (
              <div className="skeleton h-[72px]" />
            ) : devices.data?.devices.length ? (
              <ul className="m-0 grid list-none gap-1 p-0">
                {devices.data.devices.map((d) => (
                  <DeviceRow key={d.id} d={d} />
                ))}
              </ul>
            ) : (
              <p className="text-ink-3">안드로이드 기기에 이만 앱을 설치하고 로그인하면 여기에 나타나요.</p>
            )}
          </section>
          {isNative ? <><NativeSection /><WidgetSettings /></> : <AppDownload />}
        </>
      )}

      <Modal
        isOpen={leaving}
        onClose={() => setLeaving(false)}
        title={isOwner ? '그룹을 삭제할까요?' : '그룹에서 나갈까요?'}
        size="sm"
        draggable={false}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLeaving(false)}>
              취소
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => leave.mutate()} disabled={leave.isPending}>
              {isOwner ? '삭제' : '나가기'}
            </button>
          </>
        }
      >
        <p>
          {isOwner
            ? '모든 구성원이 그룹에서 빠지고 대시보드와 키오스크 연결도 사라져요. 각자의 사용 기록은 남아 있어요.'
            : '내 사용 기록은 남아 있고, 그룹에는 더 이상 보이지 않아요.'}
        </p>
        {leave.error && <p className="text-[13px] text-over-ink">{errorText(leave.error)}</p>}
      </Modal>
    </div>
  )
}
