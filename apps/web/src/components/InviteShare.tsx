import { Copy, Share2 } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** 링크, QR, 공유 시트(카카오톡 등)로 초대 전달 */
export function InviteShare({ url, title, text }: { url: string; title: string; text: string }) {
  const [svg, setSvg] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#3c3e41', light: '#fffdf7' } }).then(setSvg)
  }, [url])
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator
  return (
    <div className="grid justify-items-center gap-4">
      <div className="qr" aria-label="초대 QR 코드" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
      <code className="max-w-full rounded-tile bg-surface-2 px-2.5 py-1.5 text-[13px] [overflow-wrap:anywhere]">{url}</code>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          <Copy size={16} aria-hidden /> {copied ? '복사했어요' : '링크 복사'}
        </button>
        {canShare && (
          <button type="button" className="btn btn-comma btn-sm" onClick={() => void navigator.share({ title, text, url }).catch(() => {})}>
            <Share2 size={16} aria-hidden /> 공유하기
          </button>
        )}
      </div>
    </div>
  )
}
