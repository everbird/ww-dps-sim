// src/engine/enemy.ts —— 敌人量表（TD-06 §13）：偏谐值与失谐、谐度破坏的消耗与真空期、白条与破盾回能、瘫痪
// 每次结算的伤害（TD-03）与资源（§2–§4）之后、hit 事件记下之后调用 hitGauges；瘫痪的结束由 P6 的 enemyTimers 判断。
// 计时一律按战斗帧：全局时停（大招、谐度破坏的演出）时战斗时钟停走，谐破冷却、按钮与瘫痪也停（2026-10-04 用户确认，m0-confirm §9.2 测5）。
// 谐破冷却（按敌人 COST）与按钮时长取 xlsx 附页2 的偏谐通用规则（m0-confirm §10 H2、H4）。
import type { Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import { activeFor } from './buffs'
import type { Sim } from './context'
import { log, SLOTS } from './kernel'
import { grant } from './resources'
import type { JudgmentRuntime, SimState } from './types'

/** 角色的谐度破坏动作，ID 为"谐度破坏"的排第一。椿另有盛绽版（组名"谐度破坏-时停"，结束帧与派生窗口不同）：
 *  哪个能放由角色钩子 canStart 按形态判断，自动插的时候挑钩子允许的那个（m0-confirm §10 H5） */
export function tuneBreakActionsOf(actions: Readonly<Record<string, ActionDef>>): ActionDef[] {
  const all = Object.values(actions).filter(x => x.kind === 'tuneBreak')
  return [...all.filter(x => x.id === '谐度破坏'), ...all.filter(x => x.id !== '谐度破坏')]
}

/** 正在放、还没命中的谐度破坏（它的动作或判定还在）：这段时间不再自动插一次 */
export function tuneBreakPending(s: SimState): boolean {
  const by = s.enemy.tuneBreakBy
  if (by === undefined || !s.enemy.disharmony) return false
  return s.chars.some(c => c.action?.instance === by) || s.judgments.some(j => j.actionInstance === by) || s.tails.some(t => t.instance === by)
}

/** 现在能不能放谐度破坏（排轴里手写的、自动插的都按它）：目标失谐、按钮亮着、且没有正在放的 */
export function canTuneBreak(sim: Sim, s: SimState): true | string {
  if (sim.r.options.tuneBreak === 'off') return '谐度破坏已关闭（options.tuneBreak: off）'
  if (!s.enemy.disharmony) return '目标没有失谐'
  if (tuneBreakPending(s)) return '正在放谐度破坏'
  const button = sim.r.tuneBreakTiming.buttonFrames
  if (button !== null && s.battleFrames >= s.enemy.tuneButtonUntil)
    return `谐度破坏按钮没亮：要由前台角色对失谐目标打出偏谐值不为 0 的伤害，之后亮 ${button / 60} 秒`
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
    e.tunabilityLockedUntil = s.battleFrames + sim.r.tuneBreakTiming.lockFrames    // 谐破冷却按敌人 COST（附页2）
    e.tuneButtonUntil = 0
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
  // 谐度破坏按钮（附页2："当前角色…造成偏谐值不为0的伤害后，可触发谐度破坏技交互，交互按键持续3秒"）：
  // 前台角色对失谐目标打出偏谐值不为 0 的一段就亮（让目标失谐的那一段也算），后台的命中不算；按战斗帧计
  const button = sim.r.tuneBreakTiming.buttonFrames
  if (button !== null && e.disharmony && d.gauges.tunability > 0 && j.owner === s.onField) e.tuneButtonUntil = s.battleFrames + button
  // 白条：每段削韧值削一次（2026-10-04 用户确认"由削韧值决定"），另有按白条上限比例削的（dmg Damage.Percent0：谐度破坏各段
  // 合计 12.5%，m0-confirm §10 H3）；打空 → 破盾：全队每人 +3 × 各自共鸣效率，敌人瘫痪
  const cut = d.gauges.toughness + (d.gauges.whiteBarRatio ?? 0) * p.whiteBarTough
  if (p.whiteBarTough > 0 && !e.broken && cut > 0) {
    e.whiteBar = Math.max(0, e.whiteBar - cut)
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
