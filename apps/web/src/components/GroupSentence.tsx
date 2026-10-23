import { formatDuration } from '@iman/core'
import { Bar } from 'react-chartjs-2'
import { htmlTooltip, useChartColors, type ChartColors } from '../lib/chart'
import { CATEGORY_LABEL, type BoardMember } from '../lib/types'
import { CommaGauge } from './brand/Comma'

const BASELINE_MIN = 240
const METRIC_LABEL = { actual: '실제 사용', total: '총 사용' } as const

/** 시간대별 실제 사용 막대. 막대에 올리면 그 시간에 쓴 시간이 보인다 */
function HourBars({ byHour, c }: { byHour: number[]; c: ChartColors }) {
  // 쓰지 않은 시간도 얇은 바닥 막대로 그려 하루 24칸의 흐름이 보이게 한다
  const floor = Math.max(1, ...byHour) * 0.08
  return (
    <div className="relative h-[26px] w-full min-w-0" role="img" aria-label="시간대별 사용">
      <Bar
        data={{ labels: byHour.map((_, h) => h), datasets: [{ data: byHour.map((v) => v || floor), backgroundColor: byHour.map((v) => (v ? c.comma : `color-mix(in srgb, ${c['ink-3']} 30%, transparent)`)), borderRadius: 1, categoryPercentage: 1, barPercentage: 0.8 }] }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: false,
              external: htmlTooltip,
              callbacks: { title: (items) => `${items[0]!.dataIndex}시`, label: (item) => `실제 사용 ${formatDuration(byHour[item.dataIndex]!)}` },
            },
          },
        }}
      />
    </div>
  )
}

/**
 * 그룹 문장: 구성원 이름이 단어처럼 나열되고 이름 뒤에 각자의 쉼표 게이지가 붙는다.
 * 쉬는 사람은 쉼표가 고요히 서 있고, 사용 중인 사람은 하늘색 점이 숨 쉬듯 깜빡인다.
 * 실제 사용과 총 사용 기준은 게이지, 큰 숫자, 카테고리와 앱 목록에 함께 적용된다.
 */
export function GroupSentence({
  members,
  metric,
  size = 'md',
  showHours = true,
  pauseParticipants = [],
  baselineMin = BASELINE_MIN,
}: {
  members: BoardMember[]
  metric: 'actual' | 'total'
  size?: 'md' | 'lg'
  showHours?: boolean
  pauseParticipants?: string[]
  baselineMin?: number
}) {
  const c = useChartColors()
  const lg = size === 'lg'
  const pick = (x: { actualMs: number; totalMs: number }) => (metric === 'actual' ? x.actualMs : x.totalMs)
  return (
    <ol
      className={`m-0 list-none p-0 ${lg ? 'flex flex-wrap items-start justify-center gap-x-5 gap-y-7' : 'grid grid-cols-[repeat(auto-fill,minmax(min(200px,calc(50%-6px)),1fr))] items-start gap-3'}`}
      aria-label="구성원 현황"
    >
      {members.map((m) => {
        const target = (m.goal?.targetMin ?? baselineMin) * 60_000
        const value = pick(m)
        const inPause = pauseParticipants.includes(m.userId)
        const live = m.activeNow && !inPause
        const state = inPause ? '함께 쉬는 중' : m.resting ? '쉬는 중' : m.activeNow ? '지금 사용 중' : '쉬는 중'
        const small = lg ? 'text-sm' : 'text-xs'
        const details = [...((m.apps ?? m.categories) ?? [])].sort((a, b) => pick(b) - pick(a)).slice(0, 3)
        return (
          <li
            key={m.userId}
            className={`grid min-w-0 grid-cols-[minmax(0,1fr)] justify-items-center gap-1 rounded-card text-center ${live ? 'shadow-[0_0_0_2px_var(--now)]' : 'shadow-[0_0_0_1px_var(--line)]'} ${
              lg ? 'w-[196px] grid-rows-[24px_96px_20px_34px_20px_20px_30px_68px] bg-surface/80 px-4 py-5' : 'grid-rows-[24px_76px_16px_24px_16px_16px_30px_56px] bg-surface px-4 py-4'
            }`}
          >
            <div className="flex min-w-0 max-w-full items-center gap-1.5">
              {m.avatarUrl ? (
                <img src={m.avatarUrl} alt="" className="size-6 flex-none rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="grid size-6 flex-none place-items-center rounded-full bg-comma-tint text-[13px] font-bold text-comma-deep">{Array.from(m.name)[0]}</span>
              )}
              <span className={`truncate font-display ${lg ? 'text-2xl' : 'text-[17px]'}`}>{m.name}</span>
            </div>
            <CommaGauge
              ratio={value / target}
              active={live}
              size={lg ? 96 : 76}
              label={`${m.name} ${METRIC_LABEL[metric]} ${formatDuration(value)}`}
            />
            <p className={`${small} text-ink-3`}>{METRIC_LABEL[metric]}</p>
            <p className={`num whitespace-nowrap leading-[1.1] ${lg ? 'text-3xl' : 'text-lg'}`}>{formatDuration(value)}</p>
            <p className={`${small} font-semibold ${live ? 'text-[#3a86b5]' : 'text-comma-deep'}`}>{state}</p>
            <p className={`${small} text-ink-3`}>{m.goal ? `목표 ${formatDuration(m.goal.targetMin * 60_000)}` : '목표 없음'}</p>
            <div className="flex w-full min-w-0 items-center">
              {showHours && m.byHour.some((v) => v > 0) && <HourBars byHour={m.byHour} c={c} />}
            </div>
            <div className="grid w-full min-w-0 grid-rows-3 gap-1 self-stretch">
              {details.map((x) => (
                <p key={x.key} className={`flex min-w-0 w-full justify-between gap-1.5 ${small} text-ink-2`}>
                  <span className="min-w-0 truncate">{m.apps ? x.label : (CATEGORY_LABEL[x.key] ?? x.key)}</span>
                  <span className="num shrink-0 whitespace-nowrap">{formatDuration(pick(x))}</span>
                </p>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
