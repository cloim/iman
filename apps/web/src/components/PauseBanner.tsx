import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { isNative, native } from '../lib/native'
import type { Board } from '../lib/types'

export function useCountdown(endsAt: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, endsAt - now)
  return `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`
}

/** 진행 중인 함께 쉬기 안내와 참여 */
export function PauseBanner({ pause, me, isLeader = false }: { pause: NonNullable<Board['pause']>; me: string; isLeader?: boolean }) {
  const qc = useQueryClient()
  const left = useCountdown(Date.parse(pause.endsAt))
  const joined = pause.participants.includes(me)
  const canEnd = isLeader || pause.startedBy === me
  const [error, setError] = useState('')
  const end = async () => {
    try {
      await api(`/api/group/pauses/${pause.id}/end`, { method: 'POST' })
      await qc.invalidateQueries({ queryKey: ['board'] })
    } catch (e) {
      setError(errorText(e))
    }
  }
  const join = async () => {
    try {
      await api(`/api/group/pauses/${pause.id}/join`, { method: 'POST' })
      if (isNative) {
        const minutes = Math.max(1, Math.round((Date.parse(pause.endsAt) - Date.now()) / 60_000))
        await native.startRest({ minutes, source: 'group', pauseId: pause.id }).catch(() => {})
      }
      await qc.invalidateQueries({ queryKey: ['board'] })
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="card card-tint flex flex-wrap items-center justify-between gap-2.5 px-[18px] py-3.5 font-semibold" role="status">
      <span>
        함께 쉬는 중, {pause.participants.length}명 참여 <span className="num">{left}</span> 남음
      </span>
      <span className="flex items-center gap-2">
        {joined ? (
          <span className="chip chip-met animate-comma-drop">참여 중</span>
        ) : (
          <button type="button" className="btn btn-comma btn-sm" onClick={join}>
            함께 쉬기
          </button>
        )}
        {canEnd && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={end}>
            함께 쉬기 마치기
          </button>
        )}
      </span>
      {error && <span className="text-[13px] text-over-ink">{error}</span>}
    </div>
  )
}
