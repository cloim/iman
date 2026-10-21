import type { GoalEvaluation, GoalType, UsagePart, UsageSession } from '@iman/core'

export type Role = 'leader' | 'member' | 'viewer'
export type Visibility = 'summary' | 'category' | 'app'

export interface Me {
  user: { id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string; lastRole: Role | null }
  group: null | {
    id: string
    name: string
    emoji: string
    visibility: Visibility
    weekStart: number
    ownerId: string
    role: Role
    myVisibility: Visibility
  }
}

export interface AppInfo {
  label: string
  category: string
}

export interface GoalDto {
  id: string
  type: GoalType
  target: number
  scopeRef: string | null
  daysOfWeek: number
  quietFrom: string | null
  quietTo: string | null
  nudge: { enabled: boolean; near: boolean; tone: 'plain' | 'warm' }
  active: boolean
}

export interface Today {
  date: string
  timeZone: string
  dayStart: number
  dayEnd: number
  now: number
  totalMs: number
  actualMs: number
  overlapMs: number
  pickups: number
  activeNow: boolean
  byApp: Record<string, UsagePart>
  byDevice: Record<string, UsagePart>
  byCategory: Record<string, UsagePart>
  byHour: number[]
  sessions: UsageSession[]
  apps: Record<string, AppInfo>
  devices: { id: string; name: string; lastSyncedAt: string | null }[]
  rests: { id: string; source: string; startsAt: string; endsAt: string }[]
  goals: (GoalDto & { activeToday: boolean; evaluation: GoalEvaluation })[]
  /** 관리자가 구성원 내역을 볼 때 적용된 공개 수준. 내 기록에는 없다 */
  level?: Visibility
}

export interface BoardMember {
  userId: string
  role: Role
  name: string
  avatarUrl: string | null
  level: Visibility
  totalMs: number
  actualMs: number
  pickups: number
  byHour: number[]
  goal: { targetMin: number; status: 'met' | 'near' | 'over' } | null
  categories: { key: string; label: string; actualMs: number; totalMs: number }[] | null
  apps: { key: string; label: string; actualMs: number; totalMs: number }[] | null
  activeNow: boolean
  resting: boolean
  lastActiveAt: number | null
}

export interface Dashboard {
  id: string
  name: string
  layout: { metric: 'actual' | 'total'; showRibbon: boolean; showRanking: boolean }
  theme: 'paper' | 'night' | 'auto'
  displayLevel: Visibility
  privacyBlur: boolean
  nightDim: { from: string; to: string } | null
}

export interface Board {
  date: string
  timeZone: string
  group: { id: string; name: string; emoji: string; visibility: Visibility }
  dashboard: null | {
    id: string
    name: string
    layout: Dashboard['layout']
    theme: Dashboard['theme']
    display_level: Visibility
    privacy_blur: boolean
    night_dim: Dashboard['nightDim']
  }
  pause: null | { id: string; startedBy: string; startsAt: string; endsAt: string; participants: string[] }
  members: BoardMember[]
}

export const CATEGORY_LABEL: Record<string, string> = {
  video: '영상',
  social: 'SNS, 메신저',
  game: '게임',
  audio: '음악, 오디오',
  image: '사진',
  news: '뉴스, 읽을거리',
  maps: '지도, 이동',
  productivity: '생산성',
  accessibility: '접근성',
  other: '기타',
}

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  summary: '요약만',
  category: '카테고리까지',
  app: '앱까지',
}

export const VISIBILITY_HINT: Record<Visibility, string> = {
  summary: '총 사용시간, 실제 사용시간, 목표 달성 여부, 시간대 분포',
  category: '요약 + 영상, SNS, 게임 같은 카테고리별 사용시간',
  app: '카테고리 + 앱별 사용시간',
}

/** 앱까지 공개일 때 관리자가 추가로 보는 범위. 공개 수준을 정하거나 확인하는 화면에 함께 안내한다 */
export const APP_LEVEL_NOTE = '앱까지 공개면 관리자는 언제 어떤 앱을 썼는지 타임라인도 볼 수 있어요.'

export const ROLE_LABEL: Record<Role, string> = { leader: '관리자', member: '구성원', viewer: '대시보드' }
