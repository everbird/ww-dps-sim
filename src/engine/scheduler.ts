// src/engine/scheduler.ts —— 运行期调度（TD-09；DD-10 §4① 的编译见 compile.ts）
// createScheduler：每个 tick 的 P2"执行指令"（TD-04 §1）：按顺序、在最早合法帧执行；能等就等并记下原因，等不来就报错。
import type { ActionId, Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import type { Command } from '../data/scenario.schema'
import { assume } from './assumptions'
import { ProbeStop, type CommandVerdict } from './diagnostics'
import { airborne, cooldownKey, gate, log, settled, startAction, tick, type GateResult, type Kernel } from './kernel'
import type { UnmetIntentDetail, StrictReport } from './run-types'
import { floor, roundTo } from './num'
import { ScheduleError, type ScheduleErrorCode } from './types'
import { INTENDED } from './wait-codes'
export { INTENDED, INTENT_WAITS } from './wait-codes'
export { ScheduleError, type ScheduleErrorCode } from './types'
import type { CommandRef, EntryBlock, QueueState, SimState, WaitCode } from './types'

/** 补位 "~" 看的那一条：往后跳过同一角色的补位，第一条同一角色的普通动作，或紧接着的"switch <角色> 变奏"（看切出者的协奏满没满）、
 *  "at <世界秒>"（还没到就接着补）；遇到别的切人、等待或别的角色就没有 */
function fillerTarget(list: Command[], i: number): Extract<Command, { kind: 'act' | 'switch' | 'at' }> | undefined {
  const c = list[i]
  if (c?.kind !== 'act') return undefined
  for (let j = i + 1; j < list.length; j++) {
    const n = list[j]!
    if (n.kind === 'switch' && n.expectIntro) return n
    if (n.kind === 'at') return n
    if (n.kind !== 'act' || n.slot !== c.slot) return undefined
    if (!n.filler) return n
  }
  return undefined
}

// ---------------------------------------------------------------------------
// §3 调度

export interface SchedulerOptions {
  /** DD-10 §3.1：查询检查点的游标可随运行体快照恢复。 */
  progress?: { evalCount: number; headKey: string }
  strict?: boolean
  onIntentUnmet?(s: SimState, detail: UnmetIntentDetail): 'fail' | 'continue'
  introAvailable?(s: SimState, to: Slot): boolean
  onHint?(s: SimState, hint: StrictReport['hints'][number]): void
  maxWait: number                           // 一条指令因"不合法"最多等多少世界帧（options.maxWait）
  /** TD-06：资源够不够（大招能量、核心资源…）；返回字符串 = 不够及原因。缺省总是够 */
  canAfford?(s: SimState, slot: Slot, def: ActionDef): true | string
  /** TD-08：角色钩子 canStart（形态、层数之类的条件） */
  canStart?(s: SimState, slot: Slot, def: ActionDef): true | string
  /** TD-05：切人之后的事（变奏 / 延奏 / 协奏），switch 事件由它记（要先算出是不是变奏切人）。缺省只换前台、启动切人冷却、记 switch */
  onSwitch?(s: SimState, k: Kernel, from: Slot, to: Slot, cmd: CommandRef): void
  /** TD-06 §13.4：要插在队首指令之前的动作（目标失谐时前台角色的谐度破坏）；why 写进等待原因。缺省不插 */
  interject?(s: SimState): { slot: Slot; def: ActionDef; why: string } | null
  /** 轴里写的"敌人 失谐"（录像剖析：谐度破坏打的是仿真没建的小怪）、"敌人 换 <预设>"（下一只敌人出来）。缺省什么也不做 */
  enemyCommand?(s: SimState, c: Extract<Command, { kind: 'enemy' }>): void
  /** 轴里写的"能量满 <角色>"（录像剖析：按钮已经亮了、仿真能量还差一点）。缺省什么也不做 */
  fillCommand?(s: SimState, slot: Slot, resource: 'energy'): void
  /** 操作延迟（总设计 T4）：队首指令第一次全部合法时问一次，再晚这么多帧执行。只加在决策点（切人、不是连段后续的出招），
   *  插队的动作不算。缺省 0。
   *  期望模式是 options.inputDelay；抽样模式在这里加随机抖动——这是调度器里唯一的随机注入点 */
  inputDelay?(s: SimState): number
  /** DD-07 §4.4：每次真实 evaluate 调用之后、hold / execute 之前的检查点（只读）；返回 'stop' 时抛 ProbeStop 停下 */
  afterEvaluate?(s: SimState, c: Command, ref: CommandRef, verdict: NonNullable<CommandVerdict['verdict']>, evaluationIndex: number): void | 'stop'
}

/** repeat = 循环轴执行几轮（options.repeat）；opening = 启动轴，先跑一次，记为第 0 轮（§3.7） */
export function newQueue(commands: Command[], repeat = 1, opening: Command[] = []): QueueState {
  return { commands, opening, repeat, next: 0, loop: opening.length > 0 ? 0 : 1, loopBegun: false, waited: 0, readyAt: null, extra: null, until: null, seg: null }
}
/** 正在执行的那一段：第 0 轮是启动轴，其余是循环轴 */
const STOP_TYPES: readonly string[] = ['时停', '全局时停']
const listOf = (q: QueueState): Command[] => (q.loop === 0 ? q.opening : q.commands)

type Verdict = { go: true } | { go: false; code: WaitCode; reason: string }
const GO: Verdict = { go: true }
/** 可选指令遇到这几种"状态条件"不满足时跳过；门（优先级、输入锁、派生）与"等出手"照常等 */
// entry：写成可选的出场技（A2-地面出场技?），这次是变奏 / 空中 / 后台没走完入场时跳过，不报错（2026-10-26 照录像记的轴：
// 录像里是变奏入场、仿真里协奏差一点没满成了普通切人，或者反过来；按 A 在游戏里也是看入场方式出不同的招）
const SKIPPABLE: WaitCode[] = ['cooldown', 'resource', 'hook', 'entry']

/** 返回 P2 用的 schedule(s)：执行队首起能执行的指令（一个 tick 可以执行多条），返回"还有没有没执行完的指令" */
export function createScheduler(k: Kernel, actions: Record<ActionId, ActionDef>[], opts: SchedulerOptions): (s: SimState) => boolean {
  const progress = opts.progress ?? { evalCount: 0, headKey: '' }
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
      if (k.diag?.opts.commandVerdicts) {
        const key = `${ref.loop}:${ref.line}:${ref.item}`
        if (key !== progress.headKey) {
          progress.headKey = key
          k.diag.commandVerdict({ evaluationIndex: progress.evalCount, f: s.frame, battleFrame: s.battleFrames, cmd: ref, kind: 'head' })
        }
      }
      // 对队首指令的这一轮处理，来源是这条指令（DD-05 §3.2）：算出 ref 之后立刻打开，插队分支写出的 wait 也落在它里面（DF-06）。
      // 每个出口（等、跳过、执行完、插队）各关一次；抛错时留着，由收集器的 finish 收尾
      const sc = k.diag?.open({ kind: 'command', cmd: ref }, s.log.length)
      // 插在队首之前的动作：与出招指令同样的检查（不强制、不延迟）；等的时候记在队首指令名下。开始后不带指令出处，回到循环再看队首。
      // 队首是连段的后续（comboFrom）时先不插：谐度破坏会打断当前角色的动作，插进去连段就断了，等这串连段打完再插
      // （TD-09 §3.2 插队；m0-confirm §10 H1）
      const ij = c.kind === 'act' && actions[c.slot]![c.action]!.comboFrom?.length ? null : opts.interject?.(s)
      if (ij) {
        const w = evaluateAct(s, k, opts, ij.slot, ij.def, false, 0, ref, false)
        if (!w.go) {
          hold(s, k, opts, { ...w, reason: `${ij.why}：${w.reason}` }, ref)
          if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
          return true
        }
        closeSeg(s, ref)
        k.diag?.commandVerdict({
          evaluationIndex: progress.evalCount, f: s.frame, battleFrame: s.battleFrames, cmd: ref, kind: 'interject',
          interject: { slot: ij.slot, action: ij.def.id },
        })
        const ia = k.diag?.open({ kind: 'autoInterject', slot: ij.slot, action: ij.def.id }, s.log.length)
        startAction(s, k, ij.slot, ij.def)
        if (ia !== undefined) k.diag!.close(ia, s.log.length, k.at.phase)
        if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
        continue
      }
      // 补位 "~"：后面那个动作的冷却、资源、角色条件都满足了，或后面是"switch <角色> 变奏"而协奏已经满了，就不用补这一下
      // （等着出手的时候也每 tick 看一次）
      if (c.kind === 'act' && c.filler) {
        const t = fillerTarget(listOf(q), q.next)
        const ready = t?.kind === 'switch' ? s.chars[c.slot].concerto >= k.rules.concertoMax
          : t?.kind === 'at' ? s.frame >= t.frame
          : t !== undefined && stateVerdict(s, opts, t.slot, actions[t.slot]![t.action]!).go
        if (ready) {
          closeSeg(s, ref)
          const why = t!.kind === 'switch' ? `协奏满了，变奏不用补 ${c.action}`
            : t!.kind === 'at' ? `到第 ${t!.frame} 帧了，不用补 ${c.action}` : `${t!.action} 已经能放，不用补 ${c.action}`
          log(s, { type: 'skip', cmd: ref, code: 'filler', reason: why })
          k.diag?.commandVerdict({
            evaluationIndex: progress.evalCount, f: s.frame, battleFrame: s.battleFrames, cmd: ref, kind: 'skip',
            verdict: { go: false, code: 'filler', reason: why },
          })
          q.next += 1
          q.waited = 0
          q.readyAt = null
          q.extra = null
          q.until = null
          if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
          continue
        }
      }
      let v: Verdict
      let lastEvalIdx = progress.evalCount
      if (!k.diag?.opts.commandVerdicts && !opts.afterEvaluate) {
        v = evaluate(s, k, actions, opts, c, ref)
      } else {
        lastEvalIdx = progress.evalCount++
        const force = c.kind === 'act' ? c.force : false
        const delay = c.kind === 'act' ? c.delay : 0
        let caught: unknown = null
        let hasCaught = false
        let verdict: NonNullable<CommandVerdict['verdict']>
        try {
          v = evaluate(s, k, actions, opts, c, ref)
          verdict = v.go ? { go: true } : { go: false, code: v.code, reason: v.reason }
        } catch (err) {
          caught = err
          hasCaught = true
          if (err instanceof ScheduleError) verdict = { threw: err.code }
          else throw err
        }
        const context = { readyAt: q.readyAt, extra: q.extra, until: q.until, waited: q.waited, force, delay }
        k.diag?.commandVerdict({
          evaluationIndex: lastEvalIdx, f: s.frame, battleFrame: s.battleFrames, cmd: ref, kind: 'evaluate', verdict, context,
        })
        if (opts.afterEvaluate?.(s, c, ref, verdict, lastEvalIdx) === 'stop') throw new ProbeStop(s.frame, lastEvalIdx)
        if (hasCaught) throw caught
      }
      if (!v!.go && c.kind === 'act' && c.optional && SKIPPABLE.includes(v!.code)) {
        // 可选指令（"?"）：冷却、资源、角色条件不满足就跳过，记一条 skip，接着看下一条（TD-06 §13.4）
        closeSeg(s, ref)
        log(s, { type: 'skip', cmd: ref, code: v!.code, reason: v!.reason })
        k.diag?.commandVerdict({
          evaluationIndex: lastEvalIdx, f: s.frame, battleFrame: s.battleFrames, cmd: ref, kind: 'skip',
          verdict: { go: false, code: v!.code, reason: v!.reason },
        })
        q.next += 1
        q.waited = 0
        q.readyAt = null
        q.extra = null
        q.until = null
        if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
        continue
      }
      if (!v!.go) {
        hold(s, k, opts, v!, ref)
        if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
        return true
      }
      closeSeg(s, ref)
      execute(s, k, actions, opts, c, ref)
      k.diag?.commandVerdict({ evaluationIndex: lastEvalIdx, f: s.frame, battleFrame: s.battleFrames, cmd: ref, kind: 'execute' })
      q.next += 1
      q.waited = 0
      q.readyAt = null
      q.extra = null
      q.until = null
      if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
    }
  }
}

/** 队首指令此刻能不能执行（§3.2 的检查顺序）；等不来的直接抛错 */
function evaluate(s: SimState, k: Kernel, actions: Record<ActionId, ActionDef>[], opts: SchedulerOptions, c: Command, ref: CommandRef): Verdict {
  const q = s.queue
  switch (c.kind) {
    case 'wait':
      if (q.until === null) { q.until = s.battleFrames + c.frames; if (!roundHasAction(q)) beginLoop(s) }
      return s.battleFrames >= q.until ? GO : { go: false, code: 'wait', reason: `wait ${c.frames}` }
    case 'at':
      if (!roundHasAction(q)) beginLoop(s)
      return s.frame >= c.frame ? GO : { go: false, code: 'at', reason: `等到第 ${c.frame} 帧` }
    case 'enemy': case 'fill':
      return GO
    case 'switch': {
      if (c.to === s.onField) throw fail(s, k, 'switchSelf', `${where(q, ref)}：${s.chars[c.to].name} 已经在前台`, ref)
      // 切人冷却每人单独计：被切走的人一段时间内不能再切回来（2026-10-25 用户确认；视频 A 里尤诺 → 景燃 → 守岸人两次切人只隔约 18 帧）
      const back = s.chars[c.to].switchCd
      if (back > 0) return { go: false, code: 'switchCd', reason: `${s.chars[c.to].name} 的切人冷却还剩 ${Math.ceil(back)} 帧` }
      // 用 last 而不是 action：锁可以越过结束帧（散华 QTE 结束帧 63，"第70F前不能切人"），与派生窗口一样按局部帧照走（TD-04 §6.2）
      const last = s.chars[s.onField].last
      // 全局时停（大招动画、隐藏 HUD）期间切不了人：物理上按不了（2026-10-22，WuwaLAB 的大招都只记 time_stop、no_swap 为 0）。
      // 例外：写了"第 n 帧前不能切人"、比全局时停早的（守岸人大招 178 / 207），过了那一帧就能切，切人时剩下的时停结束
      // （execute；2026-10-25 视频 A 逐帧量，假设 switch-ends-stop）
      const stop = last?.def.globalStopUntil
      const written = last?.def.switchLockUntil !== undefined && !last.def.switchLockFromInput && !last.def.switchLockFromInvincible
      const early = k.rules.switchEndsStop && written && stop !== undefined && last!.def.switchLockUntil! < stop && last!.localFrame >= last!.def.switchLockUntil!
      // 规则使用（DD-05 §4.1）：过了写明的锁、还在全局时停里，switchEndsStop 才决定放不放行
      k.rule.note('sched.switch.switchEndsStop', k.rules.switchEndsStop, written && stop !== undefined
        && last!.def.switchLockUntil! < stop && last!.localFrame >= last!.def.switchLockUntil! && last!.localFrame < stop)
      if (last && stop !== undefined && last.localFrame < stop && !early) return { go: false, code: 'globalStop', reason: `${last.id} 全局时停到第 ${stop} 帧（动画中切不了人）` }
      // 写了"变奏"、切出者协奏还没满、手上的动作还有判定没出手：等它出手再切——这几下的协奏可能正好补满
      // （TD-09 §3.5；2026-10-25 景尤守 5R18Z 补位的普攻、爱琳莫琳奈视觉冲击的落地段：不等的话同一 tick 就切走，这几下白打）
      if (c.expectIntro && s.chars[s.onField].concerto < k.rules.concertoMax && !settled(s, s.onField))
        return { go: false, code: 'concertoSettle', reason: `等 ${s.chars[s.onField].action!.id} 出手（变奏要协奏满）` }
      const lock = last?.def.switchLockUntil
      // 推断出来的锁可以在场景里关掉，量假设的敏感度（options.rules.ultInputLocksSwitch / invincibleLocksSwitch）
      const off = last && ((last.def.switchLockFromInput && !k.rules.ultInputLocksSwitch) || (last.def.switchLockFromInvincible && !k.rules.invincibleLocksSwitch))
      // 规则使用（DD-05 §4.1）：照上一行的求值顺序记读取；局部帧还在锁内时，换个读法就会走另一条分支
      const inLock = lock !== undefined && last!.localFrame < lock
      if (last?.def.switchLockFromInput) k.rule.note('sched.switch.ultInputLock', k.rules.ultInputLocksSwitch, inLock)
      if (last?.def.switchLockFromInvincible && !(last.def.switchLockFromInput && !k.rules.ultInputLocksSwitch))
        k.rule.note('sched.switch.invincibleLock', k.rules.invincibleLocksSwitch, inLock)
      if (last && lock !== undefined && last.localFrame < lock && !off) {
        if (!last.def.switchLockFromInput) return { go: false, code: 'switchLock', reason: `${last.id} 第 ${lock} 帧前不能切人` }
        // 大招没写"不能切人"，按"不响应输入"挡（假设 ult-no-switch）：每段等待记一次
        if (q.seg?.code !== 'switchLock') assume(s, 'ult-no-switch', `${s.chars[s.onField].name}·${last.id}（第 ${lock} 帧）`)
        return { go: false, code: 'switchLock', reason: `${last.id} 第 ${lock} 帧前不响应输入（按不能切人算）` }
      }
      // 切进来的第一下是一开始就在空中的攻击（卜灵"空中攻击"；跳跃本身不算）：切出者要在空中，切进来的才在空中（TD-09 §3.5，
      // 用户 2026-10-21：雷主 E 跳起时切卜灵，空中 A 攒蓝符）。切出者这个动作稍后会离地的就等，不会的报错
      const list = listOf(q)
      const nxt = list[q.next + 1] ?? (q.loop > 0 || q.commands.length ? q.commands[0] : undefined)
      const first = nxt?.kind === 'act' && nxt.slot === c.to ? actions[c.to]![nxt.action]! : null
      if (first?.air?.from === 0 && (first.kind === 'normal' || first.kind === 'heavy') && !airborne(s, s.onField)) {
        const cur = s.chars[s.onField].action
        const up = cur && !cur.ended ? cur.def.air : undefined
        if (up && cur!.localFrame < up.from) return { go: false, code: 'airborne', reason: `等 ${cur!.id} 跳起（第 ${up.from} 帧），${s.chars[c.to].name} 切进来才在空中` }
        throw intentFail(s, k, opts, 'airEntry', `${where(q, ref)}：${s.chars[c.to].name} 第一下是空中动作 ${first.id}，可 ${s.chars[s.onField].name} 在地面，切进来也在地面`, ref)
      }
      // 切人后第一下是地面出场技：切进来的人自己在后台的动作要走完才算出场技入场（TD-09 §3.5 的 busy）。会走完的，切人等它
      // （2026-10-25 景莫守：景燃 A4 脱手退场后不久切回来打出场技阳A2，BV1VJYL6HEuQ）
      const busy = s.chars[c.to].action
      if (first?.entrySkill && busy && !busy.ended)
        return { go: false, code: 'entryBusy', reason: `等 ${s.chars[c.to].name} 在后台的 ${busy.id} 走完，切进来才是出场技` }
      return afterInput(s, k, opts, 0)
    }
    case 'act': {
      if (c.slot !== s.onField) throw fail(s, k, 'notOnField', `${where(q, ref)}：${s.chars[c.slot].name} 不在前台`, ref)
      // 操作延迟只加在"决策点"：连段的后续（有 comboFrom 的动作，如 A2–A5）玩家会预输入，不加（假设 no-input-buffer）
      const def = actions[c.slot]![c.action]!
      // 有出场技的角色，地面普通切人入场后第一下 A（A1）就是出场技（用户确认，TD-09 §3.5）：轴里要写出场技，写 A1 报错
      const entry = def.id === 'A1' && s.entry?.slot === c.slot && s.entry.block === null
        ? Object.values(actions[c.slot]!).find(a => a.entrySkill) : undefined
      if (entry) throw intentFail(s, k, opts, 'entrySkill', `${where(q, ref)} ${s.chars[c.slot].name} A1：普通切人入场后第一下 A 是出场技（写 ${entry.id}）`, ref)
      if (c.optional && def.entrySkill && !(s.entry?.slot === c.slot && s.entry.block === null))
        return { go: false, code: 'entry', reason: `${def.id} 是出场技，${entryWhy(s, c.slot)}` }
      return evaluateAct(s, k, opts, c.slot, def, c.force, c.delay, ref, !def.comboFrom?.length)
    }
  }
}

/** 出招此刻能不能开始（§3.2 的检查顺序，前台已查过）；插队的动作（opts.interject）也走这里，input = false：不加操作延迟 */
function evaluateAct(
  s: SimState, k: Kernel, opts: SchedulerOptions, slot: Slot, def: ActionDef, force: boolean, delay: number, ref: CommandRef, input: boolean,
): Verdict {
  const q = s.queue
  const ch = s.chars[slot]
  // 出场技只在普通切人入场后第一个出（用户确认，m0-confirm §11 V10）；不满足就再也等不来，同连段中断直接报错
  if (def.entrySkill && !(s.entry?.slot === slot && s.entry.block === null))
    throw intentFail(s, k, opts, 'entrySkill', `${where(q, ref)} ${ch.name} ${def.id}：出场技要从地面普通切人入场后第一个出（${entryWhy(s, slot)}）`, ref)
  const g = gate(ch, def, k.rules.echoInputPriority)
  // 规则使用（DD-05 §4.1）：换个读法 gate 的结果不同才算决定了分支（gate 是纯函数；没有起手优先级的动作两种读法总是相同，不用再算）
  k.rule.note('sched.act.echoInputPriority', k.rules.echoInputPriority, def.inputPriority !== undefined && !sameGate(g, gate(ch, def, !k.rules.echoInputPriority)))
  const onlyStarted = !g.ok && g.code === 'started'                   // "本 tick 已开始过动作"放到后面报（§3.2）
  if (!g.ok && !onlyStarted) {
    if (!g.wait) throw fail(s, k, 'comboBroken', `${where(q, ref)} ${ch.name} ${def.id}：${g.reason}`, ref)
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
  const v = input ? afterInput(s, k, opts, delay) : GO
  if (v.go && g.via === 'echoInput')
    assume(s, 'echo-input-priority', `${ch.name} ${def.id} 打断 ${ch.action!.id}（第 ${floor(ch.action!.localFrame)} 帧）`)
  return v
}

const ENTRY_WHY: Record<EntryBlock, string> = {
  intro: '这次是变奏入场', acted: '入场后已经出过招', busy: '切回来时自己在后台的动作还没走完', air: '切出的角色在空中，切进来也在空中',
}
/** 出场技放不出的原因（SimState.entry） */
function entryWhy(s: SimState, slot: Slot): string {
  const e = s.entry
  if (e?.slot !== slot) return '开场就在前台，不是切人入场'
  return ENTRY_WHY[e.block!]
}

/** gate 的两个结果是不是同一条分支（同样放行、同样的途径；或同样挡住、同样的原因代码） */
const sameGate = (a: GateResult, b: GateResult): boolean =>
  a.ok ? b.ok && a.via === b.via : !b.ok && a.code === b.code

/** 操作延迟（options.inputDelay；抽样模式另加抖动）：其余全部满足后（+N 之后）再等这么多帧。每条指令只问一次 */
function afterInput(s: SimState, k: Kernel, opts: SchedulerOptions, delay: number): Verdict {
  const q = s.queue
  const extra = (q.extra ??= opts.inputDelay?.(s) ?? 0)
  k.rule.note('sched.input.delay', extra, extra > 0)              // 规则使用（DD-05 §4.1）：取到的延迟（已经算好的，不再问一次）
  if (extra <= 0) return GO
  q.readyAt ??= s.battleFrames
  return s.battleFrames < q.readyAt + delay + extra ? { go: false, code: 'input', reason: `操作延迟 ${extra} 帧` } : GO
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
    case 'enemy': opts.enemyCommand?.(s, c); return                  // 敌人 失谐 / 换（录像剖析）：改敌人状态由 simulate 做
    case 'fill': opts.fillCommand?.(s, c.slot, c.resource); return    // 能量满（录像剖析）：同上
    case 'switch': {
      // DD-02 §3.3：最终放行后、任何切人状态修改之前核对意图。
      if (opts.strict && c.expectIntro) {
        const ch = s.chars[s.onField]
        const short = ch.concerto < k.rules.concertoMax
        if (short || opts.introAvailable?.(s, c.to) === false) {
          const d: UnmetIntentDetail = { kind: 'introMissed', cmd: ref,
            expected: short ? `切出者协奏 ≥ ${k.rules.concertoMax}` : '有变奏动作',
            actual: short ? `${ch.name} 协奏 ${roundTo(ch.concerto, 100)}` : `${s.chars[c.to].name} 没有变奏动作` }
          if (opts.onIntentUnmet?.(s, d) !== 'continue') {
            const e = fail(s, k, 'intentUnmet', d.actual, ref); e.intent = d; throw e
          }
        }
      }
      beginLoop(s)
      const from = s.onField
      // 写了"变奏"（switch <角色> 变奏）而切出者协奏没满：照常普通切人，记一条警告——轴这里可能有问题（TD-09 §3.5）
      const short = c.expectIntro && s.chars[from].concerto < k.rules.concertoMax ? s.chars[from].concerto : null
      // 切出者登记的时停、全局时停还没走完的，随切人结束（守岸人大招 178 帧切人、全局时停到 207：剩下的不再冻住切进来的人和战斗时钟；
      // 中间可能接了补位的普攻，所以按切出者而不是按最近一个动作找；假设 switch-ends-stop）
      const stops = s.dilations.filter(d => d.source === from && STOP_TYPES.includes(d.type))
      k.rule.note('sched.execute.switchEndsStop', k.rules.switchEndsStop, stops.length > 0)   // 规则使用（DD-05 §4.1）
      if (k.rules.switchEndsStop && stops.length) {
        assume(s, 'switch-ends-stop', `${s.chars[from].name} 切人时还剩 ${Math.max(...stops.map(d => d.remaining))} 帧时停`)
        s.dilations = s.dilations.filter(d => !stops.includes(d))
      }
      s.onField = c.to
      s.chars[from].switchCd = k.rules.switchCooldown
      // 出场技要地面普通切入（TD-09 §3.5）：切入者自己在后台的动作要走完、切出者要在地面（切入者出现在切出者的位置）；
      // 变奏切人时 onSwitch 随即开始变奏动作，记成 intro
      const back = s.chars[c.to].action
      s.entry = { slot: c.to, block: back && !back.ended ? 'busy' : airborne(s, from) ? 'air' : null }
      if (opts.onSwitch) opts.onSwitch(s, k, from, c.to, ref)
      else log(s, { type: 'switch', from: s.chars[from].name, to: s.chars[c.to].name, intro: false, cmd: ref })
      if (short !== null) {
        const a = s.chars[from].name, b = s.chars[c.to].name
        log(s, {
          type: 'warning', code: 'introMissed', line: c.line, cmd: ref,
          message: `${where(s.queue, ref)} switch ${b} 变奏：${a} 协奏 ${roundTo(short, 100)}，没满 ${k.rules.concertoMax}，这次是普通切人（${a} 的延奏没出，${b} 没有变奏），轴这里可能有问题`,
        })
      }
      return
    }
    case 'act':
      if (c.force) {
        const a = s.chars[c.slot].action
        const code = !a || a.ended ? 'forceNoCancel' : settled(s, c.slot) ? 'forceNoEffect' : null
        if (code) opts.onHint?.(s, { code, cmd: ref, message: code === 'forceNoCancel' ? '前一个动作已经结束，没有发生取消' : '不写 ! 也是这一帧，没有判定可丢' })
      }
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
function hold(s: SimState, k: Kernel, opts: SchedulerOptions, v: Extract<Verdict, { go: false }>, ref: CommandRef): void {
  const q = s.queue
  if (!q.seg || q.seg.code !== v.code) {
    closeSeg(s, ref)
    q.seg = { code: v.code, reason: v.reason, from: s.frame, battleFrom: s.battleFrames }
  }
  if (INTENDED.includes(v.code)) return
  q.waited += 1
  if (q.waited > opts.maxWait) {
    const blocked = { code: v.code, reason: v.reason, sinceFrame: q.seg.from }
    const e = fail(s, k, 'timeout', `${where(q, ref)}等了 ${opts.maxWait} 帧仍不能执行：${v.reason}`, ref)
    e.blocked = blocked; throw e
  }
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
  // 默认等出手（假设 wait-settled）：写 ! 可以抢帧
  if (g.code === 'settled') assume(s, 'wait-settled', `${where(s.queue, ref)}：${g.reason}，${s.frame - g.from} 帧`)
}

/** 报错前先把正在累计的等待段写进日志：停在哪里、等了什么都看得到。这条 wait 的来源是失败收尾（DD-05 §3.2 的 finalization） */
function fail(s: SimState, k: Kernel, code: ScheduleErrorCode, message: string, ref: CommandRef): ScheduleError {
  const sc = k.diag?.open({ kind: 'finalization', step: 'failClose' }, s.log.length)
  closeSeg(s, ref)
  if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
  return new ScheduleError(code, message, ref, s.frame, true)
}

/** "第 k 条"；启动轴写"启动第 k 条"，循环中加轮次，一行有几个动作时加"第 i 个" */
function where(q: QueueState, ref: CommandRef): string {
  const many = (ref.loop === 0 ? q.opening : q.commands).some(c => c.line === ref.line && c.item > 1)
  const head = ref.loop === 0 ? '启动第 ' : `第 ${ref.loop > 1 ? `${ref.loop} 轮第 ` : ''}`
  return `${head}${ref.line} 条${many ? `第 ${ref.item} 个` : ''}`
}

// ---------------------------------------------------------------------------
// §3.8 主循环

/** 逐 tick 推进到结束，返回循环怎么退出的（DD-01 §3.5）：'idle' = 无事可做（tick 在 P2 返回 false，这个 tick 不计入）；
 *  'maxFramesInFlight' = 到帧数上限、指令已发完，只剩在途的动作 / 判定 / 尾部，记一条警告后停下。
 *  到帧数上限、还有指令没执行 → 照旧报错（maxFrames）。
 *  afterTick：边界观察点（DD-05 §6.1），每个 tick 走完 P7 之后、检查帧数上限之前调，这时是 S[s.frame]；返回 'stop' 就抛 ProbeStop 停下
 *  （不经 fail、不做失败收尾）。在帧数上限之前调，S[maxFrames] 才取得到 */
export function runLoop(
  s: SimState, k: Kernel, schedule: (s: SimState) => boolean, maxFrames: number, afterTick?: (s: SimState) => 'stop' | void, resumeBoundary = false,
): 'idle' | 'maxFramesInFlight' {
  const atLimit = (): 'maxFramesInFlight' | null => {
    if (s.frame < maxFrames) return null
    const q = s.queue
    if (q.next < listOf(q).length || q.loop < q.repeat) {
      const wrap = q.next >= listOf(q).length
      const c = wrap ? q.commands[0]! : listOf(q)[q.next]!
      const ref: CommandRef = { line: c.line, item: c.item, loop: wrap ? q.loop + 1 : q.loop }
      throw fail(s, k, 'maxFrames', `超过 ${maxFrames} 帧，${where(q, ref)}还没执行；调大 options.maxFrames`, ref)
    }
    const sc = k.diag?.open({ kind: 'finalization', step: 'maxFramesWarning' }, s.log.length)
    log(s, { type: 'warning', code: 'maxFrames', message: `到达帧数上限 ${maxFrames}，场上还有 ${s.judgments.length} 个判定、${s.tails.length} 条尾部没走完` })
    if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
    return 'maxFramesInFlight'
  }
  // DD-10 §3.2：快照在 afterTick 处取得，恢复时先补做原边界的上限检查。
  if (resumeBoundary) {
    const limit = atLimit()
    if (limit) return limit
  }
  while (tick(s, k, schedule)) {
    if (afterTick?.(s) === 'stop') throw new ProbeStop(s.frame)
    const limit = atLimit()
    if (limit) return limit
  }
  return 'idle'
}

// DD-02 §3.3：没有可续跑语义的入场意图直接失败。
function intentFail(s: SimState, k: Kernel, opts: SchedulerOptions, kind: 'airEntry' | 'entrySkill', message: string, ref: CommandRef): ScheduleError {
  const e = fail(s, k, opts.strict ? 'intentUnmet' : kind, message, ref)
  if (opts.strict) e.intent = { kind, cmd: ref, expected: kind === 'airEntry' ? '空中入场' : '普通切人后第一个出场技', actual: message }
  return e
}
