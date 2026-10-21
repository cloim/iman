import { formatDuration } from '@iman/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { BarActions, useAppBar } from '../components/AppShell'
import { CommaStamp } from '../components/brand/Comma'
import { Modal } from '../components/Modal'
import SelectControl from '../components/SelectControl'
import { api, errorText } from '../lib/api'
import { useToday } from '../lib/queries'
import { CATEGORY_LABEL, type GoalDto } from '../lib/types'

const TYPE_LABEL: Record<GoalDto['type'], string> = {
  daily_actual: '하루 실제 사용시간',
  app_limit: '앱별 한도',
  category_limit: '카테고리별 한도',
  quiet_hours: '쉬는 시간대',
  pickups: '화면 켜는 횟수',
}
const DAYS = ['월', '화', '수', '목', '금', '토', '일']

type Draft = Omit<GoalDto, 'id'> & { id?: string }

const blank = (): Draft => ({
  type: 'daily_actual',
  target: 180,
  scopeRef: null,
  daysOfWeek: 127,
  quietFrom: '22:00',
  quietTo: '07:00',
  nudge: { enabled: true, near: true, tone: 'warm' },
  active: true,
})

function describe(g: GoalDto) {
  switch (g.type) {
    case 'pickups':
      return `하루 ${g.target}번 이하`
    case 'quiet_hours':
      return `${g.quietFrom} ~ ${g.quietTo}에는 ${g.target ? `${g.target}분 이하` : '쓰지 않기'}`
    default:
      return `하루 ${formatDuration(g.target * 60_000)} 이하`
  }
}

function GoalForm({ draft, setDraft, apps }: { draft: Draft; setDraft: (d: Draft) => void; apps: [string, string][] }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v })
  const isMinutes = draft.type !== 'pickups'
  return (
    <div className="grid gap-4">
      <label className="field">
        <span>목표 종류</span>
        <SelectControl value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft['type'], scopeRef: null, target: e.target.value === 'quiet_hours' ? 0 : e.target.value === 'pickups' ? 60 : draft.target })}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectControl>
      </label>

      {draft.type === 'app_limit' && (
        <label className="field">
          <span>앱</span>
          <SelectControl value={draft.scopeRef ?? ''} onChange={(e) => set('scopeRef', e.target.value || null)}>
            <option value="">앱을 골라 주세요</option>
            {apps.map(([pkg, label]) => (
              <option key={pkg} value={pkg}>
                {label}
              </option>
            ))}
          </SelectControl>
          {apps.length === 0 && <span className="text-[13px] text-ink-3">최근에 쓴 앱이 여기에 나타나요.</span>}
        </label>
      )}
      {draft.type === 'category_limit' && (
        <label className="field">
          <span>카테고리</span>
          <SelectControl value={draft.scopeRef ?? ''} onChange={(e) => set('scopeRef', e.target.value || null)}>
            <option value="">카테고리를 골라 주세요</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectControl>
        </label>
      )}
      {draft.type === 'quiet_hours' && (
        <div className="flex items-center gap-3">
          <label className="field flex-1">
            <span>시작</span>
            <input type="time" className="input num" value={draft.quietFrom ?? ''} onChange={(e) => set('quietFrom', e.target.value)} />
          </label>
          <label className="field flex-1">
            <span>끝</span>
            <input type="time" className="input num" value={draft.quietTo ?? ''} onChange={(e) => set('quietTo', e.target.value)} />
          </label>
        </div>
      )}

      <label className="field">
        <span>{draft.type === 'quiet_hours' ? '그 시간에 허용할 사용(분)' : isMinutes ? '한도(분)' : '한도(번)'}</span>
        <input type="number" className="input num" min={0} max={1440} value={draft.target} onChange={(e) => set('target', Number(e.target.value))} />
        {isMinutes && draft.type !== 'quiet_hours' && <span className="text-[13px] text-ink-3">{formatDuration(draft.target * 60_000)}</span>}
      </label>

      <div className="field">
        <span>적용 요일</span>
        <div className="grid grid-cols-7 gap-1 [&_button]:min-h-10 [&_button]:cursor-pointer [&_button]:rounded-xl [&_button]:border-0 [&_button]:bg-surface-2 [&_button]:font-bold [&_button]:text-ink-3 [&_button[aria-pressed=true]]:bg-comma-tint [&_button[aria-pressed=true]]:text-comma-deep" role="group" aria-label="적용 요일">
          {DAYS.map((d, i) => {
            const on = (draft.daysOfWeek & (1 << i)) !== 0
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = draft.daysOfWeek ^ (1 << i)
                  if (next) set('daysOfWeek', next)
                }}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>

      <fieldset className="m-0 grid gap-2.5 rounded-panel border-0 bg-surface-2 p-3.5 [&_legend]:float-left [&_legend]:mb-1 [&_legend]:font-bold">
        <legend>넛지 알림</legend>
        <label className="check">
          <input type="checkbox" checked={draft.nudge.enabled} onChange={(e) => set('nudge', { ...draft.nudge, enabled: e.target.checked })} />
          목표에 닿으면 알려 주기
        </label>
        <label className="check">
          <input type="checkbox" disabled={!draft.nudge.enabled} checked={draft.nudge.near} onChange={(e) => set('nudge', { ...draft.nudge, near: e.target.checked })} />
          80%에 가까워질 때도 미리 알려 주기
        </label>
        <div className="segmented" role="group" aria-label="문구 톤">
          <button type="button" aria-pressed={draft.nudge.tone === 'warm'} onClick={() => set('nudge', { ...draft.nudge, tone: 'warm' })}>
            다정하게
          </button>
          <button type="button" aria-pressed={draft.nudge.tone === 'plain'} onClick={() => set('nudge', { ...draft.nudge, tone: 'plain' })}>
            담백하게
          </button>
        </div>
      </fieldset>
    </div>
  )
}

export default function GoalsPage() {
  useAppBar('목표')
  const qc = useQueryClient()
  const today = useToday()
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api<{ goals: GoalDto[] }>('/api/me/goals') })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id ? api(`/api/me/goals/${d.id}`, { method: 'PUT', body: d }) : api('/api/me/goals', { method: 'POST', body: d }),
    onSuccess: () => {
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['goals'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/me/goals/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDraft(null)
      setConfirmDelete(false)
      void qc.invalidateQueries({ queryKey: ['goals'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
  })

  const evalOf = (id: string) => today.data?.goals.find((g) => g.id === id)
  const apps = Object.entries(today.data?.apps ?? {}).map(([k, v]) => [k, v.label] as [string, string])
  const invalid = !!draft && ((draft.type === 'app_limit' || draft.type === 'category_limit') && !draft.scopeRef)

  return (
    <div className="grid gap-4">
      <BarActions>
        <button type="button" className="icon-btn" aria-label="목표 추가" title="목표 추가" onClick={() => setDraft(blank())}>
          <Plus size={22} aria-hidden />
        </button>
      </BarActions>

      {goals.isPending ? (
        [0, 1].map((i) => <div key={i} className="skeleton h-[88px] rounded-[24px]" />)
      ) : goals.data?.goals.length === 0 ? (
        <div className="card empty">
          <CommaStamp variant="empty" size={40} />
          <p>아직 목표가 없어요. 하루 실제 사용시간 목표부터 정해 볼까요?</p>
          <button type="button" className="btn btn-comma" onClick={() => setDraft(blank())}>
            첫 목표 만들기
          </button>
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {goals.data?.goals.map((g) => {
            const ev = evalOf(g.id)
            const status = ev?.evaluation.status ?? 'met'
            return (
              <li key={g.id} className={`card grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 ${g.active ? '' : 'opacity-55'}`}>
                <CommaStamp variant={!ev?.activeToday ? 'empty' : status === 'over' ? 'outline' : status === 'near' ? 'half' : 'full'} size={30} />
                <div className="grid justify-items-start gap-1">
                  <strong>
                    {TYPE_LABEL[g.type]}
                    {g.scopeRef && <span className="text-[13px] text-ink-3"> {g.type === 'category_limit' ? CATEGORY_LABEL[g.scopeRef] : (today.data?.apps[g.scopeRef]?.label ?? g.scopeRef)}</span>}
                  </strong>
                  <span className="text-ink-3">
                    {describe(g)}
                    {g.daysOfWeek !== 127 && `, ${DAYS.filter((_, i) => g.daysOfWeek & (1 << i)).join('')}`}
                  </span>
                  {ev?.activeToday && (
                    <span className={`chip chip-${status}`}>
                      오늘 {g.type === 'pickups' ? `${ev.evaluation.value}번` : formatDuration(ev.evaluation.value)}
                    </span>
                  )}
                </div>
                <button type="button" className="icon-btn" aria-label="목표 수정" onClick={() => setDraft({ ...g })}>
                  <Pencil size={18} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Modal
        isOpen={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? '목표 수정' : '새 목표'}
        size="md"
        footer={
          <>
            {draft?.id && (
              <button type="button" className="btn btn-danger btn-sm mr-auto" onClick={() => setConfirmDelete(true)}>
                삭제
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              취소
            </button>
            <button type="button" className="btn btn-sm" disabled={invalid || save.isPending} onClick={() => draft && save.mutate(draft)}>
              저장
            </button>
          </>
        }
      >
        {draft && <GoalForm draft={draft} setDraft={setDraft} apps={apps} />}
        {save.error && <p className="text-[13px] text-over-ink">{errorText(save.error)}</p>}
      </Modal>

      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="목표를 삭제할까요?"
        size="sm"
        draggable={false}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
              취소
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => draft?.id && remove.mutate(draft.id)}>
              삭제
            </button>
          </>
        }
      >
        <p>지난 달성 기록도 함께 지워져요.</p>
      </Modal>
    </div>
  )
}
