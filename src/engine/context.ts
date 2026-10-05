// src/engine/context.ts —— 一次仿真的运行环境（总设计 §3.4）
// 与 SimState 分开：SimState 是可 structuredClone 的纯数据；这里放只读的装配结果、buff 登记表、钩子接口，
// 以及事件队列的簿记（TD-07 §5）。队列在每个 tick 结束前处理完，所以 tick 之间簿记总是空的，分支时不用复制。
import type { Slot } from '../data/common'
import type { BuffBook } from './buffs'
import type { ActiveBuff, HitContext, HitView } from './formula'
import type { Kernel } from './kernel'
import type { HitDraft, HookContext, ResolvedScenario } from './types'

/** 一次直接伤害结算的输入（不含面板）：换声骸后按新面板重算这一段（TD-13 §3）。index 是日志里那条 hit 事件 */
export interface HitRecord {
  slot: Slot
  index: number
  ctx: Omit<HitContext, 'panel'>
  view: HitView
  active: ActiveBuff[]
  draft: Pick<HitDraft, 'zones' | 'critOnly'>
}

/** simulate 的可选项 */
export interface SimOptions { onHit?: (rec: HitRecord) => void }

export interface Sim {
  r: ResolvedScenario
  k: Kernel
  book: BuffBook
  ctxs: HookContext[]                       // 各槽位钩子的受控接口
  slotOf: ReadonlyMap<string, Slot>         // 角色名 → 槽位
  warned: Set<string>                       // 同一件事只提示一次
  bus: EventBus
  onHit?: (rec: HitRecord) => void        // 记下每次直接伤害结算的输入（配装择优的快速重算，TD-13 §3）
}

/** 事件队列（TD-07 §5）：日志本身就是队列，cursor 之前的事件都处理过了 */
export interface EventBus {
  cursor: number
  draining: boolean
  chain: Map<number, Link>                  // 日志下标 → 它在事件链上的位置；没有记录的是链的起点（深度 0）
  current: Link | null                      // 正在处理的事件
  spawned: Map<number, Link>                // 钩子生成的判定 id → 它的结算接在哪条链上（本 tick 有效）
}
/** depth：离起点几层；root：起点事件的日志下标 */
export interface Link { depth: number; root: number }

export const newBus = (): EventBus => ({ cursor: 0, draining: false, chain: new Map(), current: null, spawned: new Map() })
