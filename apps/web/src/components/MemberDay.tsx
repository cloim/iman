import { addDays, type Interval } from '@iman/core'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useBoard, useMe } from '../lib/queries'
import { VISIBILITY_LABEL, type Today } from '../lib/types'
import { TimelineHeatmap } from './brand/TimelineHeatmap'
import { CategoryBars, Devices, Hero, HourChart, TopApps } from './DaySections'
import SelectControl from './SelectControl'

/**
 * 관리자용 구성원 고르기. 앱 바 버튼 줄에 한 줄로 놓는다.
 * value 가 빈 문자열이면 기본 항목(나)이고, 관리자가 아니면 아무것도 그리지 않는다
 */
export function MemberPicker({ value, onChange, emptyLabel }: { value: string; onChange: (userId: string) => void; emptyLabel: string }) {
  const me = useMe()
  const isLeader = me.data?.group?.role === 'leader'
  const board = useBoard(isLeader)
  if (!isLeader) return null
  const others = (board.data?.members ?? []).filter((m) => m.userId !== me.data?.user.id)
  return (
    <SelectControl
      aria-label="내역을 볼 구성원"
      title="내역을 볼 구성원"
      wrapperClassName="w-auto max-w-[180px]"
      className="min-h-9 rounded-full text-sm font-semibold"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {others.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </SelectControl>
  )
}

/** 관리자가 보는 구성원의 하루 내역. 그 구성원에게 적용된 공개 수준만큼만 보인다. 구성원이 바뀌면 key 로 새로 그린다 */
export function MemberDay({ userId }: { userId: string }) {
  const [date, setDate] = useState<string | undefined>()
  const [metric, setMetric] = useState<'actual' | 'total'>('actual')
  const q = useQuery({
    queryKey: ['member-day', userId, date ?? 'now'],
    queryFn: () => api<Today>(`/api/group/members/${userId}/day${date ? `?date=${date}` : ''}`),
    refetchInterval: date ? false : 60_000,
  })
  const t = q.data
  const rests = useMemo(
    () => (t?.rests ?? []).map((r) => [Date.parse(r.startsAt), Date.parse(r.endsAt)] as Interval),
    [t?.rests],
  )
  // 날짜를 고르기 전 응답의 날짜가 그 사람 시간대의 오늘이다. 다음 날 버튼의 끝으로 쓴다
  const [todayStr, setTodayStr] = useState<string>()
  useEffect(() => {
    if (t && !date) setTodayStr(t.date)
  }, [t, date])
  const shown = date ?? t?.date

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="icon-btn"
          aria-label="전날"
          disabled={!shown}
          onClick={() => shown && setDate(addDays(shown, -1))}
        >
          <ChevronLeft size={20} aria-hidden />
        </button>
        <p className="font-display text-lg" aria-live="polite">
          {shown
            ? `${Number(shown.slice(5, 7))}월 ${Number(shown.slice(8))}일${shown === todayStr ? ' 오늘' : ''}`
            : ' '}
        </p>
        <button
          type="button"
          className="icon-btn"
          aria-label="다음 날"
          disabled={!shown || !todayStr || shown >= todayStr}
          onClick={() =>
            shown && setDate(addDays(shown, 1) >= todayStr! ? undefined : addDays(shown, 1))
          }
        >
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      {q.isPending ? (
        <div className="skeleton h-[220px] rounded-card" />
      ) : q.error || !t ? (
        <div className="empty">내역을 불러오지 못했어요.</div>
      ) : (
        <>
          <Hero t={t} metric={metric} setMetric={setMetric} />
          {t.level && t.level !== 'app' && (
            <p className="text-[13px] text-ink-3">
              이 구성원의 공개 수준({VISIBILITY_LABEL[t.level]})에 맞춰 보여요.
            </p>
          )}
          {t.level === 'app' ? (
            <>
              <section className="card">
                <h2 className="mb-3 text-lg">타임라인</h2>
                <TimelineHeatmap
                  sessions={t.sessions}
                  apps={t.apps}
                  devices={t.devices}
                  dayStart={t.dayStart}
                  dayEnd={t.dayEnd}
                  now={t.now}
                  timeZone={t.timeZone}
                  rests={rests}
                />
              </section>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                <TopApps t={t} metric={metric} />
                <Devices t={t} />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
              <HourChart t={t} />
              {t.level === 'category' && <CategoryBars t={t} metric={metric} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}
