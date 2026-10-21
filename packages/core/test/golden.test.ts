import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/intervals/cases.json'
import { clipSession, concurrentIntervals, lengthOf, summarize, type UsageSession } from '../src'

type Row = [string, string, string, string | null]

describe('골든 픽스처: 총/실제 사용시간', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const sessions: UsageSession[] = (c.sessions as Row[]).map(([deviceId, packageName, s, e]) => ({
        deviceId,
        packageName,
        startedAt: Date.parse(s),
        endedAt: e === null ? null : Date.parse(e),
      }))
      const r = summarize(sessions, {
        from: Date.parse(c.window[0]!),
        to: Date.parse(c.window[1]!),
        now: Date.parse(c.now),
      })
      expect(r.totalMs / 60_000).toBe(c.expect.totalMin)
      expect(r.actualMs / 60_000).toBe(c.expect.actualMin)
      expect(r.pickups).toBe(c.expect.pickups)
      expect(r.overlapMs).toBe(r.totalMs - r.actualMs)
      // 동시 실행 구간은 겹친 시간 이하이며, 겹침이 없으면 비어 있다
      const clipped = sessions
        .map((s) => clipSession(s, { from: Date.parse(c.window[0]!), to: Date.parse(c.window[1]!), now: Date.parse(c.now) }))
        .filter((v) => v !== null)
      const concurrent = lengthOf(concurrentIntervals(clipped))
      expect(concurrent).toBeLessThanOrEqual(r.overlapMs)
      expect(concurrent === 0).toBe(r.overlapMs === 0)
    })
  }
})
