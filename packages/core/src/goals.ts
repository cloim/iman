import { weekdayOf, type LocalDate } from './time'
import type { UsageSummary } from './summary'

export const GOAL_TYPES = ['daily_actual', 'app_limit', 'category_limit'] as const
export type GoalType = (typeof GOAL_TYPES)[number]
export const isGoalType = (type: string): type is GoalType => GOAL_TYPES.some((t) => t === type)
export type GoalStatus = 'met' | 'near' | 'over'

export interface Goal {
  id: string
  type: GoalType
  /** 분 단위 한도 */
  target: number
  /** app_limit 은 패키지명, category_limit 은 카테고리 */
  scopeRef: string | null
  /** bit0=월 ... bit6=일 */
  daysOfWeek: number
}

export interface GoalEvaluation {
  status: GoalStatus
  value: number
  limit: number
  ratio: number
}

export const NEAR_RATIO = 0.8

export function isGoalActiveOn(goal: Pick<Goal, 'daysOfWeek'>, date: LocalDate): boolean {
  return (goal.daysOfWeek & (1 << weekdayOf(date))) !== 0
}

function judge(value: number, limit: number): GoalEvaluation {
  const ratio = limit > 0 ? value / limit : value > 0 ? Infinity : 0
  const status: GoalStatus =
    value > limit ? 'over' : limit > 0 && ratio >= NEAR_RATIO ? 'near' : 'met'
  return { status, value, limit, ratio }
}

export function evaluateGoal(
  goal: Goal,
  summary: UsageSummary,
): GoalEvaluation {
  const limitMs = goal.target * 60_000
  switch (goal.type) {
    case 'daily_actual':
      return judge(summary.actualMs, limitMs)
    case 'app_limit':
      return judge(summary.byApp[goal.scopeRef ?? '']?.actualMs ?? 0, limitMs)
    case 'category_limit':
      return judge(summary.byCategory[goal.scopeRef ?? '']?.actualMs ?? 0, limitMs)
  }
}
