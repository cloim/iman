const KEY = 'iman.kiosk'

export interface KioskCredential {
  id: string
  token: string
  dashboardId: string | null
}

export function loadKiosk(): KioskCredential | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as KioskCredential) : null
  } catch {
    return null
  }
}

export function saveKiosk(k: KioskCredential | null) {
  try {
    if (k) localStorage.setItem(KEY, JSON.stringify(k))
    else localStorage.removeItem(KEY)
  } catch {
    // 저장 불가 환경에서는 새로 고침 시 다시 페어링
  }
}

/** 키오스크 토큰으로 API 호출 */
export async function kioskApi<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error((body as { error?: string }).error ?? 'unknown'), { status: res.status })
  }
  return (await res.json()) as T
}
