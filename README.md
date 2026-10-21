# 이만, (iman)

내 모든 안드로이드 기기의 화면 시간을 앱별 구간(시작~종료)으로 기록하고, 그룹과 함께 "이만, 쉬어 가는" 습관을 만드는 서비스입니다. 웹앱, 안드로이드 앱(위젯 포함), 대시보드(키오스크)로 사용합니다.

- 총 사용시간: 모든 앱 사용 구간 길이의 합
- 실제 사용시간: 동시 실행(분할 화면, PIP, 여러 기기)을 한 번만 센 합집합 길이

설계, 계획, 회고 문서(`docs/`)는 운영 PC에서 관리하며 공개 저장소에는 포함하지 않습니다.

## 구조

| 경로 | 내용 |
|---|---|
| `packages/core` | 구간 계산, 시간대, 목표 판정(순수 TS) |
| `apps/api` | Fastify API, 정적 웹 제공, SSE, 예약 작업 |
| `apps/web` | React SPA(웹, 앱 WebView, 대시보드). 스타일은 Tailwind CSS v4, 디자인 토큰은 `src/styles/tokens.css`와 `app.css`의 `@theme` |
| `apps/web/android` | Capacitor 안드로이드. 수집기, 동기화, 위젯, 넛지, 업데이터는 `app/src/main/java/com/cloimism/iman` |
| `db/migrations` | 스키마, `range_agg` 집계 함수, RLS |
| `fixtures/intervals` | TS, Kotlin, SQL 공용 골든 케이스 |
| `deploy` | 로컬 도커 엔진용 compose(Postgres, API) |

## 개발

```powershell
pnpm install
pnpm --filter @iman/api dev      # 127.0.0.1:47211, apps/api/.env.local (DB: iman_dev, DEV_LOGIN=1)
pnpm --filter @iman/web dev      # http://localhost:5173 (API 프록시)
pnpm --filter @iman/api exec tsx scripts/seed-dev.ts   # 데모 그룹과 14일 기록
pnpm test                        # core 단위, API 통합(iman_test DB 자동 생성)
cd apps/web/android; ./gradlew testDebugUnitTest assembleDebug
```

에뮬레이터 개발 빌드는 `VITE_API_BASE=http://localhost:47211`, `IMAN_DEV=1`, `IMAN_API_BASE=http://localhost:47211`로 빌드하고 `adb reverse tcp:47211 tcp:47211`을 연결합니다. 디버그 빌드는 구글 클라이언트 ID가 없으면 개발 로그인을 씁니다.

## 운영

```powershell
cd deploy
docker compose -f compose.yaml up -d --build
```

- `deploy/.env`에 비밀값(DB 비밀번호, JWT, `GOOGLE_WEB_CLIENT_ID`)을 두고, FCM 서비스 계정은 `deploy/secrets/fcm-service-account.json`에 둡니다.
- API는 `127.0.0.1:47210`, Postgres는 `127.0.0.1:47200`. 외부 공개는 Cloudflare Tunnel(`iman.example.com`)만 사용합니다.
- 로컬 도커 엔진의 브리지 네트워크는 외부 연결과 컨테이너 간 연결이 막혀 있어 API 컨테이너는 호스트 네트워크를 씁니다.

## 안드로이드 릴리스

이 PC에서 서명 빌드하여 GitHub Releases(`<owner>/iman`)에 올립니다. 루트 `package.json`의 `version`을 올린 뒤 실행합니다.

```bash
pnpm release:android -- --notes "변경 내용"      # 검증(타입, 테스트), 웹 빌드, cap sync, 서명 APK, 업로드
pnpm release:android -- --dry-run                 # 업로드 없이 release/ 에 APK 만 생성
```

- 서명 키는 저장소 밖 속성 파일(`IMAN_SIGNING_PROPERTIES`, `deploy/.env` 에 지정)의 공용 키를 씁니다.
- 구글 웹 클라이언트 ID는 `deploy/.env`에서, FCM 설정은 `apps/web/android/app/google-services.json`에서 읽습니다.
- 릴리스에는 APK와 `latest.json`(버전, sha256)이 올라가고, 앱은 설정 화면에서 이를 확인해 sha256과 서명 인증서가 맞을 때만 설치합니다.
- 산출물은 `release/`(Git 제외)에 남습니다.
