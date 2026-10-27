// src/data/buff.schema.ts —— BuffDef：curated 手写的 buff 定义（TD-02 §5）
// buff 是纯数据，装载时用 zod 校验一遍（查出拼错的乘区、不合法的组合等）；类型由 schema 推导。
import { z } from 'zod'
import { ACTION_KINDS, DAMAGE_TAGS, EFFECT_NAMES, ELEMENTS, RESOURCE_KINDS, ZONE_IDS } from './common'

export const BUFF_TARGETS = ['self', 'team', 'teamExceptSelf', 'onField', 'nextIn', 'enemy'] as const
export type BuffTarget = (typeof BUFF_TARGETS)[number]

/** 触发事件目录（总设计 §6.8）。heal（2026-10-04 新增）：提供了一次治疗——标了 heals 的判定结算、钩子记的持续回复每一跳。
 *  shield（2026-10-24 新增，景尤守）：获得了一次护盾，事件的角色是获得护盾的人（by: 'self' = 持有者自己获得）；护盾量不建模 */
export const TRIGGER_EVENTS = [
  'actionStart', 'judgmentSettle', 'intro', 'outro', 'switchIn', 'switchOut', 'enemyState', 'resourceFull', 'heal', 'shield',
] as const
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number]

// break = 白条打空（破盾），breakEnd = 瘫痪结束、白条回满；disharmony = 偏谐值满（失谐），harmonyBreak = 谐度破坏命中（TD-06 §13）；
// shift / shiftEnd = 挂上 / 掉了偏移，interference / interferenceEnd = 进入 / 结束干涉，response = 有角色响应了干涉（by = 响应的人）（TD-06 §19）；
// effectApplied = 为目标附加了异常效应（到顶了也算），effectEnd = 异常效应到时消失，effectConsumed = 层数被技能消耗（TD-06 §18）
export const ENEMY_STATE_CHANGES = [
  'break', 'breakEnd', 'poiseBreak', 'disharmony', 'harmonyBreak', 'shift', 'shiftEnd', 'interference', 'interferenceEnd', 'response',
  'effectApplied', 'effectEnd', 'effectConsumed',
  'swap',                                         // 换了一只敌人（排轴"敌人 换 <预设>"，录像剖析）
] as const
export type EnemyStateChange = (typeof ENEMY_STATE_CHANGES)[number]

const nonEmpty = <T extends z.ZodType>(s: T) => z.array(s).min(1)
const Ratio = z.number().finite()

/** 作用条件：命中时判断这段伤害吃不吃这个 buff */
export const BuffFilterSchema = z.strictObject({
  elements: nonEmpty(z.enum(ELEMENTS)).optional(),
  tags: nonEmpty(z.enum(DAMAGE_TAGS)).optional(),
  actions: nonEmpty(z.string()).optional(),       // 只对这些动作产生的判定
  judgments: nonEmpty(z.string()).optional(),     // 只对这些判定（行名）
  enemyEffect: z.enum(EFFECT_NAMES).optional(),   // 目标身上有该效应时才生效
  effects: nonEmpty(z.enum(EFFECT_NAMES)).optional(),   // 只对这些异常效应自身的伤害（TD-03 §4）
  critOnly: z.literal(true).optional(),           // 只进暴击分支（总设计 T4，TD-03 §3.3）
})
export type BuffFilter = z.output<typeof BuffFilterSchema>

/** 触发条件：哪个事件、满足什么过滤时给 buff 加层 / 刷新 */
export const TriggerFilterSchema = z.strictObject({
  by: z.enum(['self', 'team', 'onField']).default('self'),   // 谁产生的事件；默认 buff 持有者本人
  actionKinds: nonEmpty(z.enum(ACTION_KINDS)).optional(),
  actions: nonEmpty(z.string()).optional(),
  judgments: nonEmpty(z.string()).optional(),
  tags: nonEmpty(z.enum(DAMAGE_TAGS)).optional(),
  elements: nonEmpty(z.enum(ELEMENTS)).optional(),
  enemyState: z.enum(ENEMY_STATE_CHANGES).optional(),
  effect: z.enum(EFFECT_NAMES).optional(),
  resource: z.enum(RESOURCE_KINDS).optional(),
  ownerHas: z.string().min(1).optional(),         // 持有者身上有这个 buff 时才触发（无常凶鹭"幻形后 15 秒内若施放延奏…"，2026-10-04）
  afterBattle: z.number().int().min(0).optional(), // 战斗进行到这一帧（战斗帧）以后才触发：深塔环境特性"战斗开始60秒后…"（2026-10-26）
})
export type TriggerFilter = z.output<typeof TriggerFilterSchema>

/** 触发条件：一个事件（可带过滤），或它们的数组（任一事件都触发，TD-07 §1） */
export const TriggerSpecSchema = z.strictObject({
  on: z.enum(TRIGGER_EVENTS), where: TriggerFilterSchema.optional(),
  stacks: z.number().int().min(1).optional(),     // 这种触发加几层（缺省 stackGain）：万物持存的注释"施放变奏技能时……视为满层"
})
export type TriggerSpec = z.output<typeof TriggerSpecSchema>
const Triggers = z.union([TriggerSpecSchema, z.array(TriggerSpecSchema).min(1)])
const RankValue = z.union([Ratio, z.tuple([Ratio, Ratio, Ratio, Ratio, Ratio])])   // 数组 = 武器 R1–R5
const Requires = z.strictObject({ chain: z.number().int().min(1).max(6) })

export const BuffDefSchema = z.strictObject({
  id: z.string().min(1),                                  // 全局唯一：'散华.共鸣链6'
  source: z.string().min(1),                              // 原文出处（整句），方便核对
  zone: z.enum(ZONE_IDS).optional(),                      // 加深 / 最终伤害的类别写在名字里（TD-03 §2）；不写 = 标记型（TD-07 §7）
  value: RankValue.optional(),                            // 标记型不写
  filter: BuffFilterSchema.optional(),
  target: z.enum(BUFF_TARGETS),
  maxStacks: z.number().int().min(1).default(1),
  stackGain: z.number().int().min(1).default(1),         // 每次触发加几层
  duration: z.union([z.number().int().min(1), z.literal('inf')]),   // 帧
  onSwitchOut: z.enum(['persist', 'clear']).default('persist'),      // 原文明写才 clear（机制设计 6.1）
  refresh: z.enum(['refresh', 'keep']).default('refresh'),           // 再触发时是否刷新持续时间
  icd: z.number().int().min(1).optional(),                           // 触发内置冷却（"每秒可获得一层"= 60）
  trigger: z.union([z.literal('always'), z.literal('hook'), Triggers]),   // 'hook'：只由角色钩子施加（标记型状态，TD-08 §3.2），或由别的 buff 的 extend.grants 施加
  consume: z.strictObject({                                          // "下次 X…"：被 X 用掉（TD-07 §6）
    on: z.enum(TRIGGER_EVENTS),
    where: TriggerFilterSchema.optional(),
    stacks: z.union([z.number().int().min(1), z.literal('all')]).default('all'),
  }).optional(),
  /** 持续中再满足 trigger 时延长 frames（每次施加后最多 max 次，重新施加时重数），成功延长时施加 grants 里的 buff（同一持有者的，
   *  一般写 trigger: 'hook'）：焰痕"造成重击伤害时，该效果延长4秒，最多可延长1次。成功延长效果时，使队伍中的角色热熔伤害加成提升…"（2026-10-27） */
  extend: z.strictObject({
    trigger: Triggers,
    frames: z.number().int().min(1),
    max: z.number().int().min(1),
    grants: nonEmpty(z.string().min(1)).optional(),
  }).optional(),
  requires: Requires.optional(),                                     // 共鸣链门槛
  ownerOnField: z.literal(true).optional(),                          // 给的人在前台时才算（"若装备者处于前台"，玉阙玄华第 4 条）
  /** 数值按持有者的面板属性换算（2026-10-24，景尤守）：实际值 = min(cap, value × 份数)，份数 = (属性 + offset) / per，floor 时取整。
   *  属性取装配时的静态面板加常驻 buff（假设 stat-scaling-static）：守岸人深潜星域"每 0.2% 共鸣效率计算为 0.01% 暴击"写
   *  { stat: 'energyRegen', per: 0.002 }、value 0.0001；景燃"每 1000 点生命上限获得 36 点攻击，上限 1800"写 { stat: 'hp', per: 1000, cap: 1800 }、value 36 */
  scale: z.strictObject({
    stat: z.enum(['hp', 'atk', 'def', 'energyRegen', 'tunabilityRate']),   // tunabilityRate：偏谐值累积效率（星构寻辉之环，2026-10-25）
    per: z.number().positive(),
    offset: z.number().optional(),                        // 加在属性上再换算（守岸人"处于星域内共鸣效率 +10%"）
    floor: z.literal(true).optional(),
    cap: z.number().optional(),
  }).optional(),
}).superRefine((b, ctx) => {
  if ((b.zone === undefined) !== (b.value === undefined))
    ctx.addIssue({ code: 'custom', path: ['value'], message: '乘区与数值要么都写，要么都不写（都不写 = 标记型 buff）' })
  if (b.filter?.critOnly && (b.zone === 'critRate' || b.zone === 'critDamage'))
    ctx.addIssue({ code: 'custom', path: ['filter', 'critOnly'], message: '暴击率 / 暴伤本来就只影响暴击，不需要 critOnly' })
  if (b.trigger === 'always' && b.duration !== 'inf')
    ctx.addIssue({ code: 'custom', path: ['duration'], message: "常驻 buff（trigger: 'always'）的 duration 必须是 'inf'" })
  if (b.scale && b.value === undefined)
    ctx.addIssue({ code: 'custom', path: ['scale'], message: '按属性换算（scale）要写乘区与每份的数值' })
  if (b.extend && b.duration === 'inf')
    ctx.addIssue({ code: 'custom', path: ['extend'], message: "常驻 buff（duration 'inf'）不能延长" })
  if (b.stackGain > b.maxStacks)
    ctx.addIssue({ code: 'custom', path: ['stackGain'], message: 'stackGain 不能大于 maxStacks' })
})

/** 装载后的 buff（默认值已补齐） */
export type BuffDef = z.output<typeof BuffDefSchema>
/** 手写时的形状（可省略有默认值的字段） */
export type BuffDefInput = z.input<typeof BuffDefSchema>

/** 资源型触发效果："施放共鸣技能时回复 8 点协奏能量"（TD-07 §9）。与 buff 共用触发机制，落地调 TD-06 的 grant */
export const ResourceEffectSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  resource: z.enum(RESOURCE_KINDS),
  amount: RankValue,                                       // 可负；数组 = 武器 R1–R5
  target: z.enum(['self', 'team', 'teamExceptSelf', 'onField']).default('self'),
  trigger: Triggers,
  icd: z.number().int().min(1).optional(),
  scaledByRegen: z.literal(true).optional(),               // 能量乘共鸣效率：只给文案写明"此效果受共鸣效率影响"的（TD-06 Q3）
  requires: Requires.optional(),
})
export type ResourceEffect = z.output<typeof ResourceEffectSchema>
export type ResourceEffectInput = z.input<typeof ResourceEffectSchema>
