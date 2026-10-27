// src/engine/insight.ts —— 结论（TD-10 §6，总设计 §0.1 第 7 条）：同一个场景改一处、多跑几次，推出几条能直接用的结论：
//   ① 共鸣效率需求：这条轴的大招不等能量，每人最低要多少共鸣效率（二分）；
//   ② 操作容错：每条指令都晚 N 帧执行时 DPS 掉多少（options.inputDelay，确定性的，不用抽样）；
//   ③ 假设敏感度：假设表里能自动翻的开关逐个翻一下，DPS 差多少（总设计 T16）；
//   ④ 指令被挡住的时间：窗口里队首指令在等什么（冷却、资源、等出手…），合计多久、占多少（前一招可能还在打，不等于空闲）；
//   ⑥ 卡帧点：循环轴的每个决策点（切人、不是连段后续的出招）单独每轮晚 N 帧，DPS 掉多少——哪几处靠"一合法就按"撑着。
// 全部按期望值算；比较口径同对比（basisOf：有分轮取稳态，否则整个窗口）。纯函数，输入装配结果。
import type { Slot } from '../data/common'
import { basisOf, panelsOf, type Basis } from './analysis'
import { ASSUMPTIONS, type AdjustPath } from './assumptions'
import { INTENDED } from './scheduler'
import { simulate } from './simulate'
import { battleFrameOf } from './summary'
import type { CommandRef, ResolvedScenario, SimEvent, SimResult, WaitCode } from './types'

export interface EnergyNeed {
  char: string
  current: number                           // 现在的共鸣效率（面板 + 常驻 buff，同 pnpm sim 的显示）
  need: number | null                       // 这条轴的大招不等能量最低要多少；null = 加到 current + 2 仍要等（轴里大招放得太早）
  floor: number                             // 能压到的最低：面板 100% + 常驻 buff。need 等于它 = 不堆共鸣效率也不等能量
  waitSecs: number                          // 现在窗口里等能量的秒数
}
export interface ToleranceRow { delay: number; dps: number | null; change: number | null; loopSecs: number | null; error: string | null }
export interface SensitivityRow { id: string; what: string; change: string; dps: number | null; delta: number | null; pct: number | null; error: string | null }
export interface WaitCost { code: WaitCode; label: string; secs: number; share: number; top: { where: string; secs: number; reason: string }[] }
export interface Insight {
  basis: Basis
  energy: EnergyNeed[]
  tolerance: ToleranceRow[]
  sensitivity: SensitivityRow[]
  /** 能翻、但这次仿真没碰到的假设（tracked 的要碰到才有影响）：不跑，翻了也一样 */
  notHit: string[]
  waits: WaitCost[]
  /** ⑥ 卡帧点：每个决策点单独晚 tightFrames 帧，按损失从大到小 */
  tight: TightPoint[]
  tightFrames: number
  runs: number                              // 一共跑了几次仿真
}
/** 卡帧点的一行。晚 N 帧的影响拆成两样：每轮多了几帧（extraFrames）、每轮的伤害变了多少（dmgPct）。
 *  kind：slack = 有余量（每轮没变长、伤害没少，晚一点无所谓）；time = 只是一轮跟着变长（多几帧掉几帧的 DPS）；
 *  cascade = 连锁（一轮多出的比晚的还多：冷却错位、多补位；或者每轮伤害少了：buff 没罩住）——这才是真要卡帧的地方；
 *  better = 晚一点反而更好（DPS 涨 ≥ 0.1%）：原轴这里按早了，值得改轴 */
export interface TightPoint {
  line: number; item: number; what: string
  dps: number | null; pct: number | null; loopSecs: number | null
  extraFrames: number | null; dmgPct: number | null; kind: 'slack' | 'time' | 'cascade' | 'better' | null
  error: string | null
}
export const DEFAULT_TIGHT = 6

/** 正常出招节奏里的等待（派生窗口、优先级、连段、同一 tick）：不算"卡住"（同 web/designs/shared.js 的 RHYTHM） */
const RHYTHM: readonly WaitCode[] = ['derive', 'priority', 'combo', 'started']
const WAIT_LABEL: Partial<Record<WaitCode, string>> = {
  cooldown: '等冷却', resource: '等资源（大招能量、核心资源）', hook: '等角色条件（形态、层数）', settled: '等前一招出手',
  switchCd: '等切人冷却', switchLock: '切人锁', globalStop: '大招动画（全局时停）', airborne: '等切出者跳起', inputLock: '输入锁',
}
export const DEFAULT_DELAYS = [0, 3, 6, 10, 15] as const

export function insight(r: ResolvedScenario, opts: { delays?: readonly number[]; tight?: number } = {}): Insight {
  let runs = 0
  const run = (x: ResolvedScenario): SimResult => { runs++; return simulate(x) }
  const base = run(r)
  if (base.error) throw new Error(`场景运行报错，先把轴修好再看结论：${base.error.message}`)
  const basis = basisOf(base)

  // ① 共鸣效率需求：只看轴里放大招的人；改的是静态面板（常驻 buff 那部分不变）
  const panels = panelsOf(r)
  const energy: EnergyNeed[] = []
  for (const m of r.team) {
    if (!castsUlt(r, m.slot)) continue
    const offset = panels[m.slot]!.energyRegen - m.panel.energyRegen
    const current = panels[m.slot]!.energyRegen
    const ok = (total: number): boolean => {
      const res = run(withEnergyRegen(r, m.slot, total - offset))
      return !res.error && energyWaitFrames(res, r, m.slot, basisOf(res)) === 0
    }
    const floor = 1 + offset                                         // 面板共鸣效率不低于基础的 100%
    const need = ok(current)
      ? (ok(floor) ? floor : search(floor, current, ok))
      : (ok(current + 2) ? search(current, current + 2, ok) : null)
    energy.push({ char: m.def.name, current, need, floor, waitSecs: energyWaitFrames(base, r, m.slot, basis) / 60 })
  }

  // ② 操作容错
  const tolerance: ToleranceRow[] = (opts.delays ?? DEFAULT_DELAYS).map(delay => {
    const res = delay === r.options.inputDelay ? base : run({ ...r, options: { ...r.options, inputDelay: delay } })
    if (res.error) return { delay, dps: null, change: null, loopSecs: null, error: res.error.message }
    const b = basisOf(res)
    const st = res.summary.steady
    return {
      delay, dps: b.dps, change: basis.dps > 0 ? b.dps / basis.dps - 1 : null,
      loopSecs: st ? st.frames / 60 / (st.to - st.from + 1) : b.hi / 60 - b.lo / 60, error: null,
    }
  })

  // ③ 假设敏感度：tracked 的只翻这次碰到过的（没碰到的翻了也一样，列进 notHit）
  const sensitivity: SensitivityRow[] = []
  const notHit: string[] = []
  const hit = new Set(base.summary.assumptions.map(x => x.id))
  for (const a of ASSUMPTIONS) {
    const adj = 'adjust' in a ? a.adjust : undefined
    if (!adj || !('path' in adj) || !adj.path) continue
    if (a.tracked && !hit.has(a.id)) { notHit.push(a.id); continue }
    for (const v of adj.values ?? []) {
      const res = run(adjusted(r, adj.path, v))
      const change = `${adj.path} = ${String(v)}`
      if (res.error) { sensitivity.push({ id: a.id, what: a.what, change, dps: null, delta: null, pct: null, error: res.error.message }); continue }
      const dps = basisOf(res).dps
      sensitivity.push({ id: a.id, what: a.what, change, dps, delta: dps - basis.dps, pct: basis.dps > 0 ? dps / basis.dps - 1 : null, error: null })
    }
  }

  // ⑥ 卡帧点：只让一个决策点每轮晚 N 帧（options.inputDelayAt），其余照常。连段后续玩家会预输入，不算决策点（同 ②）
  const tightFrames = opts.tight ?? DEFAULT_TIGHT
  const tight: TightPoint[] = []
  // 稳态每轮的战斗帧（没有分轮时为 null）
  const loopFrames = (res: SimResult): number | null => {
    const st = res.summary.steady
    return st ? st.frames / (st.to - st.from + 1) : null
  }
  const baseLoop = loopFrames(base)
  const name = (slot: Slot) => r.team[slot]!.def.name
  for (const c of tightFrames > 0 ? r.commands : []) {                // tight: 0 = 不跑这一节
    if (c.kind === 'wait' || c.kind === 'at' || c.kind === 'enemy' || c.kind === 'fill') continue
    if (c.kind === 'act' && r.team[c.slot]!.actions[c.action]?.comboFrom?.length) continue
    const what = c.kind === 'switch' ? `switch ${name(c.to)}${c.expectIntro ? ' 变奏' : ''}` : `${name(c.slot)} ${c.action}${c.filler ? '~' : ''}`
    const res = run({ ...r, options: { ...r.options, inputDelayAt: { [`${c.line}.${c.item}`]: tightFrames } } })
    if (res.error) {
      tight.push({ line: c.line, item: c.item, what, dps: null, pct: null, loopSecs: null, extraFrames: null, dmgPct: null, kind: null, error: res.error.message })
      continue
    }
    const b = basisOf(res)
    const loopF = loopFrames(res)
    const extraFrames = loopF !== null && baseLoop !== null ? loopF - baseLoop : null
    // 每轮伤害 = DPS × 每轮时长
    const dmgPct = loopF !== null && baseLoop !== null && basis.dps > 0 ? (b.dps * loopF) / (basis.dps * baseLoop) - 1 : null
    const pct = basis.dps > 0 ? b.dps / basis.dps - 1 : null
    const kind = extraFrames === null || dmgPct === null ? null
      : pct !== null && pct >= 0.001 ? 'better'
      : extraFrames > tightFrames + 1 || dmgPct < -0.002 ? 'cascade'
        : extraFrames <= 0.5 && dmgPct > -0.001 ? 'slack' : 'time'
    tight.push({
      line: c.line, item: c.item, what, dps: b.dps, pct,
      loopSecs: loopF !== null ? loopF / 60 : null, extraFrames, dmgPct, kind, error: null,
    })
  }
  tight.sort((a, b) => (a.pct ?? -Infinity) - (b.pct ?? -Infinity))

  return { basis, energy, tolerance, sensitivity, notHit, waits: waitCosts(base, r, basis), tight, tightFrames, runs }
}

/** 在 (lo, hi] 里找最小的满足 ok 的值（ok(hi) 为真）；按单调假设二分，精确到 0.25% */
function search(lo: number, hi: number, ok: (x: number) => boolean): number {
  while (hi - lo > 0.0025) {
    const mid = (lo + hi) / 2
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return hi
}

const castsUlt = (r: ResolvedScenario, slot: Slot): boolean =>
  [...r.opening, ...r.commands].some(c => c.kind === 'act' && c.slot === slot && (r.team[slot].actions[c.action]?.energyCost ?? 0) > 0)

const withEnergyRegen = (r: ResolvedScenario, slot: Slot, panelValue: number): ResolvedScenario => ({
  ...r,
  team: r.team.map(m => (m.slot === slot ? { ...m, panel: { ...m.panel, energyRegen: panelValue } } : m)) as ResolvedScenario['team'],
})

/** 假设表里的开关（AdjustPath）：rules.<键> 或 options.<键> */
export function adjusted(r: ResolvedScenario, path: AdjustPath, v: number | boolean | string): ResolvedScenario {
  const [where, key] = path.split('.') as ['rules' | 'options', string]
  return where === 'rules' ? { ...r, rules: { ...r.rules, [key]: v } } : { ...r, options: { ...r.options, [key]: v } }
}

const commandOf = (r: ResolvedScenario, c: CommandRef) => (c.loop === 0 ? r.opening : r.commands).find(x => x.line === c.line && x.item === c.item)

/** 等待段与窗口 [lo, hi) 重叠的战斗帧数（wait 事件记在等待结束时，battleFrames 是它的长度） */
function overlap(e: Extract<SimEvent, { type: 'wait' }>, b: Basis): number {
  const end = battleFrameOf(e)
  const start = end - e.battleFrames
  return Math.max(0, Math.min(end, b.hi) - Math.max(start, b.lo))
}

/** 窗口里第 slot 位角色因大招能量不够等了多少战斗帧 */
function energyWaitFrames(res: SimResult, r: ResolvedScenario, slot: Slot, b: Basis): number {
  let n = 0
  for (const e of res.log) {
    if (e.type !== 'wait' || e.code !== 'resource' || !e.reason.startsWith('大招能量')) continue
    const c = commandOf(r, e.cmd)
    if (c?.kind === 'act' && c.slot === slot) n += overlap(e, b)
  }
  return n
}

/** ④ 窗口里"卡住"的等待按原因合计（写轴要求的、操作延迟、正常出招节奏不算） */
function waitCosts(res: SimResult, r: ResolvedScenario, b: Basis): WaitCost[] {
  const by = new Map<WaitCode, WaitCost>()
  const secs = (b.hi - b.lo) / 60
  for (const e of res.log) {
    if (e.type !== 'wait' || INTENDED.includes(e.code) || RHYTHM.includes(e.code)) continue
    const f = overlap(e, b)
    if (f <= 0) continue
    const w = by.get(e.code) ?? { code: e.code, label: WAIT_LABEL[e.code] ?? e.code, secs: 0, share: 0, top: [] }
    w.secs += f / 60
    const c = commandOf(r, e.cmd)
    const who = c?.kind === 'act' ? `${r.team[c.slot].def.name} ${c.action}` : c?.kind === 'switch' ? `切到 ${r.team[c.to].def.name}` : ''
    w.top.push({ where: `${e.cmd.loop === 0 ? '启动' : `第 ${e.cmd.loop} 轮`}第 ${e.cmd.line} 条 ${who}`.trim(), secs: f / 60, reason: e.reason })
    by.set(e.code, w)
  }
  const out = [...by.values()].sort((x, y) => y.secs - x.secs)
  for (const w of out) {
    w.share = secs > 0 ? w.secs / secs : 0
    w.top = w.top.sort((x, y) => y.secs - x.secs).slice(0, 3)
  }
  return out
}
