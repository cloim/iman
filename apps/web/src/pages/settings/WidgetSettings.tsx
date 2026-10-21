import { useEffect, useState } from 'react'
import { CommaGauge } from '../../components/brand/Comma'
import { Modal } from '../../components/Modal'
import { native, type WidgetAppearance } from '../../lib/native'

export function WidgetSettings() {
  const [appearance, setAppearance] = useState<WidgetAppearance | null>(null)
  const [saved, setSaved] = useState<WidgetAppearance | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = () => {
    setError('')
    void native.getWidgetAppearance().then((value) => {
      setAppearance(value)
      setSaved(value)
    }).catch(() => setError('위젯 설정을 불러오지 못했어요. 다시 시도해 주세요.'))
  }
  useEffect(load, [])
  if (!appearance) return (
    <section className="card grid gap-4">
      <h2 className="text-lg">위젯</h2>
      {error ? <><p role="alert">{error}</p><button type="button" className="btn btn-ghost justify-self-start" onClick={load}>다시 시도</button></> : <div className="skeleton h-[160px]" />}
    </section>
  )
  const hex = appearance.backgroundColor.slice(1)
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const luminance = rgb.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const dark = luminance[0]! * 0.2126 + luminance[1]! * 0.7152 + luminance[2]! * 0.0722 < 0.4
  const changed = appearance.backgroundColor !== saved?.backgroundColor || appearance.transparency !== saved?.transparency
  return (
    <section className="card grid gap-4">
      <h2 className="text-lg">위젯</h2>
      <p className="text-sm text-ink-3">이 기기의 모든 위젯에 적용해요. 투명도는 배경에만 적용됩니다.</p>
      <div className="rounded-3xl bg-paper p-3">
        <div className="flex items-center gap-4 rounded-3xl p-4" aria-label="위젯 미리보기, 예시 사용시간 1시간 20분"
          style={{ backgroundColor: `rgba(${rgb.join(',')},${1 - appearance.transparency / 100})`, color: dark ? '#F4EEDF' : '#3C3E41' }}>
          <CommaGauge ratio={1 / 3} size={64} label="예시 목표 대비 사용량" />
          <div><p className="text-xs">실제 사용</p><p className="num text-[28px]">1시간 20분</p><p className="text-xs">2시간 40분 남음</p></div>
        </div>
      </div>
      <form className="grid gap-4" onSubmit={async (event) => {
        event.preventDefault()
        setSaving(true)
        try {
          await native.setWidgetAppearance(appearance)
          setSaved(appearance)
          setNotice('위젯에 적용했어요.')
        } catch {
          setNotice('위젯 설정을 저장하지 못했어요. 다시 시도해 주세요.')
        } finally {
          setSaving(false)
        }
      }}>
        <fieldset className="grid gap-4" disabled={saving}>
          <label className="flex items-center justify-between gap-3">
            <span>배경색</span>
            <input type="color" className="h-11 w-16 cursor-pointer rounded-lg border border-line p-1" value={appearance.backgroundColor}
              onChange={(event) => setAppearance({ ...appearance, backgroundColor: event.target.value })} />
          </label>
          <label className="grid gap-2">
            <span className="flex justify-between gap-3"><span>배경 투명도</span><span className="num">{appearance.transparency}%</span></span>
            <input type="range" className="min-h-11 w-full accent-comma" min={0} max={100} step={1} value={appearance.transparency}
              aria-valuetext={`${appearance.transparency}% 투명`}
              onChange={(event) => setAppearance({ ...appearance, transparency: Number(event.target.value) })} />
          </label>
        </fieldset>
        <button type="submit" className="btn btn-comma justify-self-end" disabled={saving || !changed}>{saving ? '적용 중…' : '위젯에 적용'}</button>
      </form>
      <Modal isOpen={!!notice} onClose={() => setNotice('')} title="위젯 설정">
        <p>{notice}</p>
      </Modal>
    </section>
  )
}
