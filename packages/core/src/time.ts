const dtfCache = new Map<string, Intl.DateTimeFormat>()

function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    dtfCache.set(timeZone, f)
  }
  return f
}

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function localParts(ms: number, timeZone: string): LocalParts {
  const p: Record<string, number> = {}
  for (const part of dtf(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  return {
    year: p.year!,
    month: p.month!,
    day: p.day!,
    hour: p.hour!,
    minute: p.minute!,
    second: p.second!,
  }
}

/** 해당 시각의 UTC 대비 시간대 오프셋(ms) */
export function zoneOffset(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** 시간대 기준 현지 시각을 epoch ms 로 변환 */
export function zonedToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = guess - zoneOffset(guess, timeZone)
  return guess - zoneOffset(first, timeZone)
}

/** 'YYYY-MM-DD' */
export type LocalDate = string

export function parseLocalDate(d: LocalDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) throw new Error(`잘못된 날짜 형식: ${d}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function localDateOf(ms: number, timeZone: string): LocalDate {
  const p = localParts(ms, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const [y, m, day] = parseLocalDate(d)
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10)
}

/** 0=월 ... 6=일 */
export function weekdayOf(d: LocalDate): number {
  const [y, m, day] = parseLocalDate(d)
  return (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7
}

/** 현지 날짜 하루의 [자정, 다음 자정) */
export function dayRange(d: LocalDate, timeZone: string): [number, number] {
  const [y, m, day] = parseLocalDate(d)
  const [ny, nm, nd] = parseLocalDate(addDays(d, 1))
  return [zonedToEpoch(y, m, day, 0, 0, timeZone), zonedToEpoch(ny, nm, nd, 0, 0, timeZone)]
}

/** 'HH:MM' 을 해당 현지 날짜의 epoch ms 로 */
export function atLocalTime(d: LocalDate, hhmm: string, timeZone: string): number {
  const [y, m, day] = parseLocalDate(d)
  const [hh, mm] = hhmm.split(':').map(Number)
  return zonedToEpoch(y, m, day, hh!, mm!, timeZone)
}

/** 범위가 걸치는 현지 날짜 목록 */
export function localDatesBetween(from: number, to: number, timeZone: string): LocalDate[] {
  if (to <= from) return []
  const out: LocalDate[] = []
  let d = localDateOf(from, timeZone)
  const last = localDateOf(to - 1, timeZone)
  for (;;) {
    out.push(d)
    if (d === last) break
    d = addDays(d, 1)
  }
  return out
}
