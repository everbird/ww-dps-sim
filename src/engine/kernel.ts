// src/engine/kernel.ts —— 仿真内核：时钟与膨胀、动作推进 / 取消 / 结束、判定生命周期、动作层合法性（TD-04）
// 只管"时间怎么走、动作和判定什么时候发生"。伤害、资源、buff、敌人、切人的细则经 KernelHooks 挂到各自模块
// （TD-03、TD-05、TD-06、TD-07）；指令队列的完整语义归 TD-09，这里只提供它要调用的 gate / settled / startAction。
import type { ActionId, Slot } from '../data/common'
import type { ActionDef, DilationDef, JudgmentDef, Rules } from '../data/gamedata'
import type {
  ActionRuntime, CharRuntime, CommandRef, JudgmentRuntime, Rates, SimEvent, SimState, TimelineEvent, WaitCode,
} from './types'

export const SLOTS: readonly Slot[] = [0, 1, 2]

/** 内核调出去的接口：P4 的结算、施放资源、延奏触发由其他模块实现 */
export interface KernelHooks {
  /** P4 一次结算（TD-03 伤害 → TD-06 资源 → TD-07 触发）。可在里面调用 spawnJudgment 生成连锁判定，同一 tick 内接着结算 */
  settle(s: SimState, j: JudgmentRuntime, tick: number): void
  castGain?(s: SimState, slot: Slot, src: EventSource, index: number): void      // TD-06
  outroTrigger?(s: SimState, slot: Slot, src: EventSource): void                  // TD-05
}
export interface Kernel { rules: Rules; hooks: KernelHooks }
/** 时间线事件的来源：进行中的动作，或脱离动作的尾部 */
export interface EventSource { def: ActionDef; instance: number }

// ---------------------------------------------------------------------------
// §2 帧约定

/** 局部帧 / 年龄每次推进后取整到 1e-4 帧：膨胀系数都是 1e-4 的整数倍，这样与整数帧的比较不受浮点误差影响 */
export const snap = (x: number): number => Math.round(x * 1e4) / 1e4
/** 本 tick 走过局部区间 [t, t + r)：帧 F 落在里面就在本 tick 发生（左闭右开）；r = 0 时什么都不发生 */
export const within = (F: number, t: number, r: number): boolean => F >= t && F < t + r

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export function log(s: SimState, ev: DistOmit<SimEvent, 'f' | 't'>): void {
  s.log.push({ ...ev, f: s.frame, t: s.battleFrames / 60 } as SimEvent)
}

// ---------------------------------------------------------------------------
// §4.1 时间线：动作里一切"到某帧发生"的事，按帧排好，用游标推进

const ORDER = { gain: 0, dilation: 1, spawn: 2, outro: 3 } as const
const timelines = new WeakMap<ActionDef, TimelineEvent[]>()

export function timelineOf(def: ActionDef): TimelineEvent[] {
  const cached = timelines.get(def)
  if (cached) return cached
  const tl: TimelineEvent[] = []
  def.castGains.forEach((g, index) => tl.push({ frame: g.atFrame, kind: 'gain', index }))
  def.dilations.forEach((d, index) => { if (d.anchor === 'action') tl.push({ frame: d.start, kind: 'dilation', index }) })
  def.judgments.forEach((j, index) => { if (j.spawnFrame !== null) tl.push({ frame: j.spawnFrame, kind: 'spawn', index }) })
  if (def.outroTriggerFrame !== undefined) tl.push({ frame: def.outroTriggerFrame, kind: 'outro' })
  tl.sort((a, b) => a.frame - b.frame || ORDER[a.kind] - ORDER[b.kind])   // 稳定排序：同帧同类按定义顺序
  timelines.set(def, tl)
  return tl
}

// ---------------------------------------------------------------------------
// §3 P1：速率表与膨胀窗口

export function computeRates(s: SimState, rules: Rules): Rates {
  const chars = [Infinity, Infinity, Infinity]
  let enemy = Infinity
  let battle: 0 | 1 = 1
  for (const d of s.dilations) {
    if (d.target === 'enemy') enemy = Math.min(enemy, d.rate)
    else chars[d.target] = Math.min(chars[d.target]!, d.rate)
    if (rules.dilation[d.type].stopsBattleClock) battle = 0
    d.remaining -= 1                                   // 本 tick 用掉一帧（世界帧）
  }
  s.dilations = s.dilations.filter(d => d.remaining > 0)
  const or1 = (r: number) => (r === Infinity ? 1 : r)  // 没有窗口 = 1；有窗口取最小（含 > 1 的加速窗口）
  return { battle, chars: [or1(chars[0]!), or1(chars[1]!), or1(chars[2]!)], enemy: or1(enemy) }
}

/** 登记一条膨胀定义：按侧展开到具体单位；攻击顿帧类的侧先撤掉该单位上已有的攻击顿帧。下一 tick 起生效 */
export function registerDilation(
  s: SimState, rules: Rules, def: DilationDef, source: Slot, instance: number, withSelf: boolean,
): void {
  const sides = [['self', def.self], ['enemy', def.enemy], ['ally', def.ally]] as const
  for (const [side, w] of sides) {
    if (!w || w.duration <= 0 || (side === 'self' && !withSelf)) continue
    const hitstop = rules.dilation[def.type].hitstopSides.includes(side)
    const targets: (Slot | 'enemy')[] = side === 'self' ? [source] : side === 'enemy' ? ['enemy'] : SLOTS.filter(x => x !== source)
    for (const target of targets) {
      if (hitstop) s.dilations = s.dilations.filter(d => !(d.target === target && d.hitstop))
      s.dilations.push({ type: def.type, source, side, target, rate: w.rate, remaining: w.duration, hitstop, instance })
    }
  }
}

// ---------------------------------------------------------------------------
// §4 动作：开始、取消、自然结束、推进

const survives = (j: JudgmentDef): boolean => j.persistsOnCancel && j.lifeFrames !== -1
/** 局部帧 t 时（tick 开头）判定是否已经出现：出现帧 < t 的事件都已发生 */
const bornBy = (j: JudgmentDef, t: number): boolean => (j.birthFrame ?? j.spawnFrame!) < t

/** 开始新动作（§4.2）：先取消还在进行的旧动作；再按"可脱手"清掉此前动作留下的不可脱手判定（自然结束后仍存活的、尾部里还没生成的）。
 *  cmd = 由哪条指令开始（TD-09），写进日志；有冷却的动作从这一刻起算冷却 */
export function startAction(s: SimState, k: Kernel, slot: Slot, def: ActionDef, cmd?: CommandRef): ActionRuntime {
  const c = s.chars[slot]
  if (c.action) cancelAction(s, k, slot, def.id)
  const dropped: string[] = []
  s.judgments = s.judgments.filter(j => {
    if (j.owner !== slot || survives(j.def)) return true
    dropped.push(j.def.name)
    return false
  })
  for (const tail of s.tails) {
    if (tail.owner !== slot) continue
    tail.events = tail.events.filter(e => {
      if (e.kind !== 'spawn' || survives(tail.def.judgments[e.index]!)) return true
      dropped.push(tail.def.judgments[e.index]!.name)
      return false
    })
  }
  s.tails = s.tails.filter(t => t.events.length > 0)
  const a: ActionRuntime = {
    id: def.id, def, instance: s.nextId++, localFrame: 0, startedAt: s.frame, cursor: 0, ended: false,
    coreGranted: [false, false, false],
  }
  c.action = a
  c.last = a
  c.startedThisTick = true
  if (def.cooldown) c.cooldowns[cooldownKey(def)] = def.cooldown
  log(s, { type: 'actionStart', char: c.name, action: def.id, instance: a.instance, ...(cmd ? { cmd } : {}), ...(dropped.length ? { dropped } : {}) })
  return a
}

/** 取消（§4.2）：同一角色开始新动作时，旧动作在局部帧 t 被打断 */
function cancelAction(s: SimState, k: Kernel, slot: Slot, by: ActionId): void {
  const c = s.chars[slot]
  const a = c.action!
  const t = a.localFrame
  const dropped: string[] = []
  // ① 已生成的判定：可脱手的留下，其余（含持续帧 -1）立即移除
  s.judgments = s.judgments.filter(j => {
    if (j.actionInstance !== a.instance || survives(j.def)) return true
    dropped.push(j.def.name)
    return false
  })
  // ② 未发生的事件：已出现且可脱手的判定转为尾部，按战斗时钟继续；延奏触发也转为尾部——延奏是下场角色发出的，
  //    上场角色的变奏被打断不影响它（2026-09-27 用户确认，见 AGENTS.md 差异 1）；其余（资源、膨胀、未出现的判定）作废
  const rest = timelineOf(a.def).slice(a.cursor)
  const keep = rest.filter(e => e.kind === 'outro'
    || (e.kind === 'spawn' && survives(a.def.judgments[e.index]!) && bornBy(a.def.judgments[e.index]!, t)))
  for (const e of rest) if (e.kind === 'spawn' && !keep.includes(e)) dropped.push(a.def.judgments[e.index]!.name)
  if (keep.length) s.tails.push({ owner: slot, action: a.id, def: a.def, instance: a.instance, localFrame: t, events: keep })
  // ③ 已登记的膨胀窗口照常走完；只有 clearSelfOnCancel 类型（极限闪避减速）撤掉自身侧
  s.dilations = s.dilations.filter(d => !(d.instance === a.instance && d.side === 'self' && k.rules.dilation[d.type].clearSelfOnCancel))
  a.ended = true
  c.action = null
  log(s, { type: 'actionCancel', char: c.name, action: a.id, instance: a.instance, by, dropped })
}

/** 自然结束（§4.3）：局部帧到达 endFrame。持续帧 -1 的判定随之移除；没发生的事件转为尾部（持续帧 -1 的判定除外：动作停了它就不存在） */
function endAction(s: SimState, slot: Slot): void {
  const c = s.chars[slot]
  const a = c.action!
  s.judgments = s.judgments.filter(j => !(j.actionInstance === a.instance && j.def.lifeFrames === -1))
  const rest = timelineOf(a.def).slice(a.cursor).filter(e => !(e.kind === 'spawn' && a.def.judgments[e.index]!.lifeFrames === -1))
  if (rest.length) s.tails.push({ owner: slot, action: a.id, def: a.def, instance: a.instance, localFrame: a.localFrame, events: rest })
  a.ended = true
  c.action = null
  log(s, { type: 'actionEnd', char: c.name, action: a.id, instance: a.instance })
}

/** P2 开头：局部帧已到 endFrame 的动作结束。放在这里而不是上一 tick 的 P3 末尾，动作才能占满 [0, endFrame) 的每一帧 */
export function endDueActions(s: SimState): void {
  for (const slot of SLOTS) {
    const a = s.chars[slot].action
    if (a && a.localFrame >= a.def.endFrame) endAction(s, slot)
  }
}

/** P3：三名角色按槽位推进局部帧，发生区间内的时间线事件；尾部按战斗时钟推进 */
export function advanceActions(s: SimState, k: Kernel, rates: Rates): void {
  for (const slot of SLOTS) {
    const c = s.chars[slot]
    const r = rates.chars[slot]
    const a = c.action
    if (a) {
      const tl = timelineOf(a.def)
      const until = Math.min(a.localFrame + r, a.def.endFrame)   // ≥ endFrame 的事件一律归尾部（§4.3）
      while (a.cursor < tl.length && tl[a.cursor]!.frame < until) fireEvent(s, k, slot, a, tl[a.cursor++]!)
      a.localFrame = snap(a.localFrame + r)
    } else if (c.last) {
      c.last.localFrame = snap(c.last.localFrame + r)  // 已结束的动作继续计时：派生窗口可以越过结束帧（§6.2）
    }
    for (const tail of s.tails) {
      if (tail.owner !== slot) continue
      while (tail.events.length > 0 && tail.events[0]!.frame < tail.localFrame + rates.battle) fireEvent(s, k, slot, tail, tail.events.shift()!)
      tail.localFrame = snap(tail.localFrame + rates.battle)
    }
  }
  s.tails = s.tails.filter(t => t.events.length > 0)
}

function fireEvent(s: SimState, k: Kernel, slot: Slot, src: EventSource, e: TimelineEvent): void {
  switch (e.kind) {
    case 'gain': k.hooks.castGain?.(s, slot, src, e.index); break
    case 'dilation':
      registerDilation(s, k.rules, src.def.dilations[e.index]!, slot, src.instance, s.chars[slot].action?.instance === src.instance)
      break
    case 'spawn': spawnJudgment(s, slot, src.def.id, src.instance, src.def.judgments[e.index]!); break
    case 'outro': k.hooks.outroTrigger?.(s, slot, src); break
  }
}

// ---------------------------------------------------------------------------
// §5 判定：生成、结算次数、年龄、到期

let settleQueue: JudgmentRuntime[] | null = null   // P4 进行中时，新生成的判定追加到这里，同一 tick 内结算

export function spawnJudgment(s: SimState, owner: Slot, action: ActionId, instance: number, def: JudgmentDef): JudgmentRuntime {
  const j: JudgmentRuntime = { id: s.nextId++, owner, action, actionInstance: instance, def, spawnedAt: s.frame, age: 0, ticksDone: 0 }
  s.judgments.push(j)
  settleQueue?.push(j)
  log(s, { type: 'judgmentSpawn', char: s.chars[owner].name, action, judgment: def.name, id: j.id })
  return j
}

/** 第 n 次结算在年龄 n × 间隔；没有间隔时在寿命内均分 */
export const tickSpacing = (j: JudgmentDef): number =>
  j.tickInterval ?? (j.ticks > 1 && j.lifeFrames > 0 ? j.lifeFrames / j.ticks : 0)
/** 寿命内实际能结算的次数：第 n 次要满足 n × 间隔 < 寿命（寿命 -1 时就是 ticks） */
export function ticksWithinLife(j: JudgmentDef): number {
  if (j.lifeFrames === -1) return j.ticks
  const spacing = tickSpacing(j)
  let n = 0
  for (let i = 0; i < j.ticks; i++) if (i === 0 || i * spacing < j.lifeFrames) n++
  return n
}
/** 判定时钟：跟随顿帧的随出伤者局部速率，其余随战斗时钟 */
export const judgmentRate = (j: JudgmentRuntime, rates: Rates): number =>
  j.def.followHitstop ? rates.chars[j.owner] : rates.battle

/** P4：按槽位、生成顺序结算到点的判定；然后推进年龄，移除到期的 */
export function settleJudgments(s: SimState, k: Kernel, rates: Rates): void {
  const queue = [...s.judgments].sort((a, b) => a.owner - b.owner || a.id - b.id)
  settleQueue = queue
  try {
    for (let i = 0; i < queue.length; i++) {
      const j = queue[i]!
      if (!s.judgments.includes(j)) continue           // 连锁中被移除
      const r = judgmentRate(j, rates)
      const spacing = tickSpacing(j.def)
      while (j.ticksDone < j.def.ticks) {
        const n = j.ticksDone
        const at = n * spacing
        const due = n === 0
          ? j.age === 0                                   // 第一次：生成的那个 tick，不看速率
          : within(at, j.age, r) && (j.def.lifeFrames === -1 || at < j.def.lifeFrames)
        if (!due) break
        j.ticksDone++
        k.hooks.settle(s, j, n)
        if (j.def.hitstop) {
          const self = s.chars[j.owner].action?.instance === j.actionInstance   // 自身侧只作用于仍在进行的出招动作
          registerDilation(s, k.rules, j.def.hitstop, j.owner, j.actionInstance, self)
        }
      }
    }
  } finally {
    settleQueue = null
  }
  for (const j of s.judgments) j.age = snap(j.age + judgmentRate(j, rates))
  s.judgments = s.judgments.filter(j => j.def.lifeFrames === -1 || j.age < j.def.lifeFrames)
}

// ---------------------------------------------------------------------------
// §6 动作层合法性：优先级、派生窗口、连段前置、输入锁；以及"取消会不会丢东西"

export const priorityAt = (def: ActionDef, t: number): number => {
  let v = def.priority[0]?.value ?? 0
  for (const p of def.priority) if (p.fromFrame <= t) v = p.value
  return v
}
const inWindow = (def: ActionDef, t: number): boolean => def.cancelWindows.some(w => t >= w.from && t < w.until)

export type GateResult =
  | { ok: true; via: 'idle' | 'priority' | 'derive' }
  | { ok: false; wait: true; code: WaitCode; reason: string }
  | { ok: false; wait: false; code: 'comboBroken'; reason: string }   // 等不来：连段已断

/** 动作层面能不能开始（§6.5）。原因按"连段 → 输入锁 → 优先级 / 派生"的顺序报第一个；
 *  "本 tick 已开始过动作"放在最后：只有其余都满足时才报它，等待记录里就不会冒出一帧一帧的它（TD-09 §3.2） */
export function gate(c: CharRuntime, def: ActionDef): GateResult {
  const r = gateRules(c, def)
  return r.ok && c.startedThisTick ? { ok: false, wait: true, code: 'started', reason: '同一角色一个 tick 只能开始一个动作' } : r
}

function gateRules(c: CharRuntime, def: ActionDef): GateResult {
  if (def.comboFrom?.length) {
    const last = c.last
    if (!last || !def.comboFrom.includes(last.id))
      return { ok: false, wait: false, code: 'comboBroken', reason: `${def.id} 只能接在 ${def.comboFrom.join(' / ')} 之后` }
    if (!inWindow(last.def, last.localFrame)) {
      return last.def.cancelWindows.some(w => last.localFrame < w.from)
        ? { ok: false, wait: true, code: 'combo', reason: `等 ${last.id} 的派生窗口` }
        : { ok: false, wait: false, code: 'comboBroken', reason: `${last.id} 的派生窗口已过，连段中断` }
    }
  }
  const a = c.action
  if (!a) return { ok: true, via: 'idle' }
  const t = a.localFrame
  for (const l of a.def.inputLocks) {
    if (t < l.until && (l.kinds === 'all' || l.kinds.includes(def.kind)))
      return { ok: false, wait: true, code: 'inputLock', reason: `${a.id} 第 ${l.until} 帧前不响应${l.kinds === 'all' ? '输入' : ` ${l.kinds.join(' / ')}`}` }
  }
  const p = priorityAt(a.def, t)
  const P = priorityAt(def, 0)
  if (P > p) return { ok: true, via: 'priority' }
  if (P === p && inWindow(a.def, t)) return { ok: true, via: 'derive' }
  return P < p
    ? { ok: false, wait: true, code: 'priority', reason: `优先级 ${P} 低于 ${a.id} 当前的 ${p}` }
    : { ok: false, wait: true, code: 'derive', reason: `等 ${a.id} 的派生窗口` }
}

/** 冷却按什么记：声骸技能共用一个冷却（'echo'）；共用冷却的技能按 cooldownGroup（椿的 E1 / E2 共用 'E'）；其余按动作 ID */
export const cooldownKey = (def: ActionDef): string => (def.kind === 'echo' ? 'echo' : def.cooldownGroup ?? def.id)

/** 现在取消当前动作会不会丢东西：还有未出现的判定、不可脱手且没结算完的判定、没发生的资源 / 膨胀 / 延奏触发 → 未就绪（§6.4）。
 *  角色空闲时恒为就绪：此前动作留下的不可脱手判定会在下一个动作开始时按"变更动作"消失（§4.2），默认调度不为它等待 */
export function settled(s: SimState, slot: Slot): boolean {
  const a = s.chars[slot].action
  if (!a || a.localFrame >= a.def.endFrame) return true
  const t = a.localFrame
  const tl = timelineOf(a.def)
  for (let i = a.cursor; i < tl.length; i++) {
    const e = tl[i]!
    if (e.kind === 'outro') continue                            // 延奏触发打断后照样发生（转尾部），不用等
    if (e.kind !== 'spawn') return false
    const j = a.def.judgments[e.index]!
    if (!(survives(j) && bornBy(j, t))) return false
  }
  return !s.judgments.some(j => j.actionInstance === a.instance && !survives(j.def) && j.ticksDone < ticksWithinLife(j.def))
}

// ---------------------------------------------------------------------------
// §1 一个 tick

/** 推进一个世界帧。schedule 是 P2 的指令执行（TD-09），返回"还有没有未执行的指令"。返回 false = 已无事可做，本 tick 不计入 */
export function tick(s: SimState, k: Kernel, schedule: (s: SimState) => boolean): boolean {
  const rates = computeRates(s, k.rules)                        // P1
  for (const c of s.chars) c.startedThisTick = false
  endDueActions(s)                                              // P2 开头
  const pending = schedule(s)                                   // P2 执行指令
  if (!pending && s.chars.every(c => !c.action) && s.judgments.length === 0 && s.tails.length === 0) return false
  advanceActions(s, k, rates)                                   // P3
  settleJudgments(s, k, rates)                                  // P4
  // P5 敌人量表：TD-06
  s.switchCd = Math.max(0, s.switchCd - rates.battle)          // P6 计时器：切人 CD、技能冷却按战斗速率（buff 在 TD-07）
  for (const c of s.chars) for (const key of Object.keys(c.cooldowns)) c.cooldowns[key] = Math.max(0, c.cooldowns[key]! - rates.battle)
  s.battleFrames += rates.battle                                // P7
  s.frame += 1
  return true
}
