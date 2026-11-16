// src/data/calibration.schema.ts —— 观测（原名"校准点"，docs/engine-quality-plan.md P4、docs/calibration/README.md、DD-08 §3）：
// 每条 = 一个可以拿游戏实测对照的量（面板一项、某一下的跳字、一轮的时长；DD-08 加：两个事件之间隔多久、某个时刻的资源、某次切人的类型），
// 指向哪份记录、哪个场景；game 填了实测值就成为带容差的回归测试（tests/calibration.test.ts），没填的是待测（pnpm calibrate 列出仿真的值）。
// 证据闭环（DD-08 §4，docs/evidence/）引用这里的观测 ID。文件名与位置不变（DD08-Q4），类型名 CalibrationPoint 留着，别名 Observation。
import { z } from 'zod'

const Base = {
  id: z.string().min(1),                              // 唯一：'椿AAE.A1'
  record: z.string().min(1),                          // 记录文件：相对 docs/calibration/ 的路径
  scenario: z.string().min(1),                        // 场景文件：相对 scenarios/ 的路径（闭环的小场景放 scenarios/evidence/ 下）
  game: z.number().nullable().default(null),          // 实测值；null = 还没测
  gameRange: z.tuple([z.number(), z.number()]).refine(([a, b]) => a <= b, 'gameRange 下界不得大于上界').optional(),   // 区间读数；与 game 二选一
  /** 容差（缺省按种类，见 DEFAULT_TOLERANCE）：interval 是绝对的帧数，其余是相对误差。容差在看到比较结果之前定（DD-08 §3.2） */
  tolerance: z.number().positive().optional(),
  purpose: z.enum(['given', 'formulation', 'selection', 'independent_validation', 'unspecified']).default('unspecified'),
  condition: z.strictObject({
    gameVersion: z.string().default('unknown'),
    recordedAt: z.string().optional(),
    note: z.string().optional(),                      // 配装、敌人、环境、初态里与场景不同或不确定的；读数的精度也写在这里（"30 帧录像，±2 世界帧"）
    unknowns: z.array(z.string()).default([]),        // 明说哪些不知道
  }).optional(),
  /** 这个比较必需的条件（DD-08 §3.2）：condition.unknowns 里有其中任意一项时，比较结果是 insufficientCondition */
  requires: z.array(z.string().min(1)).default([]),
  note: z.string().optional(),
}

/** 选择器能选的事件（DD-08 §3.1） */
export const EVENT_SELECTOR_TYPES = ['actionStart', 'switch', 'hit', 'intro', 'outro', 'buffApply', 'buffExpire'] as const
/** 每种事件的选择器能写哪些字段：
 *  - actionStart、intro：char 是出招的人，action 是动作 ID 或别名；hit 另可写 judgment（判定名）；
 *  - switch：char 是切进来的人（事件的 to）；outro：char 是发出延奏的人；
 *  - buffApply、buffExpire：char 是 buff 挂在谁身上（事件的 target），buff 是 buff 的定义 ID */
const SELECTOR_FIELDS: Record<(typeof EVENT_SELECTOR_TYPES)[number], readonly string[]> = {
  actionStart: ['char', 'action'], intro: ['char', 'action'], hit: ['char', 'action', 'judgment'],
  switch: ['char'], outro: ['char'], buffApply: ['char', 'buff'], buffExpire: ['char', 'buff'],
}

/** 在日志里选一条事件：type 与写了的字段都对上的，loop 限定在第几轮里（[本轮 loop 事件, 下一轮 loop 事件)），取第 nth 个（从 1 数）。
 *  interval 的 to 从 from 选中的那条之后数起（DD-08 §3.1 的实现约定）。同一帧有几条同样满足条件、换一条值就不同的，比较结果是 ambiguous */
export const EventSelectorSchema = z.strictObject({
  type: z.enum(EVENT_SELECTOR_TYPES),
  char: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  judgment: z.string().min(1).optional(),
  buff: z.string().min(1).optional(),
  loop: z.number().int().min(0).optional(),
  nth: z.number().int().min(1).default(1),
}).superRefine((s, ctx) => {
  for (const k of ['char', 'action', 'judgment', 'buff'] as const) {
    if (s[k] !== undefined && !SELECTOR_FIELDS[s.type].includes(k))
      ctx.addIssue({ code: 'custom', path: [k], message: `${s.type} 的选择器不能写 ${k}（能写：${SELECTOR_FIELDS[s.type].join('、')}）` })
  }
})
export type EventSelector = z.output<typeof EventSelectorSchema>

const PointUnion = z.discriminatedUnion('kind', [
  // 面板一项（角色界面上的数）：item 是 pnpm trace 面板表的项名（生命、攻击、暴击、共鸣效率、导电伤害加成…）；比例写小数（90% 写 0.9）
  z.strictObject({ ...Base, kind: z.literal('panel'), char: z.string().min(1), item: z.string().min(1) }),
  // 某一下的跳字：第 loop 轮里 char 的第 nth 个名为 judgment 的结算（从 1 数）；branch 标明暴击 / 不暴击 / 未知（缺省 unknown）
  z.strictObject({
    ...Base, kind: z.literal('hit'), loop: z.number().int().min(0), char: z.string().min(1), judgment: z.string().min(1),
    nth: z.number().int().min(1).default(1),
    branch: z.enum(['crit', 'nonCrit', 'unknown']).default('unknown'),
  }),
  // 一轮的时长。clock: battle 是战斗秒（大招过场的全局时停里不走，深塔倒计时是这个）；clock: world 是世界秒（按视频时间量的是这个）。
  z.strictObject({
    ...Base, kind: z.literal('loop'), loop: z.number().int().min(0),
    clock: z.enum(['battle', 'world']).default('battle'),
  }),
  // 两个事件之间隔多久（DD-08 §3.1）：clock 必填（录像数帧是 world；深塔倒计时是 battle）；unit 是 game / gameRange 的单位。
  // 容差是绝对的帧数（缺省 ±1 帧；fps 写了 30 时 ±2：30 帧录像一格是 2 个世界帧）
  z.strictObject({
    ...Base, kind: z.literal('interval'), from: EventSelectorSchema, to: EventSelectorSchema,
    clock: z.enum(['world', 'battle']),
    unit: z.enum(['frames', 'seconds']).default('frames'),
    fps: z.number().int().positive().optional(),      // 录像帧率（只影响缺省容差）
  }),
  // 某个时刻某人某种资源的值或占上限的比例（DD-08 §3.1）：取值来自资源账本（DD-06）。before：at 选中的事件之前最后一条的余额；
  // after：它（与同一帧里由它引出的事件）写的条目之后的余额。resource：'energy'、'concerto' 或核心资源名
  z.strictObject({
    ...Base, kind: z.literal('resourceAt'), at: EventSelectorSchema, when: z.enum(['before', 'after']).default('after'),
    char: z.string().min(1), resource: z.string().min(1),
    as: z.enum(['value', 'ratio']).default('value'),
  }),
  // 某次切人是变奏还是普通（DD-08 §3.1）：没有数值，game / gameRange 不填，实测结果写在 expect（还没看时 null）
  z.strictObject({
    ...Base, kind: z.literal('switchType'), at: EventSelectorSchema,
    expect: z.enum(['intro', 'normal']).nullable().default(null),
  }),
])

function refinePoint(p: z.output<typeof PointUnion>, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  if (p.game !== null && p.gameRange !== undefined) {
    ctx.addIssue({ code: 'custom', path: [...path, 'gameRange'], message: 'game 与 gameRange 不能同时给：点值填 game，区间填 gameRange（game 置 null）' })
  }
  if (p.kind === 'switchType') {
    if (p.game !== null || p.gameRange !== undefined) ctx.addIssue({ code: 'custom', path: [...path, 'game'], message: 'switchType 没有数值：实测结果写在 expect' })
    if (p.at.type !== 'switch') ctx.addIssue({ code: 'custom', path: [...path, 'at', 'type'], message: 'switchType 的 at 要选 switch 事件' })
  }
}

export const CalibrationPointSchema = PointUnion.superRefine((p, ctx) => refinePoint(p, ctx))
export type CalibrationPoint = z.output<typeof CalibrationPointSchema>
export const CalibrationFileSchema = z.strictObject({ points: z.array(CalibrationPointSchema) }).superRefine((f, ctx) => {
  f.points.forEach((p, i) => {
    if (p.game !== null && p.gameRange !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['points', i, 'gameRange'], message: 'game 与 gameRange 不能同时给' })
    }
  })
})

/** 观测（DD-08 §3.1）：就是校准点，文档里改叫"观测" */
export type Observation = CalibrationPoint
export const ObservationSchema = CalibrationPointSchema
export const ObservationFileSchema = CalibrationFileSchema

/** 各种类的缺省容差：面板显示到 0.1%；跳字是取整后的整数，两三千的数差 1 点约 0.05%，留余量取 0.2%；时长按录像逐帧量，1% 约 1 秒里 0.6 帧；
 *  interval 是绝对的帧数（间隔很短时相对误差没有意义，DD-08 §3.2）；resourceAt 相对 1%（资源环多半按区间读，区间外再放 1%）。switchType 没有容差 */
export const DEFAULT_TOLERANCE = { panel: 0.001, hit: 0.002, loop: 0.01, interval: 1, resourceAt: 0.01 } as const satisfies
  Record<Exclude<CalibrationPoint['kind'], 'switchType'>, number>

/** 这条观测实际用的容差：写了 tolerance 用它；interval 没写时按录像帧率（30 帧录像一格 2 个世界帧 → ±2）；switchType 为 0 */
export function toleranceOf(p: CalibrationPoint): number {
  if (p.tolerance !== undefined) return p.tolerance
  switch (p.kind) {
    case 'switchType': return 0
    case 'interval': return p.fps !== undefined && p.fps < 60 ? Math.ceil(60 / p.fps) : DEFAULT_TOLERANCE.interval
    default: return DEFAULT_TOLERANCE[p.kind]
  }
}
