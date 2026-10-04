// src/engine/summary.ts —— 从事件日志汇总（总设计 §3.5、第 9 节）。所有数字都由日志派生，不在别处重算。
// DPS 口径：窗口 = 第 0 帧到"最后一条指令对应动作的结束帧"（options.endAt 可覆盖），按战斗时钟计；
// 窗口外仍在结算的伤害单列为溢出伤害，不计入 DPS。资源曲线（TD-06 §6.1）、buff 覆盖率（TD-07 §10.1）、
// 分轮与稳态（options.repeat ≥ 2，TD-09 §3.7）也从日志算。
import type { CharName } from '../data/common'
import type { HitEvent, ResolvedScenario, SimEvent, SimState, Summary, WaitCode } from './types'

const INTENDED: WaitCode[] = ['delay', 'wait', 'at']
/** 事件的战斗帧（t 是战斗秒数） */
export const battleFrameOf = (e: SimEvent): number => Math.round(e.t * 60)

/** 统计窗口的终点（战斗帧）：最后一条指令——出招看它开始的动作何时结束或被取消，切人看切人那一刻，wait 看等完那一刻 */
export function windowEnd(log: readonly SimEvent[], s: SimState, endAt?: number): number {
  if (endAt !== undefined) return endAt
  let end = 0
  let lastAct: Extract<SimEvent, { type: 'actionStart' }> | null = null
  for (const e of log) {
    if (e.type === 'actionStart' && e.cmd) lastAct = e
    else if (e.type === 'switch' && e.cmd) end = Math.max(end, battleFrameOf(e))
    else if (e.type === 'wait' && e.code === 'wait') end = Math.max(end, battleFrameOf(e))
  }
  if (lastAct) {
    const done = log.find(e => (e.type === 'actionEnd' || e.type === 'actionCancel') && e.instance === lastAct!.instance)
    end = Math.max(end, done ? battleFrameOf(done) : s.battleFrames)
  }
  return end
}

export function summarize(log: readonly SimEvent[], r: ResolvedScenario, s: SimState): Summary {
  const windowFrames = windowEnd(log, s, r.options.endAt)
  const hits = log.filter((e): e is HitEvent => e.type === 'hit' && e.dmg !== null)
  let totalDamage = 0
  let overflowDamage = 0
  const byChar: Record<CharName, { damage: number; share: number }> = {}
  for (const m of r.team) byChar[m.def.name] = { damage: 0, share: 0 }
  const byAction = new Map<string, { char: CharName; action: string; damage: number; hits: number; share: number }>()
  for (const h of hits) {
    const v = h.dmg!.expected
    if (battleFrameOf(h) >= windowFrames) { overflowDamage += v; continue }
    totalDamage += v
    byChar[h.char]!.damage += v
    const key = `${h.char}|${h.action}`
    const a = byAction.get(key) ?? { char: h.char, action: h.action, damage: 0, hits: 0, share: 0 }
    a.damage += v
    a.hits += 1
    byAction.set(key, a)
  }
  const share = (x: number) => (totalDamage > 0 ? x / totalDamage : 0)
  for (const c of Object.values(byChar)) c.share = share(c.damage)
  const actions = [...byAction.values()].sort((a, b) => b.damage - a.damage)
  for (const a of actions) a.share = share(a.damage)
  return {
    totalDamage, windowFrames, dps: windowFrames > 0 ? totalDamage / (windowFrames / 60) : 0, overflowDamage,
    ...loops(log, r, hits, windowFrames),
    byChar, byAction: actions,
    resourceTimeline: resourceTimeline(log, r, s), buffUptime: buffUptime(log, 0, windowFrames),
    waits: log.flatMap(e => (e.type === 'wait' && !INTENDED.includes(e.code)
      ? [{ line: e.cmd.line, item: e.cmd.item, loop: e.cmd.loop, code: e.code, frames: e.frames, reason: e.reason }] : [])),
    warnings: [
      ...r.warnings.map(message => ({ code: 'resolve', message })),
      ...log.flatMap(e => (e.type === 'warning' ? [{ code: e.code, message: e.message, ...(e.line !== undefined ? { line: e.line } : {}) }] : [])),
    ],
  }
}

const dpsOf = (damage: number, frames: number): number => (frames > 0 ? damage / (frames / 60) : 0)

/** 分轮与稳态（Summary.perLoop / steady 的注释）。不到 2 轮（没循环、或第 2 轮还没开始就停了）时没有 */
function loops(log: readonly SimEvent[], r: ResolvedScenario, hits: readonly HitEvent[], W: number): Pick<Summary, 'perLoop' | 'steady'> {
  const marks = log.filter(e => e.type === 'loop')
  if (marks.length < 2) return {}
  const starts = marks.map(battleFrameOf)
  const ends = [...starts.slice(1), W]
  // 资源：从初始值按日志重放（同 resourceTimeline），记下每轮开始时与窗口终点的值
  const slotOf = new Map(r.team.map(m => [m.def.name, m.slot]))
  const energy: number[] = [...r.initial.energy]
  const concerto: number[] = [...r.initial.concerto]
  const at: { energy: number[]; concerto: number[] }[] = []
  for (const e of log) {
    if (battleFrameOf(e) >= W) break
    if (e.type === 'loop') at.push({ energy: [...energy], concerto: [...concerto] })
    else if (e.type === 'hit') {
      for (const [name, v] of Object.entries(e.gains.energy)) energy[slotOf.get(name)!]! += v!
      concerto[slotOf.get(e.char)!]! += e.gains.concerto
    } else if (e.type === 'resource' && (e.resource === 'energy' || e.resource === 'concerto')) {
      ;(e.resource === 'energy' ? energy : concerto)[slotOf.get(e.char)!] = e.value
    }
  }
  at.push({ energy: [...energy], concerto: [...concerto] })
  const damage = starts.map(() => 0)
  for (const h of hits) {
    const f = battleFrameOf(h)
    if (f >= W) continue
    let k = 0
    while (k + 1 < starts.length && f >= starts[k + 1]!) k++
    damage[k]! += h.dmg!.expected
  }
  const delta = (k: number, x: 'energy' | 'concerto') =>
    [0, 1, 2].map(i => Math.round((at[k + 1]![x][i]! - at[k]![x][i]!) * 1e6) / 1e6) as [number, number, number]
  const perLoop = starts.map((start, k) => ({
    loop: k + 1, start, frames: ends[k]! - start, damage: damage[k]!, dps: dpsOf(damage[k]!, ends[k]! - start),
    energyDelta: delta(k, 'energy'), concertoDelta: delta(k, 'concerto'),
  }))
  const from = 2, to = Math.max(2, perLoop.length - 1)
  const part = perLoop.slice(from - 1, to)
  const frames = part.reduce((x, p) => x + p.frames, 0), dmg = part.reduce((x, p) => x + p.damage, 0)
  return { perLoop, steady: { from, to, frames, damage: dmg, dps: dpsOf(dmg, frames) } }
}

/** 资源曲线（TD-06 §6.1）：第 0、30、60…帧（rules.sampleInterval 个世界帧一次）与最后一帧结束时三人的能量与协奏。
 *  从初始值出发，按日志里的 hit.gains 与 resource 事件重放 */
function resourceTimeline(log: readonly SimEvent[], r: ResolvedScenario, s: SimState): Summary['resourceTimeline'] {
  const slotOf = new Map(r.team.map(m => [m.def.name, m.slot]))
  const energy: [number, number, number] = [...r.initial.energy]
  const concerto: [number, number, number] = [...r.initial.concerto]
  const out: Summary['resourceTimeline'] = []
  const last = Math.max(0, s.frame - 1)
  const sample = (f: number) => out.push({ f, energy: [...energy], concerto: [...concerto] })
  let next = 0
  for (const e of log) {
    for (; next <= last && e.f > next; next += r.rules.sampleInterval) sample(next)
    if (e.type === 'hit') {
      for (const [name, v] of Object.entries(e.gains.energy)) energy[slotOf.get(name)!] += v!
      concerto[slotOf.get(e.char)!] += e.gains.concerto
    } else if (e.type === 'resource' && (e.resource === 'energy' || e.resource === 'concerto')) {
      ;(e.resource === 'energy' ? energy : concerto)[slotOf.get(e.char)!] = e.value
    }
  }
  for (; next <= last; next += r.rules.sampleInterval) sample(next)
  if (out.at(-1)?.f !== last) sample(last)
  return out
}

/** buff 覆盖率（TD-07 §10.1）：键"buffId→目标"，值 = 窗口 [lo, hi)（战斗帧）内存在的帧数 / 窗口帧数。
 *  到期（timeout）的在 P6 才移除，那一帧整帧算在内。对比时拿稳态窗口算（analysis.ts） */
export function buffUptime(log: readonly SimEvent[], lo: number, hi: number): Record<string, number> {
  const W = hi - lo
  const since = new Map<string, number>()
  const frames = new Map<string, number>()
  const add = (k: string, from: number, to: number) => frames.set(k, (frames.get(k) ?? 0) + Math.max(0, Math.min(to, hi) - Math.max(from, lo)))
  for (const e of log) {
    if (e.type === 'buffApply') {
      const k = `${e.buff}→${e.target}`
      if (!since.has(k)) since.set(k, battleFrameOf(e))
      if (!frames.has(k)) frames.set(k, 0)
    } else if (e.type === 'buffExpire') {
      const k = `${e.buff}→${e.target}`
      const from = since.get(k)
      if (from === undefined) continue
      add(k, from, battleFrameOf(e) + (e.reason === 'timeout' ? 1 : 0))
      since.delete(k)
    }
  }
  for (const [k, from] of since) add(k, from, hi)
  return Object.fromEntries([...frames].filter(([, v]) => v > 0 || lo === 0).map(([k, v]) => [k, W > 0 ? v / W : 0]))
}
