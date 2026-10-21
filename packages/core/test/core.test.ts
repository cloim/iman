import { describe, expect, it } from 'vitest'
import {
  bucketize,
  dayRange,
  evaluateGoal,
  formatDuration,
  hourBoundaries,
  isGoalActiveOn,
  localDateOf,
  localDatesBetween,
  quietIntervals,
  summarize,
  weekdayOf,
  type Goal,
} from '../src'

const TZ = 'Asia/Seoul'
const t = (s: string) => Date.parse(s)

describe('시간대', () => {
  it('서울 자정 경계', () => {
    const [s, e] = dayRange('2026-10-20', TZ)
    expect(new Date(s).toISOString()).toBe('2026-10-19T15:00:00.000Z')
    expect(e - s).toBe(86_400_000)
  })
  it('일광절약 전환일은 23시간', () => {
    const [s, e] = dayRange('2026-03-08', 'America/New_York')
    expect(e - s).toBe(23 * 3_600_000)
    expect(hourBoundaries(s, e)).toHaveLength(24)
  })
  it('현지 날짜와 요일', () => {
    expect(localDateOf(t('2026-10-20T15:30:00Z'), TZ)).toBe('2026-10-21')
    expect(weekdayOf('2026-10-19')).toBe(0)
    expect(weekdayOf('2026-10-25')).toBe(6)
    expect(localDatesBetween(t('2026-10-19T23:00:00+09:00'), t('2026-10-21T00:00:00+09:00'), TZ)).toEqual([
      '2026-10-19',
      '2026-10-20',
    ])
  })
})

describe('집계 세부', () => {
  const w = { from: t('2026-10-20T00:00:00+09:00'), to: t('2026-10-21T00:00:00+09:00'), now: t('2026-10-21T09:00:00+09:00') }
  const sessions = [
    { deviceId: 'p', packageName: 'yt', startedAt: t('2026-10-20T10:00:00+09:00'), endedAt: t('2026-10-20T10:40:00+09:00') },
    { deviceId: 't', packageName: 'yt', startedAt: t('2026-10-20T10:20:00+09:00'), endedAt: t('2026-10-20T11:00:00+09:00') },
    { deviceId: 'p', packageName: 'kakao', startedAt: t('2026-10-20T10:30:00+09:00'), endedAt: t('2026-10-20T10:50:00+09:00') },
  ]
  const cat = (p: string) => (p === 'yt' ? 'video' : 'social')
  const r = summarize(sessions, w, cat)

  it('앱별 실제 사용시간은 앱 내부 기기 간 겹침도 제거', () => {
    expect(r.byApp.yt).toEqual({ totalMs: 80 * 60_000, actualMs: 60 * 60_000 })
    expect(r.byDevice.p).toEqual({ totalMs: 60 * 60_000, actualMs: 50 * 60_000 })
    expect(r.byCategory.social?.actualMs).toBe(20 * 60_000)
  })
  it('시간대별 분포', () => {
    const [s, e] = dayRange('2026-10-20', TZ)
    const hours = bucketize(r.union, hourBoundaries(s, e))
    expect(hours[10]).toBe(60 * 60_000)
    expect(hours.reduce((a, b) => a + b, 0)).toBe(r.actualMs)
  })
})

describe('목표 판정', () => {
  const base: Goal = { id: 'g', type: 'daily_actual', target: 60, scopeRef: null, daysOfWeek: 0b1111111, quietFrom: null, quietTo: null }
  const w = { from: t('2026-10-20T00:00:00+09:00'), to: t('2026-10-21T00:00:00+09:00'), now: t('2026-10-21T09:00:00+09:00') }
  const make = (start: string, end: string) =>
    summarize([{ deviceId: 'p', packageName: 'a', startedAt: t(start), endedAt: t(end) }], w)

  it('80% 이상은 근접, 초과는 over', () => {
    expect(evaluateGoal(base, make('2026-10-20T10:00:00+09:00', '2026-10-20T10:30:00+09:00'), '2026-10-20', TZ).status).toBe('met')
    expect(evaluateGoal(base, make('2026-10-20T10:00:00+09:00', '2026-10-20T10:50:00+09:00'), '2026-10-20', TZ).status).toBe('near')
    expect(evaluateGoal(base, make('2026-10-20T10:00:00+09:00', '2026-10-20T11:10:00+09:00'), '2026-10-20', TZ).status).toBe('over')
  })
  it('자정을 넘는 쉬는 시간대', () => {
    const q = quietIntervals('2026-10-20', '22:00', '07:00', TZ)
    expect(q).toHaveLength(2)
    const goal: Goal = { ...base, type: 'quiet_hours', target: 0, quietFrom: '22:00', quietTo: '07:00' }
    expect(evaluateGoal(goal, make('2026-10-20T06:59:30+09:00', '2026-10-20T07:30:00+09:00'), '2026-10-20', TZ).status).toBe('met')
    expect(evaluateGoal(goal, make('2026-10-20T22:30:00+09:00', '2026-10-20T22:45:00+09:00'), '2026-10-20', TZ).status).toBe('over')
  })
  it('요일 비트마스크', () => {
    expect(isGoalActiveOn({ daysOfWeek: 0b0011111 }, '2026-10-24')).toBe(false)
    expect(isGoalActiveOn({ daysOfWeek: 0b0011111 }, '2026-10-23')).toBe(true)
  })
})

it('시간 표기', () => {
  expect(formatDuration(0)).toBe('0분')
  expect(formatDuration(45_000)).toBe('45초')
  expect(formatDuration(192 * 60_000)).toBe('3시간 12분')
  expect(formatDuration(120 * 60_000)).toBe('2시간')
})
