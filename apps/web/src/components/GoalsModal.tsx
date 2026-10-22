import { formatDuration } from '@iman/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { availableGoalDays, hasOverlappingGoals } from '../lib/goalSchedules'
import { CATEGORY_LABEL, type GoalDto, type Today } from '../lib/types'
import { Modal } from './Modal'
import SelectControl from './SelectControl'

type GoalType = GoalDto['type']
type Draft = Omit<GoalDto, 'id'> & { id?: string; key: string }

const TABS: { type: GoalType; label: string; hint: string }[] = [
  { type: 'daily_actual', label: '하루 사용', hint: '동시 실행을 한 번만 센 하루 실제 사용시간의 한도예요.' },
  { type: 'app_limit', label: '앱별', hint: '앱마다 하루에 쓸 시간을 정해요.' },
  { type: 'category_limit', label: '카테고리별', hint: '영상, SNS 같은 카테고리마다 하루 한도를 정해요.' },
]
const MULTI: GoalType[] = ['app_limit', 'category_limit']
const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const DEFAULT_TARGET: Record<GoalType, number> = { daily_actual: 180, app_limit: 60, category_limit: 60 }

let seq = 0
const blank = (type: GoalType): Draft => ({
  key: `new${++seq}`,
  type,
  target: DEFAULT_TARGET[type],
  scopeRef: null,
  daysOfWeek: 127,
  nudge: { enabled: true, near: true, tone: 'warm' },
  active: true,
})
const body = ({ key: _k, id: _i, ...g }: Draft) => g
const same = (a: Draft, b: GoalDto) => JSON.stringify(body(a)) === JSON.stringify(body({ ...b, key: '' }))

function Minutes({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" className="input num" min={0} max={1440} step={10} value={value} onChange={(e) => onChange(Math.max(0, Math.min(1440, Number(e.target.value))))} />
      <span className="text-[13px] text-ink-3">{value > 0 ? formatDuration(value * 60_000) : '쓰지 않기'}</span>
    </label>
  )
}

function Days({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <span>적용 요일</span>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="적용 요일">
        {DAYS.map((d, i) => (
          <button
            key={d}
            type="button"
            aria-pressed={(value & (1 << i)) !== 0}
            className="min-h-10 cursor-pointer rounded-xl border-0 bg-surface-2 font-bold text-ink-3 aria-pressed:bg-comma-tint aria-pressed:text-comma-deep"
            onClick={() => {
              const next = value ^ (1 << i)
              if (next) onChange(next)
            }}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  )
}

function Nudge({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const n = draft.nudge
  return (
    <fieldset className="m-0 grid gap-2.5 rounded-panel border-0 bg-surface-2 p-3.5">
      <legend className="float-left mb-1 font-bold">넛지 알림</legend>
      <label className="check">
        <input type="checkbox" checked={n.enabled} onChange={(e) => set({ ...draft, nudge: { ...n, enabled: e.target.checked } })} />
        목표에 닿으면 알려 주기
      </label>
      <label className="check">
        <input type="checkbox" disabled={!n.enabled} checked={n.near} onChange={(e) => set({ ...draft, nudge: { ...n, near: e.target.checked } })} />
        80%에 가까워질 때도 미리 알려 주기
      </label>
      <div className="segmented justify-self-start" role="group" aria-label="문구 톤">
        <button type="button" aria-pressed={n.tone === 'warm'} onClick={() => set({ ...draft, nudge: { ...n, tone: 'warm' } })}>
          다정하게
        </button>
        <button type="button" aria-pressed={n.tone === 'plain'} onClick={() => set({ ...draft, nudge: { ...n, tone: 'plain' } })}>
          담백하게
        </button>
      </div>
    </fieldset>
  )
}

/**
 * 내 목표: 종류별 탭에서 여러 목표를 한꺼번에 고치고 저장 한 번으로 반영한다.
 * 같은 종류와 대상도 요일 묶음을 나누어 서로 다른 한도와 알림을 둘 수 있다.
 */
export function GoalsModal({ isOpen, onClose, today }: { isOpen: boolean; onClose: () => void; today?: Today }) {
  const qc = useQueryClient()
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api<{ goals: GoalDto[] }>('/api/me/goals'), enabled: isOpen })
  const [tab, setTab] = useState<GoalType>('daily_actual')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !goals.data) return
    setDrafts(goals.data.goals.map((g) => ({ ...g, key: g.id })))
    setError('')
  }, [isOpen, goals.data])

  const original = goals.data?.goals ?? []
  const ofType = (t: GoalType) => drafts.filter((d) => d.type === t)
  const update = (d: Draft) => setDrafts((all) => all.map((x) => (x.key === d.key ? d : x)))
  const isOn = (t: GoalType) => ofType(t).some((d) => d.active && (!MULTI.includes(t) || d.scopeRef))
  const apps = Object.entries(today?.apps ?? {}).map(([k, v]) => [k, v.label] as const)
  const overlapping = hasOverlappingGoals(drafts)
  const invalid = overlapping || drafts.some((d) =>
    (MULTI.includes(d.type) && !d.scopeRef) || !Number.isInteger(d.target) ||
    d.target < 0 || d.target > 1440,
  )
  const dirty = drafts.length !== original.length || drafts.some((d) => !d.id || !same(d, original.find((g) => g.id === d.id)!))

  const save = async () => {
    if (invalid || saving) return
    setSaving(true)
    setError('')
    try {
      for (const g of original) if (!drafts.some((d) => d.id === g.id)) await api(`/api/me/goals/${g.id}`, { method: 'DELETE' })
      for (const d of drafts) {
        if (!d.id) await api('/api/me/goals', { method: 'POST', body: body(d) })
        else if (!same(d, original.find((g) => g.id === d.id)!)) await api(`/api/me/goals/${d.id}`, { method: 'PUT', body: body(d) })
      }
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
      void qc.invalidateQueries({ queryKey: ['goals'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
      void qc.invalidateQueries({ queryKey: ['days'] })
      void qc.invalidateQueries({ queryKey: ['board'] })
    }
  }

  const schedule = (t: GoalType, d: Draft) => {
    const on = d.active
    return (
      <div key={d.key} className="grid gap-4 rounded-panel border border-line p-3.5">
        <div className="flex items-center justify-between gap-2">
          <label className="check font-semibold">
            <input type="checkbox" checked={on} onChange={(e) => update({ ...d, active: e.target.checked })} />
            이 요일 설정 쓰기
          </label>
          <button type="button" className="icon-btn text-over-ink hover:bg-over/10" aria-label="이 요일 설정 지우기" onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}>
            <Trash2 size={18} aria-hidden />
          </button>
        </div>
        {on && (
          <>
            <Minutes label="하루 한도(분)" value={d.target} onChange={(v) => update({ ...d, target: v })} />
            <Days value={d.daysOfWeek} onChange={(v) => update({ ...d, daysOfWeek: v })} />
            <Nudge draft={d} set={update} />
          </>
        )}
      </div>
    )
  }

  const single = (t: GoalType) => {
    const list = ofType(t)
    const remaining = availableGoalDays(list)
    return (
      <div className="grid gap-3">
        {list.length === 0 && <p className="text-ink-3">아직 정한 목표가 없어요.</p>}
        {list.map((d) => schedule(t, d))}
        <button type="button" className="btn btn-ghost btn-sm justify-self-start" disabled={!remaining} onClick={() => setDrafts((all) => [...all, { ...blank(t), daysOfWeek: remaining }])}>
          <Plus size={16} aria-hidden /> 요일 설정 추가
        </button>
        <p className="text-[13px] text-ink-3">요일을 나누면 한도와 알림을 다르게 정할 수 있어요.</p>
      </div>
    )
  }

  const multi = (t: GoalType) => {
    const list = ofType(t)
    const options = t === 'app_limit' ? apps : (Object.entries(CATEGORY_LABEL) as [string, string][])
    return (
      <div className="grid gap-3">
        {list.length === 0 && <p className="text-ink-3">아직 정한 한도가 없어요.</p>}
        {list.map((d) => (
          <div key={d.key} className="grid gap-4 rounded-panel border border-line p-3.5">
          <div className="grid grid-cols-[minmax(0,1fr)_80px_auto] items-end gap-2">
            <label className="field">
              <span>{t === 'app_limit' ? '앱' : '카테고리'}</span>
              <SelectControl value={d.scopeRef ?? ''} onChange={(e) => update({ ...d, scopeRef: e.target.value || null })}>
                <option value="">골라 주세요</option>
                {options
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                {d.scopeRef && !options.some(([k]) => k === d.scopeRef) && <option value={d.scopeRef}>{d.scopeRef}</option>}
              </SelectControl>
            </label>
            <label className="field">
              <span>한도(분)</span>
              <input type="number" className="input num" min={0} max={1440} step={10} value={d.target} onChange={(e) => update({ ...d, target: Number(e.target.value) })} />
            </label>
            <button type="button" className="icon-btn mb-0.5 text-over-ink hover:bg-over/10" aria-label="이 한도 지우기" onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}>
              <Trash2 size={18} aria-hidden />
            </button>
          </div>
          <Days value={d.daysOfWeek} onChange={(v) => update({ ...d, daysOfWeek: v })} />
          <Nudge draft={d} set={update} />
          </div>
        ))}
        {t === 'app_limit' && apps.length === 0 && <p className="text-[13px] text-ink-3">오늘 쓴 앱이 여기에 나타나요.</p>}
        <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => setDrafts((all) => [...all, blank(t)])}>
          <Plus size={16} aria-hidden /> 한도 추가
        </button>
      </div>
    )
  }

  const current = TABS.find((x) => x.type === tab)!
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="내 목표"
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-sm" disabled={goals.isPending || goals.isError || invalid || !dirty || saving} onClick={save}>
            {saving ? '저장하는 중' : '저장'}
          </button>
        </>
      }
    >
      {/* 탭마다 내용 길이가 달라도 모달이 출렁이지 않게 최소 높이를 둔다 */}
      <div className="grid min-h-[440px] content-start gap-4">
        <div className="tabs" role="tablist" aria-label="목표 종류">
          {TABS.map((x) => (
            <button
              key={x.type}
              type="button"
              role="tab"
              aria-selected={tab === x.type}
              className="tab"
              onClick={() => setTab(x.type)}
            >
              {x.label}
              {isOn(x.type) && <span className="size-1.5 rounded-full bg-comma" aria-label="사용 중" />}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-ink-3">{current.hint}</p>
        {goals.isPending ? <div className="skeleton h-[180px]" /> : MULTI.includes(tab) ? multi(tab) : single(tab)}
        {overlapping && <p className="text-[13px] text-over-ink" role="alert">같은 목표의 적용 요일이 겹쳐요. 요일을 나누어 주세요.</p>}
        {goals.isError && <p className="text-[13px] text-over-ink" role="alert">목표를 불러오지 못했어요. 창을 다시 열어 주세요.</p>}
        {error && (
          <p className="text-[13px] text-over-ink" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
