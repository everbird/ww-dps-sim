// src/engine/types.ts —— 仿真引擎的输入、运行时状态、事件与汇总（TD-02 §7）
// 纯内部类型：不跨进程边界，不用 zod。所有状态都是可 structuredClone 的纯数据（总设计 §3.7）。
import type {
  ActionId, Chain, CharName, DamageTag, DilationSide, DilationType, EffectName, Element, Frame, Rank, ResourceKind, Slot,
  StatKey, ZoneId,
} from '../data/common'
import type { BuffDef, EnemyStateChange } from '../data/buff.schema'
import type { ActionDef, CharacterDef, EchoDef, EnemyPreset, GameData, JudgmentDef, Rules, WeaponDef } from '../data/gamedata'
import type { Command } from '../data/scenario.schema'

// ---------------------------------------------------------------------------
// 装配结果 ResolvedScenario（总设计 §3.3）：仿真过程中只读

export interface ResolvedScenario {
  data: GameData
  team: [ResolvedMember, ResolvedMember, ResolvedMember]
  enemy: EnemyPreset
  buffs: RegisteredBuff[]                   // 常驻实例 + 触发监听器，已按共鸣链过滤、按谐振阶取值
  commands: Command[]
  initial: { energy: [number, number, number]; concerto: [number, number, number]; onField: Slot }
  rules: Rules
  options: { repeat: number; maxFrames: Frame; maxWait: Frame; endAt?: Frame }
  warnings: string[]                        // 装配期警告（数据版本不符、未处理的 flag…）
}

export interface ResolvedMember {
  slot: Slot
  def: CharacterDef
  chain: Chain
  weapon: { def: WeaponDef; rank: Rank }
  echoes: { def: EchoDef; set: string; main: StatValues; subs: StatValues }[]
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
  value: number                             // 已按武器谐振阶选定
  owner: Slot | 'env'                       // 'env' = 场景 buff
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
  queue: { commands: Command[]; next: number; waitingSince: number | null; loop: number }
  log: SimEvent[]
  nextId: number                            // 判定 / buff / 动作实例的递增编号
}

export interface CharRuntime {
  slot: Slot
  name: CharName
  action: ActionRuntime | null              // null = 空闲
  last: ActionRuntime | null                // 最近一个动作实例（进行中的就是 action）；结束后局部帧照走，供连段窗口判断（TD-04 §6.2）
  startedThisTick: boolean                  // 同一 tick 同一角色最多开始一个动作（TD-04 §1、§6.5）
  energy: number
  concerto: number
  core: [number, number, number, number, number]
  cooldowns: Record<string, Frame>          // 键：动作 ID 或 'echo'
  flags: Record<string, number | boolean | string>   // 只由钩子读写
}

export interface ActionRuntime {
  id: ActionId
  def: ActionDef
  instance: number                          // 动作实例号，"每个实例只发一次"的依据
  localFrame: number                        // 局部帧，可为小数（总设计 T2）；每次推进后取整到 1e-4
  startedAt: number                         // 世界帧
  cursor: number                            // 时间线（timelineOf(def)）上下一个待发生事件的下标
  ended: boolean                            // 已结束或被取消（此后只作为 CharRuntime.last 保留）
  coreGranted: [boolean, boolean, boolean]
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
  whiteBar: number
  broken: boolean
  poise: number
  tunability: number
  disharmony: boolean
  tunabilityLockedUntil: number
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
  dmg: { nonCrit: number; crit: number; expected: number } | null   // 非伤害判定为 null
  factors?: HitFactors
  buffs: string[]                           // 生效的 buff，"id×层数"
  gains: { energy: Partial<Record<CharName, number>>; concerto: number; core: number[] }
}

/** 公式各项系数（TD-03 §8：非暴击分支的各项；critDamage 是暴击分支的暴伤） */
export interface HitFactors {
  base: number; def: number; bonus: number; res: number; reduce: number; special: number
  amplify: number; final: number; critRate: number; critDamage: number
}

export type SimEvent =
  | (EventBase & { type: 'actionStart'; char: CharName; action: ActionId; instance: number; line?: number; dropped?: string[] })
  | (EventBase & { type: 'actionEnd'; char: CharName; action: ActionId; instance: number })
  | (EventBase & { type: 'actionCancel'; char: CharName; action: ActionId; instance: number; by: ActionId; dropped: string[] })
  | (EventBase & { type: 'judgmentSpawn'; char: CharName; action: ActionId; judgment: string; id: number })
  | HitEvent
  | (EventBase & { type: 'switch'; from: CharName; to: CharName; intro: boolean })
  | (EventBase & { type: 'intro'; char: CharName; action: ActionId })
  | (EventBase & { type: 'outro'; char: CharName })
  | (EventBase & { type: 'buffApply'; buff: string; target: CharName | 'enemy'; stacks: number; remaining: number | 'inf' })
  | (EventBase & { type: 'buffExpire'; buff: string; target: CharName | 'enemy'; reason: 'timeout' | 'switchOut' | 'removed' })
  | (EventBase & { type: 'resource'; char: CharName; resource: ResourceKind; delta: number; value: number; cause: string })
  | (EventBase & { type: 'enemyState'; change: EnemyStateChange; detail?: string })
  | (EventBase & { type: 'effectTick'; effect: EffectName; stacks: number; damage: number; source: CharName })
  | (EventBase & { type: 'wait'; line: number; frames: number; reason: string })
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
  waits: { line: number; frames: number; reason: string }[]
  warnings: { code: string; message: string; line?: number }[]
  perLoop?: { loop: number; dps: number; energyDelta: [number, number, number]; concertoDelta: [number, number, number] }[]
}

export interface SimResult { log: SimEvent[]; summary: Summary }

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
  readonly state: Readonly<SimState>        // 只读查询；改状态只能走下面的方法
  buffStacks(id: string, target?: Slot | 'enemy'): number   // 0 = 没有
  addBuff(id: string, opts?: { target?: Slot | 'enemy'; stacks?: number }): void   // id 指本角色 buffs 里的定义
  removeBuff(id: string, target?: Slot | 'enemy'): void
  addResource(resource: ResourceKind, amount: number, slot?: Slot): void
  spawnJudgment(judgment: string, opts?: { action?: ActionId }): void
  setFlag(key: string, value: number | boolean | string): void
  getFlag(key: string): number | boolean | string | undefined
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
  zones: Partial<Record<ZoneId, number>>    // 钩子直接补的乘区值（与 buff 同样累加）
  critOnly: Partial<Record<ZoneId, number>>
}

/** 乘区累加器：键就是乘区 ID，值是已乘层数的合计；critOnly 只进暴击分支（TD-03 §3.3） */
export interface ZoneAccumulator {
  zones: Record<ZoneId, number>
  critOnly: Record<ZoneId, number>
}
