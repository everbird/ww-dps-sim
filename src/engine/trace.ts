// src/engine/trace.ts —— 调试用的三种表（TD-11 §3）：分段（每次上场多久）、逐条（每条指令的开始、到下一条多久、之前在等什么）、
// 资源逐步（某种资源每次怎么变、为什么变）。都从事件日志算，不改仿真；时刻按本轮开始算，世界帧与战斗秒都给
// （视频播放器的时间对世界帧，"X 秒一轮"对战斗秒，TD-11 §1.2）。
import type { CharName, Slot } from '../data/common'
import type { ResolvedScenario, SimEvent } from './types'

/** 第 k 轮：[本轮 loop 事件, 下一轮 loop 事件)；最后一轮到日志里最后一个事件 */
export interface LoopSpan { loop: number; f: number; t: number; endF: number; endT: number }

export function loopSpan(log: readonly SimEvent[], loop: number): LoopSpan | null {
  const i = log.findIndex(e => e.type === 'loop' && e.loop === loop)
  if (i < 0) return null
  const start = log[i]!
  const next = log.find((e, j) => j > i && e.type === 'loop')
  const end = next ?? log.at(-1)!
  return { loop, f: start.f, t: start.t, endF: end.f, endT: end.t }
}

/** 日志里有哪几轮 */
export const loopsOf = (log: readonly SimEvent[]): number[] =>
  log.flatMap(e => (e.type === 'loop' ? [e.loop] : []))

// ---------------------------------------------------------------------------
// 分段

export interface SegmentRow {
  char: CharName; intro: boolean
  f: number; t: number                       // 上场时刻（世界帧、战斗秒，绝对值）
  frames: number; battle: number             // 这一段多长：世界帧、战斗秒
  line: number | null                        // 切人那条指令是第几条（本轮开头不是切人时为 null）
}

/** 切人到下一次切人算一段；本轮开头若不是切人，第一段从本轮开始算，上场的是那时的前台 */
export function traceSegments(log: readonly SimEvent[], r: ResolvedScenario, loop: number): SegmentRow[] {
  const span = loopSpan(log, loop)
  if (!span) return []
  let onField = r.team[r.initial.onField]!.def.name
  const pts: { char: CharName; intro: boolean; f: number; t: number; line: number | null }[] = []
  for (const e of log) {
    if (e.type !== 'switch') continue
    if (e.f < span.f) { onField = e.to; continue }
    if (e.f >= span.endF) break
    pts.push({ char: e.to, intro: e.intro, f: e.f, t: e.t, line: e.cmd?.loop === loop ? e.cmd.line : null })
  }
  if (pts[0]?.f !== span.f) pts.unshift({ char: onField, intro: false, f: span.f, t: span.t, line: null })
  return pts.map((p, i) => {
    const next = pts[i + 1] ?? { f: span.endF, t: span.endT }
    return { ...p, frames: next.f - p.f, battle: next.t - p.t }
  })
}

// ---------------------------------------------------------------------------
// 逐条

export interface CommandRow {
  kind: 'act' | 'switch' | 'skip' | 'interject'
  line: number | null; item: number | null
  label: string
  f: number; t: number                       // 开始（世界帧、战斗秒，绝对值）
  frames: number                             // 到下一条开始的世界帧数（最后一条到本轮结束）
  waits: { reason: string; frames: number }[]   // 这条之前的等待，按原因合计（世界帧，TD-09 §3.3）
}

/** 原因里的数字按"n"合并（"切人冷却还剩 14 帧""还剩 50 帧"算同一种） */
const reasonKey = (code: string, reason: string) => `${code}|${reason.replace(/\d+(\.\d+)?/g, 'n')}`

/** 本轮每条指令：出招（含变奏、接续）、切人、跳过的可选 / 补位，以及插队的谐度破坏 */
export function traceCommands(log: readonly SimEvent[], r: ResolvedScenario, loop: number): CommandRow[] {
  const span = loopSpan(log, loop)
  if (!span) return []
  const kindOf = (char: CharName, action: string) => r.team.find(m => m.def.name === char)?.actions[action]?.kind
  const rows: Omit<CommandRow, 'frames' | 'waits'>[] = []
  // 本轮最后一条（常是切回）可能恰好落在下一轮开始那一帧：属于本轮的指令按 cmd.loop 认，不按帧截
  for (const e of log) {
    if (e.f < span.f || e.f > span.endF) continue
    if (e.type === 'actionStart') {
      if (e.cmd?.loop === loop) rows.push({ kind: 'act', line: e.cmd.line, item: e.cmd.item, label: `${e.char} ${e.action}`, f: e.f, t: e.t })
      else if (!e.cmd && e.f < span.endF && kindOf(e.char, e.action) === 'tuneBreak')
        rows.push({ kind: 'interject', line: null, item: null, label: `（插队）${e.char} ${e.action}`, f: e.f, t: e.t })
    } else if (e.type === 'switch' && e.cmd?.loop === loop) {
      rows.push({ kind: 'switch', line: e.cmd.line, item: e.cmd.item, label: `switch ${e.to}${e.intro ? '（变奏）' : ''}`, f: e.f, t: e.t })
    } else if (e.type === 'skip' && e.cmd.loop === loop) {
      rows.push({ kind: 'skip', line: e.cmd.line, item: e.cmd.item, label: `（跳过）${e.reason}`, f: e.f, t: e.t })
    }
  }
  // 等待记在指令名下；同一条的几行（切人 + 变奏）只挂在第一行
  const waits = new Map<string, Map<string, { reason: string; frames: number }>>()
  for (const e of log) {
    if (e.type !== 'wait' || e.cmd.loop !== loop) continue
    const at = `${e.cmd.line}.${e.cmd.item}`
    const m = waits.get(at) ?? new Map()
    const k = reasonKey(e.code, e.reason)
    const w = m.get(k) ?? { reason: e.reason, frames: 0 }
    w.frames += e.frames
    m.set(k, w)
    waits.set(at, m)
  }
  const used = new Set<string>()
  return rows.map((row, i) => {
    const next = rows[i + 1]?.f ?? span.endF
    const at = `${row.line}.${row.item}`
    const w = row.line !== null && !used.has(at) ? [...(waits.get(at)?.values() ?? [])] : []
    if (row.line !== null) used.add(at)
    return { ...row, frames: next - row.f, waits: w.map(x => ({ reason: x.reason, frames: Math.round(x.frames) })) }
  })
}

// ---------------------------------------------------------------------------
// 资源逐步

export type ResourceSel =
  | { kind: 'energy' | 'concerto'; label: string }
  | { kind: 'core'; slot: Slot; k: number; label: string }

/** "协奏""能量"或某个角色的核心资源名（如"红椿·蕊"）；char 可以缩小到一个角色 */
export function resourceSel(r: ResolvedScenario, name: string): ResourceSel | string {
  if (name === '协奏' || name === 'concerto') return { kind: 'concerto', label: '协奏' }
  if (name === '能量' || name === 'energy') return { kind: 'energy', label: '能量' }
  for (const m of r.team) {
    const c = m.def.coreResources.find(x => x.name === name)
    if (c) return { kind: 'core', slot: m.slot, k: c.slot, label: `${m.def.name}的${c.name}` }
  }
  const names = r.team.flatMap(m => m.def.coreResources.map(c => c.name)).filter(Boolean)
  return `没有资源"${name}"：可选 协奏、能量${names.length ? `、${names.join('、')}` : ''}`
}

export interface LedgerRow {
  f: number; t: number
  label: string                              // 事件：谁的哪个动作命中、或资源事件
  source: string                             // 命中 / 施放（进入即得）/ 扣除 / 角色钩子 / 破盾回能 / 延奏清零 / 效果 <id>
  deltas: Partial<Record<CharName, number>>  // 这次的变化
  values: Partial<Record<CharName, number>>  // 变化之后的值（列出的角色都给）
}

const CAUSE: Record<string, string> = {
  cast: '施放（进入即得）', cost: '扣除', hook: '角色钩子', break: '破盾回能', outro: '延奏清零',
}

/** 从开场按日志重放（同 TD-06 §6.1 的资源曲线：命中的 gains 是实际增减，resource 事件给出变化后的值），列出本轮每次变化 */
export function traceLedger(
  log: readonly SimEvent[], r: ResolvedScenario, loop: number, sel: ResourceSel, only?: CharName,
): LedgerRow[] {
  const span = loopSpan(log, loop)
  if (!span) return []
  const names = r.team.map(m => m.def.name)
  const slotOf = new Map(names.map((n, i) => [n, i]))
  const core = sel.kind === 'core' ? sel : null
  const val: number[] = sel.kind === 'energy' ? [...r.initial.energy] : sel.kind === 'concerto' ? [...r.initial.concerto]
    : names.map((_, i) => r.initial.core[i]![core!.k - 1] ?? 0)
  const shown = core ? [names[core.slot]!] : only ? [only] : names
  const kindName = core ? `core${core.k}` : sel.kind
  const out: LedgerRow[] = []
  const lastStart = new Map<CharName, string>()             // 资源事件是谁引起的：施放 / 扣除看刚开始的动作，钩子看刚结算的那一段
  let lastHit = ''
  for (const e of log) {
    if (e.f >= span.endF) break
    if (e.type === 'actionStart') lastStart.set(e.char, e.action)
    const deltas: Partial<Record<CharName, number>> = {}
    let label = '', source = ''
    if (e.type === 'hit') {
      if (sel.kind === 'energy') for (const [n, v] of Object.entries(e.gains.energy)) { if (v) deltas[n] = v }
      else if (sel.kind === 'concerto') { if (e.gains.concerto) deltas[e.char] = e.gains.concerto }
      else if (core && slotOf.get(e.char) === core.slot && e.gains.core[core.k - 1]) deltas[e.char] = e.gains.core[core.k - 1]!
      label = `${e.char} ${e.action} 命中（${e.judgment}）`
      lastHit = `${e.char} ${e.action} 命中后`
      source = '命中'
      for (const [n, v] of Object.entries(deltas)) val[slotOf.get(n)!]! += v!
    } else if (e.type === 'resource' && e.resource === kindName) {
      if (core && slotOf.get(e.char) !== core.slot) continue
      deltas[e.char] = e.delta
      val[slotOf.get(e.char)!] = e.value
      label = e.cause === 'cast' || e.cause === 'cost' ? `${e.char} ${lastStart.get(e.char) ?? ''} 开始`.replace('  ', ' ')
        : e.cause === 'hook' ? `${lastHit || e.char}`
        : e.cause === 'outro' ? `${e.char} 延奏` : e.char
      source = CAUSE[e.cause] ?? `效果 ${e.cause}`
    } else continue
    if (e.f < span.f || !Object.keys(deltas).some(n => shown.includes(n))) continue
    out.push({ f: e.f, t: e.t, label, source, deltas, values: Object.fromEntries(shown.map(n => [n, val[slotOf.get(n)!]!])) })
  }
  return out
}

// ---------------------------------------------------------------------------
// 对照视频（TD-11 §6 P2）

/** 视频里的时刻："1:02.5"（分:秒）或秒数 → 秒 */
export function videoSeconds(v: string | number): number {
  if (typeof v === 'number') return v
  const i = v.indexOf(':')
  return i < 0 ? Number(v) : Number(v.slice(0, i)) * 60 + Number(v.slice(i + 1))
}

/** 一个时间点：video / sim 都从最早那条起算（秒）；diff = 仿真 − 视频（正数 = 仿真慢）；step = 比上一个时间点多出来的 */
export interface MarkCmp { line: number; video: number; sim: number; diff: number; step: number }

/** marks 的键是第几条，值是视频里这条开始的时刻；仿真取这条第一行的开始（世界秒：视频含大招动画，TD-11 §1.2）。
 *  本轮没有出现的条目列进 missing */
export function compareMarks(cmds: readonly CommandRow[], marks: Record<string, string | number>): { rows: MarkCmp[]; missing: number[] } {
  const first = new Map<number, CommandRow>()
  for (const c of cmds) if (c.line !== null && !first.has(c.line)) first.set(c.line, c)
  const lines = Object.keys(marks).map(Number).sort((a, b) => a - b)
  const present = lines.filter(l => first.has(l))
  const missing = lines.filter(l => !first.has(l))
  if (present.length === 0) return { rows: [], missing }
  const v0 = videoSeconds(marks[present[0]!]!)
  const f0 = first.get(present[0]!)!.f
  let prev = 0
  const rows = present.map(line => {
    const video = videoSeconds(marks[line]!) - v0
    const sim = (first.get(line)!.f - f0) / 60
    const diff = sim - video
    const row = { line, video, sim, diff, step: diff - prev }
    prev = diff
    return row
  })
  return { rows, missing }
}
