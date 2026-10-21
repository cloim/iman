import { App } from '@capacitor/app'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { isNative, native } from '../lib/native'
import { useRestState } from '../lib/queries'
import { Modal } from './Modal'

/** 위젯과 알림에서 시작한 쉬기도 네이티브 타이머를 기준으로 복원한다. */
export function RestBanner() {
  const rest = useRestState()
  const qc = useQueryClient()
  const [now, setNow] = useState(Date.now())
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!isNative) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const listener = App.addListener('resume', () => {
      setNow(Date.now())
      void qc.invalidateQueries({ queryKey: ['native-rest'] })
    })
    return () => {
      clearInterval(timer)
      void listener.then((handle) => handle.remove())
    }
  }, [qc])
  const left = Math.max(0, (rest.data?.endsAt ?? 0) - now)
  if (!isNative || !left || rest.data?.pauseId) return null
  const seconds = Math.ceil(left / 1000)
  return (
    <>
      <div className="card card-tint mb-4 flex flex-wrap items-center justify-between gap-3 px-[18px] py-3.5">
        <p className="font-semibold">쉬는 중 <span className="num" role="timer" aria-label="쉬기 남은 시간">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span> 남음</p>
        <button type="button" className="btn btn-ghost btn-sm" disabled={ending} onClick={async () => {
          setEnding(true)
          try {
            await native.endRest()
            await qc.invalidateQueries({ queryKey: ['native-rest'] })
            void qc.invalidateQueries({ queryKey: ['today'] })
            void qc.invalidateQueries({ queryKey: ['board'] })
          } catch {
            setError('쉬기를 취소하지 못했어요. 다시 시도해 주세요.')
          } finally {
            setEnding(false)
          }
        }}>{ending ? '취소 중…' : '쉬기 취소'}</button>
      </div>
      <Modal isOpen={!!error} onClose={() => setError('')} title="쉬기 취소"><p>{error}</p></Modal>
    </>
  )
}
