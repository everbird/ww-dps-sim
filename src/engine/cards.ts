// src/engine/cards.ts —— 套路卡（TD-10 §6.2 ②、⑥ 第 1 步）：把同一角色的一行轴当一个"套路"，用仿真量出它在几种上下文里的
//   时长、资源、伤害、给的 buff、异常效应——入场方式（接着打 / 普通切入 / 变奏切入）× 有没有铺垫（同一角色的上一个套路，给前置状态）
//   × 出口（切走 / 接自己的下一招）。另外量原场景里每轮的这一段，看队里与单独量的对不对得上（§6.2 ③）。
//   只用现有仿真，不改引擎；纯函数，输入场景与数据。量出来的是"这一行在这几种上下文里的样子"，不是规则：
//   对不上的、切走得太早的（数据可能漏了切人锁，§6.2 ⑦）标出来给人看。
import type { CharName } from '../data/common'
import type { GameData } from '../data/gamedata'
import { parseRotationLine, type Scenario } from '../data/scenario.schema'
import { resolveScenario } from './resolve'
import { simulate } from './simulate'
import { gainSteps, hitCauses } from './trace'
import type { ResolvedScenario, SimEvent, WaitCode } from './types'

export type Entry = 'field' | 'switch' | 'intro'
export type Exit = 'switch' | 'self'
export const ENTRY_LABEL: Record<Entry, string> = { field: '接着打', switch: '普通切入', intro: '变奏切入' }
export const EXIT_LABEL: Record<Exit, string> = { switch: '切走', self: '接自己' }

/** 一段的量。时长按战斗秒：这段第一条指令（切人或出招）开始 → 下一条指令开始，就是"占前台多久"；
 *  资源与伤害按"归到的动作"（trace.ts 的 walkOwners）算，切走后在后台打完的也算这段的 */
export interface CardMeasure {
  secs: number                              // 已扣掉下一条指令自己的外部等待（exitWait）
  waits: Partial<Record<WaitCode, number>>  // 这段指令的等待（战斗秒），按原因合计
  actions: number                           // 出手几个动作（含变奏、接续动作）
  skipped: number                           // 跳过几个补位 / 可选
  intro: boolean | null                     // 切入时变奏了没有；没有切人为 null
  concerto: number                          // 自己的协奏，实际到账（满了就不再加）
  energy: number                            // 自己的大招能量，实际到账
  energyTeam: number                        // 分给队友的大招能量
  full: ('concerto' | 'energy')[]           // 这段里满了的（满了之后的到账会少算，名义值要更多）
  damage: number                            // 期望伤害
  hits: number
  buffs: { id: string; target: string; secs: number }[]   // 这段里施加的、有时限的、自己登记的 buff（target：自己的名字 / 队友 / 'enemy'）
  effects: { added: number; burst: number } // 这段里自己附加的异常效应层数、电磁爆发层数
  exitWait: number                          // 下一条指令在等冷却、资源、角色条件、切人冷却的时间（秒）：不属于这段，已从 secs 扣掉
  exit: { action: string; frame: number } | null   // 出口是切走时，切走那一刻这段最后一个动作与它打到第几帧（世界帧差，不扣膨胀）
}

/** 单独量的一种上下文 */
export interface CardRow {
  entry: Entry; exit: Exit; setup: boolean; m: CardMeasure | null; error: string | null
  energyGiven: boolean                      // 开局给了大招能量（这段、铺垫或出口要用）：这一行的"自己的能量"会因为满了少算
}
/** 原场景里的这一段：第几轮（0 = 启动轴），入场方式按实际（切入变奏了算 intro） */
export interface TeamRow { loop: number; entry: Entry; m: CardMeasure; match: number | null }   // match：同入场方式的单独量里，时长最接近的差（秒）

export interface Card {
  char: CharName
  line: string                              // 轴里的写法
  setup: string | null                      // 铺垫：参考轴里同一角色的上一个套路
  next: string | null                       // 出口"接自己"用的：参考轴里同一角色的下一个套路的第一个动作
  rows: CardRow[]
  team: TeamRow[]
  flags: CardFlag[]
}
export type CardFlag =
  | 'switchAtStart'                         // 切走时大招才打了不到 10 帧：数据可能漏了切人锁（§6.2 ⑦）；共鸣技能、普攻放完马上切是常见打法，不算
  | 'needsSetup'                            // 单独量（没有铺垫）跑不通：要前置状态
  | 'teamMismatch'                          // 队里的某一轮与同入场方式的单独量时长差 ≥ 0.1 秒（多半是在等冷却、切人冷却）

const SWITCH_AT_START = 10
/** 下一条指令的这几种等待不算这段占的时间（等的是别的东西）；派生、优先级、连段、出手、切人锁这些是这段动作本身的节奏，照算。
 *  切人冷却：这段自己是切入的，切人冷却就是这次切入带来的，算这段的；这段没有切入（接着打）时才是别人留下的 */
const EXTERNAL: readonly WaitCode[] = ['cooldown', 'resource', 'hook', 'input', 'wait', 'at']
const MISMATCH = 0.1

const clean = (line: string) => line.trim().replace(/\s+/g, ' ')

/** 一行是不是同一角色的出招（套路）；是就返回角色名与各动作的写法 */
function routineOf(line: string): { char: CharName; items: string[] } | null {
  const p = parseRotationLine(line)
  if ('error' in p || p.length === 0) return null
  const acts = p.filter(it => it.kind === 'act')
  if (acts.length !== p.length) return null
  return { char: acts[0]!.char, items: acts.map(it => it.action) }
}
const switchTo = (line: string) => clean(line).match(/^switch\s+(\S+)/)?.[1] ?? null

/** 参考轴里的套路：启动轴 + 循环轴按行拆，写法一样的算一个；铺垫取同一角色的上一个套路、出口取下一个套路的第一个动作（循环轴首尾相接） */
export type Routine = Pick<Card, 'char' | 'line' | 'setup' | 'next'>
export function routinesOf(sc: Pick<Scenario, 'opening' | 'rotation'>): Routine[] {
  const seq = [...sc.opening, ...sc.rotation].map(l => ({ text: clean(l), r: routineOf(l) }))
  const loopStart = sc.opening.length
  const out = new Map<string, Routine>()
  const sameChar = (i: number, dir: 1 | -1): string | null => {
    const c = seq[i]!.r!.char
    const n = seq.length
    for (let k = 1; k < n; k++) {
      let j = i + dir * k
      if (dir > 0 && j >= n) j = loopStart + ((j - loopStart) % (n - loopStart))   // 循环轴首尾相接
      if (j < 0 || j >= n) break
      if (seq[j]!.r?.char === c) return seq[j]!.text
    }
    return null
  }
  seq.forEach((x, i) => {
    if (!x.r || out.has(x.text)) return
    const next = sameChar(i, 1)
    out.set(x.text, { char: x.r.char, line: x.text, setup: sameChar(i, -1), next: next ? `${x.r.char} ${routineOf(next)!.items[0]}` : null })
  })
  return [...out.values()]
}

/** 一段在日志里的量：lines 是这段的指令行号（切人那条可选 + 本行），loop 是第几轮 */
export function measureSegment(log: readonly SimEvent[], r: ResolvedScenario, char: CharName, loop: number, lines: readonly number[]): CardMeasure | null {
  const last = Math.max(...lines)
  const inSeg = (e: SimEvent) => 'cmd' in e && e.cmd !== undefined && e.cmd.loop === loop && lines.includes(e.cmd.line)
  const isNext = (e: SimEvent) => 'cmd' in e && e.cmd !== undefined && (e.cmd.loop > loop || (e.cmd.loop === loop && e.cmd.line > last))
  const starts = log.filter(e => (e.type === 'actionStart' || e.type === 'switch') && inSeg(e))
  if (starts.length === 0) return null
  const t0 = starts[0]!.t
  const after = log.find(e => e.t >= t0 && (e.type === 'actionStart' || e.type === 'switch') && isNext(e))
  const t1 = after ? after.t : log.at(-1)!.t
  const sw = log.find(e => e.type === 'switch' && inSeg(e))
  const external = (code: WaitCode) => EXTERNAL.includes(code) || (code === 'switchCd' && !sw)
  const nextCmd = after && 'cmd' in after ? after.cmd : undefined
  const exitWait = nextCmd ? log.reduce((acc, e) => acc + (e.type === 'wait' && e.cmd.loop === nextCmd.loop && e.cmd.line === nextCmd.line
    && e.cmd.item === nextCmd.item && external(e.code) ? e.battleFrames / 60 : 0), 0) : 0
  const inst = new Set(log.flatMap(e => (e.type === 'actionStart' && inSeg(e) ? [e.instance] : [])))
  const owned = (o: { instance: number | null } | null) => o !== null && o.instance !== null && inst.has(o.instance)

  const waits: Partial<Record<WaitCode, number>> = {}
  for (const e of log) if (e.type === 'wait' && inSeg(e)) waits[e.code] = (waits[e.code] ?? 0) + e.battleFrames / 60
  let concerto = 0, energy = 0, energyTeam = 0
  for (const g of gainSteps(log, r)) {
    if (!owned(g.owner)) continue
    for (const [n, v] of Object.entries(g.deltas)) {
      if (!v || v <= 0) continue
      if (g.resource === 'concerto' && n === char) concerto += v
      if (g.resource === 'energy') { if (n === char) energy += v; else energyTeam += v }
    }
  }
  let damage = 0, hits = 0
  for (const [e, cause] of hitCauses(log, r)) if (e.type === 'hit' && e.dmg && owned(cause.owner)) { damage += e.dmg.expected; hits++ }

  const ownerOf = new Map(r.buffs.flatMap(b => (b.owner === 'env' ? [] : [[b.def.id, r.team[b.owner]!.def.name] as const])))
  const buffs: CardMeasure['buffs'] = []
  const full = new Set<'concerto' | 'energy'>()
  const effects = { added: 0, burst: 0 }
  for (const e of log) {
    if (e.t < t0 || e.t >= t1) continue
    if (e.type === 'buffApply' && e.remaining !== 'inf' && ownerOf.get(e.buff) === char && !buffs.some(b => b.id === e.buff && b.target === e.target))
      buffs.push({ id: e.buff, target: e.target, secs: e.remaining / 60 })
    if (e.type === 'resourceFull' && e.char === char) full.add(e.resource)
    if (e.type === 'enemyState' && e.change === 'effectApplied' && e.by === char) { effects.added += e.added ?? 0; effects.burst += e.burstAdded ?? 0 }
  }
  // 出口是切走：切走那一刻，这段最后一个动作打到第几帧
  let exit: CardMeasure['exit'] = null
  if (after?.type === 'switch') {
    const lastAct = log.filter(e => e.type === 'actionStart' && inSeg(e) && e.f <= after.f).at(-1)
    if (lastAct?.type === 'actionStart') exit = { action: lastAct.action, frame: after.f - lastAct.f }
  }
  return {
    secs: t1 - t0 - exitWait, exitWait, waits,
    actions: inst.size, skipped: log.filter(e => e.type === 'skip' && inSeg(e)).length,
    intro: sw?.type === 'switch' ? sw.intro : null,
    concerto, energy, energyTeam, full: [...full], damage, hits, buffs, effects, exit,
  }
}

/** 单独量一种上下文：[铺垫] [切走、切回] 本行 出口。开局：自己的能量 0（这段或铺垫里有要能量的大招时给够），协奏 0；
 *  变奏切入时上一个人协奏 100。出口是切走时切到第三个人 */
function measureAlone(sc: Scenario, data: GameData, base: ResolvedScenario, card: Routine,
  entry: Entry, exit: Exit, withSetup: boolean): CardRow {
  const row: CardRow = { entry, exit, setup: withSetup, m: null, error: null, energyGiven: false }
  const slot = base.team.findIndex(m => m.def.name === card.char)
  const other = (slot + 1) % 3, away = (slot + 2) % 3
  const member = base.team[slot]!
  const costOf = (line: string | null) => (line ? routineOf(line)?.items ?? [] : [])
    .reduce((acc, it) => Math.max(acc, member.actions[member.aliases[it] ?? it]?.energyCost ?? 0), 0)
  const energy: [number, number, number] = [0, 0, 0]
  energy[slot] = Math.max(costOf(card.line), withSetup ? costOf(card.setup) : 0, exit === 'self' ? costOf(card.next) : 0)
  row.energyGiven = energy[slot] > 0
  const concerto: [number, number, number] = [0, 0, 0]
  if (entry === 'intro') concerto[other] = 100
  const otherName = sc.team[other]!.char, awayName = sc.team[away]!.char
  const body = [
    ...(withSetup && card.setup ? [card.setup] : []),
    ...(entry === 'field' ? [] : [...(withSetup ? [`switch ${otherName}`] : []), entry === 'intro' ? `switch ${card.char} 变奏` : `switch ${card.char}`]),
    card.line,
  ]
  const exitLine = exit === 'switch' ? `switch ${awayName}` : card.next
  if (!exitLine) { row.error = '没有下一招可接'; return row }
  const { video: _video, ...rest } = sc
  const { endAt: _endAt, ...options } = sc.options
  const variant: Scenario = {
    ...rest, opening: [], rotation: [...body, exitLine],
    initial: { ...sc.initial, onField: withSetup || entry === 'field' ? slot : other, concerto, energy },
    options: { ...options, repeat: 1, maxFrames: 6000 },
  }
  let r: ResolvedScenario
  try { r = resolveScenario(variant, data) } catch (e) { row.error = (e as Error).message.replace(/\s+/g, ' ').slice(0, 120); return row }
  const res = simulate(r)
  const n = body.length
  if (res.error && (res.error.line === undefined || res.error.line <= n)) { row.error = `${res.error.code}：${res.error.message}`; return row }
  if (res.error) { row.error = `出口跑不通（${res.error.code}：${res.error.message}）`; return row }   // 出口那一招没出手，量不出时长
  row.m = measureSegment(res.log, r, card.char, 1, entry === 'field' ? [n] : [n - 1, n])
  if (!row.m) row.error = '没出手'
  return row
}

export interface CardsOptions { chars?: readonly string[]; lines?: readonly string[] }   // 只量这些角色 / 这几行（轴里的写法）

/** 量一份场景里全部套路的卡：先跑原场景（每轮的这一段），再逐个单独量 */
export function measureCards(sc: Scenario, data: GameData, opts: CardsOptions = {}): { cards: Card[]; runs: number } {
  const base = resolveScenario(sc, data)
  const res = simulate(base)
  let runs = 1
  const loops = [...new Set(res.log.flatMap(e => (e.type === 'loop' ? [e.loop] : [])))]
  const cards: Card[] = []
  for (const rt of routinesOf(sc)) {
    if (opts.chars?.length && !opts.chars.includes(rt.char)) continue
    if (opts.lines?.length && !opts.lines.map(clean).includes(rt.line)) continue
    const card: Card = { ...rt, rows: [], team: [], flags: [] }
    // 原场景：启动轴是第 0 轮，循环轴第 1 轮起；同一套路在一轮里出现几次各算一次
    for (const [list, loopList] of [[sc.opening, [0]], [sc.rotation, loops.filter(l => l >= 1)]] as const) {
      list.forEach((line, i) => {
        if (clean(line) !== rt.line) return
        const lines = i > 0 && switchTo(list[i - 1]!) === rt.char ? [i, i + 1] : [i + 1]
        for (const loop of loopList) {
          const m = measureSegment(res.log, base, rt.char, loop, lines)
          if (m) card.team.push({ loop, entry: m.intro === null ? 'field' : m.intro ? 'intro' : 'switch', m, match: null })
        }
      })
    }
    for (const withSetup of rt.setup ? [false, true] : [false])
      for (const entry of ['field', 'switch', 'intro'] as const)
        for (const exit of ['switch', 'self'] as const) {
          if (exit === 'self' && !rt.next) continue
          card.rows.push(measureAlone(sc, data, base, card, entry, exit, withSetup))
          runs++
        }
    for (const t of card.team) {
      const same = card.rows.filter(x => x.m && x.entry === t.entry).map(x => Math.abs(x.m!.secs - t.m.secs))
      t.match = same.length ? Math.min(...same) : null
    }
    const member = base.team.find(m => m.def.name === rt.char)!
    const early = (m: CardMeasure | null) => m?.exit && m.exit.frame < SWITCH_AT_START && member.actions[m.exit.action]?.kind === 'liberation'
    if (card.rows.some(x => early(x.m)) || card.team.some(t => early(t.m))) card.flags.push('switchAtStart')
    if (card.rows.filter(x => !x.setup).every(x => !x.m)) card.flags.push('needsSetup')
    if (card.team.some(t => t.match !== null && t.match >= MISMATCH)) card.flags.push('teamMismatch')
    cards.push(card)
  }
  return { cards, runs }
}
