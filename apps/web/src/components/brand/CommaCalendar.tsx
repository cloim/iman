import { addDays, formatDuration, parseLocalDate, weekdayOf } from '@iman/core'
import { CommaStamp } from './Comma'

export interface CalendarDay {
  actualMs: number
  /** 그날 적용된 하루 목표(분). 없으면 기준 4시간으로 채운다 */
  targetMin: number | null
  status: 'met' | 'near' | 'over' | null
  rests: number
}

const BASELINE_MIN = 240

const WEEK = ['월', '화', '수', '목', '금', '토', '일']

/**
 * 쉼표 캘린더: 날마다 쉼표 도장을 찍는다.
 * 도장은 목표 대비 사용량만큼 채워지고 넘긴 날은 넘긴 시간만큼 붉어진다.
 * 도장 크기는 그날 실제 사용시간에 비례하고, 연속 달성은 쉼표가 이어진 문장처럼 밑줄로 연결된다.
 */
export function CommaCalendar({
  month,
  days,
  today,
  selected,
  onSelect,
}: {
  month: string
  days: Record<string, CalendarDay>
  today: string
  selected?: string
  onSelect?: (date: string) => void
}) {
  const [y, m] = parseLocalDate(`${month}-01`)
  const first = `${month}-01`
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = weekdayOf(first)
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => addDays(first, i))]
  while (cells.length % 7) cells.push(null)
  const max = Math.max(1, ...Object.values(days).map((d) => d.actualMs))

  const metStreak = (d: string | null) => !!d && (days[d]?.status === 'met' || days[d]?.status === 'near')

  return (
    <div className="grid grid-cols-7 gap-y-1" role="grid" aria-label={`${y}년 ${m}월 쉼표 캘린더`}>
      {WEEK.map((w) => (
        <div key={w} className="pb-1 text-center text-xs font-semibold text-ink-3" role="columnheader">
          {w}
        </div>
      ))}
      {cells.map((d, i) => {
        if (!d) return <div key={`e${i}`} />
        const info = days[d]
        const future = d > today
        const empty = !info || future || info.actualMs === 0
        const ratio = info ? info.actualMs / ((info.targetMin ?? BASELINE_MIN) * 60_000) : 0
        const scale = info ? 0.55 + 0.45 * Math.sqrt(info.actualMs / max) : 0.55
        const linkLeft = i % 7 !== 0 && metStreak(d) && metStreak(cells[i - 1] ?? null)
        const linkRight = i % 7 !== 6 && metStreak(d) && metStreak(cells[i + 1] ?? null)
        return (
          <button
            key={d}
            type="button"
            role="gridcell"
            className={`relative grid min-h-[58px] cursor-pointer content-start justify-items-center gap-0.5 rounded-tile border-0 px-0 pt-1 pb-2 disabled:cursor-default disabled:opacity-45 ${
              d === selected ? 'bg-surface-2' : 'bg-transparent'
            }`}
            disabled={future}
            aria-label={`${Number(d.slice(8))}일 ${info ? `실제 사용 ${formatDuration(info.actualMs)}` : '기록 없음'}`}
            onClick={() => onSelect?.(d)}
          >
            <span className={`num min-w-[22px] rounded-full px-1 text-xs ${d === today ? 'bg-ink text-paper' : 'text-ink-2'}`}>{Number(d.slice(8))}</span>
            <span className="grid h-[30px] origin-bottom place-items-center" style={{ transform: `scale(${scale})` }}>
              <CommaStamp ratio={ratio} over={info?.status === 'over'} empty={empty} size={18} />
            </span>
            {(linkLeft || linkRight) && (
              <span className="absolute bottom-1 h-[3px] rounded-sm bg-comma" style={{ left: linkLeft ? 0 : '50%', right: linkRight ? 0 : '50%' }} aria-hidden />
            )}
          </button>
        )
      })}
    </div>
  )
}
