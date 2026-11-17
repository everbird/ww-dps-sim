import { ResolveError } from '../engine'
// src/analysis/analysis.ts —— 配装对比与副词条边际（总设计 §3.5"对比"，M5；TD-10 §3、§4）
// 做法就是把场景改几处、各跑一次 runPrepared 再做差。比较的口径：有分轮时取稳态（完整的轮），否则取整个统计窗口；
// "差在哪"按这个窗口里各角色、各动作的每秒伤害（加起来就是 DPS）与 buff 覆盖率来拆，面板另列。
// 纯函数：输入 Scenario 与 GameData，不读文件（命令行在 src/cli/compare.ts、marginal.ts）。
import type { Slot, StatKey } from '../data/common'
import type { GameData } from '../data/gamedata'
import type { Scenario } from '../data/scenario.schema'
import { composeStat } from '../engine'
import { resolveScenario } from '../engine'
import { prepareRun, runPrepared, type PreparedRun, type RunOverrides } from '../engine'
import { battleFrameOf, buffUptimeDetail, hitValue } from '../engine'
import type { ResolvedScenario, SimResult } from '../engine'
import { round, roundTo } from '../engine'

export interface Run { r: ResolvedScenario; res: SimResult }

export function runScenario(sc: Scenario, data: GameData): Run {
  const p = preparedScenario(sc, data)
  return { r: p.resolved, res: runPrepared(p) }
}

import { basisOf, scopeMismatchOf, usableBasis, type Basis, type BasisResult, type BasisStatus, type ScopeMismatch } from '../engine'
export { basisOf, usableBasis, type Basis, type BasisResult, type BasisStatus, type ScopeMismatch } from '../engine'

/** 窗口内各角色、各动作（"角色 动作"）的伤害与每秒伤害；同一个窗口里加起来就是 basis.dps（DD-03 §6.2） */
export interface DamageBreakdown {
  damageByChar: Map<string, number>
  damageByAction: Map<string, number>
  byChar: Map<string, number>
  byAction: Map<string, number>
  zeroDuration: boolean
  overflow?: number
  rawByChar?: Map<string, number>
  rawByAction?: Map<string, number>
}

export function dpsBreakdown(res: SimResult, b: Basis): DamageBreakdown {
  const secs = (b.hi - b.lo) / 60
  const zeroDuration = !(secs > 0 && Number.isFinite(secs))
  const damageByChar = new Map<string, number>()
  const damageByAction = new Map<string, number>()
  const byChar = new Map<string, number>()
  const byAction = new Map<string, number>()
  const rawByChar = b.lethal ? new Map<string, number>() : undefined
  const rawByAction = b.lethal ? new Map<string, number>() : undefined

  for (let seq = 0; seq < res.log.length; seq++) {
    const e = res.log[seq]!
    if (e.type !== 'hit' || e.dmg === null) continue
    if (b.lethal) {
      if (seq > b.lethal.eventSeq) continue
      const raw = hitValue(e)
      const eff = seq === b.lethal.eventSeq ? Math.max(0, raw - b.lethal.overflow) : raw
      const k = `${e.char} ${e.action}`
      rawByChar!.set(e.char, (rawByChar!.get(e.char) ?? 0) + raw)
      rawByAction!.set(k, (rawByAction!.get(k) ?? 0) + raw)
      damageByChar.set(e.char, (damageByChar.get(e.char) ?? 0) + eff)
      damageByAction.set(k, (damageByAction.get(k) ?? 0) + eff)
      if (!zeroDuration) {
        byChar.set(e.char, (byChar.get(e.char) ?? 0) + eff / secs)
        byAction.set(k, (byAction.get(k) ?? 0) + eff / secs)
      }
    } else {
      if (zeroDuration) continue
      const f = battleFrameOf(e)
      if (f < b.lo || f >= b.hi) continue
      const raw = hitValue(e)
      const k = `${e.char} ${e.action}`
      damageByChar.set(e.char, (damageByChar.get(e.char) ?? 0) + raw)
      damageByAction.set(k, (damageByAction.get(k) ?? 0) + raw)
      byChar.set(e.char, (byChar.get(e.char) ?? 0) + raw / secs)
      byAction.set(k, (byAction.get(k) ?? 0) + raw / secs)
    }
  }
  return {
    damageByChar,
    damageByAction,
    byChar,
    byAction,
    zeroDuration,
    ...(b.lethal ? { overflow: b.lethal.overflow, rawByChar, rawByAction } : {}),
  }
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
export interface LethalOverflowView {
  overflow: number
  rawTotal: number
}

export interface Comparison {
  base: Basis
  other: Basis
  delta: number                             // 对比 − 基准（DPS）
  pct: number
  byChar: Diff[]                            // 每秒伤害，按 |差| 从大到小
  byAction: Diff[]
  uptime: Diff[]                            // buff 覆盖率（"buff→目标"），按 |差| 从大到小
  uptimeBy: Diff[]                          // buff 覆盖率按提供者展开（"buff [提供者]→目标"），DD-03 §5.2
  panels: { base: PanelView[]; other: PanelView[] }
  scopeMismatch?: ScopeMismatch
  baseOverflow?: LethalOverflowView
  otherOverflow?: LethalOverflowView
}

function diffs(a: Map<string, number>, b: Map<string, number>): Diff[] {
  const keys = new Set([...a.keys(), ...b.keys()])
  return [...keys].map(key => {
    const base = a.get(key) ?? 0
    const other = b.get(key) ?? 0
    return { key, base, other, delta: other - base }
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
}

export type CompareResult =
  | { ok: true; value: Comparison }
  | { ok: false; status: BasisStatus; reason: string; side: 'base' | 'other'; base: BasisResult; other: BasisResult }

export function tryCompareRuns(a: Run, b: Run): CompareResult {
  const ua = usableBasis(a.res)
  const ub = usableBasis(b.res)
  if (!ua.ok) return { ok: false, status: ua.status, reason: `基准不可比（${ua.reason}）`, side: 'base', base: ua, other: ub }
  if (!ub.ok) return { ok: false, status: ub.status, reason: `对比不可比（${ub.reason}）`, side: 'other', base: ua, other: ub }
  const ba = ua.basis
  const bb = ub.basis
  const da = dpsBreakdown(a.res, ba)
  const db = dpsBreakdown(b.res, bb)
  // 标记型 buff（计时、状态）不列：只看进伤害的
  const markers = new Set([...a.r.buffs, ...b.r.buffs].filter(x => x.def.zone === undefined).map(x => x.def.id))
  const uptimeOf = (run: Run, x: Basis) => {
    const d = buffUptimeDetail(run.res.log, x.lo, x.hi, run.r.team.map(m => m.def.name))
    const union = new Map(Object.entries(d.union).filter(([k]) => !markers.has(k.slice(0, k.lastIndexOf('→')))))
    const byOwner = new Map<string, number>()
    for (const r of d.rows) {
      if (markers.has(r.buff)) continue
      byOwner.set(`${r.buff} [${r.owner}]→${r.target}`, r.uptime)
    }
    return { union, byOwner }
  }
  const uaMap = uptimeOf(a, ba)
  const ubMap = uptimeOf(b, bb)
  const scopeMismatch = scopeMismatchOf(ba.scope, bb.scope)
  const overflowOf = (d: DamageBreakdown): LethalOverflowView | undefined => {
    if (d.overflow === undefined) return undefined
    let rawTotal = 0
    if (d.rawByChar) for (const v of d.rawByChar.values()) rawTotal += v
    return { overflow: d.overflow, rawTotal }
  }
  const baseOverflow = overflowOf(da)
  const otherOverflow = overflowOf(db)
  return {
    ok: true,
    value: {
      base: ba, other: bb, delta: bb.dps - ba.dps, pct: ba.dps > 0 ? (bb.dps - ba.dps) / ba.dps : 0,
      byChar: diffs(da.byChar, db.byChar), byAction: diffs(da.byAction, db.byAction),
      uptime: diffs(uaMap.union, ubMap.union), uptimeBy: diffs(uaMap.byOwner, ubMap.byOwner),
      panels: { base: panelsOf(a.r), other: panelsOf(b.r) },
      ...(scopeMismatch ? { scopeMismatch } : {}),
      ...(baseOverflow ? { baseOverflow } : {}),
      ...(otherOverflow ? { otherOverflow } : {}),
    },
  }
}

export function compareRuns(a: Run, b: Run): Comparison {
  const c = tryCompareRuns(a, b)
  if (!c.ok) throw new Error(c.reason)
  return c.value
}

export type Tier = 'avg' | 'max' | 'min'
/** error：加了这一条之后仿真跑不通（dps、delta、pct 记 0，排在最后，不参与排名） */
export interface MarginalRow { stat: StatKey; value: number; dps: number; delta: number; pct: number; error?: string }

/** 一档的数值：各档平均（比例取到 0.0001，固定值取整）/ 最高 / 最低 */
export function tierValue(values: readonly number[], tier: Tier): number {
  if (tier === 'max') return Math.max(...values)
  if (tier === 'min') return Math.min(...values)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return mean >= 3 ? round(mean) : roundTo(mean, 1e4)
}

/** 副词条边际：给第 slot 位角色各加一档副词条（加在他最后一件声骸的副词条上），各重跑一次，比稳态（或整个窗口）的 DPS。
 *  轴是固定的：共鸣效率只在原来要等能量时才有收益 */
export function marginal(sc: Scenario, data: GameData, slot: Slot, tier: Tier = 'avg'): { base: Basis; rows: MarginalRow[] } {
  const tiers = data.echoStats?.subTiers
  if (!tiers) throw new Error('没有副词条各档（echo-stats.json），先 pnpm build:data')
  const who = sc.team[slot]!
  if (who.echoes.length === 0) throw new Error(`${who.char} 没装声骸：副词条要加在声骸上`)
  // 跑不通的仿真只有前半段日志，汇总的数不能当结果比（R6，docs/review-2026-10-22.md）：基准跑不通就停，变体跑不通单独标出
  const res0 = runScenario(sc, data).res
  const u0 = usableBasis(res0)
  if (!u0.ok) {
    const tag = res0.error?.code ?? u0.status
    throw new Error(`原场景跑不通（${tag}）：${u0.reason}`)
  }
  const base = u0.basis
  const rows: MarginalRow[] = []
  for (const [stat, values] of Object.entries(tiers) as [StatKey, number[]][]) {
    const value = tierValue(values, tier)
    const variant = structuredClone(sc)
    const last = variant.team[slot]!.echoes.at(-1)!
    last.subs = { ...last.subs, [stat]: (last.subs[stat] ?? 0) + value }
    const res = runScenario(variant, data).res
    const u = usableBasis(res)
    if (!u.ok) { rows.push({ stat, value, dps: 0, delta: 0, pct: 0, error: u.reason }); continue }
    const b = u.basis
    rows.push({ stat, value, dps: b.dps, delta: b.dps - base.dps, pct: base.dps > 0 ? (b.dps - base.dps) / base.dps : 0 })
  }
  rows.sort((x, y) => Number(x.error !== undefined) - Number(y.error !== undefined) || y.delta - x.delta)
  return { base, rows }
}

/** DD-10 §5：分析使用真实源场景归一，不从装配结果逆造场景。 */
export function preparedScenario(sc: Scenario, data: GameData, overrides: RunOverrides = {}): PreparedRun {
  const p = prepareRun(sc, data, overrides)
  if (!p.ok) throw new ResolveError(p.issues.map(i => `${i.code}: ${i.message}`))
  return p.run
}
