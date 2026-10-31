import { describe, expect, it } from 'vitest'
import { createTimelineTooltipOptions, type TimelineCell } from './TimelineHeatmap'

describe('TimelineHeatmap createTimelineTooltipOptions', () => {
  const dayStart = new Date('2026-10-31T00:00:00Z').getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const timeZone = 'Asia/Seoul'
  const rows = ['실제 사용', '게이밍 허브', '유튜브']
  const devices = [{ id: 'dev1', name: '내 폰' }, { id: 'dev2', name: '태블릿' }]

  const tooltip = createTimelineTooltipOptions(dayStart, dayEnd, timeZone, rows, devices)

  describe('filter', () => {
    it('0 사용량이고 휴식 시간이 아니면 false를 반환하여 툴팁 목록에서 제외한다', () => {
      expect(tooltip.filter({ raw: { v: 0, resting: false } } as any)).toBe(false)
    })

    it('사용 시간이 0보다 크면 true를 반환한다', () => {
      expect(tooltip.filter({ raw: { v: 1000, resting: false } } as any)).toBe(true)
    })

    it('휴식 시간 칸이면 사용 시간이 0이어도 true를 반환한다', () => {
      expect(tooltip.filter({ raw: { v: 0, resting: true } } as any)).toBe(true)
    })

    it('item 또는 item.raw 가 undefined/null 이어도 에러를 던지지 않고 false를 반환한다', () => {
      expect(tooltip.filter(undefined as any)).toBe(false)
      expect(tooltip.filter({ raw: undefined } as any)).toBe(false)
      expect(tooltip.filter({ raw: null } as any)).toBe(false)
    })
  })

  describe('callbacks.title', () => {
    it('items 배열이 비어있을 때(filter로 모두 걸러진 경우) 에러 없이 빈 문자열을 반환한다', () => {
      expect(tooltip.callbacks.title([])).toBe('')
      expect(tooltip.callbacks.title([undefined] as any)).toBe('')
      expect(tooltip.callbacks.title([{ raw: undefined }] as any)).toBe('')
    })

    it('유효한 셀 정보가 주어지면 앱 이름과 시간 구간을 올바르게 포맷팅한다', () => {
      // 11시 45분은 하루의 47번째 15분 슬롯 (11 * 4 + 3)
      const cell: TimelineCell = {
        x: 47,
        y: 1, // 게이밍 허브
        v: 1000, // 1초 사용
        concurrentMs: 0,
        partners: [],
        devices: ['내 폰'],
        resting: false,
      }
      const title = tooltip.callbacks.title([{ raw: cell }] as any)
      expect(title).toContain('게이밍 허브')
      // 한국 시간(Asia/Seoul) 기준 포맷 확인
      expect(title).toMatch(/\d{2}:\d{2}\s*~\s*\d{2}:\d{2}/)
    })
  })

  describe('callbacks.label', () => {
    it('item 또는 item.raw 가 없어도 에러 없이 빈 배열을 반환한다', () => {
      expect(tooltip.callbacks.label(undefined as any)).toEqual([])
      expect(tooltip.callbacks.label({ raw: undefined } as any)).toEqual([])
      expect(tooltip.callbacks.label({ raw: null } as any)).toEqual([])
    })

    it('유효한 사용 데이터에 대해 사용 시간, 동시 실행, 기기 정보를 반환한다', () => {
      const cell: TimelineCell = {
        x: 47,
        y: 1,
        v: 1000,
        concurrentMs: 500,
        partners: ['유튜브'],
        devices: ['내 폰'],
        resting: true,
      }
      const labels = tooltip.callbacks.label({ raw: cell } as any)
      expect(labels).toContain('사용 1초')
      expect(labels).toContain('동시 실행 1초')
      expect(labels).toContain('함께 띄운 앱 유튜브')
      expect(labels).toContain('기기 내 폰')
      expect(labels).toContain('쉬는 시간 포함')
    })
  })
})
