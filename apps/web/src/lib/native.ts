import { Capacitor, registerPlugin } from '@capacitor/core'

export interface NativeStatus {
  signedIn: boolean
  usagePermission: boolean
  notificationPermission: boolean
  deviceId: string | null
  lastSyncAt: number | null
  appVersion: string
}

export interface WidgetAppearance {
  backgroundColor: string
  transparency: number
}

/** Kotlin 플러그인(ImanNativePlugin) 계약. 리프레시 토큰은 네이티브만 보관한다 */
export interface ImanNativePlugin {
  signIn(): Promise<{ ok: boolean }>
  signOut(): Promise<void>
  getAccessToken(options?: { force?: boolean }): Promise<{ token: string | null }>
  getStatus(): Promise<NativeStatus>
  getWidgetAppearance(): Promise<WidgetAppearance>
  setWidgetAppearance(options: WidgetAppearance): Promise<void>
  openUsageSettings(): Promise<void>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  syncNow(): Promise<{ accepted: number }>
  startRest(options: { minutes: number; source: 'app' | 'group'; pauseId?: string }): Promise<void>
  /** 그 함께 쉬기로 쉬던 중이면 남은 쉬기를 끝낸다 */
  endRest(options: { pauseId: string }): Promise<void>
}

export const isNative = Capacitor.isNativePlatform()
export const native = registerPlugin<ImanNativePlugin>('ImanNative')
