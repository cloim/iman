import type { Tx } from './db'
import { HttpError } from './http'

export type Role = 'leader' | 'member' | 'viewer'
export type Visibility = 'summary' | 'category' | 'app'

export interface Membership {
  groupId: string
  role: Role
}

export async function membership(c: Tx, userId: string): Promise<Membership | null> {
  const r = await c.query<{ group_id: string; role: Role }>(
    'select group_id, role from group_members where user_id = $1',
    [userId],
  )
  const m = r.rows[0]
  return m ? { groupId: m.group_id, role: m.role } : null
}

export async function requireMember(c: Tx, userId: string, roles?: Role[]): Promise<Membership> {
  const m = await membership(c, userId)
  if (!m) throw new HttpError(403, 'no_group')
  if (roles && !roles.includes(m.role)) throw new HttpError(403, 'forbidden_role')
  return m
}

export async function userTimeZone(c: Tx, userId: string): Promise<string> {
  const r = await c.query<{ timezone: string }>('select timezone from users where id = $1', [userId])
  return r.rows[0]?.timezone ?? 'Asia/Seoul'
}

/** 그룹 시간대는 그룹을 만든 사람(소유자)의 시간대를 따른다 */
export async function groupTimeZone(c: Tx, groupId: string): Promise<string> {
  const r = await c.query<{ timezone: string }>(
    'select u.timezone from groups g join users u on u.id = g.owner_id where g.id = $1',
    [groupId],
  )
  return r.rows[0]?.timezone ?? 'Asia/Seoul'
}

const ORDER: Visibility[] = ['summary', 'category', 'app']
export const minVisibility = (a: Visibility, b: Visibility): Visibility =>
  ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))]!
