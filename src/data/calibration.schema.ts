// src/data/calibration.schema.ts —— 校准点（docs/engine-quality-plan.md P4、docs/calibration/README.md）：
// 每点 = 一个可以拿游戏实测对照的数（面板一项、某一下的跳字、一轮的时长），指向哪份记录、哪个场景；
// game 填了实测值就成为带容差的回归测试（tests/calibration.test.ts），没填的是待测（pnpm calibrate 列出仿真的值）。
import { z } from 'zod'

const Base = {
  id: z.string().min(1),                              // 唯一：'椿AAE.A1'
  record: z.string().min(1),                          // docs/calibration/ 下的记录文件名
  scenario: z.string().min(1),                        // scenarios/ 下的场景文件名
  game: z.number().nullable().default(null),          // 实测值；null = 还没测
  gameRange: z.tuple([z.number(), z.number()]).refine(([a, b]) => a <= b, 'gameRange 下界不得大于上界').optional(),   // 区间读数；与 game 二选一
  tolerance: z.number().positive().optional(),        // 相对误差（缺省按种类：面板 0.1%、跳字 0.2%、时长 1%）
  purpose: z.enum(['given', 'formulation', 'selection', 'independent_validation', 'unspecified']).default('unspecified'),
  condition: z.strictObject({
    gameVersion: z.string().default('unknown'),
    recordedAt: z.string().optional(),
    note: z.string().optional(),                      // 配装、敌人、环境、初态里与场景不同或不确定的
    unknowns: z.array(z.string()).default([]),        // 明说哪些不知道
  }).optional(),
  note: z.string().optional(),
}

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
])

export const CalibrationPointSchema = PointUnion.superRefine((p, ctx) => {
  if (p.game !== null && p.gameRange !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['gameRange'], message: 'game 与 gameRange 不能同时给：点值填 game，区间填 gameRange（game 置 null）' })
  }
})
export type CalibrationPoint = z.output<typeof CalibrationPointSchema>
export const CalibrationFileSchema = z.strictObject({ points: z.array(CalibrationPointSchema) }).superRefine((f, ctx) => {
  f.points.forEach((p, i) => {
    if (p.game !== null && p.gameRange !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['points', i, 'gameRange'], message: 'game 与 gameRange 不能同时给' })
    }
  })
})

/** 各种类的缺省容差（相对）：面板显示到 0.1%；跳字是取整后的整数，两三千的数差 1 点约 0.05%，留余量取 0.2%；时长按录像逐帧量，1% 约 1 秒里 0.6 帧 */
export const DEFAULT_TOLERANCE: Record<CalibrationPoint['kind'], number> = { panel: 0.001, hit: 0.002, loop: 0.01 }
