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
  /** 개발, 테스트 전용 로그인 허용 */
  devLogin: process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === '1',
  production: process.env.NODE_ENV === 'production',
}
