import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RestBanner } from './RestBanner'

vi.mock('../lib/native', () => ({ isNative: true, native: { getRestState: vi.fn() } }))

function render(endsAt: number, pauseId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['native-rest'], { endsAt, pauseId })
  return renderToStaticMarkup(<QueryClientProvider client={client}><RestBanner /></QueryClientProvider>)
}

describe('저장된 개인 쉬기 상태', () => {
  it('화면에서 시작하지 않은 기존 타이머도 남은 시간과 취소 버튼을 표시한다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      const html = render(1_125_000)
      expect(html).toContain('쉬는 중')
      expect(html).toContain('2:05')
      expect(html).toContain('쉬기 취소')
      expect(html).toContain('role="timer"')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('만료되거나 취소된 타이머는 표시하지 않는다', () => {
    expect(render(Date.now() - 1)).toBe('')
    expect(render(0)).toBe('')
  })

  it('그룹 쉬기는 기존 그룹 안내에서 처리한다', () => {
    expect(render(Date.now() + 60_000, 'group-pause')).toBe('')
  })
})
