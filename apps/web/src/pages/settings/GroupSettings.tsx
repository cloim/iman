import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import SelectControl from '../../components/SelectControl'
import { api, errorText } from '../../lib/api'
import { useMe } from '../../lib/queries'
import { APP_LEVEL_NOTE, VISIBILITY_HINT, VISIBILITY_LABEL, type Visibility } from '../../lib/types'

const WEEK = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']
const EMOJIS = ['🌿', '🏡', '☕', '📚', '🌙', '🐾', '🌊', '🍀']

/** 설정 > 그룹 탭의 관리자 전용 그룹 설정 */
export function GroupSettings({ children }: { children?: ReactNode }) {
  const me = useMe()
  const qc = useQueryClient()
  const g = me.data?.group
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🌿')
  const [weekStart, setWeekStart] = useState(0)
  const [visibility, setVisibility] = useState<Visibility>('category')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!g) return
    setName(g.name)
    setEmoji(g.emoji)
    setWeekStart(g.weekStart)
    setVisibility(g.visibility)
  }, [g])

  const save = useMutation({
    mutationFn: () => api('/api/group', { method: 'PATCH', body: { name, emoji, weekStart, visibility } }),
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['board'] })
    },
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <section className="card grid gap-4">
        <h2 className="text-lg">그룹 설정</h2>
        <label className="field">
          <span>그룹 이름</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
        </label>
        <div className="field">
          <span>그룹 표시</span>
          <div className="flex items-center gap-3 flex-wrap" role="radiogroup" aria-label="그룹 표시 이모지">
            {EMOJIS.map((em) => (
              <button key={em} type="button" role="radio" aria-checked={emoji === em} className="emoji-pick" onClick={() => setEmoji(em)}>
                {em}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>한 주의 시작</span>
          <SelectControl value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))}>
            {WEEK.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </SelectControl>
          <span className="text-[13px] text-ink-3">주간 쉼표 리포트가 이 요일 아침에 도착해요.</span>
        </label>
      </section>

      <section className="card grid gap-4">
        <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">공개 수준</h2>
        <p className="text-[13px] text-ink-3 -mt-2">
          그룹 구성원과 대시보드에 보이는 범위를 정해요. 구성원은 이 값을 바꿀 수 없고, 초대 수락 화면과 설정 화면에서 확인할 수 있어요. 구성원별 예외는 구성원 화면에서 정해요. {APP_LEVEL_NOTE}
        </p>
        <div className="grid gap-2.5" role="radiogroup" aria-label="공개 수준">
          {(['summary', 'category', 'app'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={visibility === v} className="option-card" onClick={() => setVisibility(v)}>
              <strong>{VISIBILITY_LABEL[v]}</strong>
              <span>{VISIBILITY_HINT[v]}</span>
            </button>
          ))}
        </div>
      </section>

      {save.error && <p className="text-[13px] text-over-ink">{errorText(save.error)}</p>}
      {/* 저장과 그룹 삭제를 한 줄에 같은 크기로 */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={save.isPending}>
          {saved ? '저장했어요' : '저장'}
        </button>
        {children}
      </div>
    </form>
  )
}
