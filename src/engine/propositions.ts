// src/engine/propositions.ts —— 规则台账（DD-04 §3；架构 §8.1；路线图 §5）：一条命题是一条能单独证伪的游戏事实（scope 为 policy 的是一条操作策略），
// 列出已知的几种读法（候选）、现在采用哪个、证据到了哪一步。"采用哪个"和"证据到了哪一步"是两个维度，可以是"采用 A、未验证"。
// 属于 ② 共享规则与台账：被执行核心（①）与分析层（④）只读引用。纯数据：判兼容、取当前生效值、路径冲突的函数在 candidates.ts（④，DD-04 §5），
// 文档由它生成（pnpm assumptions --ledger，DD-04 T04-3）。命题 ID（PropositionId）是 DD-05 规则使用记录的键（DD-05 §4.1）。
//
// 和假设表的关系（DD-04 §3.1）：ASSUMPTIONS 与 assume() 不动，summary.assumptions 照旧；台账是它旁边的新索引，靠 assumptionId 关联，
// 一条假设可以拆成几条命题（forte-keep-on-switch → 心、卜灵两条）。等命题覆盖了全部假设，再由台账反过来生成假设表（DD-08 之后）。
//
// 首批命题（DD-04 §3.2，DD04-Q4 选 A）只收两类：
//   ① 敏感度矩阵能翻的 15 个取值（sensitivity.ts 的 flipsOf()）涉及的 15 条，照 DD-04 §3.2 的表；
//   ② 代表轴基准运行碰到的其余假设，各一条：只有一个已实现的候选，候选未列全。代表轴 m0-video-eq-不打谐破.yaml 要等 DD-02 的严格入口
//      与 DD-04 T04-9 才有，这里按 m0-video-eq.yaml 覆盖 tuneBreak: off 实际跑一遍的 summary.assumptions 定（2026-11-15，20261019 数据）：
//      wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release（另外碰到的 hitstop-in-global-stop、echo-input-priority 在 ① 里；
//      tunability-base 只在偏谐值累积时碰到，关掉谐破碰不到）。T04-9 有了正式的场景后按它重查（tests/propositions.test.ts"代表轴碰到的假设"）。
//
// 证据：先只迁移假设表的"依据"（why）原文（DD-04 §1），一条命题一条，id 为 legacy:<命题 ID>。原文没拆成逐条观测，不分支持的是哪个候选，
// 用途也没标，所以三种关系都空、用途 unspecified（未查明用途的旧依据不计入独立检验）、游戏版本"未知"（路线图 §5.4）。
// 正式的证据条目由 DD-08 的闭环判定后另加；结论因此一律 unverified（DD-08 §4.1 决策表第 1 行：没有可评估的观测）。
import type { CharName } from '../data/common'
import { assumptionOf, type AssumptionId, type Impact } from './assumptions'

/** 证据的用途（路线图 §5.1）：given 是输入、不参与判断；formulation 提出模型；selection 挑选候选；independent_validation 独立检验；
 *  unspecified 未标注（缺省）。参与过提出或挑选读法的证据不能当独立检验 */
export type EvidencePurpose = 'given' | 'formulation' | 'selection' | 'independent_validation' | 'unspecified'
/** 命题的当前结论（路线图 §5.1；DD-08 §4.1 的决策表）：supported 证实（所测条件内）、refuted 否定、ambiguous 分不清、
 *  provisional 暂定（只有建模证据）、unverified 未验证、conflicted 证据冲突、outOfScope 超出模型 */
export type Conclusion = 'supported' | 'refuted' | 'ambiguous' | 'provisional' | 'unverified' | 'conflicted' | 'outOfScope'
/** 候选改变的是什么（架构 §8.2、§11.4）：mechanism 游戏机制、data 数据的读法、policy 操作策略、input 轴的输入 */
export type CandidateChange = 'mechanism' | 'data' | 'policy' | 'input'
/** 场景的特征（由 PreparedRun 算，DD-04 §5.2）：候选的 conflictsWith 里任意一项命中就冲突 */
export type ScenarioFeature =
  | 'strictEntry' | 'hasManualTuneBreak' | 'hasAutoTuneBreak' | 'hasFillerOrOptional' | 'hasForcedIntervention'

/** 一个候选怎么落到运行上（DD-04 §3.1）：
 *  - rule：Rules 下的路径（不带 rules. 前缀，可以多段，如 'forteKeepOnSwitchBy.心'）与取值，经 RunOverrides.rules 翻；
 *    forteKeepOnSwitchBy.<角色> 的当前生效值经 forteKept 读，不直接读表（DF-05）；
 *  - option：场景 options 下的键（'inputDelay'）与取值，经 RunOverrides.options 翻；
 *  - curated：写在手写数据里；hook：写在代码里（角色模块的钩子或引擎）。path 写文件与符号，不写行号。这两种现在不能自动翻：
 *    只有当前采用的那个 implemented 为 true（照现在的代码跑），别的读法记 unimplemented；
 *  - unimplemented：还没有实现、不能运行的读法，照样入账 */
export interface Binding {
  readonly kind: 'rule' | 'option' | 'curated' | 'hook' | 'unimplemented'
  readonly path?: string
  readonly value?: number | boolean | string
}

export interface Candidate {
  readonly id: string
  readonly label: string
  readonly implemented: boolean                         // 现在的代码能不能直接运行
  readonly changes: CandidateChange                     // 这个候选改变的是什么
  readonly conflictsWith?: readonly ScenarioFeature[]   // 场景有其中任意一个特征就冲突
  readonly binding: Binding
}

/** 一条证据（架构 §8.1）：挂在具体候选与条件上，三种关系填候选 ID。supports 支持（相对它反驳的候选而言）、refutes 反驳、
 *  consistentWith 相容但区分不了（两个候选都预测到同一个观测值时，对它们都是 consistentWith，不是 supports） */
export interface Evidence {
  readonly id: string
  readonly supports: readonly string[]
  readonly refutes: readonly string[]
  readonly consistentWith: readonly string[]
  readonly purpose: EvidencePurpose
  /** 观测对应的游戏版本（不详写"未知"；不是 xlsx 的文件日期）、日期与条件（配装、敌人、初态…） */
  readonly observation: { readonly gameVersion: string; readonly recordedAt?: string; readonly condition: string }
  readonly simulationRunId?: string                     // 引用完整的运行身份（runId），不另存一份缩减的
  readonly summary: string
  readonly ref: string
}

/** 字段出处（架构 §8.1）：只给正在研究的字段填，不铺到全库；定位用符号与数据身份，不写裸行号 */
export interface FieldProvenance {
  readonly fieldKey: string
  readonly rawSources: readonly {
    readonly sourceKind: 'xlsx' | 'nanoka' | 'wuwalab' | 'wuthery' | 'inGameText' | 'video'
    readonly dataIdentityRef: string
    readonly locator: string
    readonly rawValue: string | number | null
  }[]
  readonly transform: { readonly buildRule?: string; readonly curatedSymbol?: string; readonly rationale: string }
}

export interface Proposition {
  readonly id: string
  readonly proposition: string                          // 能单独证伪的游戏事实，不抄假设表的"现在怎么处理"
  readonly scope: 'shared' | 'character' | 'data' | 'policy' | 'conditioning'
  readonly executionConvention?: string                 // 关联的执行约定及其可观测后果
  /** 当前采用的候选：恰有一个候选的 id 等于它；rule / option 绑定的，它的 binding.value 等于规则 / 选项的缺省值 */
  readonly adopted: string
  readonly candidatesExhaustive: boolean                // false = 候选未列全（知道还有别的读法，或不知道有没有）
  readonly candidates: readonly Candidate[]
  readonly evidence: readonly Evidence[]
  readonly conclusion: Conclusion
  /** dps 沿用假设表的影响等级；threshold 会不会改变门槛（能不能变奏、能不能开大）；timingFrames 时序差多少帧。不知道的写 unknown，不估 */
  readonly impact: { readonly dps: Impact; readonly threshold?: 'none' | 'introOrUlt' | 'unknown'; readonly timingFrames?: number | 'unknown' }
  readonly fieldProvenance?: FieldProvenance
  /** 对应的旧假设 ID（assume() 记的那个）。一条假设可以对应几条命题 */
  readonly assumptionId?: AssumptionId
  /** 这条命题只在这些角色在队里时才有意义；不写 = 不限 */
  readonly appliesToChars?: readonly CharName[]
}

/** 从假设表迁移来的依据（见文件开头）：why 与出处照搬，三种关系都空、用途未标注 */
const legacy = (proposition: string, a: AssumptionId): Evidence => {
  const x = assumptionOf(a)!
  return {
    id: `legacy:${proposition}`, supports: [], refutes: [], consistentWith: [], purpose: 'unspecified',
    observation: { gameVersion: '未知', condition: `假设表 ${a} 的依据原文，没拆成逐条观测` },
    summary: x.why, ref: x.ref,
  }
}
/** 假设表的 DPS 影响等级（DD-04 §3.2：impact 沿用假设表的等级，另补门槛与时序） */
const dpsOf = (a: AssumptionId): Impact => assumptionOf(a)!.impact
const UNKNOWN = { threshold: 'unknown', timingFrames: 'unknown' } as const

export const PROPOSITIONS = [
  // ---------------------------------------------------------------------------
  // ① 敏感度矩阵能翻的 15 个取值涉及的（DD-04 §3.2 的表）
  {
    id: 'def-floor', assumptionId: 'def-no-floor', scope: 'shared',
    proposition: '结算伤害时，目标防御在减防、无视防御之后不取整，直接代入防御区',
    adopted: 'none', candidatesExhaustive: false,             // 取整还有别的写法（四舍五入、乘完无视防御再取整），没列
    candidates: [
      { id: 'none', label: '不取整', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'defFloor', value: false } },
      { id: 'floor', label: '先取整（同物理、谐度破坏的公式：减防后的防御向下取整，再乘无视防御）', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'defFloor', value: true } },
    ],
    evidence: [legacy('def-floor', 'def-no-floor')], conclusion: 'unverified',
    impact: { dps: dpsOf('def-no-floor'), threshold: 'none', timingFrames: 0 },   // 只有伤害公式的防御区读它（formula.ts 的 defFactor），不碰资源与时序
  },
  {
    id: 'effect-tick-timer', assumptionId: 'effect-tick', scope: 'shared',
    proposition: '异常效应的定时结算（电磁效应每 5 秒一次）从第一次附加起计时，之后再附加不重置计时',
    adopted: 'from-first', candidatesExhaustive: false,       // 结算后减层的取整（单数层）是另一个点，不在这两个候选里（DD-04 §3.2）
    candidates: [
      { id: 'from-first', label: '从第一次附加起计时，之后不重置', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'effectTickReset', value: false } },
      { id: 'reset-on-apply', label: '每次附加都重新计时一个周期', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'effectTickReset', value: true } },
    ],
    evidence: [legacy('effect-tick-timer', 'effect-tick')], conclusion: 'unverified',
    impact: { dps: dpsOf('effect-tick'), ...UNKNOWN },
  },
  {
    id: 'effect-owner', assumptionId: 'effect-owner', scope: 'shared',
    proposition: '异常效应定时结算的伤害记在最后一次附加它的角色名下，吃这个角色身上的加深与最终伤害',
    adopted: 'last', candidatesExhaustive: false,             // 原文没说算谁的；按别的规则分（如几个人分摊）的读法没列
    candidates: [
      { id: 'last', label: '最后一次附加的人', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'effectOwner', value: 'last' } },
      { id: 'first', label: '第一次附加的人', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'effectOwner', value: 'first' } },
      { id: 'onField', label: '结算时在前台的人', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'effectOwner', value: 'onField' } },
    ],
    evidence: [legacy('effect-owner', 'effect-owner')], conclusion: 'unverified',
    impact: { dps: dpsOf('effect-owner'), ...UNKNOWN },
  },
  {
    // 共享的 rules.forteKeepOnSwitch 拆成心、卜灵两条（架构 §8.3；verify-guide B1、B2 分开测）；当前生效值经 forteKept 读
    id: 'forte-keep.心-照世相', assumptionId: 'forte-keep-on-switch', scope: 'character', appliesToChars: ['心'],
    proposition: '心转相后切走，照世相与心相心生保留：再切回来仍是照世相、仍在心相心生里',
    adopted: 'keep', candidatesExhaustive: false,             // 状态有好几样（照世相、心相心生、统御众机…），只清一部分的读法没列
    candidates: [
      { id: 'keep', label: '保留', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'forteKeepOnSwitchBy.心', value: true } },
      { id: 'clear', label: '切走回到应世相、退出心相心生', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'forteKeepOnSwitchBy.心', value: false } },
    ],
    evidence: [legacy('forte-keep.心-照世相', 'forte-keep-on-switch')], conclusion: 'unverified',
    impact: { dps: dpsOf('forte-keep-on-switch'), ...UNKNOWN },
  },
  {
    id: 'forte-keep.卜灵-卦象', assumptionId: 'forte-keep-on-switch', scope: 'character', appliesToChars: ['卜灵'],
    proposition: '卜灵切走时，已有的卦象（艮、震）与少阳 / 少阴保留：再切回来还在',
    adopted: 'keep', candidatesExhaustive: false,             // 只清一部分（如保留卦象、清掉少阳 / 少阴）的读法没列
    candidates: [
      { id: 'keep', label: '保留', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'forteKeepOnSwitchBy.卜灵', value: true } },
      { id: 'clear', label: '切走清掉卦象、少阳 / 少阴', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'forteKeepOnSwitchBy.卜灵', value: false } },
    ],
    evidence: [legacy('forte-keep.卜灵-卦象', 'forte-keep-on-switch')], conclusion: 'unverified',
    impact: { dps: dpsOf('forte-keep-on-switch'), ...UNKNOWN },
  },
  {
    id: 'ult-input-locks-switch', assumptionId: 'ult-no-switch', scope: 'shared',
    proposition: '大招没写"第 n 帧前不能切人"时，"第 n 帧前不响应输入"期间同样不能切人',
    adopted: 'locks', candidatesExhaustive: true,
    candidates: [
      { id: 'locks', label: '不响应输入也挡切人', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'ultInputLocksSwitch', value: true } },
      { id: 'free', label: '不挡切人', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'ultInputLocksSwitch', value: false } },
    ],
    evidence: [legacy('ult-input-locks-switch', 'ult-no-switch')], conclusion: 'unverified',
    impact: { dps: dpsOf('ult-no-switch'), ...UNKNOWN },
  },
  {
    id: 'invincible-locks-switch', assumptionId: 'switch-no-lock', scope: 'shared',
    proposition: '写了"无敌期间不能切人"等、没给帧数的切人限制的动作，到无敌结束（没有无敌帧的到动作结束）之前不能切人',
    adopted: 'locks', candidatesExhaustive: false,            // 锁的长度不一定等于无敌（散华大招无敌 125 帧、"第91F前不能切人"），别的长度没列
    candidates: [
      { id: 'locks', label: '锁到无敌结束（没有无敌帧的到动作结束）', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'invincibleLocksSwitch', value: true } },
      { id: 'free', label: '不锁', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'invincibleLocksSwitch', value: false } },
    ],
    evidence: [legacy('invincible-locks-switch', 'switch-no-lock')], conclusion: 'unverified',
    impact: { dps: dpsOf('switch-no-lock'), ...UNKNOWN },
  },
  {
    id: 'switch-ends-stop', assumptionId: 'switch-ends-stop', scope: 'shared',
    proposition: '写了"第 n 帧前不能切人"、且 n 早于全局时停结束帧的大招，过了第 n 帧能切人，切人时剩余的时停随之结束',
    adopted: 'ends', candidatesExhaustive: false,             // 命题有两点：过了第 n 帧能切、切人时时停结束。"能切、时停照样走完"没列
    candidates: [
      { id: 'ends', label: '过了第 n 帧能切，切人时时停一起结束', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'switchEndsStop', value: true } },
      { id: 'blocks', label: '全局时停整段挡切人', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'switchEndsStop', value: false } },
    ],
    evidence: [legacy('switch-ends-stop', 'switch-ends-stop')], conclusion: 'unverified',
    impact: { dps: dpsOf('switch-ends-stop'), ...UNKNOWN },
  },
  {
    id: 'hitstop-in-global-stop', assumptionId: 'hitstop-in-global-stop', scope: 'shared',
    proposition: '大招过场的全局时停期间（战斗时钟停住），新命中的攻击顿帧不拖慢角色自己与队友的动作',
    adopted: 'ignored', candidatesExhaustive: true,
    candidates: [
      { id: 'ignored', label: '不拖慢', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'hitstopInGlobalStop', value: false } },
      { id: 'applies', label: '照样拖慢自己与队友的局部帧', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'hitstopInGlobalStop', value: true } },
    ],
    evidence: [legacy('hitstop-in-global-stop', 'hitstop-in-global-stop')], conclusion: 'unverified',
    impact: { dps: dpsOf('hitstop-in-global-stop'), ...UNKNOWN },
  },
  {
    id: 'echo-input-priority', assumptionId: 'echo-input-priority', scope: 'shared',
    proposition: '声骸起手时按优先级 5（通用块"召唤声骸 / 变身声骸"行）和当前动作比：能打断重击（4）与多数技能的后摇',
    adopted: 'generic-5', candidatesExhaustive: false,        // 起手优先级取别的值、按声骸分的读法没列
    candidates: [
      { id: 'generic-5', label: '按通用块的 5', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'echoInputPriority', value: true } },
      { id: 'echo-table', label: '按声骸表各行的优先级（多为 0）：等当前动作结束或进同级派生窗口', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'echoInputPriority', value: false } },
    ],
    evidence: [legacy('echo-input-priority', 'echo-input-priority')], conclusion: 'unverified',
    impact: { dps: dpsOf('echo-input-priority'), ...UNKNOWN },
  },
  {
    id: 'interference-frames', assumptionId: 'resonance-rules', scope: 'shared',
    proposition: '谐度破坏命中挂着震谐·偏移的目标后，目标的震谐·干涉持续 8 秒（480 帧）',
    adopted: '480', candidatesExhaustive: false,              // 时长是连续的量，只列了两个
    candidates: [
      { id: '480', label: '8 秒', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'interferenceFrames', value: 480 } },
      { id: '300', label: '5 秒（同普通谐破冷却）', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'interferenceFrames', value: 300 } },
    ],
    evidence: [legacy('interference-frames', 'resonance-rules')], conclusion: 'unverified',
    impact: { dps: dpsOf('resonance-rules'), ...UNKNOWN },
  },
  {
    id: 'track-no-consume', assumptionId: 'track-no-consume', scope: 'character', appliesToChars: ['爱弥斯'],
    proposition: '爱弥斯过载后的第一次光翼共奏不移除震谐轨迹，并照样按轨迹的层数加成',
    adopted: 'kept', candidatesExhaustive: true,
    candidates: [
      { id: 'kept', label: '照样按层数加成', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'trackNoConsume', value: true } },
      { id: 'consumed', label: '这一次拿不到轨迹加成（第二次照常）', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'trackNoConsume', value: false } },
    ],
    evidence: [legacy('track-no-consume', 'track-no-consume')], conclusion: 'unverified',
    impact: { dps: dpsOf('track-no-consume'), ...UNKNOWN },
  },
  {
    id: 'summon-as-char', assumptionId: 'summon-as-char', scope: 'shared',
    proposition: '阵、召唤物（卜灵五雷荡煞阵的冲击波等）附加的异常效应算"队伍中的角色附加"：会触发"附加…后"的效果，心会把溢出的电磁爆发转成霆心域',
    adopted: 'counts', candidatesExhaustive: false,           // 中 3 录像那一次踏月归心介于两种之间，只算一部分的读法没列
    candidates: [
      { id: 'counts', label: '算角色附加', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'summonCountsAsChar', value: true } },
      { id: 'not', label: '都不算（不触发、心不转霆心域，电磁爆发留在目标上）', implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'summonCountsAsChar', value: false } },
    ],
    evidence: [legacy('summon-as-char', 'summon-as-char')], conclusion: 'unverified',
    impact: { dps: dpsOf('summon-as-char'), ...UNKNOWN },
  },
  {
    id: 'input-delay', assumptionId: 'earliest-frame', scope: 'policy',
    proposition: '每个决策点（切人、不是连段后续的出招）在合法的那一帧就执行，没有反应时间',
    executionConvention: 'options.inputDelay = N：决策点在合法之后再晚 N 帧执行；连段后续玩家会预输入，不加',
    adopted: '0', candidatesExhaustive: false,                // 延迟是连续的量，只列了 0 与 6
    candidates: [
      { id: '0', label: '最早合法帧', implemented: true, changes: 'policy', binding: { kind: 'option', path: 'inputDelay', value: 0 } },
      { id: '6', label: '每个决策点晚 6 帧', implemented: true, changes: 'policy', binding: { kind: 'option', path: 'inputDelay', value: 6 } },
    ],
    evidence: [legacy('input-delay', 'earliest-frame')], conclusion: 'unverified',
    impact: { dps: dpsOf('earliest-frame'), ...UNKNOWN },
  },
  {
    // auto 是调度策略，off 让轴里手写的谐破放不出来（和场景输入冲突），所以它不进严格轴的主表（DD-04 §3.2）
    id: 'tune-break-mode', assumptionId: 'tune-break-auto', scope: 'policy',
    proposition: '谐度破坏的放法：目标失谐、按钮亮着时由前台角色在下一条指令之前放（队首是连段后续时等这串打完）',
    adopted: 'auto', candidatesExhaustive: true,              // 引擎的三种放法都列了
    candidates: [
      { id: 'auto', label: '自动：目标失谐就由前台角色放', implemented: true, changes: 'policy', conflictsWith: ['strictEntry'], binding: { kind: 'option', path: 'tuneBreak', value: 'auto' } },
      { id: 'manual', label: '只放轴里写的（偏谐值照常累积）', implemented: true, changes: 'policy', binding: { kind: 'option', path: 'tuneBreak', value: 'manual' } },
      { id: 'off', label: '不放（偏谐值不累积）', implemented: true, changes: 'input', conflictsWith: ['hasManualTuneBreak'], binding: { kind: 'option', path: 'tuneBreak', value: 'off' } },
    ],
    evidence: [legacy('tune-break-mode', 'tune-break-auto')], conclusion: 'unverified',
    impact: { dps: dpsOf('tune-break-auto'), ...UNKNOWN },
  },

  // ---------------------------------------------------------------------------
  // ② 代表轴碰到的其余假设：只有一个已实现的候选（现在的做法），候选未列全（DD-04 §3.2）
  {
    id: 'wait-settled', assumptionId: 'wait-settled', scope: 'policy',
    proposition: '玩家等前一个动作出手（该生成的判定、延奏都生成了）再出下一招：没等它出手就出下一招，还没生成的判定会丢',
    executionConvention: '调度器缺省等出手（等待代码 settled）；轴里在动作后面写 ! 强制抢帧，还没生成的判定作废',
    adopted: 'settled', candidatesExhaustive: false,
    candidates: [
      { id: 'settled', label: '等出手再出下一招', implemented: true, changes: 'policy', binding: { kind: 'hook', path: 'src/engine/scheduler.ts（等待代码 settled）；src/engine/kernel.ts settled' } },
    ],
    evidence: [legacy('wait-settled', 'wait-settled')], conclusion: 'unverified',
    impact: { dps: dpsOf('wait-settled'), ...UNKNOWN },
  },
  {
    id: 'dilation-rules', assumptionId: 'dilation-rules', scope: 'shared',
    proposition: '时间膨胀按类型作用：攻击顿帧在同一单位上新的替换旧的，buff 时停与之并存，全局时停停住战斗时钟，极限闪避的减速随取消解除',
    adopted: 'table', candidatesExhaustive: false,
    candidates: [
      // 场景里 options.rules.dilation 能逐类改，但没有整体翻的取值，按"写在代码里的缺省表"登记
      { id: 'table', label: '按 rules.dilation 的缺省表', implemented: true, changes: 'mechanism', binding: { kind: 'hook', path: 'src/data/gamedata.ts DEFAULT_RULES.dilation；src/engine/kernel.ts registerDilation' } },
    ],
    evidence: [legacy('dilation-rules', 'dilation-rules')], conclusion: 'unverified',
    impact: { dps: dpsOf('dilation-rules'), ...UNKNOWN },
  },
  {
    id: 'summon-clock', assumptionId: 'summon-clock', scope: 'shared',
    proposition: '召唤类（脱手）声骸按战斗时钟走，不被队友的时停冻住',
    adopted: 'battle-clock', candidatesExhaustive: false,
    candidates: [
      { id: 'battle-clock', label: '按战斗时钟走', implemented: true, changes: 'mechanism', binding: { kind: 'hook', path: 'src/engine/kernel.ts advanceActions（召唤类的尾部按战斗时钟推进）' } },
    ],
    evidence: [legacy('summon-clock', 'summon-clock')], conclusion: 'unverified',
    impact: { dps: dpsOf('summon-clock'), ...UNKNOWN },
  },
  {
    id: 'white-bar', assumptionId: 'white-bar', scope: 'shared',
    proposition: '敌人白条的上限按削韧值算（prop 的 RageMax ÷ 100），瘫痪结束时回满',
    adopted: 'rage-max', candidatesExhaustive: false,
    candidates: [
      { id: 'rage-max', label: '上限 RageMax ÷ 100，瘫痪后回满', implemented: true, changes: 'mechanism', binding: { kind: 'hook', path: 'tools/build/enemies.py（whiteBarTough）；src/engine/enemy.ts（打空白条、瘫痪结束）' } },
    ],
    evidence: [legacy('white-bar', 'white-bar')], conclusion: 'unverified',
    impact: { dps: dpsOf('white-bar'), ...UNKNOWN },
  },
  {
    id: 'data-guess', assumptionId: 'data-guess', scope: 'data',
    proposition: '构建时推断出来、还没确认的数据值（flag 标出的优先级变化帧、段数、动作类别…）与游戏一致（兜底项：逐个确认后在角色模块里覆盖或 accept）',
    adopted: 'as-inferred', candidatesExhaustive: false,
    candidates: [
      { id: 'as-inferred', label: '照推断用', implemented: true, changes: 'data', binding: { kind: 'curated', path: 'data/generated 的 flag（pnpm check:data -- --flags <角色>）；data/curated/characters 的 actionOverrides' } },
    ],
    evidence: [legacy('data-guess', 'data-guess')], conclusion: 'unverified',
    impact: { dps: dpsOf('data-guess'), ...UNKNOWN },
  },
  {
    id: 'burst-release', assumptionId: 'burst-release', scope: 'character', appliesToChars: ['散华'],
    proposition: '散华的重击爆裂按住普攻半秒（30 帧）松手就能打出：按住的时间不随透视层数变，也不会因为没对上冰痕区域打成普通重击',
    adopted: 'hold-30', candidatesExhaustive: false,
    candidates: [
      { id: 'hold-30', label: '按住 30 帧再松手', implemented: true, changes: 'mechanism', binding: { kind: 'curated', path: 'data/curated/characters/散华.ts HOLD' } },
    ],
    evidence: [legacy('burst-release', 'burst-release')], conclusion: 'unverified',
    impact: { dps: dpsOf('burst-release'), ...UNKNOWN },
  },
] as const satisfies readonly Proposition[]

export type PropositionId = (typeof PROPOSITIONS)[number]['id']

export const propositionOf = (id: string): Proposition | undefined => PROPOSITIONS.find(p => p.id === id)
