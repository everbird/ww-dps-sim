// src/analysis/sensitivity.ts —— 假设敏感度矩阵（docs/engine-quality-plan.md P2）：每个场景在假设表里每个开关（AdjustPath）翻过来后各跑一遍，
// 再看对照场景（文件名 = 基准名 + "-差异"，见 AGENTS.md"约定"）比基准好多少，在哪条假设下会翻。
// 用来给进游戏验证的项排先后：让结论翻得越多的假设越先测（docs/verify-guide.md）
import { sameDamageScope, scopeShortLabel, usableBasis } from '../engine'
import type { DamageScope, RunStatus } from '../engine'
import { ASSUMPTIONS, type AdjustPath } from '../engine'
import { PROPOSITIONS, type Proposition, type CandidateChange } from '../engine'
import { adjustment } from './insight'
import { preparedScenario } from './analysis'
import type { Scenario } from '../data/scenario.schema'
import type { GameData } from '../data/gamedata'
import { runPrepared, type RunOverrides } from '../engine'
import type { ResolvedScenario } from '../engine'

export interface Flip { id: string; path: AdjustPath; value: number | boolean | string; label: string; changes: CandidateChange }
/** 一格：DPS（比较口径同轴搜索：有分轮取稳态，否则整个窗口），跑不通时 error 是报错代码 */
export interface Cell {
  dps: number | null
  error: string | null
  status: RunStatus
  scope?: DamageScope
  scopeLabel?: string
  scopeChanged?: { from: DamageScope; to: DamageScope }
}
export interface Row { name: string; base: Cell; flips: Cell[] }
/** 对照场景比基准：缺省假设下、每个开关翻过来后各好多少（比例；null = 有一边跑不通） */
export interface PairRow { name: string; base: string; gain: number | null; flips: (number | null)[] }
export interface Matrix { flips: Flip[]; rows: Row[]; pairs: PairRow[] }

/** 假设表里能在场景里翻的开关 */
export function flipsOf(): Flip[] {
  return ASSUMPTIONS.flatMap(a => {
    const adj = 'adjust' in a ? a.adjust : undefined
    if (!adj || !('path' in adj) || !adj.path) return []
    return (adj.values ?? []).map(v => {
      // DD-04 §6：共享 forte 开关仍同时翻两人；它的类别和两条角色命题相同。
      const candidates = (PROPOSITIONS as readonly Proposition[]).filter(p => p.assumptionId === a.id).flatMap(p => p.candidates)
      const changes = candidates.find(c => `${c.binding.kind === 'rule' ? 'rules' : 'options'}.${c.binding.path}` === adj.path && c.binding.value === v)?.changes
        ?? (adj.path === 'rules.forteKeepOnSwitch' ? 'mechanism' : undefined)
      if (!changes) throw new Error(`台账缺少 ${adj.path} = ${v}`)
      return { id: a.id, path: adj.path!, value: v, changes, label: `${a.id}：${adj.path} = ${String(v)}` }
    })
  })
}

function cell(sc: Scenario, data: GameData, overrides: RunOverrides = {}, baseScope?: DamageScope): Cell {
  try {
    const res = runPrepared(preparedScenario(sc, data, overrides))
    const u = usableBasis(res)
    const scopeChanged = baseScope && !sameDamageScope(baseScope, res.damageScope)
      ? { from: baseScope, to: res.damageScope }
      : undefined
    const scopeLabel = scopeShortLabel(res.damageScope)
    return u.ok
      ? { dps: u.basis.dps, error: null, status: res.completion.status, scope: res.damageScope, scopeLabel, ...(scopeChanged ? { scopeChanged } : {}) }
      : { dps: null, error: `${u.status}：${u.reason}`, status: u.status, scope: res.damageScope, scopeLabel, ...(scopeChanged ? { scopeChanged } : {}) }
  } catch (e) {
    return { dps: null, error: `engineError：${e instanceof Error ? e.message : String(e)}`, status: 'engineError' }
  }
}

/** 名字（不带 .yaml）→ 它的基准：最长的、名字是它的前缀加"-"的另一个场景 */
export function baseOf(name: string, names: readonly string[]): string | null {
  let best: string | null = null
  for (const n of names) if (n !== name && name.startsWith(`${n}-`) && (!best || n.length > best.length)) best = n
  return best
}

export function sensitivityMatrix(scenarios: readonly { name: string; sc: Scenario }[], data: GameData, onRow?: (row: Row) => void): Matrix {
  const flips = flipsOf()
  const rows = scenarios.map(({ name, sc }) => {
    const base = cell(sc, data)
    const row: Row = { name, base, flips: flips.map(f => cell(sc, data, adjustment(f.path, f.value), base.scope)) }
    onRow?.(row)
    return row
  })
  const by = new Map(rows.map(x => [x.name, x]))
  const ratio = (a: Cell, b: Cell) => (a.dps !== null && b.dps !== null && b.dps > 0 ? a.dps / b.dps - 1 : null)
  const pairs: PairRow[] = []
  for (const row of rows) {
    const b = baseOf(row.name, rows.map(x => x.name))
    if (!b) continue
    const base = by.get(b)!
    pairs.push({ name: row.name, base: b, gain: ratio(row.base, base.base), flips: flips.map((_, i) => ratio(row.flips[i]!, base.flips[i]!)) })
  }
  return { flips, rows, pairs }
}
