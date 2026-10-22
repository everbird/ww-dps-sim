// src/engine/types.ts —— 仿真引擎的输入、运行时状态、事件与汇总（TD-02 §7）
// 纯内部类型：不跨进程边界，不用 zod。所有状态都是可 structuredClone 的纯数据（总设计 §3.7）。
import type { TrackedId } from './assumptions'
import type {
  ActionId, Chain, CharName, DamageTag, DilationSide, DilationType, EffectName, Element, Frame, Rank, ResourceKind, Slot,
  StatKey, ZoneId,
} from '../data/common'
import type { BuffDef, EnemyStateChange, ResourceEffect } from '../data/buff.schema'
import type { ActionDef, CharacterDef, EchoDef, EnemyPreset, GameData, JudgmentDef, Rules, WeaponDef } from '../data/gamedata'
import type { Command } from '../data/scenario.schema'
import type { RngState } from './rng'

// ---------------------------------------------------------------------------
// 装配结果 ResolvedScenario（总设计 §3.3）：仿真过程中只读

/** 五个核心资源槽（下标 = 槽号 − 1） */
export type Core5 = [number, number, number, number, number]

export interface ResolvedScenario {
  data: GameData
  team: [ResolvedMember, ResolvedMember, ResolvedMember]
  enemy: EnemyPreset
  buffs: RegisteredBuff[]                   // 常驻实例 + 触发监听器，已按共鸣链过滤、按谐振阶取值
  effects: RegisteredEffect[]               // 资源型触发效果（TD-07 §9），同上
  commands: Command[]
  opening: Command[]                        // 启动轴（TD-09 §3.7）
  initial: { energy: [number, number, number]; concerto: [number, number, number]; onField: Slot; core: [Core5, Core5, Core5] }   // core：各槽开局值（下标 = 槽号 − 1）
  rules: Rules
  /** 对这个敌人：谐度破坏命中后多久不能累积偏谐值（谐破冷却，按 COST）、按钮亮多久（null = 不限时）；战斗帧（m0-confirm §10 H2、H4） */
  tuneBreakTiming: { lockFrames: Frame; buttonFrames: Frame | null }
  options: {
    repeat: number; maxFrames: Frame; maxWait: Frame; endAt?: Frame; tuneBreak: 'auto' | 'manual' | 'off'; inputDelay: Frame
    /** 只给循环轴的某几条另加操作延迟（"第几条.第几个" → 帧，每轮都加）：结论的卡帧点（TD-10 §6 ⑥）一次晚一条用；场景里写不出来 */
    inputDelayAt?: Readonly<Record<string, Frame>>
  }
  warnings: string[]                        // 装配期警告（数据版本不符、未处理的 flag…）
}

export interface ResolvedMember {
  slot: Slot
  def: CharacterDef
  chain: Chain
  weapon: { def: WeaponDef; rank: Rank }
  echoes: { def: EchoDef | null; set: string; main: StatValues; subs: StatValues }[]   // 第一个是首位声骸（技能 Q）；
                                            // def 为 null：不在声骸表里的非首位声骸（只计入词条与套装）
  panel: StaticPanel
  actions: Record<ActionId, ActionDef>      // 角色动作 + 体型通用动作 + 首位声骸动作
  aliases: Record<string, ActionId>         // 角色别名 + 'Q'（首位声骸技能）
}

export type StatValues = Partial<Record<StatKey, number>>

/** 静态面板只放"面板类"乘区；带过滤条件的加成（元素 / 类型伤害加成等）一律转成常驻 buff 实例 */
export interface StaticPanel {
  hp: StatParts
  atk: StatParts
  def: StatParts
  critRate: number
  critDamage: number
  energyRegen: number
  healBonus: number
  tunabilityRate: number
  harmonyBreakBoost: number
}
/** 最终值 = base × (1 + pct) + flat；战斗中的 atkPct 等 buff 在命中时再叠加 */
export interface StatParts { base: number; pct: number; flat: number }

export interface RegisteredBuff {
  def: BuffDef
  value: number                             // 已按武器谐振阶选定；标记型为 0
  owner: Slot | 'env'                       // 'env' = 场景 buff
}

export interface RegisteredEffect {
  def: ResourceEffect
  amount: number                            // 已按武器谐振阶选定
  owner: Slot
}

// ---------------------------------------------------------------------------
// 运行时状态 SimState（总设计 §5.3）：循环内直接修改

export interface SimState {
  frame: number                             // 世界帧
  battleFrames: number                      // 战斗时钟（DPS 分母）
  onField: Slot
  switchCd: Frame
  chars: [CharRuntime, CharRuntime, CharRuntime]
  judgments: JudgmentRuntime[]              // 场上存活的判定
  tails: TailRuntime[]                      // 脱离动作、按战斗时钟继续的时间线事件（TD-04 §4.4）
  buffs: BuffRuntime[]
  enemy: EnemyRuntime
  dilations: DilationRuntime[]
  queue: QueueState
  log: SimEvent[]
  nextId: number                            // 判定 / buff / 动作实例的递增编号
  outroLinks: { introInstance: number; from: Slot }[]   // 变奏动作实例 → 延奏的发出者（TD-05 §3）
  pendingNextIn: { owner: Slot | 'env'; defId: string; stacks: number }[]   // 挂起到下一次切入的 nextIn buff（TD-07 §3）
  lastTrigger: Record<string, number>       // "持有者|定义 id" → 上次触发成功的战斗帧（内置冷却，TD-07 §4.4）
  /** 这次碰到的假设（总设计 T16）：假设 id → 次数、第一次的战斗帧、几个例子（src/engine/assumptions.ts 的 assume） */
  assumed: Record<string, { n: number; at: number; detail: string[] }>
  /** 抽样模式的随机数状态（总设计 T4，src/engine/rng.ts）；期望模式为 null */
  rng: RngState | null
  /** 最近一次切入（出场技要它，TD-09 §3.5）：block 为 null = 地面普通切入、入场后还没开始过动作；开场为 null（不算入场） */
  entry: { slot: Slot; block: EntryBlock | null } | null
}
/** 出场技放不出的原因：变奏入场、入场后出过招、切入时自己在后台的动作还没走完、切出者在空中（切入者随之在空中） */
export type EntryBlock = 'intro' | 'acted' | 'busy' | 'air'

/** 调度器的状态（TD-09 §5）：放在 SimState 里，随状态一起 structuredClone */
export interface QueueState {
  commands: Command[]                       // 循环轴
  opening: Command[]                        // 启动轴（第 0 轮，只跑一次；没有为空）
  repeat: number                            // 整条轴执行几轮（options.repeat）
  next: number                              // 队首指令的下标
  loop: number                              // 当前第几轮（从 1 起；启动轴是第 0 轮）
  loopBegun: boolean                        // 本轮的第一条指令是否已生效（生效时记 loop 事件）
  waited: number                            // 队首因"不合法"已经等了几个世界帧（maxWait 计时；+N、wait 不算）
  readyAt: number | null                    // 队首第一次全部合法时的战斗帧（+N、操作延迟从这里起算）
  extra: number | null                      // 队首的操作延迟（options.inputDelay，抽样模式另加抖动）：第一次全部合法时定下，换下一条清空
  until: number | null                      // wait N：到这个战斗帧结束
  seg: WaitSegment | null                   // 正在累计的等待段（原因不变就合成一段）
}
export interface WaitSegment { code: WaitCode; reason: string; from: number; battleFrom: number }

/** 等待原因（TD-09 §3.3）。delay、wait、at 是写轴的人要求的等待，不计入 maxWait */
export type WaitCode =
  | 'started' | 'combo' | 'inputLock' | 'priority' | 'derive'   // gate（TD-04 §6.5）
  | 'cooldown' | 'resource' | 'hook' | 'settled'                 // 冷却、资源（TD-06）、角色钩子（TD-08）、就绪（TD-04 §6.4）
  | 'switchCd' | 'switchLock'                                    // 切人
  | 'delay' | 'wait' | 'at'
  | 'input'                                                     // 操作延迟（options.inputDelay、抽样模式的抖动）
  | 'airborne'                                                  // 切人后第一下是空中动作：等切出者跳起（TD-09 §3.5）
  | 'filler'                                                    // 补位 "~" 不需要了（只用于 skip 事件）

/** 指令在事件里的出处 */
export interface CommandRef { line: number; item: number; loop: number }

export interface CharRuntime {
  slot: Slot
  name: CharName
  action: ActionRuntime | null              // null = 空闲
  last: ActionRuntime | null                // 最近一个动作实例（进行中的就是 action）；结束后局部帧照走，供连段窗口判断（TD-04 §6.2）
  startedThisTick: boolean                  // 同一 tick 同一角色最多开始一个动作（TD-04 §1、§6.5）
  energy: number
  concerto: number
  core: [number, number, number, number, number]
  cooldowns: Record<string, Frame>          // 键：cooldownKey（动作 ID、cooldownGroup 或 'echo'）；按次数充能的是"下一次回复还要多久"
  charges: Record<string, { spent: number; every: Frame }>   // 按次数充能的冷却键：已用掉几次、每次回复要多久（ActionDef.charges）
  vars: HookVars                            // 钩子的状态量：初值是角色模块声明的 vars，只由钩子读写（总设计 §10.1）
}

export interface ActionRuntime {
  id: ActionId
  def: ActionDef
  instance: number                          // 动作实例号，"每个实例只发一次"的依据
  localFrame: number                        // 局部帧，可为小数（总设计 T2）；每次推进后取整到 1e-4
  startedAt: number                         // 世界帧
  cursor: number                            // 时间线（actionTimeline(def)）上下一个待发生事件的下标
  ended: boolean                            // 已结束或被取消（此后只作为 CharRuntime.last 保留）
  coreGranted: [boolean, boolean, boolean]
  cmd?: CommandRef                          // 由哪条指令开始（接续动作继承，TD-08 P10）
  skip?: string[]                           // 钩子跳过的判定名（TD-08 skipJudgments）
}

/** 动作时间线上的一个事件（TD-04 §4.1）：按帧升序，同帧按 gain → dilation → spawn → outro */
export type TimelineEvent =
  | { frame: Frame; kind: 'gain'; index: number }       // def.castGains 下标
  | { frame: Frame; kind: 'dilation'; index: number }   // def.dilations 下标（anchor = 'action'）
  | { frame: Frame; kind: 'spawn'; index: number }      // def.judgments 下标
  | { frame: Frame; kind: 'outro' }

/** 尾部：动作自然结束或被取消后，仍要发生的时间线事件（TD-04 §4.4） */
export interface TailRuntime {
  owner: Slot
  action: ActionId
  def: ActionDef
  instance: number
  localFrame: number                        // 沿用动作的局部坐标，改按战斗时钟推进
  events: TimelineEvent[]
  detached?: true                           // 独立时间线（延奏动作，TD-05 §4.3；召唤类声骸的判定）：不受持有者之后的动作影响
  skip?: string[]                           // 跳过的判定名（同 ActionRuntime.skip）
  noted?: true                              // 召唤物：已记过假设 summon-clock（每条尾部只记一次）
}

export interface JudgmentRuntime {
  id: number
  owner: Slot                               // 出伤者
  action: ActionId
  actionInstance: number
  def: JudgmentDef
  spawnedAt: number                         // 世界帧
  age: number                               // 判定时钟上的年龄（帧，可为小数）：生成时 0，每 tick 结算后推进（TD-04 §5.2）
  ticksDone: number
  detached?: true                           // 由独立时间线生成（延奏动作、召唤类声骸）：不随持有者之后的动作消失（TD-05 §4.3）
}

export interface BuffRuntime {
  id: number
  defId: string
  owner: Slot | 'env'
  target: Slot | 'enemy'
  stacks: number
  remaining: number | 'inf'                 // 战斗帧
  lastTriggerAt: number                     // 战斗帧，用于 icd
}

export interface EnemyRuntime {
  preset: EnemyPreset
  whiteBar: number                          // 按削韧值计（TD-06 §13.2）
  broken: boolean                           // 白条打空、瘫痪中
  paralyzedUntil: number                    // 战斗帧：瘫痪到这一帧结束、白条回满
  poise: number
  tunability: number
  disharmony: boolean                       // 偏谐值满（失谐）
  tunabilityLockedUntil: number             // 战斗帧：谐度破坏后的谐破冷却（真空期），此前不累积偏谐值
  tuneButtonUntil: number                   // 战斗帧：谐度破坏按钮亮到这一帧（不含）；前台角色对失谐目标打出偏谐值不为 0 的伤害时点亮
  tuneBreakBy?: number                      // 消耗这次失谐的谐度破坏动作实例（它的各段伤害按对失谐算）
  shift?: 'zhenxie' | 'jixie'
  interference?: { kind: 'zhenxie' | 'jixie'; stacks: number; remaining: number }
  /** 目标身上的异常效应（TD-06 §18）：层数、额外层（电磁爆发）、剩余战斗帧（全部层数共用，附加时刷新）、下次结算的战斗帧、最后附加的人 */
  effects: Partial<Record<EffectName, EffectRuntime>>
  responseCd: Partial<Record<CharName, number>>
}

/** source：最后附加的人；origin：第一次附加的人（这一次出现以来）。定时结算记在谁名下按 rules.effectOwner（TD-06 §18） */
export interface EffectRuntime { stacks: number; burst: number; remaining: number; nextTick: number; source: Slot; origin: Slot }

/** 一个作用在具体单位上的膨胀窗口（登记时按侧展开：self → 来源角色，ally → 另外两人，enemy → 敌人） */
export interface DilationRuntime {
  type: DilationType
  source: Slot
  side: DilationSide
  target: Slot | 'enemy'
  rate: number
  remaining: number                         // 世界帧；登记后下一 tick 起生效
  hitstop: boolean                          // 按攻击顿帧处理（rules.dilation[type].hitstopSides 含 side）
  instance: number                          // 登记它的动作实例
}

/** 每个 tick 开头算出的速率表（总设计 §6.2、TD-04 §3.1） */
export interface Rates {
  battle: 0 | 1
  chars: [number, number, number]
  enemy: number                             // v0 只记录，不驱动任何计时（TD-06 需要时再用）
}

// ---------------------------------------------------------------------------
// 事件日志（总设计第 9 节）：所有展示都从这里派生

interface EventBase { f: number; t: number }   // 世界帧；战斗秒数

export interface HitEvent extends EventBase {
  type: 'hit'
  char: CharName
  action: ActionId
  judgment: string
  id: number
  tick: number
  element: Element                          // 这次结算最终的元素与标签（modifyHit 之后，TD-07 §4.1）
  tags: DamageTag[]
  /** 非伤害判定为 null。isCrit：抽样模式里这一段暴击了没有（期望模式没有这个字段，计 expected；总设计 T4） */
  dmg: { nonCrit: number; crit: number; expected: number; isCrit?: boolean } | null
  factors?: HitFactors
  buffs: string[]                           // 生效的 buff，"id×层数"
  gains: { energy: Partial<Record<CharName, number>>; concerto: number; core: number[] }
  enemy?: { tunability: number; whiteBar: number }   // 这次结算之后敌人的偏谐值与白条（有量表的敌人才记，TD-06 §14；时间轴网页画曲线用）
  /** 异常效应自身的伤害（定时结算、钩子主动触发，TD-06 §18）：action 是效应名，没有判定（id 是新编号）；不给资源、不触发"命中时"的效果 */
  effect?: EffectName
}

/** 公式各项系数（TD-03 §8：非暴击分支的各项；critDamage 是暴击分支的暴伤） */
export interface HitFactors {
  base: number; def: number; bonus: number; res: number; reduce: number; special: number
  amplify: number; final: number; critRate: number; critDamage: number
}

export type SimEvent =
  | (EventBase & { type: 'actionStart'; char: CharName; action: ActionId; instance: number; cmd?: CommandRef; dropped?: string[] })
  | (EventBase & { type: 'actionEnd'; char: CharName; action: ActionId; instance: number })
  | (EventBase & { type: 'actionCancel'; char: CharName; action: ActionId; instance: number; by: ActionId; dropped: string[] })
  | (EventBase & { type: 'judgmentSpawn'; char: CharName; action: ActionId; judgment: string; id: number; note?: string })   // note：钩子生成时附的说明
  | HitEvent
  | (EventBase & { type: 'switch'; from: CharName; to: CharName; intro: boolean; cmd?: CommandRef })
  | (EventBase & { type: 'intro'; char: CharName; action: ActionId })
  // outro：char = 延奏的发出者（切出者），to = 这次变奏的角色；instance = 延奏动作独立时间线的实例号（TD-05 §6）
  | (EventBase & { type: 'outro'; char: CharName; to: CharName; instance?: number })
  | (EventBase & { type: 'buffApply'; buff: string; target: CharName | 'enemy'; stacks: number; remaining: number | 'inf' })
  | (EventBase & { type: 'buffExpire'; buff: string; target: CharName | 'enemy'; reason: 'timeout' | 'switchOut' | 'removed' })
  // cause：cast / cost / hook / break / outro，或资源型效果的 id；note：钩子给的说明（ctx.addResource 的第 4 个参数）
  | (EventBase & { type: 'resource'; char: CharName; resource: ResourceKind; delta: number; value: number; cause: string; note?: string })
  | (EventBase & { type: 'resourceFull'; char: CharName; resource: 'energy' | 'concerto' })   // TD-06 §6
  // 治疗：char 提供了一次治疗（标了 heals 的判定结算、钩子记的持续回复每一跳）；治疗量不建模，只用来触发"提供治疗时"的效果
  | (EventBase & { type: 'heal'; char: CharName; source: string })
  // effectApplied（TD-06 §18）：by 谁附加的，added 这次加了几层、stacks 加完是几层；有额外层（电磁爆发）的效应另记 burstAdded、burst。
  // effectEnd：effect 到时消失。effectConsumed：被技能消耗了层数（心消耗电磁爆发），stacks、burst 是之后剩下的。
  // by 是触发"附加…后"的发出者
  | (EventBase & {
    type: 'enemyState'; change: EnemyStateChange; detail?: string
    by?: CharName; effect?: EffectName; added?: number; stacks?: number; burstAdded?: number; burst?: number
  })
  // 异常效应定时结算了一次（TD-06 §18）：stacks、burst 是结算时的层数，left 是结算后剩下的层数（电磁爆发清零）；
  // 伤害另记一条 hit（effect 字段），这里的 damage 只是抄一份，汇总不算它；source 是记在谁名下
  | (EventBase & { type: 'effectTick'; effect: EffectName; stacks: number; burst?: number; left: number; damage: number; source: CharName })
  | (EventBase & { type: 'wait'; cmd: CommandRef; code: WaitCode; reason: string; from: number; frames: number; battleFrames: number })
  // 可选指令（排轴里写 "?"）的条件不满足，跳过了（TD-06 §13.4）
  | (EventBase & { type: 'skip'; cmd: CommandRef; code: WaitCode; reason: string })
  | (EventBase & { type: 'loop'; loop: number })
  // cmd：由哪条指令引起（introMissed：写了"变奏"的切人没变奏）
  | (EventBase & { type: 'warning'; code: string; message: string; line?: number; cmd?: CommandRef })

export type SimEventType = SimEvent['type']

export interface Summary {
  totalDamage: number
  windowFrames: number
  dps: number
  overflowDamage: number
  byChar: Record<CharName, { damage: number; share: number }>
  byAction: { char: CharName; action: ActionId; damage: number; hits: number; share: number }[]
  resourceTimeline: { f: number; energy: [number, number, number]; concerto: [number, number, number] }[]
  buffUptime: Record<string, number>        // 0–1，按战斗时钟
  waits: { line: number; item: number; loop: number; code: WaitCode; frames: number; reason: string }[]
  skipped: { line: number; item: number; loop: number; reason: string }[]   // 跳过的指令：可选 "?" 的条件不满足、补位 "~" 不需要
  warnings: { code: string; message: string; line?: number }[]
  /** 分轮（options.repeat ≥ 2 或有启动轴；总设计 §3.5、TD-09 §3.7 / §3.9）：第 k 轮 = [本轮 loop 事件, 下一轮 loop 事件)，最后一轮到窗口终点；启动轴是第 0 轮，
   *  按战斗帧。资源首尾差 = 下一轮开始时（最后一轮：窗口终点）− 本轮开始时，看这条轴能不能自给 */
  perLoop?: {
    loop: number; start: number; frames: number; damage: number; dps: number
    energyDelta: [number, number, number]; concertoDelta: [number, number, number]
  }[]
  /** 稳态：完整的轮合起来的 DPS——第 2 轮到倒数第 2 轮（第 1 轮受开局资源影响；最后一轮没有下一轮的边界，
   *  等下一轮起手的时间算不进来，偏高）；只有 2 轮时取第 2 轮 */
  steady?: { from: number; to: number; frames: number; damage: number; dps: number }
  /** 敌人量表（TD-06 §13）：窗口内失谐、谐度破坏命中、白条打空的次数，与谐度破坏的伤害 */
  enemy: { disharmony: number; tuneBreaks: number; tuneBreakDamage: number; breaks: number }
  /** 这次碰到的假设（总设计 T16）：按假设表的顺序；每次都适用的（tracked: false）不列，见 ASSUMPTIONS。firstFrame 是战斗帧 */
  assumptions: { id: string; count: number; firstFrame: number; detail: string[] }[]
}

export interface SimResult {
  log: SimEvent[]
  summary: Summary
  /** 共鸣回路的状态说明（钩子 forte）：每个 tick 结束取一次，变了才记；只供时间轴检查器显示，不进日志、不影响仿真 */
  forte: ForteStep[]
  /** 技能冷却（时间轴视图 E 显示）：每个 tick 结束取一次，"什么时候好"或剩几次变了才记；不进日志、不影响仿真 */
  cooldowns: CooldownStep[]
  /** 运行期报错（TD-09 §3.3：等不来、等超时、超过帧数上限）；日志与汇总保留到出错为止 */
  error?: { code: string; message: string; frame: number; line?: number; loop?: number }
}

// ---------------------------------------------------------------------------
// 角色钩子（总设计 §6.9）：规则只用四个，另有只读的显示钩子 forte；ctx 只开放受控操作

/** 从第 f 个世界帧起，char 的共鸣回路状态说明是 text（"卦象 震艮震震 · 少阳"）；空串 = 没什么要说的 */
export interface ForteStep { f: number; char: CharName; text: string }
/** 从第 f 个世界帧起，char 的冷却 key（cooldownKey：动作 ID、冷却组名或 'echo'）从第 ready 个战斗帧起能用（倒计时期间不变）；
 *  null = 现在就能用。按次数充能的另给 charges：现在还剩几次（ready 是下一次回复的时刻，满了为 null） */
export interface CooldownStep { f: number; char: CharName; key: string; ready: number | null; charges?: number }

/** 钩子的状态量：名字 → 数或布尔。在角色模块的 vars 里声明初值，仿真中不能加新键（对应 Rust 的结构体字段，总设计 §10.1） */
export type HookVars = Record<string, number | boolean>

export interface CharacterHooks<V extends HookVars = HookVars> {
  onResolve?(ctx: HookContext<V>): void
  /** 返回 true 表示允许；返回字符串表示不允许及原因（会写进等待日志） */
  canStart?(ctx: HookContext<V>, action: ActionId): true | string
  onEvent?(ctx: HookContext<V>, ev: SimEvent): void
  /** 在收集 buff 之前调用（TD-03 §4）：可改倍率、附加值、元素 / 标签，或直接补乘区值 */
  modifyHit?(ctx: HookContext<V>, hit: HitDraft): void
  /** 共鸣回路的状态说明（只读，不能改状态）：每个 tick 结束调用，返回一行短文本，时间轴的检查器显示。
   *  核心资源的数值检查器按日志另算，这里写状态量、状态 buff 里才有的（卜灵卦象的排列、心是应世相还是照世相…）；不随帧变的才写，免得每帧一条 */
  forte?(ctx: HookContext<V>): string
}

export interface HookContext<V extends HookVars = HookVars> {
  readonly self: Slot
  readonly chain: Chain                     // 本角色的共鸣链数（钩子里按链数分支，如散华 C5）
  readonly state: Readonly<SimState>        // 只读查询；改状态只能走下面的方法
  buffStacks(id: string, target?: Slot | 'enemy'): number   // 0 = 没有
  addBuff(id: string, opts?: { target?: Slot | 'enemy'; stacks?: number }): void   // id 指本角色 buffs 里的定义
  removeBuff(id: string, target?: Slot | 'enemy'): void
  /** note：这笔资源怎么来的（如"每消耗 10 点红椿·蕊"），记进 resource 事件，时间轴与调试表显示出处用 */
  addResource(resource: ResourceKind, amount: number, slot?: Slot, note?: string): void
  /** note：为什么生成（如散华"5 链：冰到时自爆"），记进 judgmentSpawn 事件，时间轴与调试表标"引出原因"用 */
  spawnJudgment(judgment: string, opts?: { action?: ActionId; note?: string }): void
  /** 某个动作实例（或延奏的独立时间线）里不生成这些判定；只对还没生成的有效（TD-08 §3.2） */
  skipJudgments(instance: number, names: string[]): void
  /** 以本角色的名义为目标附加异常效应（TD-06 §18）：层数规则同判定的 applies，记 enemyState effectApplied；note 写进事件的 detail */
  applyEffect(effect: EffectName, stacks: number, note?: string): void
  /** 以本角色的名义主动触发一次异常效应伤害（心的踏月归心）：倍率 = scale × 目标当前层数对应的倍率（不含电磁爆发）。
   *  不算一次结算（不减层、不动电磁爆发、不改下次结算的时刻）；目标没有该效应时不出伤害。judgment 是 hit 事件里的名字，返回伤害 */
  effectDamage(effect: EffectName, scale: number, judgment: string): number
  /** 消耗目标该效应全部的额外层（电磁爆发），返回消耗了几层；有消耗时记 enemyState effectConsumed */
  takeBurst(effect: EffectName, note?: string): number
  /** 本角色的状态量（角色模块的 vars 声明的那几个），直接读写：ctx.vars.盛绽 = true */
  readonly vars: V
  /** 记一次本角色提供的治疗（不在任何判定上的治疗，如持续回复的每一跳）：日志 heal 事件，触发"提供治疗时"的效果 */
  heal(source: string): void
  warn(message: string): void
  /** 记一次碰到的假设（总设计 T16，src/engine/assumptions.ts 里 tracked 的那些）：角色模块里推断着写、还没查证的机制 */
  assume(id: TrackedId, detail?: string): void
}

/** 一次结算的草稿：由判定生成，modifyHit 可改，随后按它的元素 / 标签收集 buff（TD-03 §4） */
export interface HitDraft {
  readonly judgment: JudgmentDef
  readonly char: CharName
  multiplier: number                        // 初值 = judgment.multiplier
  extraFlat: number                         // Formula1：钩子算好的附加基础伤害，初值 0
  element: Element                          // 初值 = judgment.element
  tags: DamageTag[]                         // 初值 = judgment.tags
  effect?: EffectName                       // 异常效应自身的伤害才有
  selfEnergyScale: number                   // 只乘出伤者自己那份能量，队友那 50% 不变；初值 1（TD-06 §2.1，椿含苞实测）
  zones: Partial<Record<ZoneId, number>>    // 钩子直接补的乘区值（与 buff 同样累加）
  critOnly: Partial<Record<ZoneId, number>>
}

/** 乘区累加器：键就是乘区 ID，值是已乘层数的合计；critOnly 只进暴击分支（TD-03 §3.3） */
export interface ZoneAccumulator {
  zones: Record<ZoneId, number>
  critOnly: Record<ZoneId, number>
}
