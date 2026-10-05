// web/app/src/api.ts —— 向 Worker 发请求，按 id 配对回复
import type { Kind, Reply, Requests } from './protocol'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
let next = 1
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>()
worker.onmessage = (ev: MessageEvent<Reply>) => {
  const w = waiting.get(ev.data.id)
  if (!w) return
  waiting.delete(ev.data.id)
  if (ev.data.ok) w.ok(ev.data.res)
  else w.fail(new Error(ev.data.error))
}

export function call<K extends Kind>(kind: K, req: Requests[K]['req']): Promise<Requests[K]['res']> {
  const id = next++
  return new Promise((ok, fail) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, fail })
    worker.postMessage({ id, kind, req })
  })
}
