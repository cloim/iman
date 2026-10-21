import {
  clipSession,
  lengthOf,
  overlapLength,
  unionIntervals,
  type Interval,
  type UsageSession,
  type Window,
} from './intervals'

export interface UsagePart {
  totalMs: number
  actualMs: number
}

export interface UsageSummary extends UsagePart {
  /** 동시 실행으로 겹친 시간 = 총 - 실제 */
  overlapMs: number
  /** 실제 사용 구간(합집합) 덩어리 수 */
  pickups: number
  byApp: Record<string, UsagePart>
  byDevice: Record<string, UsagePart>
  byCategory: Record<string, UsagePart>
  union: Interval[]
}

function part(intervals: Interval[]): UsagePart {
  return { totalMs: lengthOf(intervals), actualMs: lengthOf(unionIntervals(intervals)) }
}

function groupParts(map: Map<string, Interval[]>): Record<string, UsagePart> {
  const out: Record<string, UsagePart> = {}
  for (const [k, v] of map) out[k] = part(v)
  return out
}

function push(map: Map<string, Interval[]>, key: string, iv: Interval) {
  const list = map.get(key)
  if (list) list.push(iv)
  else map.set(key, [iv])
}

/**
 * 범위 안의 세션으로 총 사용시간과 실제 사용시간을 계산한다.
 * - 총 사용시간: 모든 세션 길이의 합
 * - 실제 사용시간: 앱, 기기 간 겹침을 한 번만 센 합집합 길이
 */
export function summarize(
  sessions: readonly UsageSession[],
  w: Window,
  categoryOf: (packageName: string) => string = () => 'other',
): UsageSummary {
  const all: Interval[] = []
  const byApp = new Map<string, Interval[]>()
  const byDevice = new Map<string, Interval[]>()
  const byCategory = new Map<string, Interval[]>()
  for (const s of sessions) {
    const iv = clipSession(s, w)
    if (!iv) continue
    all.push(iv)
    push(byApp, s.packageName, iv)
    push(byDevice, s.deviceId, iv)
    push(byCategory, categoryOf(s.packageName), iv)
  }
  const union = unionIntervals(all)
  const totalMs = lengthOf(all)
  const actualMs = lengthOf(union)
  return {
    totalMs,
    actualMs,
    overlapMs: totalMs - actualMs,
    pickups: union.length,
    byApp: groupParts(byApp),
    byDevice: groupParts(byDevice),
    byCategory: groupParts(byCategory),
    union,
  }
}

/** 실제 사용 구간을 칸(경계 목록)별 길이로 나눈다. boundaries 길이 n+1 이면 n칸 */
export function bucketize(union: readonly Interval[], boundaries: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < boundaries.length; i++) {
    out.push(overlapLength(union, [[boundaries[i]!, boundaries[i + 1]!]]))
  }
  return out
}

/** 하루를 1시간 칸으로 나눈 경계(일광절약 전환일은 23 또는 25칸) */
export function hourBoundaries(dayStart: number, dayEnd: number): number[] {
  const out: number[] = []
  for (let t = dayStart; t < dayEnd; t += 3_600_000) out.push(t)
  out.push(dayEnd)
  return out
}
