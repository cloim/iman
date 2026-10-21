import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type TooltipOptions,
} from 'chart.js'
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix'
import { useEffect, useState } from 'react'

Chart.register(BarController, BarElement, DoughnutController, ArcElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, MatrixController, MatrixElement)
Chart.defaults.font.family = "'Pretendard Variable', Pretendard, system-ui, sans-serif"
// 애니메이션 객체를 통째로 바꾸면 툴팁 페이드 설정까지 사라져 툴팁이 안 보이므로 길이만 바꾼다
Object.assign(Chart.defaults.animation, { duration: 500 })

const TOKENS = ['paper', 'surface', 'surface-2', 'ink', 'ink-2', 'ink-3', 'line', 'comma', 'comma-deep', 'comma-tint', 'now', 'near', 'over'] as const
export type ChartColors = Record<(typeof TOKENS)[number], string>

const read = (): ChartColors => {
  const s = getComputedStyle(document.documentElement)
  return Object.fromEntries(TOKENS.map((t) => [t, s.getPropertyValue(`--${t}`).trim()])) as ChartColors
}

/** 캔버스는 CSS 변수를 못 읽으므로 디자인 토큰 값을 꺼내고, 화면 모드가 바뀌면 다시 읽는다 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const update = () => setColors(read())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', update)
      mo.disconnect()
    }
  }, [])
  return colors
}

/** 모든 차트가 같은 모양의 툴팁을 쓴다 */
export const tooltipStyle = (c: ChartColors): Partial<TooltipOptions<'bar'>> => ({
  backgroundColor: c.ink,
  titleColor: c.paper,
  bodyColor: c.paper,
  padding: 10,
  cornerRadius: 10,
  displayColors: false,
  titleFont: { weight: 'bold' },
})

/**
 * 캔버스가 작아 툴팁이 잘리는 차트용. 툴팁을 문서 위 HTML 상자로 그린다
 */
export function htmlTooltip({ chart, tooltip }: { chart: Chart; tooltip: { opacity: number; title: string[]; body: { lines: string[] }[]; caretX: number; caretY: number } }) {
  let el = document.getElementById('chart-tip')
  if (!el) {
    el = document.createElement('div')
    el.id = 'chart-tip'
    el.setAttribute('role', 'status')
    el.className = 'pointer-events-none fixed z-50 rounded-[10px] bg-ink px-2.5 py-1.5 text-xs text-paper shadow-[0_8px_20px_var(--shadow-color)] transition-opacity'
    document.body.appendChild(el)
    // 툴팁은 화면 고정 위치라 어떤 영역이든 스크롤하면 숨긴다
    window.addEventListener('scroll', hideHtmlTooltip, { capture: true, passive: true })
  }
  if (tooltip.opacity === 0) {
    el.style.opacity = '0'
    return
  }
  el.replaceChildren(
    ...tooltip.title.map((t) => Object.assign(document.createElement('strong'), { textContent: t, className: 'block' })),
    ...tooltip.body.flatMap((b) => b.lines).map((l) => Object.assign(document.createElement('span'), { textContent: l, className: 'block' })),
  )
  const r = chart.canvas.getBoundingClientRect()
  el.style.opacity = '1'
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left + tooltip.caretX - el.offsetWidth / 2))}px`
  el.style.top = `${r.top + tooltip.caretY - el.offsetHeight - 10}px`
}

/** 스크롤하거나 화면을 떠날 때 남은 HTML 툴팁을 숨긴다 */
export function hideHtmlTooltip() {
  const el = document.getElementById('chart-tip')
  if (el) el.style.opacity = '0'
}

/** 앱 순위별 색. 쉼표 초록에서 시작해 브랜드 톤 안에서 구분되게 고른다 */
export const APP_PALETTE = ['#4f9c7f', '#5b9fd0', '#d39a3a', '#c9705e', '#8a7cc0', '#9b968b']
