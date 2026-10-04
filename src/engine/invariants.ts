// src/engine/invariants.ts —— 不变量检查（总设计 §11 第 4 条，开发模式常开）
// 每个 tick 结束、每次结算各查一次；不成立就是引擎的错，报 SimResult.error（code 'invariant'），指出第几帧、哪一项。
import type { Sim } from './context'
import { ScheduleError } from './scheduler'
import type { HitEvent, SimState } from './types'

/** 1e-6 的余量：资源值取整到 1e-9，比较时不因浮点误差误报 */
const EPS = 1e-6
function bad(s: SimState, what: string): ScheduleError {
  return new ScheduleError('invariant', `不变量不成立（第 ${s.frame} 帧）：${what}`, null, s.frame)
}
function ok(v: number, lo: number, hi: number): boolean {
  return Number.isFinite(v) && v >= lo - EPS && v <= hi + EPS
}

/** tick 结束（P6 之后）：资源在 [0, 上限]、计时器不为负、战斗时钟不倒退。lastBattle = 上一次检查时的战斗帧 */
export function checkTick(sim: Sim, s: SimState, lastBattle: number): void {
  if (s.battleFrames < lastBattle) throw bad(s, `战斗时钟倒退：${lastBattle} → ${s.battleFrames}`)
  // 每个 tick 都跑：不建闭包、不用 Object.entries，免得这一步本身成了开销
  for (const c of s.chars) {
    const def = sim.r.team[c.slot].def
    if (!ok(c.energy, 0, def.energyCost)) throw bad(s, `${c.name} 的大招能量 ${c.energy} 不在 [0, ${def.energyCost}]`)
    if (!ok(c.concerto, 0, sim.r.rules.concertoMax)) throw bad(s, `${c.name} 的协奏 ${c.concerto} 不在 [0, ${sim.r.rules.concertoMax}]`)
    for (let i = 0; i < c.core.length; i++) {
      const v = c.core[i]!
      if (v === 0) continue
      let cap = Infinity
      for (const x of def.coreResources) if (x.slot === i + 1) cap = x.cap
      if (!ok(v, 0, cap)) throw bad(s, `${c.name} 的核心资源 ${i + 1} 为 ${v}，不在 [0, ${cap}]`)
    }
    for (const k in c.cooldowns) if (!(c.cooldowns[k]! >= 0)) throw bad(s, `${c.name} 的冷却 ${k} 为 ${c.cooldowns[k]}`)
    for (const k in c.charges) if (!(c.charges[k]!.spent >= 0)) throw bad(s, `${c.name} 的充能 ${k} 用掉 ${c.charges[k]!.spent} 次`)
  }
  if (!(s.switchCd >= 0)) throw bad(s, `切人冷却为 ${s.switchCd}`)
  for (const b of s.buffs) {
    if (b.remaining !== 'inf' && !(b.remaining > 0)) throw bad(s, `buff ${b.defId} 的剩余时间 ${b.remaining} 应已移除`)
    if (!(b.stacks >= 1)) throw bad(s, `buff ${b.defId} 的层数 ${b.stacks}`)
  }
  for (const d of s.dilations) if (!(d.remaining > 0)) throw bad(s, `膨胀窗口剩余 ${d.remaining} 应已移除`)
  const e = s.enemy                                               // 敌人量表（TD-06 §13）
  if (!ok(e.tunability, 0, e.preset.tunabilityMax)) throw bad(s, `偏谐值 ${e.tunability} 不在 [0, ${e.preset.tunabilityMax}]`)
  if (e.disharmony && e.tunability < e.preset.tunabilityMax - EPS) throw bad(s, `失谐时偏谐值 ${e.tunability} 未满`)
  if (!ok(e.whiteBar, 0, e.preset.whiteBarTough)) throw bad(s, `白条 ${e.whiteBar} 不在 [0, ${e.preset.whiteBarTough}]`)
}

/** 每次结算：伤害有限且不为负 */
export function checkHit(s: SimState, dmg: HitEvent['dmg'], char: string, judgment: string): void {
  if (!dmg) return
  if (!(dmg.nonCrit >= 0 && dmg.crit >= 0 && dmg.expected >= 0 && Number.isFinite(dmg.crit) && Number.isFinite(dmg.expected)))
    throw bad(s, `${char} ${judgment} 的伤害 ${JSON.stringify(dmg)}`)
}
