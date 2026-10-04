// src/engine/types.ts —— 仿真引擎的输入、运行时状态、事件与汇总（TD-02 §7）
// 纯内部类型：不跨进程边界，不用 zod。所有状态都是可 structuredClone 的纯数据（总设计 §3.7）。
import type {
  ActionId, Chain, CharName, DamageTag, DilationSide, DilationType, EffectName, Element, Frame, Rank, ResourceKind, Slot,
  StatKey, ZoneId,
} from '../data/common'
import type { BuffDef, EnemyStateChange, ResourceEffect } from '../data/buff.schema'
import type { ActionDef, CharacterDef, EchoDef, EnemyPreset, GameData, JudgmentDef, Rules, WeaponDef } from '../data/gamedata'
import type { Command } from '../data/scenario.schema'

// ---------------------------------------------------------------------------
// 装配结果 ResolvedScenario（总设计 §3.3）：仿真过程中只读

export interface ResolvedScenario {
  data: GameData
  team: [ResolvedMember, ResolvedMember, ResolvedMember]
  enemy: EnemyPreset
  buffs: RegisteredBuff[]                   // 常驻实例 + 触发监听器，已按共鸣链过滤、按谐振阶取值
  effects: RegisteredEffect[]               // 资源型触发效果（TD-07 §9），同上
  commands: Command[]
  initial: { energy: [number, number, number]; concerto: [number, number, number]; onField: Slot }
  rules: Rules
  options: { repeat: number; maxFrames: Frame; maxWait: Frame; endAt?: Frame; tuneBreak: 'auto' | 'manual' | 'off' }
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
}

/** 调度器的状态（TD-09 §5）：放在 SimState 里，随状态一起 structuredClone */
export interface QueueState {
  commands: Command[]
  repeat: number                            // 整条轴执行几轮（options.repeat）
  next: number                              // 队首指令的下标
  loop: number                              // 当前第几轮（从 1 起）
  loopBegun: boolean                        // 本轮的第一条指令是否已生效（生效时记 loop 事件）
  waited: number                            // 队首因"不合法"已经等了几个世界帧（maxWait 计时；+N、wait 不算）
  readyAt: number | null                    // 队首第一次全部合法时的战斗帧（+N 从这里起算）
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
  flags: Record<string, number | boolean | string>   // 只由钩子读写
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
  tunabilityLockedUntil: number             // 战斗帧：谐度破坏后的真空期，此前不累积偏谐值
  tuneBreakBy?: number                      // 消耗这次失谐的谐度破坏动作实例（它的各段伤害按对失谐算）
  shift?: 'zhenxie' | 'jixie'
  interference?: { kind: 'zhenxie' | 'jixie'; stacks: number; remaining: number }
  effects: Partial<Record<EffectName, { stacks: number; remaining: number; nextTick: number; source: Slot }>>
  responseCd: Partial<Record<CharName, number>>
}

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
  dmg: { nonCrit: number; crit: number; expected: number } | null   // 非伤害判定为 null
  factors?: HitFactors
  buffs: string[]                           // 生效的 buff，"id×层数"
  gains: { energy: Partial<Record<CharName, number>>; concerto: number; core: number[] }
  enemy?: { tunability: number; whiteBar: number }   // 这次结算之后敌人的偏谐值与白条（有量表的敌人才记，TD-06 §14；时间轴网页画曲线用）
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
  | (EventBase & { type: 'judgmentSpawn'; char: CharName; action: ActionId; judgment: string; id: number })
  | HitEvent
  | (EventBase & { type: 'switch'; from: CharName; to: CharName; intro: boolean; cmd?: CommandRef })
  | (EventBase & { type: 'intro'; char: CharName; action: ActionId })
  // outro：char = 延奏的发出者（切出者），to = 这次变奏的角色；instance = 延奏动作独立时间线的实例号（TD-05 §6）
  | (EventBase & { type: 'outro'; char: CharName; to: CharName; instance?: number })
  | (EventBase & { type: 'buffApply'; buff: string; target: CharName | 'enemy'; stacks: number; remaining: number | 'inf' })
  | (EventBase & { type: 'buffExpire'; buff: string; target: CharName | 'enemy'; reason: 'timeout' | 'switchOut' | 'removed' })
  | (EventBase & { type: 'resource'; char: CharName; resource: ResourceKind; delta: number; value: number; cause: string })
  | (EventBase & { type: 'resourceFull'; char: CharName; resource: 'energy' | 'concerto' })   // TD-06 §6
  // 治疗：char 提供了一次治疗（标了 heals 的判定结算、钩子记的持续回复每一跳）；治疗量不建模，只用来触发"提供治疗时"的效果
  | (EventBase & { type: 'heal'; char: CharName; source: string })
  | (EventBase & { type: 'enemyState'; change: EnemyStateChange; detail?: string })
  | (EventBase & { type: 'effectTick'; effect: EffectName; stacks: number; damage: number; source: CharName })
  | (EventBase & { type: 'wait'; cmd: CommandRef; code: WaitCode; reason: string; from: number; frames: number; battleFrames: number })
  // 可选指令（排轴里写 "?"）的条件不满足，跳过了（TD-06 §13.4）
  | (EventBase & { type: 'skip'; cmd: CommandRef; code: WaitCode; reason: string })
  | (EventBase & { type: 'loop'; loop: number })
  | (EventBase & { type: 'warning'; code: string; message: string; line?: number })

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
  skipped: { line: number; item: number; loop: number; reason: string }[]   // 跳过的可选指令（"?"）
  warnings: { code: string; message: string; line?: number }[]
  /** 分轮（options.repeat ≥ 2；总设计 §3.5、TD-09 §3.7 / §3.9）：第 k 轮 = [本轮 loop 事件, 下一轮 loop 事件)，最后一轮到窗口终点，
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
}

export interface SimResult {
  log: SimEvent[]
  summary: Summary
  /** 运行期报错（TD-09 §3.3：等不来、等超时、超过帧数上限）；日志与汇总保留到出错为止 */
  error?: { code: string; message: string; frame: number; line?: number; loop?: number }
}

// ---------------------------------------------------------------------------
// 角色钩子（总设计 §6.9）：只有四个，ctx 只开放受控操作

export interface CharacterHooks {
  onResolve?(ctx: HookContext): void
  /** 返回 true 表示允许；返回字符串表示不允许及原因（会写进等待日志） */
  canStart?(ctx: HookContext, action: ActionId): true | string
  onEvent?(ctx: HookContext, ev: SimEvent): void
  /** 在收集 buff 之前调用（TD-03 §4）：可改倍率、附加值、元素 / 标签，或直接补乘区值 */
  modifyHit?(ctx: HookContext, hit: HitDraft): void
}

export interface HookContext {
  readonly self: Slot
  readonly chain: Chain                     // 本角色的共鸣链数（钩子里按链数分支，如散华 C5）
  readonly state: Readonly<SimState>        // 只读查询；改状态只能走下面的方法
  buffStacks(id: string, target?: Slot | 'enemy'): number   // 0 = 没有
  addBuff(id: string, opts?: { target?: Slot | 'enemy'; stacks?: number }): void   // id 指本角色 buffs 里的定义
  removeBuff(id: string, target?: Slot | 'enemy'): void
  addResource(resource: ResourceKind, amount: number, slot?: Slot): void
  spawnJudgment(judgment: string, opts?: { action?: ActionId }): void
  /** 某个动作实例（或延奏的独立时间线）里不生成这些判定；只对还没生成的有效（TD-08 §3.2） */
  skipJudgments(instance: number, names: string[]): void
  setFlag(key: string, value: number | boolean | string): void
  getFlag(key: string): number | boolean | string | undefined
  /** 记一次本角色提供的治疗（不在任何判定上的治疗，如持续回复的每一跳）：日志 heal 事件，触发"提供治疗时"的效果 */
  heal(source: string): void
  warn(message: string): void
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
