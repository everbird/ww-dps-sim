// web/app/src/worker.ts —— 引擎在这里跑（页面不卡）：收到消息交给 handlers，按 id 回复
import { handlers } from './handlers'
import type { Message } from './protocol'

self.onmessage = async (ev: MessageEvent<Message>) => {
  const { id, kind, req } = ev.data
  try {
    const res = await (handlers[kind] as (r: typeof req) => Promise<unknown>)(req)
    self.postMessage({ id, ok: true, res })
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
