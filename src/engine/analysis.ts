// src/engine/analysis.ts —— 配装对比与副词条边际（总设计 §3.5"对比"，M5；TD-10 §3、§4）
// 做法就是把场景改几处、各跑一次 simulate 再做差。比较的口径：有分轮时取稳态（完整的轮），否则取整个统计窗口；
// "差在哪"按这个窗口里各角色、各动作的每秒伤害（加起来就是 DPS）与 buff 覆盖率来拆，面板另列。
// 纯函数：输入 Scenario 与 GameData，不读文件（命令行在 src/cli/compare.ts、marginal.ts）。
import type { Slot, StatKey } from '../data/common'
import type { GameData } from '../data/gamedata'
import type { Scenario } from '../data/scenario.schema'
import { composeStat } from './formula'
import { resolveScenario } from './resolve'
import { simulate } from './simulate'
import { battleFrameOf, buffUptime } from './summary'
import type { ResolvedScenario, SimResult } from './types'

export interface Run { r: ResolvedScenario; res: SimResult }

export function runScenario(sc: Scenario, data: GameData): Run {
  const r = resolveScenario(sc, data)
  return { r, res: simulate(r) }
}

/** 比较口径：[lo, hi) 是战斗帧 */
export interface Basis { label: string; lo: number; hi: number; damage: number; dps: number }

export function basisOf(res: SimResult): Basis {
  const s = res.summary
  if (s.steady && s.perLoop) {
    const lo = s.perLoop[s.steady.from - 1]!.start
    const label = `稳态（第 ${s.steady.from}${s.steady.to > s.steady.from ? `–${s.steady.to}` : ''} 轮）`
    return { label, lo, hi: lo + s.steady.frames, damage: s.steady.damage, dps: s.steady.dps }
  }
  return { label: '整个窗口', lo: 0, hi: s.windowFrames, damage: s.totalDamage, dps: s.dps }
}

/** 窗口内各角色、各动作（"角色 动作"）的每秒伤害；同一个窗口里加起来就是 basis.dps */
export function dpsBreakdown(res: SimResult, b: Basis): { byChar: Map<string, number>; byAction: Map<string, number> } {
  const secs = (b.hi - b.lo) / 60
  const byChar = new Map<string, number>()
  const byAction = new Map<string, number>()
  if (secs <= 0) return { byChar, byAction }
  for (const e of res.log) {
    if (e.type !== 'hit' || e.dmg === null) continue
    const f = battleFrameOf(e)
    if (f < b.lo || f >= b.hi) continue
    const v = e.dmg.expected / secs
    byChar.set(e.char, (byChar.get(e.char) ?? 0) + v)
    const k = `${e.char} ${e.action}`
    byAction.set(k, (byAction.get(k) ?? 0) + v)
  }
  return { byChar, byAction }
}

/** 静态面板里常看的几项（共鸣效率含常驻的共鸣效率 buff，同 pnpm sim 的显示） */
export interface PanelView { name: string; atk: number; critRate: number; critDamage: number; energyRegen: number }

export function panelsOf(r: ResolvedScenario): PanelView[] {
  return r.team.map(m => ({
    name: m.def.name,
    atk: composeStat(m.panel.atk, 0, 0),
    critRate: m.panel.critRate,
    critDamage: m.panel.critDamage,
    energyRegen: m.panel.energyRegen + r.buffs
      .filter(b => b.owner === m.slot && b.def.trigger === 'always' && b.def.zone === 'energyRegen').reduce((x, b) => x + b.value, 0),
  }))
}

export interface Diff { key: string; base: number; other: number; delta: number }
export interface Comparison {
  base: Basis
  other: Basis
  delta: number                             // 对比 − 基准（DPS）
  pct: number
  byChar: Diff[]                            // 每秒伤害，按 |差| 从大到小
  byAction: Diff[]
  uptime: Diff[]                            // buff 覆盖率（"buff→目标"），按 |差| 从大到小
  panels: { base: PanelView[]; other: PanelView[] }
}

function diffs(a: Map<string, number>, b: Map<string, number>): Diff[] {
  const keys = new Set([...a.keys(), ...b.keys()])
  return [...keys].map(key => {
    const base = a.get(key) ?? 0
    const other = b.get(key) ?? 0
    return { key, base, other, delta: other - base }
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
}

export function compareRuns(a: Run, b: Run): Comparison {
  const ba = basisOf(a.res)
  const bb = basisOf(b.res)
  const da = dpsBreakdown(a.res, ba)
  const db = dpsBreakdown(b.res, bb)
  // 标记型 buff（计时、状态）不列：只看进伤害的
  const markers = new Set([...a.r.buffs, ...b.r.buffs].filter(x => x.def.zone === undefined).map(x => x.def.id))
  const uptime = (run: Run, x: Basis) =>
    new Map(Object.entries(buffUptime(run.res.log, x.lo, x.hi)).filter(([k]) => !markers.has(k.slice(0, k.lastIndexOf('→')))))
  const ua = uptime(a, ba)
  const ub = uptime(b, bb)
  return {
    base: ba, other: bb, delta: bb.dps - ba.dps, pct: ba.dps > 0 ? (bb.dps - ba.dps) / ba.dps : 0,
    byChar: diffs(da.byChar, db.byChar), byAction: diffs(da.byAction, db.byAction), uptime: diffs(ua, ub),
    panels: { base: panelsOf(a.r), other: panelsOf(b.r) },
  }
}

export type Tier = 'avg' | 'max' | 'min'
export interface MarginalRow { stat: StatKey; value: number; dps: number; delta: number; pct: number }

/** 一档的数值：各档平均（比例取到 0.0001，固定值取整）/ 最高 / 最低 */
export function tierValue(values: readonly number[], tier: Tier): number {
  if (tier === 'max') return Math.max(...values)
  if (tier === 'min') return Math.min(...values)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return mean >= 3 ? Math.round(mean) : Math.round(mean * 1e4) / 1e4
}

/** 副词条边际：给第 slot 位角色各加一档副词条（加在他最后一件声骸的副词条上），各重跑一次，比稳态（或整个窗口）的 DPS。
 *  轴是固定的：共鸣效率只在原来要等能量时才有收益 */
export function marginal(sc: Scenario, data: GameData, slot: Slot, tier: Tier = 'avg'): { base: Basis; rows: MarginalRow[] } {
  const tiers = data.echoStats?.subTiers
  if (!tiers) throw new Error('没有副词条各档（echo-stats.json），先 pnpm build:data')
  const who = sc.team[slot]!
  if (who.echoes.length === 0) throw new Error(`${who.char} 没装声骸：副词条要加在声骸上`)
  const base = basisOf(runScenario(sc, data).res)
  const rows: MarginalRow[] = []
  for (const [stat, values] of Object.entries(tiers) as [StatKey, number[]][]) {
    const value = tierValue(values, tier)
    const variant = structuredClone(sc)
    const last = variant.team[slot]!.echoes.at(-1)!
    last.subs = { ...last.subs, [stat]: (last.subs[stat] ?? 0) + value }
    const b = basisOf(runScenario(variant, data).res)
    rows.push({ stat, value, dps: b.dps, delta: b.dps - base.dps, pct: base.dps > 0 ? (b.dps - base.dps) / base.dps : 0 })
  }
  rows.sort((x, y) => y.delta - x.delta)
  return { base, rows }
}
