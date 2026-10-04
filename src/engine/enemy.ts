// src/engine/enemy.ts —— 敌人量表（TD-06 §13）：偏谐值与失谐、谐度破坏的消耗与真空期、白条与破盾回能、瘫痪
// 每次结算的伤害（TD-03）与资源（§2–§4）之后、hit 事件记下之后调用 hitGauges；瘫痪的结束由 P6 的 enemyTimers 判断。
// 计时一律按战斗帧：全局时停（大招、谐度破坏的演出）时战斗时钟停走，真空期与瘫痪也停（2026-10-04 用户确认，m0-confirm §9.2 测5）。
import type { Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import { activeFor } from './buffs'
import type { Sim } from './context'
import { log, SLOTS } from './kernel'
import { grant } from './resources'
import type { JudgmentRuntime, SimState } from './types'

/** 角色的谐度破坏动作：ID 为"谐度破坏"的，否则第一个谐度破坏类动作（椿另有"盛绽谐度破坏"一版，不用，TD-06 §13.3） */
export function tuneBreakActionOf(actions: Readonly<Record<string, ActionDef>>): ActionDef | undefined {
  const a = actions['谐度破坏']
  return a?.kind === 'tuneBreak' ? a : Object.values(actions).find(x => x.kind === 'tuneBreak')
}

/** 正在放、还没命中的谐度破坏（它的动作或判定还在）：这段时间不再自动插一次 */
export function tuneBreakPending(s: SimState): boolean {
  const by = s.enemy.tuneBreakBy
  if (by === undefined || !s.enemy.disharmony) return false
  return s.chars.some(c => c.action?.instance === by) || s.judgments.some(j => j.actionInstance === by) || s.tails.some(t => t.instance === by)
}

/** 现在能不能放谐度破坏（排轴里手写的、自动插的都按它）：目标失谐、且没有正在放的 */
export function canTuneBreak(sim: Sim, s: SimState): true | string {
  if (sim.r.options.tuneBreak === 'off') return '谐度破坏已关闭（options.tuneBreak: off）'
  if (!s.enemy.disharmony) return '目标没有失谐'
  if (tuneBreakPending(s)) return '正在放谐度破坏'
  return true
}

/** 谐度破坏动作开始时：目标失谐就由它消耗这次失谐（它的各段伤害按对失谐算，TD-03 §6） */
export function onTuneBreakStart(s: SimState, def: ActionDef, instance: number): void {
  if (def.kind === 'tuneBreak' && s.enemy.disharmony) s.enemy.tuneBreakBy = instance
}

/** 偏谐效率 = 面板 + 身上 tunabilityRate 乘区的 buff（结算这一刻） */
function tunabilityRateOf(sim: Sim, s: SimState, slot: Slot): number {
  let r = sim.r.team[slot].panel.tunabilityRate
  for (const b of activeFor(s, sim.book, slot)) if (b.def.zone === 'tunabilityRate') r += b.value * b.stacks
  return r
}

/** 一次结算对敌人量表的影响（§13.1、§13.2）。事件跟在这次的 hit 后面 */
export function hitGauges(sim: Sim, s: SimState, j: JudgmentRuntime): void {
  const e = s.enemy
  const d = j.def
  if (d.target !== 'enemy') return
  const p = e.preset
  // 谐度破坏命中（有倍率的那几段；散华组里的编号行是动画分段，倍率 0，不算）：偏谐值清空、失谐结束，
  // 真空期从此刻起按战斗帧算（游戏内说明"【谐度破坏】命中后…【偏谐值】清空"）
  if (e.disharmony && e.tuneBreakBy === j.actionInstance && d.tags.includes('谐度破坏') && d.multiplier > 0) {
    e.tunability = 0
    e.disharmony = false
    e.tunabilityLockedUntil = s.battleFrames + sim.r.rules.tuneBreakLock
    log(s, { type: 'enemyState', change: 'harmonyBreak', detail: `${s.chars[j.owner].name} ${j.action}` })
  } else if (sim.r.options.tuneBreak !== 'off' && p.tunabilityMax > 0 && d.gauges.tunability > 0
    && !e.disharmony && s.battleFrames >= e.tunabilityLockedUntil) {
    e.tunability = Math.min(p.tunabilityMax, e.tunability + d.gauges.tunability * tunabilityRateOf(sim, s, j.owner))
    if (e.tunability >= p.tunabilityMax - 1e-9) {
      e.tunability = p.tunabilityMax
      e.disharmony = true
      delete e.tuneBreakBy
      log(s, { type: 'enemyState', change: 'disharmony', detail: `${s.chars[j.owner].name} ${j.action}` })
    }
  }
  // 白条：每段削韧值削一次（2026-10-04 用户确认"由削韧值决定"）；打空 → 破盾：全队每人 +3 × 各自共鸣效率，敌人瘫痪
  if (p.whiteBarTough > 0 && !e.broken && d.gauges.toughness > 0) {
    e.whiteBar = Math.max(0, e.whiteBar - d.gauges.toughness)
    if (e.whiteBar <= 1e-9) {
      e.whiteBar = 0
      e.broken = true
      e.paralyzedUntil = s.battleFrames + p.paralysisFrames
      log(s, { type: 'enemyState', change: 'break', detail: `${s.chars[j.owner].name} ${j.action}` })
      for (const slot of SLOTS) grant(sim, s, slot, 'energy', sim.r.rules.breakEnergy, 'break', true)
    }
  }
}

/** P6：瘫痪结束时白条回满（推断，TD-06 Q11） */
export function enemyTimers(s: SimState): void {
  const e = s.enemy
  if (e.broken && s.battleFrames >= e.paralyzedUntil) {
    e.broken = false
    e.whiteBar = e.preset.whiteBarTough
    log(s, { type: 'enemyState', change: 'breakEnd' })
  }
}
