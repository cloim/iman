import { clipSession, concurrentIntervals, formatDuration, overlapLength, unionIntervals, type Interval, type UsageSession } from '@iman/core'
import type { ScriptableContext, TooltipItem } from 'chart.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart } from 'react-chartjs-2'
import { APP_PALETTE, hideHtmlTooltip, htmlTooltip, useChartColors } from '../../lib/chart'
import type { AppInfo } from '../../lib/types'

const SLOT_MS = 15 * 60_000
const LANES = 5
/** 정사각형 칸 한 변과 칸 사이 간격(px). 한 줄은 하루 96칸이라 화면보다 넓으면 가로로 스크롤한다 */
const CELL = 15
const GAP = 3
const PITCH = CELL + GAP
const ROW = PITCH

interface Cell {
  x: number
  y: number
  /** 그 칸에서 쓴 시간(ms) */
  v: number
  concurrentMs: number
  partners: string[]
  devices: string[]
  resting: boolean
}

const fmtTime = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)

/**
 * 타임라인 히트맵: 맨 윗줄은 실제 사용(합집합), 아래는 많이 쓴 앱별 줄.
 * 하루를 15분 칸으로 나눠 쓴 만큼 진하게 칠하고, 앱을 동시에 띄운 칸은 하늘색 테두리로 표시한다.
 */
export function TimelineHeatmap({
  sessions,
  apps,
  devices,
  dayStart,
  dayEnd,
  now,
  timeZone,
  rests = [],
}: {
  sessions: UsageSession[]
  apps: Record<string, AppInfo>
  devices: { id: string; name: string }[]
  dayStart: number
  dayEnd: number
  now: number
  timeZone: string
  rests?: Interval[]
}) {
  const c = useChartColors()
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // 오늘은 지금 시각이 든 칸까지만 그린다. 지난 날은 하루 전체
  const slots = Math.max(1, Math.ceil((Math.min(dayEnd, now) - dayStart) / SLOT_MS))
  const label = (p: string) => apps[p]?.label ?? p.split('.').pop() ?? p

  const { rows, cells } = useMemo(() => {
    const w = { from: dayStart, to: dayEnd, now }
    const segs: { iv: Interval; pkg: string; device: string }[] = []
    for (const s of sessions) {
      const iv = clipSession(s, w)
      if (iv) segs.push({ iv, pkg: s.packageName, device: s.deviceId })
    }
    const totals = new Map<string, number>()
    for (const s of segs) totals.set(s.pkg, (totals.get(s.pkg) ?? 0) + s.iv[1] - s.iv[0])
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
    const lanes = ranked.slice(0, LANES)
    const laneOf = (p: string) => (lanes.includes(p) ? lanes.indexOf(p) + 1 : lanes.length + 1)
    const rows = ['실제 사용', ...lanes.map(label), ...(ranked.length > LANES ? ['기타'] : [])]

    const concurrent = concurrentIntervals(segs.map((s) => s.iv))
    const devName = new Map(devices.map((d) => [d.id, d.name]))
    const cells: Cell[] = []
    for (let r = 0; r < rows.length; r++) {
      const mine = r === 0 ? segs : segs.filter((s) => laneOf(s.pkg) === r)
      const union = unionIntervals(mine.map((s) => s.iv))
      const busy = unionIntervals(concurrent.flatMap(([cs, ce]) => union.map(([s, e]) => [Math.max(s, cs), Math.min(e, ce)] as Interval).filter(([s, e]) => e > s)))
      for (let i = 0; i < slots; i++) {
        const slot: Interval = [dayStart + i * SLOT_MS, Math.min(dayEnd, dayStart + (i + 1) * SLOT_MS)]
        const v = overlapLength(union, [slot])
        const concurrentMs = overlapLength(busy, [slot])
        const inSlot = mine.filter((s) => s.iv[0] < slot[1] && s.iv[1] > slot[0])
        // 같은 칸에서 이 줄의 사용과 실제로 겹친 다른 앱
        const partners = new Set<string>()
        if (concurrentMs > 0)
          for (const a of inSlot)
            for (const b of segs)
              if (b !== a && b.pkg !== a.pkg && Math.max(a.iv[0], b.iv[0], slot[0]) < Math.min(a.iv[1], b.iv[1], slot[1])) partners.add(label(b.pkg))
        cells.push({
          x: i,
          y: r,
          v,
          concurrentMs,
          partners: r === 0 ? [] : [...partners],
          devices: [...new Set(inSlot.map((s) => devName.get(s.device) ?? '기기'))],
          resting: overlapLength(rests, [slot]) > 0,
        })
      }
    }
    return { rows, cells }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, apps, devices, dayStart, dayEnd, now, rests, slots])

  // 다른 날짜나 화면으로 넘어가 차트가 사라지면 떠 있던 툴팁도 숨긴다
  useEffect(() => hideHtmlTooltip, [])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [cells.length > 0])

  const W = slots * PITCH
  const scrollable = W > width + 1
  // 처음 그릴 때 한 번만 지금 시각(지난 날은 마지막 사용)을 가운데로. 1분마다 새로 고쳐도 보던 위치는 그대로 둔다
  const scrolledFor = useRef<number | null>(null)
  const lastUse = Math.max(dayStart, ...cells.filter((x) => x.v > 0).map((x) => dayStart + (x.x + 1) * SLOT_MS))
  useEffect(() => {
    const el = scroller.current
    if (!el || !width || !scrollable || scrolledFor.current === dayStart) return
    scrolledFor.current = dayStart
    const focus = Math.min(now, dayEnd, lastUse)
    el.scrollLeft = Math.max(0, ((focus - dayStart) / (dayEnd - dayStart)) * W - el.clientWidth / 2)
  }, [scrollable, width, W, now, dayStart, dayEnd, lastUse])

  if (!cells.some((x) => x.v > 0)) {
    return (
      <div className="py-6 text-center text-ink-3">
        <p>아직 기록된 사용 구간이 없어요.</p>
      </div>
    )
  }

  const colorOf = (r: number) => (r === 0 ? c.ink : APP_PALETTE[(r - 1) % APP_PALETTE.length]!)
  const fill = (ctx: ScriptableContext<'matrix'>) => {
    const d = ctx.raw as Cell
    if (d.v === 0) return d.resting && d.y === 0 ? c['comma-tint'] : c['surface-2']
    const strength = 0.3 + 0.7 * Math.min(1, d.v / SLOT_MS)
    return `color-mix(in srgb, ${colorOf(d.y)} ${Math.round(strength * 100)}%, ${c.surface})`
  }
  const H = rows.length * ROW
  const hourMarks = Array.from({ length: Math.floor(slots / 4) + 1 }, (_, h) => h).filter((h) => h < 24 || h * 4 <= slots)

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-[3px] bg-[color-mix(in_srgb,var(--comma-deep)_35%,var(--surface))]" />
          <span className="size-2.5 rounded-[3px] bg-comma-deep" /> 15분 중 쓴 만큼 진하게
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-[3px] bg-surface-2 shadow-[inset_0_0_0_2px_var(--now)]" /> 동시 실행
        </span>
        {rests.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-[3px] bg-comma-tint" /> 쉬는 중
          </span>
        )}
      </div>
      <div className="grid grid-cols-[72px_minmax(0,1fr)]">
        <div className="pt-4">
          {rows.map((r, i) => (
            <p key={i} className="flex items-center gap-1.5 truncate pr-2 text-xs leading-none text-ink-2" style={{ height: ROW }} title={r}>
              <span className="size-2 flex-none rounded-full" style={{ background: colorOf(i) }} aria-hidden />
              <span className="truncate">{r}</span>
            </p>
          ))}
        </div>
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
          {width > 0 && (
            <div style={{ width: W }}>
              <div className="relative h-4 text-[11px] text-ink-3" aria-hidden>
                {hourMarks.map((h) => (
                  <span key={h} className="num absolute top-0 -translate-x-1/2 font-semibold" style={{ left: Math.min(W - 8, Math.max(6, h * 4 * PITCH)) }}>
                    {h}
                  </span>
                ))}
              </div>
              <div style={{ height: H }} role="img" aria-label={`하루 ${rows.length - 1}개 앱의 15분 단위 사용 히트맵`}>
                <Chart
                  type="matrix"
                  data={{
                    datasets: [
                      {
                        data: cells,
                        backgroundColor: fill,
                        borderColor: (ctx) => ((ctx.raw as Cell).concurrentMs > 0 ? c.now : 'transparent'),
                        borderWidth: (ctx) => ((ctx.raw as Cell).concurrentMs > 0 ? 1.5 : 0),
                        borderRadius: 3,
                        width: CELL,
                        height: CELL,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    layout: { padding: 0 },
                    scales: {
                      x: { type: 'linear', min: -0.5, max: slots - 0.5, offset: false, display: false },
                      y: { type: 'linear', min: -0.5, max: rows.length - 0.5, reverse: true, offset: false, display: false },
                    },
                    plugins: {
                      legend: { display: false },
                      // 칸 줄이 낮고 가로로 스크롤돼 캔버스 안 툴팁은 잘리므로 문서 위 HTML 상자로 띄운다
                      tooltip: {
                        enabled: false,
                        external: htmlTooltip,
                        filter: (item: TooltipItem<'matrix'>) => (item.raw as Cell).v > 0 || (item.raw as Cell).resting,
                        callbacks: {
                          title: (items: TooltipItem<'matrix'>[]) => {
                            const d = items[0]!.raw as Cell
                            const s = dayStart + d.x * SLOT_MS
                            return `${rows[d.y]} ${fmtTime(s, timeZone)} ~ ${fmtTime(Math.min(dayEnd, s + SLOT_MS), timeZone)}`
                          },
                          label: (item: TooltipItem<'matrix'>) => {
                            const d = item.raw as Cell
                            const out = [`사용 ${formatDuration(d.v)}`]
                            if (d.concurrentMs > 0) {
                              out.push(`동시 실행 ${formatDuration(d.concurrentMs)}`)
                              if (d.partners.length) out.push(`함께 띄운 앱 ${d.partners.join(', ')}`)
                            }
                            if (devices.length > 1 && d.devices.length) out.push(`기기 ${d.devices.join(', ')}`)
                            if (d.resting) out.push('쉬는 시간 포함')
                            return out
                          },
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
