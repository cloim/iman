import { useId } from 'react'

/**
 * 공식 브랜드 쉼표(docs/assets/branding/iman-comma.svg, viewBox 0 0 56 81)와
 * 앱 아이콘의 하늘색 점(iman-app.svg 기준 위치)을 그대로 쓴다.
 * 머리는 y 0.5~50, 꼬리는 y 50~79.
 */
export const COMMA_PATH =
  'm31.69 0.5c35.39 3.4 30.84 64.37-7.44 77.91-4.76 1.68-14.76 4.57-15.86-2.57-1.06-6.91 9.9-8.66 13.25-15.97 1.5-3.29 1.79-8.57-1.84-10.9-30.7-5.8-22.36-51.76 11.89-48.47z'
export const DOT_PATH = 'M70.25 78.89C58.08 86.44 47.83 70.65 56.77 62.79 68.33 52.63 81.53 71.88 70.25 78.89Z'
export const COMMA_VIEWBOX = '0 0 56 81'
const GAUGE_VIEWBOX = '0 0 76 82'
const HEAD_TOP = 0.5
const HEAD_BOTTOM = 50
const TAIL_BOTTOM = 79

export type CommaStatus = 'met' | 'near' | 'over' | 'none'

export const STATUS_COLOR: Record<CommaStatus, string> = {
  met: 'var(--comma)',
  near: 'var(--near)',
  over: 'var(--over)',
  none: 'var(--comma)',
}

/** 위쪽 가장자리가 살짝 물결진 채움 영역 */
function liquid(top: number, bottom: number) {
  if (bottom - top <= 0.3) return ''
  const w = 3.5
  let d = `M-2 ${top}`
  for (let x = -2; x < 60; x += w * 2) d += ` q${w / 2} -1.3 ${w} 0 t${w} 0`
  return `${d} L60 ${bottom} L-2 ${bottom} Z`
}

/**
 * 쉼표 게이지: 머리는 목표, 꼬리는 초과 영역.
 * ratio 0~1 은 머리를 아래에서 위로 채우고, 1을 넘으면 꼬리로 코랄이 흘러내린다.
 */
export function CommaGauge({
  ratio,
  status,
  active = false,
  size = 160,
  label,
}: {
  ratio: number
  status: CommaStatus
  active?: boolean
  size?: number
  label: string
}) {
  const id = useId().replace(/:/g, '')
  const head = Math.max(0, Math.min(1, ratio))
  const over = Math.max(0, Math.min(1, ratio - 1))
  const headTop = HEAD_BOTTOM - head * (HEAD_BOTTOM - HEAD_TOP)
  return (
    <svg viewBox={GAUGE_VIEWBOX} width={size} height={(size * 82) / 76} role="img" aria-label={label} className="block overflow-visible">
      <defs>
        <clipPath id={`c${id}`}>
          <path d={COMMA_PATH} />
        </clipPath>
      </defs>
      <path d={COMMA_PATH} fill="var(--comma-tint)" />
      <g clipPath={`url(#c${id})`}>
        <path d={liquid(headTop, HEAD_BOTTOM)} fill={STATUS_COLOR[status]} className="transition-[d] duration-800 ease-spring" />
        {over > 0 && <rect x="0" y={HEAD_BOTTOM - 0.5} width="60" height={over * (TAIL_BOTTOM - HEAD_BOTTOM) + 0.5} fill="var(--over)" />}
      </g>
      {active && <path d={DOT_PATH} fill="var(--now)" className="breathe" />}
    </svg>
  )
}

/** 캘린더, 목록용 작은 쉼표 도장 */
export function CommaStamp({
  variant,
  size = 24,
  title,
}: {
  variant: 'full' | 'half' | 'outline' | 'empty' | 'plain'
  size?: number
  title?: string
}) {
  const id = useId().replace(/:/g, '')
  const color = variant === 'full' ? 'var(--comma)' : variant === 'half' ? 'var(--near)' : 'var(--over)'
  return (
    <svg
      viewBox={COMMA_VIEWBOX}
      width={size}
      height={(size * 81) / 56}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="overflow-visible"
    >
      {variant === 'plain' ? (
        <path d={COMMA_PATH} fill="var(--line-strong)" />
      ) : variant === 'empty' ? (
        <path d={COMMA_PATH} fill="none" stroke="var(--line-strong)" strokeWidth="3" strokeDasharray="5 5" />
      ) : variant === 'outline' ? (
        <path d={COMMA_PATH} fill="var(--over-tint)" stroke={color} strokeWidth="4.5" />
      ) : variant === 'half' ? (
        <>
          <defs>
            <clipPath id={`c${id}`}>
              <rect x="0" y="26" width="60" height="60" />
            </clipPath>
          </defs>
          <path d={COMMA_PATH} fill="var(--near-tint)" />
          <path d={COMMA_PATH} fill={color} clipPath={`url(#c${id})`} />
        </>
      ) : (
        <path d={COMMA_PATH} fill={color} />
      )}
    </svg>
  )
}

/** 워드마크 "이만," */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-end font-display leading-none text-ink" style={{ gap: size * 0.04, fontSize: size }}>
      이만
      <svg viewBox={COMMA_VIEWBOX} width={size * 0.26} height={size * 0.376} aria-hidden style={{ marginBottom: -size * 0.16 }}>
        <path d={COMMA_PATH} fill="var(--comma)" />
      </svg>
    </span>
  )
}
