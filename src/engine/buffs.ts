// src/engine/buffs.ts —— buff 实例：施加、叠层与刷新、计时到期、结算时哪些生效（总设计 §6.8、TD-07 §2、§3、§8）
// 触发（什么事件让 buff 施加、被消耗）在 triggers.ts；这里只管实例本身与"落到谁身上"。
import type { Slot } from '../data/common'
import type { BuffDef } from '../data/buff.schema'
import { log } from './kernel'
import type { ActiveBuff } from './formula'
import type { BuffRuntime, Rates, RegisteredBuff, SimState } from './types'

/** 登记表：按"持有者 | buff id"查定义与取值 */
export type BuffBook = Map<string, RegisteredBuff>
export const bookKey = (owner: Slot | 'env', id: string): string => `${owner}|${id}`
export function makeBook(buffs: readonly RegisteredBuff[]): BuffBook {
  return new Map(buffs.map(b => [bookKey(b.owner, b.def.id), b]))
}

/** 作用对象 → 具体单位（TD-07 §3）。onField 常驻 buff 挂在三人身上，结算时再看出伤者是否在前台；
 *  nextIn 只有由延奏触发时才知道给谁（nextIn = 这次变奏的角色），其余时候挂起，见 applyTriggered */
export function targetsOf(def: BuffDef, owner: Slot | 'env', s: SimState, nextIn?: Slot): (Slot | 'enemy')[] {
  const all: Slot[] = [0, 1, 2]
  switch (def.target) {
    case 'self': return owner === 'env' ? all : [owner]
    case 'team': return all
    case 'teamExceptSelf': return all.filter(x => x !== owner)
    case 'onField': return def.trigger === 'always' ? all : [s.onField]
    case 'nextIn': return nextIn !== undefined ? [nextIn] : []
    case 'enemy': return ['enemy']
  }
}

const targetName = (s: SimState, t: Slot | 'enemy'): string => (t === 'enemy' ? 'enemy' : s.chars[t].name)

/** 施加：同一定义对同一目标只有一个实例；再次施加时加层（不超过上限）并按 refresh 刷新持续时间 */
export function applyBuff(s: SimState, reg: RegisteredBuff, target: Slot | 'enemy', stacks = reg.def.stackGain): BuffRuntime {
  const def = reg.def
  const duration = def.duration
  let b = s.buffs.find(x => x.defId === def.id && x.owner === reg.owner && x.target === target)
  if (b) {
    b.stacks = Math.min(def.maxStacks, b.stacks + stacks)
    if (def.refresh === 'refresh') b.remaining = duration
  } else {
    b = { id: s.nextId++, defId: def.id, owner: reg.owner, target, stacks: Math.min(def.maxStacks, stacks), remaining: duration, lastTriggerAt: s.battleFrames }
    s.buffs.push(b)
  }
  log(s, { type: 'buffApply', buff: def.id, target: targetName(s, target), stacks: b.stacks, remaining: b.remaining })
  return b
}

/** 触发或钩子施加（TD-07 §3、§4.5）：按作用对象落到具体单位。nextIn 知道去处（由延奏触发）就直接给，
 *  否则挂起到下一次切入（同一条再次触发时按叠层规则累加层数，持续时间仍从切入那一刻算） */
export function applyTriggered(s: SimState, reg: RegisteredBuff, nextIn?: Slot, stacks = reg.def.stackGain): void {
  if (reg.def.target === 'nextIn' && nextIn === undefined) {
    const p = s.pendingNextIn.find(x => x.owner === reg.owner && x.defId === reg.def.id)
    if (p) p.stacks = Math.min(reg.def.maxStacks, p.stacks + stacks)
    else s.pendingNextIn.push({ owner: reg.owner, defId: reg.def.id, stacks: Math.min(reg.def.maxStacks, stacks) })
    return
  }
  for (const t of targetsOf(reg.def, reg.owner, s, nextIn)) applyBuff(s, reg, t, stacks)
}

/** 切入（TD-05 §2 ②）：挂起的 nextIn buff 施加给切入者 */
export function applyPendingNextIn(s: SimState, book: BuffBook, to: Slot): void {
  const pending = s.pendingNextIn
  s.pendingNextIn = []
  for (const p of pending) {
    const reg = book.get(bookKey(p.owner, p.defId))
    if (reg) applyBuff(s, reg, to, p.stacks)
  }
}

/** 切出（TD-07 §8）：挂在切出者身上、onSwitchOut = clear 的实例移除 */
export function clearOnSwitchOut(s: SimState, book: BuffBook, from: Slot): void {
  for (const b of [...s.buffs]) {
    if (b.target === from && book.get(bookKey(b.owner, b.defId))?.def.onSwitchOut === 'clear') removeBuff(s, b, 'switchOut')
  }
}

export function removeBuff(s: SimState, b: BuffRuntime, reason: 'timeout' | 'switchOut' | 'removed'): void {
  s.buffs = s.buffs.filter(x => x !== b)
  log(s, { type: 'buffExpire', buff: b.defId, target: targetName(s, b.target), reason })
}

/** P6：按战斗速率倒数，到 0 移除（全局时停期间不走，总设计不变量 6） */
export function tickBuffs(s: SimState, rates: Rates): void {
  for (const b of [...s.buffs]) {
    if (b.remaining === 'inf') continue
    b.remaining -= rates.battle
    if (b.remaining <= 0) removeBuff(s, b, 'timeout')
  }
}

/** 对这次结算有效的实例（TD-03 §4 第 3 步）：挂在出伤者身上的、挂在敌人身上的；前台限定的只在出伤者在前台时算。
 *  标记型（没有乘区）也在里面，收集乘区时跳过（formula.accumulate） */
export function activeFor(s: SimState, book: BuffBook, dealer: Slot): ActiveBuff[] {
  const out: ActiveBuff[] = []
  for (const b of s.buffs) {
    if (b.target !== dealer && b.target !== 'enemy') continue
    const reg = book.get(bookKey(b.owner, b.defId))
    if (!reg) continue
    if (reg.def.target === 'onField' && dealer !== s.onField) continue
    out.push({ def: reg.def, value: reg.value, stacks: b.stacks, owner: b.owner })
  }
  return out
}
