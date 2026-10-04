// src/data/gamedata.ts —— 注册层产出的只读静态数据 GameData（TD-02 §4）
// 这些类型是内部类型（由装配函数构造，不直接来自文件），不用 zod；来源追溯靠 source / row 字段。
import type {
  ActionId, ActionKind, BlockKey, BodyType, CharName, DamageTag, DilationSide, DilationType, EffectName, Element,
  Frame, ResourceKind, StatKey, WeaponType,
} from './common'
import type { BuffDef, ResourceEffect } from './buff.schema'
import type { GenEchoStats, GenMeta, GenWeapon } from './generated.schema'
import type { CharacterHooks } from '../engine/types'

export interface GameData {
  version: string                                   // xlsx 文件名里的日期，如 "20260707"
  meta: GenMeta
  characters: Record<CharName, CharacterDef>
  commonActions: Record<BlockKey, Record<ActionId, ActionDef>>   // 通用块：闪避、极限闪避、召唤声骸…
  weapons: Record<string, WeaponDef>
  echoes: Record<string, EchoDef>
  echoSets: Record<string, EchoSetDef>
  echoStats: GenEchoStats | null                    // 声骸主词条满级值、副词条各档（echo-stats.json；副词条边际要用）
  enemies: Record<string, EnemyPreset>
  effects: Partial<Record<EffectName, EffectDef>>
  abnormalBaseByLevel: number[]                     // 异常伤害基础值 AbnomalDamage，下标 = 等级 − 1（TD-03 §5）
  tuneBreak: TuneBreakTable
  envBuffs: Record<string, BuffDef>
  rules: Rules
}

export interface CharacterDef {
  name: CharName
  element: Element
  weaponType: WeaponType                            // curated（xlsx 没有，TD-01 §5.2）
  bodyType: BodyType | null
  commonBlock: BlockKey | null                      // 体型对应的通用动作块
  base: { hp: number; atk: number; def: number }    // 90 级
  energyCost: number
  coreResources: CoreResourceDef[]                  // 按槽号，可不连续
  tunabilityRate: number                            // 偏谐效率基础值（推定，TD-01 Q17）
  harmonyBreakBoost: number                         // 谐破增幅基础值（推定）
  treeStats: Partial<Record<StatKey, number>>       // 技能树属性节点合计（curated，进静态面板）
  actions: Record<ActionId, ActionDef>
  aliases: Record<string, ActionId>                 // "R" → "大招"
  buffs: BuffDef[]                                  // 被动 / 共鸣链 / 延奏 / 回路（curated）
  resourceEffects: ResourceEffect[]                 // 资源型触发效果（curated，TD-07 §9）
  hooks?: CharacterHooks
  flags: string[]                                   // 装配时未处理的数据问题汇总
}

export interface CoreResourceDef { slot: 1 | 2 | 3 | 4 | 5; name: string; cap: number }

// ---------------------------------------------------------------------------
// 动作与判定（总设计 §5.1；默认映射见 TD-01 §13）

export interface ActionDef {
  id: ActionId
  owner: BlockKey                                   // 角色键、通用块键或 '声骸:<名>'
  kind: ActionKind
  endFrame: Frame                                   // 动作结束帧：局部帧到达它时回到空闲（TD-04 §4.3）
  cancelWindows: CancelWindow[]                     // 派生窗口 [from, until)，可越过 endFrame（TD-04 §6.1）
  priority: PriorityStep[]                          // 按 fromFrame 升序，第一项 fromFrame = 0
  comboFrom?: ActionId[]                            // 连段前置：只能在这些动作的派生窗口内开始（A2 ← A1，TD-04 §6.2）
  inputLocks: InputLock[]                           // "第 nF 前不响应输入 / 不能闪避…"（TD-04 §6.3）
  judgments: JudgmentDef[]                          // 按 spawnFrame 升序；事件生成的（spawnFrame = null）排在最后
  dilations: DilationDef[]                          // 按动作局部帧登记的膨胀（anchor = 'action'：时停、全局时停、极限闪避…）
  castGains: CastGain[]                             // 施放类资源（"大招-前置"协奏 +20 等）
  outroTriggerFrame?: Frame                         // 变奏动作：上一角色的延奏在此帧触发
  switchLockUntil?: Frame                           // 此帧前不能切人
  cooldown?: Frame                                  // 技能冷却：声骸来自 xlsx，角色技能由角色模块覆盖
  cooldownGroup?: string                            // 共用冷却的组名（椿 E1 / E2 共用 'E'）；缺省按动作 ID
  charges?: number                                  // 按次数充能：最多存几次（初始满），每 cooldown 帧回复 1 次（梦魇·无冠者 3 次 / 12 秒）
  summon?: boolean                                  // 召唤类声骸（脱手）：判定走独立时间线，角色之后的动作、取消都不影响，也不挡"就绪"
  energyCost?: number                               // 开始时要有、并扣掉的大招能量：注册层给别名 R 的动作设（TD-06 §2.3）
  endOnSwitchOut?: Frame                            // 切出时局部帧 ≥ 它就结束（"第nF后切人结束技能"，TD-05 §5）
  followUp?: { after: string; action: ActionId }    // 该判定第一次结算后立刻开始 action（TD-08 P10）
  source: { file: string; rows: number[] }          // 追溯到 xlsx 行
  flags: string[]
}

export interface CancelWindow { from: Frame; until: Frame; row: number }
export interface PriorityStep { fromFrame: Frame; value: number }
/** atFrame 0 = 进入动作即得（开始动作的那一刻由资源模块发，TD-06 §7）；chainRange：由判定行汇总来的项跟随该行的共鸣链版本 */
export interface CastGain { atFrame: Frame; resource: ResourceKind; amount: number; chainRange?: ChainRange }
/** 当前动作局部帧 < until 时，kinds 里的新动作（'all' = 一切输入）不能开始 */
export interface InputLock { until: Frame; kinds: ActionKind[] | 'all' }

export interface DilationWindow { rate: number; duration: Frame }
export interface DilationDef {
  type: DilationType
  /** action：动作局部帧到 start 时登记；hit：判定每次命中时登记（start 恒为 0）。同一行的各侧按锚点拆开（TD-04 §3.2） */
  anchor: 'action' | 'hit'
  start: Frame
  self?: DilationWindow
  enemy?: DilationWindow
  ally?: DilationWindow
}

export interface JudgmentDef {
  name: string                                      // 行名；组内重名加 #n
  row: number
  spawnFrame: Frame | null                          // null = 事件生成（钩子 spawnJudgment）
  birthFrame: Frame | null                          // 出现帧：发生帧公式 N = P + f(Q) 的 P（TD-04 §5.4）；null = 同 spawnFrame
  lifeFrames: Frame                                 // -1 = 直到动作结束（必定不可脱手）
  ticks: number                                     // 结算次数，≥1
  tickInterval: Frame | null                        // null 且 ticks > 1 时在寿命内均分（TD-04 §5.2）
  persistsOnCancel: boolean                         // 可脱手
  followHitstop: boolean                            // 跟随顿帧
  target: 'enemy' | 'ally' | 'none' | 'other'
  calc: 'damage' | 'heal' | 'hpCost'                // dmg Damage.CalculateType 0 / 1 / 2
  multiplier: number                                // 0 = 不造成伤害
  relatedAttr: 'atk' | 'hp' | 'def' | 'energyRegen'  // RelatedProperty 7 / 2 / 10 / 11（TD-03 §3.2）
  element: Element
  tags: DamageTag[]
  gains: { energy: number; concerto: number; core: [number, number, number] }   // 每次结算
  coreOncePerAction?: [boolean, boolean, boolean]   // 核心回收合并区：每个动作实例只发一次（TD-01 §1.5）
  gauges: { toughness: number; tunability: number }
  hitstop: DilationDef | null                       // 每次命中时登记的膨胀（anchor = 'hit'；膨胀发生为空的各侧，任何类型）
  formula?: { type: number; rate: number }          // dmg FormulaType ≠ 0：rate = FormulaParam5（已 × 0.0001），钩子据此算 Formula1
  cureBase?: number                                 // 治疗 / 护盾的固定值 CureBaseValue（calc = 'heal'）
  heals?: boolean                                   // 这次结算同时为友方回复生命：结算后记一条 heal 事件（治疗量不建模，角色模块标）
  chainRange?: ChainRange                           // 只在这些共鸣链数下存在；由行名的 C\d 标记推得（TD-01 §13.2）；缺省 = 任何链数
  flags: string[]
}

/** 共鸣链数范围，两端都含：C0 / C3 / C5 三个版本 → [0, 2]、[3, 4]、[5, 6] */
export interface ChainRange { min: number; max: number }

// ---------------------------------------------------------------------------
// 武器、声骸、套装

export interface WeaponDef {
  key: string
  rarity: number
  type: WeaponType
  main: { stat: StatKey; value: number }            // 90 级（攻击）
  sub: { stat: StatKey; value: number }             // 90 级
  effects: GenWeapon['effects']                     // 原始被动数据（文本 + R1–R5 数值）
  passives: BuffDef[]                               // curated 写成的 buff
  resourceEffects: ResourceEffect[]                 // curated 写成的资源型效果（TD-07 §9）
}

export interface EchoDef {
  key: string
  cost: 1 | 3 | 4 | null                            // `索引` 页查不到、curated 也没补的为 null
  /** 动作 ID 是 'Q·<组名>'（kind 'echo'）；按体型分组的（鸣钟之龟）带 '@<体型前缀>'，装配时只留匹配体型的一组并去掉后缀 */
  actions: Record<ActionId, ActionDef>
  q: ActionId                                       // 别名 Q：第一个技能版本的第一段
  description: string | null                        // 技能说明原文
  mainSlotBuffs: BuffDef[]                          // 首位加成与技能附带的 buff（curated）
  resourceEffects: ResourceEffect[]                 // 技能附带的资源型效果（curated）
  curated: boolean                                  // data/curated/echoes.ts 有没有它
  flags: string[]                                   // 声骸级的 flag（cooldownText、charges、stagesGuess…）
}

export interface EchoSetDef {
  name: string
  pieces: Partial<Record<2 | 3 | 5, BuffDef[]>>
}

// ---------------------------------------------------------------------------
// 敌人、异常效应、谐度破坏

export interface EnemyPreset {
  id: string                                        // '全息6/朔雷之鳞'
  name: string
  tag: string
  cost: 1 | 3 | 4
  level: number
  hp: number
  def: number
  res: Record<Element, number>
  whiteBar: { max: number; recover: number; reduce: number }   // 白条（游戏字段 Rage），敌人表原值（按生命值成长放大过），只作展示
  whiteBarTough: number                             // 白条按削韧值计（prop RageMax ÷ 100，TD-06 §13.2）；0 = 没有白条
  paralysisFrames: Frame                            // 白条打空后瘫痪多久（敌人表"瘫痪时长"）；0 = 不瘫痪
  poise: { max: number; recover: number; reduce: number }      // 韧性（Tough），削韧值作用于它
  tunabilityMax: number
}

export interface EffectDef {
  name: EffectName
  element: Element
  multipliers: number[]                             // 第 k 项 = k 层
  maxStacks: number
  duration: Frame | null                            // 每层持续（由说明文本 curated，TD-06）
  tickInterval: Frame | null
  debuff?: BuffDef                                  // 如虚湮减防
}

export interface TuneBreakTable {
  variants: { key: string; weaponType: WeaponType | null; seq: number | null; multiplier: number; ticks: number | null }[]
  baseByLevel: number[]                             // WeaknessDamageBaseValue，下标 = 等级 − 1
  costFactor: Record<1 | 3 | 4, number>             // 按敌人 COST：base 表 WeaknessDamageMinus × WeaknessDamageMinusRatio（TD-03 §6）
}

// ---------------------------------------------------------------------------
// 全局规则常量（可在场景 options.rules 里覆盖，TD-02 §4.2）

export interface Rules {
  fps: 60
  charLevel: number                                 // 角色等级，防御公式里的 Lv（TD-03 §3.2）
  switchCooldown: Frame
  concertoMax: number
  concertoTiming: 'onCast' | 'onHit'
  energyShare: { dealer: number; others: number }
  breakEnergy: number
  tuneBreakLock: Frame                              // 谐度破坏命中后不能累积偏谐值的时间（真空期，TD-06 §13.1）
  critRateCap: number
  defFactorCap: number
  highResThreshold: number
  maxWait: Frame
  maxChainDepth: number
  sampleInterval: Frame
  dilation: Record<DilationType, DilationRule>
}

/** 一种时间膨胀怎么作用（TD-04 §3.3） */
export interface DilationRule {
  stopsBattleClock: boolean                         // 生效期间战斗时钟停走
  hitstopSides: DilationSide[]                      // 在这些侧按"攻击顿帧"处理：同一单位上新的替换旧的；其余侧与别的窗口并存
  clearSelfOnCancel: boolean                        // 登记它的动作被取消时撤掉自身侧（极限闪避减速可被普攻取消）
}

export const DEFAULT_RULES: Rules = {
  fps: 60,
  charLevel: 90,
  switchCooldown: 60,                               // 机制设计 5.4
  concertoMax: 100,
  concertoTiming: 'onHit',                          // 逐段所得按命中给，"进入即得"仍在出手时（2026-10-03 用户实测，TD-06 Q1）
  energyShare: { dealer: 1, others: 0.5 },          // 机制设计 4.1
  breakEnergy: 3,                                   // 白条打空（破盾）时全队每人 +3 × 各自共鸣效率（TD-06 §13.2）
  tuneBreakLock: 300,                               // 真空期 5 秒；带震谐·干涉时 8 秒（M0 用不到，2026-10-04 用户确认）
  critRateCap: 1,
  defFactorCap: 2,                                  // min(2, …)（TD-03 §3.2）
  highResThreshold: 0.8,                            // 总设计附录 A-5
  maxWait: 600,
  maxChainDepth: 16,
  sampleInterval: 30,                               // 资源曲线每 0.5 秒采样一次
  dilation: {                                       // 附页1"时间膨胀类型"的说明（TD-04 §3.3）
    攻击顿帧: { stopsBattleClock: false, hitstopSides: ['self', 'enemy', 'ally'], clearSelfOnCancel: false },
    时停: { stopsBattleClock: false, hitstopSides: [], clearSelfOnCancel: false },        // buff 时停：与攻击顿帧并存
    全局时停: { stopsBattleClock: true, hitstopSides: [], clearSelfOnCancel: false },
    极限闪避顿帧: { stopsBattleClock: false, hitstopSides: ['enemy'], clearSelfOnCancel: true },
    弹反顿帧: { stopsBattleClock: false, hitstopSides: ['self', 'enemy', 'ally'], clearSelfOnCancel: false },
  },
}
