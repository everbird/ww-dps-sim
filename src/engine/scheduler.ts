// src/engine/scheduler.ts —— 排轴的编译与调度（TD-09）
// compileRotation：场景的 rotation 行 → Command[]（总设计 §3.3 第 7 步）；静态能查出来的错一次报全。
// createScheduler：每个 tick 的 P2"执行指令"（TD-04 §1）：按顺序、在最早合法帧执行；能等就等并记下原因，等不来就报错。
import type { ActionId, Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import { parseRotationLine, type Command } from '../data/scenario.schema'
import { cooldownKey, gate, log, settled, startAction, tick, type Kernel } from './kernel'
import type { CommandRef, QueueState, SimState, WaitCode } from './types'

export type ScheduleErrorCode = 'comboBroken' | 'timeout' | 'maxFrames' | 'notOnField' | 'switchSelf'

/** 运行期报错：等不来（连段已断）、等超时、超过帧数上限。cmd 指出第几轮第几条 */
export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode
  readonly cmd: CommandRef | null
  readonly frame: number
  constructor(code: ScheduleErrorCode, message: string, cmd: CommandRef | null, frame: number) {
    super(message)
    this.name = 'ScheduleError'
    this.code = code
    this.cmd = cmd
    this.frame = frame
  }
}

// ---------------------------------------------------------------------------
// §4 编译

export interface CompileMember { name: string; actions: Record<ActionId, ActionDef>; aliases: Record<string, ActionId> }
export interface CompileIssue { line: number; item?: number; message: string }
export type CompileResult = { ok: true; commands: Command[] } | { ok: false; issues: CompileIssue[] }

/** rotation 的每一行 → 指令；line 从 1 起（= 场景里第几条），item 是行内第几个动作 */
export function compileRotation(lines: string[], team: CompileMember[], onField: Slot, repeat = 1): CompileResult {
  const issues: CompileIssue[] = []
  const commands: Command[] = []
  const slotOf = new Map(team.map((m, i) => [m.name, i as Slot]))
  let switchFailed = false
  lines.forEach((text, i) => {
    const line = i + 1
    const items = parseRotationLine(text)
    if ('error' in items) { issues.push({ line, message: items.error }); return }
    items.forEach((it, j) => {
      const item = j + 1
      if (it.kind === 'wait') { commands.push({ kind: 'wait', line, item, frames: it.frames }); return }
      const slot = slotOf.get(it.char)
      if (slot === undefined) {
        issues.push({ line, item, message: `${it.char} 不在队伍里（队伍：${team.map(m => m.name).join('、')}）` })
        if (it.kind === 'switch') switchFailed = true
        return
      }
      if (it.kind === 'switch') { commands.push({ kind: 'switch', line, item, to: slot }); return }
      const m = team[slot]!
      const id = Object.hasOwn(m.actions, it.action) ? it.action : Object.hasOwn(m.aliases, it.action) ? m.aliases[it.action] : undefined
      const def = id !== undefined && Object.hasOwn(m.actions, id) ? m.actions[id] : undefined
      if (id === undefined || !def) {
        issues.push({ line, item, message: `${m.name} 没有动作"${it.action}"（别名：${Object.keys(m.aliases).join('、') || '无'}）` })
        return
      }
      if (def.kind === 'intro' || def.kind === 'outro') {
        issues.push({ line, item, message: `${m.name} ${id} 是${def.kind === 'intro' ? '变奏' : '延奏'}，由切人自动触发（协奏满时），不能单独写` })
        return
      }
      commands.push({ kind: 'act', line, item, slot, action: id, delay: it.delay, force: it.force })
    })
  })
  if (issues.length === 0 && commands.length === 0) issues.push({ line: 0, message: '排轴里没有指令' })
  // 有错的那一项已跳过，其余照查；切人写错时前台推不下去，不再查前台，免得连带报一串
  if (!switchFailed) issues.push(...checkOnField(commands, team, onField, repeat))
  issues.sort((a, b) => a.line - b.line || (a.item ?? 0) - (b.item ?? 0))
  return issues.length > 0 ? { ok: false, issues } : { ok: true, commands }
}

/** 前台只由 switch 改变，"出招的人在不在前台"编译期就能查（§4.2）。循环时第 2 轮从第 1 轮结束时的前台开始，再查一遍，只报第一处 */
function checkOnField(commands: Command[], team: CompileMember[], onField: Slot, repeat: number): CompileIssue[] {
  const out: CompileIssue[] = []
  let cur = onField
  for (let pass = 1; pass <= Math.min(repeat, 2) && out.length === 0; pass++) {
    const where = pass === 2 ? '循环第 2 轮：' : ''
    for (const c of commands) {
      if (pass === 2 && out.length > 0) break
      if (c.kind === 'switch') {
        if (c.to === cur) out.push({ line: c.line, item: c.item, message: `${where}switch ${team[c.to]!.name}：${team[c.to]!.name} 已经在前台` })
        cur = c.to
      } else if (c.kind === 'act' && c.slot !== cur) {
        const hint = pass === 2 ? `；循环的轴，末尾要让前台回到 ${team[onField]!.name}` : `；先写 switch ${team[c.slot]!.name}`
        out.push({ line: c.line, item: c.item, message: `${where}${team[c.slot]!.name} 不在前台（前台是 ${team[cur]!.name}）${hint}` })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// §3 调度

export interface SchedulerOptions {
  maxWait: number                           // 一条指令因"不合法"最多等多少世界帧（options.maxWait）
  /** TD-06：资源够不够（大招能量、核心资源…）；返回字符串 = 不够及原因。缺省总是够 */
  canAfford?(s: SimState, slot: Slot, def: ActionDef): true | string
  /** TD-08：角色钩子 canStart（形态、层数之类的条件） */
  canStart?(s: SimState, slot: Slot, def: ActionDef): true | string
  /** TD-05：切人之后的事（变奏 / 延奏 / 协奏）。缺省只换前台、启动切人冷却 */
  onSwitch?(s: SimState, k: Kernel, from: Slot, to: Slot, cmd: CommandRef): void
}

/** repeat = 整条轴执行几轮（options.repeat） */
export function newQueue(commands: Command[], repeat = 1): QueueState {
  return { commands, repeat, next: 0, loop: 1, loopBegun: false, waited: 0, readyAt: null, until: null, seg: null }
}

type Verdict = { go: true } | { go: false; code: WaitCode; reason: string }
const GO: Verdict = { go: true }
/** 写轴的人要求的等待：不计入 maxWait */
const INTENDED: WaitCode[] = ['delay', 'wait', 'at']

/** 返回 P2 用的 schedule(s)：执行队首起能执行的指令（一个 tick 可以执行多条），返回"还有没有没执行完的指令" */
export function createScheduler(k: Kernel, actions: Record<ActionId, ActionDef>[], opts: SchedulerOptions): (s: SimState) => boolean {
  return (s: SimState): boolean => {
    const q = s.queue
    if (q.commands.length === 0) return false
    for (;;) {
      if (q.next >= q.commands.length) {
        if (q.loop >= q.repeat) return false
        q.loop += 1
        q.next = 0
        q.loopBegun = false
      }
      const c = q.commands[q.next]!
      const ref: CommandRef = { line: c.line, item: c.item, loop: q.loop }
      const v = evaluate(s, actions, opts, c, ref)
      if (!v.go) { hold(s, opts, v, ref); return true }
      closeSeg(s, ref)
      execute(s, k, actions, opts, c, ref)
      q.next += 1
      q.waited = 0
      q.readyAt = null
      q.until = null
    }
  }
}

/** 队首指令此刻能不能执行（§3.2 的检查顺序）；等不来的直接抛错 */
function evaluate(s: SimState, actions: Record<ActionId, ActionDef>[], opts: SchedulerOptions, c: Command, ref: CommandRef): Verdict {
  const q = s.queue
  switch (c.kind) {
    case 'wait':
      if (q.until === null) { q.until = s.battleFrames + c.frames; if (!roundHasAction(q)) beginLoop(s) }
      return s.battleFrames >= q.until ? GO : { go: false, code: 'wait', reason: `wait ${c.frames}` }
    case 'at':
      if (!roundHasAction(q)) beginLoop(s)
      return s.frame >= c.frame ? GO : { go: false, code: 'at', reason: `等到第 ${c.frame} 帧` }
    case 'switch': {
      if (c.to === s.onField) throw fail(s, 'switchSelf', `${where(q, ref)}：${s.chars[c.to].name} 已经在前台`, ref)
      if (s.switchCd > 0) return { go: false, code: 'switchCd', reason: `切人冷却还剩 ${Math.ceil(s.switchCd)} 帧` }
      // 用 last 而不是 action：锁可以越过结束帧（散华 QTE 结束帧 63，"第70F前不能切人"），与派生窗口一样按局部帧照走（TD-04 §6.2）
      const last = s.chars[s.onField].last
      const lock = last?.def.switchLockUntil
      if (last && lock !== undefined && last.localFrame < lock) return { go: false, code: 'switchLock', reason: `${last.id} 第 ${lock} 帧前不能切人` }
      return GO
    }
    case 'act': {
      const ch = s.chars[c.slot]
      if (c.slot !== s.onField) throw fail(s, 'notOnField', `${where(q, ref)}：${ch.name} 不在前台`, ref)
      const def = actions[c.slot]![c.action]!
      const g = gate(ch, def)
      const onlyStarted = !g.ok && g.code === 'started'               // "本 tick 已开始过动作"放到后面报（§3.2）
      if (!g.ok && !onlyStarted) {
        if (!g.wait) throw fail(s, 'comboBroken', `${where(q, ref)} ${ch.name} ${def.id}：${g.reason}`, ref)
        return { go: false, code: g.code, reason: g.reason }
      }
      const cd = ch.cooldowns[cooldownKey(def)] ?? 0
      if (cd > 0) return { go: false, code: 'cooldown', reason: `${def.id} 冷却还剩 ${Math.ceil(cd)} 帧` }
      const res = opts.canAfford?.(s, c.slot, def) ?? true
      if (res !== true) return { go: false, code: 'resource', reason: res }
      const hook = opts.canStart?.(s, c.slot, def) ?? true
      if (hook !== true) return { go: false, code: 'hook', reason: hook }
      if (!c.force && !settled(s, c.slot))
        return { go: false, code: 'settled', reason: `等 ${ch.action!.id} 出手（现在打断会丢判定或延奏）` }
      if (!g.ok) return { go: false, code: 'started', reason: g.reason }
      if (c.delay > 0) {                                              // +N 从"其余全部满足"的那个 tick 起算
        q.readyAt ??= s.battleFrames
        if (s.battleFrames < q.readyAt + c.delay) return { go: false, code: 'delay', reason: `+${c.delay}` }
      }
      return GO
    }
  }
}

function execute(s: SimState, k: Kernel, actions: Record<ActionId, ActionDef>[], opts: SchedulerOptions, c: Command, ref: CommandRef): void {
  switch (c.kind) {
    case 'wait': case 'at': return                                   // 等完就算执行完
    case 'switch': {
      beginLoop(s)
      const from = s.onField
      s.onField = c.to
      s.switchCd = k.rules.switchCooldown
      log(s, { type: 'switch', from: s.chars[from].name, to: s.chars[c.to].name, intro: false, cmd: ref })
      opts.onSwitch?.(s, k, from, c.to, ref)
      return
    }
    case 'act':
      beginLoop(s)
      startAction(s, k, c.slot, actions[c.slot]![c.action]!, ref)
  }
}

/** 每轮的边界（§3.7）：本轮第一次出招或切人时记一条 loop 事件；整轮只有等待时，记在开始等待时 */
function beginLoop(s: SimState): void {
  if (s.queue.loopBegun) return
  s.queue.loopBegun = true
  log(s, { type: 'loop', loop: s.queue.loop })
}
const roundHasAction = (q: QueueState): boolean => q.commands.some(c => c.kind === 'act' || c.kind === 'switch')

/** 队首要等：原因变了就另起一段；"不合法"的等待累计超过 maxWait 就报错 */
function hold(s: SimState, opts: SchedulerOptions, v: Extract<Verdict, { go: false }>, ref: CommandRef): void {
  const q = s.queue
  if (!q.seg || q.seg.code !== v.code) {
    closeSeg(s, ref)
    q.seg = { code: v.code, reason: v.reason, from: s.frame, battleFrom: s.battleFrames }
  }
  if (INTENDED.includes(v.code)) return
  q.waited += 1
  if (q.waited > opts.maxWait) throw fail(s, 'timeout', `${where(q, ref)}等了 ${opts.maxWait} 帧仍不能执行：${v.reason}`, ref)
}

/** 结束当前等待段，写一条 wait 事件（f = 结束的帧，from = 开始的帧） */
function closeSeg(s: SimState, ref: CommandRef): void {
  const g = s.queue.seg
  if (!g) return
  s.queue.seg = null
  log(s, {
    type: 'wait', cmd: ref, code: g.code, reason: g.reason, from: g.from,
    frames: s.frame - g.from, battleFrames: s.battleFrames - g.battleFrom,
  })
}

/** 报错前先把正在累计的等待段写进日志：停在哪里、等了什么都看得到 */
function fail(s: SimState, code: ScheduleErrorCode, message: string, ref: CommandRef): ScheduleError {
  closeSeg(s, ref)
  return new ScheduleError(code, message, ref, s.frame)
}

/** "第 k 条"；循环中加轮次，一行有几个动作时加"第 i 个" */
function where(q: QueueState, ref: CommandRef): string {
  const many = q.commands.some(c => c.line === ref.line && c.item > 1)
  return `第 ${ref.loop > 1 ? `${ref.loop} 轮第 ` : ''}${ref.line} 条${many ? `第 ${ref.item} 个` : ''}`
}

// ---------------------------------------------------------------------------
// §3.8 主循环

/** 逐 tick 推进到结束。帧数上限时：还有指令没执行 → 报错；只剩判定没结算完 → 停下并记一条警告 */
export function runLoop(s: SimState, k: Kernel, schedule: (s: SimState) => boolean, maxFrames: number): void {
  while (tick(s, k, schedule)) {
    if (s.frame < maxFrames) continue
    const q = s.queue
    if (q.next < q.commands.length || q.loop < q.repeat) {
      const wrap = q.next >= q.commands.length
      const c = q.commands[wrap ? 0 : q.next]!
      const ref: CommandRef = { line: c.line, item: c.item, loop: wrap ? q.loop + 1 : q.loop }
      throw fail(s, 'maxFrames', `超过 ${maxFrames} 帧，${where(q, ref)}还没执行；调大 options.maxFrames`, ref)
    }
    log(s, { type: 'warning', code: 'maxFrames', message: `到达帧数上限 ${maxFrames}，场上还有 ${s.judgments.length} 个判定、${s.tails.length} 条尾部没走完` })
    return
  }
}
