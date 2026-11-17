// src/data/scenario.schema.ts —— 场景文件（YAML / 网页 JSON）的 schema（TD-02 §6）
// CLI 先用 `yaml` 包把文本解析成对象，再交给 ScenarioSchema；网页直接交对象。两边同一套校验。
import { z } from 'zod'
import { ELEMENTS, FLAT_STATS, STAT_KEYS, type ActionId, type Frame, type ResourceKind, type Slot, type StatKey } from './common'

/** 属性表：中文键 → 数值。比例属性写小数，写成 22 这种"百分数"直接报错 */
export const StatValuesSchema = z.partialRecord(z.enum(STAT_KEYS), z.number()).superRefine((rec, ctx) => {
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === 'number' && !FLAT_STATS.includes(k as StatKey) && Math.abs(v) >= 3)
      ctx.addIssue({ code: 'custom', path: [k], message: `${k} 是比例，请写小数（22% 写 0.22），收到 ${v}` })
  }
})

const EchoPieceSchema = z.strictObject({
  name: z.string().min(1),                  // 声骸名（GameData.echoes 的键）
  set: z.string().min(1),                   // 计入哪个套装（同一声骸可属多个套装）
  main: StatValuesSchema,                         // 全部主属性，含固定副主属性（如 4C 的 攻击 150）
  subs: StatValuesSchema.default({}),
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

/** 视频里的时刻：播放器时间"分:秒"（如 1:02.5）或秒数 */
export const VideoTimeSchema = z.union([z.number().min(0), z.string().regex(/^(\d+:)?\d+(\.\d+)?$/, '写成"分:秒"（如 1:02.5）或秒数')])
export type VideoTime = z.output<typeof VideoTimeSchema>
/** 视频时刻 → 秒 */
export function videoTime(v: VideoTime): number {
  if (typeof v === 'number') return v
  const i = v.indexOf(':')
  return i < 0 ? Number(v) : Number(v.slice(0, i)) * 60 + Number(v.slice(i + 1))
}

/** 录像读数行末尾可写 !given / !display（DD-09 §4.1）：given = 被用作输入（同步的依据），display = 只展示不评分 */
const SUFFIX = String.raw`(\s+!(given|display))?`
const T = String.raw`(\d+:)?\d+(\.\d+)?`
const videoLine = (body: string, hint: string) => z.string().regex(new RegExp(`^\\s*${T}\\s+${body}${SUFFIX}\\s*$`), hint)

/** 录像里的三种时段（DD-09 §3.1）：没列出的时段都按"已观测的动作"处理。
 *  idle：已知空闲，basis 写凭什么确认这段没有会影响模型的战斗输入（"没有跳字"不算）；执行上就是轴里这段时间的等待。
 *  unobserved：看不到（遮挡、镜头外、读不清），至少一种填法；每种填法是一组轴的行，插在这个时段结束处的 at 之前（DD-09 §11 实施记录） */
export const ReplaySegmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('idle'), from: VideoTimeSchema, to: VideoTimeSchema, basis: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('unobserved'), from: VideoTimeSchema, to: VideoTimeSchema, reason: z.string().min(1),
    fills: z.array(z.strictObject({ name: z.string().min(1), lines: z.array(z.string()) })).min(1),
  }),
])
export type ReplaySegment = z.output<typeof ReplaySegmentSchema>

export const ScenarioSchema = z.strictObject({
  data: z.string().optional(),                            // 期望的数据版本；与当前数据不符只警告（总设计 T15）
  // 场景是做什么的（2026-10-26）：rotation = 轴（攻略、教学、配装对比，看 DPS、手速、假设敏感度）；
  // replay = 录像剖析（照一局实战录像记下来，用时间轴与各种状态看懂这一局；敌人走位、出招不建模，DPS 只作参考，pnpm sensitivity 不跑它）
  purpose: z.enum(['rotation', 'replay']).default('rotation'),
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
    // 开局核心资源：角色名 → { 资源名: 值 }，如 { 椿: { 红椿·蕊: 100 } }；缺省 0（TD-06 Q7）
    core: z.record(z.string(), z.record(z.string(), z.number().min(0))).default({}),
  }).default({ energy: 'full', concerto: 0, onField: 0, core: {} }),
  // 对照视频（TD-11 §6 P2）：marks 是某一轮各条指令开始时在视频里的时刻（播放器时间"分:秒"或秒数），键是第几条；
  // pnpm trace 从最早的那个时刻起算，列出仿真比视频快慢多少。url 只作记录
  video: z.strictObject({
    url: z.string().optional(),
    loop: z.number().int().min(0).default(2),            // 对照哪一轮：0 是启动轴
    marks: z.record(z.string().regex(/^\d+$/, '键是第几条（数字）'),
      z.union([z.number().min(0), z.string().regex(/^(\d+:)?\d+(\.\d+)?$/, '写成"分:秒"（如 1:02.5）或秒数')])),
    // 录像里看到的动作（2026-10-26，视图 F 拿来和仿真对照）："<视频秒> <角色> <动作>"，动作照轴的写法（E、大招、Q、QTE……别名也行）；
    // 动作名前加 @ 的是后台来源（召唤、阵、延奏，DD-09 §4.1 的 summon 通道：不进前台动作的先后）。每条行末可写 !given / !display
    events: z.array(videoLine(String.raw`\S+\s+\S+`, '写成"<视频秒> <角色> <动作>"，如 15.0 散华 E（后台来源写 @动作）')).optional(),
    // 录像里看到的切人（DD-09 §4.1）："<视频秒> <切出>→<切入> [intro|normal]"；写了类型的才比类型（切人类型的参照只来自这里，§4.3）
    switches: z.array(videoLine(String.raw`\S+?(→|->)\S+(\s+(intro|normal))?`, '写成"<视频秒> <切出>→<切入> [intro|normal]"，如 22.6 卜灵→雷主·男 intro')).optional(),
    // 录像里读到的单下跳字（DD-09 §4.1，R15）："<视频秒> <角色> <判定名> <数> [crit|nonCrit]"，不写分支是不知道（两支都比）；
    // 同名判定在几个动作里都有时写"动作/判定"（照世·E/E-2）
    hits: z.array(videoLine(String.raw`\S+\s+\S+\s+\d+(\.\d+)?(\s+(crit|nonCrit|unknown))?`, '写成"<视频秒> <角色> <判定名> <数> [crit|nonCrit]"，如 41.5 心 增幅强化重击-3 288240 crit')).optional(),
    // 录像里敌人的血条（2026-10-26，视图 F 拿仿真的累计伤害对照）："<视频秒> <剩余比例>"，如 55.25 0.998；
    // 第一条是血条出现（开始打这个敌人）的时刻，仿真从那一刻起算伤害（之前打的是别的敌人，如深塔开头的小怪）；
    // 末尾写了敌人预设的一条起是另一只敌人的血条（2026-10-27 中 4：异构武装打死后无冠者出来），仿真从这一条起重新累计、按这只的生命折比例
    hp: z.array(z.string().regex(/^(\d+:)?\d+(\.\d+)?\s+(0|1)(\.\d+)?(\s+[^\s!]\S*)?(\s+!(given|display))?$/, '写成"<视频秒> <剩余比例> [敌人预设]"，如 55.25 0.998')).optional(),
    // 录像里前台角色的协奏环（2026-10-28）："<视频秒> <角色> <比例>"，比例 = 协奏 / 上限；贴合度拿仿真同一角色、同一时刻的协奏比
    concerto: z.array(videoLine(String.raw`\S+\s+(0|1)(\.\d+)?`, '写成"<视频秒> <角色> <比例>"，如 31.0 心 0.11')).optional(),
    // 录像里前台角色共鸣回路条上的核心资源（2026-10-28，心的应世心）："<视频秒> <角色> <资源名> <比例>"，比例 = 读数 / 上限；
    // 资源名照角色模块的核心资源名（coreResources），贴合度拿仿真同一角色、同一时刻的值比
    core: z.array(videoLine(String.raw`\S+\s+\S+\s+(0|1)(\.\d+)?`, '写成"<视频秒> <角色> <资源名> <比例>"，如 33.0 心 应世心 0.84')).optional(),
  }).optional(),
  // 录像输入（DD-09 §3.1）：只在 purpose: replay 下写。videoOffset：视频秒 = 世界秒（at 写的）+ videoOffset，时段按它对到轴里的 at；
  // segments：哪些时段不是"已观测的动作"（已知空闲 / 未观测）。有几种填法的未观测时段要展开成各个组合分别跑（src/data/replay.ts 的 expandReplayCombos）
  replay: z.strictObject({
    videoOffset: z.number().optional(),
    segments: z.array(ReplaySegmentSchema).default([]),
  }).optional(),
  // 启动轴：只跑一次（第 0 轮），之后 rotation 循环 options.repeat 轮；语法同 rotation（TD-09 §3.7）
  opening: z.array(z.string().nullable().transform(v => v ?? '')).default([]),
  rotation: z.array(z.string().nullable().transform(v => v ?? '')).min(1),   // 空行、YAML 里只有注释的项（null）不产生指令（TD-09 §2.3）
  // 按套路排轴（pnpm plan，TD-10 §6.2 ①）另外可用的套路：轴里没有的打法，写法同轴里同一角色的一行（不含切人）；
  // max = 每轮最多用几次（缺省 1）。仿真不用它
  search: z.strictObject({
    routines: z.array(z.union([
      z.string().min(1),
      z.strictObject({ line: z.string().min(1), max: z.number().int().min(1).default(1) }),
    ])).default([]),
  }).optional(),
  // 比较的目标（TD-10 §7）：steady = 稳态 DPS（缺省）；kill = 打死几倍于敌人生命的血量要多少战斗秒（启动轴算在内）；
  // killHp = 直接写血量；window = 前多少战斗秒的总伤害。对比、轴搜索、排轴、敏感度都按它排；通关计时是战斗时钟（大招时停也停，用户 2026-10-22）
  goal: z.union([
    z.literal('steady'),
    z.strictObject({ kill: z.number().positive() }),
    z.strictObject({ killHp: z.number().positive() }),
    z.strictObject({ window: z.number().positive() }),
  ]).default('steady'),
  // DD-02 §3.6–3.7：出处不参与执行，省略声明定义伤害口径。
  notation: z.strictObject({
    source: z.string().optional(),
    opening: z.record(z.string().regex(/^\d+$/), z.string()).optional(),
    rotation: z.record(z.string().regex(/^\d+$/), z.string()).optional(),
    readings: z.array(z.string()).optional(),
  }).optional(),
  tuneBreakOmitted: z.strictObject({ reason: z.enum(['sourceSilent', 'notInGame', 'deliberate']), note: z.string().optional() }).optional(),
  options: z.strictObject({
    strict: z.boolean().optional(),
    repeat: z.number().int().min(1).default(1),
    maxFrames: z.number().int().min(1).default(3600),
    maxWait: z.number().int().min(1).default(600),
    endAt: z.number().int().min(1).optional(),            // 覆盖 DPS 统计窗口终点（总设计 §3.5）
    rules: z.record(z.string(), z.unknown()).optional(),  // Partial<Rules>，resolve 时逐项校验
    // 谐度破坏（TD-06 §13.4）：auto = 目标失谐后前台角色在下一条指令前自动放；manual = 只按轴里写的放；off = 不累积偏谐值
    tuneBreak: z.enum(['auto', 'manual', 'off']).default('auto'),
    // 操作延迟（TD-09 §3，总设计 T4）：决策点（切人、不是连段后续的出招）在合法之后再晚几帧执行（人的反应时间）；
    // 连段后续玩家会预输入，不加。缺省 0 = 最早合法帧（假设 earliest-frame）
    inputDelay: z.number().int().min(0).default(0),
  }).default({ repeat: 1, maxFrames: 3600, maxWait: 600, tuneBreak: 'auto', inputDelay: 0 }),
}).superRefine((s, ctx) => {
  if (s.tuneBreakOmitted && s.options.tuneBreak === 'auto') ctx.addIssue({ code: 'custom', path: ['tuneBreakOmitted'], message: '声明省略谐度破坏不能同时开启 auto' })
  for (const part of ['opening', 'rotation'] as const) for (const key of Object.keys(s.notation?.[part] ?? {})) {
    if (Number(key) < 1 || Number(key) > s[part].length) ctx.addIssue({ code: 'custom', path: ['notation', part, key], message: '出处指向的行不存在' })
  }
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
      if (it.kind !== 'wait' && it.kind !== 'at' && it.kind !== 'enemy' && !names.includes(it.char))
        ctx.addIssue({ code: 'custom', path: [part, i], message: `${where}：${it.char} 不在队伍里` })
    }
  })
  check('opening', s.opening)
  check('rotation', s.rotation)
  if (items === 0) ctx.addIssue({ code: 'custom', path: ['rotation'], message: '排轴里没有指令（只有空行或注释）' })
  // 录像输入（DD-09 §3.1）：只在录像剖析里写；时段 from < to、不重叠，填法名字不重复。时段落在哪两个 at 之间、填法的行编不编得过，编译时查（src/data/replay.ts）
  if (s.replay) {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: ['replay', ...path], message })
    if (s.purpose !== 'replay') issue([], 'replay 块只在 purpose: replay（录像剖析）里写（DD-09 §3.1）')
    const segs = s.replay.segments
    if (segs.length > 0 && s.replay.videoOffset === undefined)
      issue(['videoOffset'], '写了时段就要给 videoOffset（视频秒 = 世界秒 + videoOffset）：时段写的是视频秒，按它对到轴里的 at')
    segs.forEach((g, i) => {
      if (videoTime(g.from) >= videoTime(g.to)) issue(['segments', i, 'to'], `第 ${i + 1} 个时段：from ${g.from} 要早于 to ${g.to}`)
      if (g.kind === 'unobserved') g.fills.forEach((f, j) => {
        if (g.fills.findIndex(x => x.name === f.name) !== j) issue(['segments', i, 'fills', j, 'name'], `第 ${i + 1} 个时段：填法"${f.name}"重名`)
      })
    })
    const order = segs.map((g, i) => ({ i, from: videoTime(g.from), to: videoTime(g.to) })).sort((a, b) => a.from - b.from || a.i - b.i)
    order.forEach((g, k) => {
      const prev = order[k - 1]
      if (prev && g.from < prev.to - 1e-9) issue(['segments', g.i, 'from'], `第 ${g.i + 1} 个时段与第 ${prev.i + 1} 个重叠（${prev.to} 之前就开始了）`)
    })
  }
})

export type Scenario = z.output<typeof ScenarioSchema>
export type ScenarioInput = z.input<typeof ScenarioSchema>

// ---------------------------------------------------------------------------
// 排轴行语法（TD-09 §2）：
//   <角色> <动作>[!][?] [+N] [<动作>[!][?] [+N] …]   依次出招；! = 强制（不等"取消不丢东西"）；+N = 最早合法之后再等 N 帧（战斗帧）；
//                                                ? = 可选：冷却、资源、角色条件（含谐度破坏要的失谐）不满足就跳过，不等（TD-06 §13.4）
//   switch <角色>   或  切人 <角色>          切人
//   switch <角色> 变奏                       切人，并说明这里应是变奏：切出者协奏没满时照常普通切人，记一条警告（轴可能有问题；TD-09 §2.1、§3.5）
//   wait <N>        或  等待 <N>             空等 N 帧（战斗帧）
//   at <秒>         或  对时 <秒>            等到世界秒（从仿真开始算，含大招动画）：照录像记的轴用它把每段对到视频的时刻；
//                                            前面的补位 "~" 看它——还没到时间就接着补（2026-10-25 桃渊散录像）
//   敌人 失谐       或  enemy disharmony     让目标此刻失谐（偏谐值满、谐度破坏按钮亮）：录像剖析里多敌人的段，谐度破坏打的是仿真没建的小怪，
//                                            照录像手写谐度破坏时先写它（2026-10-27 中 3 录像，假设 forced-disharmony）
//   敌人 换 <预设>  或  enemy swap <预设>    此刻换成一只新的敌人（enemies.json 的 id，COST 要和场景的敌人相同）：敌人量表、异常效应、
//                                            挂在敌人身上的 buff 都从头来；录像剖析里深塔一只 boss 打死、下一只出来时写（2026-10-27 中 4 录像，假设 enemy-swap）
//   能量满 <角色>   或  fill-energy <角色>   这个人的大招能量此刻补满：录像剖析里大招按钮已经亮了、仿真能量还差一点（多敌人的段仿真只建一只，
//                                            少算了打小怪的能量），照录像按钮亮的时刻写（2026-10-27 中 3 录像，假设 forced-energy）
//   同步 <角色> <资源> <值>  或  sync <角色> <资源> <值>   状态同步（DD-09 §3.2）：把这个人的这种资源此刻设成录像里读到的值（截在 [0, 上限]）。
//                                            资源：能量 | 协奏 | <核心资源名>（energy、concerto 也行）；值：=62 绝对值，62% 占上限的比例。
//                                            不写日志、不发业务触发（钩子看不到，不出 resourceFull），只记一条外部干预记录与账本条目；从第一次起是有条件推演（假设 forced-sync）
//   空格后的 # 起是注释；全角的 ！？＋＃、全角数字和全角空格按半角处理

export type RotationItem =
  | { kind: 'act'; char: string; action: string; delay: number; force: boolean; optional?: true; filler?: true }
  | { kind: 'switch'; char: string; expectIntro?: true }
  | { kind: 'wait'; frames: number }
  | { kind: 'at'; seconds: number }
  | { kind: 'enemy'; state: 'disharmony' }
  | { kind: 'enemy'; state: 'swap'; preset: string }
  | { kind: 'fill'; char: string; resource: 'energy' }
  | { kind: 'sync'; char: string; resource: string; value: number; unit: 'value' | 'ratio' }

/** 解析一行：返回这一行的指令（空行、纯注释 → []），或错误说明 */
export function parseRotationLine(text: string): RotationItem[] | { error: string } {
  const s = text
    .replace(/\u3000/g, ' ').replace(/！/g, '!').replace(/？/g, '?').replace(/～/g, '~').replace(/＋/g, '+').replace(/＃/g, '#').replace(/％/g, '%').replace(/＝/g, '=')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/(^|\s)#.*$/, '').trim()
  if (s === '') return []
  const tok = s.split(/\s+/)
  const head = tok[0]!
  if (head === 'switch' || head === '切人') {
    if (tok.length === 3 && tok[2] === '变奏') return [{ kind: 'switch', char: tok[1]!, expectIntro: true }]
    if (tok.length !== 2) return { error: `"${s}" 格式不对：应为 ${head} <角色> 或 ${head} <角色> 变奏` }
    return [{ kind: 'switch', char: tok[1]! }]
  }
  if (head === 'wait' || head === '等待') {
    if (tok.length !== 2 || !/^\d+$/.test(tok[1]!)) return { error: `"${s}" 格式不对：应为 ${head} <帧数>` }
    return [{ kind: 'wait', frames: Number(tok[1]) }]
  }
  if (head === 'at' || head === '对时') {
    if (tok.length !== 2 || !/^\d+(\.\d+)?$/.test(tok[1]!)) return { error: `"${s}" 格式不对：应为 ${head} <世界秒>` }
    return [{ kind: 'at', seconds: Number(tok[1]) }]
  }
  if (head === '敌人' || head === 'enemy') {
    if (tok.length === 3 && (tok[1] === '换' || tok[1] === 'swap')) return [{ kind: 'enemy', state: 'swap', preset: tok[2]! }]
    if (tok.length !== 2 || (tok[1] !== '失谐' && tok[1] !== 'disharmony'))
      return { error: `"${s}" 格式不对：应为 敌人 失谐（enemy disharmony）或 敌人 换 <敌人预设>（enemy swap <预设>）` }
    return [{ kind: 'enemy', state: 'disharmony' }]
  }
  if (head === '能量满' || head === 'fill-energy') {
    if (tok.length !== 2) return { error: `"${s}" 格式不对：应为 ${head} <角色>` }
    return [{ kind: 'fill', char: tok[1]!, resource: 'energy' }]
  }
  if (head === '同步' || head === 'sync') {
    const bad = { error: `"${s}" 格式不对：应为 ${head} <角色> <资源> <值>，资源写能量、协奏或核心资源名，值写 =62（绝对值）或 62%（占上限的比例）` }
    if (tok.length !== 4) return bad
    const abs = /^=(\d+(\.\d+)?)$/.exec(tok[3]!), pct = /^(\d+(\.\d+)?)%$/.exec(tok[3]!)
    if (!abs && !pct) return bad
    if (pct && Number(pct[1]) > 100) return { error: `"${s}"：比例不能超过 100%` }
    return [{
      kind: 'sync', char: tok[1]!, resource: tok[2]!,
      ...(abs ? { value: Number(abs[1]), unit: 'value' as const } : { value: Number(pct![1]) / 100, unit: 'ratio' as const }),
    }]
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
  | { kind: 'switch'; line: number; item: number; to: Slot; expectIntro?: true }   // expectIntro：写了"变奏"
  | { kind: 'wait'; line: number; item: number; frames: Frame }
  | { kind: 'at'; line: number; item: number; frame: number }   // 等到世界帧 frame（排轴写 at <世界秒>；测试台直接给帧）
  | { kind: 'enemy'; line: number; item: number; state: 'disharmony' }   // 敌人 失谐：让目标此刻失谐（录像剖析）
  | { kind: 'enemy'; line: number; item: number; state: 'swap'; preset: string }   // 敌人 换 <预设>：此刻换成一只新敌人（录像剖析：深塔一只打死、下一只出来）
  | { kind: 'fill'; line: number; item: number; slot: Slot; resource: 'energy' }   // 能量满 <角色>：此刻补满大招能量（录像剖析）
  // 同步 <角色> <资源> <值>（DD-09 §3.2）：unit value 是绝对值，ratio 是占上限的比例（小数）；执行时换算、截在 [0, 上限]
  | { kind: 'sync'; line: number; item: number; slot: Slot; resource: ResourceKind; value: number; unit: 'value' | 'ratio' }
