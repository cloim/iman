import { existsSync, readFileSync } from 'node:fs'
import { cert, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { tx } from './db'
import { env } from './env'

let app: App | null | undefined

function firebase(): App | null {
  if (app !== undefined) return app
  if (!env.fcmServiceAccount || !existsSync(env.fcmServiceAccount)) {
    console.warn('FCM 서비스 계정이 없어 푸시를 보내지 않습니다')
    return (app = null)
  }
  const sa = JSON.parse(readFileSync(env.fcmServiceAccount, 'utf8'))
  return (app = initializeApp({ credential: cert(sa) }, 'iman'))
}

export interface PushMessage {
  title: string
  body: string
  data: Record<string, string>
}

/** 사용자들의 모든 기기에 데이터 푸시. 만료 토큰은 정리한다 */
export async function pushToUsers(userIds: string[], msg: PushMessage) {
  const fb = firebase()
  if (!fb || userIds.length === 0) return
  const tokens = await tx({ kind: 'system' }, async (c) => {
    const r = await c.query<{ device_id: string; fcm_token: string }>(
      `select p.device_id, p.fcm_token from push_tokens p
       join devices d on d.id = p.device_id
       where d.user_id = any($1) and d.active`,
      [userIds],
    )
    return r.rows
  })
  if (tokens.length === 0) return
  const res = await getMessaging(fb).sendEachForMulticast({
    tokens: tokens.map((t) => t.fcm_token),
    data: { ...msg.data, title: msg.title, body: msg.body },
    android: { priority: 'high' },
  })
  const stale = res.responses
    .map((r, i) => (r.error?.code === 'messaging/registration-token-not-registered' ? tokens[i]!.device_id : null))
    .filter((v): v is string => v !== null)
  if (stale.length) {
    await tx({ kind: 'system' }, (c) => c.query('delete from push_tokens where device_id = any($1)', [stale]))
  }
}
