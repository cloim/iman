import { formatDuration } from '@iman/core'
import { Plus, Target } from 'lucide-react'
import { Bar, Doughnut } from 'react-chartjs-2'
import { APP_PALETTE, tooltipStyle, useChartColors } from '../lib/chart'
import { CATEGORY_LABEL, type Today } from '../lib/types'
import { CommaGauge, type CommaStatus } from './brand/Comma'

/** 하루 내역 카드들. 내 오늘 화면과 관리자가 보는 구성원 내역이 함께 쓴다 */

const BASELINE_MIN = 240
const STATUS_TEXT: Record<Exclude<CommaStatus, 'none'>, string> = {
  met: '목표 안에서 잘 쓰고 있어요',
  near: '목표에 가까워졌어요',
  over: '목표를 넘었어요',
}

export function Hero({
  t,
  metric,
  setMetric,
  onGoals,
}: {
  t: Today
  metric: 'actual' | 'total'
  setMetric: (m: 'actual' | 'total') => void
  onGoals?: () => void
}) {
  const daily = t.goals.find((g) => g.type === 'daily_actual' && g.active && g.activeToday)
  const status: CommaStatus = daily ? daily.evaluation.status : 'none'
  const targetMin = daily?.target ?? (t.baselineMin ?? BASELINE_MIN)
  const ratio = t.actualMs / (targetMin * 60_000)
  const value = metric === 'actual' ? t.actualMs : t.totalMs
  const remain = daily ? daily.target * 60_000 - t.actualMs : null
  const hasGoal = t.goals.some((g) => g.active)
  return (
    <section
      className={`card relative grid justify-items-center gap-6 p-6 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:justify-items-stretch sm:pt-6 sm:text-left ${onGoals ? 'pt-16' : ''}`}
      aria-label="오늘 사용시간"
    >
      {onGoals && (
        <button
          type="button"
          className="btn btn-ghost btn-sm absolute top-4 right-4"
          onClick={onGoals}
        >
          {hasGoal ? <Target size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
          {hasGoal ? '내 목표 보기' : '하루 목표 정하기'}
        </button>
      )}
      <CommaGauge
        ratio={ratio}
        over={status === 'over'}
        active={t.activeNow}
        size={132}
        label={
          daily
            ? `하루 목표 대비 ${Math.round(ratio * 100)}퍼센트 사용`
            : `실제 사용 ${formatDuration(t.actualMs)}`
        }
      />
      <div className="grid justify-items-center gap-2 sm:justify-items-start">
        <div className="segmented" role="group" aria-label="사용시간 기준">
          <button
            type="button"
            aria-pressed={metric === 'actual'}
            onClick={() => setMetric('actual')}
          >
            실제 사용
          </button>
          <button
            type="button"
            aria-pressed={metric === 'total'}
            onClick={() => setMetric('total')}
          >
            총 사용
          </button>
        </div>
        <p
          className="text-[clamp(38px,7vw,56px)] leading-[1.05] tracking-[-0.02em] num"
          aria-live="polite"
        >
          {formatDuration(value)}
        </p>
        <p className="text-sm text-ink-3">
          {metric === 'actual'
            ? `동시 실행된 시간(${formatDuration(t.overlapMs)})은 합산되지 않아요`
            : '동시 실행과 상관없이 모든 앱 사용시간을 더했어요'}
        </p>
        <div className="flex flex-wrap items-center gap-[6px]">
          {status !== 'none' && (
            <span className={`chip chip-${status}`}>{STATUS_TEXT[status]}</span>
          )}
          {remain !== null && remain > 0 && (
            <span className="chip">{formatDuration(remain)} 남음</span>
          )}
          <span className="chip">화면 켬 {t.pickups}번</span>
          {t.activeNow && <span className="chip chip-now">지금 사용 중</span>}
        </div>
      </div>
    </section>
  )
}

export function TopApps({ t, metric }: { t: Today; metric: 'actual' | 'total' }) {
  const c = useChartColors()
  const pick = (v: { actualMs: number; totalMs: number }) =>
    metric === 'actual' ? v.actualMs : v.totalMs
  const rows = Object.entries(t.byApp)
    .sort((a, b) => pick(b[1]) - pick(a[1]))
    .slice(0, 6)
  const label = (pkg: string) => t.apps[pkg]?.label ?? pkg
  return (
    <section className="card">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
        많이 쓴 앱{' '}
        <span className="text-[13px] text-ink-3">
          {metric === 'actual' ? '실제 사용' : '총 사용'} 기준
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-3">아직 기록이 없어요.</p>
      ) : (
        <div
          style={{ height: rows.length * 40 + 8 }}
          role="img"
          aria-label={rows.map(([p, v]) => `${label(p)} ${formatDuration(pick(v))}`).join(', ')}
        >
          <Bar
            data={{
              labels: rows.map(([p]) => label(p)),
              datasets: [
                {
                  data: rows.map(([, v]) => pick(v)),
                  backgroundColor: rows.map((_, i) => APP_PALETTE[i % APP_PALETTE.length]!),
                  borderRadius: 6,
                  barThickness: 16,
                },
              ],
            }}
            options={{
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { display: false, beginAtZero: true },
                y: {
                  grid: { display: false },
                  border: { display: false },
                  ticks: { color: c['ink-2'], font: { size: 13, weight: 600 } },
                },
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  ...tooltipStyle(c),
                  callbacks: {
                    label: (item) => {
                      const [pkg, v] = rows[item.dataIndex]!
                      return [
                        `실제 사용 ${formatDuration(v.actualMs)}`,
                        `총 사용 ${formatDuration(v.totalMs)}`,
                        `카테고리 ${CATEGORY_LABEL[t.apps[pkg]?.category ?? 'other'] ?? '기타'}`,
                      ]
                    },
                  },
                },
              },
            }}
          />
        </div>
      )}
    </section>
  )
}

export function Devices({ t }: { t: Today }) {
  const c = useChartColors()
  if (t.devices.length < 2) return null
  const values = t.devices.map((d) => t.byDevice[d.id]?.actualMs ?? 0)
  const total = Math.max(
    1,
    values.reduce((a, b) => a + b, 0),
  )
  const colors = [c['comma-deep'], c.now, c['ink-3']]
  return (
    <section className="card">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">기기별</h2>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-4">
        <div
          className="size-[120px]"
          role="img"
          aria-label={t.devices.map((d, i) => `${d.name} ${formatDuration(values[i]!)}`).join(', ')}
        >
          <Doughnut
            data={{
              labels: t.devices.map((d) => d.name),
              datasets: [
                {
                  data: values,
                  backgroundColor: t.devices.map((_, i) => colors[Math.min(i, 2)]!),
                  borderWidth: 0,
                },
              ],
            }}
            options={{
              cutout: '62%',
              plugins: {
                legend: { display: false },
                tooltip: {
                  ...(tooltipStyle(c) as object),
                  callbacks: {
                    label: (item) =>
                      `${formatDuration(values[item.dataIndex]!)}, ${Math.round((values[item.dataIndex]! / total) * 100)}%`,
                  },
                },
              },
            }}
          />
        </div>
        <ul className="m-0 grid list-none gap-2 p-0">
          {t.devices.map((d, i) => (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 flex-none rounded-full"
                  style={{ background: colors[Math.min(i, 2)] }}
                  aria-hidden
                />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="num">
                {formatDuration(values[i]!)}
                <span className="text-[13px] text-ink-3">
                  {' '}
                  {Math.round((values[i]! / total) * 100)}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** 시간대별 실제 사용. 공개 수준이 요약만이어도 보이는 정보 */
export function HourChart({ t }: { t: Today }) {
  const c = useChartColors()
  const hours = t.byHour.map(Number)
  return (
    <section className="card">
      <h2 className="mb-3 text-lg">시간대별 사용</h2>
      <div
        className="h-[140px]"
        role="img"
        aria-label={
          hours
            .map((v, h) => (v ? `${h}시 ${formatDuration(v)}` : ''))
            .filter(Boolean)
            .join(', ') || '사용 없음'
        }
      >
        <Bar
          data={{
            labels: hours.map((_, h) => h),
            datasets: [
              {
                data: hours.map((v) => v / 60_000),
                backgroundColor: c['comma-deep'],
                borderRadius: 3,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                grid: { display: false },
                border: { display: false },
                ticks: { color: c['ink-3'], font: { size: 11 }, autoSkip: true, maxRotation: 0 },
              },
              y: {
                beginAtZero: true,
                suggestedMax: 60,
                border: { display: false },
                grid: { color: c.line },
                ticks: {
                  color: c['ink-3'],
                  font: { size: 11 },
                  maxTicksLimit: 4,
                  callback: (v) => `${v}분`,
                },
              },
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                ...tooltipStyle(c),
                callbacks: {
                  title: (items) => `${items[0]!.dataIndex}시`,
                  label: (item) => `실제 사용 ${formatDuration(hours[item.dataIndex]!)}`,
                },
              },
            },
          }}
        />
      </div>
    </section>
  )
}

/** 카테고리별 사용. 공개 수준이 카테고리까지일 때 앱 대신 보여 준다 */
export function CategoryBars({ t, metric }: { t: Today; metric: 'actual' | 'total' }) {
  const c = useChartColors()
  const pick = (v: { actualMs: number; totalMs: number }) =>
    metric === 'actual' ? v.actualMs : v.totalMs
  const rows = Object.entries(t.byCategory).sort((a, b) => pick(b[1]) - pick(a[1]))
  const label = (k: string) => CATEGORY_LABEL[k] ?? k
  return (
    <section className="card">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
        카테고리별{' '}
        <span className="text-[13px] text-ink-3">
          {metric === 'actual' ? '실제 사용' : '총 사용'} 기준
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-3">아직 기록이 없어요.</p>
      ) : (
        <div
          style={{ height: rows.length * 40 + 8 }}
          role="img"
          aria-label={rows.map(([k, v]) => `${label(k)} ${formatDuration(pick(v))}`).join(', ')}
        >
          <Bar
            data={{
              labels: rows.map(([k]) => label(k)),
              datasets: [
                {
                  data: rows.map(([, v]) => pick(v)),
                  backgroundColor: rows.map((_, i) => APP_PALETTE[i % APP_PALETTE.length]!),
                  borderRadius: 6,
                  barThickness: 16,
                },
              ],
            }}
            options={{
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { display: false, beginAtZero: true },
                y: {
                  grid: { display: false },
                  border: { display: false },
                  ticks: { color: c['ink-2'], font: { size: 13, weight: 600 } },
                },
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  ...tooltipStyle(c),
                  callbacks: {
                    label: (item) => [
                      `실제 사용 ${formatDuration(rows[item.dataIndex]![1].actualMs)}`,
                      `총 사용 ${formatDuration(rows[item.dataIndex]![1].totalMs)}`,
                    ],
                  },
                },
              },
            }}
          />
        </div>
      )}
    </section>
  )
}
