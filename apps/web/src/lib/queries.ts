import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, eventsUrl } from './api'
import type { Board, Me, Today } from './types'
import { isNative, native } from './native'

export const useRestState = () => useQuery({
  queryKey: ['native-rest'],
  queryFn: () => native.getRestState(),
  enabled: isNative,
  refetchInterval: 1000,
  retry: false,
})

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false, staleTime: 60_000 })

export const useToday = (date?: string) =>
  useQuery({
    queryKey: ['today', date ?? 'now'],
    queryFn: () => api<Today>(`/api/me/today${date ? `?date=${date}` : ''}`),
    refetchInterval: date ? false : 60_000,
  })

export const useBoard = (enabled = true) =>
  useQuery({ queryKey: ['board'], queryFn: () => api<Board>('/api/board'), enabled, refetchInterval: 120_000 })

/** 그룹 이벤트를 받아 관련 쿼리를 새로 고친다 */
export function useGroupEvents(enabled: boolean, token?: string | null, onEvent?: (type: string, data: unknown) => void) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    let es: EventSource | null = null
    let closed = false
    void eventsUrl('/api/events', token).then((url) => {
      if (closed) return
      es = new EventSource(url, { withCredentials: !token })
      const handle = (type: string) => (e: MessageEvent) => {
        const data = JSON.parse(e.data)
        if (type === 'rollup' || type === 'members' || type === 'pause') {
          void qc.invalidateQueries({ queryKey: ['board'] })
          void qc.invalidateQueries({ queryKey: ['dashboard'] })
        }
        // 관리자가 예외 앱을 바꾸면 내 정보와 오늘 집계도 달라진다
        if (type === 'members') {
          void qc.invalidateQueries({ queryKey: ['me'] })
          void qc.invalidateQueries({ queryKey: ['today'] })
        }
        onEvent?.(type, data)
      }
      for (const t of ['rollup', 'members', 'pause', 'kiosk_revoked']) es.addEventListener(t, handle(t))
    })
    return () => {
      closed = true
      es?.close()
    }
  }, [enabled, token, qc, onEvent])
}
