/** 반열린 구간 [start, end) (epoch ms) */
export type Interval = readonly [number, number]

/** 한 기기에서 한 앱이 포그라운드였던 연속 구간. endedAt 이 null 이면 진행 중 */
export interface UsageSession {
  deviceId: string
  packageName: string
  startedAt: number
  endedAt: number | null
}

export interface Window {
  from: number
  to: number
  /** 진행 중 세션을 마감할 기준 시각 */
  now: number
}

/** 세션을 조회 범위로 잘라 구간으로 만든다. 범위 밖이거나 길이가 0이면 null */
export function clipSession(s: UsageSession, w: Window): Interval | null {
  const end = Math.min(s.endedAt ?? w.now, w.to, w.now)
  const start = Math.max(s.startedAt, w.from)
  return end > start ? [start, end] : null
}

/** 구간 합집합. 겹치거나 맞닿은 구간은 하나로 합친다 */
export function unionIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: [number, number][] = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

export function lengthOf(intervals: readonly Interval[]): number {
  let sum = 0
  for (const [s, e] of intervals) sum += e - s
  return sum
}

/** 두 개 이상의 구간이 동시에 덮는 부분(동시 실행 구간) */
export function concurrentIntervals(intervals: readonly Interval[]): Interval[] {
  const edges: [number, number][] = []
  for (const [s, e] of intervals) {
    if (e <= s) continue
    edges.push([s, 1], [e, -1])
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Interval[] = []
  let depth = 0
  let start = 0
  for (const [t, d] of edges) {
    const before = depth
    depth += d
    if (before < 2 && depth >= 2) start = t
    else if (before >= 2 && depth < 2 && t > start) out.push([start, t])
  }
  return unionIntervals(out)
}

/** 두 정렬된 합집합 구간 목록의 교집합 길이 */
export function overlapLength(a: readonly Interval[], b: readonly Interval[]): number {
  let i = 0
  let j = 0
  let sum = 0
  while (i < a.length && j < b.length) {
    const [as, ae] = a[i]!
    const [bs, be] = b[j]!
    const s = Math.max(as, bs)
    const e = Math.min(ae, be)
    if (e > s) sum += e - s
    if (ae < be) i++
    else j++
  }
  return sum
}
