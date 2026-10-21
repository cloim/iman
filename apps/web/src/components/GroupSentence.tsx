import { formatDuration } from '@iman/core'
import { CommaGauge, type CommaStatus } from './brand/Comma'
import { CATEGORY_LABEL, type BoardMember } from '../lib/types'

const BASELINE_MIN = 240

function hourSpark(byHour: number[]) {
  const max = Math.max(1, ...byHour)
  return byHour.map((v, i) => (
    <span key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} className={`flex-1 rounded-[1px] ${v ? 'bg-comma' : 'bg-line'}`} />
  ))
}

/**
 * 그룹 문장: 구성원 이름이 단어처럼 나열되고 이름 뒤에 각자의 쉼표 게이지가 붙는다.
 * 쉬는 사람은 쉼표가 고요히 서 있고, 사용 중인 사람은 하늘색 점이 맥박처럼 뛴다.
 */
export function GroupSentence({
  members,
  metric,
  size = 'md',
  showHours = true,
  pauseParticipants = [],
}: {
  members: BoardMember[]
  metric: 'actual' | 'total'
  size?: 'md' | 'lg'
  showHours?: boolean
  pauseParticipants?: string[]
}) {
  const lg = size === 'lg'
  return (
    <ol className={`m-0 flex list-none flex-wrap items-start p-0 ${lg ? 'justify-center gap-x-5 gap-y-7' : 'gap-x-3 gap-y-[18px]'}`} aria-label="구성원 현황">
      {members.map((m) => {
        const target = m.goal?.targetMin ?? BASELINE_MIN
        const status: CommaStatus = m.goal ? m.goal.status : 'none'
        const value = metric === 'actual' ? m.actualMs : m.totalMs
        const inPause = pauseParticipants.includes(m.userId)
        const live = m.activeNow && !inPause
        const state = inPause ? '함께 쉬는 중' : m.resting ? '쉬는 중' : m.activeNow ? '지금 사용 중' : '쉬는 중'
        const small = lg ? 'text-sm' : 'text-xs'
        return (
          <li
            key={m.userId}
            className={`grid justify-items-center gap-1 rounded-card text-center ${live ? 'shadow-[0_0_0_2px_var(--now)]' : 'shadow-[0_0_0_1px_var(--line)]'} ${
              lg ? 'w-[196px] bg-surface/80 px-4 pt-[22px] pb-[18px]' : 'w-[calc(50%-6px)] bg-surface px-2.5 pt-3.5 pb-3 sm:w-[136px]'
            }`}
          >
            <div className="flex max-w-full items-center gap-1.5">
              {m.avatarUrl ? (
                <img src={m.avatarUrl} alt="" className="size-6 flex-none rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="grid size-6 flex-none place-items-center rounded-full bg-comma-tint text-[13px] font-bold text-comma-deep">{Array.from(m.name)[0]}</span>
              )}
              <span className={`truncate font-display ${lg ? 'text-2xl' : 'text-[17px]'}`}>{m.name}</span>
            </div>
            <CommaGauge ratio={m.actualMs / (target * 60_000)} status={status} active={live} size={lg ? 96 : 64} label={`${m.name} 실제 사용 ${formatDuration(m.actualMs)}`} />
            <p className={`num leading-[1.1] ${lg ? 'text-3xl' : 'text-xl'}`}>{formatDuration(value)}</p>
            <p className={`${small} font-semibold ${live ? 'text-[#3a86b5]' : 'text-comma-deep'}`}>{state}</p>
            {m.goal && <p className={`${small} text-ink-3`}>목표 {formatDuration(m.goal.targetMin * 60_000)}</p>}
            {showHours && m.byHour.length > 0 && (
              <div className="mt-1 flex h-[22px] w-full items-end gap-px" aria-hidden>
                {hourSpark(m.byHour)}
              </div>
            )}
            {(m.apps ?? m.categories)?.slice(0, 3).map((x) => (
              <p key={x.key} className={`flex w-full justify-between gap-1.5 ${small} text-ink-2`}>
                <span className="truncate">{m.apps ? x.label : (CATEGORY_LABEL[x.key] ?? x.key)}</span>
                <span className="num">{formatDuration(x.actualMs)}</span>
              </p>
            ))}
          </li>
        )
      })}
    </ol>
  )
}
