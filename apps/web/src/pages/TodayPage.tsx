import { type Interval } from '@iman/core'
import { useQueryClient } from '@tanstack/react-query'
import { Coffee, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { BarActions, useAppBar } from '../components/AppShell'
import { TimelineHeatmap } from '../components/brand/TimelineHeatmap'
import { Devices, Hero, TopApps } from '../components/DaySections'
import { GoalsModal } from '../components/GoalsModal'
import { MemberDay, MemberPicker } from '../components/MemberDay'
import { Modal } from '../components/Modal'
import { PauseBanner } from '../components/PauseBanner'
import { isNative, native, type NativeStatus } from '../lib/native'
import { useBoard, useMe, useRestState, useToday } from '../lib/queries'

export default function TodayPage() {
  useAppBar('오늘')
  const qc = useQueryClient()
  const me = useMe()
  const today = useToday()
  const board = useBoard(!!me.data?.group)
  const [metric, setMetric] = useState<'actual' | 'total'>('actual')
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const rest = useRestState()
  const [startingRest, setStartingRest] = useState(false)
  const [restError, setRestError] = useState('')
  const resting = (rest.data?.endsAt ?? 0) > Date.now()
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const member = params.get('member') ?? ''

  const sync = async () => {
    setSyncing(true)
    try {
      if (isNative) {
        await native.syncNow().catch(() => {})
        setNativeStatus(await native.getStatus())
      }
      await qc.invalidateQueries({ queryKey: ['today'] })
      await qc.invalidateQueries({ queryKey: ['member-day'] })
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (isNative) void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rests = useMemo(
    () =>
      (today.data?.rests ?? []).map(
        (r) => [Date.parse(r.startsAt), Date.parse(r.endsAt)] as Interval,
      ),
    [today.data?.rests],
  )

  const startRest = async () => {
    setStartingRest(true)
    try {
      await native.startRest({ minutes: 30, source: 'app' })
      await qc.invalidateQueries({ queryKey: ['native-rest'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    } catch {
      setRestError('쉬기를 시작하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setStartingRest(false)
    }
  }

  return (
    <div className="grid gap-4">
      <BarActions>
        <MemberPicker
          value={member}
          onChange={(id) => setParams(id ? { member: id } : {}, { replace: true })}
          emptyLabel="나"
        />
        {isNative && (
          <button
            type="button"
            className="icon-btn"
            aria-label="이만, 30분 쉬기"
            title="이만, 30분 쉬기"
            onClick={startRest}
            disabled={startingRest || resting || !rest.data}
          >
            <Coffee size={20} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label="새로 고침"
          title="새로 고침"
          onClick={sync}
          disabled={syncing}
        >
          <RefreshCw size={20} aria-hidden className={syncing ? 'animate-spin' : undefined} />
        </button>
      </BarActions>

      {nativeStatus && !nativeStatus.usagePermission && (
        <Link
          to="/onboarding/permission"
          className="card flex items-center gap-2.5 px-[18px] py-3.5 font-semibold no-underline bg-near-tint text-near-ink shadow-none"
        >
          <TriangleAlert size={20} aria-hidden /> 사용 기록 접근 권한이 꺼져 있어 기록이 멈췄어요.
          눌러서 다시 허용해 주세요.
        </Link>
      )}

      {board.data?.pause && (
        <PauseBanner
          pause={board.data.pause}
          me={me.data?.user.id ?? ''}
          isLeader={me.data?.group?.role === 'leader'}
        />
      )}

      <Modal isOpen={!!restError} onClose={() => setRestError('')} title="쉬기"><p>{restError}</p></Modal>

      {member ? (
        <MemberDay key={member} userId={member} />
      ) : today.isPending ? (
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
          <Hero
            t={today.data}
            metric={metric}
            setMetric={setMetric}
            onGoals={() => setGoalsOpen(true)}
          />
          <section className="card">
            <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">
              타임라인{' '}
              <span className="text-[13px] text-ink-3">칸을 누르거나 올리면 자세히 보여요</span>
            </h2>
            <TimelineHeatmap
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
            <TopApps t={today.data} metric={metric} />
            <Devices t={today.data} />
          </div>
        </>
      )}

      <GoalsModal isOpen={goalsOpen} onClose={() => setGoalsOpen(false)} today={today.data} />
    </div>
  )
}
