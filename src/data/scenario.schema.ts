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
  whiteBar: z.number().min(0).optional(),                 // 按削韧值计（TD-06 §13.2）；缺省没有白条
  paralysisSec: z.number().min(0).optional(),             // 白条打空后瘫痪几秒
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
  // 启动轴：只跑一次（第 0 轮），之后 rotation 循环 options.repeat 轮；语法同 rotation（TD-09 §3.7）
  opening: z.array(z.string().nullable().transform(v => v ?? '')).default([]),
  rotation: z.array(z.string().nullable().transform(v => v ?? '')).min(1),   // 空行、YAML 里只有注释的项（null）不产生指令（TD-09 §2.3）
  options: z.strictObject({
    repeat: z.number().int().min(1).default(1),
    maxFrames: z.number().int().min(1).default(3600),
    maxWait: z.number().int().min(1).default(600),
    endAt: z.number().int().min(1).optional(),            // 覆盖 DPS 统计窗口终点（总设计 §3.5）
    rules: z.record(z.string(), z.unknown()).optional(),  // Partial<Rules>，resolve 时逐项校验
    // 谐度破坏（TD-06 §13.4）：auto = 目标失谐后前台角色在下一条指令前自动放；manual = 只按轴里写的放；off = 不累积偏谐值
    tuneBreak: z.enum(['auto', 'manual', 'off']).default('auto'),
  }).default({ repeat: 1, maxFrames: 3600, maxWait: 600, tuneBreak: 'auto' }),
}).superRefine((s, ctx) => {
  const names = s.team.map(m => m.char)
  names.forEach((n, i) => {
    if (names.indexOf(n) !== i) ctx.addIssue({ code: 'custom', path: ['team', i, 'char'], message: `角色重复：${n}` })
  })
  let items = 0
  const check = (part: 'opening' | 'rotation', lines: string[]) => lines.forEach((line, i) => {
    const where = `${part === 'opening' ? '启动' : ''}第 ${i + 1} 条`
    const p = parseRotationLine(line)
    if ('error' in p) { ctx.addIssue({ code: 'custom', path: [part, i], message: `${where}：${p.error}` }); return }
    if (part === 'rotation') items += p.length
    for (const it of p) {
      if (it.kind !== 'wait' && !names.includes(it.char))
        ctx.addIssue({ code: 'custom', path: [part, i], message: `${where}：${it.char} 不在队伍里` })
    }
  })
  check('opening', s.opening)
  check('rotation', s.rotation)
  if (items === 0) ctx.addIssue({ code: 'custom', path: ['rotation'], message: '排轴里没有指令（只有空行或注释）' })
})

export type Scenario = z.output<typeof ScenarioSchema>
export type ScenarioInput = z.input<typeof ScenarioSchema>

// ---------------------------------------------------------------------------
// 排轴行语法（TD-09 §2）：
//   <角色> <动作>[!][?] [+N] [<动作>[!][?] [+N] …]   依次出招；! = 强制（不等"取消不丢东西"）；+N = 最早合法之后再等 N 帧（战斗帧）；
//                                                ? = 可选：冷却、资源、角色条件（含谐度破坏要的失谐）不满足就跳过，不等（TD-06 §13.4）
//   switch <角色>   或  切人 <角色>          切人
//   wait <N>        或  等待 <N>             空等 N 帧（战斗帧）
//   空格后的 # 起是注释；全角的 ！？＋＃、全角数字和全角空格按半角处理

export type RotationItem =
  | { kind: 'act'; char: string; action: string; delay: number; force: boolean; optional?: true; filler?: true }
  | { kind: 'switch'; char: string }
  | { kind: 'wait'; frames: number }

/** 解析一行：返回这一行的指令（空行、纯注释 → []），或错误说明 */
export function parseRotationLine(text: string): RotationItem[] | { error: string } {
  const s = text
    .replace(/\u3000/g, ' ').replace(/！/g, '!').replace(/？/g, '?').replace(/～/g, '~').replace(/＋/g, '+').replace(/＃/g, '#')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/(^|\s)#.*$/, '').trim()
  if (s === '') return []
  const tok = s.split(/\s+/)
  const head = tok[0]!
  if (head === 'switch' || head === '切人') {
    if (tok.length !== 2) return { error: `"${s}" 格式不对：应为 ${head} <角色>` }
    return [{ kind: 'switch', char: tok[1]! }]
  }
  if (head === 'wait' || head === '等待') {
    if (tok.length !== 2 || !/^\d+$/.test(tok[1]!)) return { error: `"${s}" 格式不对：应为 ${head} <帧数>` }
    return [{ kind: 'wait', frames: Number(tok[1]) }]
  }
  if (tok.length === 1) return { error: `"${s}" 只有角色名：格式为 <角色> <动作> [+N]、switch <角色> 或 wait <帧数>` }
  const out: RotationItem[] = []
  let delayed = false                                    // 当前这个动作是否已经写过 +N（+0 也算）
  for (const t of tok.slice(1)) {
    const prev = out.at(-1) as Extract<RotationItem, { kind: 'act' }> | undefined
    let m = /^\+(\d+)$/.exec(t)
    if (m) {
      if (!prev) return { error: `"${t}" 前面要有动作` }
      if (delayed) return { error: `${prev.action} 写了两个延迟` }
      prev.delay = Number(m[1])
      delayed = true
      continue
    }
    if (t === '!' || t === '?' || t === '~') {
      if (!prev) return { error: `"${t}" 前面要有动作` }
      if (t === '!') prev.force = true
      else if (t === '?') prev.optional = true
      else prev.filler = true
      if (prev.optional && prev.filler) return { error: `${prev.action}：? 与 ~ 不能一起写` }
      continue
    }
    m = /^([^!?~+]+)([!?~]*)(?:\+(\d+))?$/.exec(t)
    if (!m || m[2]!.length > 2 || (m[2]!.length === 2 && m[2]![0] === m[2]![1]))
      return { error: `无法识别"${t}"：动作写成 <动作>、<动作>!、<动作>?、<动作>~ 或 <动作> +N` }
    if (m[2]!.includes('?') && m[2]!.includes('~')) return { error: `"${t}"：? 与 ~ 不能一起写` }
    if (/^\d+$/.test(m[1]!) && prev) return { error: `"${t}" 像是延迟，延迟要写成 +${m[1]}` }
    out.push({
      kind: 'act', char: head, action: m[1]!, delay: m[3] ? Number(m[3]) : 0, force: m[2]!.includes('!'),
      ...(m[2]!.includes('?') ? { optional: true as const } : {}),
      ...(m[2]!.includes('~') ? { filler: true as const } : {}),
    })
    delayed = m[3] !== undefined
  }
  return out
}

/** 编译后的指令：角色名解析成槽位，别名解析成动作 ID（TD-09 §4，总设计 §3.3 第 7 步）。line 从 1 起，item 是行内第几个（从 1 起） */
export type Command =
  | { kind: 'act'; line: number; item: number; slot: Slot; action: ActionId; delay: Frame; force: boolean; optional?: true; filler?: true }
  | { kind: 'switch'; line: number; item: number; to: Slot }
  | { kind: 'wait'; line: number; item: number; frames: Frame }
  | { kind: 'at'; line: number; item: number; frame: number }   // 仅测试台：等到世界帧 frame；排轴语法写不出来
