// src/data/scenario.schema.ts —— 场景文件（YAML / 网页 JSON）的 schema（TD-02 §6）
// CLI 先用 `yaml` 包把文本解析成对象，再交给 ScenarioSchema；网页直接交对象。两边同一套校验。
import { z } from 'zod'
import { ELEMENTS, FLAT_STATS, STAT_KEYS, type ActionId, type Frame, type Slot, type StatKey } from './common'

/** 属性表：中文键 → 数值。比例属性写小数，写成 22 这种"百分数"直接报错 */
const StatValues = z.partialRecord(z.enum(STAT_KEYS), z.number()).superRefine((rec, ctx) => {
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === 'number' && !FLAT_STATS.includes(k as StatKey) && Math.abs(v) >= 3)
      ctx.addIssue({ code: 'custom', path: [k], message: `${k} 是比例，请写小数（22% 写 0.22），收到 ${v}` })
  }
})

const EchoPieceSchema = z.strictObject({
  name: z.string().min(1),                  // 声骸名（GameData.echoes 的键）
  set: z.string().min(1),                   // 计入哪个套装（同一声骸可属多个套装）
  main: StatValues,                         // 全部主属性，含固定副主属性（如 4C 的 攻击 150）
  subs: StatValues.default({}),
})

const MemberSchema = z.strictObject({
  char: z.string().min(1),
  chain: z.number().int().min(0).max(6).default(0),
  weapon: z.strictObject({ name: z.string().min(1), rank: z.number().int().min(1).max(5).default(1) }),
  echoes: z.array(EchoPieceSchema).max(5).default([]),   // 第一个是首位声骸（技能 Q）
})

const EnemyCustomSchema = z.strictObject({
  level: z.number().int().min(1).max(120),
  def: z.number().min(0).optional(),                      // 缺省按等级推算（TD-03）
  res: z.partialRecord(z.enum(ELEMENTS), z.number().min(-1).max(1)).default({}),
  cost: z.union([z.literal(1), z.literal(3), z.literal(4)]).default(4),
  hp: z.number().positive().optional(),
  whiteBar: z.number().min(0).optional(),
  tunabilityMax: z.number().min(0).optional(),
})

const Trio = z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)])

export const ScenarioSchema = z.strictObject({
  data: z.string().optional(),                            // 期望的数据版本；与当前数据不符只警告（总设计 T15）
  team: z.array(MemberSchema).length(3),
  enemy: z.union([
    z.strictObject({ preset: z.string().min(1) }),
    z.strictObject({ custom: EnemyCustomSchema }),
  ]),
  environment: z.array(z.string().min(1)).default([]),    // GameData.envBuffs 的 id
  initial: z.strictObject({
    energy: z.union([z.enum(['full', 'empty']), Trio]).default('full'),
    concerto: z.union([z.number().min(0).max(100), Trio]).default(0),
    onField: z.number().int().min(0).max(2).default(0),
  }).default({ energy: 'full', concerto: 0, onField: 0 }),
  rotation: z.array(z.string().min(1)).min(1),
  options: z.strictObject({
    repeat: z.number().int().min(1).default(1),
    maxFrames: z.number().int().min(1).default(3600),
    maxWait: z.number().int().min(1).default(600),
    endAt: z.number().int().min(1).optional(),            // 覆盖 DPS 统计窗口终点（总设计 §3.5）
    rules: z.record(z.string(), z.unknown()).optional(),  // Partial<Rules>，resolve 时逐项校验
  }).default({ repeat: 1, maxFrames: 3600, maxWait: 600 }),
}).superRefine((s, ctx) => {
  const names = s.team.map(m => m.char)
  names.forEach((n, i) => {
    if (names.indexOf(n) !== i) ctx.addIssue({ code: 'custom', path: ['team', i, 'char'], message: `角色重复：${n}` })
  })
  s.rotation.forEach((line, i) => {
    const p = parseRotationLine(line)
    if ('error' in p) ctx.addIssue({ code: 'custom', path: ['rotation', i], message: `第 ${i + 1} 条：${p.error}` })
    else if (p.kind !== 'wait' && !names.includes(p.char))
      ctx.addIssue({ code: 'custom', path: ['rotation', i], message: `第 ${i + 1} 条：${p.char} 不在队伍里` })
  })
})

export type Scenario = z.output<typeof ScenarioSchema>
export type ScenarioInput = z.input<typeof ScenarioSchema>

// ---------------------------------------------------------------------------
// 排轴行语法（完整语义见 TD-09）：
//   <角色> <动作或别名> [+N]   在最早合法帧之后再等 N 帧出招
//   switch <角色>               切人
//   wait <N>                   前台空等 N 帧

export type RotationLine =
  | { kind: 'act'; char: string; action: string; delay: number }
  | { kind: 'switch'; char: string }
  | { kind: 'wait'; frames: number }

export function parseRotationLine(text: string): RotationLine | { error: string } {
  const s = text.trim()
  let m = /^switch\s+(\S+)$/.exec(s)
  if (m) return { kind: 'switch', char: m[1]! }
  m = /^wait\s+(\d+)$/.exec(s)
  if (m) return { kind: 'wait', frames: Number(m[1]) }
  if (/^(switch|wait)(\s|$)/.test(s)) return { error: `"${s}" 格式不对：应为 switch <角色> 或 wait <帧数>` }
  m = /^(\S+)\s+(\S+)(?:\s+\+(\d+))?$/.exec(s)
  if (m) return { kind: 'act', char: m[1]!, action: m[2]!, delay: m[3] ? Number(m[3]) : 0 }
  return { error: `无法识别"${s}"：格式为 <角色> <动作> [+N]、switch <角色> 或 wait <帧数>` }
}

/** 编译后的指令：角色名解析成槽位，别名解析成动作 ID（resolve 阶段，总设计 §3.3 第 7 步） */
export type Command =
  | { kind: 'act'; line: number; slot: Slot; action: ActionId; delay: Frame }
  | { kind: 'switch'; line: number; to: Slot }
  | { kind: 'wait'; line: number; frames: Frame }
