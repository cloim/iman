import { overlapLength, type Interval } from './intervals'
import { atLocalTime, dayRange, weekdayOf, type LocalDate } from './time'
import type { UsageSummary } from './summary'

export type GoalType = 'daily_actual' | 'app_limit' | 'category_limit' | 'quiet_hours' | 'pickups'
export type GoalStatus = 'met' | 'near' | 'over'

export interface Goal {
  id: string
  type: GoalType
  /** 분 단위 한도. pickups 는 횟수 */
  target: number
  /** app_limit 은 패키지명, category_limit 은 카테고리 */
  scopeRef: string | null
  /** bit0=월 ... bit6=일 */
  daysOfWeek: number
  quietFrom: string | null
  quietTo: string | null
}

export interface GoalEvaluation {
  status: GoalStatus
  value: number
  limit: number
  ratio: number
}

export const NEAR_RATIO = 0.8
const QUIET_GRACE_MS = 60_000

export function isGoalActiveOn(goal: Pick<Goal, 'daysOfWeek'>, date: LocalDate): boolean {
  return (goal.daysOfWeek & (1 << weekdayOf(date))) !== 0
}

/** 쉬는 시간대(자정을 넘을 수 있음)를 해당 날짜 안의 구간으로 */
export function quietIntervals(
  date: LocalDate,
  from: string,
  to: string,
  timeZone: string,
): Interval[] {
  const [start, end] = dayRange(date, timeZone)
  const f = atLocalTime(date, from, timeZone)
  const t = atLocalTime(date, to, timeZone)
  if (f < t) return [[f, t]]
  const out: Interval[] = []
  if (t > start) out.push([start, t])
  if (end > f) out.push([f, end])
  return out
}

function judge(value: number, limit: number, grace = 0): GoalEvaluation {
  const ratio = limit > 0 ? value / limit : value > grace ? Infinity : 0
  const status: GoalStatus =
    value > limit + grace ? 'over' : limit > 0 && ratio >= NEAR_RATIO ? 'near' : 'met'
  return { status, value, limit, ratio }
}

export function evaluateGoal(
  goal: Goal,
  summary: UsageSummary,
  date: LocalDate,
  timeZone: string,
): GoalEvaluation {
  const limitMs = goal.target * 60_000
  switch (goal.type) {
    case 'daily_actual':
      return judge(summary.actualMs, limitMs)
    case 'app_limit':
      return judge(summary.byApp[goal.scopeRef ?? '']?.actualMs ?? 0, limitMs)
    case 'category_limit':
      return judge(summary.byCategory[goal.scopeRef ?? '']?.actualMs ?? 0, limitMs)
    case 'pickups':
      return judge(summary.pickups, goal.target)
    case 'quiet_hours': {
      const quiet = quietIntervals(
        date,
        goal.quietFrom ?? '22:00',
        goal.quietTo ?? '07:00',
        timeZone,
      )
      return judge(overlapLength(summary.union, quiet), limitMs, QUIET_GRACE_MS)
    }
  }
}
