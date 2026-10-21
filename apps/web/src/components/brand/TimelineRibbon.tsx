import { clipSession, concurrentIntervals, formatDuration, unionIntervals, type Interval, type UsageSession } from '@iman/core'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo } from '../../lib/types'

const LANES = 5
const LANE_H = 18
const LANE_GAP = 8
const UNION_H = 14
const TOP = 22

interface Seg {
  start: number
  end: number
  packageName: string
  deviceId: string
  open: boolean
}

const LEGEND = 'mr-[-4px] inline-block h-2 w-[18px] rounded'
const DEVICE_LEGEND = ['bg-comma', 'bg-surface shadow-[inset_0_0_0_2px_var(--comma-deep)]', 'bg-comma-tint shadow-[inset_0_0_0_2px_var(--ink-3)]']
const SEG_DEVICE = [
  'fill-comma',
  'fill-surface stroke-comma-deep stroke-2 [stroke-dasharray:4_2]',
  'fill-comma-tint stroke-ink-3 stroke-2 [stroke-dasharray:1_3]',
]
const LANE_LABEL = 'absolute right-1.5 left-0 truncate text-xs leading-4 text-ink-2'

const fmtTime = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)

/**
 * 타임라인 리본: 24시간 축 위에 앱별 레인, 맨 위에 합집합 띠(실제 사용시간).
 * 레인끼리 겹친 시간은 하늘색 빗금으로 표시하여 총 사용시간과 실제 사용시간의 차이를 그림으로 보여 준다.
 */
export function TimelineRibbon({
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
  const [zoom, setZoom] = useState(1)
  const [picked, setPicked] = useState<{ seg: Seg; x: number; y: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [sessions.length > 0])
  const span = dayEnd - dayStart
  const W = width * zoom

  const { segs, lanes, union, concurrent } = useMemo(() => {
    const w = { from: dayStart, to: dayEnd, now }
    const segs: Seg[] = []
    for (const s of sessions) {
      const iv = clipSession(s, w)
      if (iv) segs.push({ start: iv[0], end: iv[1], packageName: s.packageName, deviceId: s.deviceId, open: s.endedAt === null })
    }
    const totals = new Map<string, number>()
    for (const s of segs) totals.set(s.packageName, (totals.get(s.packageName) ?? 0) + s.end - s.start)
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
    const lanes = ranked.slice(0, LANES)
    if (ranked.length > LANES) lanes.push('__other')
    const ivs = segs.map((s) => [s.start, s.end] as Interval)
    return { segs, lanes, union: unionIntervals(ivs), concurrent: concurrentIntervals(ivs) }
  }, [sessions, dayStart, dayEnd, now])

  const x = (t: number) => ((t - dayStart) / span) * W
  const laneOf = (p: string) => {
    const i = lanes.indexOf(p)
    return i >= 0 ? i : lanes.length - 1
  }
  const laneY = (i: number) => TOP + UNION_H + 14 + i * (LANE_H + LANE_GAP)
  const H = laneY(Math.max(lanes.length, 1)) + 4
  const deviceIndex = new Map(devices.map((d, i) => [d.id, i]))

  useEffect(() => {
    const el = scroller.current
    if (!el || zoom === 1) return
    el.scrollLeft = Math.max(0, (x(Math.min(now, dayEnd)) / W) * el.scrollWidth - el.clientWidth / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  if (segs.length === 0) {
    return (
      <div className="py-6 text-center text-ink-3">
        <p>아직 기록된 사용 구간이 없어요.</p>
      </div>
    )
  }

  const hours = Array.from({ length: 25 }, (_, h) => dayStart + h * 3_600_000).filter((t) => t <= dayEnd)
  const label = (p: string) => (p === '__other' ? '기타' : (apps[p]?.label ?? p.split('.').pop()))

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3" aria-hidden>
          <span className={`${LEGEND} bg-ink`} /> 실제 사용
          <span className={`${LEGEND} bg-[repeating-linear-gradient(45deg,var(--now)_0_2px,var(--now-tint)_2px_5px)]`} /> 동시 실행
          {devices.length > 1 &&
            devices.map((d, i) => (
              <span key={d.id} className="inline-flex items-center gap-1">
                <span className={`${LEGEND} ${DEVICE_LEGEND[Math.min(i, 2)]}`} /> {d.name}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" className="icon-btn" aria-label="축소" disabled={zoom === 1} onClick={() => setZoom((z) => Math.max(1, z / 2))}>
            <ZoomOut size={18} aria-hidden />
          </button>
          <button type="button" className="icon-btn" aria-label="확대" disabled={zoom === 8} onClick={() => setZoom((z) => Math.min(8, z * 2))}>
            <ZoomIn size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[64px_minmax(0,1fr)]">
        <div className="relative" style={{ height: H }}>
          <span className={LANE_LABEL} style={{ top: TOP - 1 }}>
            실제
          </span>
          {lanes.map((p, i) => (
            <span key={p} className={LANE_LABEL} style={{ top: laneY(i) + 1 }} title={label(p)}>
              {label(p)}
            </span>
          ))}
        </div>
        <div className="relative overflow-x-auto overscroll-x-contain [scrollbar-width:thin]" ref={scroller} onScroll={() => setPicked(null)}>
          <svg width={W} height={H} role="img" aria-label="오늘 앱별 사용 구간 타임라인" className="block">
            <defs>
              <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--now-tint)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--now)" strokeWidth="2.5" />
              </pattern>
            </defs>
            {rests.map(([s, e], i) => (
              <rect key={`r${i}`} x={x(s)} y={TOP - 4} width={Math.max(1, x(e) - x(s))} height={H - TOP + 4} fill="var(--comma-tint)" opacity="0.7" />
            ))}
            {hours.map((t, h) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={TOP - 4} y2={H} stroke="var(--line)" strokeWidth={h % 6 === 0 ? 1.2 : 0.6} vectorEffect="non-scaling-stroke" />
                {(zoom > 1 || h % 6 === 0) && (
                  <text x={x(t) + 3} y={12} fontSize="11" fill="var(--ink-3)" className="num font-semibold">
                    {h}
                  </text>
                )}
              </g>
            ))}
            {concurrent.map(([s, e], i) => (
              <rect key={`c${i}`} x={x(s)} y={TOP + UNION_H + 8} width={Math.max(1.5, x(e) - x(s))} height={H - TOP - UNION_H - 10} fill="url(#hatch)" opacity="0.9" />
            ))}
            {union.map(([s, e], i) => (
              <rect key={`u${i}`} x={x(s)} y={TOP} width={Math.max(2, x(e) - x(s))} height={UNION_H} rx={UNION_H / 2} fill="var(--ink)" />
            ))}
            {segs.map((s, i) => {
              const dev = Math.min(deviceIndex.get(s.deviceId) ?? 0, 2)
              const y = laneY(laneOf(s.packageName))
              const w = Math.max(2.5, x(s.end) - x(s.start))
              return (
                <rect
                  key={i}
                  x={x(s.start)}
                  y={y}
                  width={w}
                  height={LANE_H}
                  rx={Math.min(LANE_H / 2, w / 2)}
                  className={`cursor-pointer transition-opacity hover:opacity-75 focus-visible:opacity-75 focus-visible:outline-none ${s.open ? 'fill-now' : SEG_DEVICE[dev]}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${label(s.packageName)} ${fmtTime(s.start, timeZone)}부터 ${fmtTime(s.end, timeZone)}까지`}
                  onClick={(e) => {
                    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                    setPicked({ seg: s, x: e.clientX - r.left, y: y + LANE_H })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setPicked({ seg: s, x: (x(s.start) / W) * (scroller.current?.clientWidth ?? 0), y: y + LANE_H })
                  }}
                />
              )
            })}
            {now < dayEnd && <line x1={x(now)} x2={x(now)} y1={TOP - 6} y2={H} stroke="var(--now)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          </svg>
          {picked && (
            <div
              className="absolute z-[5] grid min-w-[180px] gap-0.5 rounded-tile bg-ink py-2.5 pr-[30px] pl-3 text-[13px] text-paper shadow-[0_8px_20px_var(--shadow-color)]"
              style={{ left: Math.max(8, picked.x - 90), top: picked.y + 8 }}
              role="status"
            >
              <strong>{label(picked.seg.packageName)}</strong>
              <span className="num">
                {fmtTime(picked.seg.start, timeZone)} ~ {picked.seg.open ? '지금' : fmtTime(picked.seg.end, timeZone)}
              </span>
              <span>
                {formatDuration(picked.seg.end - picked.seg.start)}, {devices.find((d) => d.id === picked.seg.deviceId)?.name ?? '기기'}
              </span>
              <button type="button" className="absolute top-1 right-1.5 cursor-pointer border-0 bg-transparent text-lg text-inherit" aria-label="닫기" onClick={() => setPicked(null)}>
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
