import { addDays, formatDuration, weekdayOf, type Interval } from '@iman/core'
import { useQuery } from '@tanstack/react-query'
import type { ChartDataset } from 'chart.js'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Bar } from 'react-chartjs-2'
import { useSearchParams } from 'react-router'
import { BarActions, useAppBar } from '../components/AppShell'
import { CommaCalendar, type CalendarDay } from '../components/brand/CommaCalendar'
import { TimelineHeatmap } from '../components/brand/TimelineHeatmap'
import { DataGrid } from '../components/DataGrid'
import { CategoryBars, HourChart } from '../components/DaySections'
import { MemberPicker } from '../components/MemberDay'
import { api } from '../lib/api'
import { tooltipStyle, useChartColors } from '../lib/chart'
import { useMe, useToday } from '../lib/queries'
import { VISIBILITY_LABEL, type Today } from '../lib/types'

interface DaysResponse {
  days: { date: string; totalMs: number; actualMs: number }[]
  goalResults: { date: string; status: 'met' | 'near' | 'over'; type: string; target: number }[]
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
  days: {
    date: string
    actualMs: number
    goal: { status: 'met' | 'near' | 'over'; targetMin: number } | null
  }[]
  avgActualMs: number
}

const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일']

/** 값이 있는 열은 모두 값 길이에 맞추고, 남는 폭은 끝의 빈 열이 채운다 */
const FIT_COLUMNS = ['app', 'device', 'start', 'end', 'length']
const FILL_COLUMN = { field: 'fill', headerName: '', flex: 1, minWidth: 0, sortable: false }
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

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5 [overflow-wrap:anywhere]">
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="font-bold">{value}</p>
      {sub && <p className="text-[13px] text-ink-3">{sub}</p>}
    </div>
  )
}

function WeeklyCard({
  base,
  weekStart,
  tz,
  today,
  goalMin,
}: {
  base: string
  weekStart: string
  tz: string
  today: string
  goalMin: number | null
}) {
  const c = useChartColors()
  const q = useQuery({
    queryKey: ['weekly', base, weekStart],
    queryFn: () => api<Weekly>(`${base}/weekly?weekStart=${weekStart}`),
  })
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz,
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(ms)
  const w = q.data
  const targets = (w?.days ?? []).map((d) => d.goal?.targetMin ?? goalMin)
  return (
    <section className="card card-tint min-w-0">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
        주간 쉼표 리포트{' '}
        <span className="text-[13px] text-ink-3">{weekStart.slice(5).replace('-', '.')} 주</span>
      </h2>
      {q.isPending ? (
        <div className="grid gap-3">
          <div className="skeleton h-[160px]" />
          <span className="skeleton-text" />
        </div>
      ) : q.error || !w ? (
        <p className="text-ink-3">리포트를 불러오지 못했어요.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <div
            className="h-[168px]"
            role="img"
            aria-label={w.days
              .map((d) => `${WEEKDAY[weekdayOf(d.date)]} ${formatDuration(d.actualMs)}`)
              .join(', ')}
          >
            <Bar
              data={{
                labels: w.days.map(
                  (d) => `${WEEKDAY[weekdayOf(d.date)]} ${Number(d.date.slice(8))}`,
                ),
                datasets: [
                  {
                    data: w.days.map((d) => d.actualMs / 3_600_000),
                    backgroundColor: w.days.map((d) =>
                      d.goal?.status === 'over'
                        ? c.over
                        : d.date > today
                          ? c.line
                          : c['comma-deep'],
                    ),
                    borderRadius: 8,
                    maxBarThickness: 34,
                    order: 2,
                  },
                  // 하루 목표 기준선. 그날 판정된 목표가 없으면 지금 목표로 그린다
                  ...(targets.some((x) => x !== null)
                    ? ([
                        {
                          type: 'line' as const,
                          label: '하루 목표',
                          data: targets.map((x) => (x === null ? null : x / 60)),
                          borderColor: c['ink-3'],
                          borderWidth: 1.5,
                          borderDash: [5, 4],
                          pointRadius: 0,
                          pointHitRadius: 8,
                          stepped: 'middle' as const,
                          order: 1,
                        },
                        // 막대와 선을 섞은 차트라 막대 차트 타입에 맞춰 넘긴다
                      ] as unknown as ChartDataset<'bar', (number | null)[]>[])
                    : []),
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: c['ink-3'], font: { size: 12, weight: 600 } },
                  },
                  y: {
                    beginAtZero: true,
                    // 기록이 없는 주에도 축과 눈금이 보이게 기본 범위를 둔다
                    suggestedMax: Math.max(4, ...targets.map((x) => (x ?? 0) / 60 + 1)),
                    border: { display: false },
                    grid: { color: c.line },
                    ticks: {
                      color: c['ink-3'],
                      font: { size: 11 },
                      maxTicksLimit: 5,
                      precision: 0,
                      callback: (v) => `${v}시간`,
                    },
                  },
                },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipStyle(c),
                    callbacks: {
                      title: (items) => {
                        const d = w.days[items[0]!.dataIndex]!
                        return `${Number(d.date.slice(5, 7))}월 ${Number(d.date.slice(8))}일 ${WEEKDAY[weekdayOf(d.date)]}요일`
                      },
                      label: (item) => {
                        const d = w.days[item.dataIndex]!
                        if (item.datasetIndex === 1)
                          return `하루 목표 ${formatDuration(targets[item.dataIndex]! * 60_000)}`
                        const out = [`실제 사용 ${formatDuration(d.actualMs)}`]
                        if (d.goal)
                          out.push(
                            `하루 목표 ${formatDuration(d.goal.targetMin * 60_000)}, ${d.goal.status === 'over' ? '넘겼어요' : '지켰어요'}`,
                          )
                        return out
                      },
                    },
                  },
                },
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
            <Stat
              label="주간 평균 실제 사용"
              value={<span className="num text-[22px]">{formatDuration(w.avgActualMs)}</span>}
              sub={
                w.changeRatio === null ? (
                  '지난주 기록이 없어요'
                ) : (
                  <span className={`chip ${w.changeRatio <= 0 ? 'chip-met' : 'chip-near'}`}>
                    지난주보다 {w.changeRatio > 0 ? '+' : ''}
                    {Math.round(w.changeRatio * 100)}%
                  </span>
                )
              }
            />
            <Stat
              label="목표 지킨 날"
              value={<span className="num text-[22px]">{w.goalDaysMet}일</span>}
              sub={`${w.days.filter((d) => d.goal).length}일 중`}
            />
            <Stat
              label="가장 늘어난 앱"
              value={w.topIncrease ? (w.topIncrease.label ?? w.topIncrease.packageName) : '없어요'}
              sub={w.topIncrease && `+${formatDuration(w.topIncrease.deltaMs)}`}
            />
            <Stat
              label="가장 길게 쉰 시간"
              value={
                w.longestBreak
                  ? formatDuration(w.longestBreak.to - w.longestBreak.from)
                  : '기록 없음'
              }
              sub={w.longestBreak && `${fmt(w.longestBreak.from)}부터`}
            />
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
  // 관리자는 구성원을 골라 그 사람의 기록을 본다. 공개 수준만큼만 서버가 보낸다
  const [params, setParams] = useSearchParams()
  const member = params.get('member') ?? ''
  const base = member ? `/api/group/members/${member}` : '/api/me'
  const days = useQuery({
    queryKey: ['days', base, month],
    queryFn: () => api<DaysResponse>(`${base}/days?from=${month}-01&to=${lastDay(month)}`),
  })
  const mine = useToday(selected === todayStr ? undefined : selected)
  const theirs = useQuery({
    queryKey: ['member-day', member, selected],
    queryFn: () => api<Today>(`${base}/day?date=${selected}`),
    enabled: !!member,
  })
  const detail = member ? theirs : mine
  const now = useToday()
  const goalMin = member
    ? null
    : (now.data?.goals.find((g) => g.type === 'daily_actual' && g.active && g.activeToday)?.target ?? null)
  // 앱까지 공개가 아닌 구성원은 타임라인과 사용 구간 대신 시간대와 카테고리 차트를 본다
  const limited = !!detail.data?.level && detail.data.level !== 'app'

  const calDays = useMemo(() => {
    const out: Record<string, CalendarDay> = {}
    for (const d of days.data?.days ?? [])
      out[d.date] = {
        actualMs: d.actualMs,
        targetMin: null,
        status: null,
        rests: days.data?.rests[d.date] ?? 0,
      }
    for (const r of days.data?.goalResults ?? [])
      if (r.type === 'daily_actual' && out[r.date])
        Object.assign(out[r.date]!, { status: r.status, targetMin: r.target })
    return out
  }, [days.data])

  const weekStartDay = me.data?.group?.weekStart ?? 0
  const weekStart = addDays(selected, -((weekdayOf(selected) - weekStartDay + 7) % 7))

  const columns = useMemo(
    () => [
      { field: 'app', headerName: '앱', filterable: true },
      { field: 'device', headerName: '기기', filterable: true },
      { field: 'start', headerName: '시작' },
      { field: 'end', headerName: '종료' },
      {
        field: 'length',
        headerName: '길이',
        comparator: (
          _a: string,
          _b: string,
          x: { data: { lengthMs: number } },
          y: { data: { lengthMs: number } },
        ) => x.data.lengthMs - y.data.lengthMs,
      },
      FILL_COLUMN,
    ],
    [],
  )
  const rows = useMemo(() => {
    const d = detail.data
    if (!d) return []
    const t = (ms: number) =>
      new Intl.DateTimeFormat('ko-KR', {
        timeZone: d.timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(ms)
    const devName = new Map(d.devices.map((x) => [x.id, x.name]))
    return d.sessions
      .filter((s) => (s.endedAt ?? d.now) > d.dayStart)
      .map((s, i) => ({
        id: `${i}`,
        app: d.apps[s.packageName]?.label ?? s.packageName,
        device: devName.get(s.deviceId) ?? '기기',
        start: t(Math.max(s.startedAt, d.dayStart)),
        end: s.endedAt ? t(Math.min(s.endedAt, d.dayEnd)) : '사용 중',
        length: formatDuration(
          Math.min(s.endedAt ?? d.now, d.dayEnd) - Math.max(s.startedAt, d.dayStart),
        ),
        lengthMs: Math.min(s.endedAt ?? d.now, d.dayEnd) - Math.max(s.startedAt, d.dayStart),
      }))
  }, [detail.data])

  const rests = useMemo(
    () =>
      (detail.data?.rests ?? []).map(
        (r) => [Date.parse(r.startsAt), Date.parse(r.endsAt)] as Interval,
      ),
    [detail.data?.rests],
  )

  return (
    <div className="grid grid-cols-1 gap-4">
      <BarActions>
        <MemberPicker
          value={member}
          onChange={(id) => setParams(id ? { member: id } : {}, { replace: true })}
          emptyLabel="나"
        />
      </BarActions>

      <section className="card">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            type="button"
            className="icon-btn"
            aria-label="이전 달"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <h2 className="text-[20px]" aria-live="polite">
            {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="다음 달"
            disabled={month >= monthOf(todayStr)}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
        {days.isPending ? (
          <div className="skeleton h-[320px]" />
        ) : (
          <CommaCalendar
            month={month}
            days={calDays}
            today={todayStr}
            selected={selected}
            onSelect={setSelected}
            baselineMin={me.data?.group?.baselineMin}
          />
        )}
        <p className="text-[13px] text-ink-3 mt-2">
          사용량에 따라 쉼표가 채워 표시되고 목표를 넘긴 시간에 따라 붉어져요. 쉼표가 클수록 많이 쓴
          날이에요.
        </p>
      </section>

      <WeeklyCard base={base} weekStart={weekStart} tz={tz} today={todayStr} goalMin={goalMin} />

      <section className="card">
        <h2 className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-lg">
          {Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일
          {detail.data && (
            <span className="text-[13px] text-ink-3">
              실제 <span className="num">{formatDuration(detail.data.actualMs)}</span>, 총{' '}
              <span className="num">{formatDuration(detail.data.totalMs)}</span>
            </span>
          )}
        </h2>
        {detail.isPending ? (
          <div className="skeleton h-[160px]" />
        ) : limited && detail.data ? (
          <p className="text-[13px] text-ink-3">
            이 구성원의 공개 수준({VISIBILITY_LABEL[detail.data.level!]})에 맞춰 시간대와{' '}
            {detail.data.level === 'category' ? '카테고리별 사용' : '총량'}만 보여요.
          </p>
        ) : detail.data ? (
          <TimelineHeatmap
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

      {limited && detail.data && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
          <HourChart t={detail.data} />
          {detail.data.level === 'category' && <CategoryBars t={detail.data} metric="actual" />}
        </div>
      )}

      {!limited && (
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
              autoSizeStrategy={{ type: 'fitCellContents', colIds: FIT_COLUMNS }}
              onRowDataUpdated={(e: { api: { autoSizeColumns: (ids: string[]) => void } }) =>
                e.api.autoSizeColumns(FIT_COLUMNS)
              }
            />
          </div>
        </section>
      )}
    </div>
  )
}
