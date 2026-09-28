// src/engine/formula.ts —— 伤害公式（TD-03）：全部是纯函数，不读任何全局状态
// 公式来源：base!E5 CalculateHurt / E6 CalculateHeal / E7 CalculateAbnormal 与「伤害计算」页数组公式（TD-03 §1）。
// 乘法顺序照 xlsx 数组公式从左到右写，保证与标准答案逐位一致（CEILING 对最后一位很敏感）。
import { AMPLIFY_ZONES, FINAL_ZONES, ZONE_IDS } from '../data/common'
import type { DamageTag, EffectName, Element, Slot, ZoneId } from '../data/common'
import type { BuffDef, BuffFilter } from '../data/buff.schema'
import type { Rules, TuneBreakTable } from '../data/gamedata'
import type { HitDraft, HitFactors, StaticPanel, StatParts, ZoneAccumulator } from './types'

export type ZoneSums = Record<ZoneId, number>
export type FormulaRules = Pick<Rules, 'critRateCap' | 'defFactorCap' | 'highResThreshold'>
export type RelatedAttr = 'atk' | 'hp' | 'def' | 'energyRegen'

export const emptyZones = (): ZoneSums => Object.fromEntries(ZONE_IDS.map(z => [z, 0])) as ZoneSums
export const emptyAccumulator = (): ZoneAccumulator => ({ zones: emptyZones(), critOnly: emptyZones() })

function addZones(a: ZoneSums, b: Partial<ZoneSums>): ZoneSums {
  const out = { ...a }
  for (const k of Object.keys(b) as ZoneId[]) out[k] += b[k] ?? 0
  return out
}

// ---------------------------------------------------------------------------
// §3.2 各因子

/** 面板合成：floor(基础 × (1 + 百分比)) + 固定值（xlsx 伤害配置 R2147 的写法） */
export function composeStat(p: StatParts, pct: number, flat: number): number {
  return Math.floor(p.base * (1 + p.pct + pct)) + p.flat + flat
}

/** RelatedProperty 对应的属性值；共鸣效率按游戏内单位（1 = 0.01%）换算，倍率 × 它 = 原始倍率 × 共鸣效率 */
export function relatedAttrValue(attr: RelatedAttr, panel: StaticPanel, z: ZoneSums): number {
  switch (attr) {
    case 'atk': return composeStat(panel.atk, z.atkPct, z.atkFlat)
    case 'hp': return composeStat(panel.hp, z.hpPct, z.hpFlat)
    case 'def': return composeStat(panel.def, z.defPct, z.defFlat)
    case 'energyRegen': return (panel.energyRegen + z.energyRegen) * 10000
  }
}

/**
 * 防御系数：min(cap, 1 / (有效防御 / (800 + 8·Lv) + 1))，有效防御 = 目标防御 × (1 + 防御±%) × (1 − 无视防御)。
 * 减防超过 100% 时有效防御为负、系数 > 1；分母 ≤ 0 时 xlsx 会算出负数，这里直接取上限（TD-03 §3.2）。
 */
export function defFactor(targetDef: number, defRate: number, ignore: number, level: number, cap = 2): number {
  const d = targetDef * (1 + defRate) * (1 - ignore) / (800 + level * 8) + 1
  return d <= 0 ? cap : Math.min(cap, 1 / d)
}

/** 抗性系数（三段）：r ≤ 0 → 1 − r/2；r < 0.8 → 1 − r；否则 1 / (1 + 5r) */
export function resFactor(r: number, high = 0.8): number {
  if (r <= 0) return 1 - r / 2
  if (r < high) return 1 - r
  return 1 / (1 + r * 5)
}

const clamp0 = (x: number) => Math.max(x, 0)
const AMP_1_9 = AMPLIFY_ZONES.slice(1, 10)
const FINAL_0_7 = FINAL_ZONES.slice(0, 8)
const ampClasses = (z: ZoneSums) => AMP_1_9.reduce((p, k) => p * (1 + z[k]), 1)
const finalClasses = (z: ZoneSums) => FINAL_0_7.reduce((p, k) => p * (1 + z[k]), 1)

// ---------------------------------------------------------------------------
// §3 直接伤害（CalculateHurt）

export interface HitContext {
  rate: number                         // 倍率，= HitDraft.multiplier
  attr: RelatedAttr
  panel: StaticPanel                   // 出伤者静态面板
  extraFlat: number                    // Formula1：钩子给出的附加基础伤害
  level: number                        // 出伤者等级（rules.charLevel）
  enemy: { def: number; res: number }  // 目标防御；本次伤害元素的基础抗性
}

export interface HitResult {
  nonCrit: number                      // 已 CEILING
  crit: number                         // 已 CEILING
  expected: number                     // (1 − p) × nonCrit + p × crit，不取整
  critRate: number                     // p，已钳到 [0, critRateCap]
  factors: HitFactors
}

export function computeHit(ctx: HitContext, acc: ZoneAccumulator, rules: FormulaRules): HitResult {
  const zc = addZones(acc.zones, acc.critOnly)                     // 暴击分支 = 全部 + 暴击专属
  const critDamage = ctx.panel.critDamage + zc.critDamage
  const nc = hurt(ctx, acc.zones, 1, rules)
  const cr = hurt(ctx, zc, critDamage, rules)
  const p = Math.min(Math.max(ctx.panel.critRate + acc.zones.critRate, 0), rules.critRateCap)
  return {
    nonCrit: nc.value, crit: cr.value, expected: (1 - p) * nc.value + p * cr.value, critRate: p,
    factors: { ...nc.factors, critRate: p, critDamage },
  }
}

function hurt(ctx: HitContext, z: ZoneSums, crit: number, rules: FormulaRules) {
  const base = ctx.rate * (1 + z.RateBonus) * relatedAttrValue(ctx.attr, ctx.panel, z) + z.ExtraEffect9 + ctx.extraFlat
  const def = defFactor(ctx.enemy.def, z.TargetDefRate, z.RoleIgnoreDefRate, ctx.level, rules.defFactorCap)
  const bonus = 1 + z.DamageChange + z.DamageChangeElement + z.DamageChangeType
  const res = resFactor(ctx.enemy.res + z.TargetElementResistant - z.RoleIgnoreResistance, rules.highResThreshold)
  const dr1 = 1 - Math.min(z.TargetDamageReduce, 1)
  const dr2 = 1 - Math.min(z.TargetElementDamageReduce, 1)
  const special = 1 + Math.max(z.SpecialDamageChange, -1)
  const amp19 = clamp0(ampClasses(z))
  const fin07 = clamp0(finalClasses(z))
  const fin1001 = clamp0(1 + z.FinalDamage1001)
  const amp0 = clamp0(1 + z.DamageAmplify0)
  const amp1002 = clamp0(1 + z.DamageAmplify1002)
  const value = Math.ceil(base * crit * def * bonus * res * dr1 * dr2 * special * amp19 * fin07 * fin1001 * amp0 * amp1002)
  return {
    value,
    factors: { base, def, bonus, res, reduce: dr1 * dr2, special, amplify: amp0 * amp19 * amp1002, final: fin07 * fin1001 },
  }
}

// ---------------------------------------------------------------------------
// §5 异常效应伤害（CalculateAbnormal）：不暴击、不吃伤害加成

export interface AbnormalContext {
  base: number                         // abnormalBaseByLevel[等级 − 1]
  multiplier: number                   // 当前层数的倍率（EffectDef.multipliers[层数 − 1]）
  level: number
  enemy: { def: number; res: number }  // res：效应所属元素的基础抗性
}

export function computeAbnormal(ctx: AbnormalContext, acc: ZoneAccumulator, rules: FormulaRules): number {
  const z = acc.zones
  const def = defFactor(ctx.enemy.def, z.TargetDefRate, z.RoleIgnoreDefRate, ctx.level, rules.defFactorCap)
  const res = resFactor(ctx.enemy.res + z.TargetElementResistant - z.RoleIgnoreResistance, rules.highResThreshold)
  return Math.ceil(ctx.base * ctx.multiplier * def * res
    * (1 - Math.min(z.TargetDamageReduce, 1)) * (1 - Math.min(z.TargetElementDamageReduce, 1))
    * (1 + Math.max(z.SpecialDamageChange, -1))
    * clamp0(ampClasses(z)) * clamp0(finalClasses(z)) * clamp0(1 + z.FinalDamage1001)
    * clamp0(1 + z.DamageAmplify0) * clamp0(1 + z.DamageAmplify1002))
}

export const abnormalBase = (table: number[], level: number): number => table[level - 1] ?? 0

// ---------------------------------------------------------------------------
// §6 谐度破坏 / 震谐响应 / 骇破响应：基础值按等级与敌人 COST

/** Excel ROUND(x, 2)（正数：四舍五入到分） */
const round2 = (x: number) => Math.round(x * 100) / 100
export const tuneBase = (t: TuneBreakTable, level: number, cost: 1 | 3 | 4): number =>
  round2((t.baseByLevel[level - 1] ?? 0) * t.costFactor[cost])

export interface TuneContext {
  base: number                         // tuneBase(…)
  rate: number                         // 谐度破坏：通用「谐度破坏-<武器>」行；响应：角色的响应行
  level: number
  enemy: { def: number; res: number }  // 谐度破坏按物理抗性；响应按角色元素
  harmonyBreakBoost: number            // 谐破增幅（点），面板 + buff
  vsNormal?: boolean                   // 谐度破坏打在非失谐目标上（× 0.0001）
}

export function computeTuneBreak(ctx: TuneContext, acc: ZoneAccumulator, rules: FormulaRules): number {
  const z = acc.zones
  const def = defFactor(ctx.enemy.def, z.TargetDefRate, z.RoleIgnoreDefRate, ctx.level, rules.defFactorCap)
  const res = resFactor(ctx.enemy.res + z.TargetElementResistant - z.RoleIgnoreResistance, rules.highResThreshold)
  let v = ctx.base * ctx.rate * def * res
    * (1 - Math.min(z.TargetDamageReduce, 1)) * (1 - Math.min(z.TargetElementDamageReduce, 1))
    * (1 + ctx.harmonyBreakBoost * 0.01) * clamp0(finalClasses(z))
  if (ctx.vsNormal) v *= 1 - 0.9999
  return Math.ceil(v)
}

// ---------------------------------------------------------------------------
// §7 治疗（CalculateHeal）：不暴击

export interface HealContext { rate: number; attr: RelatedAttr; panel: StaticPanel; cureBase: number }

export function computeHeal(ctx: HealContext, acc: ZoneAccumulator): number {
  const z = acc.zones
  const attr = relatedAttrValue(ctx.attr, ctx.panel, z)
  return Math.ceil((ctx.rate * attr + ctx.cureBase) * (ctx.panel.healBonus + z.healBonus + z.TargetHealedChange + 1))
}

// ---------------------------------------------------------------------------
// §4 收集：哪些 buff 进这一次结算、怎么累加

/** 对本次结算有效的 buff 实例（引擎已按作用对象筛过：挂在出伤者身上，或挂在目标身上） */
export interface ActiveBuff { def: BuffDef; value: number; stacks: number; owner: Slot | 'env' }

/** 过滤条件要看的信息 */
export interface HitView {
  element: Element
  tags: readonly DamageTag[]
  action: string
  judgment: string
  effect?: EffectName                  // 异常效应自身的伤害
  enemyEffects: ReadonlySet<EffectName>
}

export function hitView(d: HitDraft, action: string, enemyEffects: ReadonlySet<EffectName>): HitView {
  return { element: d.element, tags: d.tags, action, judgment: d.judgment.name, ...(d.effect ? { effect: d.effect } : {}), enemyEffects }
}

/** 字段之间是"且"，同一字段的多个取值是"或"；没写的字段不限制 */
export function matchesFilter(f: BuffFilter | undefined, h: HitView): boolean {
  if (!f) return true
  if (f.elements && !f.elements.includes(h.element)) return false
  if (f.tags && !f.tags.some(t => h.tags.includes(t))) return false
  if (f.actions && !f.actions.includes(h.action)) return false
  if (f.judgments && !f.judgments.includes(h.judgment)) return false
  if (f.enemyEffect && !h.enemyEffects.has(f.enemyEffect)) return false
  if (f.effects && !(h.effect && f.effects.includes(h.effect))) return false
  return true
}

const DEF_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(['RoleIgnoreDefRate', 'TargetDefRate'])

/** 异常效应伤害的防御例外：出伤者身上的减防 / 无视防御不生效（xlsx 异常防御系数里的"对异常补偿"两格） */
function skipForAbnormal(b: ActiveBuff): boolean {
  return DEF_ZONES.has(b.def.zone) && b.def.target !== 'enemy' && b.owner !== 'env' && !b.def.filter?.tags?.includes('异常效应')
}

/** 按 zone 把 value × stacks 累加；critOnly 的进暴击专属桶；最后并入钩子直接补的值 */
export function accumulate(h: HitView, buffs: readonly ActiveBuff[], draft?: Pick<HitDraft, 'zones' | 'critOnly'>): ZoneAccumulator {
  const acc = emptyAccumulator()
  const abnormal = h.tags.includes('异常效应')
  for (const b of buffs) {
    if (!matchesFilter(b.def.filter, h)) continue
    if (abnormal && skipForAbnormal(b)) continue
    const bucket = b.def.filter?.critOnly ? acc.critOnly : acc.zones
    bucket[b.def.zone] += b.value * b.stacks
  }
  if (draft) {
    acc.zones = addZones(acc.zones, draft.zones)
    acc.critOnly = addZones(acc.critOnly, draft.critOnly)
  }
  return acc
}
