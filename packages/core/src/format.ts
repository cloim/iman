/** 3시간 12분, 45분, 30초 */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin <= 0) return ms > 0 ? `${Math.max(1, Math.round(ms / 1000))}초` : '0분'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}분`
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

/** 3:12 처럼 짧은 표기 */
export function formatClock(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`
}
