// src/data/common.ts —— 全项目共用的基础类型、枚举与代码表（TD-02 §2）

/** 帧：60fps 下的整数帧。只有角色局部帧 localFrame 允许是小数（TD-04）。 */
export type Frame = number
/** 比例一律存小数：12% 存 0.12。 */
export type Ratio = number
/** 角色键：动作表块名，漂泊者带性别后缀（'散华'、'雷主·女'）。 */
export type CharName = string
/** 动作块键：角色键或通用块（'通用-中@女'）。 */
export type BlockKey = string
/** 动作 ID：动作组名（TD-01 §3.5）。 */
export type ActionId = string
export type Slot = 0 | 1 | 2
export type Chain = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type Rank = 1 | 2 | 3 | 4 | 5

export const ELEMENTS = ['物理', '冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] as const
export type Element = (typeof ELEMENTS)[number]
/** dmg 表 Damage.Element、base 表 ElementPropertyType 的代码 */
export const ELEMENT_BY_CODE: Readonly<Record<number, Element>> = {
  0: '物理', 1: '冷凝', 2: '热熔', 3: '导电', 4: '气动', 5: '衍射', 6: '湮灭',
}

export const DAMAGE_TAGS = [
  '普攻', '重击', '共鸣技能', '共鸣解放', '变奏', '延奏', '声骸技能', '其他',
  '异常效应', '谐度破坏', '震谐响应', '骇破响应',
] as const
export type DamageTag = (typeof DAMAGE_TAGS)[number]
/** dmg 表 Damage.Type 的代码（13 暂无数据，TD-01 Q14） */
export const DAMAGE_TAG_BY_TYPE: Readonly<Record<number, DamageTag>> = {
  0: '普攻', 1: '重击', 2: '共鸣解放', 3: '变奏', 4: '共鸣技能', 5: '声骸技能', 6: '其他',
  7: '延奏', 10: '异常效应', 11: '谐度破坏', 12: '震谐响应', 14: '骇破响应',
}

export const WEAPON_TYPES = ['长刃', '迅刀', '佩枪', '臂铠', '音感仪'] as const
export type WeaponType = (typeof WEAPON_TYPES)[number]
export const WEAPON_TYPE_BY_CODE: Readonly<Record<number, WeaponType>> = {
  1: '长刃', 2: '迅刀', 3: '佩枪', 4: '臂铠', 5: '音感仪',
}

/** `索引` 页体型分类，去掉空格（TD-01 §6） */
export const BODY_TYPES = ['女-大', '女-中', '女-中小', '女-小', '女-特殊', '男-大', '男-中', '男-小'] as const
export type BodyType = (typeof BODY_TYPES)[number]

export const DILATION_TYPES = ['攻击顿帧', '时停', '全局时停', '极限闪避顿帧', '弹反顿帧'] as const
export type DilationType = (typeof DILATION_TYPES)[number]
export type DilationSide = 'self' | 'enemy' | 'ally'

export const EFFECT_NAMES = [
  '风蚀效应', '电磁效应', '霜渐效应', '聚爆效应', '光噪效应', '虚湮效应', '霜冻效应', '烈阳余烬',
] as const
export type EffectName = (typeof EFFECT_NAMES)[number]

export const ACTION_KINDS = [
  'normal', 'heavy', 'skill', 'liberation', 'intro', 'outro', 'echo', 'dodge', 'other',
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export type RowKind = 'hit' | 'gain' | 'dilation' | 'marker'
/** 角色资源：大招能量、协奏、核心资源槽 1–5（槽号与 base 主表 SpecialEnergy1…5 一致） */
export const RESOURCE_KINDS = ['energy', 'concerto', 'core1', 'core2', 'core3', 'core4', 'core5'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

// ---------------------------------------------------------------------------
// 属性：场景里写声骸词条、武器属性都用这组中文键（TD-02 §2）
export const STAT_KEYS = [
  '生命', '生命%', '攻击', '攻击%', '防御', '防御%',
  '暴击率', '暴击伤害', '共鸣效率', '治疗效果加成',
  '冷凝伤害加成', '热熔伤害加成', '导电伤害加成', '气动伤害加成', '衍射伤害加成', '湮灭伤害加成',
  '普攻伤害加成', '重击伤害加成', '共鸣技能伤害加成', '共鸣解放伤害加成', '全属性伤害加成',
] as const
export type StatKey = (typeof STAT_KEYS)[number]
/** 固定值属性；其余 StatKey 都是比例（场景里写小数） */
export const FLAT_STATS: readonly StatKey[] = ['生命', '攻击', '防御']

/** weapon / base 表里的属性 ID → StatKey（8 位以上的专属效果 ID 不在此表，TD-01 §4.2） */
export const STAT_BY_PROP_ID: Readonly<Record<number, StatKey>> = {
  2: '生命', 7: '攻击', 10: '防御', 8: '暴击率', 9: '暴击伤害', 11: '共鸣效率',
  14: '共鸣技能伤害加成', 17: '普攻伤害加成', 18: '重击伤害加成', 19: '共鸣解放伤害加成',
  22: '冷凝伤害加成', 23: '热熔伤害加成', 24: '导电伤害加成', 25: '气动伤害加成', 26: '衍射伤害加成',
  27: '湮灭伤害加成', 35: '治疗效果加成', 10002: '生命%', 10007: '攻击%', 10010: '防御%',
  220027: '全属性伤害加成',
}

// ---------------------------------------------------------------------------
// 乘区 ID（TD-03 §2 全表）：面板类先合成 RelatedAttr 与暴击参数；公式类沿用 CalculateHurt 的变量名，
// 加深 / 最终伤害的类别直接写进名字（DamageAmplify3 = "3 类加深"）。新增一个乘区 = 在这里加一个字面量 + 在 formula 里用上它。
export const PANEL_ZONES = [
  'hpPct', 'hpFlat', 'atkPct', 'atkFlat', 'defPct', 'defFlat',
  'critRate', 'critDamage', 'energyRegen', 'healBonus',
  'tunabilityRate',              // 偏谐效率（TD-06）
  'harmonyBreakBoost',           // 谐度破坏增幅，单位是"点"（面板上的 20 就写 20），公式里 × 0.01
] as const
export type PanelZone = (typeof PANEL_ZONES)[number]

export const AMPLIFY_ZONES = [
  'DamageAmplify0',              // 0 类加深 = 不带类别的"X 伤害加深"（xlsx dmgampl0）
  'DamageAmplify1', 'DamageAmplify2', 'DamageAmplify3', 'DamageAmplify4', 'DamageAmplify5',
  'DamageAmplify6', 'DamageAmplify7', 'DamageAmplify8', 'DamageAmplify9',
  'DamageAmplify1002',           // 霜冻专用的一类（xlsx dmgamplxxxx "1002类"）
] as const
export const FINAL_ZONES = [
  'FinalDamage0', 'FinalDamage1', 'FinalDamage2', 'FinalDamage3', 'FinalDamage4', 'FinalDamage5', 'FinalDamage6',
  'FinalDamage7',                // xlsx 只在骇破响应的公式里用到（"C[0]7"）
  'FinalDamage1001',             // 集谐响应等（xlsx dmgpost(1001)）
] as const

export const FORMULA_ZONES = [
  'RateBonus',                   // 倍率提升：Rate × (1 + Σ)
  'ExtraEffect9',                // 固定附加伤害，加在基础项上
  'DamageChange',                // 通用伤害加成
  'DamageChangeElement',         // 元素伤害加成（配合 filter.elements）
  'DamageChangeType',            // 类型伤害加成（配合 filter.tags）
  'RoleIgnoreDefRate',           // 无视防御（xlsx 防御无视99）
  'TargetDefRate',               // 目标防御 ±%（减防写负数；xlsx 防御无视10 + 目标防御提升）
  'RoleIgnoreResistance',        // 无视抗性
  'TargetElementResistant',      // 目标抗性 ±（减抗写负数）
  'TargetDamageReduce',          // 目标伤害减免（负数 = 目标受到伤害提高）
  'TargetElementDamageReduce',   // 目标伤害减免的第二个独立因子（xlsx DRE）
  'SpecialDamageChange',         // 特殊伤害加成（独立乘区）
  ...AMPLIFY_ZONES,
  ...FINAL_ZONES,
  'TargetHealedChange',          // 目标受治疗加成（只用于治疗）
] as const
export type FormulaZone = (typeof FORMULA_ZONES)[number]
export const ZONE_IDS = [...PANEL_ZONES, ...FORMULA_ZONES] as const
export type ZoneId = (typeof ZONE_IDS)[number]

/** 场景 StatKey → 乘区（带隐含过滤条件）；resolve 用它把声骸 / 武器属性落到面板或常驻加成上 */
export const STAT_TO_ZONE: Readonly<Record<StatKey, { zone: ZoneId; elements?: Element[]; tags?: DamageTag[] }>> = {
  '生命': { zone: 'hpFlat' }, '生命%': { zone: 'hpPct' },
  '攻击': { zone: 'atkFlat' }, '攻击%': { zone: 'atkPct' },
  '防御': { zone: 'defFlat' }, '防御%': { zone: 'defPct' },
  '暴击率': { zone: 'critRate' }, '暴击伤害': { zone: 'critDamage' },
  '共鸣效率': { zone: 'energyRegen' }, '治疗效果加成': { zone: 'healBonus' },
  '冷凝伤害加成': { zone: 'DamageChangeElement', elements: ['冷凝'] },
  '热熔伤害加成': { zone: 'DamageChangeElement', elements: ['热熔'] },
  '导电伤害加成': { zone: 'DamageChangeElement', elements: ['导电'] },
  '气动伤害加成': { zone: 'DamageChangeElement', elements: ['气动'] },
  '衍射伤害加成': { zone: 'DamageChangeElement', elements: ['衍射'] },
  '湮灭伤害加成': { zone: 'DamageChangeElement', elements: ['湮灭'] },
  '普攻伤害加成': { zone: 'DamageChangeType', tags: ['普攻'] },
  '重击伤害加成': { zone: 'DamageChangeType', tags: ['重击'] },
  '共鸣技能伤害加成': { zone: 'DamageChangeType', tags: ['共鸣技能'] },
  '共鸣解放伤害加成': { zone: 'DamageChangeType', tags: ['共鸣解放'] },
  '全属性伤害加成': { zone: 'DamageChangeElement', elements: ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] },
}
