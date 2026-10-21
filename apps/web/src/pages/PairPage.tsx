import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { Wordmark } from '../components/brand/Comma'
import { kioskApi, loadKiosk, saveKiosk } from '../lib/kiosk'

interface Pairing {
  id: string
  code: string
  token: string
  expiresAt: number
}

/** 키오스크 페어링: 로그인 없이 6자리 코드와 QR 을 띄우고 관리자의 승인을 기다린다 */
export default function PairPage() {
  const navigate = useNavigate()
  const existing = loadKiosk()
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [round, setRound] = useState(0)

  useEffect(() => {
    document.title = '대시보드 연결 | 이만,'
  }, [])

  // 새 코드 발급(5분마다 갱신)
  useEffect(() => {
    if (existing?.dashboardId) return
    let cancelled = false
    fetch('/api/kiosk/pairings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: Pairing) => {
        if (cancelled) return
        saveKiosk({ id: p.id, token: p.token, dashboardId: null })
        setPairing(p)
        setError('')
        const url = `${window.location.origin}/me/settings?tab=dashboard&pair=${p.code}`
        void QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#3c3e41', light: '#fffdf7' } }).then(setQr)
      })
      .catch(() => setError('서버에 연결하지 못했어요. 잠시 후 자동으로 다시 시도해요.'))
    const renew = setTimeout(() => setRound((r) => r + 1), 5 * 60_000 - 5_000)
    return () => {
      cancelled = true
      clearTimeout(renew)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  // 승인 대기: SSE 로 즉시, 폴링으로 보완
  useEffect(() => {
    if (!pairing) return
    const check = async () => {
      const r = await kioskApi<{ status: 'pending' | 'approved'; dashboardId?: string }>('/api/kiosk/me', pairing.token).catch(() => null)
      if (r?.status === 'approved' && r.dashboardId) {
        saveKiosk({ id: pairing.id, token: pairing.token, dashboardId: r.dashboardId })
        navigate(`/board/${r.dashboardId}`, { replace: true })
      }
    }
    const es = new EventSource(`/api/kiosk/pairings/${pairing.id}/events?token=${encodeURIComponent(pairing.token)}`)
    es.addEventListener('members', () => void check())
    const poll = setInterval(() => void check(), 10_000)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [pairing, navigate])

  if (existing?.dashboardId) return <Navigate to={`/board/${existing.dashboardId}`} replace />

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8 text-center">
      <div className="grid justify-items-center gap-5">
        <Wordmark size={44} />
        <p className="leading-relaxed text-ink-2 text-[20px]">
          이 화면을 그룹 대시보드로 연결해요
        </p>
        {pairing ? (
          <>
            <p className="num text-[clamp(56px,12vw,120px)] leading-none tracking-[0.12em]" aria-label={`연결 코드 ${pairing.code.split('').join(' ')}`}>
              {pairing.code}
            </p>
            <div className="qr" role="img" aria-label="연결용 QR 코드" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="text-ink-3 max-w-[420px] text-[15px]">
              관리자가 휴대폰으로 QR을 찍거나, 이만의 <strong>그룹 &gt; 대시보드</strong> 화면에 코드를 입력하면 바로 연결돼요. 코드는 5분마다 바뀌어요.
            </p>
          </>
        ) : (
          <div className="skeleton w-[320px] h-[120px]" />
        )}
        {error && <p className="text-[13px] text-over-ink">{error}</p>}
      </div>
    </div>
  )
}
