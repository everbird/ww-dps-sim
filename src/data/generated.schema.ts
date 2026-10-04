// src/data/generated.schema.ts —— data/generated/*.json 的 zod schema（TD-02 §3）
// 构建脚本写文件前、注册层读文件后各校验一次；类型一律由 schema 推导（z.infer），不另写 interface。
import { z } from 'zod'
import { BODY_TYPES, DILATION_TYPES, ECHO_BODIES, EFFECT_NAMES, ELEMENTS, STAT_KEYS, WEAPON_TYPES } from './common'

const int = () => z.number().int()
/** 帧列：整数，允许 -1（持续帧 / 派生持续帧的"直到动作结束"） */
const FrameCol = int().min(-1)
const nullable = <T extends z.ZodType>(s: T) => s.nullable()

// ---------------------------------------------------------------------------
// 动作表的一行（TD-01 §3、§12.2）

/** 资源单元格（TD-01 §3.7） */
export const GainCellSchema = z.strictObject({
  total: z.number(),
  perHit: z.array(z.number()).min(1).optional(),
  onAction: z.number().optional(),
  formula: z.string().optional(),
  ref: z.string().optional(),
  complex: z.literal(true).optional(),
  sharedRows: z.tuple([int(), int()]).optional(),
})

export const DilationWindowSchema = z.strictObject({
  rate: nullable(z.number().min(0)),
  start: nullable(FrameCol),
  duration: nullable(FrameCol),
})

export const HintsSchema = z.strictObject({
  tickInterval: int().positive().optional(),
  maxTicks: int().positive().optional(),
  outroTriggerFrame: int().min(0).optional(),
  outroRange: z.literal(true).optional(),          // 备注写成"第 a～bF 触发"，outroTriggerFrame 取 a（TD-05 §4.1）
  endOnSwitchAfter: int().min(0).optional(),       // "第nF后切人结束技能 / 消失"；0 = 切人立即结束（TD-05 §5）
  priorityChangeFrames: z.array(int().min(0)).optional(),
  noDodgeBefore: int().min(0).optional(),
  noInputBefore: int().min(0).optional(),
  noSwitchBefore: int().min(0).optional(),
  noDamage: z.literal(true).optional(),
  delayedProjectile: z.literal(true).optional(),
  existsFrames: int().positive().optional(),
  reuses: z.enum(['地面出场技', '空中出场技']).optional(),
})

export const NameTagsSchema = z.strictObject({
  chain: int().min(0).max(6).optional(),
  passive: int().min(0).optional(),
  dodgeCounter: z.literal(true).optional(),
  dir: z.enum(['前', '后']).optional(),
})

/** 判定行连上的 dmg 行（TD-01 §4）。via = 'nanoka'：声骸行在 dmg 里没有，取 nanoka 声骸数据的伤害条目
 *  （按削韧值、大招回收连，或 dmg-join.json 写 'nanoka::<条目 ID>'；skillId 是条目 ID，没有的字段记 null / 0） */
export const GenDmgSchema = z.strictObject({
  via: z.enum(['direct', 'alias', 'nanoka']),
  charaId: z.string(),
  skillName: z.string(),
  dmgCalc: nullable(z.string()),
  skillId: nullable(int()),
  skillType: nullable(int()),
  calcType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  element: int().min(0).max(6),
  damageType: int().min(0),
  subType: nullable(int()),
  relatedProperty: int(),
  multiplier: z.number().min(0),
  rates: z.array(z.number()).length(20),
  energy: nullable(z.number()),
  toughLv: nullable(z.number()),
  weaknessLvl: nullable(z.number()),
  hardnessLv: nullable(z.number()),
  formulaType: int().min(0),
  formulaRate: z.number().optional(),     // FormulaType ≠ 0 时：FormulaParam5 按同一技能等级取值 × 0.0001（TD-03 §3.2）
  cureBase: z.number().optional(),        // CalculateType = 1 时：CureBaseValue 按同一技能等级取值（TD-03 §7）
})

export const GenRowSchema = z.strictObject({
  row: int().positive(),
  name: z.string().min(1),
  kind: z.enum(['hit', 'gain', 'dilation', 'marker']),
  eventSpawned: z.boolean(),
  spawnFrame: nullable(int().min(0)),
  birthFrame: nullable(int().min(0)),       // 发生帧公式 N = P + f(Q) 的 P 换算成帧；只在 < spawnFrame 时有值（TD-01 §3.1、TD-04 §5.4）
  lifeFrames: nullable(FrameCol),
  hitstop: z.strictObject({ self: nullable(int().min(0)), enemy: nullable(int().min(0)) }),
  deriveFrame: nullable(int().min(0)),
  deriveDuration: nullable(FrameCol),
  endFrame: nullable(int().min(0)),
  priority: nullable(z.array(int().min(0).max(12)).min(1)),
  priorityChange: nullable(z.array(int().min(0)).min(1)),
  parry: nullable(z.boolean()),
  persists: nullable(z.boolean()),
  followHitstop: nullable(z.boolean()),
  toughness: nullable(z.number()),
  tunability: nullable(z.number()),
  gains: z.strictObject({
    energy: nullable(GainCellSchema),
    concerto: nullable(GainCellSchema),
    core: z.tuple([nullable(GainCellSchema), nullable(GainCellSchema), nullable(GainCellSchema)]),
  }),
  position: nullable(z.string()),
  positionChange: nullable(z.array(int().min(0))),
  dilation: nullable(z.strictObject({
    type: nullable(z.enum(DILATION_TYPES)),
    self: DilationWindowSchema.optional(),
    enemy: DilationWindowSchema.optional(),
    ally: DilationWindowSchema.optional(),
  })),
  hitTarget: nullable(z.string()),
  note: nullable(z.string()),
  noteMerged: z.boolean(),
  hints: HintsSchema,
  nameTags: NameTagsSchema,
  dmg: GenDmgSchema.optional(),
  flags: z.array(z.string()),
})

export const GenGroupSchema = z.strictObject({
  id: z.string().min(1),
  rawId: z.string().min(1),
  idNum: nullable(int()),
  idSuffix: z.string(),
  rows: z.array(GenRowSchema).min(1),
})

export const GenActionFileSchema = z.strictObject({
  key: z.string().min(1),
  sheet: z.enum(['角色-女', '角色-男']),
  sheetName: z.string().min(1),
  startRow: int().positive(),
  ignoredRows: int().min(0),
  groups: z.array(GenGroupSchema),
}).superRefine((f, ctx) => {
  // 组名块内唯一（TD-01 §3.5）
  const seen = new Set<string>()
  f.groups.forEach((g, i) => {
    if (seen.has(g.id)) ctx.addIssue({ code: 'custom', path: ['groups', i, 'id'], message: `组名重复：${g.id}` })
    seen.add(g.id)
  })
})

// ---------------------------------------------------------------------------
// 角色（TD-01 §5.2、§12.3）

const Stat3 = z.strictObject({ hp: z.number().positive(), atk: z.number().positive(), def: z.number().positive() })

export const GenCharacterSchema = z.strictObject({
  key: z.string().min(1),
  sheet: z.enum(['角色-女', '角色-男']),
  sheetName: z.string().min(1),
  dmgCharaId: z.string().min(1),
  element: z.enum(ELEMENTS),
  bodyType: nullable(z.enum(BODY_TYPES)),
  commonBlock: nullable(z.string()),
  baseL1: Stat3,
  base90: Stat3,
  energyCost: z.number().min(0),                    // 0 = 大招不走能量（洛瑟菈、弗洛洛），由钩子 canStart 判定
  coreResources: z.array(z.strictObject({ slot: int().min(1).max(5), name: z.string(), cap: z.number().positive() })),   // 上限为 0 的槽不产出
  tunabilityRate: z.number().min(0),
  harmonyBreakBoost: z.number().min(0),
  texts: z.strictObject({
    chain: z.record(z.string(), z.string()),
    passive: z.record(z.string(), z.string()),
  }),
  actionsFile: z.string(),
})
export const GenCharactersSchema = z.record(z.string(), GenCharacterSchema)

// ---------------------------------------------------------------------------
// 武器、声骸、敌人、效应、谐度破坏、buff 文本（TD-01 §7–§11）

export const GenWeaponSchema = z.strictObject({
  key: z.string().min(1),
  id: int(),
  rarity: int().min(1).max(5),
  owner: nullable(z.string()),
  type: z.enum(WEAPON_TYPES),
  main: z.strictObject({ propId: int(), value90: z.number() }),
  sub: z.strictObject({ propId: int(), value90: z.number() }),
  effects: z.array(z.strictObject({
    text: z.string(),
    stackLimit: nullable(int().min(0)),
    propId: nullable(int()),
    policy: nullable(int()),
    values: nullable(z.array(z.number()).length(5)),
  })),
  row: int().positive(),
})

/** 声骸的一组 = 一个动作（TD-01 §8）：「类型」列每个合并区是一个技能版本（无常凶鹭的点按 / 长按；鸣钟之龟每种体型一行），
 *  版本里有「单段冷却 / 接续时限」的是多段声骸，按行名 "-" 前的前缀分段，每段一组 */
export const GenEchoGroupSchema = z.strictObject({
  id: z.string().min(1),                    // 组名：同动作表 §3.5（首行名去掉最后一个 -后缀）；分段时是前缀；体型前缀去掉
  variant: int().min(1),                    // 第几个技能版本
  stage: nullable(int().min(1)),            // 多段声骸的第几段；不分段为 null
  body: nullable(z.enum(ECHO_BODIES)),      // 体型前缀（只有鸣钟之龟）
  kind: nullable(z.enum(['召唤', '变身'])),
  cooldown: nullable(int().min(0)),         // 「冷却」列，秒 → 帧；只记在版本的第一组（后续段不另算冷却）
  next: nullable(z.strictObject({ from: int().min(0), until: int().min(0) })),   // 单段冷却 / 接续时限（帧）：下一段在本段局部帧 [from, until) 接
  rows: z.array(GenRowSchema).min(1),
})

export const GenEchoSchema = z.strictObject({
  key: z.string().min(1),                   // 声骸名（A 列）
  startRow: int().positive(),
  cost: nullable(z.union([z.literal(1), z.literal(3), z.literal(4)])),   // 来自 `索引` 页，缺失时 curated 补
  description: nullable(z.string()),        // 技能说明原文（X 列）
  descCooldown: nullable(int().min(0)),     // 技能说明里"技能冷却：n秒"（帧）；与「冷却」列不同时打 cooldownText
  textKind: nullable(z.enum(['召唤', '变身'])),   // 说明里先出现的"召唤"（脱手）/"幻形"（变身，不脱手）；与「类型」列不同时打 kindText
  ignoredRows: int().min(0),
  groups: z.array(GenEchoGroupSchema).min(1),
  flags: z.array(z.string()),               // cooldownText、charges（"可使用次数"）、stagesGuess、costMissing、kindText
}).superRefine((e, ctx) => {
  // 组名在声骸内唯一（体型分组同名、体型不同）
  const seen = new Set<string>()
  e.groups.forEach((g, i) => {
    const k = `${g.id}@${g.body ?? ''}`
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['groups', i, 'id'], message: `组名重复：${g.id}` })
    seen.add(k)
  })
})

/** echo-stats.json：base 表的声骸属性（TD-01 §5.4）——主词条满级值、固定副主属性、副词条各档（显示值，比例写小数） */
const EchoCost = z.union([z.literal(1), z.literal(3), z.literal(4)])
const EchoStat = z.strictObject({ cost: EchoCost, stat: z.enum(STAT_KEYS), value: z.number().positive() })
export const GenEchoStatsSchema = z.strictObject({
  mains: z.array(EchoStat),                         // 各 COST 可选的主词条与满级值
  fixedSubs: z.array(EchoStat),                     // 固定副主属性：4C 攻击 150、3C 攻击 100、1C 生命 2280
  subTiers: z.partialRecord(z.enum(STAT_KEYS), z.array(z.number().positive()).min(1)),   // 副词条各档，从低到高
})

const Bar = z.strictObject({ max: z.number().min(0), recover: z.number().min(0), reduce: z.number() })
export const GenEnemySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  count: nullable(int().positive()),
  tag: z.string(),
  cost: z.union([z.literal(1), z.literal(3), z.literal(4)]),
  level: int().positive(),
  hp: z.number().positive(),
  atk: z.number().min(0),
  def: z.number().min(0),
  res: z.strictObject(Object.fromEntries(ELEMENTS.map(e => [e, z.number()])) as Record<(typeof ELEMENTS)[number], z.ZodNumber>),
  whiteBar: Bar,
  whiteBarTough: nullable(z.number().min(0)),       // 白条按削韧值计：prop RageMax ÷ 100 × PropExtraRate（TD-06 §13.2）；prop 里找不到为 null
  poise: Bar,
  tunabilityMax: z.number().min(0),
  vulnerableSec: nullable(z.number()),
  paralysisSec: nullable(z.number()),
  row: int().positive(),
})

export const GenEffectSchema = z.strictObject({
  name: z.enum(EFFECT_NAMES),
  element: z.enum(ELEMENTS),
  subType: int(),
  multipliers: z.array(z.number().min(0)).min(1),   // 第 k 项 = k 层
  maxStacks: int().positive(),
  desc: nullable(z.string()),
  golden: z.array(z.strictObject({ stacks: int().positive(), value: z.number() })).optional(),
})
/** effects.json：各效应 + 按等级的异常伤害基础值（TD-01 §11.2） */
export const GenEffectsFileSchema = z.strictObject({
  effects: z.array(GenEffectSchema),
  abnormalBaseByLevel: z.array(z.number()),
})

// 其余文件的顶层结构：characters.json 见 GenCharactersSchema；enemies / weapons / echoes / buff-texts
// 都是对应条目 schema 的数组（z.array(GenEnemySchema) 等）；tune-break.json 就是下面的 GenTuneBreakSchema。
export const GenTuneBreakSchema = z.strictObject({
  variants: z.array(z.strictObject({
    key: z.string(),                 // '谐度破坏-长刃1'
    weaponType: nullable(z.enum(WEAPON_TYPES)),
    seq: nullable(int().positive()),
    multiplier: z.number().min(0),
    ticks: nullable(int().positive()),
    golden: nullable(z.strictObject({ vsDisharmony: z.number(), vsNormal: z.number() })),
  })),
  costRows: z.array(z.strictObject({ label: z.string(), multiplier: z.number(), vsDisharmony: z.number(), vsNormal: z.number(), ticks: int() })),
  baseByLevel: z.array(z.number()),       // base AO 列 WeaknessDamageBaseValue，下标 = 等级 − 1
  costFactors: z.array(z.strictObject({ cost: z.union([z.literal(1), z.literal(3), z.literal(4)]), factor: z.number().positive() })),   // base R–U 列（TD-03 §6）
})

export const GenBuffTextSchema = z.strictObject({
  row: int().positive(),
  name: z.string().min(1),
  category: z.string(),
  categoryCode: nullable(int()),
  source: nullable(z.string()),
  activeStacks: nullable(z.number()),
  text: z.string(),
  draftable: z.boolean(),
})

export const GenMetaSchema = z.strictObject({
  xlsxFile: z.string(),
  xlsxSha256: z.string().length(64),
  resourceVersion: nullable(z.string()),
  builtAt: z.string(),
  settings: z.strictObject({
    framerate: z.literal(60),
    halfFrameThreshold: z.literal(0.5),
    coop: z.literal(false),
    limitDodgeBulletTimeCanceling: z.literal(false),
    weakPointHitting: z.literal(false),
  }),
  counts: z.record(z.string(), z.number()),
})

/** nanoka.json：nanoka 静态数据里的技能冷却与文本（tools/build/nanoka.py；m0-confirm §5）。只用来核对与起草，装配不直接读 */
export const NanokaCooldownSchema = z.strictObject({
  name: z.string(),                                 // "冷却时间"、"一日花冷却时间"…
  seconds: z.number().min(0),
  frames: int().min(0),
  variesByLevel: z.literal(true).optional(),        // 各技能等级不同时标出；取的是 skillLevel 级
})
export const NanokaCharacterSchema = z.strictObject({
  id: int().positive(),
  name: z.string(),
  skills: z.array(z.strictObject({
    type: z.string(),                               // 常态攻击、共鸣技能、共鸣解放、变奏技能、延奏技能、共鸣回路、固有技能、谐度破坏
    name: z.string(),
    desc: z.string(),                               // 去掉富文本标签、填好参数
    cooldowns: z.array(NanokaCooldownSchema),
  })),
  chains: z.array(z.strictObject({ n: int().min(1).max(6), name: z.string(), desc: z.string() })),
  treeStats: z.record(z.string(), z.number()),      // 技能树属性节点：名字（"攻击提升"）→ 全部点亮的合计（小数）
})
/** nanoka 的声骸：技能说明、冷却、伤害条目（构建时给 dmg 里没有的声骸行连倍率，TD-01 §8）、所属套装 */
export const NanokaEchoSchema = z.strictObject({
  id: int().positive(),
  name: z.string(),                                 // nanoka 的中文名（异相·X 取 X 的条目）
  desc: z.string(),                                 // 技能说明，按 5 级填好参数
  cooldown: nullable(z.number().min(0)),            // 秒：说明里"技能冷却：{n}秒"的参数
  damage: z.array(z.strictObject({
    id: z.string(),                                 // 伤害条目 ID（dmg-join.json 写 'nanoka::<ID>' 时用）
    element: int().min(0).max(6),
    relatedProperty: z.string(),                    // 攻击 / 防御 / 生命
    type: int().min(0),                             // Damage.Type：5 声骸技能，4 共鸣技能…
    rateLv: z.array(z.number()),                    // 各级倍率原值（× 10000，同 dmg RateLv）；声骸取 5 级
    energy: z.number(),
    toughLv: z.number(),
    weaknessLvl: z.number(),
    hardnessLv: z.number(),
  })),
  sets: z.array(z.string()),                        // 所属套装名
})
export const NanokaFileSchema = z.strictObject({
  source: z.string(),
  version: z.string(),
  skillLevel: int().positive(),
  characters: z.record(z.string(), NanokaCharacterSchema),   // 键是 xlsx 的角色块名
  echoes: z.record(z.string(), NanokaEchoSchema).default({}),   // 键是 xlsx 的声骸名
  echoSets: z.record(z.string(), z.strictObject({              // 套装名 → 件数 → 效果说明（填好参数）
    id: int(), pieces: z.record(z.string(), z.string()),
  })).default({}),
})

export const GoldenDamageSchema = z.strictObject({
  context: z.strictObject({ char: z.string(), panel: z.record(z.string(), z.number()), target: z.record(z.string(), z.union([z.number(), z.string()])) }),
  entries: z.array(z.strictObject({
    char: z.string(), section: nullable(z.string()), label: z.string(),
    nonCrit: z.number(), crit: nullable(z.number()), ticks: nullable(z.number()),
    row: int().positive(), col: z.string(),
    dmgKey: z.tuple([z.string(), z.string()]).optional(),
  })),
})

/** fixtures/golden-zones.json：每个标准答案单元格拆成的乘区输入，M1 用它对拍公式（TD-03 §10） */
const Num = z.number().finite()
export const GoldenZoneSchema = z.strictObject({
  cell: z.string(),                                     // '伤害计算' 页单元格，如 'D5'
  name: z.string(),
  branch: z.enum(['nc', 'cr']),                         // 非暴击 / 暴击
  formula: z.enum(['hurt', 'abnormal', 'tune', 'heal']),
  expected: z.number(),                                 // 缓存值
  key: z.string().optional(),                           // 倍率 MATCH 用的键（charaId & DmgCalc），用于回连 dmg
  rate: z.number().optional(),                          // dmg RateLv 原值（× 10000）
  table: z.string().optional(),                         // 倍率所在表列：'dmg!AH'、'base!AN'…
  defRef: z.string().optional(), resRef: z.string().optional(),   // 引用了预先算好的防御 / 抗性系数格
  z: z.strictObject({
    base: Num, crit: Num.optional(),
    def: z.strictObject({ targetDef: Num, defRate: Num, ignore: Num, level: Num }).optional(),
    bonus: Num.optional(), res: Num.optional(), dr: Num.optional(), dre: Num.optional(), special: Num.optional(),
    amp0: Num.optional(), amp: z.array(Num).length(9).optional(), amp1002: Num.optional(),
    fin: z.array(Num).length(8).optional(), fin1001: Num.optional(),
    heal: Num.optional(), breakBoost: Num.optional(), vsNormal: z.literal(true).optional(),
    other: Num.optional(),                              // 未归类因子之积；出现即说明公式有新形状，构建报告会列出
  }),
})
export const GoldenZonesSchema = z.array(GoldenZoneSchema)

export type GainCell = z.infer<typeof GainCellSchema>
export type GenRow = z.infer<typeof GenRowSchema>
export type GenGroup = z.infer<typeof GenGroupSchema>
export type GenActionFile = z.infer<typeof GenActionFileSchema>
export type GenCharacter = z.infer<typeof GenCharacterSchema>
export type GenWeapon = z.infer<typeof GenWeaponSchema>
export type GenEcho = z.infer<typeof GenEchoSchema>
export type GenEchoGroup = z.infer<typeof GenEchoGroupSchema>
export type GenEchoStats = z.infer<typeof GenEchoStatsSchema>
export type GenEnemy = z.infer<typeof GenEnemySchema>
export type GenEffect = z.infer<typeof GenEffectSchema>
export type GenEffectsFile = z.infer<typeof GenEffectsFileSchema>
export type GenTuneBreak = z.infer<typeof GenTuneBreakSchema>
export type GenBuffText = z.infer<typeof GenBuffTextSchema>
export type GenMeta = z.infer<typeof GenMetaSchema>
export type GoldenDamage = z.infer<typeof GoldenDamageSchema>
export type GoldenZone = z.infer<typeof GoldenZoneSchema>
export type NanokaCharacter = z.infer<typeof NanokaCharacterSchema>
export type NanokaEcho = z.infer<typeof NanokaEchoSchema>
export type NanokaFile = z.infer<typeof NanokaFileSchema>
