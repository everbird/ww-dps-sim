// src/engine/run-types.ts —— 运行输入、运行身份、完成状态的类型（DD-01；架构 §2.1–§2.4、§4.1、§9）
// 只有类型与一个版本常量，不 import 运行代码。
import type { CharName, Frame, ResourceKind, Slot } from '../data/common'
import type { Rules } from '../data/gamedata'
import type { Scenario } from '../data/scenario.schema'
import type { HitRecord, SimOptions } from './context'
import type { DiagOptions } from './diagnostics'
import type { CommandRef, ResolvedScenario, WaitCode } from './types'

/** SimResult 或事件的业务字段每变一次加 1（DD-01 §3.3）。'2' = DD-03：buffApply/buffExpire 增加 owner/instanceId，新增 buffUptimeBy、kill.eventSeq/overflow、goal.lethal */
export const OUTPUT_SCHEMA_VERSION = '2'

// ---------------------------------------------------------------------------
// 运行输入（DD-01 §3.2；架构 §2.1）

/** 命令行与调用方能覆盖的东西。没给的项不覆盖；优先级：这里给了的 > 场景写了的 > schema 缺省 */
export interface RunOverrides {
  readonly strict?: boolean                              // --strict / --no-strict（严格入口由 DD-02 做；此前给 true 会被拒绝）
  readonly continueAfterIntentUnmet?: boolean            // 缺省 false
  readonly options?: Partial<Pick<Scenario['options'], 'repeat' | 'maxFrames' | 'maxWait' | 'endAt' | 'tuneBreak' | 'inputDelay'>>
  /** 规则覆盖：键是 Rules 下的路径（'defFloor'、'energyShare.dealer'），不带 'rules.' 前缀 */
  readonly rules?: Readonly<Record<string, number | boolean | string>>
  readonly inputDelayAt?: Readonly<Record<string, Frame>>   // 卡帧点分析用，场景里写不出来
  readonly goal?: Scenario['goal']
  readonly enemy?: Scenario['enemy']
  readonly sample?: SimOptions['sample']
  readonly environment?: RunEnvironment
}

/** 由命令行采集、纯库拿不到的身份信息（src/cli/run-env.ts）。不给时提交号记 'unknown'，其余省略 */
export interface RunEnvironment {
  readonly gitCommit: string
  readonly contentFingerprint?: string
  readonly xlsxSha256?: string
  readonly resourceVersion?: string
}

/** 一份归一后的运行输入：编译、运行、状态查询、历史重跑用的是同一份（架构 §2.1） */
export interface PreparedRun {
  readonly runId: string                    // 整份运行身份按 canonicalJson 转成文本后的摘要
  readonly identity: RunIdentity            // 记归一后的有效值
  readonly resolved: ResolvedScenario
  readonly effective: {
    readonly damageScope: DamageScope
    readonly strict: boolean
    readonly strictSource: 'scenario' | 'cli-override' | 'default'
    readonly continueAfterIntentUnmet: boolean
    readonly sample: SimOptions['sample'] | null
  }
}

export type PrepareResult =
  | { readonly ok: true; readonly run: PreparedRun; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly issues: readonly PrepareIssue[] }

export interface PrepareIssue {
  readonly stage: 'schema' | 'strict' | 'resolve' | 'compile'
  readonly line?: number; readonly item?: number; readonly opening?: true
  /** 'strict.filler'、'strict.tuneBreakOff'…（DD-02 §3.2）；其余阶段用 'schema'、'resolve'、'compile' */
  readonly code: string
  readonly message: string
}

// ---------------------------------------------------------------------------
// 运行身份（DD-01 §3.3；架构 §9）

export interface RunIdentity {
  /** 数据材料 */
  readonly data: {
    readonly xlsxFileDate: string             // GameData.version；它是文件日期，不是游戏版本
    readonly xlsxSha256?: string
    readonly resourceVersion?: string
  }
  /** 代码与输入：都记归一后的有效值 */
  readonly execution: {
    readonly gitCommit: string                // 'unknown' = 没采集（测试、网页）
    readonly contentFingerprint?: string      // 工作区有改动时：相关文件实际内容的指纹
    readonly scenarioDigest: string           // 合并覆盖之后、装配之前的场景内容；'unknown' = 只拿到了装配结果（prepareResolved）
    readonly resolvedDigest: string           // 装配结果里可序列化的部分（去掉钩子表；rules、options 单列，不在里面）
    readonly entryMode: 'standard' | 'strict' | 'replay'
    readonly strictSource: 'scenario' | 'cli-override' | 'default'
    readonly inputTiming: 'earliest' | 'delayed'   // 有任何操作延迟、抖动、手速档就是 delayed
    readonly rules: Rules
    readonly options: ResolvedScenario['options']
    readonly sample: SimOptions['sample'] | null
    readonly continueAfterIntentUnmet: boolean
    readonly outputSchemaVersion: string
  }
}

// ---------------------------------------------------------------------------
// 完成状态（DD-01 §3.6；架构 §2.2–§2.4）

export type RunStatus =
  | 'completed'     // 指令都执行完，场上没有在途的动作、判定、尾部
  | 'truncated'     // 到了帧数上限 options.maxFrames
  | 'axisFailed'    // 轴在所选模型下执行不下去（有效结论）
  | 'engineError'   // 引擎或角色模块的错；这次运行作废

export type AxisFailureKind =
  | 'intentUnmet' | 'timeout' | 'comboBroken' | 'notOnField' | 'switchSelf' | 'airEntry' | 'entrySkill'

export interface UnmetIntentDetail {
  readonly kind: 'introMissed' | 'airEntry' | 'entrySkill' | 'cancelFrameIllegal'
  readonly cmd: CommandRef
  readonly expected: string                 // 例："切出者协奏 ≥ 100"
  readonly actual: string                   // 例："协奏 92"
}

/** tick 的相位（kernel.ts 的 Kernel.at）：init = 还没进循环；afterP7 = 一个 tick 走完之后（含收尾）。
 *  P5（敌人量表）没有独立的代码段，不单列 */
export type TickPhase = 'init' | 'P1' | 'P2' | 'P3' | 'P4' | 'P6' | 'afterP7'

/** 一个状态包含了哪些记录：各用自己的上界。三项都是常驻的，与诊断开关无关（架构 §2.3） */
export interface StatePrefix {
  readonly eventEndExclusive: number        // 包含日志里 [0, n) 的事件
  readonly handledEndExclusive: number      // 其中处理器全部执行完的 [0, m)；在正常的 tick 边界上 m = n
  readonly interventionEndExclusive: number // 包含的外部干预记录
}

export interface RunCoverage {
  readonly initCompleted: boolean           // 初始化（常驻 buff、onResolve、首次 drain）走完没有
  readonly completedTicks: Frame            // 合法的状态边界是 S[0] … S[completedTicks]；初始化没走完时一个都没有
  readonly loggedEventEndExclusive: number  // 日志里已有的事件 [0, n)
  /** 循环为什么退出、在哪退出。收尾里再出错，这一项不改写 */
  readonly loopExitAt: {
    readonly reason: 'idle' | 'maxFrames' | 'axisFailed' | 'engineError'
    readonly worldFrame: Frame
    readonly phase: TickPhase
    readonly inFlightEventSeq?: number      // 循环里出错时正在处理的事件
  }
  /** 循环退出之后的收尾做了什么、做完没有 */
  readonly finalization: {
    readonly kind:
      | 'postDrain'     // 循环正常返回后再处理一次队列
      | 'failClose'     // 报错前关掉正在累计的等待段，不处理队列
      | 'none'          // 初始化失败，或出错的不是经调度器 fail 的错
    readonly completed: boolean
    readonly inFlightEventSeq?: number      // postDrain 中途出错时正在处理的事件
  }
  readonly terminal: {
    readonly kind:
      | 'afterPostDrain'    // 收尾的 drain 处理完了
      | 'postDrainFailed'   // 收尾的 drain 中途出错
      | 'afterFailClose'    // P7 之后报错，失败收尾做完，没有 drain
      | 'midTick'           // tick 中途停下（含这时的失败收尾）
      | 'initIncomplete'
    readonly prefix: StatePrefix
  }
}

export interface RunCompletion {
  readonly status: RunStatus
  readonly axisFailure?: { readonly kind: AxisFailureKind; readonly unmetIntent?: UnmetIntentDetail; readonly detail: string }
  readonly truncation?: {
    readonly kind: 'commandsPending' | 'inFlightRemains'
    readonly remains: { readonly pendingCommands: number; readonly activeActions: number; readonly pendingJudgments: number; readonly pendingTails: number }
  }
  /** 引擎错误的明细（总览 §6 的 S-01）。这类错误不往外抛，结果作废、只供排错 */
  readonly engineError?: { readonly code: 'chainDepth' | 'invariant' | 'uncaught'; readonly message: string }
  readonly coverage: RunCoverage
  /** 执行轮数：只认日志里的轮边界，不看调度游标；endAt 不参与（它只截统计窗口，不截执行） */
  readonly loops: {
    readonly planned: number                  // options.repeat
    readonly started: number                  // 日志里 loop ≥ 1 的 loop 事件个数
    readonly completed: number                // 结束边界已确认的循环轮数
    readonly openingCompleted: boolean | null // 没有启动轴时 null
    /** 结束边界已确认的各轮（含启动轴，记为第 0 轮）的真实结束战斗帧：下一轮 loop 事件的战斗帧；
     *  最后一轮自然结束时取不带 endAt 的统计窗口终点。按 loop 找条目，不当数组下标用 */
    readonly roundEnds: readonly { readonly loop: number; readonly endBattleFrame: number }[]
  }
  /** 目标是否达成：与 status 是两个维度 */
  readonly goal: { readonly kind: 'steady' | 'kill' | 'window'; readonly reached: boolean }
  /** 有没有外部指定的状态（干预记录） */
  readonly conditioning: { readonly basis: 'unconditioned' | 'conditioned'; readonly firstInterventionIndex: number | null }
  /** 严格入口意图未满足后继续试跑时：从哪里起是降级试跑（DD-02） */
  readonly diagnosticContinuationFrom?: { readonly worldFrame: Frame; readonly prefix: StatePrefix }
}

// ---------------------------------------------------------------------------
// 必有的运行记录（架构 §4.1）

/** 外部干预记录：一直都有，不进日志的触发队列。同一个 afterEventSeq 下按 orderInAnchor 重放 */
export interface InterventionRecord {
  readonly index: number
  readonly f: Frame
  readonly phase: string
  readonly afterEventSeq: number            // 排在哪条业务事件之后；还没有事件时是 -1
  readonly orderInAnchor: number            // 同一个 afterEventSeq 下的先后
  readonly kind: 'sync' | 'fill' | 'enemyDisharmony' | 'enemySwap'
  readonly target?: { readonly slot?: Slot; readonly resource?: ResourceKind }
  readonly before?: number
  readonly adopted?: number
  readonly delta?: number
  readonly firedTriggers: boolean
  readonly skippedTriggers: readonly string[]
}

/** 严格入口的检查结果、按意图的等待、提示（DD-02 §3.4）。所有入口都有；DD-02 做完之前只有 entry、earliestLegalBaseline 与空数组 */
export interface StrictReport {
  readonly entry: 'standard' | 'strict' | 'replay'
  /** 严格入口，并且没有任何操作延迟（架构 §2.1 的"最早合法帧基线"） */
  readonly earliestLegalBaseline: boolean
  readonly compileChecks: readonly { readonly code: string; readonly passed: boolean }[]
  readonly intentWaits: readonly {
    readonly cmd: CommandRef
    readonly code: 'concertoSettle' | 'airborne' | 'entryBusy'
    readonly fromFrame: Frame; readonly frames: number; readonly battleFrames: number
    readonly reason: string
  }[]
  readonly unmetIntents: readonly (UnmetIntentDetail & { readonly worldFrame: Frame; readonly continued: boolean })[]
  readonly hints: readonly { readonly code: 'forceNoCancel' | 'forceNoEffect'; readonly cmd: CommandRef; readonly message: string }[]
  /** 状态是 timeout 时：等待预算、超时那一刻挡住它的条件、相关角色此刻的资源与冷却 */
  readonly timeoutContext?: {
    readonly maxWait: Frame
    readonly cmd: CommandRef
    readonly blocked: { readonly code: WaitCode; readonly reason: string; readonly sinceFrame: Frame }
    readonly subjects: readonly {
      readonly role: 'actor' | 'switchOut' | 'switchIn'
      readonly char: CharName
      readonly energy: number; readonly concerto: number; readonly core: readonly number[]
      readonly cooldowns: Readonly<Record<string, Frame>>
    }[]
    readonly blockingRole?: 'actor' | 'switchOut' | 'switchIn'
  }
}

/** 谐度破坏含不含在 DPS 里（DD-02 §3.7）。"未含"= 谐度破坏自身的伤害不在 DPS 里；gauge 为 off 时，依赖失谐的效果也不在。
 *  按最终有效选项与装配后的动作种类分类，省略原因保留场景声明 */
export interface DamageScope {
  readonly tuneBreak:
    | { readonly mode: 'written' }
    | { readonly mode: 'auto' }
    | { readonly mode: 'writtenPlusAuto' }
    | { readonly mode: 'omitted'
        readonly reason: 'sourceSilent' | 'notInGame' | 'deliberate' | 'disabledByOption' | 'undeclared'
        readonly gauge: 'off' | 'accumulates' }
}

/** 列明的判定点上读到、决定了哪条规则（架构 §4.2；DD-05 §4）。byProposition 按命题汇总判定点表（rule-points.ts）里每一条命题，
 *  readCount、decisiveCount 是求值次数（调度器对同一条指令每个 tick 都重新求值，每求一次记一次）；firstFrame 是第一次读到的战斗帧。
 *  decisive：在当时的局部状态下换成另一个已实现的候选值，这一处会走另一条分支；不等于改变了结果 */
export interface RuleUsageReport {
  readonly byProposition: readonly {
    readonly propositionId: string
    readonly readCount: number
    readonly decisiveCount: number
    readonly firstFrame: number | null
  }[]
  /** 哪些判定点已经列入；没列入的读取是"未插桩"，不是 0 */
  readonly coverage: readonly { readonly pointId: string; readonly propositionId: string; readonly symbol: string }[]
}

/** 可选诊断的开关与产出（DD-05 §3.1）：类型在 diagnostics.ts，这里转出去给还从 run-types 取的调用方 */
export type { DiagOptions, Diagnostics } from './diagnostics'

/** runPrepared 的观察选项：都不进运行身份。回调只读收到的对象；回调自己抛的异常原样抛给调用方，不算这次运行的状态（总览 §6 的 S-04） */
export interface RunOptions {
  readonly diag?: DiagOptions
  readonly onHit?: (rec: HitRecord) => void   // 择优的快速重算在用，原样透传
}
