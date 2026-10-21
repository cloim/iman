import { useId } from 'react'

/**
 * 공식 브랜드 쉼표(docs/assets/branding/iman-comma.svg, viewBox 0 0 56 81)와
 * 앱 아이콘의 하늘색 점(iman-app.svg 기준 위치)을 그대로 쓴다.
 */
export const COMMA_PATH =
  'm31.69 0.5c35.39 3.4 30.84 64.37-7.44 77.91-4.76 1.68-14.76 4.57-15.86-2.57-1.06-6.91 9.9-8.66 13.25-15.97 1.5-3.29 1.79-8.57-1.84-10.9-30.7-5.8-22.36-51.76 11.89-48.47z'
export const DOT_PATH = 'M70.25 78.89C58.08 86.44 47.83 70.65 56.77 62.79 68.33 52.63 81.53 71.88 70.25 78.89Z'
export const COMMA_VIEWBOX = '0 0 56 81'
const GAUGE_VIEWBOX = '0 0 76 82'
const TOP = 0.5
const BOTTOM = 79.2

export type CommaStatus = 'met' | 'near' | 'over' | 'none'

/**
 * 쉼표는 머리가 넓고 꼬리가 가늘어서 높이로 채우면 양이 왜곡된다.
 * 넓이 누적표를 한 번 만들어 "채운 비율"을 "수면 높이"로 바꾼다.
 */
const levelTable: number[] = (() => {
  const rows = 160
  if (typeof document === 'undefined') return Array.from({ length: rows + 1 }, (_, i) => i / rows)
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return Array.from({ length: rows + 1 }, (_, i) => i / rows)
  const p = new Path2D(COMMA_PATH)
  const cum = [0]
  for (let r = 0; r < rows; r++) {
    const y = BOTTOM - ((r + 0.5) / rows) * (BOTTOM - TOP)
    let n = 0
    for (let x = 0; x < 56; x += 0.5) if (ctx.isPointInPath(p, x, y)) n++
    cum.push(cum[r]! + n)
  }
  return cum.map((v) => v / cum[rows]!)
})()

function surfaceY(fill: number) {
  if (fill <= 0) return BOTTOM + 2
  if (fill >= 1) return TOP - 3
  const rows = levelTable.length - 1
  let r = 1
  while (r < rows && levelTable[r]! < fill) r++
  const a = levelTable[r - 1]!
  const b = levelTable[r]!
  const h = (r - 1 + (b > a ? (fill - a) / (b - a) : 0)) / rows
  return BOTTOM - h * (BOTTOM - TOP)
}

/** 넘긴 정도에 따라 코랄에서 진한 빨강으로. 목표의 2배면 가장 진하다 */
export const overColor = (overflow: number) =>
  `color-mix(in srgb, #c63c2f ${Math.round(Math.max(0, Math.min(1, overflow)) * 100)}%, var(--over))`

const BREATH = '0.45 0 0.55 1;0.45 0 0.55 1'
const WAVE_W = 14
/** 수면이 물결치는 채움. 한 물결 길이만큼 옆으로 흘려 끝없이 이어지게 한다 */
function wavePath(y: number, amp: number) {
  let d = `M${-WAVE_W * 2} ${y}`
  for (let x = -WAVE_W * 2; x < 70; x += WAVE_W) d += ` q${WAVE_W / 4} ${-amp} ${WAVE_W / 2} 0 t${WAVE_W / 2} 0`
  return `${d} L70 90 L${-WAVE_W * 2} 90 Z`
}

function Liquid({ fill, color, animate, clip }: { fill: number; color: string; animate: boolean; clip: string }) {
  if (fill <= 0) return null
  const y = surfaceY(fill)
  const amp = fill >= 1 ? 0 : 1.6
  const flow = (dur: string, back = false) =>
    animate && amp > 0 ? (
      <animateTransform attributeName="transform" type="translate" from={back ? `${WAVE_W} 0` : '0 0'} to={back ? '0 0' : `${WAVE_W} 0`} dur={dur} repeatCount="indefinite" />
    ) : null
  return (
    <g clipPath={`url(#${clip})`}>
      <path d={wavePath(y - 0.8, amp)} fill={color} opacity="0.45">
        {flow('3.2s', true)}
      </path>
      <path d={wavePath(y, amp)} fill={color}>
        {flow('2.2s')}
      </path>
    </g>
  )
}

/**
 * 쉼표 게이지: 사용량만큼 꼬리부터 머리까지 쉼표 전체를 채운다.
 * 목표를 넘기면 가득 찬 채로 색만 붉어지고, 넘긴 시간이 길수록 더 붉다.
 */
export function CommaGauge({
  ratio,
  over = false,
  active = false,
  size = 160,
  label,
}: {
  ratio: number
  over?: boolean
  active?: boolean
  size?: number
  label: string
}) {
  const id = `c${useId().replace(/:/g, '')}`
  const color = over ? overColor(ratio - 1) : 'var(--comma)'
  return (
    <svg viewBox={GAUGE_VIEWBOX} width={size} height={(size * 82) / 76} role="img" aria-label={label} className="block overflow-visible">
      <defs>
        <clipPath id={id}>
          <path d={COMMA_PATH} />
        </clipPath>
      </defs>
      <path d={COMMA_PATH} fill="var(--comma-tint)" />
      <Liquid fill={over ? 1 : Math.max(0, Math.min(1, ratio))} color={color} animate clip={id} />
      {active && (
        // 점 중심(64, 70)을 원점으로 옮겨 제자리에서 숨 쉬게 한다. CSS 애니메이션은 동작 줄이기 설정과 WebView에서 멈춰 SMIL을 쓴다
        <g transform="translate(64 70)">
          <g>
            <animateTransform attributeName="transform" type="scale" values="1;0.8;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines={BREATH} />
            <animate attributeName="opacity" values="1;0.4;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines={BREATH} />
            <path d={DOT_PATH} fill="var(--now)" transform="translate(-64 -70)" />
          </g>
        </g>
      )}
    </svg>
  )
}

/** 캘린더용 작은 쉼표 도장. 게이지와 같은 규칙으로 채우고 물결은 멈춰 있다 */
export function CommaStamp({ ratio, over = false, empty = false, size = 24 }: { ratio: number; over?: boolean; empty?: boolean; size?: number }) {
  const id = `s${useId().replace(/:/g, '')}`
  return (
    <svg viewBox={COMMA_VIEWBOX} width={size} height={(size * 81) / 56} aria-hidden className="overflow-visible">
      {empty ? (
        <path d={COMMA_PATH} fill="none" stroke="var(--line-strong)" strokeWidth="3" strokeDasharray="5 5" />
      ) : (
        <>
          <defs>
            <clipPath id={id}>
              <path d={COMMA_PATH} />
            </clipPath>
          </defs>
          <path d={COMMA_PATH} fill="var(--comma-tint)" />
          <Liquid fill={over ? 1 : Math.max(0, Math.min(1, ratio))} color={over ? overColor(ratio - 1) : 'var(--comma)'} animate={false} clip={id} />
        </>
      )}
    </svg>
  )
}

/**
 * 워드마크 "이만,": 공식 쉼표를 글자 높이의 절반 크기로 붙인다.
 * 글자 상자 아래쪽(내림선)에 꼬리 끝을 맞추면 머리는 기준선 위에 앉고 꼬리는 기준선 아래로 흐른다
 */
export function Wordmark({ size = 28 }: { size?: number }) {
  const h = size * 0.5
  return (
    <span className="inline-flex items-end font-display leading-none text-ink" style={{ gap: size * 0.05, fontSize: size }} aria-label="이만,">
      <span aria-hidden>이만</span>
      <svg viewBox={COMMA_VIEWBOX} width={(h * 56) / 81} height={h} aria-hidden className="flex-none" style={{ marginBottom: -size * 0.02 }}>
        <path d={COMMA_PATH} fill="var(--comma)" />
      </svg>
    </span>
  )
}
