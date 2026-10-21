import { addDays, formatDuration, weekdayOf, type Interval } from '@iman/core'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppBar } from '../components/AppShell'
import { CommaCalendar, type CalendarDay } from '../components/brand/CommaCalendar'
import { TimelineRibbon } from '../components/brand/TimelineRibbon'
import { DataGrid } from '../components/DataGrid'
import { api } from '../lib/api'
import { useMe, useToday } from '../lib/queries'

interface DaysResponse {
  days: { date: string; totalMs: number; actualMs: number }[]
  goalResults: { date: string; status: 'met' | 'near' | 'over'; type: string }[]
  rests: Record<string, number>
}

interface Weekly {
  weekStart: string
  actualMs: number
  totalMs: number
  prevActualMs: number
  changeRatio: number | null
  topIncrease: { packageName: string; deltaMs: number; label?: string } | null
  longestBreak: { from: number; to: number } | null
  rests: number
  goalDaysMet: number
}

const monthOf = (d: string) => d.slice(0, 7)
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number)
  const t = new Date(Date.UTC(y!, mo! - 1 + n, 1))
  return t.toISOString().slice(0, 7)
}
const lastDay = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return `${m}-${String(new Date(Date.UTC(y!, mo!, 0)).getUTCDate()).padStart(2, '0')}`
}

function WeeklyCard({ weekStart, tz }: { weekStart: string; tz: string }) {
  const q = useQuery({ queryKey: ['weekly', weekStart], queryFn: () => api<Weekly>(`/api/me/weekly?weekStart=${weekStart}`) })
  const fmt = (ms: number) => new Intl.DateTimeFormat('ko-KR', { timeZone: tz, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)
  return (
    <section className="card card-tint">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
        주간 쉼표 리포트 <span className="text-[13px] text-ink-3">{weekStart.slice(5).replace('-', '.')} 주</span>
      </h2>
      {q.isPending ? (
        <span className="skeleton-text" />
      ) : q.error ? (
        <p className="text-ink-3">리포트를 불러오지 못했어요.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
          <div>
            <p className="text-[13px] text-ink-3">실제 사용</p>
            <p className="num text-[28px] leading-tight">{formatDuration(q.data.actualMs)}</p>
            {q.data.changeRatio !== null && (
              <p className={`chip ${q.data.changeRatio <= 0 ? 'chip-met' : 'chip-near'}`}>
                지난주보다 {Math.abs(Math.round(q.data.changeRatio * 100))}% {q.data.changeRatio <= 0 ? '줄었어요' : '늘었어요'}
              </p>
            )}
          </div>
          <div>
            <p className="text-[13px] text-ink-3">쉼표</p>
            <p className="num text-[28px] leading-tight">{q.data.rests}번</p>
            <p className="text-[13px] text-ink-3">목표 지킨 날 {q.data.goalDaysMet}일</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-3">가장 늘어난 앱</p>
            <p className="font-bold">{q.data.topIncrease ? `${q.data.topIncrease.label ?? q.data.topIncrease.packageName} +${formatDuration(q.data.topIncrease.deltaMs)}` : '없어요'}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-3">가장 길게 쉰 시간</p>
            <p className="font-bold">
              {q.data.longestBreak ? `${formatDuration(q.data.longestBreak.to - q.data.longestBreak.from)}` : '기록 없음'}
            </p>
            {q.data.longestBreak && <p className="text-[13px] text-ink-3">{fmt(q.data.longestBreak.from)}부터</p>}
          </div>
        </div>
      )}
    </section>
  )
}

export default function HistoryPage() {
  useAppBar('기록')
  const me = useMe()
  const tz = me.data?.user.timezone ?? 'Asia/Seoul'
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(Date.now())
  const [month, setMonth] = useState(monthOf(todayStr))
  const [selected, setSelected] = useState(todayStr)
  const days = useQuery({
    queryKey: ['days', month],
    queryFn: () => api<DaysResponse>(`/api/me/days?from=${month}-01&to=${lastDay(month)}`),
  })
  const detail = useToday(selected === todayStr ? undefined : selected)

  const calDays = useMemo(() => {
    const out: Record<string, CalendarDay> = {}
    for (const d of days.data?.days ?? []) out[d.date] = { actualMs: d.actualMs, status: null, rests: days.data?.rests[d.date] ?? 0 }
    for (const r of days.data?.goalResults ?? []) if (r.type === 'daily_actual' && out[r.date]) out[r.date]!.status = r.status
    return out
  }, [days.data])

  const weekStartDay = me.data?.group?.weekStart ?? 0
  const weekStart = addDays(selected, -((weekdayOf(selected) - weekStartDay + 7) % 7))

  const columns = useMemo(
    () => [
      { field: 'app', headerName: '앱', flex: 2, minWidth: 140 },
      { field: 'device', headerName: '기기', flex: 1, minWidth: 100, filterable: true },
      { field: 'start', headerName: '시작', width: 90 },
      { field: 'end', headerName: '종료', width: 90 },
      { field: 'length', headerName: '길이', width: 100, sortable: true },
    ],
    [],
  )
  const rows = useMemo(() => {
    const d = detail.data
    if (!d) return []
    const t = (ms: number) => new Intl.DateTimeFormat('ko-KR', { timeZone: d.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)
    const devName = new Map(d.devices.map((x) => [x.id, x.name]))
    return d.sessions
      .filter((s) => (s.endedAt ?? d.now) > d.dayStart)
      .map((s, i) => ({
        id: `${i}`,
        app: d.apps[s.packageName]?.label ?? s.packageName,
        device: devName.get(s.deviceId) ?? '기기',
        start: t(Math.max(s.startedAt, d.dayStart)),
        end: s.endedAt ? t(Math.min(s.endedAt, d.dayEnd)) : '사용 중',
        length: formatDuration(Math.min(s.endedAt ?? d.now, d.dayEnd) - Math.max(s.startedAt, d.dayStart)),
      }))
  }, [detail.data])

  const rests = useMemo(
    () => (detail.data?.rests ?? []).map((r) => [Date.parse(r.startsAt), Date.parse(r.endsAt)] as Interval),
    [detail.data?.rests],
  )

  return (
    <div className="grid gap-4">
      <section className="card">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button type="button" className="icon-btn" aria-label="이전 달" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft size={20} aria-hidden />
          </button>
          <h2 className="text-[20px]" aria-live="polite">
            {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
          </h2>
          <button type="button" className="icon-btn" aria-label="다음 달" disabled={month >= monthOf(todayStr)} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
        {days.isPending ? (
          <div className="skeleton h-[320px]" />
        ) : (
          <CommaCalendar month={month} days={calDays} today={todayStr} selected={selected} onSelect={setSelected} />
        )}
        <p className="text-[13px] text-ink-3 mt-2">
          찬 쉼표는 목표를 지킨 날, 반쯤 찬 쉼표는 목표에 가까웠던 날, 코랄 쉼표는 넘긴 날이에요. 쉼표가 클수록 많이 쓴 날이에요.
        </p>
      </section>

      <WeeklyCard weekStart={weekStart} tz={tz} />

      <section className="card">
        <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
          {Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일
          {detail.data && (
            <span className="text-[13px] text-ink-3">
              실제 <span className="num">{formatDuration(detail.data.actualMs)}</span>, 총 <span className="num">{formatDuration(detail.data.totalMs)}</span>
            </span>
          )}
        </h2>
        {detail.isPending ? (
          <div className="skeleton h-[160px]" />
        ) : detail.data ? (
          <TimelineRibbon
            sessions={detail.data.sessions}
            apps={detail.data.apps}
            devices={detail.data.devices}
            dayStart={detail.data.dayStart}
            dayEnd={detail.data.dayEnd}
            now={detail.data.now}
            timeZone={detail.data.timeZone}
            rests={rests}
          />
        ) : null}
      </section>

      <section className="card p-0 overflow-hidden">
        <h2 className="mb-3 flex items-baseline justify-between gap-3 px-5 pt-5 text-lg">
          사용 구간 <span className="text-[13px] text-ink-3">{rows.length}개</span>
        </h2>
        <div className="h-[420px] flex">
          <DataGrid
            rowData={rows}
            columnDefs={columns}
            getRowId={(p: { data: { id: string } }) => p.data.id}
            isLoading={detail.isPending}
            emptyMessage="이 날은 기록된 사용 구간이 없어요."
          />
        </div>
      </section>
    </div>
  )
}
