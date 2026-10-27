// src/engine/trace.ts —— 调试用的表（TD-11 §3）：分段（每次上场多久）、逐条（每条指令的开始、到下一条多久、之前在等什么）、
// 资源逐步（某种资源每次怎么变、为什么变），以及对游戏跳字用的面板与逐下伤害（TD-11 §2 的前两层）。都从装配结果与事件日志算，
// 不改仿真；时刻按本轮开始算，世界帧与战斗秒都给（视频播放器的时间对世界帧，"X 秒一轮"对战斗秒，TD-11 §1.2）。
import { FLAT_STATS, STAT_TO_ZONE, type ActionId, type CharName, type DamageTag, type Element, type ResourceKind, type Slot, type StatKey } from '../data/common'
import { composeStat } from './formula'
import type { Scenario } from '../data/scenario.schema'
import type { ResolvedScenario, SimEvent } from './types'
import { round, roundTo } from './num'
import { outroOf } from './switch'

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
    return { ...row, frames: next - row.f, waits: w.map(x => ({ reason: x.reason, frames: round(x.frames) })) }
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
  label: string                              // 事件：谁的哪个动作命中、开始，或效果、钩子跟在哪条后面
  source: string                             // 命中 / 起手即得 / 扣除 / 角色钩子（说明）/ 破盾回能 / 延奏清零 / 效果 <id>
  deltas: Partial<Record<CharName, number>>  // 这次的变化
  values: Partial<Record<CharName, number>>  // 变化之后的值（列出的角色都给）
}

const CAUSE: Record<string, string> = {
  hit: '命中', cast: '起手即得', cost: '扣除', hook: '角色钩子', break: '破盾回能', outro: '延奏清零',
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
  const kind = core ? `core${core.k}` : sel.kind
  const out: LedgerRow[] = []
  for (const g of gainSteps(log, r)) {
    if (g.f >= span.endF) break
    if (g.resource !== kind || (core && !(names[core.slot]! in g.deltas))) continue
    for (const [n, v] of Object.entries(g.deltas)) val[slotOf.get(n)!] = g.value ?? val[slotOf.get(n)!]! + v!
    if (g.f < span.f || !Object.keys(g.deltas).some(n => shown.includes(n))) continue
    const source = g.how === 'effect' ? `效果 ${g.what}` : g.how === 'hook' && g.what ? `角色钩子：${g.what}` : CAUSE[g.how]!
    out.push({ f: g.f, t: g.t, label: g.label, source, deltas: g.deltas, values: Object.fromEntries(shown.map(n => [n, val[slotOf.get(n)!]!])) })
  }
  return out
}

/** 一个人一种资源的逐帧值（视图 D 的检查器取光标那一帧的值）：steps 是 [世界帧, 那一帧结束时的值]，第一项是开局值（帧 0），
 *  只在值变了的帧记；cap 是上限（能量 = 大招耗能，协奏 = concertoMax，核心资源 = 上限），没有时为 null */
export interface ResourceTrack { key: ResourceKind; name: string; cap: number | null; steps: [number, number][] }

/** 每人的能量、协奏与共鸣回路（核心资源，只列这次有变化的槽）逐帧值：从开局值出发按 gainSteps 重放（同 traceLedger），值取两位小数 */
export function resourceTracks(steps: readonly GainStep[], r: ResolvedScenario): { char: CharName; tracks: ResourceTrack[] }[] {
  const slotOf = new Map(r.team.map(m => [m.def.name, m.slot]))
  const all = r.team.map(m => [
    { key: 'energy' as ResourceKind, name: '能量', cap: m.def.energyCost ?? null, v: r.initial.energy[m.slot] },
    { key: 'concerto' as ResourceKind, name: '协奏', cap: r.rules.concertoMax, v: r.initial.concerto[m.slot] },
    ...m.def.coreResources.map(c => ({ key: `core${c.slot}` as ResourceKind, name: c.name, cap: c.cap ?? null, v: r.initial.core[m.slot]![c.slot - 1] ?? 0 })),
  ].map(t => ({ ...t, steps: [[0, roundTo(t.v, 100)]] as [number, number][] })))
  for (const g of steps) {
    for (const [n, d] of Object.entries(g.deltas)) {
      const t = all[slotOf.get(n)!]!.find(x => x.key === g.resource)
      if (!t) continue
      t.v = g.value ?? t.v + d!
      const last = t.steps[t.steps.length - 1]!, v = roundTo(t.v, 100)
      if (last[0] === g.f) last[1] = v                       // 同一帧几次变化，只留最后的值
      else if (v !== last[1]) t.steps.push([g.f, v])
    }
  }
  return r.team.map(m => ({
    char: m.def.name,
    tracks: all[m.slot]!.filter(t => !t.key.startsWith('core') || t.steps.length > 1).map(({ key, name, cap, steps }) => ({ key, name, cap, steps })),
  }))
}

// ---------------------------------------------------------------------------
// 资源出处与伤害归属（TD-11 §6、TD-12 §2.1 视图 D 的检查器）：每次资源变化、每次命中归到引起它的动作上。只读日志，不影响仿真

/** 资源变化归到的动作：动作开始的实例号；延奏动作没有 actionStart，按 outro 事件算（instance 是独立时间线的实例号，没有延奏动作时为 null） */
export interface GainOwner { char: CharName; action: ActionId; instance: number | null; f: number; t: number; outro?: true }

/** 怎么来的：命中（判定的回能、协奏、核心资源）、起手即得（动作开始时给的固定量）、扣除（大招能量）、资源型效果、角色钩子、破盾回能、延奏清零 */
export type GainHow = 'hit' | 'cast' | 'cost' | 'effect' | 'hook' | 'break' | 'outro'

export interface GainStep {
  f: number; t: number
  resource: ResourceKind
  deltas: Partial<Record<CharName, number>>  // 实际变化（满了就不再加）
  value?: number                             // resource 事件：变化之后的值
  how: GainHow
  what: string                               // 判定名（命中）、效果 id（效果）、钩子的说明（钩子，可能为空）
  base?: number                              // 命中：数据里每段给多少（能量是分给全队之前的基础值）
  of?: ActionId                              // 命中：判定所在的动作（xlsx 的组），与归到的动作不同时才写（散华"E-引爆冰棱"归重击居合时是 E）
  note?: string                              // 命中：钩子生成这个判定时附的说明（散华"5 链：冰到时自爆"）
  via?: string                               // 命中：钩子在什么之后生成的（"散华.冰棱 到时""椿 盛绽·A3 命中"）
  label: string                              // 调试表的"事件"列
  owner: GainOwner | null                    // null：不归动作（延奏清零；切人、计时引起的）
}

const CAUSES = new Set(['cast', 'cost', 'hook', 'break', 'outro'])

type HitEvent = Extract<SimEvent, { type: 'hit' }>
type ResourceEvent = Extract<SimEvent, { type: 'resource' }>

/** 按日志顺序推出处（一条事件引出的事件紧跟在它后面，TD-07 §5），"谁引发的算谁"；命中交给 hit，资源变化交给 resource：
 *  - 起因：最近一条动作开始、命中或延奏所归的动作；buff 到时结束时，起因是挂上这个 buff 时的那个动作（散华重击居合挂的"引爆计时"到时 →
 *    重击居合；E 命中时挂的冰棱到时 → E）；切人、loop 之后（下一个起因之前）没有起因；
 *  - 命中：钩子生成的判定（没有发生帧，如散华"E-引爆冰棱""大招-引爆冰川"）归生成那一刻的起因，起因是别人的动作时（维里奈的协同攻击由
 *    队友命中触发）改归它所在动作最近的实例；其余判定归生成那一刻出伤者同名动作最近的实例；都找不到时归出伤者最近开始的动作；
 *  - 施放资源、扣除归本人最近开始的动作（含延奏动作）；效果、钩子、破盾回能归起因；延奏清零不归动作；
 *  - 钩子生成的判定记下引出原因，交给 hit：起因是一次命中时记那次命中（trigger，维里奈的协同攻击由谁的命中触发）；
 *    via 是钩子在什么之后生成的（"散华.冰棱 到时""丁 Q 开始""椿 盛绽·A3 命中"），note 是钩子附的说明（"5 链：冰到时自爆"）。
 *  局限：同一帧有几个 buff 一起到时，它们引出的事件都排在后面，会全算到最后一个到时的 buff 的起因上 */
function walkOwners(log: readonly SimEvent[], r: ResolvedScenario, visit: {
  hit(e: HitEvent, owner: GainOwner | null, trigger: HitTrigger | null, origin: HitOrigin | null): void
  resource(e: ResourceEvent, how: GainHow, owner: GainOwner | null, label: string): void
}): void {
  const members = new Map(r.team.map(m => [m.def.name, m]))
  const last = new Map<CharName, GainOwner>()                 // 每人最近开始的动作
  const latest = new Map<string, GainOwner>()                 // "角色|动作" 最近的实例
  const spawned = new Map<number, GainOwner | null>()         // 判定 id → 生成时归到的动作
  const applied = new Map<string, GainOwner | null>()         // "buff→目标" → 最近一次挂上时的起因
  let anchor: { owner: GainOwner | null; label: string; hit?: HitEvent } = { owner: null, label: '' }   // hit：起因是一次命中时
  const triggers = new Map<number, HitTrigger>()              // 钩子生成的判定 id → 触发它的命中
  const origins = new Map<number, HitOrigin>()                // 钩子生成的判定 id → 引出原因
  const started = (o: GainOwner) => (o.outro ? `${o.char} 延奏` : `${o.char} ${o.action} 开始`)
  for (const e of log) {
    switch (e.type) {
      case 'actionStart': case 'outro': {
        const o: GainOwner = e.type === 'actionStart'
          ? { char: e.char, action: e.action, instance: e.instance, f: e.f, t: e.t }
          : { char: e.char, action: outroOf(members.get(e.char)!)?.id ?? '延奏', instance: e.instance ?? null, f: e.f, t: e.t, outro: true }
        last.set(e.char, o)
        latest.set(`${e.char}|${o.action}`, o)
        anchor = { owner: o, label: started(o) }
        break
      }
      case 'judgmentSpawn': {
        const byHook = members.get(e.char)?.actions[e.action]?.judgments.find(j => j.name === e.judgment)?.spawnFrame === null
        const cause = byHook && anchor.owner?.char === e.char ? anchor.owner : null
        spawned.set(e.id, cause ?? latest.get(`${e.char}|${e.action}`) ?? last.get(e.char) ?? null)
        if (byHook) {
          if (anchor.hit) triggers.set(e.id, { char: anchor.hit.char, action: anchor.hit.action, judgment: anchor.hit.judgment })
          const via = anchor.hit ? `${anchor.hit.char} ${anchor.hit.action} 命中` : anchor.label || null
          if (via || e.note) origins.set(e.id, { via, note: e.note ?? null })
        }
        break
      }
      case 'switch': case 'loop':
        anchor = { owner: null, label: '' }
        break
      case 'buffApply':
        applied.set(`${e.buff}→${e.target}`, anchor.owner)
        break
      case 'buffExpire':
        if (e.reason === 'timeout') anchor = { owner: applied.get(`${e.buff}→${e.target}`) ?? null, label: `${e.buff} 到时` }
        break
      case 'hit': {
        const owner = spawned.get(e.id) ?? latest.get(`${e.char}|${e.action}`) ?? last.get(e.char) ?? null
        anchor = { owner, label: `${e.char} ${e.action} 命中后`, hit: e }
        visit.hit(e, owner, triggers.get(e.id) ?? null, origins.get(e.id) ?? null)
        break
      }
      case 'resource': {
        const how = (CAUSES.has(e.cause) ? e.cause : 'effect') as GainHow
        const own = how === 'cast' || how === 'cost' ? last.get(e.char) ?? null : null
        const owner = how === 'outro' ? null : own ?? (how === 'cast' || how === 'cost' ? null : anchor.owner)
        visit.resource(e, how, owner, how === 'outro' ? `${e.char} 延奏` : own ? started(own) : anchor.label || e.char)
        break
      }
    }
  }
}

/** 资源变化逐步，每步归到引起它的动作（规则见 walkOwners） */
export function gainSteps(log: readonly SimEvent[], r: ResolvedScenario): GainStep[] {
  const members = new Map(r.team.map(m => [m.def.name, m]))
  const out: GainStep[] = []
  walkOwners(log, r, {
    hit(e, owner, _trigger, origin) {
      const of = owner && owner.action !== e.action ? { of: e.action } : {}
      const why = origin ? { ...(origin.note ? { note: origin.note } : {}), ...(origin.via ? { via: origin.via } : {}) } : {}
      const g = members.get(e.char)?.actions[e.action]?.judgments.find(j => j.name === e.judgment)?.gains
      const c = origin ? causeText(origin.note, origin.via) : ''
      const label = `${e.char} ${e.action} 命中（${e.judgment}${c ? `；${c}` : ''}）`
      const step = (resource: ResourceKind, deltas: Partial<Record<CharName, number>>, base: number | undefined) =>
        out.push({ f: e.f, t: e.t, resource, deltas, how: 'hit', what: e.judgment, ...(base !== undefined ? { base } : {}), ...of, ...why, label, owner })
      const energy = Object.entries(e.gains.energy).filter(([, v]) => v)
      if (energy.length) step('energy', Object.fromEntries(energy), g?.energy)
      if (e.gains.concerto) step('concerto', { [e.char]: e.gains.concerto }, g?.concerto)
      e.gains.core.forEach((v, k) => { if (v) step(`core${k + 1}` as ResourceKind, { [e.char]: v }, g?.core[k]) })
    },
    resource(e, how, owner, label) {
      const what = how === 'effect' ? e.cause : how === 'hook' ? e.note ?? '' : ''
      out.push({ f: e.f, t: e.t, resource: e.resource, deltas: { [e.char]: e.delta }, value: e.value, how, what, label, owner })
    },
  })
  return out
}

/** 触发钩子生成这个判定的那次命中：维里奈的协同攻击由谁的命中触发（可能是队友的） */
export interface HitTrigger { char: CharName; action: ActionId; judgment: string }
/** 钩子生成的判定是怎么引出的：via 钩子在什么之后生成（"散华.冰棱 到时""散华.引爆计时 到时""椿 盛绽·A3 命中"），note 钩子附的说明 */
export interface HitOrigin { via: string | null; note: string | null }
/** 一次命中的来由：owner 归到的动作，trigger 由哪次命中触发（只有钩子在命中后生成的判定才有），origin 引出原因（钩子生成的判定才有） */
export interface HitCause { owner: GainOwner | null; trigger: HitTrigger | null; origin: HitOrigin | null }

/** 引出原因写成一句："5 链：冰到时自爆（散华.冰棱 到时）"；只有一半时就写那一半 */
export const causeText = (note: string | null | undefined, via: string | null | undefined): string =>
  note && via ? `${note}（${via}）` : note ?? via ?? ''

/** 每次命中归到的动作与触发者（规则见 walkOwners）：时间轴网页里动作的伤害按 owner 合计，同资源的出处（TD-11 §6.1、TD-12 §2.1）；
 *  汇总的"分动作"、pnpm compare 仍按判定所在的动作（xlsx 的组）。键是日志里的 hit 事件 */
export function hitCauses(log: readonly SimEvent[], r: ResolvedScenario): Map<SimEvent, HitCause> {
  const out = new Map<SimEvent, HitCause>()
  walkOwners(log, r, { hit: (e, owner, trigger, origin) => out.set(e, { owner, trigger, origin }), resource: () => {} })
  return out
}

/** 一个动作给的资源，按出处合计（同一出处：同一种资源、同一种来法、同一个判定 / 效果） */
export interface GainItem {
  resource: ResourceKind; how: GainHow; what: string
  n: number                                  // 几次：命中段数、触发次数
  dt: number                                 // 第一次在动作开始之后多少战斗秒（中间有时停时比世界秒短）
  base?: number                              // 命中：每段的数据值（同 GainStep）
  of?: ActionId                              // 命中：判定所在的动作，与这个动作不同时才写（同 GainStep）
  note?: string                              // 命中：钩子附的说明（同 GainStep；说明不同的分开记）
  via?: string                               // 命中：钩子在什么之后生成的（同 GainStep；几次不一样时不写）
  deltas: Partial<Record<CharName, number>>  // 合计
}
export interface ActionGains extends GainOwner { items: GainItem[] }

/** 每个动作（含延奏动作）给了哪些资源、各从哪来（只列 resources 里的，按这个顺序、再按先后）；时间轴网页的检查器与动作提示用 */
export function actionGains(steps: readonly GainStep[], resources: readonly ResourceKind[] = ['concerto', 'energy']): ActionGains[] {
  const by = new Map<GainOwner, ActionGains>()
  for (const g of steps) {
    if (!g.owner || !resources.includes(g.resource)) continue
    let a = by.get(g.owner)
    if (!a) by.set(g.owner, (a = { ...g.owner, items: [] }))
    let it = a.items.find(x => x.resource === g.resource && x.how === g.how && x.what === g.what && x.note === g.note)
    if (!it) {
      a.items.push((it = {
        resource: g.resource, how: g.how, what: g.what, n: 0, dt: roundTo(g.t - g.owner.t, 100),
        ...(g.base !== undefined ? { base: g.base } : {}), ...(g.of !== undefined ? { of: g.of } : {}),
        ...(g.note !== undefined ? { note: g.note } : {}), ...(g.via !== undefined ? { via: g.via } : {}), deltas: {},
      }))
    } else if (it.via !== g.via) delete it.via                // 几次的引出原因不一样（协同由不同队友触发）：不写
    it.n++
    for (const [n, v] of Object.entries(g.deltas)) it.deltas[n] = (it.deltas[n] ?? 0) + v!
  }
  const rank = (x: GainItem) => resources.indexOf(x.resource)
  return [...by.values()].map(a => ({
    ...a,
    items: a.items.sort((x, y) => rank(x) - rank(y))           // 同一种资源里保持第一次出现的先后（sort 是稳定的）
      .map(x => ({ ...x, deltas: Object.fromEntries(Object.entries(x.deltas).map(([n, v]) => [n, roundTo(v!, 1e4)])) })),
  }))
}

// ---------------------------------------------------------------------------
// 面板与逐下伤害（TD-11 §2：先对面板，再对单招的跳字）

/** 面板的一项。value：生命、攻击、防御是整数，其余是比例；sources：计入的常驻 buff（武器被动、套装、固有技能、首位加成）的出处，
 *  后面括号里是实际计入的数（原文常写 1 阶的数，武器按谐振阶取值） */
export interface PanelRow { char: CharName; item: string; value: number; flat: boolean; sources: string[] }

/** 带过滤条件的加成 → 游戏面板上的叫法（STAT_TO_ZONE 反查："导电伤害加成""普攻伤害加成"…） */
const BONUS_LABEL = new Map<string, StatKey>(
  (Object.entries(STAT_TO_ZONE) as [StatKey, { zone: string; elements?: readonly Element[]; tags?: readonly DamageTag[] }][])
    .filter(([, z]) => z.zone === 'DamageChangeElement' || z.zone === 'DamageChangeType')
    .map(([k, z]) => [`${z.zone}|${(z.elements ?? []).join(',')}|${(z.tags ?? []).join(',')}`, k]),
)
const PANEL_STAT: Readonly<Record<string, string>> = {
  hpPct: '生命', hpFlat: '生命', atkPct: '攻击', atkFlat: '攻击', defPct: '防御', defFlat: '防御',
  critRate: '暴击', critDamage: '暴击伤害', energyRegen: '共鸣效率', healBonus: '治疗效果加成',
}

/** 角色界面上能看到的面板：静态面板（基础 + 武器 + 声骸词条 + 技能树）+ 自己的常驻 buff（trigger always、作用于自己或全队、
 *  不要求在前台）。伤害加成按游戏面板的叫法合并（"导电伤害加成"= 声骸主词条 + 套装 + 武器被动…）；
 *  加深、最终伤害这类不在面板上的不列（逐下伤害的 buff 一栏里有）。char 只看一个角色 */
export function tracePanel(r: ResolvedScenario, char?: CharName): PanelRow[] {
  const rows: PanelRow[] = []
  for (const m of r.team) {
    if (char && m.def.name !== char) continue
    const own = r.buffs.filter(b => b.owner === m.slot && b.def.trigger === 'always' && (b.def.target === 'self' || b.def.target === 'team')
      && !b.def.ownerOnField && !b.def.consume && b.def.zone !== undefined)
    const sum: Record<string, number> = {}
    const src: Record<string, string[]> = {}
    const note = (item: string, source: string) => { (src[item] ??= []).includes(source) || src[item]!.push(source) }
    const bonus = new Map<StatKey, number>()
    for (const b of own) {
      const z = b.def.zone!
      const f = b.def.filter ?? {}
      const plain = Object.keys(f).every(k => k === 'elements' || k === 'tags')
      const counted = `${b.def.source}（计入 ${z.endsWith('Flat') ? b.value : `${roundTo(b.value * 100, 10)}%`}）`
      if (z in PANEL_STAT && Object.keys(f).length === 0) {
        sum[z] = (sum[z] ?? 0) + b.value
        note(PANEL_STAT[z]!, counted)
      } else if (plain) {
        const label = BONUS_LABEL.get(`${z}|${(f.elements ?? []).join(',')}|${(f.tags ?? []).join(',')}`)
        if (!label) continue
        bonus.set(label, (bonus.get(label) ?? 0) + b.value)
        // 声骸、武器副属性、技能树的词条（statAdder 登记的"声骸：导电伤害加成"）在面板里本来就有，不算出处
        if (!/^(声骸|武器|技能树)：/.test(b.def.source)) note(label, counted)
      }
    }
    const p = m.panel
    const v = (z: string) => sum[z] ?? 0
    const add = (item: string, value: number, flat: boolean) => rows.push({ char: m.def.name, item, value, flat, sources: src[item] ?? [] })
    add('生命', composeStat(p.hp, v('hpPct'), v('hpFlat')), true)
    add('攻击', composeStat(p.atk, v('atkPct'), v('atkFlat')), true)
    add('防御', composeStat(p.def, v('defPct'), v('defFlat')), true)
    add('暴击', p.critRate + v('critRate'), false)
    add('暴击伤害', p.critDamage + v('critDamage'), false)
    add('共鸣效率', p.energyRegen + v('energyRegen'), false)
    if (p.healBonus + v('healBonus') > 0) add('治疗效果加成', p.healBonus + v('healBonus'), false)
    // 伤害加成按 STAT_TO_ZONE 的顺序（元素在前、类型在后），全属性另起一行
    for (const k of Object.keys(STAT_TO_ZONE) as StatKey[]) {
      const x = bonus.get(k)
      if (x !== undefined && !FLAT_STATS.includes(k)) add(k, x, false)
    }
  }
  return rows
}

/** 一下伤害：nonCrit / crit 对游戏的跳字（不暴击、暴击各一种数）；buffs 是这一下生效的 buff（"id×层数"） */
export interface HitRow {
  f: number; t: number
  char: CharName; action: ActionId; judgment: string; element: Element; tags: DamageTag[]
  nonCrit: number; crit: number; expected: number
  buffs: string[]
  effect: boolean                             // 异常效应自身的伤害（定时结算、钩子主动触发）
}

/** 第 loop 轮的每一下伤害（非伤害判定不列），按结算先后；char 只看一个角色 */
export function traceHits(log: readonly SimEvent[], loop: number, char?: CharName): HitRow[] {
  const span = loopSpan(log, loop)
  if (!span) return []
  const rows: HitRow[] = []
  for (const e of log) {
    if (e.f < span.f || e.f >= span.endF || e.type !== 'hit' || !e.dmg || (char && e.char !== char)) continue
    rows.push({
      f: e.f, t: e.t, char: e.char, action: e.action, judgment: e.judgment, element: e.element, tags: e.tags,
      nonCrit: e.dmg.nonCrit, crit: e.dmg.crit, expected: e.dmg.expected, buffs: e.buffs, effect: e.effect !== undefined,
    })
  }
  return rows
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

/** 录像血条的一个读数：seg 是这只敌人血条出现的视频秒、left0 是那时的读数、hp 是这只的生命（仿真从 seg 起累计伤害 / hp 对照） */
export interface HpPoint { t: number; left: number; seg: number; left0: number; hp: number; enemy: string }

/** video.hp 逐条：末尾写了敌人预设的一条起是另一只（没写的接着上一只，第一只是场景的敌人） */
export function hpPoints(video: NonNullable<Scenario['video']>, r: ResolvedScenario): HpPoint[] {
  let cur = { seg: 0, left0: 1, hp: r.enemy.hp, enemy: r.enemy.id }
  return (video.hp ?? []).map((line, i) => {
    const [t, left, preset] = line.trim().split(/\s+/) as [string, string, string | undefined]
    const p: Pick<HpPoint, 't' | 'left'> = { t: videoSeconds(t), left: Number(left) }
    if (i === 0 || preset) {
      const e = preset ? r.data.enemies[preset] : r.enemy
      if (!e) throw new Error(`video.hp 第 ${i + 1} 条：敌人预设"${preset}"不存在`)
      cur = { seg: p.t, left0: p.left, hp: e.hp, enemy: e.id }
    }
    return { ...p, ...cur }
  })
}
