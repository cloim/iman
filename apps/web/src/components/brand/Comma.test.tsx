import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CommaGauge, CommaStamp } from './Comma'
import { CommaCalendar } from './CommaCalendar'

describe('쉼표의 남은 양과 초과분', () => {
  for (const [name, render] of [
    ['게이지', (ratio: number) => renderToStaticMarkup(<CommaGauge ratio={ratio} label="사용량" />)],
    ['도장', (ratio: number) => renderToStaticMarkup(<CommaStamp ratio={ratio} />)],
  ] as const) {
    it(`${name}: 사용 전에는 가득 차고 목표에 도달하면 비워진다`, () => {
      expect(render(0)).toContain('fill="var(--comma)"')
      expect(render(0.5)).toContain('fill="var(--comma)"')
      expect(render(1)).not.toContain('<g clip-path=')
    })

    it(`${name}: 초과분만 붉게 차며 목표의 두 배에서 채움이 포화된다`, () => {
      const surface = (html: string) => Number(html.match(/d="M-28 ([\d.-]+)/)?.[1])
      expect(render(1.2)).toContain('color-mix(in srgb, #c63c2f 20%, var(--over))')
      expect(surface(render(1.2))).toBeGreaterThan(surface(render(1.5)))
      expect(surface(render(1.5))).toBeGreaterThan(surface(render(2)))
      expect(surface(render(2))).toBe(surface(render(3)))
      expect(surface(render(0.5))).toBe(surface(render(1.5)))
    })
  }

  it('캘린더는 0 사용량을 가득 채우고 사용량과 관계없이 도장 크기를 유지한다', () => {
    const html = renderToStaticMarkup(<CommaCalendar month="2026-10" today="2026-10-24" days={{
      '2026-10-21': { actualMs: 0, targetMin: 240, status: 'met', rests: 0 },
      '2026-10-22': { actualMs: 120 * 60_000, targetMin: 240, status: 'met', rests: 0 },
      '2026-10-23': { actualMs: 300 * 60_000, targetMin: 240, status: 'over', rests: 0 },
    }} />)
    expect(html.match(/<g clip-path=/g)).toHaveLength(3)
    expect(html.match(/width="18"/g)).toHaveLength(31)
    expect(html).not.toContain('scale(')
  })
})
