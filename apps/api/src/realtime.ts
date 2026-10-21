import type { FastifyReply } from 'fastify'

/** 그룹 단위 SSE 허브. API 인스턴스가 하나이므로 메모리 안에서 전달한다 */
export type GroupEvent =
  | { type: 'rollup'; userId: string; date: string }
  | { type: 'pause'; pauseId: string }
  | { type: 'members' }
  | { type: 'kiosk_revoked'; kioskId: string }

const subscribers = new Map<string, Set<FastifyReply>>()

/** 응답을 SSE 스트림으로 넘기고 여러 채널(그룹, 키오스크)을 함께 구독한다 */
export function subscribe(channels: string[], reply: FastifyReply) {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  reply.raw.write('retry: 5000\n\n')
  for (const ch of channels) {
    let set = subscribers.get(ch)
    if (!set) subscribers.set(ch, (set = new Set()))
    set.add(reply)
  }
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000)
  reply.raw.on('close', () => {
    clearInterval(ping)
    for (const ch of channels) {
      const set = subscribers.get(ch)
      set?.delete(reply)
      if (set?.size === 0) subscribers.delete(ch)
    }
  })
}

export function publish(channel: string | null | undefined, event: GroupEvent) {
  if (!channel) return
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  for (const r of subscribers.get(channel) ?? []) r.raw.write(data)
}
