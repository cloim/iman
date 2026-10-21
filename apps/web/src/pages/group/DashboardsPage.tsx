import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, MonitorPlay, Pencil, Plus, Tv, X } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { BarActions, useAppBar } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import SelectControl from '../../components/SelectControl'
import { api, errorText } from '../../lib/api'
import { useMe } from '../../lib/queries'
import { VISIBILITY_HINT, VISIBILITY_LABEL, type Dashboard, type Visibility } from '../../lib/types'

interface Kiosk {
  id: string
  deviceLabel: string
  dashboardId: string
  dashboardName: string
  approvedAt: string
  lastSeenAt: string | null
}

const blank = (): Omit<Dashboard, 'id'> & { id?: string } => ({
  name: '거실 보드',
  layout: { metric: 'actual', showRibbon: true, showRanking: false },
  theme: 'auto',
  displayLevel: 'summary',
  privacyBlur: false,
  nightDim: { from: '23:00', to: '07:00' },
})

export default function DashboardsPage() {
  useAppBar('대시보드')
  const me = useMe()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null)
  const [code, setCode] = useState(params.get('pair') ?? '')
  const [label, setLabel] = useState('거실 TV')
  const [target, setTarget] = useState('')
  const [approved, setApproved] = useState('')

  const dashboards = useQuery({ queryKey: ['dashboards'], queryFn: () => api<{ dashboards: Dashboard[] }>('/api/group/dashboards') })
  const kiosks = useQuery({ queryKey: ['kiosks'], queryFn: () => api<{ kiosks: Kiosk[] }>('/api/group/kiosks') })
  const groupVisibility = me.data?.group?.visibility ?? 'category'
  const list = dashboards.data?.dashboards ?? []
  const targetId = target || list[0]?.id || ''

  const save = useMutation({
    mutationFn: (d: ReturnType<typeof blank>) =>
      d.id ? api(`/api/group/dashboards/${d.id}`, { method: 'PUT', body: d }) : api('/api/group/dashboards', { method: 'POST', body: d }),
    onSuccess: () => {
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['dashboards'] })
    },
  })
  const approve = useMutation({
    mutationFn: () => api('/api/group/kiosks', { method: 'POST', body: { code, dashboardId: targetId, deviceLabel: label } }),
    onSuccess: () => {
      setApproved(`${label}에 대시보드를 연결했어요.`)
      setCode('')
      void qc.invalidateQueries({ queryKey: ['kiosks'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/group/kiosks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kiosks'] }),
  })

  if (me.data?.group && me.data.group.role !== 'leader') return <Navigate to="/group" replace />

  return (
    <div className="grid gap-4">
      <BarActions>
        <button type="button" className="icon-btn" aria-label="대시보드 추가" title="대시보드 추가" onClick={() => setDraft(blank())}>
          <Plus size={22} aria-hidden />
        </button>
      </BarActions>

      <section className="card grid gap-4">
        <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
          <span className="flex items-center gap-2">
            <Tv size={20} aria-hidden /> 키오스크 연결
          </span>
        </h2>
        <p className="text-[13px] text-ink-3 -mt-2">
          TV나 태블릿 브라우저에서 <strong>iman.example.com/pair</strong>를 열면 6자리 코드가 보여요. 계정 로그인 없이 이 대시보드만 볼 수 있게 연결돼요.
        </p>
        <form
          className="grid items-end gap-2.5 md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            setApproved('')
            approve.mutate()
          }}
        >
          <label className="field">
            <span>화면의 코드</span>
            <input className="input num" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" required />
          </label>
          <label className="field">
            <span>기기 이름</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} required />
          </label>
          <label className="field">
            <span>띄울 대시보드</span>
            <SelectControl value={targetId} onChange={(e) => setTarget(e.target.value)}>
              {list.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectControl>
          </label>
          <button className="btn btn-comma" disabled={approve.isPending || code.length !== 6 || !targetId}>
            연결 승인
          </button>
        </form>
        {approve.error && <p className="text-[13px] text-over-ink" role="alert">{errorText(approve.error)}</p>}
        {approved && <p className="chip chip-met animate-comma-drop" role="status">{approved}</p>}

        {kiosks.data && kiosks.data.kiosks.length > 0 && (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {kiosks.data.kiosks.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3">
                <span>
                  <strong>{k.deviceLabel}</strong> <span className="text-[13px] text-ink-3">{k.dashboardName}, {k.lastSeenAt ? `마지막 접속 ${new Date(k.lastSeenAt).toLocaleString('ko-KR')}` : '접속 기록 없음'}</span>
                </span>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => revoke.mutate(k.id)}>
                  <X size={14} aria-hidden /> 해제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dashboards.isPending ? (
        <div className="skeleton h-[96px] rounded-[24px]" />
      ) : (
        list.map((d) => (
          <section key={d.id} className="card flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <MonitorPlay size={22} aria-hidden />
              <div>
                <strong>{d.name}</strong>
                <p className="text-[13px] text-ink-3">
                  표시 {VISIBILITY_LABEL[d.displayLevel]}, {d.layout.metric === 'actual' ? '실제 사용' : '총 사용'} 기준
                  {d.privacyBlur ? ', 이름 가림' : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Link className="btn btn-ghost btn-sm" to={`/board/${d.id}`} target="_blank">
                <ExternalLink size={14} aria-hidden /> 열기
              </Link>
              <button type="button" className="icon-btn" aria-label={`${d.name} 수정`} onClick={() => setDraft({ ...d })}>
                <Pencil size={18} aria-hidden />
              </button>
            </div>
          </section>
        ))
      )}

      <Modal
        isOpen={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? '대시보드 수정' : '새 대시보드'}
        size="md"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              취소
            </button>
            <button type="button" className="btn btn-sm" onClick={() => draft && save.mutate(draft)} disabled={save.isPending}>
              저장
            </button>
          </>
        }
      >
        {draft && (
          <div className="grid gap-4">
            <label className="field">
              <span>이름</span>
              <input className="input" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <div className="field">
              <span>표시 수준</span>
              <div className="grid gap-2.5" role="radiogroup" aria-label="표시 수준">
                {(['summary', 'category', 'app'] as Visibility[]).map((v) => {
                  const blocked = ['summary', 'category', 'app'].indexOf(v) > ['summary', 'category', 'app'].indexOf(groupVisibility)
                  return (
                    <button key={v} type="button" role="radio" aria-checked={draft.displayLevel === v} className="option-card" disabled={blocked} onClick={() => setDraft({ ...draft, displayLevel: v })}>
                      <strong>{VISIBILITY_LABEL[v]}</strong>
                      <span>{blocked ? '그룹 공개 수준보다 넓게 보여 줄 수 없어요' : VISIBILITY_HINT[v]}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="field">
              <span>기준 시간</span>
              <div className="segmented" role="group">
                <button type="button" aria-pressed={draft.layout.metric === 'actual'} onClick={() => setDraft({ ...draft, layout: { ...draft.layout, metric: 'actual' } })}>
                  실제 사용
                </button>
                <button type="button" aria-pressed={draft.layout.metric === 'total'} onClick={() => setDraft({ ...draft, layout: { ...draft.layout, metric: 'total' } })}>
                  총 사용
                </button>
              </div>
            </div>
            <label className="field">
              <span>테마</span>
              <SelectControl value={draft.theme} onChange={(e) => setDraft({ ...draft, theme: e.target.value as Dashboard['theme'] })}>
                <option value="auto">자동(야간 시간에는 밤 종이)</option>
                <option value="paper">종이</option>
                <option value="night">밤 종이</option>
              </SelectControl>
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.layout.showRibbon} onChange={(e) => setDraft({ ...draft, layout: { ...draft.layout, showRibbon: e.target.checked } })} />
              시간대 분포 막대 보이기
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.privacyBlur} onChange={(e) => setDraft({ ...draft, privacyBlur: e.target.checked })} />
              공용 화면용 이름 가림(첫 글자와 이모지만)
            </label>
            <label className="check">
              <input type="checkbox" checked={!!draft.nightDim} onChange={(e) => setDraft({ ...draft, nightDim: e.target.checked ? { from: '23:00', to: '07:00' } : null })} />
              야간 감광
            </label>
            {draft.nightDim && (
              <div className="flex items-center gap-3">
                <input type="time" className="input num" aria-label="감광 시작" value={draft.nightDim.from} onChange={(e) => setDraft({ ...draft, nightDim: { ...draft.nightDim!, from: e.target.value } })} />
                <span>~</span>
                <input type="time" className="input num" aria-label="감광 끝" value={draft.nightDim.to} onChange={(e) => setDraft({ ...draft, nightDim: { ...draft.nightDim!, to: e.target.value } })} />
              </div>
            )}
            {save.error && <p className="text-[13px] text-over-ink">{errorText(save.error)}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
