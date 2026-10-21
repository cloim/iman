import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { BarActions, useAppBar } from '../../components/AppShell'
import { DataGrid } from '../../components/DataGrid'
import { InviteShare } from '../../components/InviteShare'
import { Modal } from '../../components/Modal'
import SelectControl from '../../components/SelectControl'
import { api, API_BASE, errorText } from '../../lib/api'
import { isNative } from '../../lib/native'
import { useMe } from '../../lib/queries'
import { ROLE_LABEL, VISIBILITY_LABEL, type Role, type Visibility } from '../../lib/types'

interface Member {
  userId: string
  role: Role
  nickname: string | null
  visibilityOverride: Visibility | null
  displayName: string
  email: string
  avatarUrl: string | null
  devices: number
  lastSyncedAt: string | null
}

interface Invite {
  id: string
  code: string
  role: 'member' | 'viewer'
  expiresAt: string
  maxUses: number
  usedCount?: number
}

// 앱(WebView)의 출처는 https://localhost 이므로 공개 주소(API_BASE)로 초대 링크를 만든다
const inviteUrl = (code: string) => `${isNative ? API_BASE : window.location.origin}/join/${code}`

export default function MembersPage() {
  useAppBar('구성원')
  const me = useMe()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [inviteOpen, setInviteOpen] = useState(params.get('welcome') === '1')
  const [created, setCreated] = useState<Invite | null>(null)
  const [inviteRole, setInviteRole] = useState<'member' | 'viewer'>('member')
  const [maxUses, setMaxUses] = useState(5)
  const [editing, setEditing] = useState<Member | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const members = useQuery({ queryKey: ['members'], queryFn: () => api<{ members: Member[] }>('/api/group/members') })
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api<{ invites: Invite[] }>('/api/group/invites') })
  const group = me.data?.group

  const createInvite = useMutation({
    mutationFn: () => api<Invite>('/api/group/invites', { method: 'POST', body: { role: inviteRole, maxUses, ttlHours: 72 } }),
    onSuccess: (inv) => {
      setCreated(inv)
      void qc.invalidateQueries({ queryKey: ['invites'] })
    },
  })
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api(`/api/group/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  })
  const saveMember = useMutation({
    mutationFn: (m: Member) =>
      api(`/api/group/members/${m.userId}`, {
        method: 'PATCH',
        body: {
          nickname: m.nickname,
          visibilityOverride: m.visibilityOverride,
          ...(m.userId !== me.data?.user.id && m.role !== 'leader' ? { role: m.role } : {}),
        },
      }),
    onSuccess: () => {
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['members'] })
      void qc.invalidateQueries({ queryKey: ['board'] })
    },
  })
  const removeMember = useMutation({
    mutationFn: (id: string) => api(`/api/group/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setEditing(null)
      setConfirmRemove(false)
      void qc.invalidateQueries({ queryKey: ['members'] })
    },
  })

  const columns = useMemo(
    () => [
      { field: 'name', headerName: '이름', flex: 2, minWidth: 140 },
      { field: 'roleLabel', headerName: '역할', width: 110, filterable: true },
      { field: 'visibilityLabel', headerName: '공개 수준', width: 150, filterable: true },
      { field: 'devices', headerName: '기기', width: 80 },
      { field: 'synced', headerName: '마지막 동기화', flex: 1, minWidth: 140 },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      (members.data?.members ?? []).map((m) => ({
        ...m,
        name: m.nickname ? `${m.nickname} (${m.displayName})` : m.displayName,
        roleLabel: ROLE_LABEL[m.role],
        visibilityLabel: m.role === 'viewer' ? '해당 없음' : m.visibilityOverride ? `${VISIBILITY_LABEL[m.visibilityOverride]} (예외)` : `그룹 기본값`,
        synced: m.lastSyncedAt ? new Date(m.lastSyncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '기록 없음',
      })),
    [members.data],
  )

  if (group && group.role !== 'leader') return <Navigate to="/group" replace />

  return (
    <div className="flex h-[calc(100dvh-56px-110px-env(safe-area-inset-bottom))] min-h-[420px] flex-col gap-4 md:h-[calc(100dvh-64px-56px)]">
      <BarActions>
        <button type="button" className="icon-btn" aria-label="초대하기" title="초대하기" onClick={() => setInviteOpen(true)}>
          <UserPlus size={20} aria-hidden />
        </button>
      </BarActions>

      {(invites.data?.invites.length ?? 0) > 0 && (
        <section className="card flex-none px-5 py-4">
          <h2 className="mb-3 flex items-baseline justify-between gap-3 text-lg">사용 가능한 초대</h2>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {invites.data!.invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span>
                  <code className="num">{i.code}</code> <span className="chip">{ROLE_LABEL[i.role]}</span>
                  <span className="text-[13px] text-ink-3">
                    {' '}
                    {i.usedCount ?? 0}/{i.maxUses}명, {new Date(i.expiresAt).toLocaleDateString('ko-KR')}까지
                  </span>
                </span>
                <span className="flex items-center gap-[2px]">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreated(i)}>
                    공유
                  </button>
                  <button type="button" className="icon-btn" aria-label="초대 취소" onClick={() => revokeInvite.mutate(i.id)}>
                    <Trash2 size={16} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card flex min-h-[280px] flex-1 overflow-hidden p-0">
        <DataGrid
          rowData={rows}
          columnDefs={columns}
          getRowId={(p: { data: Member }) => p.data.userId}
          onRowClicked={(e: { data: Member }) => setEditing({ ...e.data })}
          isLoading={members.isPending}
          errorMessage={members.error ? errorText(members.error) : ''}
          emptyMessage="아직 구성원이 없어요."
        />
      </section>

      <Modal
        isOpen={inviteOpen || !!created}
        onClose={() => {
          setInviteOpen(false)
          setCreated(null)
          if (params.get('welcome')) setParams({}, { replace: true })
        }}
        title={created ? '초대를 보내 주세요' : '구성원 초대'}
        size="sm"
        footer={
          created ? undefined : (
            <button type="button" className="btn btn-comma btn-sm" onClick={() => createInvite.mutate()} disabled={createInvite.isPending}>
              초대 만들기
            </button>
          )
        }
      >
        {created ? (
          <InviteShare
            url={inviteUrl(created.code)}
            title="이만, 그룹 초대"
            text={`${group?.name} 그룹에서 함께 쉬어 가요. 초대 코드 ${created.code}`}
          />
        ) : (
          <div className="grid gap-4">
            {params.get('welcome') && <p>그룹을 만들었어요. 함께할 사람을 초대해 볼까요?</p>}
            <label className="field">
              <span>초대 역할</span>
              <SelectControl value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'member' | 'viewer')}>
                <option value="member">구성원: 사용량을 기록하고 목표를 세워요</option>
                <option value="viewer">대시보드: 그룹 현황 화면만 봐요</option>
              </SelectControl>
            </label>
            <label className="field">
              <span>몇 명까지 쓸 수 있나요</span>
              <input type="number" className="input num" min={1} max={50} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
              <span className="text-[13px] text-ink-3">초대는 3일 동안 유효해요.</span>
            </label>
            {createInvite.error && <p className="text-[13px] text-over-ink">{errorText(createInvite.error)}</p>}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? (editing.nickname ?? editing.displayName) : ''}
        size="sm"
        footer={
          <>
            {editing && editing.userId !== me.data?.user.id && (
              <button type="button" className="btn btn-danger btn-sm mr-auto" onClick={() => setConfirmRemove(true)}>
                내보내기
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
              취소
            </button>
            <button type="button" className="btn btn-sm" onClick={() => editing && saveMember.mutate(editing)} disabled={saveMember.isPending}>
              저장
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4">
            <p className="text-[13px] text-ink-3">{editing.email}</p>
            <label className="field">
              <span>그룹에서 부를 이름</span>
              <input className="input" value={editing.nickname ?? ''} placeholder={editing.displayName} maxLength={20} onChange={(e) => setEditing({ ...editing, nickname: e.target.value || null })} />
            </label>
            {editing.role !== 'leader' && (
              <label className="field">
                <span>역할</span>
                <SelectControl value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}>
                  <option value="member">구성원</option>
                  <option value="viewer">대시보드</option>
                </SelectControl>
              </label>
            )}
            {editing.role !== 'viewer' && (
              <label className="field">
                <span>공개 수준 예외</span>
                <SelectControl
                  value={editing.visibilityOverride ?? ''}
                  onChange={(e) => setEditing({ ...editing, visibilityOverride: (e.target.value || null) as Visibility | null })}
                >
                  <option value="">그룹 기본값 따르기 ({group ? VISIBILITY_LABEL[group.visibility] : ''})</option>
                  <option value="summary">요약만</option>
                  <option value="category">카테고리까지</option>
                  <option value="app">앱까지</option>
                </SelectControl>
                <span className="text-[13px] text-ink-3">구성원에게는 적용된 공개 수준이 설정 화면에 표시돼요.</span>
              </label>
            )}
            {saveMember.error && <p className="text-[13px] text-over-ink">{errorText(saveMember.error)}</p>}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="그룹에서 내보낼까요?"
        size="sm"
        draggable={false}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>
              취소
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => editing && removeMember.mutate(editing.userId)}>
              내보내기
            </button>
          </>
        }
      >
        <p>그 사람의 사용 기록은 본인 계정에 남고, 그룹에서는 더 이상 보이지 않아요.</p>
      </Modal>
    </div>
  )
}
