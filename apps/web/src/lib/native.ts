import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface NativeStatus {
  signedIn: boolean
  usagePermission: boolean
  notificationPermission: boolean
  installPermission: boolean
  deviceId: string | null
  lastSyncAt: number | null
  appVersion: string
  versionCode: number
}

export interface UpdateInfo {
  available: boolean
  versionName: string | null
  notes: string | null
  mandatory: boolean
}

/** Kotlin 플러그인(ImanNativePlugin) 계약. 리프레시 토큰은 네이티브만 보관한다 */
export interface ImanNativePlugin {
  signIn(): Promise<{ ok: boolean }>
  signOut(): Promise<void>
  getAccessToken(options?: { force?: boolean }): Promise<{ token: string | null }>
  getStatus(): Promise<NativeStatus>
  openUsageSettings(): Promise<void>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  openInstallSettings(): Promise<void>
  syncNow(): Promise<{ accepted: number }>
  startRest(options: { minutes: number; source: 'app' | 'group'; pauseId?: string }): Promise<void>
  /** 그 함께 쉬기로 쉬던 중이면 남은 쉬기를 끝낸다 */
  endRest(options: { pauseId: string }): Promise<void>
  checkUpdate(): Promise<UpdateInfo>
  installUpdate(): Promise<void>
  addListener(
    event: 'updateProgress',
    fn: (e: { downloaded: number; total: number; phase: 'download' | 'verify' | 'install' }) => void,
  ): Promise<PluginListenerHandle>
}

export const isNative = Capacitor.isNativePlatform()
export const native = registerPlugin<ImanNativePlugin>('ImanNative')
