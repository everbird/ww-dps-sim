// DD-10 §3：tick 边界快照。运行定义按标识接回，执行从保存的边界继续。
import type { Frame, Slot } from '../data/common'
import { anyDiag, type DiagOptions } from './diagnostics'
import { canonicalJson } from './digest'
import { replayTo, viewOf, type QueryResult, type ReplayComplete, type ReplayPrefix, type StateView, type StopPoint } from './query'
import { runToExecution } from './run'
import type { PreparedRun, RunOptions, StatePrefix } from './run-types'
import type { Execution, ExecutionMemory } from './simulate'
import type { ActionRuntime, SimEvent, SimState } from './types'
import { fromWire, toWire, type JsonValue, type WireSchema } from './wire'

export interface Snapshot {
  readonly runId: string
  readonly frame: Frame
  readonly prefix: StatePrefix
  readonly diagOptions: DiagOptions | null
  readonly payload: unknown
}
export type Replay = ReplayPrefix | ReplayComplete
interface Payload { view: StateView; log: SimEvent[]; memory: ExecutionMemory }

// schema 随纯数据保存；只标记有歧义的数值、Map、Set。编解码仍经 DD-07 wire。
// 普通文本 'inf' 不会被解码成数值。数组按下标的 schema 保留异构诊断表。
function schemaOf(x: unknown): WireSchema {
  if (typeof x === 'number' && !Number.isFinite(x)) return { kind: 'number', allowInf: true }
  if (x instanceof Map) return { kind: 'map' }
  if (x instanceof Set) return { kind: 'set' }
  if (Array.isArray(x)) {
    const items = x.map(schemaOf)
    return items.some(s => s.kind !== 'any') ? { kind: 'tuple', items } : { kind: 'any' }
  }
  if (x && typeof x === 'object') {
    const fields = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, schemaOf(v)]).filter(([, v]) => (v as WireSchema).kind !== 'any'))
    return Object.keys(fields).length ? { kind: 'object', fields } : { kind: 'any' }
  }
  return { kind: 'any' }
}
export const diagKey = (d?: DiagOptions | null): string => canonicalJson(anyDiag(d ?? undefined) ? d : null)

/** 只允许真正的初始化 / P7 边界；测试也用此入口验证簿记断言。 */
export function captureSnapshot(p: PreparedRun, x: Execution, opts: RunOptions = {}): Snapshot {
  if (!x.initCompleted || x.loopExit || x.postDrainCompleted || x.failure || (x.k.at.phase !== 'init' && x.k.at.phase !== 'afterP7')) throw new Error('snapshot: not a tick boundary')
  const data: Payload = { view: viewOf(x.s), log: x.s.log, memory: x.checkpoint() }
  return {
    runId: p.runId, frame: x.s.frame,
    prefix: { eventEndExclusive: x.s.log.length, handledEndExclusive: x.sim.bus.cursor, interventionEndExclusive: x.sim.interventions.length },
    diagOptions: anyDiag(opts.diag) ? structuredClone(opts.diag!) : null,
    payload: { data: toWire(data), schema: schemaOf(data) },
  }
}

/** DD-07 StateView 的反向投影；动作实例先建表，保证 action/last/combo 的别名。 */
export function stateFromView(p: PreparedRun, v: StateView, log: SimEvent[]): SimState {
  const r = p.resolved
  const actionDef = (slot: Slot, id: string) => {
    const def = r.team[slot].actions[id]
    if (!def) throw new Error(`snapshot: unknown action ${slot}/${id}`)
    return def
  }
  const chars = v.chars.map(c => {
    const instances = new Map<number, ActionRuntime>()
    const restore = (a: typeof c.action): ActionRuntime | null => {
      if (!a) return null
      let out = instances.get(a.instance)
      if (!out) { out = { ...structuredClone(a), def: actionDef(c.slot, a.id) } as ActionRuntime; instances.set(a.instance, out) }
      return out
    }
    return { ...structuredClone(c), vars: Object.seal({ ...c.vars }), action: restore(c.action), last: restore(c.last), combo: restore(c.combo) }
  }) as SimState['chars']
  const { presetId, ...enemy } = structuredClone(v.enemy)
  const preset = presetId === r.enemy.id ? r.enemy : r.data.enemies[presetId]
  if (!preset) throw new Error(`snapshot: unknown enemy ${v.enemy.presetId}`)
  return {
    ...structuredClone(v), chars, log,
    enemy: { ...enemy, preset },
    judgments: v.judgments.map(j => {
      const def = actionDef(j.owner, j.action).judgments.find(d => d.name === j.judgment)
      if (!def) throw new Error(`snapshot: unknown judgment ${j.judgment}`)
      const { judgment: _judgment, ...runtime } = j
      return { ...runtime, def }
    }),
    tails: v.tails.map(t => ({ ...structuredClone(t), events: structuredClone([...t.events]), def: actionDef(t.owner, t.action) })),
    queue: { ...structuredClone(v.queue), commands: r.commands, opening: r.opening, repeat: r.options.repeat },
  // view 的 readonly 是查询接口约束；以上结构已复制为可写的独立对象。
  } as unknown as SimState
}

export function snapshotsAt(p: PreparedRun, frames: readonly Frame[], opts: RunOptions = {}): QueryResult<Snapshot[]> {
  const captured = new Map<number, Snapshot>()
  const valid = new Set(frames.filter(f => Number.isInteger(f) && f >= 0))
  const { x, result } = runToExecution(p, { ...opts,
    checkpoint: x => { captured.set(x.s.frame, captureSnapshot(p, x, opts)) },
    observer: { frames: valid, onBoundary: () => undefined },
  })
  if (!x.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有合法状态边界' } }
  for (const f of frames) if (!captured.has(f)) return { ok: false, error: { code: 'outOfRange', completedTicks: result!.completion.coverage.completedTicks, message: `没有合法状态 S[${f}]` } }
  return { ok: true, value: frames.map(f => captured.get(f)!) }
}
export function snapshotAt(p: PreparedRun, f: Frame, opts: RunOptions = {}): QueryResult<Snapshot> {
  return captureAt(p, f, opts)
}
function captureAt(p: PreparedRun, f: Frame, opts: RunOptions, resume?: { state: SimState; memory: ExecutionMemory }): QueryResult<Snapshot> {
  let snap: Snapshot | undefined
  const { x } = runToExecution(p, { ...opts, ...(resume ? { resume } : {}), checkpoint: x => { snap = captureSnapshot(p, x, opts) }, observer: { frames: new Set([f]), onBoundary: () => 'stop' } })
  if (snap) return { ok: true, value: snap }
  return { ok: false, error: !x.initCompleted ? { code: 'noLegalState', message: '初始化未完成' } : { code: 'outOfRange', completedTicks: x.s.frame, message: `没有合法状态 S[${f}]` } }
}

export function resumeFrom(p: PreparedRun, snap: Snapshot, stop: StopPoint, opts: RunOptions = {}): QueryResult<Replay> {
  if (snap.runId !== p.runId) return { ok: false, error: { code: 'runIdMismatch', expected: p.runId, got: snap.runId } }
  if (diagKey(opts.diag) !== diagKey(snap.diagOptions)) return { ok: false, error: { code: 'unsupported', what: 'snapshot diagnostic options mismatch' } }
  if (stop.kind === 'boundary' && stop.frame < snap.frame) return { ok: false, error: { code: 'unsupported', what: 'cannot resume backwards' } }
  const r = restore(p, snap)
  if (!r.ok) return r
  return { ok: true, value: replayTo(p, stop, opts, r.value) }
}
/** 快照的载荷解码回状态与运行记忆；载荷损坏（不是 captureSnapshot 写出来的、存盘后被改过）时返回查询错误，不往外抛（Antigravity 审查 M2） */
function restore(p: PreparedRun, snap: Snapshot): QueryResult<{ state: SimState; memory: ExecutionMemory }> {
  try {
    const payload = snap.payload as { data: JsonValue; schema: WireSchema }
    if (!payload || typeof payload !== 'object' || payload.data === undefined) throw new Error('没有 data')
    const data = fromWire<Payload>(structuredClone(payload.data), payload.schema)
    return { ok: true, value: { state: stateFromView(p, data.view, data.log), memory: data.memory } }
  } catch (e) {
    return { ok: false, error: { code: 'unsupported', what: `快照载荷解码失败：${e instanceof Error ? e.message : String(e)}` } }
  }
}
/** 查询缓存内部推进：跨过下一个 600 帧边界时也从旧快照续跑，不重新初始化。 */
export function snapshotFrom(p: PreparedRun, snap: Snapshot, f: Frame, opts: RunOptions = {}): QueryResult<Snapshot> {
  if (snap.runId !== p.runId) return { ok: false, error: { code: 'runIdMismatch', expected: p.runId, got: snap.runId } }
  if (diagKey(opts.diag) !== diagKey(snap.diagOptions) || f < snap.frame)
    return { ok: false, error: { code: 'unsupported', what: 'snapshot options mismatch or backwards boundary' } }
  const r = restore(p, snap)
  if (!r.ok) return r
  return captureAt(p, f, opts, r.value)
}

export interface SnapshotCache {
  get(runId: string, f: Frame, diagOptions?: DiagOptions | null): Snapshot | undefined
  put(snapshot: Snapshot): void
}
/** 进程内缓存，每 600 帧一个快照，诊断分桶；无磁盘状态。 */
export class MemorySnapshotCache implements SnapshotCache {
  private readonly entries = new Map<string, Map<number, Snapshot>>()
  get(runId: string, f: Frame, diagOptions?: DiagOptions | null): Snapshot | undefined {
    const entries = this.entries.get(`${runId}:${diagKey(diagOptions)}`)
    let best: Snapshot | undefined
    for (const [frame, snap] of entries ?? []) if (frame <= f && (!best || frame > best.frame)) best = snap
    return best ? structuredClone(best) : undefined
  }
  put(snapshot: Snapshot): void {
    const key = `${snapshot.runId}:${diagKey(snapshot.diagOptions)}`
    let entries = this.entries.get(key)
    if (!entries) this.entries.set(key, entries = new Map())
    entries.set(snapshot.frame, structuredClone(snapshot))
  }
}
