import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.cloimism.iman',
  appName: '이만',
  webDir: 'dist',
  // 플러그인 응답(액세스 토큰 포함)이 logcat 에 남지 않도록
  loggingBehavior: 'none',
  android: {
    backgroundColor: '#FEF9ED',
    // 에뮬레이터 개발 빌드(IMAN_DEV=1)에서만 https://localhost 에서 http://localhost API 호출 허용
    allowMixedContent: process.env.IMAN_DEV === '1',
  },
}

export default config
