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
// 资源只读账本（DD-06；架构 §6）：角色资源（大招能量、协奏、核心资源）的每一次写入与期初余额各记一条，由 resources.ts 的 add、
// switch.ts 的延奏清零、simulate.ts 的期初写进来；闭合检查 checkLedgerClosure、两个口径的合计 ledgerTotals、与日志的交叉检查
// crossCheckLedger 是这里的纯函数。账本是可选诊断，它的上界（LedgerMarks）不进完成状态（架构 §2.3）。
import { RESOURCE_KINDS, type ActionId, type CharName, type Frame, type ResourceKind, type Slot } from '../data/common'
import type { HitContext, HitView, TuneContext } from './formula'
import { roundTo, snap9 } from './num'
import type { TriggerCheckGroup, TriggerOutcome, TriggerTarget } from './probe'
import { RULE_POINTS, type RulePointId } from './rule-points'
import type { RuleUsageReport, TickPhase } from './run-types'
import type { ScheduleErrorCode } from './scheduler'
import type { CommandRef, HitFactors, SimEvent, SimState, WaitCode, ZoneAccumulator } from './types'

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
  readonly cmd?: CommandRef                 // 若位于指令作用域内，记下该指令出处（DD-07 §7）
}

// ---------------------------------------------------------------------------
// DD-07 诊断类型（S-08、S-10、DF-11、DF-12、DF-15）

/** 调度器真实求值与指令生命周期记录（DD-07 §4.4；S-10） */
export interface CommandVerdict {
  readonly evaluationIndex: number
  readonly f: Frame
  readonly battleFrame: number
  readonly cmd: CommandRef
  readonly kind: 'head' | 'interject' | 'evaluate' | 'execute' | 'skip'
  readonly verdict?:
    | { readonly go: true }
    | { readonly go: false; readonly code: WaitCode; readonly reason: string }
    | { readonly threw: ScheduleErrorCode }
  readonly context?: {
    readonly readyAt: number | null
    readonly extra: number | null
    readonly until: number | null
    readonly waited: number
    readonly force: boolean
    readonly delay: number
  }
  readonly interject?: { readonly slot: Slot; readonly action: ActionId }
}

/** 触发检查在 handle 当场记下的一条（DD-07 §6；DF-12） */
export interface TriggerCheckRecord {
  readonly eventSeq: number
  readonly target: TriggerTarget
  readonly outcome: Exclude<TriggerOutcome, 'handlerNotRun'>
  readonly notEnteredReason?: 'noOccurrence' | 'noInstance' | 'targetMismatch'
  readonly groups: readonly TriggerCheckGroup[]
  readonly afterFiring?: string
}

/** 结算那一刻绑定到具体实例的 buff 贡献（架构 §3.4；DD-07 §7） */
export interface ActiveBuffContribution {
  readonly instanceId: number
  readonly defId: string
  readonly owner: CharName | 'env'
  readonly stacks: number
  readonly zone: string
  readonly value: number
  readonly remainingBattleFrames: number | 'inf'
}

/** 伤害结算的实际公式输入（DD-07 §7；DF-15） */
export type HitInputs =
  | {
      readonly path: 'direct'
      readonly ctx: HitContext
      readonly acc: ZoneAccumulator
      readonly view: HitView
      readonly multiplier: { readonly base: number; readonly afterModifyHit: number }
      readonly buffs: readonly ActiveBuffContribution[]
      readonly factors: HitFactors
      readonly output: { readonly nonCrit: number; readonly crit: number; readonly expected: number }
      readonly notRecorded: readonly string[]
    }
  | {
      readonly path: 'tuneBreak'
      readonly ctx: TuneContext
      readonly acc: ZoneAccumulator
      readonly output: { readonly nonCrit: number; readonly crit: number; readonly expected: number }
      readonly notRecorded: readonly string[]
    }

export interface MatchingBuffDef {
  readonly defId: string
  readonly owner: CharName | 'env'
}

export interface PresentBuffSnapshot {
  readonly instanceId: number
  readonly defId: string
  readonly owner: CharName | 'env'
  readonly target: CharName | 'enemy'
  readonly remainingBattleFrames: number | 'inf'
}

/** 结算那一刻的相符 buff 定义与在场实例（DD-07 §8） */
export interface HitMarginRecord {
  readonly dealer: CharName
  readonly hitBattleFrame: number
  readonly matchingDefs: readonly MatchingBuffDef[]
  readonly present: readonly PresentBuffSnapshot[]
}

/** 资源账本条目的种类（DD-06 §3.1）：期初余额、一次写入、延奏清零（"设为 0"，不是减法）、状态同步（DD-09） */
export type LedgerKind = 'initial' | 'change' | 'outroReset' | 'sync'

/** 给程序分类用的固定取值（总览 §6 的 S-06）；cause 保留原文 */
export type LedgerCauseKind = 'initial' | 'hit' | 'cast' | 'cost' | 'effect' | 'hook' | 'break' | 'outro' | 'sync'   // 'forced'（能量满）随写法删了（DD-09 T09-10）

/** 资源账本的一条（DD-06 §3.1；架构 §6.2）。只读、旁路：不补发业务事件。
 *  - 请求量为 0 的不记；请求了但被截掉的要记（满格再获得、空了再扣），clippedDelta 就是被截掉的量：正数是到上限被截，负数是扣到 0 以下被截；
 *  - requestedDelta 是交给 add 的量（能量已乘过共鸣效率）；actualDelta = after − before；clippedDelta = requestedDelta − actualDelta（都取整到 1e-9）；
 *  - 期初条目（kind initial）的两个增量都是 0，余额在 after 里；闭合 = 期初条目的 after + Σ 其余条目的 actualDelta；
 *  - phase 同 EventMeta 的口径（P1 不写资源，不会出现）；battleFrame 是写入那一刻的战斗帧（按战斗帧开窗口合计用，DD-06 §9 第 1 条）；
 *  - cap 没有上限时是 Infinity（JSON 里怎么编由 DD-07 的 wire 定）；
 *  - relatedEventSeq：对应的业务事件（resource 或 hit）；期初、实际变化为 0 的单人写入（没写事件）、静默同步没有。
 *    relatedInterventionIndex：外部干预（同步，DD-09 §3.2）引起的，指向那条干预记录 */
export interface ResourceLedgerEntry {
  readonly index: number                    // 账本自己的序号，就是检查点的 ledgerEndExclusive 用的那个
  readonly f: Frame
  readonly battleFrame: number
  readonly phase: EventPhase
  readonly slot: Slot
  readonly resource: ResourceKind
  readonly kind: LedgerKind
  readonly causeKind: LedgerCauseKind
  readonly cause: string                    // 原文：资源型效果是它的定义 ID，钩子是 'hook' 或 'hook：<说明>'
  readonly before: number
  readonly requestedDelta: number
  readonly actualDelta: number
  readonly clippedDelta: number
  readonly after: number
  readonly cap: number
  readonly relatedEventSeq?: number
  readonly relatedInterventionIndex?: number
}

/** 写入点交给收集器的一条：序号、相位由收集器补 */
export type LedgerInput = Omit<ResourceLedgerEntry, 'index' | 'phase'>

/** 账本的上界（架构 §6.3，AF-27）：诊断开着才有，不进完成状态 */
export interface LedgerMarks {
  readonly terminalEndExclusive: number             // 终态包含的账本条目：运行停下时的账本长度
  readonly continuationFromEndExclusive?: number    // 降级续跑起点（DD-02 §3.3）那一刻的账本长度
}

/** 可选诊断的开关（DD-05 §3.1；DD-06；DD-07）。观察选项，不进运行身份 */
export interface DiagOptions {
  readonly eventMeta?: boolean
  readonly resourceLedger?: boolean
  readonly ruleTrace?: boolean
  readonly hitInputs?: boolean
  readonly hitMargins?: boolean
  readonly commandVerdicts?: boolean
  readonly triggerChecks?: readonly TriggerTarget[]
}

/** 可选诊断的产出（SimResult.diag） */
export interface Diagnostics {
  readonly eventMeta?: readonly EventMeta[]
  readonly entityOrigins?: { readonly judgments: readonly EntityOrigin[]; readonly tails: readonly EntityOrigin[] }
  readonly ruleTrace?: readonly RuleTraceEntry[]
  readonly resourceLedger?: readonly ResourceLedgerEntry[]
  readonly ledgerMarks?: LedgerMarks
  readonly commandVerdicts?: readonly CommandVerdict[]
  readonly triggerChecks?: readonly TriggerCheckRecord[]
  readonly hitInputs?: Readonly<Record<number, HitInputs>>
  readonly hitMargins?: Readonly<Record<number, HitMarginRecord>>
  readonly businessRoots?: Readonly<Record<number, number>>
}

/** 全部诊断都开（零干扰对拍用，DD-05 §6） */
export const ALL_DIAG: DiagOptions = { eventMeta: true, resourceLedger: true, ruleTrace: true, hitInputs: true, hitMargins: true, commandVerdicts: true }
export const anyDiag = (o: DiagOptions | undefined): boolean =>
  o !== undefined && (Object.values(o).some(v => v === true) || (o.triggerChecks !== undefined && o.triggerChecks.length > 0))

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
type Writable<T> = { -readonly [K in keyof T]: T[K] }

export class DiagSink {
  readonly opts: DiagOptions
  private readonly stack: Scope[] = []
  private nextScope = 1
  private readonly filled: (Filled | undefined)[] = []      // 下标 = 日志下标
  private readonly tails: EntityOrigin[] = []
  private readonly trace: RuleTraceEntry[] = []
  private readonly entries: Writable<ResourceLedgerEntry>[] = []   // 资源账本（DD-06）：只追加；关联字段由 ledgerRelate 事后补上
  private readonly verdicts: CommandVerdict[] = []                 // 调度求值记录（DD-07 §4.4）
  private readonly triggers: TriggerCheckRecord[] = []             // 触发检查记录（DD-07 §6）
  private readonly hits: Record<number, HitInputs> = {}            // 伤害输入记录（DD-07 §7）
  private readonly margins: Record<number, HitMarginRecord> = {}   // buff 窗口记录（DD-07 §8）
  private readonly roots: Record<number, number> = {}              // 业务链根事件下标（DD-07 §7，S-08）
  private continuation: number | undefined                         // 降级续跑起点的账本长度
  private post = false
  private done: Diagnostics | null = null

  constructor(opts: DiagOptions) { this.opts = opts }

  /** DD-10 §3.1：边界只能保存空作用域栈；保留尚未 finish 的收集器内部表。 */
  checkpoint() {
    if (this.stack.length) throw new Error('snapshot: diagnostic scope stack is not empty')
    return structuredClone({ nextScope: this.nextScope, filled: this.filled, tails: this.tails, trace: this.trace,
      entries: this.entries, verdicts: this.verdicts, triggers: this.triggers, hits: this.hits, margins: this.margins,
      roots: this.roots, continuation: this.continuation, post: this.post })
  }

  restore(data: ReturnType<DiagSink['checkpoint']>): void {
    Object.assign(this, structuredClone(data))
    this.done = null
  }

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
    let cmd: CommandRef | undefined
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const o = this.stack[i]!.origin
      if (o.kind === 'command') { cmd = o.cmd; break }
    }
    this.trace.push({
      point, propositionId, f, battleFrame, phase: this.phaseOf(phase), afterEventSeq, value, decisive,
      ...(top ? { scope: top.id } : {}),
      ...(cmd ? { cmd } : {}),
    })
  }

  /** 记一条调度求值/生命周期记录（DD-07 §4.4） */
  commandVerdict(v: CommandVerdict): void {
    if (this.opts.commandVerdicts) this.verdicts.push(v)
  }

  /** 记一条触发检查记录（DD-07 §6） */
  triggerCheck(rec: TriggerCheckRecord): void {
    if (this.opts.triggerChecks?.length) this.triggers.push(rec)
  }

  /** 记一条伤害输入（DD-07 §7） */
  hitInput(seq: number, input: HitInputs): void {
    if (this.opts.hitInputs) this.hits[seq] = input
  }

  /** 记一条 buff 窗口快照（DD-07 §8） */
  hitMargin(seq: number, margin: HitMarginRecord): void {
    if (this.opts.hitMargins) this.margins[seq] = margin
  }

  /** 记下处理事件 i 时业务链的根事件下标（DD-07 §7，S-08） */
  eventRoot(seq: number, rootSeq: number): void {
    if (this.opts.eventMeta) this.roots[seq] = rootSeq
  }

  /** 循环已经退出：之后（收尾的 drain）写的事件记 'post'。k.at.phase 在空闲退出时停在 P2，靠它区分 */
  markPost(): void { this.post = true }

  // ---- 资源账本（DD-06 §3.2）。账本关着时这几个方法什么都不记；返回值只回传给收集器，不参与业务判断（DD-05 §3.1 的约束 1）

  /** 记一条账本条目。phase 是写入那一刻的 k.at.phase，按 EventMeta 的口径折算（循环退出后、afterP7 记 post） */
  ledger(e: LedgerInput, phase: TickPhase): void {
    if (!this.opts.resourceLedger) return
    const { f, battleFrame, ...rest } = e                       // 字段顺序：序号、时刻、相位在前
    this.entries.push({ index: this.entries.length, f, battleFrame, phase: this.phaseOf(phase), ...rest })
  }

  /** 当前的账本长度：写入之前取，随后交给 ledgerRelate / ledgerRelateIntervention */
  ledgerMark(): number { return this.entries.length }

  /** 把 [mark, 现在) 里还没关联的条目关联到第 eventSeq 条业务事件（resource 或 hit）。
   *  grant 在写完 resource、写 resourceFull 之前调；结算直接给 hit 的下标（hit 后面还可能紧跟 resourceFull 与 heal，DF-07） */
  ledgerRelate(mark: number, eventSeq: number): void {
    for (let i = mark; i < this.entries.length; i++) this.entries[i]!.relatedEventSeq ??= eventSeq
  }

  /** 把 [mark, 现在) 里的条目关联到第 index 条外部干预记录（同步） */
  ledgerRelateIntervention(mark: number, index: number): void {
    for (let i = mark; i < this.entries.length; i++) this.entries[i]!.relatedInterventionIndex ??= index
  }

  /** 降级续跑的起点（DD-02 §3.3 的 onIntentUnmet 决定续跑的那一刻）：记下这时的账本长度；只认第一次 */
  markContinuation(): void {
    if (this.opts.resourceLedger) this.continuation ??= this.entries.length
  }

  /** 边界观察点要的账本上界（DD-05 §6.1 的 ledgerLength）：账本关着时 null */
  ledgerLength(): number | null { return this.opts.resourceLedger ? this.entries.length : null }

  /** 运行结束（含出错、截断）：没关的作用域按从内到外关掉，剩下没标的记 unattributed；扫一遍日志建实体映射，补 subjectSeq。
   *  phase：结束时的相位（抛错时没关的作用域都包着抛错的那一点，它们都在这个相位里） */
  finish(log: readonly SimEvent[], phase: TickPhase): void {
    if (this.done) return
    while (this.stack.length > 0) this.fill(this.stack.pop()!, log.length, phase)
    const want = this.opts.eventMeta === true
    this.done = {
      ...(want ? { ...this.origins(log, phase), businessRoots: this.roots } : {}),
      ...(this.opts.ruleTrace ? { ruleTrace: this.trace } : {}),
      ...(this.opts.resourceLedger ? {
        resourceLedger: this.entries,
        ledgerMarks: { terminalEndExclusive: this.entries.length, ...(this.continuation !== undefined ? { continuationFromEndExclusive: this.continuation } : {}) },
      } : {}),
      ...(this.opts.commandVerdicts ? { commandVerdicts: this.verdicts } : {}),
      ...(this.opts.triggerChecks?.length ? { triggerChecks: this.triggers } : {}),
      ...(this.opts.hitInputs ? { hitInputs: this.hits } : {}),
      ...(this.opts.hitMargins ? { hitMargins: this.margins } : {}),
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
// 资源账本的检查与合计（DD-06 §3.3、§3.4、§3.6）：纯函数，只读账本、状态与日志

/** 闭合检查报出的一项。balance：账本推出的余额与状态里的不同；chain：同一个（角色，资源）相邻两条接不上
 *  （前一条的 after ≠ 后一条的 before，中间有没进账本的写入）；initial：没有期初条目，或期初条目不是第一条 */
export interface LedgerMismatch {
  readonly kind: 'balance' | 'chain' | 'initial'
  readonly slot: Slot
  readonly char: CharName
  readonly resource: ResourceKind
  readonly expected?: number                         // balance：账本推出的余额
  readonly actual?: number                           // balance：状态里的余额
  readonly between?: readonly [number, number]       // chain：哪两条之间（账本序号 index）
  readonly message: string
}

/** 闭合检查要的状态：每人的三种资源（SimState 满足它；边界观察点里要留的话拷贝这几个数就够） */
export interface LedgerBalances {
  readonly chars: readonly {
    readonly slot: Slot; readonly name: CharName; readonly energy: number; readonly concerto: number; readonly core: readonly number[]
  }[]
}

const valueOf = (c: LedgerBalances['chars'][number], res: ResourceKind): number =>
  res === 'energy' ? c.energy : res === 'concerto' ? c.concerto : c.core[Number(res.slice(4)) - 1]!

/** 账本前 endExclusive 条推出的余额与 state 里的余额逐项比（DD-06 §3.3）。返回不一致的项；空数组 = 闭合。
 *  - 推法：对每个（角色，资源），期初条目的 after + Σ 其余条目的 actualDelta；两边都取整到 1e-6 再比（每次写入已经 snap9）；
 *  - 另查逐条的不变式：同一个（角色，资源）相邻两条满足 前一条的 after === 后一条的 before，中间有没进账本的写入时它先报出来；
 *  - tick 边界 S[f] 用 ledgerPrefixForBoundary(ledger, f) 取条目、endExclusive 给它的长度；终态用 ledgerMarks.terminalEndExclusive，
 *    降级续跑的起点用 ledgerMarks.continuationFromEndExclusive，不用帧号去猜 */
export function checkLedgerClosure(ledger: readonly ResourceLedgerEntry[], endExclusive: number, state: LedgerBalances): LedgerMismatch[] {
  const out: LedgerMismatch[] = []
  const nameOf = (slot: Slot) => state.chars.find(c => c.slot === slot)?.name ?? `槽位 ${slot}`
  const run = new Map<string, { bal: number; last: ResourceLedgerEntry }>()
  const end = Math.min(endExclusive, ledger.length)
  for (let i = 0; i < end; i++) {
    const e = ledger[i]!
    const key = `${e.slot}|${e.resource}`
    const cur = run.get(key)
    const who = `${nameOf(e.slot)} 的 ${e.resource}`
    if (!cur) {
      if (e.kind !== 'initial')
        out.push({ kind: 'initial', slot: e.slot, char: nameOf(e.slot), resource: e.resource, message: `${who}：第一条（账本第 ${e.index} 条）不是期初条目` })
      run.set(key, { bal: e.kind === 'initial' ? e.after : e.before + e.actualDelta, last: e })
      continue
    }
    if (cur.last.after !== e.before) {
      out.push({
        kind: 'chain', slot: e.slot, char: nameOf(e.slot), resource: e.resource, between: [cur.last.index, e.index],
        message: `${who}：账本第 ${cur.last.index} 条记到 ${cur.last.after}，第 ${e.index} 条却从 ${e.before} 开始（这两条之间有没进账本的写入）`,
      })
    }
    if (e.kind === 'initial')
      out.push({ kind: 'initial', slot: e.slot, char: nameOf(e.slot), resource: e.resource, message: `${who}：账本第 ${e.index} 条又是一条期初条目` })
    cur.bal += e.actualDelta
    cur.last = e
  }
  for (const c of state.chars) {
    for (const res of RESOURCE_KINDS) {
      const x = run.get(`${c.slot}|${res}`)
      const who = `${c.name} 的 ${res}`
      if (!x) {
        out.push({ kind: 'initial', slot: c.slot, char: c.name, resource: res, message: `${who}：账本前 ${end} 条里没有它的期初条目` })
        continue
      }
      const v = valueOf(c, res)
      if (roundTo(x.bal, 1e6) !== roundTo(v, 1e6)) {
        out.push({
          kind: 'balance', slot: c.slot, char: c.name, resource: res, expected: x.bal, actual: v,
          message: `${who}：账本前 ${end} 条推出 ${x.bal}，状态里是 ${v}（有没进账本的写入）`,
        })
      }
    }
  }
  return out
}

/** tick 边界 S[f]：从整次运行的账本里取属于它的条目（DD-06 §3.3）。集合条件 phase === 'init' || f' < f：初始化阶段的条目 f 也是 0，
 *  写成"期初一段加 f' < f 一段"会把它们算两次或漏掉（架构 §6.3）。结果是账本的一个前缀，长度就是这个边界的 ledgerEndExclusive */
export const ledgerPrefixForBoundary = (ledger: readonly ResourceLedgerEntry[], f: Frame): ResourceLedgerEntry[] =>
  ledger.filter(e => e.phase === 'init' || e.f < f)

/** 一个（角色，资源）的两个口径的合计（DD-06 §3.4）。报"这一轮回了多少能量"用 gainRequested（没按上限截断的获得量）；
 *  报"到上限后的实际库存"用 gainActual 与 final。被截掉的量单列，不当作可见状态。
 *  都是带符号的变化量：spend*、clippedAtZero、outroReset 是负数；不按来源过滤时 final = initial + gainActual + spendActual + outroReset + synced */
export interface ResourceTotals {
  readonly slot: Slot
  readonly resource: ResourceKind
  readonly initial: number                   // 窗口开始时的余额（不开窗口就是期初余额）
  readonly gainRequested: number             // Σ 正的 requestedDelta（kind change）
  readonly gainActual: number                // Σ 正的 actualDelta（kind change）
  readonly clippedAtCap: number              // Σ 正的 clippedDelta（kind change）：到上限被截掉的
  readonly spendRequested: number            // Σ 负的 requestedDelta（kind change）
  readonly spendActual: number               // Σ 负的 actualDelta（kind change）
  readonly clippedAtZero: number             // Σ 负的 clippedDelta（kind change）：扣到 0 以下被截掉的
  readonly outroReset: number                // 延奏清掉的量（负数）
  readonly synced: number                    // 状态同步的净变化（DD-09）
  readonly final: number                     // 窗口结束时的余额
}

/** ledgerTotals 的选项：窗口 [fromFrame, toFrame) 左闭右开，按 clock（缺省世界帧）。causeKinds 只筛变化量的合计；
 *  initial、final 总是窗口两端的实际余额 */
export interface LedgerTotalsOptions {
  readonly clock?: 'world' | 'battle'
  readonly fromFrame?: Frame
  readonly toFrame?: Frame
  readonly causeKinds?: readonly LedgerCauseKind[]
}

/** 每个（角色，资源）的合计（DD-06 §3.4），按槽位、资源的固定顺序；只列账本里出现过的。余额按闭合的推法累计
 *  （期初条目的 after + Σ actualDelta；给的账本不带期初时从第一条的 before 起）。合计都取整到 1e-9 */
export function ledgerTotals(ledger: readonly ResourceLedgerEntry[], opts: LedgerTotalsOptions = {}): ResourceTotals[] {
  const from = opts.fromFrame ?? -Infinity, to = opts.toFrame ?? Infinity
  const kinds = opts.causeKinds
  type Acc = { slot: Slot; resource: ResourceKind; bal: number | undefined; start: number | undefined; sums: number[] }
  const acc = new Map<string, Acc>()
  for (const e of ledger) {
    const key = `${e.slot}|${e.resource}`
    let a = acc.get(key)
    if (!a) acc.set(key, (a = { slot: e.slot, resource: e.resource, bal: undefined, start: undefined, sums: [0, 0, 0, 0, 0, 0, 0, 0] }))
    const at = opts.clock === 'battle' ? e.battleFrame : e.f
    if (at >= to) continue
    const prev = a.bal ?? (e.kind === 'initial' ? e.after : e.before)
    a.bal = e.kind === 'initial' ? e.after : prev + e.actualDelta
    if (at < from) continue
    a.start ??= prev
    if (kinds && !kinds.includes(e.causeKind)) continue
    const s = a.sums
    if (e.kind === 'change') {
      if (e.requestedDelta > 0) s[0]! += e.requestedDelta; else s[3]! += e.requestedDelta
      if (e.actualDelta > 0) s[1]! += e.actualDelta; else s[4]! += e.actualDelta
      if (e.clippedDelta > 0) s[2]! += e.clippedDelta; else s[5]! += e.clippedDelta
    } else if (e.kind === 'outroReset') s[6]! += e.actualDelta
    else if (e.kind === 'sync') s[7]! += e.actualDelta
  }
  const rank = (a: Acc) => a.slot * RESOURCE_KINDS.length + RESOURCE_KINDS.indexOf(a.resource)
  return [...acc.values()].sort((x, y) => rank(x) - rank(y)).map(a => {
    const [gainRequested, gainActual, clippedAtCap, spendRequested, spendActual, clippedAtZero, outroReset, synced] = a.sums.map(snap9) as [number, number, number, number, number, number, number, number]
    const final = snap9(a.bal ?? 0)
    return {
      slot: a.slot, resource: a.resource, initial: snap9(a.start ?? a.bal ?? 0),
      gainRequested, gainActual, clippedAtCap, spendRequested, spendActual, clippedAtZero, outroReset, synced, final,
    }
  })
}

/** 账本与日志互相核对（DD-06 §3.6），只在测试与 pnpm fuzz --ledger 里跑。两种推法独立：账本漏了写入点由闭合检查报，
 *  日志漏了事件或 hit.gains 记错由 checkLog 报；这里查两边对得上：
 *  - 关联到 resource 事件的条目：角色、资源相同，after 等于事件的 value、actualDelta 等于 delta；每条 resource 事件恰好有一条条目关联它；
 *  - 关联到 hit 的条目：actualDelta 等于 hit.gains 里这个人这种资源的增减（没列的算 0）；hit.gains 里不是 0 的项都有关联的条目；
 *  - 实际变化不是 0 的写入（change、outroReset）都有关联的业务事件。
 *  names[slot] 是角色名。返回不成立的各条（最多 50 条，带世界帧）；空 = 对得上 */
export function crossCheckLedger(log: readonly SimEvent[], ledger: readonly ResourceLedgerEntry[], names: readonly CharName[]): string[] {
  const out: string[] = []
  const say = (f: number, what: string) => { if (out.length < 50) out.push(`第 ${f} 帧：${what}`) }
  const related = new Map<number, ResourceLedgerEntry[]>()
  for (const e of ledger) {
    const who = `${names[e.slot] ?? e.slot} 的 ${e.resource}（账本第 ${e.index} 条，${e.cause}）`
    if (e.relatedEventSeq === undefined) {
      if ((e.kind === 'change' || e.kind === 'outroReset') && e.actualDelta !== 0) say(e.f, `${who} 变了 ${e.actualDelta}，却没有关联的业务事件`)
      continue
    }
    const ev = log[e.relatedEventSeq]
    if (!ev) { say(e.f, `${who} 关联到第 ${e.relatedEventSeq} 条事件，日志里没有`); continue }
    let list = related.get(e.relatedEventSeq)
    if (!list) related.set(e.relatedEventSeq, (list = []))
    list.push(e)
    if (ev.type === 'resource') {
      if (ev.char !== names[e.slot] || ev.resource !== e.resource) say(e.f, `${who} 关联到的 resource 事件是 ${ev.char} 的 ${ev.resource}`)
      else if (ev.value !== e.after || ev.delta !== e.actualDelta)
        say(e.f, `${who}：账本 ${e.before} → ${e.after}（${e.actualDelta}），日志的 resource 记 ${ev.delta} → ${ev.value}`)
      if ((e.kind === 'outroReset') !== (ev.cause === 'outro')) say(e.f, `${who}：账本的种类 ${e.kind} 与事件的来源 ${ev.cause} 对不上`)
    } else if (ev.type === 'hit') {
      const name = names[e.slot]!
      const k = e.resource.startsWith('core') ? Number(e.resource.slice(4)) - 1 : -1
      if (e.resource !== 'energy' && ev.char !== name) { say(e.f, `${who} 关联到 ${ev.char} 的命中，协奏与核心资源只给出伤者`); continue }
      const logged = e.resource === 'energy' ? ev.gains.energy[name] ?? 0 : e.resource === 'concerto' ? ev.gains.concerto : ev.gains.core[k] ?? 0
      if (logged !== e.actualDelta) say(e.f, `${who}：账本实际变化 ${e.actualDelta}，命中（${ev.char} ${ev.judgment}）的 gains 记 ${logged}`)
    } else say(e.f, `${who} 关联到的是 ${ev.type} 事件，只该是 resource 或 hit`)
  }
  for (let i = 0; i < log.length; i++) {
    const ev = log[i]!
    const list = related.get(i) ?? []
    if (ev.type === 'resource' && list.length !== 1) say(ev.f, `${ev.char} 的 ${ev.resource}（${ev.cause}）这条 resource 事件有 ${list.length} 条账本条目关联，应该恰好 1 条`)
    if (ev.type !== 'hit') continue
    const has = (res: ResourceKind, name: CharName) => list.some(e => e.resource === res && names[e.slot] === name)
    for (const [name, d] of Object.entries(ev.gains.energy)) if (d && !has('energy', name)) say(ev.f, `${ev.char} ${ev.judgment} 给 ${name} 的能量 ${d} 没有账本条目`)
    if (ev.gains.concerto && !has('concerto', ev.char)) say(ev.f, `${ev.char} ${ev.judgment} 的协奏 ${ev.gains.concerto} 没有账本条目`)
    ev.gains.core.forEach((d, k) => { if (d && !has(`core${k + 1}` as ResourceKind, ev.char)) say(ev.f, `${ev.char} ${ev.judgment} 的核心资源 ${k + 1} 增减 ${d} 没有账本条目`) })
  }
  return out
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

  checkpoint() { return { reads: [...this.reads], decisive: [...this.decisive], first: [...this.first] } }
  restore(data: ReturnType<RuleCounter['checkpoint']>): void { Object.assign(this, structuredClone(data)) }

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

/** 运行观察点要求停下（DD-05 §6.1；DD-07 §4.4）：内部异常，不经 fail，不做失败收尾，也不做收尾的 drain；run.ts 接住它，不交给 buildCompletion */
export class ProbeStop extends Error {
  readonly frame: Frame
  readonly evaluationIndex?: number
  constructor(frame: Frame, evaluationIndex?: number) {
    super(evaluationIndex !== undefined ? `观察点要求停在求值 #${evaluationIndex}（第 ${frame} 帧）` : `观察点要求停在 S[${frame}]`)
    this.name = 'ProbeStop'
    this.frame = frame
    if (evaluationIndex !== undefined) this.evaluationIndex = evaluationIndex
  }
}
