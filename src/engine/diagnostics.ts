// src/engine/diagnostics.ts —— 诊断旁路（DD-05 §3、§4；架构 §3.3、§4）。①D 查询与诊断。
// DiagSink：一个只写不读的收集器，一次运行一个实例，诊断全关时不创建。引擎的业务逻辑不看它：没有任何读回给引擎的方法。
// 插桩处一律写成 k.diag?.方法(…)，诊断关着时实参都不求值。写法约束（零干扰靠它们保证，DD-05 §3.1）：
//   1. 返回值不参与任何业务判断（open 返回的作用域号只用来配对 close）；
//   2. 实参里不调用有副作用的函数，要读的值先由业务代码算好，或者只调纯函数；
//   3. 不拿 SimState 的可写引用去改，要留的值当场拷贝成数字或字符串；
//   4. 不消耗 s.nextId、不碰 s.rng、不写 s.assumed、不写日志；
//   5. 诊断开着时不多调任何钩子，也不改变调用钩子的次数与顺序。
// 事件的直接来源不在 log() 里当场标，而是用作用域回填（DD05-Q2）：作用域打开时记下日志长度，关闭时把这期间新写的、还没有来源的事件
// 都标成它的来源；内层先关，内层的事件归内层。不用 try / finally（DD05-Q3）：抛错时作用域留着，finish 从内到外统一收尾。
// RuleCounter：规则使用的计数（必有的 ruleUsage，DD-05 §4.2），不随诊断开关变；逐次明细（ruleTrace）只在诊断开着时由收集器另记。
import type { ActionId, Frame, Slot } from '../data/common'
import { RULE_POINTS, type RulePointId } from './rule-points'
import type { RuleUsageReport, TickPhase } from './run-types'
import type { CommandRef, SimEvent, SimState } from './types'

// ---------------------------------------------------------------------------
// 类型（架构 §3.3；总览 §6 的 S-05、S-08、S-12）

/** 事件写在哪个相位（DD-05 §3.2）：tick 的相位照 Kernel.at.phase；'afterP7' 与循环退出后的收尾记 'post'，初始化记 'init'。
 *  P1（computeRates）不写事件，列出来只为与 TickPhase 对齐 */
export type EventPhase = 'init' | 'P1' | 'P2' | 'P3' | 'P4' | 'P6' | 'post'

/** 写它的那个作用域：谁发起的。timeline 的 nodeIndex 是节点在 timelineOf(def) 里的下标；尾部（动作结束 / 取消后留下的，
 *  延奏与召唤类声骸的独立时间线）的节点带 detached: true，actionInstance 是尾部的实例号 */
export type OriginContext =
  | { readonly kind: 'init'; readonly sourceId: string }
  | { readonly kind: 'command'; readonly cmd: CommandRef }
  | { readonly kind: 'autoInterject'; readonly slot: Slot; readonly action: ActionId }
  | { readonly kind: 'actionLifecycle'; readonly actionInstance: number }
  | { readonly kind: 'timeline'; readonly actionInstance: number; readonly nodeIndex: number; readonly detached?: boolean }
  | { readonly kind: 'judgmentSettle'; readonly judgmentId: number }
  | { readonly kind: 'judgmentExpire'; readonly judgmentId: number }
  | { readonly kind: 'timer'; readonly timerKind: 'buff' | 'effectTick' | 'enemy'; readonly id?: number; readonly defId?: string }
  | {
    readonly kind: 'trigger'; readonly directParentSeq: number
    readonly handlerKind: 'consume' | 'buffTrigger' | 'buffExtend' | 'resourceEffect' | 'charHook'; readonly handlerId: string
  }
  | { readonly kind: 'finalization'; readonly step: 'failClose' | 'maxFramesWarning' }   // 循环退出时写的 wait、帧数上限的警告（S-05）
  | { readonly kind: 'unattributed' }                                                  // 没有落在任何作用域里：出现了就是插桩有漏

/** diag.eventMeta[seq]，与日志下标一一对应（DD-05 §3.3）。两种关系分开记（DF-06）：
 *  directParentSeq = 谁直接引出了它（因果）；subjectSeq = 它说的那个实体（动作实例、判定、buff 实例、尾部）是哪条事件创建的。
 *  scope：回填它的那个作用域的编号，同一作用域里写的事件相同；不对外承诺别的含义（S-08，DD-07 按它挂规则明细） */
export interface EventMeta {
  readonly phase: EventPhase
  readonly origin: OriginContext
  readonly directParentSeq?: number
  readonly subjectSeq?: number
  readonly scope?: number
}

/** 延迟实体（判定、尾部）的来源（DD-05 §3.3）：跨 tick 保留在诊断里，运行时的 JudgmentRuntime、TailRuntime 不加字段 */
export interface EntityOrigin {
  readonly id: number                  // 判定是 JudgmentRuntime.id；尾部是 TailRuntime.instance
  readonly createdAtFrame: Frame
  readonly createdBySeq: number | null // 生成它的那条事件，必须是已经写出的：判定是它的 judgmentSpawn；尾部是 actionEnd / actionCancel / 召唤的 actionStart / outro
  readonly origin: OriginContext       // 生成那一刻所在的作用域
}

/** 规则使用的逐次明细（DD-05 §4.2）：同一次 note 在 ruleUsage 里计一次读取，这里另追加一条 */
export interface RuleTraceEntry {
  readonly point: RulePointId
  readonly propositionId: string
  readonly f: Frame
  readonly battleFrame: number
  readonly phase: EventPhase
  readonly afterEventSeq: number            // 这一刻日志里最后一条的下标；还没有事件时是 -1
  readonly value: number | boolean | string
  readonly decisive: boolean
  readonly scope?: number                   // 这一刻所在的作用域（同 EventMeta.scope）
}

/** 可选诊断的开关（DD-05 §3.1）。观察选项，不进运行身份。resourceLedger 由 DD-06 做，hitInputs、hitMargins、commandVerdicts 由 DD-07 做，
 *  现在给了也不产出记录 */
export interface DiagOptions {
  readonly eventMeta?: boolean
  readonly resourceLedger?: boolean
  readonly ruleTrace?: boolean
  readonly hitInputs?: boolean
  readonly hitMargins?: boolean
  readonly commandVerdicts?: boolean
}

/** 可选诊断的产出（SimResult.diag）。eventMeta 与 entityOrigins 一起给（开了 eventMeta）；ruleTrace 开了才有 */
export interface Diagnostics {
  readonly eventMeta?: readonly EventMeta[]
  readonly entityOrigins?: { readonly judgments: readonly EntityOrigin[]; readonly tails: readonly EntityOrigin[] }
  readonly ruleTrace?: readonly RuleTraceEntry[]
}

/** 全部诊断都开（零干扰对拍用，DD-05 §6） */
export const ALL_DIAG: DiagOptions = { eventMeta: true, resourceLedger: true, ruleTrace: true, hitInputs: true, hitMargins: true, commandVerdicts: true }
export const anyDiag = (o: DiagOptions | undefined): boolean => o !== undefined && Object.values(o).some(v => v === true)

const UNATTRIBUTED: OriginContext = { kind: 'unattributed' }

// ---------------------------------------------------------------------------
// 收集器

interface Scope {
  readonly id: number
  readonly origin: OriginContext
  readonly start: number                    // 打开时的日志长度
  readonly parentSeq: number | undefined    // 回填的事件的直接父事件：trigger 的是正在处理的那条，onSwitch 里的是那条 switch
}
interface Filled { phase: EventPhase; origin: OriginContext; parent: number | undefined; scope: number | undefined }

export class DiagSink {
  readonly opts: DiagOptions
  private readonly stack: Scope[] = []
  private nextScope = 1
  private readonly filled: (Filled | undefined)[] = []      // 下标 = 日志下标
  private readonly tails: EntityOrigin[] = []
  private readonly trace: RuleTraceEntry[] = []
  private post = false
  private done: Diagnostics | null = null

  constructor(opts: DiagOptions) { this.opts = opts }

  /** 打开一个作用域，返回作用域号（只用来配对 close）。parentSeq：这个作用域回填的事件的直接父事件（onSwitch 里写完 switch 之后的那段，DF-06） */
  open(origin: OriginContext, logLength: number, parentSeq?: number): number {
    const id = this.nextScope++
    this.stack.push({ id, origin, start: logLength, parentSeq: origin.kind === 'trigger' ? origin.directParentSeq : parentSeq })
    return id
  }

  /** 关掉作用域：回填 [打开时的长度, logLength) 里还没标的。内层没关的（不该有）一并按从内到外关掉 */
  close(scope: number, logLength: number, phase: TickPhase): void {
    while (this.stack.length > 0) {
      const top = this.stack.pop()!
      this.fill(top, logLength, phase)
      if (top.id === scope) return
    }
  }

  /** 尾部的来源（DD-05 §3.3）：在 4 个生成点写完创建事件之后登记；origin 是这一刻所在的作用域 */
  tailCreated(instance: number, createdBySeq: number, frame: Frame): void {
    const top = this.stack[this.stack.length - 1]
    this.tails.push({ id: instance, createdAtFrame: frame, createdBySeq, origin: top ? top.origin : UNATTRIBUTED })
  }

  /** 规则使用的逐次明细（RuleCounter 在 ruleTrace 开着时调）：值都是调用方当场取的数 */
  ruleNoted(
    point: RulePointId, propositionId: string, value: number | boolean | string, decisive: boolean,
    f: Frame, battleFrame: number, afterEventSeq: number, phase: TickPhase,
  ): void {
    if (!this.opts.ruleTrace) return
    const top = this.stack[this.stack.length - 1]
    this.trace.push({ point, propositionId, f, battleFrame, phase: this.phaseOf(phase), afterEventSeq, value, decisive, ...(top ? { scope: top.id } : {}) })
  }

  /** 循环已经退出：之后（收尾的 drain）写的事件记 'post'。k.at.phase 在空闲退出时停在 P2，靠它区分 */
  markPost(): void { this.post = true }

  /** 运行结束（含出错、截断）：没关的作用域按从内到外关掉，剩下没标的记 unattributed；扫一遍日志建实体映射，补 subjectSeq。
   *  phase：结束时的相位（抛错时没关的作用域都包着抛错的那一点，它们都在这个相位里） */
  finish(log: readonly SimEvent[], phase: TickPhase): void {
    if (this.done) return
    while (this.stack.length > 0) this.fill(this.stack.pop()!, log.length, phase)
    const want = this.opts.eventMeta === true
    this.done = {
      ...(want ? this.origins(log, phase) : {}),
      ...(this.opts.ruleTrace ? { ruleTrace: this.trace } : {}),
    }
  }

  /** finish 之后的产出 */
  result(): Diagnostics {
    if (!this.done) throw new Error('DiagSink：先 finish 再取结果')
    return this.done
  }

  private phaseOf(phase: TickPhase): EventPhase {
    return this.post || phase === 'afterP7' ? 'post' : phase
  }

  private fill(sc: Scope, end: number, phase: TickPhase): void {
    const p = this.phaseOf(phase)
    for (let i = sc.start; i < end; i++) {
      if (this.filled[i] !== undefined) continue
      this.filled[i] = { phase: p, origin: sc.origin, parent: sc.parentSeq, scope: sc.id }
    }
  }

  /** eventMeta 与实体来源表。subjectSeq 先按事件种类（动作结束 / 取消 → 那个实例的 actionStart；buff 到期、再施加 → 那个实例的第一条
   *  buffApply；判定结算 → 它的 judgmentSpawn），种类没说的再按作用域（判定的结算 / 到期 → 它的 judgmentSpawn；进行中动作的时间线 →
   *  它的 actionStart；尾部的时间线 → 尾部来源表里记的创建事件；动作生命周期 → 它的 actionStart，没有的是延奏的尾部）；只认更早写的事件 */
  private origins(log: readonly SimEvent[], phase: TickPhase): Pick<Diagnostics, 'eventMeta' | 'entityOrigins'> {
    const p = this.phaseOf(phase)
    const startOf = new Map<number, number>()       // 动作实例 → actionStart
    const spawnOf = new Map<number, number>()       // 判定 id → judgmentSpawn
    const applyOf = new Map<number, number>()       // buff 实例 → 第一条 buffApply
    for (let i = 0; i < log.length; i++) {
      const e = log[i]!
      if (e.type === 'actionStart' && !startOf.has(e.instance)) startOf.set(e.instance, i)
      else if (e.type === 'judgmentSpawn' && !spawnOf.has(e.id)) spawnOf.set(e.id, i)
      else if (e.type === 'buffApply' && !applyOf.has(e.instanceId)) applyOf.set(e.instanceId, i)
    }
    const tailOf = new Map<number, number>()
    for (const t of this.tails) if (t.createdBySeq !== null && !tailOf.has(t.id)) tailOf.set(t.id, t.createdBySeq)
    const byKind = (e: SimEvent, i: number): number | undefined => {
      switch (e.type) {
        case 'actionEnd': case 'actionCancel': return startOf.get(e.instance)
        case 'buffExpire': return applyOf.get(e.instanceId)
        case 'buffApply': { const first = applyOf.get(e.instanceId); return first !== i ? first : undefined }
        case 'hit': return e.effect ? undefined : spawnOf.get(e.id)
        default: return undefined
      }
    }
    const byScope = (o: OriginContext): number | undefined => {
      switch (o.kind) {
        case 'judgmentSettle': case 'judgmentExpire': return spawnOf.get(o.judgmentId)
        case 'timeline': return o.detached ? tailOf.get(o.actionInstance) : startOf.get(o.actionInstance)
        case 'actionLifecycle': return startOf.get(o.actionInstance) ?? tailOf.get(o.actionInstance)
        default: return undefined
      }
    }
    const meta: EventMeta[] = []
    const judgments: EntityOrigin[] = []
    for (let i = 0; i < log.length; i++) {
      const e = log[i]!
      const x = this.filled[i] ?? { phase: p, origin: UNATTRIBUTED, parent: undefined, scope: undefined }
      const subject = byKind(e, i) ?? byScope(x.origin)
      meta.push({
        phase: x.phase, origin: x.origin,
        ...(x.parent !== undefined && x.parent < i ? { directParentSeq: x.parent } : {}),
        ...(subject !== undefined && subject < i ? { subjectSeq: subject } : {}),
        ...(x.scope !== undefined ? { scope: x.scope } : {}),
      })
      if (e.type === 'judgmentSpawn') judgments.push({ id: e.id, createdAtFrame: e.f, createdBySeq: i, origin: x.origin })
    }
    return { eventMeta: meta, entityOrigins: { judgments, tails: [...this.tails] } }
  }
}

// ---------------------------------------------------------------------------
// 规则使用（DD-05 §4.2）：必有的摘要。不进 SimState；诊断关与开结果相同

/** Kernel.rule：总是有，不随诊断开关变。value 是这一处读到的规则值，decisive 是业务代码本来就算出来的布尔值或纯函数的结果 */
export interface RuleRecorder { note(point: RulePointId, value: number | boolean | string, decisive: boolean): void }

const POINT_INDEX: ReadonlyMap<string, number> = new Map(RULE_POINTS.map((p, i) => [p.id, i]))

/** 按判定点累计读取次数（求值次数）、决定分支的次数、第一次的战斗帧；开了 ruleTrace 时把每一次交给收集器 */
export class RuleCounter implements RuleRecorder {
  private readonly reads: number[] = RULE_POINTS.map(() => 0)
  private readonly decisive: number[] = RULE_POINTS.map(() => 0)
  private readonly first: (number | null)[] = RULE_POINTS.map(() => null)
  private readonly s: Readonly<SimState>
  private readonly at: { readonly phase: TickPhase }
  private readonly sink: DiagSink | null

  constructor(s: Readonly<SimState>, at: { readonly phase: TickPhase }, sink: DiagSink | null) {
    this.s = s
    this.at = at
    this.sink = sink
  }

  note(point: RulePointId, value: number | boolean | string, decisive: boolean): void {
    const i = POINT_INDEX.get(point)!
    this.reads[i]! += 1
    if (decisive) this.decisive[i]! += 1
    if (this.first[i] === null) this.first[i] = this.s.battleFrames
    if (this.sink) {
      const s = this.s
      this.sink.ruleNoted(point, RULE_POINTS[i]!.propositionId, value, decisive, s.frame, s.battleFrames, s.log.length - 1, this.at.phase)
    }
  }

  /** 按命题汇总（命题按判定点表里第一次出现的顺序）；coverage 就是判定点表 */
  report(): RuleUsageReport {
    const order: string[] = []
    const sum = new Map<string, { readCount: number; decisiveCount: number; firstFrame: number | null }>()
    RULE_POINTS.forEach((p, i) => {
      let row = sum.get(p.propositionId)
      if (!row) { order.push(p.propositionId); sum.set(p.propositionId, (row = { readCount: 0, decisiveCount: 0, firstFrame: null })) }
      row.readCount += this.reads[i]!
      row.decisiveCount += this.decisive[i]!
      const f = this.first[i]!
      if (f !== null && (row.firstFrame === null || f < row.firstFrame)) row.firstFrame = f
    })
    return {
      byProposition: order.map(propositionId => ({ propositionId, ...sum.get(propositionId)! })),
      coverage: RULE_POINTS.map(p => ({ pointId: p.id, propositionId: p.propositionId, symbol: p.symbol })),
    }
  }
}

/** 运行观察点要求停下（DD-05 §6.1）：内部异常，不经 fail，不做失败收尾，也不做收尾的 drain；run.ts 接住它，不交给 buildCompletion */
export class ProbeStop extends Error {
  readonly frame: Frame
  constructor(frame: Frame) {
    super(`观察点要求停在 S[${frame}]`)
    this.name = 'ProbeStop'
    this.frame = frame
  }
}
