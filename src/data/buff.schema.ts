// src/data/buff.schema.ts —— BuffDef：curated 手写的 buff 定义（TD-02 §5）
// buff 是纯数据，装载时用 zod 校验一遍（查出拼错的乘区、不合法的组合等）；类型由 schema 推导。
import { z } from 'zod'
import { ACTION_KINDS, DAMAGE_TAGS, EFFECT_NAMES, ELEMENTS, RESOURCE_KINDS, ZONE_IDS } from './common'

export const BUFF_TARGETS = ['self', 'team', 'teamExceptSelf', 'onField', 'nextIn', 'enemy'] as const
export type BuffTarget = (typeof BUFF_TARGETS)[number]

/** 触发事件目录（总设计 §6.8），v0 固定这一组 */
export const TRIGGER_EVENTS = [
  'actionStart', 'judgmentSettle', 'intro', 'outro', 'switchIn', 'switchOut', 'enemyState', 'resourceFull',
] as const
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number]

export const ENEMY_STATE_CHANGES = [
  'break', 'poiseBreak', 'disharmony', 'harmonyBreak', 'shift', 'interference', 'effectApplied',
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
})
export type TriggerFilter = z.output<typeof TriggerFilterSchema>

export const BuffDefSchema = z.strictObject({
  id: z.string().min(1),                                  // 全局唯一：'散华.共鸣链6'
  source: z.string().min(1),                              // 原文出处（整句），方便核对
  zone: z.enum(ZONE_IDS),                                 // 加深 / 最终伤害的类别写在名字里（TD-03 §2）
  value: z.union([Ratio, z.tuple([Ratio, Ratio, Ratio, Ratio, Ratio])]),   // 数组 = 武器 R1–R5
  filter: BuffFilterSchema.optional(),
  target: z.enum(BUFF_TARGETS),
  maxStacks: z.number().int().min(1).default(1),
  stackGain: z.number().int().min(1).default(1),         // 每次触发加几层
  duration: z.union([z.number().int().min(1), z.literal('inf')]),   // 帧
  onSwitchOut: z.enum(['persist', 'clear']).default('persist'),      // 原文明写才 clear（机制设计 6.1）
  refresh: z.enum(['refresh', 'keep']).default('refresh'),           // 再触发时是否刷新持续时间
  icd: z.number().int().min(1).optional(),                           // 触发内置冷却（"每秒可获得一层"= 60）
  trigger: z.union([
    z.literal('always'),
    z.strictObject({ on: z.enum(TRIGGER_EVENTS), where: TriggerFilterSchema.optional() }),
  ]),
  requires: z.strictObject({ chain: z.number().int().min(1).max(6) }).optional(),   // 共鸣链门槛
}).superRefine((b, ctx) => {
  if (b.filter?.critOnly && (b.zone === 'critRate' || b.zone === 'critDamage'))
    ctx.addIssue({ code: 'custom', path: ['filter', 'critOnly'], message: '暴击率 / 暴伤本来就只影响暴击，不需要 critOnly' })
  if (b.trigger === 'always' && b.duration !== 'inf')
    ctx.addIssue({ code: 'custom', path: ['duration'], message: "常驻 buff（trigger: 'always'）的 duration 必须是 'inf'" })
  if (b.stackGain > b.maxStacks)
    ctx.addIssue({ code: 'custom', path: ['stackGain'], message: 'stackGain 不能大于 maxStacks' })
})

/** 装载后的 buff（默认值已补齐） */
export type BuffDef = z.output<typeof BuffDefSchema>
/** 手写时的形状（可省略有默认值的字段） */
export type BuffDefInput = z.input<typeof BuffDefSchema>
