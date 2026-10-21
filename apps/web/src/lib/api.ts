import { isNative, native } from './native'

/** 앱(WebView)은 원격 API 를 절대 경로로, 웹은 같은 출처로 호출 */
export const API_BASE = isNative ? (import.meta.env.VITE_API_BASE ?? 'https://iman.example.com') : ''

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

let refreshing: Promise<boolean> | null = null

function refreshWebSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0))
  return refreshing
}

async function authHeader(force = false): Promise<Record<string, string>> {
  if (!isNative) return {}
  const { token } = await native.getAccessToken({ force })
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const send = async (force: boolean) =>
    fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: isNative ? 'omit' : 'same-origin',
      signal: init.signal,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(await authHeader(force)),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })

  let res = await send(false)
  if (res.status === 401) {
    const renewed = isNative ? true : await refreshWebSession()
    if (renewed) res = await send(true)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, (body as { error?: string }).error ?? 'unknown')
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** SSE URL. 앱과 키오스크는 쿼리 토큰으로 인증 */
export async function eventsUrl(path: string, token?: string | null): Promise<string> {
  if (token) return `${API_BASE}${path}?token=${encodeURIComponent(token)}`
  if (isNative) {
    const { token: t } = await native.getAccessToken()
    return `${API_BASE}${path}?token=${encodeURIComponent(t ?? '')}`
  }
  return path
}

export const ERROR_TEXT: Record<string, string> = {
  already_in_group: '이미 다른 그룹에 속해 있어요. 한 계정은 한 그룹에만 함께할 수 있어요.',
  invite_invalid: '초대 코드가 만료되었거나 올바르지 않아요.',
  invite_email_mismatch: '이 초대는 다른 이메일 계정을 위한 초대예요.',
  pair_code_invalid: '코드를 찾을 수 없어요. 화면의 코드가 바뀌었는지 확인해 주세요.',
  too_many_attempts: '잠시 후 다시 시도해 주세요.',
  pause_active: '이미 함께 쉬기가 진행 중이에요.',
  pause_ended: '함께 쉬기가 끝났어요.',
  forbidden_role: '그룹대표만 할 수 있는 작업이에요.',
  google_not_configured: '구글 로그인 설정이 아직 준비되지 않았어요.',
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? (ERROR_TEXT[e.code] ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.') : '네트워크 연결을 확인해 주세요.'
