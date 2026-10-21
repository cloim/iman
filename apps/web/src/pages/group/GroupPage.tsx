import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Coffee, MonitorPlay, Settings2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { BarActions, useAppBar } from '../../components/AppShell'
import { GroupSentence } from '../../components/GroupSentence'
import { Modal } from '../../components/Modal'
import { PauseBanner } from '../../components/PauseBanner'
import { api, errorText } from '../../lib/api'
import { isNative, native } from '../../lib/native'
import { useBoard, useGroupEvents, useMe } from '../../lib/queries'
import { VISIBILITY_LABEL } from '../../lib/types'

export default function GroupPage() {
  const me = useMe()
  const group = me.data?.group
  useAppBar(group ? `${group.emoji} ${group.name}` : '그룹')
  const qc = useQueryClient()
  const board = useBoard()
  useGroupEvents(true)
  const [metric, setMetric] = useState<'actual' | 'total'>('actual')
  const [pauseOpen, setPauseOpen] = useState(false)
  const [minutes, setMinutes] = useState(30)
  const isLeader = group?.role === 'leader'

  const startPause = useMutation({
    mutationFn: () => api<{ id: string; endsAt: string }>('/api/group/pauses', { method: 'POST', body: { minutes } }),
    onSuccess: async (p) => {
      setPauseOpen(false)
      if (isNative) await native.startRest({ minutes, source: 'group', pauseId: p.id }).catch(() => {})
      void qc.invalidateQueries({ queryKey: ['board'] })
    },
  })

  return (
    <div className="grid gap-4">
      <BarActions>
        <button type="button" className="icon-btn" aria-label="함께 쉬기 시작" title="함께 쉬기 시작" onClick={() => setPauseOpen(true)} disabled={!!board.data?.pause}>
          <Coffee size={20} aria-hidden />
        </button>
        {isLeader && (
          <>
            <Link to="/group/members" className="icon-btn" aria-label="구성원 관리" title="구성원 관리">
              <Users size={20} aria-hidden />
            </Link>
            <Link to="/group/dashboards" className="icon-btn" aria-label="대시보드 설정" title="대시보드 설정">
              <MonitorPlay size={20} aria-hidden />
            </Link>
            <Link to="/group/settings" className="icon-btn" aria-label="그룹 설정" title="그룹 설정">
              <Settings2 size={20} aria-hidden />
            </Link>
          </>
        )}
      </BarActions>

      {board.data?.pause && <PauseBanner pause={board.data.pause} me={me.data?.user.id ?? ''} />}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-ink-3">
          오늘, 공개 수준 {group ? VISIBILITY_LABEL[group.visibility] : ''}. 내 카드는 전체가 보여요.
        </p>
        <div className="segmented" role="group" aria-label="사용시간 기준">
          <button type="button" aria-pressed={metric === 'actual'} onClick={() => setMetric('actual')}>
            실제 사용
          </button>
          <button type="button" aria-pressed={metric === 'total'} onClick={() => setMetric('total')}>
            총 사용
          </button>
        </div>
      </div>

      {board.isPending ? (
        <div className="flex items-center gap-3 flex-wrap">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton w-[136px] h-[230px] rounded-[24px]" />
          ))}
        </div>
      ) : board.error ? (
        <div className="empty">그룹 현황을 불러오지 못했어요.</div>
      ) : board.data.members.length <= 1 && isLeader ? (
        <>
          <GroupSentence members={board.data.members} metric={metric} pauseParticipants={board.data.pause?.participants} />
          <div className="card empty">
            <p>아직 혼자예요. 구성원을 초대해 함께 쉬어 볼까요?</p>
            <Link to="/group/members" className="btn btn-comma">
              구성원 초대하기
            </Link>
          </div>
        </>
      ) : (
        <GroupSentence members={board.data.members} metric={metric} pauseParticipants={board.data.pause?.participants} />
      )}

      <Modal
        isOpen={pauseOpen}
        onClose={() => setPauseOpen(false)}
        title="함께 쉬기"
        size="sm"
        draggable={false}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPauseOpen(false)}>
              취소
            </button>
            <button type="button" className="btn btn-comma btn-sm" onClick={() => startPause.mutate()} disabled={startPause.isPending}>
              {minutes}분 함께 쉬기
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <p>그룹 모두에게 알림이 가고, 대시보드에 참여한 사람들의 쉼표가 모여요.</p>
          <div className="segmented" role="group" aria-label="쉬는 시간">
            {[15, 30, 60, 90].map((m) => (
              <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                {m}분
              </button>
            ))}
          </div>
          {startPause.error && <p className="text-[13px] text-over-ink">{errorText(startPause.error)}</p>}
        </div>
      </Modal>
    </div>
  )
}
