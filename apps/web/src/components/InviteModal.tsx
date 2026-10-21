import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, API_BASE, errorText } from '../lib/api'
import { isNative } from '../lib/native'
import { useMe } from '../lib/queries'
import { InviteShare } from './InviteShare'
import { Modal } from './Modal'
import SelectControl from './SelectControl'

export interface Invite {
  id: string
  code: string
  role: 'member' | 'viewer'
  expiresAt: string
  maxUses: number
  usedCount?: number
}

// 앱(WebView)의 출처는 https://localhost 이므로 공개 주소(API_BASE)로 초대 링크를 만든다
const inviteUrl = (code: string) => `${isNative ? API_BASE : window.location.origin}/join/${code}`

/** 구성원 초대: 역할을 고르고 초대를 만든 뒤 링크, QR, 공유 시트로 보낸다. invite를 주면 공유 단계부터 연다 */
export function InviteModal({ isOpen, onClose, invite = null, welcome = false }: { isOpen: boolean; onClose: () => void; invite?: Invite | null; welcome?: boolean }) {
  const me = useMe()
  const qc = useQueryClient()
  const [role, setRole] = useState<'member' | 'viewer'>('member')
  const [created, setCreated] = useState<Invite | null>(invite)
  useEffect(() => setCreated(invite), [invite])

  const create = useMutation({
    mutationFn: () => api<Invite>('/api/group/invites', { method: 'POST', body: { role, ttlHours: 72 } }),
    onSuccess: (inv) => {
      setCreated(inv)
      void qc.invalidateQueries({ queryKey: ['invites'] })
    },
  })
  const close = () => {
    setCreated(null)
    create.reset()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={created ? '초대를 보내 주세요' : '구성원 초대'}
      size="sm"
      footer={
        created ? undefined : (
          <button type="button" className="btn btn-comma btn-sm" onClick={() => create.mutate()} disabled={create.isPending}>
            초대 만들기
          </button>
        )
      }
    >
      {created ? (
        <InviteShare url={inviteUrl(created.code)} code={created.code} title="이만, 그룹 초대" text={`${me.data?.group?.name} 그룹에서 함께 쉬어 가요. 초대 코드 ${created.code}`} />
      ) : (
        <div className="grid gap-4">
          {welcome && <p>그룹을 만들었어요. 함께할 사람을 초대해 볼까요?</p>}
          <label className="field">
            <span>초대 역할</span>
            <SelectControl value={role} onChange={(e) => setRole(e.target.value as 'member' | 'viewer')}>
              <option value="member">구성원: 사용량을 기록하고 목표를 세워요</option>
              <option value="viewer">대시보드: 그룹 현황 화면만 봐요</option>
            </SelectControl>
            <span className="text-[13px] text-ink-3">초대 링크는 3일 동안 몇 명이든 쓸 수 있어요.</span>
          </label>
          {create.error && <p className="text-[13px] text-over-ink">{errorText(create.error)}</p>}
        </div>
      )}
    </Modal>
  )
}
