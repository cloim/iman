import type { GoalDto } from './types'

type Schedule = Pick<GoalDto, 'type' | 'scopeRef' | 'daysOfWeek' | 'active'>

/** 같은 대상의 목표가 하루에 두 번 적용되지 않도록 요일 묶음을 검사한다. */
export function hasOverlappingGoals(goals: readonly Schedule[]): boolean {
  return goals.some((g, i) => g.active && goals.slice(i + 1).some((other) =>
    other.active && other.type === g.type && other.scopeRef === g.scopeRef &&
    (g.daysOfWeek & other.daysOfWeek) !== 0,
  ))
}

export function availableGoalDays(goals: readonly Schedule[]): number {
  return 127 & ~goals.filter((g) => g.active).reduce((days, g) => days | g.daysOfWeek, 0)
}
