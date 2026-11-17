// DD-10 §4④：事件读值的纯函数，执行核心无需引用汇总模块。
import type { HitEvent, SimEvent } from './types'
import { round } from './num'

/** 一段命中计入多少伤害：期望模式是期望值；抽样模式按这一段抽到的暴击 / 非暴击（总设计 T4）。汇总、对比都按它算 */
export const hitValue = (h: HitEvent): number => {
  const d = h.dmg
  if (!d) return 0
  return d.isCrit === undefined ? d.expected : d.isCrit ? d.crit : d.nonCrit
}

/** 事件的战斗帧（t 是战斗秒数） */
export const battleFrameOf = (e: SimEvent): number => round(e.t * 60)
