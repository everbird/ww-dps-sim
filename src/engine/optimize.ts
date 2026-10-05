// src/engine/optimize.ts —— 声骸库存择优（TD-13）：给一个角色从库存里挑 5 件，队友配装与轴不动。
// 做法（TD-13 §3–§5）：先完整跑一次、记下这个角色每次直接伤害结算的输入（HitRecord），换声骸时只按新面板重算这些结算
// （"快速重算"，每套几毫秒以内）；按边际收益预筛、枚举、逐件替换找出估计最好的几套，再各自完整仿真确认。
// 快速重算假定时间轴不变：共鸣效率改变出大招的时机、套装 / 首位声骸改变 buff 时，估计会偏，所以最终排名只看完整仿真。
import { STAT_KEYS, STAT_TO_ZONE, type Slot, type StatKey, type ZoneId } from '../data/common'
import type { GameData } from '../data/gamedata'
import type { InvPiece } from '../data/inventory.schema'
import type { Scenario } from '../data/scenario.schema'
import { basisOf, tierValue, type Basis } from './analysis'
import type { HitRecord } from './context'
import { accumulate, computeHit, matchesFilter, type HitContext } from './formula'
import { resolveScenario } from './resolve'
import { simulate } from './simulate'
import { battleFrameOf } from './summary'
import type { ResolvedScenario, SimResult, StaticPanel, ZoneAccumulator } from './types'

export type Totals = Partial<Record<StatKey, number>>
type PieceStats = { main: Totals; subs: Totals }

/** 几件声骸的词条合计（主词条含固定副主属性） */
export function totalsOf(pieces: readonly PieceStats[]): Totals {
  const t: Totals = {}
  for (const p of pieces) for (const src of [p.main, p.subs]) for (const [k, v] of Object.entries(src)) t[k as StatKey] = (t[k as StatKey] ?? 0) + v!
  return t
}

const PANEL_FIELD: Partial<Record<ZoneId, (p: StaticPanel, v: number) => void>> = {
  hpPct: (p, v) => { p.hp.pct += v }, hpFlat: (p, v) => { p.hp.flat += v },
  atkPct: (p, v) => { p.atk.pct += v }, atkFlat: (p, v) => { p.atk.flat += v },
  defPct: (p, v) => { p.def.pct += v }, defFlat: (p, v) => { p.def.flat += v },
  critRate: (p, v) => { p.critRate += v }, critDamage: (p, v) => { p.critDamage += v },
  energyRegen: (p, v) => { p.energyRegen += v }, healBonus: (p, v) => { p.healBonus += v },
}
/** 带过滤条件的属性（元素伤害、技能类型伤害）：resolve 把它们登记成常驻 buff "<角色>.声骸.<属性>"（statAdder） */
const FILTERED = STAT_KEYS.filter(k => !PANEL_FIELD[STAT_TO_ZONE[k].zone])

function applyPanel(p: StaticPanel, t: Totals, sign: 1 | -1): void {
  for (const [k, v] of Object.entries(t)) PANEL_FIELD[STAT_TO_ZONE[k as StatKey].zone]?.(p, sign * v!)
}

// ---------------------------------------------------------------------------
// §3 快速重算

export interface Replayer {
  basis: Basis
  totals0: Totals                          // 记录时这个角色身上的词条合计
  hits: number                             // 窗口里重算的结算数
  dps(t: Totals): number                   // 换成词条合计 t 时的估计 DPS（同 basis 的口径）
}

/** 由一次完整仿真的记录建：窗口（稳态或整个窗口）里这个角色的直接伤害结算按新面板重算，其余伤害不变 */
export function buildReplayer(r: ResolvedScenario, res: SimResult, recs: readonly HitRecord[], slot: Slot): Replayer {
  const basis = basisOf(res)
  const secs = (basis.hi - basis.lo) / 60
  const m = r.team[slot]!
  const prefix = `${m.def.name}.声骸.`
  const totals0 = totalsOf(m.echoes)
  const bare = structuredClone(m.panel)
  applyPanel(bare, totals0, -1)
  const items: { ctx: Omit<HitContext, 'panel'>; acc: ZoneAccumulator; keys: StatKey[] }[] = []
  let replayed = 0
  for (const rec of recs) {
    if (rec.slot !== slot) continue
    const e = res.log[rec.index]
    if (e?.type !== 'hit' || !e.dmg) continue
    const f = battleFrameOf(e)
    if (f < basis.lo || f >= basis.hi) continue
    const acc = accumulate(rec.view, rec.active.filter(b => !b.def.id.startsWith(prefix)), rec.draft)
    const keys = FILTERED.filter(k => {
      const z = STAT_TO_ZONE[k]
      return matchesFilter({ ...(z.elements ? { elements: z.elements } : {}), ...(z.tags ? { tags: z.tags } : {}) }, rec.view)
    })
    items.push({ ctx: rec.ctx, acc, keys })
    replayed += e.dmg.expected
  }
  const others = basis.damage - replayed
  return {
    basis, totals0, hits: items.length,
    dps(t) {
      if (secs <= 0) return 0
      const panel = structuredClone(bare)
      applyPanel(panel, t, 1)
      let sum = 0
      for (const it of items) {
        let zones = it.acc.zones
        if (it.keys.length) {
          zones = { ...zones }
          for (const k of it.keys) zones[STAT_TO_ZONE[k].zone] += t[k] ?? 0
        }
        sum += computeHit({ ...it.ctx, panel }, { zones, critOnly: it.acc.critOnly }, r.rules).expected
      }
      return (others + sum) / secs
    },
  }
}

/** 完整跑一次，顺带记下结算输入 */
export function runRecorded(sc: Scenario, data: GameData): { r: ResolvedScenario; res: SimResult; recs: HitRecord[] } {
  const r = resolveScenario(sc, data)
  const recs: HitRecord[] = []
  const res = simulate(r, { onHit: x => recs.push(x) })
  return { r, res, recs }
}

// ---------------------------------------------------------------------------
// §4 搜索

export interface OptimizeOptions {
  slot: Slot
  top?: number                              // 列出几套（缺省 5）
  keep?: number                             // 预筛时每个（cost、套装）留几件（缺省 8）
  set?: string                              // 指定 5 件套；缺省沿用现在的套装件数（≥ 2 件的）
  includeTeam?: boolean                     // 也从队友身上拿（缺省不拿 owner 是队友的）
}

export interface Build {
  pieces: InvPiece[]
  est: number                               // 快速重算的估计
  dps: number | null                        // 完整仿真（null：没验证或运行出错）
  error?: string
}

export interface OptimizeResult {
  char: string
  current: { dps: number; label: string }
  plan: Record<string, number>              // 套装件数要求
  main: string                              // 首位声骸（不变）
  pool: number                              // 可用的件数
  evaluated: number                         // 快速重算了多少套
  verified: number                          // 完整仿真了多少套
  builds: Build[]                           // 按完整仿真的 DPS 从高到低
  notes: string[]
}

const baseName = (n: string) => (n.startsWith('异相·') ? n.slice(3) : n)
const keyOf = (b: readonly InvPiece[]) => [b[0]!.id, ...b.slice(1).map(p => p.id).sort()].join('|')

/** 场景换上这几件（第一件是首位） */
export function withEchoes(sc: Scenario, slot: Slot, b: readonly InvPiece[]): Scenario {
  const x = structuredClone(sc)
  x.team[slot]!.echoes = b.map(p => ({ name: p.name, set: p.set, main: { ...p.main }, subs: { ...p.subs } }))
  return x
}

/** 一个角色的择优；sc 是已校验的场景，pieces 是补全后的库存 */
export function optimize(sc: Scenario, data: GameData, pieces: readonly InvPiece[], o: OptimizeOptions): OptimizeResult {
  const top = o.top ?? 5
  const keep = o.keep ?? 8
  const member = sc.team[o.slot]!
  const char = member.char
  const notes: string[] = []
  if (member.echoes.length === 0) throw new Error(`${char} 现在没有声骸：先在场景里配一套（首位声骸决定轴里的 Q）`)
  const main = member.echoes[0]!.name
  const plan: Record<string, number> = {}
  if (o.set) plan[o.set] = 5
  else for (const e of member.echoes) plan[e.set] = (plan[e.set] ?? 0) + 1
  for (const [k, v] of Object.entries(plan)) if (v < 2) delete plan[k]
  const team = new Set(sc.team.map(m => m.char))
  const pool = pieces.filter(p => o.includeTeam || !p.owner || p.owner === char || !team.has(p.owner))
  const mains = pool.filter(p => baseName(p.name) === baseName(main))
  if (mains.length === 0) throw new Error(`库存里没有可用的首位声骸"${main}"（首位声骸不变，轴里的 Q 是它的技能）`)

  const valid = (b: readonly InvPiece[]): boolean => {
    if (b.reduce((a, p) => a + p.cost, 0) > 12) return false
    if (new Set(b.map(p => p.id)).size !== b.length) return false
    const n: Record<string, number> = {}
    for (const p of b) n[p.set] = (n[p.set] ?? 0) + 1
    return Object.entries(plan).every(([s, k]) => (n[s] ?? 0) >= k)
  }
  const scOf = (b: readonly InvPiece[]) => withEchoes(sc, o.slot, b)

  const run0 = runRecorded(sc, data)
  const base = basisOf(run0.res)
  let evaluated = 0
  const found = new Map<string, Build>()

  const search = (rep: Replayer) => {
    const est = (b: readonly InvPiece[]) => { evaluated++; return rep.dps(totalsOf(b)) }
    // 预筛：在记录时的词条附近，各属性加一档的收益 → 每件的线性分；每个（cost、套装）留前 keep 件
    const t0 = rep.totals0
    const d0 = rep.dps(t0)
    const grad: Totals = {}
    for (const k of STAT_KEYS) {
      const tiers = data.echoStats?.subTiers[k]
      const step = tiers ? tierValue(tiers, 'avg') : 0.01
      grad[k] = (rep.dps({ ...t0, [k]: (t0[k] ?? 0) + step }) - d0) / step
    }
    const score = (p: InvPiece) => Object.entries(totalsOf([p])).reduce((a, [k, v]) => a + (grad[k as StatKey] ?? 0) * v!, 0)
    const buckets = new Map<string, InvPiece[]>()
    for (const p of pool) {
      const k = `${p.cost}|${p.set in plan ? p.set : ''}`
      buckets.set(k, [...(buckets.get(k) ?? []), p])
    }
    const kept = [...buckets.values()].flatMap(l => [...l].sort((a, b) => score(b) - score(a)).slice(0, keep))
    const keptMains = [...mains].sort((a, b) => score(b) - score(a)).slice(0, keep)
    // 枚举：首位 × 其余 4 件的组合（cost ≤ 12、套装件数够）
    const cand: Build[] = []
    const push = (b: InvPiece[]) => { cand.push({ pieces: b, est: est(b), dps: null }) }
    for (const c1 of keptMains) {
      const rest = kept.filter(p => p.id !== c1.id)
      const pick: InvPiece[] = []
      const dfs = (from: number, cost: number) => {
        if (pick.length === 4) { const b = [c1, ...pick]; if (valid(b)) push(b); return }
        for (let i = from; i < rest.length; i++) {
          const p = rest[i]!
          if (cost + p.cost > 12) continue
          pick.push(p); dfs(i + 1, cost + p.cost); pick.pop()
        }
      }
      dfs(0, c1.cost)
    }
    cand.sort((a, b) => b.est - a.est)
    // 逐件替换：从估计最好的几套出发，每个位置换成库存里任意一件（不只预筛留下的），有提升就换，直到不再提升
    const seeds = cand.slice(0, Math.max(top * 2, 6))
    for (const s of seeds) {
      let cur = s.pieces, curEst = s.est
      for (;;) {
        let best: InvPiece[] | null = null, bestEst = curEst
        for (let i = 0; i < 5; i++) {
          for (const p of i === 0 ? mains : pool) {
            if (cur.some(x => x.id === p.id)) continue
            const b = cur.map((x, j) => (j === i ? p : x))
            if (!valid(b)) continue
            const e = est(b)
            if (e > bestEst + 1e-9) { best = b; bestEst = e }
          }
        }
        if (!best) break
        cur = best; curEst = bestEst
      }
      cand.push({ pieces: cur, est: curEst, dps: null })
    }
    for (const c of cand.sort((a, b) => b.est - a.est)) if (!found.has(keyOf(c.pieces))) found.set(keyOf(c.pieces), c)
  }
  const verify = (n: number) => {
    const todo = [...found.values()].filter(b => b.dps === null && b.error === undefined).sort((a, b) => b.est - a.est).slice(0, n)
    for (const b of todo) {
      const run = runRecorded(scOf(b.pieces), data)
      if (run.res.error) { b.error = run.res.error.message; continue }
      b.dps = basisOf(run.res).dps
    }
    return todo.length
  }

  // 第一遍：按现在的配装记录；第二遍：按第一遍完整仿真最好的那套重新记录（套装、共鸣效率改变时间轴时修正估计）
  const rep0 = buildReplayer(run0.r, run0.res, run0.recs, o.slot)
  search(rep0)
  let verified = verify(top * 2)
  const best1 = [...found.values()].filter(b => b.dps !== null).sort((a, b) => b.dps! - a.dps!)[0]
  if (best1) {
    const run1 = runRecorded(scOf(best1.pieces), data)
    search(buildReplayer(run1.r, run1.res, run1.recs, o.slot))
    verified += verify(top * 2)
  }
  const builds = [...found.values()].filter(b => b.dps !== null).sort((a, b) => b.dps! - a.dps!).slice(0, top)
  const off = builds.filter(b => Math.abs(b.est - b.dps!) / b.dps! > 0.005)
  if (off.length) notes.push(`有 ${off.length} 套的估计与完整仿真差超过 0.5%（多半是共鸣效率或套装改变了出招时机）；排名以完整仿真为准`)
  const failed = [...found.values()].filter(b => b.error !== undefined)
  if (failed.length) notes.push(`有 ${failed.length} 套完整仿真报错（如能量不够放不出大招），不列：${failed[0]!.error}`)
  return {
    char, current: { dps: base.dps, label: base.label }, plan, main, pool: pool.length, evaluated, verified, builds, notes,
  }
}
