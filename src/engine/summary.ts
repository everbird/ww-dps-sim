// src/engine/summary.ts —— 从事件日志汇总（总设计 §3.5、第 9 节）。所有数字都由日志派生，不在别处重算。
// DPS 口径：窗口 = 第 0 帧到"最后一条指令对应动作的结束帧"（options.endAt 可覆盖），按战斗时钟计；
// 窗口外仍在结算的伤害单列为溢出伤害，不计入 DPS。资源曲线（TD-06 §6.1）、buff 覆盖率（TD-07 §10.1）、
// 分轮与稳态（options.repeat ≥ 2，TD-09 §3.7）也从日志算。
import type { CharName } from '../data/common'
import { ASSUMPTIONS } from './assumptions'
import { INTENDED } from './scheduler'
import type { HitEvent, ResolvedScenario, SimEvent, SimState, Summary } from './types'
import { round, roundTo } from './num'

/** 一段命中计入多少伤害：期望模式是期望值；抽样模式按这一段抽到的暴击 / 非暴击（总设计 T4）。汇总、对比都按它算 */
export const hitValue = (h: HitEvent): number => {
  const d = h.dmg
  if (!d) return 0
  return d.isCrit === undefined ? d.expected : d.isCrit ? d.crit : d.nonCrit
}

/** 事件的战斗帧（t 是战斗秒数） */
export const battleFrameOf = (e: SimEvent): number => round(e.t * 60)

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
    const v = hitValue(h)
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
  const lp = loops(log, r, hits, windowFrames)
  // 打死敌人与比较的目标（TD-10 §7）：所有命中都算（窗口外的也是真伤害）；没打到时按稳态（没有稳态按整个窗口）的 DPS 往后估
  const rate = lp.steady?.dps ?? (windowFrames > 0 ? totalDamage / (windowFrames / 60) : 0)
  const kill = killOf(hits, r.enemy.hp, rate, s.battleFrames)
  const goal = goalSummary(r, hits, rate, s.battleFrames)
  return {
    totalDamage, windowFrames, dps: windowFrames > 0 ? totalDamage / (windowFrames / 60) : 0, overflowDamage,
    ...lp,
    kill, ...(goal ? { goal: goal.goal } : {}),
    byChar, byAction: actions, enemy: enemyStats(log, windowFrames),
    resourceTimeline: resourceTimeline(log, r, s), buffUptime: buffUptime(log, 0, windowFrames),
    waits: log.flatMap(e => (e.type === 'wait' && !INTENDED.includes(e.code)
      ? [{ line: e.cmd.line, item: e.cmd.item, loop: e.cmd.loop, code: e.code, frames: e.frames, reason: e.reason }] : [])),
    skipped: log.flatMap(e => (e.type === 'skip' ? [{ line: e.cmd.line, item: e.cmd.item, loop: e.cmd.loop, reason: e.reason }] : [])),
    warnings: [
      ...r.warnings.map(message => ({ code: 'resolve', message })),
      ...log.flatMap(e => (e.type === 'warning' ? [{ code: e.code, message: e.message, ...(e.line !== undefined ? { line: e.line } : {}) }] : [])),
      ...steadyPhase(log, lp),
      ...steadySkip(lp),
      ...steadyDrift(lp),
      ...(goal?.warning ? [goal.warning] : []),
    ],
    // 这次碰到的假设，按假设表的顺序（总设计 T16、§10.1：输出顺序不依赖对象键）
    assumptions: ASSUMPTIONS.flatMap(a => {
      const x = s.assumed[a.id]
      return x ? [{ id: a.id, count: x.n, firstFrame: x.at, detail: [...x.detail] }] : []
    }),
  }
}

const dpsOf = (damage: number, frames: number): number => (frames > 0 ? damage / (frames / 60) : 0)

/** 累计伤害到 hp 的那一下的战斗帧；日志里没到时 frame = null，estimate = 日志结束（end，战斗帧）后按 rate 每秒补齐剩下的血 */
function killOf(hits: readonly HitEvent[], hp: number, rate: number, end: number): Summary['kill'] {
  let acc = 0
  for (const h of hits) {
    acc += hitValue(h)
    if (acc >= hp) return { hp, frame: battleFrameOf(h), estimate: null }
  }
  return { hp, frame: null, estimate: rate > 0 ? round(end + (hp - acc) / rate * 60) : null }
}

const wan = (x: number) => (x >= 1e4 ? `${roundTo(x / 1e4, 10)} 万` : String(Math.round(x)))

/** 场景的目标（ResolvedScenario.goal）→ Summary.goal 与没打到时的提示；稳态时 null */
function goalSummary(r: ResolvedScenario, hits: readonly HitEvent[], rate: number, end: number):
  { goal: NonNullable<Summary['goal']>; warning: Summary['warnings'][number] | null } | null {
  const g = r.goal
  if (g.kind === 'steady') return null
  if (g.kind === 'kill') {
    const k = killOf(hits, g.hp, rate, end)
    const hi = k.frame ?? k.estimate ?? Infinity
    const label = `打死 ${wan(g.hp)}血${g.scale !== null ? `（敌人生命 ×${g.scale}）` : ''}`
    return {
      goal: { kind: 'kill', label, lo: 0, hi, damage: g.hp, dps: dpsOf(g.hp, hi), reached: k.frame !== null },
      warning: k.frame !== null ? null : {
        code: 'goalNotReached',
        message: `${label}：跑完 ${(end / 60).toFixed(1)} 战斗秒还没打死，按每秒 ${Math.round(rate)} 估在第 ${(hi / 60).toFixed(1)} 秒；多跑几轮（options.repeat）`,
      },
    }
  }
  let damage = 0
  for (const h of hits) if (battleFrameOf(h) < g.frames) damage += hitValue(h)
  const label = `前 ${roundTo(g.frames / 60, 10)} 秒`
  const reached = end >= g.frames
  return {
    goal: { kind: 'window', label, lo: 0, hi: g.frames, damage, dps: dpsOf(damage, g.frames), reached },
    warning: reached ? null : {
      code: 'goalNotReached', message: `${label}：只跑了 ${(end / 60).toFixed(1)} 战斗秒，后面没伤害；多跑几轮（options.repeat）`,
    },
  }
}

/** 稳态可能受相位影响（TD-10 §2，2026-10-22 心队发现）：谐度破坏不跟着轮走，各轮赶上的次数不一样
 *  （心队四轮一循环"1、1、1、2"次谐度破坏），稳态只有两三轮时会忽高忽低（心队 4 轮时稳态 47,775，10 轮 48,470；
 *  C2 +19.81% → +9.28%）。循环轴各轮的次数不全相同、稳态又不到 6 轮时提示多跑几轮。破盾不算：只给能量，
 *  M0 的破盾两轮一循环（2、1 次），各轮 DPS 仍一样 */
function steadyPhase(log: readonly SimEvent[], lp: Pick<Summary, 'perLoop' | 'steady'>): Summary['warnings'] {
  const rounds = (lp.perLoop ?? []).filter(p => p.loop >= 1)
  const st = lp.steady
  if (!st || rounds.length < 2) return []
  const n = st.to - st.from + 1
  if (n >= 6) return []
  const events = log.flatMap(e => (e.type === 'enemyState' && e.change === 'harmonyBreak' ? [battleFrameOf(e)] : []))
  const counts = rounds.map(p => events.filter(f => f >= p.start && f < p.start + p.frames).length)
  if (new Set(counts).size <= 1) return []
  return [{
    code: 'steadyPhase',
    message: `稳态只取了 ${n} 轮（第 ${st.from}–${st.to} 轮），可各轮赶上的谐度破坏次数不一样（第 1 轮起依次 ${counts.join('、')} 次）：`
      + '落在哪一轮会让稳态忽高忽低，比较时多跑几轮（options.repeat，稳态最好 6 轮以上）',
  }]
}

/** 稳态还在漂移（P3，2026-10-22 心队 C2 发现：每轮时长到第 4 轮才从 1,762 帧变成 1,888 帧，之后不变；稳态第 2–9 轮混进了前两轮）：
 *  前一半与后一半的 DPS 差 1% 以上时提示 */
export const DRIFT_WARN = 0.01
function steadyDrift(lp: Pick<Summary, 'perLoop' | 'steady'>): Summary['warnings'] {
  const st = lp.steady
  if (!st || !lp.perLoop || st.to - st.from + 1 < 4) return []
  const part = lp.perLoop.filter(p => p.loop >= st.from && p.loop <= st.to)
  const half = Math.floor(part.length / 2)
  const d = (ps: typeof part) => dpsOf(ps.reduce((x, p) => x + p.damage, 0), ps.reduce((x, p) => x + p.frames, 0))
  const a = d(part.slice(0, half)), b = d(part.slice(part.length - half))
  if (!(a > 0) || Math.abs(b / a - 1) < DRIFT_WARN) return []
  const secs = part.map(p => (p.frames / 60).toFixed(1)).join('、')
  return [{
    code: 'steadyDrift',
    message: `稳态（第 ${st.from}–${st.to} 轮）前一半 DPS ${Math.round(a)}、后一半 ${Math.round(b)}，差 ${((b / a - 1) * 100).toFixed(1)}%（各轮 ${secs} 秒）：`
      + '轴可能还没进入稳定（资源在漂移，稳态偏向前几轮），或者各轮来回波动；多跑几轮看后面的轮，比较时看误差条',
  }]
}

/** 稳态从第几轮起（P3，2026-10-24）：缺省第 2 轮。第 2 轮起各轮 DPS 有一轮离合并的 DPS 1% 以上（DRIFT_WARN）时，往后找最早一个
 *  "之后每一轮都在 ±1% 以内"（稳住了）的起点（各轮的 DPS 不算谐度破坏的伤害，见调用处）；挪完至少留 4 轮、且不少于原来的一半。找不到（来回波动，比如心队三轮一周期的协奏、
 *  谐度破坏的相位）就照旧第 2 轮，由 steadyDrift 提示。心队 C2 前几轮靠开局的能量，自动从第 5 轮起 */
function steadyStart<T extends { loop: number; dps: number; damage: number; frames: number }>(
  rounds: readonly T[], to: number, sumOf: (ps: readonly T[]) => number,
): number {
  const settled = (from: number) => {
    const part = rounds.filter(p => p.loop >= from && p.loop <= to)
    const all = sumOf(part)
    return all > 0 && part.every(p => Math.abs(p.dps / all - 1) < DRIFT_WARN)
  }
  const n = to - 1                                     // 第 2 轮到 to 的轮数
  if (n < 4 || settled(2)) return 2
  for (let from = 3; to - from + 1 >= Math.max(4, Math.ceil(n / 2)); from++) if (settled(from)) return from
  return 2
}

/** 稳态没从第 2 轮起（steadyStart 挪过）时说一声：前面几轮在漂移 */
function steadySkip(lp: Pick<Summary, 'perLoop' | 'steady'>): Summary['warnings'] {
  const st = lp.steady
  if (!st || st.from <= 2 || !lp.perLoop) return []
  const early = lp.perLoop.filter(p => p.loop >= 2 && p.loop < st.from)
  return [{
    code: 'steadySkip',
    message: `稳态从第 ${st.from} 轮起：第 ${st.from === 3 ? '2' : `2–${st.from - 1}`} 轮还在漂移（DPS ${early.map(p => Math.round(p.dps)).join('、')}，`
      + `之后各轮都在合并 DPS ${Math.round(st.dps)} 的 ±${DRIFT_WARN * 100}% 以内），多半是开局的资源还没用完`,
  }]
}

/** Summary.enemy：窗口内的敌人量表事件与谐度破坏伤害（TD-06 §13） */
function enemyStats(log: readonly SimEvent[], W: number): Summary['enemy'] {
  const out = { disharmony: 0, tuneBreaks: 0, tuneBreakDamage: 0, breaks: 0 }
  for (const e of log) {
    if (battleFrameOf(e) >= W) break                                  // 日志按世界帧记，战斗帧不减
    if (e.type === 'enemyState') {
      if (e.change === 'disharmony') out.disharmony++
      else if (e.change === 'harmonyBreak') out.tuneBreaks++
      else if (e.change === 'break') out.breaks++
    } else if (e.type === 'hit' && e.dmg && e.tags.includes('谐度破坏')) out.tuneBreakDamage += hitValue(e)
  }
  return out
}

/** 分轮与稳态（Summary.perLoop / steady 的注释）。不到 2 轮（没循环、或第 2 轮还没开始就停了）时没有 */
function loops(log: readonly SimEvent[], r: ResolvedScenario, hits: readonly HitEvent[], W: number): Pick<Summary, 'perLoop' | 'steady'> {
  // 只算窗口内开始的轮（endAt 截在某一轮中途时，之后的轮次标记不算，否则与资源快照对不上）
  const marks = log.filter(e => e.type === 'loop' && battleFrameOf(e) < W)
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
  const tuneBreak = starts.map(() => 0)                     // 各轮谐度破坏的伤害：判稳态起点时不算（相位，steadyStart）
  for (const h of hits) {
    const f = battleFrameOf(h)
    if (f >= W) continue
    let k = 0
    while (k + 1 < starts.length && f >= starts[k + 1]!) k++
    damage[k]! += hitValue(h)
    if (h.tags.includes('谐度破坏')) tuneBreak[k]! += hitValue(h)
  }
  const delta = (k: number, x: 'energy' | 'concerto') =>
    [0, 1, 2].map(i => roundTo(at[k + 1]![x][i]! - at[k]![x][i]!, 1e6)) as [number, number, number]
  const perLoop = starts.map((start, k) => ({
    loop: (marks[k] as Extract<SimEvent, { type: 'loop' }>).loop, start, frames: ends[k]! - start, damage: damage[k]!,
    dps: dpsOf(damage[k]!, ends[k]! - start), energyDelta: delta(k, 'energy'), concertoDelta: delta(k, 'concerto'),
  }))
  // 稳态只看循环轴的轮（启动轴是第 0 轮，不算）：第 2 轮到倒数第 2 轮；只有 2 轮时取第 2 轮；不到 2 轮没有稳态
  const rounds = perLoop.filter(p => p.loop >= 1)
  if (rounds.length < 2) return { perLoop }
  const to = Math.max(2, rounds.length - 1)
  const sumOf = (ps: readonly typeof rounds[number][]) => dpsOf(ps.reduce((x, p) => x + p.damage, 0), ps.reduce((x, p) => x + p.frames, 0))
  // 判稳态起点用去掉谐度破坏伤害的 DPS：谐度破坏不跟着轮走，赶上两次的那一轮高一截是相位，不是漂移
  const noTune = rounds.map(p => {
    const d = p.damage - tuneBreak[perLoop.indexOf(p)]!
    return { loop: p.loop, frames: p.frames, damage: d, dps: dpsOf(d, p.frames) }
  })
  const from = steadyStart(noTune, to, ps => dpsOf(ps.reduce((x, p) => x + p.damage, 0), ps.reduce((x, p) => x + p.frames, 0)))
  const part = rounds.filter(p => p.loop >= from && p.loop <= to)
  const frames = part.reduce((x, p) => x + p.frames, 0), dmg = part.reduce((x, p) => x + p.damage, 0)
  const dps = dpsOf(dmg, frames)
  // 误差条（P3）：窗口挪一轮（去掉第一轮或最后一轮），以及前一半与后一半各算一次（还在漂移的轴两半差得多）；取离稳态最远的。
  // 只有一轮时 0。轮数太少、各轮赶上的谐度破坏次数不同（相位）时这里看不出来，另有 steadyPhase 提示
  const half = Math.floor(part.length / 2)
  const alts = [
    ...(part.length >= 3 ? [sumOf(part.slice(1)), sumOf(part.slice(0, -1))] : []),
    ...(part.length >= 2 ? [sumOf(part.slice(0, half)), sumOf(part.slice(part.length - half))] : []),
  ]
  const spread = dps > 0 && alts.length ? Math.max(...alts.map(x => Math.abs(x / dps - 1))) : 0
  return { perLoop, steady: { from, to, frames, damage: dmg, dps, spread } }
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
