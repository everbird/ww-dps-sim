// tests/td03.test.ts —— TD-03 伤害公式的测试（§11）
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { AMPLIFY_ZONES, FINAL_ZONES } from '../src/data/common'
import type { ZoneId } from '../src/data/common'
import { BuffDefSchema } from '../src/data/buff.schema'
import type { BuffDefInput } from '../src/data/buff.schema'
import { GoldenZonesSchema } from '../src/data/generated.schema'
import type { GoldenZone } from '../src/data/generated.schema'
import { DEFAULT_RULES } from '../src/data/gamedata'
import type { TuneBreakTable } from '../src/data/gamedata'
import {
  accumulate, computeAbnormal, computeHeal, computeHit, computeTuneBreak, defFactor, emptyAccumulator, resFactor, tuneBase,
} from '../src/engine/formula'
import type { ActiveBuff, HitContext, HitView } from '../src/engine/formula'
import type { StaticPanel, ZoneAccumulator } from '../src/engine/types'

const R = DEFAULT_RULES
const panel = (o: Partial<StaticPanel> = {}): StaticPanel => ({
  hp: { base: 0, pct: 0, flat: 0 }, atk: { base: 0, pct: 0, flat: 0 }, def: { base: 0, pct: 0, flat: 0 },
  critRate: 0, critDamage: 1.5, energyRegen: 1, healBonus: 0, tunabilityRate: 1, harmonyBreakBoost: 0, ...o,
})
const acc = (zones: Partial<Record<ZoneId, number>>, critOnly: Partial<Record<ZoneId, number>> = {}): ZoneAccumulator => {
  const a = emptyAccumulator()
  Object.assign(a.zones, zones); Object.assign(a.critOnly, critOnly)
  return a
}
const enemy = { def: 1593, res: 0.2 }             // 全息 6 · 90 级（伤害计算 R3）

describe('T03-1 标准形：散华 普攻第一段（伤害计算 D5 / E5）', () => {
  const ctx: HitContext = {
    rate: 0.4871, attr: 'atk', extraFlat: 0, level: 90, enemy,
    panel: panel({ atk: { base: 1928, pct: 0, flat: 0 }, critRate: 0.913, critDamage: 2.3 }),
  }
  const r = computeHit(ctx, acc({ DamageChangeElement: 0.12, DamageChangeType: 0.2 }), R)
  test('非暴击 485、暴击 1114', () => {
    expect(r.nonCrit).toBe(485)
    expect(r.crit).toBe(1114)
  })
  test('期望 = 0.087 × 485 + 0.913 × 1114', () => expect(r.expected).toBeCloseTo(1059.277, 3))
  test('各因子', () => {
    expect(r.factors.base).toBeCloseTo(939.1288, 4)
    expect(r.factors.def).toBeCloseTo(1520 / 3113, 9)
    expect(r.factors.bonus).toBeCloseTo(1.32, 9)
    expect(r.factors.res).toBeCloseTo(0.8, 9)
  })
})

describe('T03-2 无视防御 + 0 类加深：散华 重击·爆裂（P5 / Q5）', () => {
  const ctx: HitContext = {
    rate: 1.8629, attr: 'atk', extraFlat: 0, level: 90, enemy,
    panel: panel({ atk: { base: 1928, pct: 0, flat: 0 }, critDamage: 2.3 }),
  }
  const r = computeHit(ctx, acc({ DamageChangeElement: 0.12, RoleIgnoreDefRate: 0.12, DamageAmplify0: 0.36 }), R)
  test('防御系数 0.5202', () => expect(r.factors.def).toBeCloseTo(0.5202201352572352, 12))
  test('非暴击 2277、暴击 5237', () => {
    expect(r.nonCrit).toBe(2277)
    expect(r.crit).toBe(5237)
  })
})

describe('T03-3 抗性三段与钳位', () => {
  test('负抗减半、常规、高抗衰减', () => {
    expect(resFactor(-0.2)).toBeCloseTo(1.1, 12)
    expect(resFactor(0.2)).toBeCloseTo(0.8, 12)
    expect(resFactor(0.79)).toBeCloseTo(0.21, 12)
    expect(resFactor(0.8)).toBeCloseTo(0.2, 12)            // 阈值属于高抗段：1 / (1 + 4)
    expect(resFactor(1)).toBeCloseTo(1 / 6, 12)
  })
  test('防御系数：减防超过 100% 时 > 1，上限 2', () => {
    expect(defFactor(1593, -1.2, 0, 90)).toBeCloseTo(1.26519, 5)
    expect(defFactor(1593, -1.5, 0, 90)).toBe(2)
    expect(defFactor(1593, -2, 0, 90)).toBe(2)              // 分母 ≤ 0：取上限，不出负数
  })
  const ctx: HitContext = { rate: 1, attr: 'atk', extraFlat: 0, level: 90, enemy: { def: 0, res: 0 }, panel: panel({ atk: { base: 1000, pct: 0, flat: 0 } }) }
  test('减免超过 100% 按 100% 算', () => expect(computeHit(ctx, acc({ TargetDamageReduce: 1.5 }), R).nonCrit).toBe(0))
  test('加深 1–9 类先连乘再钳到 ≥ 0（与 xlsx 一致）', () => {
    expect(computeHit(ctx, acc({ DamageAmplify1: -1.5, DamageAmplify2: -1.5 }), R).nonCrit).toBe(250)
    expect(computeHit(ctx, acc({ DamageAmplify1: -1.5 }), R).nonCrit).toBe(0)
  })
})

describe('T03-4 暴击分支', () => {
  const ctx: HitContext = { rate: 1, attr: 'atk', extraFlat: 0, level: 90, enemy: { def: 0, res: 0 }, panel: panel({ atk: { base: 1000, pct: 0, flat: 0 }, critRate: 1.3, critDamage: 2 }) }
  const r = computeHit(ctx, acc({ critDamage: 0.5 }, { DamageAmplify3: 0.2 }), R)
  test('critOnly 只进暴击分支', () => {
    expect(r.nonCrit).toBe(1000)
    expect(r.crit).toBe(3000)                              // 1000 × (2 + 0.5) × 1.2
  })
  test('暴击率钳到 100%', () => {
    expect(r.critRate).toBe(1)
    expect(r.expected).toBe(3000)
  })
})

describe('T03-5 面板合成', () => {
  test('floor(基础 × (1 + 百分比)) + 固定值', () => {
    const ctx: HitContext = { rate: 1, attr: 'atk', extraFlat: 0, level: 90, enemy: { def: 0, res: 0 }, panel: panel({ atk: { base: 1000, pct: 0.333, flat: 50 } }) }
    // 1000 × (1 + 0.333 + 0.1) = 1433 → +50 +20 = 1503
    expect(computeHit(ctx, acc({ atkPct: 0.1, atkFlat: 20 }), R).factors.base).toBe(1503)
  })
  test('共鸣效率类（RelatedProperty 11）：布兰特 直到世界尽头-治疗量（J204）', () => {
    const heal = computeHeal({ rate: 0.0332, attr: 'energyRegen', cureBase: 950, panel: panel({ energyRegen: 1.2 }) }, emptyAccumulator())
    expect(heal).toBe(1349)
  })
})

describe('T03-6 异常效应：光噪效应 1 层（伤害计算 E1040）', () => {
  test('3674 × 0.3 × 防御 × 抗性 → 431', () => {
    expect(computeAbnormal({ base: 3674, multiplier: 0.3, level: 90, enemy }, emptyAccumulator(), R)).toBe(431)
  })
})

describe('T03-7 谐度破坏：对 COST4 通用（伤害计算 E1098 / F1098）', () => {
  const t: TuneBreakTable = {
    variants: [], baseByLevel: Array.from({ length: 100 }, (_, i) => (i === 89 ? 3865000 : 0)),
    costFactor: { 1: 0.00018530030524049998, 3: 0.0005559214354978414, 4: 0.0025943077491359817 }, rules: null,
  }
  test('基础值 ROUND(3865000 × 系数, 2)', () => {
    expect(tuneBase(t, 90, 4)).toBe(10027)
    expect(tuneBase(t, 90, 1)).toBe(716.19)
  })
  const ctx = { base: tuneBase(t, 90, 4), rate: 16, level: 90, enemy, harmonyBreakBoost: 0 }
  test('对失谐 62668、对常态 7', () => {
    expect(computeTuneBreak(ctx, emptyAccumulator(), R)).toBe(62668)
    expect(computeTuneBreak({ ...ctx, vsNormal: true }, emptyAccumulator(), R)).toBe(7)
  })
})

// 真实数据：tune-break.json 的各武器变体照 xlsx 谐度破坏表复算（伤害计算 R1099–R1106，对 COST4、90 级、防御 1593、物理抗性 20%）
const tuneFile = new URL('../data/generated/tune-break.json', import.meta.url)
describe.skipIf(!existsSync(tuneFile))('T03-7b 谐度破坏表（tune-break.json）', () => {
  test('各变体的对失谐 / 对常态伤害与 xlsx 一致；迅刀第一段结算 4 次、总倍率都是 16', async () => {
    const { GenTuneBreakSchema } = await import('../src/data/generated.schema')
    const g = GenTuneBreakSchema.parse(JSON.parse(readFileSync(tuneFile, 'utf8')))
    const t: TuneBreakTable = {
      variants: [], baseByLevel: g.baseByLevel,
      costFactor: { 1: g.costFactors.find(f => f.cost === 1)!.factor, 3: g.costFactors.find(f => f.cost === 3)!.factor, 4: g.costFactors.find(f => f.cost === 4)!.factor },
      rules: null,
    }
    expect(tuneBase(t, 90, 4)).toBe(10027)
    for (const v of g.variants) {
      const ctx = { base: tuneBase(t, 90, 4), rate: v.multiplier, level: 90, enemy, harmonyBreakBoost: 0 }
      expect([v.key, computeTuneBreak(ctx, emptyAccumulator(), R), computeTuneBreak({ ...ctx, vsNormal: true }, emptyAccumulator(), R)])
        .toEqual([v.key, v.golden!.vsDisharmony, v.golden!.vsNormal])
    }
    const total = new Map<string, number>()
    for (const v of g.variants) total.set(v.weaponType!, (total.get(v.weaponType!) ?? 0) + v.multiplier * (v.ticks ?? 1))
    expect([...total.values()].map(x => Math.round(x * 1e4) / 1e4)).toEqual([16, 16, 16, 16, 16])
  })
})

describe('T03-8 收集 buff', () => {
  const mk = (b: BuffDefInput, stacks = 1, owner: ActiveBuff['owner'] = 0): ActiveBuff =>
    ({ def: BuffDefSchema.parse(b), value: b.value as number, stacks, owner })
  const common = { source: 't', target: 'self' as const, duration: 60, trigger: { on: 'intro' as const } }
  const buffs = [
    mk({ ...common, id: 'a', zone: 'DamageChangeType', value: 0.2, filter: { tags: ['普攻'] } }),
    mk({ ...common, id: 'b', zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['冷凝'] }, maxStacks: 3 }, 3),
    mk({ ...common, id: 'c', zone: 'DamageAmplify3', value: 0.25, filter: { critOnly: true } }),
    mk({ ...common, id: 'd', zone: 'RoleIgnoreDefRate', value: 0.15 }),
    mk({ ...common, id: 'e', zone: 'TargetDefRate', value: -0.1 }, 1, 'env'),
    mk({ ...common, id: 'f', zone: 'DamageAmplify0', value: 0.3, filter: { effects: ['光噪效应'] } }),
    mk({ ...common, id: 'g', zone: 'TargetDefRate', value: -0.02, target: 'enemy', maxStacks: 12 }, 5),   // 挂在目标上的减防（虚湮一类）
    mk({ ...common, id: 'h', zone: 'TargetDefRate', value: -0.18 }),                                    // 出伤者自己的"防御无视10"
  ]
  const hit: HitView = { element: '冷凝', tags: ['普攻'], action: 'A1', judgment: 'A1', enemyEffects: new Set() }
  test('过滤、层数、暴击专属', () => {
    const a = accumulate(hit, buffs)
    expect(a.zones.DamageChangeType).toBe(0.2)
    expect(a.zones.DamageChangeElement).toBeCloseTo(0.3, 12)
    expect(a.zones.DamageAmplify3).toBe(0)
    expect(a.critOnly.DamageAmplify3).toBe(0.25)
    expect(a.zones.DamageAmplify0).toBe(0)                 // 不是光噪效应自身的伤害
  })
  test('直接伤害吃全部减防', () => expect(accumulate(hit, buffs).zones.TargetDefRate).toBeCloseTo(-0.38, 12))
  test('异常效应伤害：出伤者身上的减防 / 无视防御不生效，目标身上的与场景的生效', () => {
    const a = accumulate({ element: '衍射', tags: ['异常效应'], action: '光噪效应', judgment: '光噪效应', effect: '光噪效应', enemyEffects: new Set(['光噪效应']) }, buffs)
    expect(a.zones.RoleIgnoreDefRate).toBe(0)
    expect(a.zones.TargetDefRate).toBeCloseTo(-0.2, 12)   // 场景 -0.1 + 目标 5 × -0.02
    expect(a.zones.DamageAmplify0).toBe(0.3)
  })
  test('钩子补的乘区值并入', () => {
    const a = accumulate(hit, [], { zones: { SpecialDamageChange: 0.1 }, critOnly: { critDamage: 0.2 } })
    expect(a.zones.SpecialDamageChange).toBe(0.1)
    expect(a.critOnly.critDamage).toBe(0.2)
  })
})

// ---------------------------------------------------------------------------
// T03-9 标准答案全量对拍：golden-zones.json（TD-03 §10 的抽取结果）逐条喂给公式
type GoldenZ = GoldenZone['z']

function zonesOf(z: GoldenZ): ZoneAccumulator {
  const a = emptyAccumulator(); const Z = a.zones
  Z.DamageChange = z.bonus ?? 0
  Z.TargetDefRate = z.def?.defRate ?? 0; Z.RoleIgnoreDefRate = z.def?.ignore ?? 0
  Z.TargetDamageReduce = z.dr ?? 0; Z.TargetElementDamageReduce = z.dre ?? 0
  Z.SpecialDamageChange = z.special ?? 0
  Z.DamageAmplify0 = z.amp0 ?? 0; Z.DamageAmplify1002 = z.amp1002 ?? 0
  z.amp?.forEach((v, i) => { Z[AMPLIFY_ZONES[i + 1]!] = v })
  z.fin?.forEach((v, i) => { Z[FINAL_ZONES[i]!] = v })
  Z.FinalDamage1001 = z.fin1001 ?? 0
  Z.healBonus = z.heal ?? 0
  return a
}

function evaluate(g: GoldenZone): number {
  const z = g.z; const a = zonesOf(z)
  const level = z.def?.level ?? 90
  const en = { def: z.def?.targetDef ?? 0, res: z.res ?? 0 }
  switch (g.formula) {
    case 'hurt': {
      const r = computeHit({ rate: 0, attr: 'atk', extraFlat: z.base, level, enemy: en, panel: panel({ critDamage: z.crit ?? 1 }) }, a, R)
      return g.branch === 'nc' ? r.nonCrit : r.crit
    }
    case 'abnormal': return computeAbnormal({ base: z.base, multiplier: 1, level, enemy: en }, a, R)
    case 'tune': return computeTuneBreak({ base: z.base, rate: 1, level, enemy: en, harmonyBreakBoost: (z.breakBoost ?? 0) * 100, ...(z.vsNormal ? { vsNormal: true } : {}) }, a, R)
    case 'heal': return computeHeal({ rate: 0, attr: 'atk', cureBase: z.base, panel: panel() }, a)
  }
}

/** golden 乘区夹具由构建脚本从 xlsx 抽出（data/generated/fixtures），公开仓库不带；没有时本组跳过 */
const GOLDEN = new URL('../data/generated/fixtures/golden-zones.json', import.meta.url)
;(existsSync(GOLDEN) ? describe : describe.skip)('T03-9 标准答案全量对拍', () => {
  if (!existsSync(GOLDEN)) return
  const all = GoldenZonesSchema.parse(JSON.parse(readFileSync(GOLDEN, 'utf8')))
  test('没有未归类因子', () => expect(all.filter(g => g.z.other !== undefined).map(g => g.cell)).toEqual([]))
  test(`${all.length} 条全部逐位一致`, () => {
    const bad = all.filter(g => evaluate(g) !== g.expected)
    expect(bad.map(g => `${g.cell} ${g.name} ${evaluate(g)} ≠ ${g.expected}`)).toEqual([])
  })
  test('按公式分类计数', () => {
    const n = (f: GoldenZone['formula']) => all.filter(g => g.formula === f).length
    // TD-03 §1.2 记为 2940 / 47：鉴心"护盾回复生命值"（J558）按公式形状是治疗，这里算进治疗
    expect([n('hurt'), n('abnormal'), n('tune'), n('heal')]).toEqual([2939, 173, 30, 48])
  })
})
