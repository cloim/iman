function required(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`환경 변수 ${key} 가 필요합니다`)
  return v
}

export const env = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 47210),
  databaseUrl: required('DATABASE_URL'),
  databaseOwnerUrl: required('DATABASE_OWNER_URL'),
  appDbPassword: required('APP_DB_PASSWORD'),
  jwtSecret: new TextEncoder().encode(required('JWT_SECRET')),
  publicOrigin: required('PUBLIC_ORIGIN'),
  googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT ?? '',
  webDist: process.env.WEB_DIST ?? '',
  /** 안드로이드 APK 를 올리는 GitHub 저장소(owner/name). 비우면 앱 다운로드 안내를 숨긴다 */
  releaseRepo: process.env.IMAN_RELEASE_REPO ?? '',
  /** 개발, 테스트 전용 로그인 허용 */
  devLogin: process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === '1',
  production: process.env.NODE_ENV === 'production',
  /** 0이면 정기 작업을 돌리지 않는다. 운영 DB에 붙는 개발 서버가 알림과 리포트를 중복으로 보내지 않게 */
  scheduler: process.env.SCHEDULER !== '0',
}
