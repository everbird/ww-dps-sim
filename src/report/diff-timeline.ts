// src/report/diff-timeline.ts —— 两条轴的时间轴对照（网页对比页，TD-12 原型 2026-10-21）：两份场景按战斗秒对齐，
// 每人的动作条、轴里改过的那几条、每轮开始的时刻，以及累计伤害差（对比 − 基准）随时间怎么拉开。只从事件日志算，不改仿真
import type { CharName } from '../data/common'
import type { Basis } from '../engine/analysis'
import type { SimResult } from '../engine/types'

/** 一个动作：t0–t1 是战斗秒；changed = 来自循环轴里与另一份不同的那几条 */
export interface LaneAction { char: CharName; action: string; t0: number; t1: number; changed: boolean }
export interface Lanes {
  actions: LaneAction[]
  loops: { loop: number; t: number }[]          // 每轮开始（启动轴是第 0 轮）
  end: number                                   // 最后一个事件的战斗秒
  steady: [number, number]                      // 比较口径的窗口（战斗秒）
}
export interface DiffTimeline { base: Lanes; other: Lanes; diff: [number, number][] }   // diff：[战斗秒, 累计伤害差]

/** 循环轴里两份不同的行号（从 1 起）：逐行比；行数不同时，从第一处不同起往后都算改过 */
export function changedLines(a: readonly string[], b: readonly string[]): Set<number> {
  const out = new Set<number>()
  const n = Math.max(a.length, b.length)
  const first = Array.from({ length: n }, (_, i) => i).find(i => a[i]?.trim() !== b[i]?.trim())
  if (first === undefined) return out
  for (let i = 0; i < n; i++) if (a.length !== b.length ? i >= first : a[i]?.trim() !== b[i]?.trim()) out.add(i + 1)
  return out
}

function lanesOf(res: SimResult, basis: Basis, changed: Set<number>): Lanes {
  const open = new Map<number, LaneAction>()
  const actions: LaneAction[] = []
  const loops: Lanes['loops'] = []
  for (const e of res.log) {
    if (e.type === 'actionStart') {
      const a = { char: e.char, action: e.action, t0: e.t, t1: e.t, changed: !!e.cmd && e.cmd.loop >= 1 && changed.has(e.cmd.line) }
      open.set(e.instance, a)
      actions.push(a)
    } else if (e.type === 'actionEnd' || e.type === 'actionCancel') {
      const a = open.get(e.instance)
      if (a) { a.t1 = e.t; open.delete(e.instance) }
    } else if (e.type === 'loop') loops.push({ loop: e.loop, t: e.t })
  }
  const end = res.log.at(-1)?.t ?? 0
  for (const a of open.values()) a.t1 = end
  return { actions, loops, end, steady: [basis.lo / 60, basis.hi / 60] }
}

/** 累计伤害（期望值）在 step 秒的格点上的取值 */
function cumulative(res: SimResult, end: number, step: number): number[] {
  const out: number[] = []
  let sum = 0, k = 0
  const hits = res.log.filter(e => e.type === 'hit' && e.dmg)
  for (let t = 0; t <= end + 1e-9; t += step) {
    while (k < hits.length && hits[k]!.t <= t) { const h = hits[k++]!; if (h.type === 'hit' && h.dmg) sum += h.dmg.isCrit === undefined ? h.dmg.expected : h.dmg.isCrit ? h.dmg.crit : h.dmg.nonCrit }
    out.push(sum)
  }
  return out
}

export function diffTimeline(
  base: { res: SimResult; basis: Basis; rotation: readonly string[] },
  other: { res: SimResult; basis: Basis; rotation: readonly string[] },
  step = 0.5,
): DiffTimeline {
  const changed = changedLines(base.rotation, other.rotation)
  const a = lanesOf(base.res, base.basis, changed), b = lanesOf(other.res, other.basis, changed)
  const end = Math.min(a.end, b.end)
  const ca = cumulative(base.res, end, step), cb = cumulative(other.res, end, step)
  return { base: a, other: b, diff: ca.map((x, i) => [Math.round(i * step * 100) / 100, cb[i]! - x]) }
}
