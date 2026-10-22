import { describe, expect, it } from 'vitest'
import { availableGoalDays, hasOverlappingGoals } from './goalSchedules'
import type { GoalDto } from './types'

const goal = (daysOfWeek: number, extra: Partial<GoalDto> = {}) => ({
  type: 'daily_actual' as const, scopeRef: null, active: true, daysOfWeek, ...extra,
})

describe('요일 묶음별 목표', () => {
  it('평일과 주말에 같은 목표의 다른 한도를 둘 수 있다', () => {
    const goals = [goal(31, { target: 120 }), goal(96, { target: 240 })]
    expect(hasOverlappingGoals(goals)).toBe(false)
    expect(availableGoalDays(goals)).toBe(0)
  })

  it('같은 목표의 요일 중복을 찾고 비활성 목표는 제외한다', () => {
    expect(hasOverlappingGoals([goal(31), goal(16)])).toBe(true)
    expect(hasOverlappingGoals([goal(31), goal(16, { active: false })])).toBe(false)
    expect(availableGoalDays([goal(31), goal(96, { active: false })])).toBe(96)
  })

  it('다른 종류와 다른 앱은 같은 요일에도 설정한다', () => {
    expect(hasOverlappingGoals([goal(127), goal(127, { type: 'pickups' })])).toBe(false)
    const app = { type: 'app_limit' as const, scopeRef: 'com.example.video' }
    expect(hasOverlappingGoals([goal(31, app), goal(96, app)])).toBe(false)
    expect(hasOverlappingGoals([goal(31, app), goal(1, app)])).toBe(true)
    expect(hasOverlappingGoals([goal(127, app), goal(127, { ...app, scopeRef: 'com.example.game' })])).toBe(false)
  })

  it('미설정 목표와 개별 요일의 남은 자리를 계산한다', () => {
    expect(availableGoalDays([])).toBe(127)
    expect(availableGoalDays([goal(1), goal(64)])).toBe(62)
  })
})
