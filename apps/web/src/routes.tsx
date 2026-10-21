import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, useLocation } from 'react-router'
import { AppShell } from './components/AppShell'
import { ApiError } from './lib/api'
import { useMe } from './lib/queries'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RolePage = lazy(() => import('./pages/RolePage'))
const JoinPage = lazy(() => import('./pages/JoinPage'))
const PermissionPage = lazy(() => import('./pages/PermissionPage'))
const TodayPage = lazy(() => import('./pages/TodayPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const GoalsPage = lazy(() => import('./pages/GoalsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const GroupPage = lazy(() => import('./pages/group/GroupPage'))
const MembersPage = lazy(() => import('./pages/group/MembersPage'))
const GroupSettingsPage = lazy(() => import('./pages/group/GroupSettingsPage'))
const DashboardsPage = lazy(() => import('./pages/group/DashboardsPage'))
const BoardPage = lazy(() => import('./pages/BoardPage'))
const PairPage = lazy(() => import('./pages/PairPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-[40vh]" aria-busy="true" />}>{children}</Suspense>
}

/** 로그인과 그룹 소속을 확인한다. 그룹이 없으면 역할 선택, 대시보드 역할은 보드로 */
function Guard({ children, needGroup = true }: { children: ReactNode; needGroup?: boolean }) {
  const me = useMe()
  const loc = useLocation()
  if (me.isPending) return <div className="min-h-[40vh]" aria-busy="true" />
  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (me.error) return <div className="empty">연결할 수 없어요. 잠시 후 다시 열어 주세요.</div>
  if (needGroup && !me.data.group) return <Navigate to="/role" replace />
  if (needGroup && me.data.group?.role === 'viewer' && !loc.pathname.startsWith('/board')) return <Navigate to="/board" replace />
  return <>{children}</>
}

export const router = createBrowserRouter([
  { path: '/login', element: <Page><LoginPage /></Page> },
  { path: '/pair', element: <Page><PairPage /></Page> },
  { path: '/privacy', element: <Page><PrivacyPage /></Page> },
  { path: '/join/:code', element: <Page><JoinPage /></Page> },
  { path: '/role', element: <Guard needGroup={false}><Page><RolePage /></Page></Guard> },
  { path: '/onboarding/permission', element: <Guard><Page><PermissionPage /></Page></Guard> },
  { path: '/board', element: <Page><BoardPage /></Page> },
  { path: '/board/:dashboardId', element: <Page><BoardPage /></Page> },
  {
    element: <Guard><AppShell /></Guard>,
    children: [
      { path: '/me', element: <Page><TodayPage /></Page> },
      { path: '/me/history', element: <Page><HistoryPage /></Page> },
      { path: '/me/goals', element: <Page><GoalsPage /></Page> },
      { path: '/me/settings', element: <Page><SettingsPage /></Page> },
      { path: '/group', element: <Page><GroupPage /></Page> },
      { path: '/group/members', element: <Page><MembersPage /></Page> },
      { path: '/group/settings', element: <Page><GroupSettingsPage /></Page> },
      { path: '/group/dashboards', element: <Page><DashboardsPage /></Page> },
    ],
  },
  { path: '*', element: <Navigate to="/me" replace /> },
])
