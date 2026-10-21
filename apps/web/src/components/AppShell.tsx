import { CalendarDays, Home, Settings, Target, Users } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet } from 'react-router'
import { useMe } from '../lib/queries'
import { Wordmark } from './brand/Comma'

const BarContext = createContext<{ setTitle: (t: string) => void; slot: HTMLElement | null }>({
  setTitle: () => {},
  slot: null,
})

/** 각 화면이 상단 앱 바 제목을 지정한다. 제목은 앱 바에만 표시하고 본문에서 반복하지 않는다 */
export function useAppBar(title: string) {
  const { setTitle } = useContext(BarContext)
  useEffect(() => {
    setTitle(title)
    document.title = `${title} | 이만,`
  }, [setTitle, title])
}

/** 앱 바 우측 아이콘 버튼 자리 */
export function BarActions({ children }: { children: ReactNode }) {
  const { slot } = useContext(BarContext)
  return slot ? createPortal(children, slot) : null
}

export function AppShell() {
  const [title, setTitle] = useState('')
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const me = useMe()
  const role = me.data?.group?.role
  const nav = [
    { to: '/me', label: '오늘', icon: Home, end: true },
    { to: '/me/history', label: '기록', icon: CalendarDays },
    ...(role ? [{ to: '/group', label: '그룹', icon: Users }] : []),
    { to: '/me/goals', label: '목표', icon: Target },
    { to: '/me/settings', label: '설정', icon: Settings },
  ]
  return (
    <BarContext.Provider value={{ setTitle, slot }}>
      <div className="grid min-h-full md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen border-r border-line px-4 py-6 md:block" aria-label="주 메뉴">
          <div className="px-3 pt-1 pb-7">
            <Wordmark size={30} />
          </div>
          <nav className="grid gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className="flex min-h-11 items-center gap-3 rounded-full px-3.5 font-semibold text-ink-2 no-underline hover:bg-surface-2 [&.active]:bg-comma-tint [&.active]:text-ink"
              >
                <n.icon size={20} aria-hidden />
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-2 bg-paper/90 pt-[env(safe-area-inset-top)] pr-2 pl-4 backdrop-blur-md md:min-h-16 md:px-[max(16px,calc((100%-872px)/2))]">
            <h1 className="text-[22px]">{title}</h1>
            <div className="flex items-center gap-0.5" ref={setSlot} />
          </header>
          <main className="mx-auto max-w-[920px] px-4 pt-1 pb-[calc(96px+env(safe-area-inset-bottom))] md:px-6 md:pt-2 md:pb-12">
            <Outlet />
          </main>
        </div>
        <nav
          className="fixed inset-x-0 bottom-0 z-20 grid auto-cols-fr grid-flow-col border-t border-line bg-surface/95 px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] backdrop-blur-lg md:hidden"
          aria-label="주 메뉴"
        >
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className="grid justify-items-center gap-0.5 rounded-panel py-1.5 text-[11px] font-semibold text-ink-3 no-underline [&.active]:text-ink [&.active_svg]:text-comma-deep"
            >
              <n.icon size={22} aria-hidden />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </BarContext.Provider>
  )
}
