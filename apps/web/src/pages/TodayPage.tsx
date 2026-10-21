import { formatDuration, type Interval } from '@iman/core'
import { useQueryClient } from '@tanstack/react-query'
import { Coffee, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { BarActions, useAppBar } from '../components/AppShell'
import { CommaGauge, type CommaStatus } from '../components/brand/Comma'
import { TimelineRibbon } from '../components/brand/TimelineRibbon'
import { PauseBanner } from '../components/PauseBanner'
import { isNative, native, type NativeStatus } from '../lib/native'
import { useBoard, useMe, useToday } from '../lib/queries'
import { CATEGORY_LABEL, type Today } from '../lib/types'

const BASELINE_MIN = 240
const DEVICE_COLOR = ['bg-comma', 'bg-comma-deep', 'bg-ink-3']
const STATUS_TEXT: Record<CommaStatus, string> = {
  met: '목표 안에서 잘 쓰고 있어요',
  near: '목표에 가까워졌어요',
  over: '오늘 목표를 넘었어요',
  none: '목표를 정하면 쉼표가 채워져요',
}

function Hero({ t, metric, setMetric }: { t: Today; metric: 'actual' | 'total'; setMetric: (m: 'actual' | 'total') => void }) {
  const daily = t.goals.find((g) => g.type === 'daily_actual' && g.active && g.activeToday)
  const status: CommaStatus = daily ? daily.evaluation.status : 'none'
  const targetMin = daily?.target ?? BASELINE_MIN
  const ratio = t.actualMs / (targetMin * 60_000)
  const value = metric === 'actual' ? t.actualMs : t.totalMs
  const remain = daily ? daily.target * 60_000 - t.actualMs : null
  return (
    <section className="card grid justify-items-center gap-6 p-6 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:justify-items-stretch sm:text-left" aria-label="오늘 사용시간">
      <CommaGauge ratio={ratio} status={status} active={t.activeNow} size={132} label={`목표 대비 ${Math.round(ratio * 100)}퍼센트 사용`} />
      <div className="grid justify-items-center gap-2 sm:justify-items-start">
        <div className="segmented" role="group" aria-label="사용시간 기준">
          <button type="button" aria-pressed={metric === 'actual'} onClick={() => setMetric('actual')}>
            실제 사용
          </button>
          <button type="button" aria-pressed={metric === 'total'} onClick={() => setMetric('total')}>
            총 사용
          </button>
        </div>
        <p className="text-[clamp(38px,7vw,56px)] leading-[1.05] tracking-[-0.02em] num" aria-live="polite">
          {formatDuration(value)}
        </p>
        <p className="text-sm text-ink-3">
          {metric === 'actual'
            ? `앱을 동시에 띄운 ${formatDuration(t.overlapMs)}을 한 번만 셌어요`
            : `모든 앱 사용시간을 더하면 이만큼이에요. 동시 실행 ${formatDuration(t.overlapMs)} 포함`}
        </p>
        <div className="flex items-center flex-wrap gap-[6px]">
          <span className={`chip chip-${status === 'none' ? 'met' : status}`}>{STATUS_TEXT[status]}</span>
          {remain !== null && remain > 0 && <span className="chip">{formatDuration(remain)} 남음</span>}
          <span className="chip">화면 켬 {t.pickups}번</span>
          {t.activeNow && <span className="chip chip-now">지금 사용 중</span>}
        </div>
        {!daily && (
          <Link to="/me/goals" className="text-[13px] text-ink-3">
            하루 목표 정하기
          </Link>
        )}
      </div>
    </section>
  )
}

function TopApps({ t }: { t: Today }) {
  const rows = Object.entries(t.byApp)
    .sort((a, b) => b[1].actualMs - a[1].actualMs)
    .slice(0, 6)
  const max = rows[0]?.[1].actualMs ?? 1
  return (
    <section className="card">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
        많이 쓴 앱 <span className="text-[13px] text-ink-3">실제 사용 기준</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-3">아직 기록이 없어요.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {rows.map(([pkg, v]) => (
            <li key={pkg}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-semibold">
                  {t.apps[pkg]?.label ?? pkg}
                  <span className="text-[13px] text-ink-3"> {CATEGORY_LABEL[t.apps[pkg]?.category ?? 'other'] ?? '기타'}</span>
                </span>
                <span className="num">{formatDuration(v.actualMs)}</span>
              </div>
              <div className="mt-1 h-2 rounded bg-surface-2" aria-hidden>
                <div className="h-full rounded bg-comma" style={{ width: `${(v.actualMs / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Devices({ t }: { t: Today }) {
  if (t.devices.length < 2) return null
  const total = Math.max(1, Object.values(t.byDevice).reduce((a, b) => a + b.actualMs, 0))
  return (
    <section className="card">
      <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">기기별</h2>
      <div className="mb-3 flex h-3.5 gap-[3px]" aria-hidden>
        {t.devices.map((d, i) => (
          <span key={d.id} className={`min-w-1 rounded-[7px] ${DEVICE_COLOR[Math.min(i, 2)]}`} style={{ flexGrow: t.byDevice[d.id]?.actualMs ?? 0 }} />
        ))}
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {t.devices.map((d, i) => (
          <li key={d.id} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${DEVICE_COLOR[Math.min(i, 2)]}`} aria-hidden />
              {d.name}
            </span>
            <span className="num">
              {formatDuration(t.byDevice[d.id]?.actualMs ?? 0)}
              <span className="text-[13px] text-ink-3"> {Math.round(((t.byDevice[d.id]?.actualMs ?? 0) / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function TodayPage() {
  useAppBar('오늘')
  const qc = useQueryClient()
  const me = useMe()
  const today = useToday()
  const board = useBoard(!!me.data?.group)
  const [metric, setMetric] = useState<'actual' | 'total'>('actual')
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [resting, setResting] = useState(false)

  const sync = async () => {
    setSyncing(true)
    try {
      if (isNative) {
        await native.syncNow().catch(() => {})
        setNativeStatus(await native.getStatus())
      }
      await qc.invalidateQueries({ queryKey: ['today'] })
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (isNative) void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rests = useMemo(
    () => (today.data?.rests ?? []).map((r) => [Date.parse(r.startsAt), Date.parse(r.endsAt)] as Interval),
    [today.data?.rests],
  )

  const startRest = async () => {
    await native.startRest({ minutes: 30, source: 'app' })
    setResting(true)
    void qc.invalidateQueries({ queryKey: ['today'] })
  }

  return (
    <div className="grid gap-4">
      <BarActions>
        {isNative && (
          <button type="button" className="icon-btn" aria-label="이만, 30분 쉬기" title="이만, 30분 쉬기" onClick={startRest}>
            <Coffee size={20} aria-hidden />
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="새로 고침" title="새로 고침" onClick={sync} disabled={syncing}>
          <RefreshCw size={20} aria-hidden className={syncing ? 'animate-spin' : undefined} />
        </button>
      </BarActions>

      {nativeStatus && !nativeStatus.usagePermission && (
        <Link to="/onboarding/permission" className="card flex items-center gap-2.5 px-[18px] py-3.5 font-semibold no-underline bg-near-tint text-near-ink shadow-none">
          <TriangleAlert size={20} aria-hidden /> 사용 기록 접근 권한이 꺼져 있어 기록이 멈췄어요. 눌러서 다시 허용해 주세요.
        </Link>
      )}

      {board.data?.pause && <PauseBanner pause={board.data.pause} me={me.data?.user.id ?? ''} />}

      {resting && (
        <div className="card card-tint flex items-center gap-2.5 px-[18px] py-3.5 font-semibold no-underline animate-comma-drop" role="status">
          이만, 쉬어 가요. 30분 뒤에 "잘 쉬었어요" 하고 알려 드릴게요.
        </div>
      )}

      {today.isPending ? (
        <section className="card grid justify-items-center gap-6 p-6 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:justify-items-stretch sm:text-left">
          <div className="skeleton w-[132px] h-[165px] rounded-[60px]" />
          <div className="grid justify-items-center gap-2 sm:justify-items-start">
            <span className="skeleton-text w-[160px] h-[34px]" />
            <span className="skeleton-text w-[80%]" />
          </div>
        </section>
      ) : today.error ? (
        <div className="empty">오늘 기록을 불러오지 못했어요.</div>
      ) : (
        <>
          <Hero t={today.data} metric={metric} setMetric={setMetric} />
          <section className="card">
            <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
              타임라인 <span className="text-[13px] text-ink-3">빗금은 앱을 동시에 띄운 시간</span>
            </h2>
            <TimelineRibbon
              sessions={today.data.sessions}
              apps={today.data.apps}
              devices={today.data.devices}
              dayStart={today.data.dayStart}
              dayEnd={today.data.dayEnd}
              now={today.data.now}
              timeZone={today.data.timeZone}
              rests={rests}
            />
          </section>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
            <TopApps t={today.data} />
            <Devices t={today.data} />
          </div>
        </>
      )}
    </div>
  )
}
