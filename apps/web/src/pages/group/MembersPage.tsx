import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router'
import { BarActions, useAppBar } from '../../components/AppShell'
import { DataGrid } from '../../components/DataGrid'
import { ExcludedAppChips, ExcludedAppsEditor } from '../../components/ExcludedAppsEditor'
import { InviteModal, type Invite } from '../../components/InviteModal'
import { Modal } from '../../components/Modal'
import SelectControl from '../../components/SelectControl'
import { api, errorText } from '../../lib/api'
import { useMe } from '../../lib/queries'
import { ROLE_LABEL, VISIBILITY_LABEL, type Role, type Visibility } from '../../lib/types'

interface Member {
  userId: string
  role: Role
  nickname: string | null
  visibilityOverride: Visibility | null
  /** 이 구성원에게만 더한 예외 앱(관리자에게만 온다) */
  excludedPackages: string[] | null
  displayName: string
  email: string
  avatarUrl: string | null
  devices: number
  lastSyncedAt: string | null
}

const FIT_COLUMNS = ['name', 'roleLabel', 'visibilityLabel', 'devices', 'synced']

export default function MembersPage() {
  const me = useMe()
  useAppBar('구성원', { to: '/group', label: me.data?.group ? `${me.data.group.emoji} ${me.data.group.name}` : '그룹' })
  const qc = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [sharing, setSharing] = useState<Invite | null>(null)
  const [editing, setEditing] = useState<Member | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [labels, setLabels] = useState<Record<string, string>>({})

  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api<{ members: Member[]; appLabels?: Record<string, string> }>('/api/group/members'),
  })
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api<{ invites: Invite[] }>('/api/group/invites') })
  const group = me.data?.group

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
          excludedPackages: m.excludedPackages ?? [],
          ...(m.userId !== me.data?.user.id && m.userId !== group?.ownerId ? { role: m.role } : {}),
        },
      }),
    onSuccess: () => {
      setEditing(null)
      // 예외 앱이 바뀌면 구성원 내역과 보드, 내 기록(본인일 때) 집계가 달라진다
      void qc.invalidateQueries()
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
      { field: 'name', headerName: '이름' },
      { field: 'roleLabel', headerName: '역할', filterable: true },
      { field: 'visibilityLabel', headerName: '공개 수준', filterable: true },
      { field: 'devices', headerName: '기기' },
      { field: 'synced', headerName: '마지막 동기화' },
      // 값 길이에 맞춘 열들 뒤의 남는 폭을 채우는 빈 열
      { field: 'fill', headerName: '', flex: 1, minWidth: 0, sortable: false },
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
                    {i.usedCount ?? 0}명 참여, {new Date(i.expiresAt).toLocaleDateString('ko-KR')}까지
                  </span>
                </span>
                <span className="flex items-center gap-[2px]">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSharing(i)}>
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
          onRowClicked={(e: { data: Member }) => {
            setLabels({ ...group?.appLabels, ...members.data?.appLabels })
            setEditing({ ...e.data })
          }}
          isLoading={members.isPending}
          errorMessage={members.error ? errorText(members.error) : ''}
          emptyMessage="아직 구성원이 없어요."
          autoSizeStrategy={{ type: 'fitCellContents', colIds: FIT_COLUMNS }}
          onRowDataUpdated={(e: { api: { autoSizeColumns: (ids: string[]) => void } }) => e.api.autoSizeColumns(FIT_COLUMNS)}
        />
      </section>

      <InviteModal
        isOpen={inviteOpen || !!sharing}
        invite={sharing}
        onClose={() => {
          setInviteOpen(false)
          setSharing(null)
        }}
      />

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? (editing.nickname ?? editing.displayName) : ''}
        size="sm"
        footer={
          <>
            {editing && editing.userId !== me.data?.user.id && editing.userId !== group?.ownerId && (
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
            {editing.userId === group?.ownerId ? (
              <p className="text-[13px] text-ink-3">그룹을 만든 사람이라 항상 관리자예요.</p>
            ) : editing.userId === me.data?.user.id ? (
              <p className="text-[13px] text-ink-3">내 역할은 다른 관리자가 바꿀 수 있어요.</p>
            ) : (
              <label className="field">
                <span>역할</span>
                <SelectControl value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}>
                  <option value="leader">관리자: 구성원, 대시보드, 그룹 설정을 관리하고 구성원 내역을 봐요</option>
                  <option value="member">구성원: 사용량을 기록하고 목표를 세워요</option>
                  <option value="viewer">대시보드: 그룹 현황 화면만 봐요</option>
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
            {editing.role !== 'viewer' && (
              <div className="grid gap-2.5">
                {(group?.excludedPackages.length ?? 0) > 0 && (
                  <div className="grid gap-1.5">
                    <span className="text-[13px] font-semibold text-ink-2">그룹 공통 예외 앱</span>
                    <ExcludedAppChips packages={group!.excludedPackages} labels={labels} />
                  </div>
                )}
                <ExcludedAppsEditor
                  label="이 구성원에게 더할 예외 앱"
                  value={editing.excludedPackages ?? []}
                  labels={labels}
                  onChange={(next, l) => {
                    setEditing({ ...editing, excludedPackages: next })
                    setLabels(l)
                  }}
                />
                <span className="text-[13px] text-ink-3">이 구성원의 사용시간, 목표, 알림에서 지난 기록까지 빠져요.</span>
              </div>
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
