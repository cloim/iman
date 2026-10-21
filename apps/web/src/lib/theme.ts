export type ThemePref = 'auto' | 'light' | 'dark'
const KEY = 'iman.theme'

export function storedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement
  if (pref === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    // 저장 불가 환경에서는 이번 세션에만 적용
  }
}

export const applyStoredTheme = () => applyTheme(storedTheme())
