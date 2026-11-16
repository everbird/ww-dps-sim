// src/engine/resource-replay.ts —— 按日志重放角色资源（DD-09 §3.2，DF-09）：invariants.ts 的 checkLog、summary.ts 的 loops() 与
// resourceTimeline() 三处共用。从开局值出发：命中按 hit.gains 的实际增减累加，resource 事件取它的 value；
// 每条事件之后，按 afterEventSeq、orderInAnchor 套用排在它后面的静默同步（外部干预记录里 kind === 'sync' 的）。
// 只套用同步：能量满、敌人 失谐 / 换 照旧写了业务事件，再套一次就重复了。afterEventSeq = -1 的（第一条事件之前）最先套用。
// 诊断关着时也成立：干预记录一直都有（架构 §4.1）。
// 浮点：照原来三处的写法直接相加（不按 1e-9 取整），没有同步的场景结果逐位不变。
import type { ResourceKind } from '../data/common'
import { round } from './num'
import type { InterventionRecord } from './run-types'
import type { Core5, ResolvedScenario, SimEvent } from './types'

/** 三人的资源（下标 = 槽位） */
export interface ResourceBalances {
  energy: [number, number, number]
  concerto: [number, number, number]
  core: [Core5, Core5, Core5]
}

/** 重放的一步：一条事件，或排在某条事件之后的一次同步。f 是世界帧；bf 是战斗帧（同步取它所接的那条事件的战斗帧：
 *  同步在 P2 执行，前面紧挨着的通常是同一帧的 at 等待段或出招，开局的同步记 0） */
export type ReplayItem =
  | { readonly kind: 'event'; readonly seq: number; readonly e: SimEvent; readonly f: number; readonly bf: number }
  | { readonly kind: 'sync'; readonly rec: InterventionRecord; readonly f: number; readonly bf: number }

export function openingBalances(r: Pick<ResolvedScenario, 'initial'>): ResourceBalances {
  const i = r.initial
  return {
    energy: [...i.energy],
    concerto: [...i.concerto],
    core: i.core.map(c => [...c]) as [Core5, Core5, Core5],
  }
}

/** 某人某种资源的当前值 */
export function balanceOf(b: ResourceBalances, slot: number, res: ResourceKind): number {
  return res === 'energy' ? b.energy[slot]! : res === 'concerto' ? b.concerto[slot]! : b.core[slot]![Number(res.slice(4)) - 1]!
}

function put(b: ResourceBalances, slot: number, res: ResourceKind, v: number): void {
  if (res === 'energy') b.energy[slot] = v
  else if (res === 'concerto') b.concerto[slot] = v
  else b.core[slot]![Number(res.slice(4)) - 1] = v
}

/** 事件与同步按发生的先后排成一列（同步排在它的 afterEventSeq 那条事件之后，同一锚点按 orderInAnchor） */
export function replayItems(log: readonly SimEvent[], interventions: readonly InterventionRecord[]): ReplayItem[] {
  const battleFrameOf = (e: SimEvent) => round(e.t * 60)        // 同 summary.ts 的 battleFrameOf（这里不 import 它，免得两边互相引用）
  const syncs = interventions.filter(x => x.kind === 'sync').sort((a, b) => a.afterEventSeq - b.afterEventSeq || a.orderInAnchor - b.orderInAnchor)
  const out: ReplayItem[] = []
  let k = 0
  const flush = (seq: number, bf: number) => {
    for (; k < syncs.length && syncs[k]!.afterEventSeq <= seq; k++) out.push({ kind: 'sync', rec: syncs[k]!, f: syncs[k]!.f, bf })
  }
  flush(-1, 0)
  log.forEach((e, seq) => {
    const bf = battleFrameOf(e)
    out.push({ kind: 'event', seq, e, f: e.f, bf })
    flush(seq, bf)
  })
  flush(Infinity, log.length ? battleFrameOf(log[log.length - 1]!) : 0)
  return out
}

/** 一步对资源的改动：hit 的 gains 累加（能量给到的各人、协奏与核心资源给出伤者），resource 事件取 value，同步取采用值 */
export function applyItem(b: ResourceBalances, item: ReplayItem, slotOf: ReadonlyMap<string, number>): void {
  if (item.kind === 'sync') {
    const t = item.rec.target
    if (t?.slot !== undefined && t.resource !== undefined && item.rec.adopted !== undefined) put(b, t.slot, t.resource, item.rec.adopted)
    return
  }
  const e = item.e
  if (e.type === 'hit') {
    for (const [name, v] of Object.entries(e.gains.energy)) b.energy[slotOf.get(name)!]! += v!
    const s = slotOf.get(e.char)!
    b.concerto[s]! += e.gains.concerto
    e.gains.core.forEach((d, i) => { if (d) b.core[s]![i]! += d })
  } else if (e.type === 'resource') {
    put(b, slotOf.get(e.char)!, e.resource, e.value)
  }
}

/** 从开局值逐步重放；visit 在每一步套用之前调（看到的是这一步之前的余额），返回 'stop' 就停下（这一步不套用）。返回停下时的余额 */
export function replayResources(
  log: readonly SimEvent[], r: Pick<ResolvedScenario, 'team' | 'initial'>, interventions: readonly InterventionRecord[],
  visit?: (item: ReplayItem, before: Readonly<ResourceBalances>) => 'stop' | void,
): ResourceBalances {
  const slotOf = new Map(r.team.map(m => [m.def.name, m.slot] as const))
  const b = openingBalances(r)
  for (const item of replayItems(log, interventions)) {
    if (visit?.(item, b) === 'stop') break
    applyItem(b, item, slotOf)
  }
  return b
}
