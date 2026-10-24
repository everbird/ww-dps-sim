// src/data/calibration.schema.ts —— 校准点（docs/engine-quality-plan.md P4、docs/calibration/README.md）：
// 每点 = 一个可以拿游戏实测对照的数（面板一项、某一下的跳字、一轮的时长），指向哪份记录、哪个场景；
// game 填了实测值就成为带容差的回归测试（tests/calibration.test.ts），没填的是待测（pnpm calibrate 列出仿真的值）。
import { z } from 'zod'

const Base = {
  id: z.string().min(1),                              // 唯一：'椿AAE.A1'
  record: z.string().min(1),                          // docs/calibration/ 下的记录文件名
  scenario: z.string().min(1),                        // scenarios/ 下的场景文件名
  game: z.number().nullable().default(null),          // 实测值；null = 还没测
  tolerance: z.number().positive().optional(),        // 相对误差（缺省按种类：面板 0.1%、跳字 0.2%、时长 1%）
  note: z.string().optional(),
}

export const CalibrationPointSchema = z.discriminatedUnion('kind', [
  // 面板一项（角色界面上的数）：item 是 pnpm trace 面板表的项名（生命、攻击、暴击、共鸣效率、导电伤害加成…）；比例写小数（90% 写 0.9）
  z.strictObject({ ...Base, kind: z.literal('panel'), char: z.string().min(1), item: z.string().min(1) }),
  // 某一下的跳字：第 loop 轮里 char 的第 nth 个名为 judgment 的结算（从 1 数）；game 填看到的数，按"不暴击 / 暴击"里接近的那个比
  z.strictObject({
    ...Base, kind: z.literal('hit'), loop: z.number().int().min(0), char: z.string().min(1), judgment: z.string().min(1),
    nth: z.number().int().min(1).default(1),
  }),
  // 一轮的时长（世界秒，含时停、顿帧）：第 loop 轮从第一条指令生效到下一轮
  z.strictObject({ ...Base, kind: z.literal('loop'), loop: z.number().int().min(0) }),
])
export type CalibrationPoint = z.output<typeof CalibrationPointSchema>
export const CalibrationFileSchema = z.strictObject({ points: z.array(CalibrationPointSchema) })

/** 各种类的缺省容差（相对）：面板显示到 0.1%；跳字是取整后的整数，两三千的数差 1 点约 0.05%，留余量取 0.2%；时长按录像逐帧量，1% 约 1 秒里 0.6 帧 */
export const DEFAULT_TOLERANCE: Record<CalibrationPoint['kind'], number> = { panel: 0.001, hit: 0.002, loop: 0.01 }
