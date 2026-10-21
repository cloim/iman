import { localParts } from '@iman/core'
import { useQuery } from '@tanstack/react-query'
import { Maximize } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { COMMA_PATH, COMMA_VIEWBOX, Wordmark } from '../components/brand/Comma'
import { GroupSentence } from '../components/GroupSentence'
import { useCountdown } from '../components/PauseBanner'
import { api, ApiError } from '../lib/api'
import { kioskApi, loadKiosk, saveKiosk } from '../lib/kiosk'
import { useGroupEvents } from '../lib/queries'
import type { Board, Dashboard } from '../lib/types'

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}
function inWindow(nowMin: number, from: string, to: string) {
  const f = minutesOf(from)
  const t = minutesOf(to)
  return f <= t ? nowMin >= f && nowMin < t : nowMin >= f || nowMin < t
}

function PauseOverlay({ pause, members }: { pause: NonNullable<Board['pause']>; members: Board['members'] }) {
  const left = useCountdown(Date.parse(pause.endsAt))
  const names = members.filter((m) => pause.participants.includes(m.userId)).map((m) => m.name)
  return (
    <div className="absolute inset-0 z-[5] grid place-content-center justify-items-center gap-2 bg-paper/85 text-center backdrop-blur-sm" role="status">
      <svg viewBox={COMMA_VIEWBOX} width="112" height="162" aria-hidden className="animate-comma-drop">
        <path d={COMMA_PATH} fill="var(--comma)" />
      </svg>
      <p className="font-display text-[clamp(28px,4vw,52px)]">함께 쉬는 중</p>
      <p className="num text-[clamp(44px,7vw,96px)] leading-none">{left}</p>
      <p className="max-w-[70vw] text-[clamp(16px,1.8vw,24px)] text-ink-2">{names.join(', ')}</p>
    </div>
  )
}

/** /board: 연결된 대시보드로 보낸다 */
function BoardRedirect() {
  const kiosk = loadKiosk()
  const dashboards = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => api<{ dashboards: Dashboard[] }>('/api/group/dashboards'),
    enabled: !kiosk?.dashboardId,
    retry: false,
  })
  if (kiosk?.dashboardId) return <Navigate to={`/board/${kiosk.dashboardId}`} replace />
  if (dashboards.error instanceof ApiError && dashboards.error.status === 401) return <Navigate to="/login?next=/board" replace />
  if (dashboards.error) return <Navigate to="/role" replace />
  const first = dashboards.data?.dashboards[0]
  if (first) return <Navigate to={`/board/${first.id}`} replace />
  return <div className="min-h-dvh" aria-busy="true" />
}

export default function BoardPage() {
  const { dashboardId } = useParams()
  if (!dashboardId) return <BoardRedirect />
  return <BoardView dashboardId={dashboardId} />
}

function BoardView({ dashboardId }: { dashboardId: string }) {
  const navigate = useNavigate()
  const kiosk = loadKiosk()
  const token = kiosk?.dashboardId === dashboardId ? kiosk.token : null
  const [now, setNow] = useState(Date.now())
  const [drift, setDrift] = useState({ x: 0, y: 0 })

  const board = useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => (token ? kioskApi<Board>(`/api/boards/${dashboardId}`, token) : api<Board>(`/api/boards/${dashboardId}`)),
    refetchInterval: 120_000,
    retry: false,
  })

  const onEvent = useCallback(
    (type: string) => {
      if (type === 'kiosk_revoked' && token) {
        saveKiosk(null)
        navigate('/pair', { replace: true })
      }
    },
    [token, navigate],
  )
  useGroupEvents(board.isSuccess, token, onEvent)

  useEffect(() => {
    document.title = '대시보드 | 이만,'
    const clock = setInterval(() => setNow(Date.now()), 15_000)
    // 번인 방지: 몇 분마다 몇 픽셀씩 이동
    const move = setInterval(() => setDrift({ x: Math.round(Math.random() * 12 - 6), y: Math.round(Math.random() * 10 - 5) }), 180_000)
    let lock: { release(): Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }
    void nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => {
      clearInterval(clock)
      clearInterval(move)
      void lock?.release()
    }
  }, [])

  const d = board.data?.dashboard
  const tz = board.data?.timeZone ?? 'Asia/Seoul'
  const p = localParts(now, tz)
  const nowMin = p.hour * 60 + p.minute
  const night = !!d?.night_dim && inWindow(nowMin, d.night_dim.from, d.night_dim.to)
  const theme = d?.theme === 'night' || (d?.theme === 'auto' && night) ? 'dark' : d?.theme === 'paper' ? 'light' : null

  useEffect(() => {
    const root = document.documentElement
    const prev = root.getAttribute('data-theme')
    if (theme) root.setAttribute('data-theme', theme)
    return () => {
      if (prev) root.setAttribute('data-theme', prev)
      else root.removeAttribute('data-theme')
    }
  }, [theme])

  if (board.error) {
    const status = (board.error as { status?: number }).status
    if (token && (status === 401 || status === 403)) {
      saveKiosk(null)
      return <Navigate to="/pair" replace />
    }
    if (status === 401) return <Navigate to={`/login?next=/board/${dashboardId}`} replace />
    return (
      <div className="relative min-h-dvh overflow-hidden p-[clamp(20px,4vw,48px)]">
        <div className="empty">대시보드를 열 수 없어요.</div>
      </div>
    )
  }

  const clock = new Intl.DateTimeFormat('ko-KR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  const date = new Intl.DateTimeFormat('ko-KR', { timeZone: tz, month: 'long', day: 'numeric', weekday: 'long' }).format(now)

  return (
    <div className={`relative min-h-dvh overflow-hidden p-[clamp(20px,4vw,48px)] transition-[filter] duration-[2s] ${night ? 'brightness-55' : ''}`}>
      <div className="grid min-h-[calc(100dvh-2*clamp(20px,4vw,48px))] grid-rows-[auto_1fr_auto] gap-[clamp(20px,4vh,48px)] transition-transform duration-[3s] ease-in-out" style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}>
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="font-display text-[clamp(26px,3.4vw,44px)]">
              {board.data ? `${board.data.group.emoji} ${board.data.group.name}` : <span className="skeleton-text w-[160px]" />}
            </p>
            <p className="text-[clamp(14px,1.4vw,20px)] text-ink-3">{date}</p>
          </div>
          <p className="num text-[clamp(40px,6vw,84px)] leading-none tracking-[-0.03em]">{clock}</p>
        </header>

        {board.isPending ? (
          <div className="flex items-center gap-3 flex-wrap justify-center">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton w-[196px] h-[300px] rounded-[24px]" />
            ))}
          </div>
        ) : (
          <GroupSentence
            members={board.data.members}
            metric={d?.layout.metric ?? 'actual'}
            size="lg"
            showHours={d?.layout.showRibbon ?? true}
            pauseParticipants={board.data.pause?.participants}
          />
        )}

        <footer className="flex items-center gap-3.5">
          <Wordmark size={22} />
          <span className="text-[13px] text-ink-3">쉼표는 오늘 목표 대비 실제 사용시간이에요. 하늘색 점은 지금 사용 중.</span>
        </footer>
      </div>

      {board.data?.pause && <PauseOverlay pause={board.data.pause} members={board.data.members} />}

      <button
        type="button"
        className="icon-btn absolute right-3 bottom-3 opacity-35 hover:opacity-100"
        aria-label="전체 화면"
        onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
      >
        <Maximize size={20} aria-hidden />
      </button>
    </div>
  )
}
