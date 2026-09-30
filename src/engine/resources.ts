// src/engine/resources.ts —— TD-06：角色资源（大招能量、协奏、核心资源）
// 什么时刻、给谁、加减多少：每次结算的全队能量分配（§2.1）、大招门槛与扣除（§2.3）、协奏的两种发放时机（§3.2）、
// 核心资源与合并区（§4）、资源型效果与钩子共用的 grant（§5）。负数就是消耗，统一"带符号累加，截在 [0, 上限]"。
import { RESOURCE_KINDS, type CharName, type ResourceKind, type Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import { activeFor } from './buffs'
import type { Sim } from './context'
import { log, SLOTS, ticksWithinLife, type EventSource } from './kernel'
import type { HitEvent, JudgmentRuntime, SimEvent, SimState } from './types'

type FullEvent = Omit<Extract<SimEvent, { type: 'resourceFull' }>, 'f' | 't'>

/** 资源值每次改动后取整到 1e-9：0.93 × 1.256 这类小数累加的浮点误差不影响"满没满""够不够"的比较 */
const snap9 = (x: number): number => Math.round(x * 1e9) / 1e9
const clamp = (v: number, cap: number): number => Math.max(0, Math.min(cap, v))

/** R(x)：静态面板共鸣效率 + 身上 energyRegen 乘区的 buff（结算这一刻，§2.1） */
export function regenOf(sim: Sim, s: SimState, slot: Slot): number {
  let r = sim.r.team[slot].panel.energyRegen
  for (const b of activeFor(s, sim.book, slot)) if (b.def.zone === 'energyRegen') r += b.value * b.stacks
  return r
}

/** 核心资源槽是否存在（characters.json 的 coreResources）；槽 4、5 与不存在的槽只能由钩子写（§4） */
const coreCap = (sim: Sim, slot: Slot, k: number): number | undefined =>
  sim.r.team[slot].def.coreResources.find(x => x.slot === k)?.cap

/** 改值并返回实际变化量；从不满到上限（能量、协奏）时记进 full，由调用方在合适的时刻写 resourceFull（§6） */
function add(sim: Sim, s: SimState, slot: Slot, res: ResourceKind, amount: number, full: FullEvent[]): number {
  const c = s.chars[slot]
  if (res === 'energy' || res === 'concerto') {
    const cap = res === 'energy' ? sim.r.team[slot].def.energyCost : sim.r.rules.concertoMax
    const before = c[res]
    c[res] = snap9(clamp(before + amount, cap))
    if (before < cap && c[res] >= cap) full.push({ type: 'resourceFull', char: c.name, resource: res })
    return snap9(c[res] - before)
  }
  const k = Number(res.slice(4))
  const before = c.core[k - 1]!
  c.core[k - 1] = snap9(clamp(before + amount, coreCap(sim, slot, k) ?? Infinity))
  return snap9(c.core[k - 1]! - before)
}

const valueOf = (s: SimState, slot: Slot, res: ResourceKind): number => {
  const c = s.chars[slot]
  return res === 'energy' ? c.energy : res === 'concerto' ? c.concerto : c.core[Number(res.slice(4)) - 1]!
}

/** 给某人加减资源（§5）：钩子、资源型效果、施放资源、扣除、共用。只给这一个人，不做全队分配；
 *  定值默认不乘共鸣效率，scaledByRegen 时正数的能量乘接收者的共鸣效率（TD-06 Q3）。记 resource 事件，返回实际变化量 */
export function grant(
  sim: Sim, s: SimState, slot: Slot, res: ResourceKind, amount: number, cause: string, scaledByRegen = false,
): number {
  if (!amount) return 0
  const v = res === 'energy' && scaledByRegen && amount > 0 ? amount * regenOf(sim, s, slot) : amount
  const full: FullEvent[] = []
  const d = add(sim, s, slot, res, v, full)
  if (d !== 0) log(s, { type: 'resource', char: s.chars[slot].name, resource: res, delta: d, value: valueOf(s, slot, res), cause })
  for (const f of full) log(s, f)
  return d
}

/** 数据里的核心资源落到不存在的槽：丢弃，每个角色每个槽只提示一次（§4） */
function coreMissing(sim: Sim, s: SimState, slot: Slot, res: ResourceKind): boolean {
  if (res === 'energy' || res === 'concerto' || coreCap(sim, slot, Number(res.slice(4))) !== undefined) return false
  const name = s.chars[slot].name
  const key = `core|${name}|${res}`
  if (!sim.warned.has(key)) {
    sim.warned.add(key)
    log(s, { type: 'warning', code: 'coreSlot', message: `${name} 的动作数据给了 ${res}，但角色没有这个核心资源槽，已丢弃（TD-06 §4）` })
  }
  return true
}

// ---------------------------------------------------------------------------
// §2.3 大招门槛与扣除

/** TD-09 的 canAfford：能量不够就等（原因代码 resource） */
export function canAfford(s: SimState, slot: Slot, def: ActionDef): true | string {
  const cost = def.energyCost ?? 0
  const e = s.chars[slot].energy
  return cost > 0 && e < cost ? `大招能量 ${Math.floor(e * 10) / 10} / ${cost}` : true
}

/** 开始动作时扣大招能量（在 actionStart 的触发之前）。动作的施放资源里已经有负的能量（数据自带的扣除）时不另扣 */
export function payCost(sim: Sim, s: SimState, slot: Slot, def: ActionDef): void {
  const cost = def.energyCost ?? 0
  if (cost <= 0 || def.castGains.some(g => g.resource === 'energy' && g.amount < 0)) return
  grant(sim, s, slot, 'energy', -cost, 'cost')
}

// ---------------------------------------------------------------------------
// §3.2、§7 施放资源

/** 动作开始（或延奏动作的独立时间线开始）时给施放者：castGains 里 atFrame = 0 的项，加上 onCast 模式下
 *  时间线上未被跳过的判定的协奏（× 寿命内结算次数）。正数的能量乘施放者的共鸣效率。每种资源记一条 resource（cast） */
export function castResources(sim: Sim, s: SimState, slot: Slot, src: EventSource): void {
  const sum: Partial<Record<ResourceKind, number>> = {}
  for (const g of src.def.castGains) if (g.atFrame === 0) sum[g.resource] = (sum[g.resource] ?? 0) + g.amount
  if (sim.r.rules.concertoTiming === 'onCast') {
    for (const j of src.def.judgments) {
      if (j.spawnFrame === null || src.skip?.includes(j.name) || !j.gains.concerto) continue
      sum.concerto = (sum.concerto ?? 0) + j.gains.concerto * ticksWithinLife(j)
    }
  }
  for (const res of RESOURCE_KINDS) {
    const v = sum[res]
    if (v && !coreMissing(sim, s, slot, res)) grant(sim, s, slot, res, v, 'cast', true)
  }
}

/** 内核时间线上 atFrame > 0 的施放资源（只可能来自角色模块覆盖，§7） */
export function castGainAt(sim: Sim, s: SimState, slot: Slot, src: EventSource, index: number): void {
  const g = src.def.castGains[index]!
  if (!coreMissing(sim, s, slot, g.resource)) grant(sim, s, slot, g.resource, g.amount, 'cast', true)
}

// ---------------------------------------------------------------------------
// §2.1、§3.2、§4 每次结算

/** 一次结算的资源：能量全队分配、协奏（onHit，或事件生成的判定）、核心资源（合并区每个动作实例只发一次）。
 *  不记 resource 事件：实际增减写进 hit 事件的 gains；达到上限的 resourceFull 返回给调用方，记在 hit 之后 */
export function settleGains(
  sim: Sim, s: SimState, j: JudgmentRuntime, energyScale: number,
): { gains: HitEvent['gains']; full: FullEvent[] } {
  const d = j.def
  const rules = sim.r.rules
  const full: FullEvent[] = []
  const energy: Partial<Record<CharName, number>> = {}
  const put = (x: Slot, v: number) => { if (v !== 0) energy[s.chars[x].name] = v }
  const base = d.gains.energy * energyScale
  if (base > 0) {
    for (const x of SLOTS) {
      const share = x === j.owner ? rules.energyShare.dealer : rules.energyShare.others
      put(x, add(sim, s, x, 'energy', base * share * regenOf(sim, s, x), full))
    }
  } else if (base < 0) put(j.owner, add(sim, s, j.owner, 'energy', base, full))   // 消耗：只作用于出伤者，不乘效率
  const concerto = rules.concertoTiming === 'onHit' || d.spawnFrame === null
    ? add(sim, s, j.owner, 'concerto', d.gains.concerto, full) : 0
  const core = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const res = `core${k + 1}` as ResourceKind
    const v = d.gains.core[k]!
    if (!v || !coreDue(s, j, k) || coreMissing(sim, s, j.owner, res)) continue
    core[k] = add(sim, s, j.owner, res, v, full)
  }
  return { gains: { energy, concerto, core }, full }
}

/** 核心回收合并区（coreOncePerAction）：同一动作实例里槽 k 只在第一次结算时发（TD-01 Q8）。
 *  动作已被后来的动作取代、找不到实例时，按判定自己的第一次结算算 */
function coreDue(s: SimState, j: JudgmentRuntime, k: number): boolean {
  if (!j.def.coreOncePerAction?.[k]) return true
  const c = s.chars[j.owner]
  const a = c.action?.instance === j.actionInstance ? c.action : c.last?.instance === j.actionInstance ? c.last : null
  if (!a) return j.ticksDone === 1
  if (a.coreGranted[k]) return false
  a.coreGranted[k] = true
  return true
}
