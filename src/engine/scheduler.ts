// src/engine/scheduler.ts —— 排轴的编译与调度（TD-09）
// compileRotation：场景的 rotation 行 → Command[]（总设计 §3.3 第 7 步）；静态能查出来的错一次报全。
// createScheduler：每个 tick 的 P2"执行指令"（TD-04 §1）：按顺序、在最早合法帧执行；能等就等并记下原因，等不来就报错。
import type { ActionId, Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import { parseRotationLine, type Command } from '../data/scenario.schema'
import { cooldownKey, gate, log, settled, startAction, tick, type Kernel } from './kernel'
import type { CommandRef, QueueState, SimState, WaitCode } from './types'

export type ScheduleErrorCode = 'comboBroken' | 'timeout' | 'maxFrames' | 'notOnField' | 'switchSelf' | 'chainDepth' | 'invariant'

/** 运行期报错：等不来（连段已断）、等超时、超过帧数上限、事件连锁过深（TD-07 §5）、不变量不成立（总设计 §11 第 4 条）。cmd 指出第几轮第几条 */
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
export interface CompileIssue { line: number; item?: number; message: string; opening?: true }
export type CompileResult = { ok: true; commands: Command[]; opening: Command[] } | { ok: false; issues: CompileIssue[] }

/** rotation（与可选的启动轴 opening）的每一行 → 指令；line 从 1 起（= 场景里第几条），item 是行内第几个动作。
 *  启动轴只跑一次，前台从 onField 推到它结束时，循环轴从那里开始（§3.7） */
export function compileRotation(lines: string[], team: CompileMember[], onField: Slot, repeat = 1, openingLines: string[] = []): CompileResult {
  const open = compileLines(openingLines, team)
  const rot = compileLines(lines, team)
  const issues = [...open.issues.map(i => ({ ...i, opening: true as const })), ...rot.issues]
  if (rot.issues.length === 0 && rot.commands.length === 0) issues.push({ line: 0, message: '排轴里没有指令' })
  // 有错的那一项已跳过，其余照查；切人写错时前台推不下去，不再查前台，免得连带报一串
  if (!open.switchFailed && !rot.switchFailed) {
    issues.push(...checkOnField(open.commands, team, onField, 1).map(i => ({ ...i, opening: true as const })))
    issues.push(...checkOnField(rot.commands, team, endOnField(open.commands, onField), repeat))
  }
  issues.sort((a, b) => Number(!a.opening) - Number(!b.opening) || a.line - b.line || (a.item ?? 0) - (b.item ?? 0))
  return issues.length > 0 ? { ok: false, issues } : { ok: true, commands: rot.commands, opening: open.commands }
}

/** 补位 "~" 看的那一条：往后跳过同一角色的补位，第一条同一角色的普通动作；遇到切人、等待或别的角色就没有 */
function fillerTarget(list: Command[], i: number): Extract<Command, { kind: 'act' }> | undefined {
  const c = list[i]
  if (c?.kind !== 'act') return undefined
  for (let j = i + 1; j < list.length; j++) {
    const n = list[j]!
    if (n.kind !== 'act' || n.slot !== c.slot) return undefined
    if (!n.filler) return n
  }
  return undefined
}

/** 指令跑完时谁在前台 */
const endOnField = (commands: Command[], onField: Slot): Slot =>
  commands.reduce<Slot>((cur, c) => (c.kind === 'switch' ? c.to : cur), onField)

function compileLines(lines: string[], team: CompileMember[]): { commands: Command[]; issues: CompileIssue[]; switchFailed: boolean } {
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
      commands.push({
        kind: 'act', line, item, slot, action: id, delay: it.delay, force: it.force,
        ...(it.optional ? { optional: true } : {}), ...(it.filler ? { filler: true } : {}),
      })
    })
  })
  // 补位 "~" 后面（隔着同一角色的别的补位）要接同一角色的普通动作：它看的就是那一个（§3.2）
  commands.forEach((c, i) => {
    if (c.kind === 'act' && c.filler && !fillerTarget(commands, i))
      issues.push({ line: c.line, item: c.item, message: `${team[c.slot]!.name} ${c.action}~：补位后面要接同一角色的动作（中间不能有切人、等待）` })
  })
  return { commands, issues, switchFailed }
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
  /** TD-05：切人之后的事（变奏 / 延奏 / 协奏），switch 事件由它记（要先算出是不是变奏切人）。缺省只换前台、启动切人冷却、记 switch */
  onSwitch?(s: SimState, k: Kernel, from: Slot, to: Slot, cmd: CommandRef): void
  /** TD-06 §13.4：要插在队首指令之前的动作（目标失谐时前台角色的谐度破坏）；why 写进等待原因。缺省不插 */
  interject?(s: SimState): { slot: Slot; def: ActionDef; why: string } | null
}

/** repeat = 循环轴执行几轮（options.repeat）；opening = 启动轴，先跑一次，记为第 0 轮（§3.7） */
export function newQueue(commands: Command[], repeat = 1, opening: Command[] = []): QueueState {
  return { commands, opening, repeat, next: 0, loop: opening.length > 0 ? 0 : 1, loopBegun: false, waited: 0, readyAt: null, until: null, seg: null }
}
/** 正在执行的那一段：第 0 轮是启动轴，其余是循环轴 */
const listOf = (q: QueueState): Command[] => (q.loop === 0 ? q.opening : q.commands)

type Verdict = { go: true } | { go: false; code: WaitCode; reason: string }
const GO: Verdict = { go: true }
/** 写轴的人要求的等待：不计入 maxWait */
const INTENDED: WaitCode[] = ['delay', 'wait', 'at']
/** 可选指令遇到这几种"状态条件"不满足时跳过；门（优先级、输入锁、派生）与"等出手"照常等 */
const SKIPPABLE: WaitCode[] = ['cooldown', 'resource', 'hook']

/** 返回 P2 用的 schedule(s)：执行队首起能执行的指令（一个 tick 可以执行多条），返回"还有没有没执行完的指令" */
export function createScheduler(k: Kernel, actions: Record<ActionId, ActionDef>[], opts: SchedulerOptions): (s: SimState) => boolean {
  return (s: SimState): boolean => {
    const q = s.queue
    if (q.commands.length === 0) return false
    for (;;) {
      if (q.next >= listOf(q).length) {
        if (q.loop >= q.repeat) return false
        q.loop += 1
        q.next = 0
        q.loopBegun = false
      }
      const c = listOf(q)[q.next]!
      const ref: CommandRef = { line: c.line, item: c.item, loop: q.loop }
      // 插在队首之前的动作：与出招指令同样的检查（不强制、不延迟）；等的时候记在队首指令名下。开始后不带指令出处，回到循环再看队首。
      // 队首是连段的后续（comboFrom）时先不插：谐度破坏会打断当前角色的动作，插进去连段就断了，等这串连段打完再插
      // （TD-09 §3.2 插队；m0-confirm §10 H1；AGENTS.md 差异 3）
      const ij = c.kind === 'act' && actions[c.slot]![c.action]!.comboFrom?.length ? null : opts.interject?.(s)
      if (ij) {
        const w = evaluateAct(s, opts, ij.slot, ij.def, false, 0, ref)
        if (!w.go) { hold(s, opts, { ...w, reason: `${ij.why}：${w.reason}` }, ref); return true }
        closeSeg(s, ref)
        startAction(s, k, ij.slot, ij.def)
        continue
      }
      // 补位 "~"：后面那个动作的冷却、资源、角色条件都满足了，就不用补这一下（等着出手的时候也每 tick 看一次）
      if (c.kind === 'act' && c.filler) {
        const t = fillerTarget(listOf(q), q.next)
        if (t && stateVerdict(s, opts, t.slot, actions[t.slot]![t.action]!).go) {
          closeSeg(s, ref)
          log(s, { type: 'skip', cmd: ref, code: 'filler', reason: `${t.action} 已经能放，不用补 ${c.action}` })
          q.next += 1
          q.waited = 0
          q.readyAt = null
          q.until = null
          continue
        }
      }
      const v = evaluate(s, actions, opts, c, ref)
      if (!v.go && c.kind === 'act' && c.optional && SKIPPABLE.includes(v.code)) {
        // 可选指令（"?"）：冷却、资源、角色条件不满足就跳过，记一条 skip，接着看下一条（TD-06 §13.4）
        closeSeg(s, ref)
        log(s, { type: 'skip', cmd: ref, code: v.code, reason: v.reason })
        q.next += 1
        q.waited = 0
        q.readyAt = null
        q.until = null
        continue
      }
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
      if (c.slot !== s.onField) throw fail(s, 'notOnField', `${where(q, ref)}：${s.chars[c.slot].name} 不在前台`, ref)
      return evaluateAct(s, opts, c.slot, actions[c.slot]![c.action]!, c.force, c.delay, ref)
    }
  }
}

/** 出招此刻能不能开始（§3.2 的检查顺序，前台已查过）；插队的动作（opts.interject）也走这里 */
function evaluateAct(s: SimState, opts: SchedulerOptions, slot: Slot, def: ActionDef, force: boolean, delay: number, ref: CommandRef): Verdict {
  const q = s.queue
  const ch = s.chars[slot]
  const g = gate(ch, def)
  const onlyStarted = !g.ok && g.code === 'started'                   // "本 tick 已开始过动作"放到后面报（§3.2）
  if (!g.ok && !onlyStarted) {
    if (!g.wait) throw fail(s, 'comboBroken', `${where(q, ref)} ${ch.name} ${def.id}：${g.reason}`, ref)
    return { go: false, code: g.code, reason: g.reason }
  }
  const st = stateVerdict(s, opts, slot, def)
  if (!st.go) return st
  if (!force && !settled(s, slot))
    return { go: false, code: 'settled', reason: `等 ${ch.action!.id} 出手（现在打断会丢判定或延奏）` }
  if (!g.ok) return { go: false, code: 'started', reason: g.reason }
  if (delay > 0) {                                                     // +N 从"其余全部满足"的那个 tick 起算
    q.readyAt ??= s.battleFrames
    if (s.battleFrames < q.readyAt + delay) return { go: false, code: 'delay', reason: `+${delay}` }
  }
  return GO
}

/** 状态条件（第 5–7 条）：冷却、资源、角色钩子。可选 "?" 不满足就跳过；补位 "~" 看后面那个动作满不满足 */
function stateVerdict(s: SimState, opts: SchedulerOptions, slot: Slot, def: ActionDef): Verdict {
  const ch = s.chars[slot]
  const key = cooldownKey(def)
  const cd = ch.cooldowns[key] ?? 0
  if (def.charges !== undefined && def.charges > 1) {                   // 按次数充能：还有次数就能放
    if ((ch.charges[key]?.spent ?? 0) >= def.charges)
      return { go: false, code: 'cooldown', reason: `${def.id} ${def.charges} 次都用掉了，下一次回复还要 ${Math.ceil(cd)} 帧` }
  } else if (cd > 0) {
    const who = def.cooldownGroup ? `${def.id}（与同组共用冷却 ${def.cooldownGroup}）` : def.id
    return { go: false, code: 'cooldown', reason: `${who} 冷却还剩 ${Math.ceil(cd)} 帧` }
  }
  const res = opts.canAfford?.(s, slot, def) ?? true
  if (res !== true) return { go: false, code: 'resource', reason: res }
  const hook = opts.canStart?.(s, slot, def) ?? true
  if (hook !== true) return { go: false, code: 'hook', reason: hook }
  return GO
}

function execute(s: SimState, k: Kernel, actions: Record<ActionId, ActionDef>[], opts: SchedulerOptions, c: Command, ref: CommandRef): void {
  switch (c.kind) {
    case 'wait': case 'at': return                                   // 等完就算执行完
    case 'switch': {
      beginLoop(s)
      const from = s.onField
      s.onField = c.to
      s.switchCd = k.rules.switchCooldown
      if (opts.onSwitch) opts.onSwitch(s, k, from, c.to, ref)
      else log(s, { type: 'switch', from: s.chars[from].name, to: s.chars[c.to].name, intro: false, cmd: ref })
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
const roundHasAction = (q: QueueState): boolean => listOf(q).some(c => c.kind === 'act' || c.kind === 'switch')

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

/** "第 k 条"；启动轴写"启动第 k 条"，循环中加轮次，一行有几个动作时加"第 i 个" */
function where(q: QueueState, ref: CommandRef): string {
  const many = (ref.loop === 0 ? q.opening : q.commands).some(c => c.line === ref.line && c.item > 1)
  const head = ref.loop === 0 ? '启动第 ' : `第 ${ref.loop > 1 ? `${ref.loop} 轮第 ` : ''}`
  return `${head}${ref.line} 条${many ? `第 ${ref.item} 个` : ''}`
}

// ---------------------------------------------------------------------------
// §3.8 主循环

/** 逐 tick 推进到结束。帧数上限时：还有指令没执行 → 报错；只剩判定没结算完 → 停下并记一条警告 */
export function runLoop(s: SimState, k: Kernel, schedule: (s: SimState) => boolean, maxFrames: number): void {
  while (tick(s, k, schedule)) {
    if (s.frame < maxFrames) continue
    const q = s.queue
    if (q.next < listOf(q).length || q.loop < q.repeat) {
      const wrap = q.next >= listOf(q).length
      const c = wrap ? q.commands[0]! : listOf(q)[q.next]!
      const ref: CommandRef = { line: c.line, item: c.item, loop: wrap ? q.loop + 1 : q.loop }
      throw fail(s, 'maxFrames', `超过 ${maxFrames} 帧，${where(q, ref)}还没执行；调大 options.maxFrames`, ref)
    }
    log(s, { type: 'warning', code: 'maxFrames', message: `到达帧数上限 ${maxFrames}，场上还有 ${s.judgments.length} 个判定、${s.tails.length} 条尾部没走完` })
    return
  }
}
