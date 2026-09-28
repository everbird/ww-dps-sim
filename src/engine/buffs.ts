// src/engine/buffs.ts —— buff 实例：施加、叠层与刷新、计时到期、结算时哪些生效（总设计 §6.8）
// M2 只有常驻 buff 真正在用；施加 / 到期的规则按总设计 §6.8 写好，触发监听（TD-07）在 M3 接上。
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

/** 作用对象 → 具体单位。onField 常驻 buff 挂在三人身上，结算时再看出伤者是否在前台；nextIn 只能由触发产生（M3） */
export function targetsOf(def: BuffDef, owner: Slot | 'env', s: SimState): (Slot | 'enemy')[] {
  const all: Slot[] = [0, 1, 2]
  switch (def.target) {
    case 'self': return owner === 'env' ? all : [owner]
    case 'team': return all
    case 'teamExceptSelf': return all.filter(x => x !== owner)
    case 'onField': return def.trigger === 'always' ? all : [s.onField]
    case 'nextIn': return []
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

/** 对这次结算有效的实例（TD-03 §4 第 3 步）：挂在出伤者身上的、挂在敌人身上的；前台限定的只在出伤者在前台时算 */
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
