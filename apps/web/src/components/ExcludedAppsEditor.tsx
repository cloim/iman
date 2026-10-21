import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { api, errorText } from '../lib/api'

interface CatalogApp {
  packageName: string
  label: string
}

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/

/** 예외 앱 이름. 앱 이름을 모르면 패키지 이름을 그대로 보여 준다 */
export const appName = (pkg: string, labels: Record<string, string>) => labels[pkg] ?? pkg

/** 고정된 예외 앱 목록(구성원 화면에 보이는 그룹 공통 목록 등) */
export function ExcludedAppChips({ packages, labels }: { packages: string[]; labels: Record<string, string> }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {packages.map((p) => (
        <li key={p} className="chip" title={p}>
          {appName(p, labels)}
        </li>
      ))}
    </ul>
  )
}

/**
 * 관리자용 예외 앱 편집. 앱 이름으로 찾아 더하거나, 아직 기록이 없는 앱은 패키지 이름을 그대로 더한다.
 * 저장은 부모 화면의 저장 버튼이 맡는다
 */
export function ExcludedAppsEditor({
  value,
  onChange,
  labels,
  label,
}: {
  value: string[]
  onChange: (next: string[], labels: Record<string, string>) => void
  labels: Record<string, string>
  label: string
}) {
  const id = useId()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const catalog = useQuery({
    queryKey: ['app-catalog', term],
    queryFn: () => api<{ apps: CatalogApp[] }>(`/api/group/app-catalog?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 60_000,
  })

  const add = (pkg: string, name?: string) => {
    if (!value.includes(pkg)) onChange([...value, pkg].sort(), name ? { ...labels, [pkg]: name } : labels)
    setQ('')
    setTerm('')
  }
  const results = (catalog.data?.apps ?? []).filter((a) => !value.includes(a.packageName))
  const typed = q.trim()
  const canAddTyped = PACKAGE.test(typed) && !value.includes(typed) && !results.some((a) => a.packageName === typed)

  return (
    <div className="grid gap-2.5">
      <label className="text-[13px] font-semibold text-ink-2" htmlFor={id}>
        {label}
      </label>
      {value.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {value.map((p) => (
            <li key={p} className="chip pr-1" title={p}>
              {appName(p, labels)}
              <button
                type="button"
                className="inline-grid size-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-3 hover:text-ink"
                aria-label={`${appName(p, labels)} 빼기`}
                onClick={() => onChange(value.filter((x) => x !== p), labels)}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3">아직 예외 앱이 없어요.</p>
      )}
      <input
        id={id}
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          // 부모 form 이 저장되지 않도록 엔터는 입력한 패키지 추가로만 쓴다
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (canAddTyped) add(typed)
          else if (results.length === 1) add(results[0]!.packageName, results[0]!.label)
        }}
        placeholder="앱 이름이나 패키지 이름으로 찾기"
        autoComplete="off"
        maxLength={200}
      />
      {term.length >= 2 && (
        <div className="grid gap-1" aria-live="polite">
          {catalog.isPending ? (
            <div className="skeleton h-10" />
          ) : catalog.error ? (
            <p className="text-[13px] text-over-ink">{errorText(catalog.error)}</p>
          ) : (
            <>
              {results.map((a) => (
                <button
                  key={a.packageName}
                  type="button"
                  className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-tile border-0 bg-surface-2 px-3 text-left hover:bg-comma-tint"
                  onClick={() => add(a.packageName, a.label)}
                >
                  <Plus size={16} aria-hidden className="flex-none text-comma-deep" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{a.label}</span>
                  <span className="min-w-0 truncate text-[12px] text-ink-3">{a.packageName}</span>
                </button>
              ))}
              {canAddTyped && (
                <button
                  type="button"
                  className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-tile border-0 bg-surface-2 px-3 text-left hover:bg-comma-tint"
                  onClick={() => add(typed)}
                >
                  <Plus size={16} aria-hidden className="flex-none text-comma-deep" />
                  <span className="min-w-0 truncate">{typed} 추가</span>
                </button>
              )}
              {results.length === 0 && !canAddTyped && (
                <p className="text-[13px] text-ink-3">찾는 앱이 없어요. 패키지 이름(예: com.example.app)으로 더할 수 있어요.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
