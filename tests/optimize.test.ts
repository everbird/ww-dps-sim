// tests/optimize.test.ts —— 声骸库存择优（TD-13）：快速重算与完整仿真一致；搜索结果与穷举一致；库存的补全与报错。
// 前三组用人造角色（不依赖生成数据）；库存补全用真实的 echo-stats.json（缺数据时跳过）。
import { beforeAll, describe, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { InventorySchema, resolveInventory, type InvPiece } from '../src/data/inventory.schema'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { BuffDefSchema } from '../src/data/buff.schema'
import { basisOf } from '../src/engine/analysis'
import { buildReplayer, optimize, runRecorded, totalsOf, withEchoes } from '../src/engine/optimize'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

// 甲：X 30 帧，一段普攻（倍率 1）一段共鸣技能（倍率 2，湮灭）；首位声骸"角"（4C，没有技能动作）；
// 测试套 2 件攻击 +10%，5 件普攻伤害 +20%
const 甲: SynthChar = {
  name: '甲',
  actions: [action({
    id: 'X', endFrame: 30,
    judgments: [judgment({ name: 'a', spawnFrame: 5, tags: ['普攻'] }), judgment({ name: 'e', spawnFrame: 15, multiplier: 2, tags: ['共鸣技能'], element: '湮灭' })],
  })],
}
function data(): GameData {
  const d = synthData([甲, idle('乙'), idle('丙')])
  d.echoes['角'] = { key: '角', cost: 4, actions: {}, q: 'Q·角', description: null, mainSlotBuffs: [], resourceEffects: [], curated: true, flags: [] }
  const always = { target: 'self', duration: 'inf', trigger: 'always' } as const
  d.echoSets['测试套'] = {
    name: '测试套',
    pieces: {
      2: [BuffDefSchema.parse({ id: '测试套.2', source: '2 件', zone: 'atkPct', value: 0.1, ...always })],
      5: [BuffDefSchema.parse({ id: '测试套.5', source: '5 件', zone: 'DamageChangeType', value: 0.2, filter: { tags: ['普攻'] }, ...always })],
    },
  }
  return d
}
const P = (id: string, cost: 1 | 3 | 4, set: string, main: InvPiece['main'], subs: InvPiece['subs'], owner?: string): InvPiece =>
  ({ id, name: cost === 4 ? '角' : `小${cost}`, set, cost, main, subs, ...(owner ? { owner } : {}) })
const INV: InvPiece[] = [
  P('m1', 4, '测试套', { 暴击率: 0.22, 攻击: 150 }, { 暴击伤害: 0.1 }),
  P('m2', 4, '测试套', { 暴击伤害: 0.44, 攻击: 150 }, { 暴击率: 0.05 }),
  P('c1', 3, '测试套', { 湮灭伤害加成: 0.3, 攻击: 100 }, { 暴击率: 0.06 }),
  P('c2', 3, '测试套', { '攻击%': 0.3, 攻击: 100 }, { 普攻伤害加成: 0.1 }),
  P('c3', 3, '别的套', { 湮灭伤害加成: 0.3, 攻击: 100 }, { 暴击伤害: 0.2, 暴击率: 0.1 }),
  P('s1', 1, '测试套', { '攻击%': 0.18, 生命: 2280 }, { 共鸣技能伤害加成: 0.1 }),
  P('s2', 1, '测试套', { '攻击%': 0.18, 生命: 2280 }, { 暴击伤害: 0.12 }),
  P('s3', 1, '测试套', { '防御%': 0.18, 生命: 2280 }, {}),
  P('t1', 1, '测试套', { '攻击%': 0.18, 生命: 2280 }, { 暴击伤害: 0.3, 暴击率: 0.2 }, '乙'),   // 在队友身上：缺省不拿
]
const pick = (...ids: string[]) => ids.map(id => INV.find(p => p.id === id)!)
const scenario = (gear: InvPiece[]): Scenario => withEchoes(ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
  enemy: { custom: { level: 90 } }, rotation: ['甲 X X X X'], options: { repeat: 3 },
}), 0, gear)
const CURRENT = pick('m1', 'c1', 'c3', 's1', 's3')   // 测试套 4 件 + 别的套 1 件：要求测试套 ≥ 4 件

describe('TD-13 快速重算', () => {
  test('记录时的配装重算出来就是稳态 DPS；换一套（不改时间轴）与完整仿真一致', () => {
    const d = data()
    const run = runRecorded(scenario(CURRENT), d)
    const rep = buildReplayer(run.r, run.res, run.recs, 0)
    expect(rep.hits).toBeGreaterThan(0)
    expect(rep.dps(rep.totals0)).toBeCloseTo(basisOf(run.res).dps, 6)
    for (const gear of [pick('m2', 'c2', 'c1', 's2', 's1'), pick('m1', 'c3', 'c2', 's2', 's3')]) {
      const full = basisOf(runRecorded(scenario(gear), d).res).dps
      // 第一套是测试套 5 件，多了 5 件效果：套装改变 buff 时估计会偏（最终排名只看完整仿真）；第二套套装件数不变，应一致
      if (gear[4]!.id === 's3') expect(rep.dps(totalsOf(gear))).toBeCloseTo(full, 6)
      else expect(rep.dps(totalsOf(gear))).toBeLessThan(full)
    }
  })
})

describe('TD-13 搜索', () => {
  test('与穷举（每套完整仿真）的最好结果相同；队友身上的不拿', () => {
    const d = data()
    const sc = scenario(CURRENT)
    const out = optimize(sc, d, INV, { slot: 0, top: 3 })
    expect(out.plan).toEqual({ 测试套: 4 })
    expect(out.pool).toBe(INV.length - 1)
    // 穷举：首位是"角"，其余 4 件，cost ≤ 12，测试套 ≥ 4 件
    const pool = INV.filter(p => !p.owner)
    let best = -1
    for (const m of pool.filter(p => p.cost === 4)) {
      const rest = pool.filter(p => p.id !== m.id)
      for (let a = 0; a < rest.length; a++) for (let b = a + 1; b < rest.length; b++) for (let c = b + 1; c < rest.length; c++) for (let e = c + 1; e < rest.length; e++) {
        const g = [m, rest[a]!, rest[b]!, rest[c]!, rest[e]!]
        if (g.reduce((x, p) => x + p.cost, 0) > 12 || g.filter(p => p.set === '测试套').length < 4) continue
        best = Math.max(best, basisOf(runRecorded(scenario(g), d).res).dps)
      }
    }
    expect(out.builds[0]!.dps).toBeCloseTo(best, 6)
    expect(out.builds.every(b => b.pieces.every(p => p.id !== 't1'))).toBe(true)
    expect(out.builds[0]!.dps).toBeGreaterThanOrEqual(out.current.dps)
    // --include-team：t1 也能用
    const all = optimize(sc, d, INV, { slot: 0, top: 1, includeTeam: true })
    expect(all.builds[0]!.pieces.some(p => p.id === 't1')).toBe(true)
  })
  test('指定 5 件套；库存里没有首位声骸就报错', () => {
    const d = data()
    expect(optimize(scenario(CURRENT), d, INV, { slot: 0, top: 1, set: '测试套' }).builds[0]!.pieces.every(p => p.set === '测试套')).toBe(true)
    expect(() => optimize(scenario(CURRENT), d, INV.filter(p => p.cost !== 4), { slot: 0 })).toThrow(/没有可用的首位声骸"角"/)
  })
})

let gd: GameData
dataDescribe('TD-13 库存', () => {
  beforeAll(async () => { gd = await loadGameData() })
  test('主词条只写名字时补满级值与固定副主属性；cost 从声骸表、主词条或固定副主属性推出', () => {
    const inv = InventorySchema.parse({
      echoes: [
        { name: '梦魇·无冠者', set: '沉日劫明', main: '暴击率', subs: { 暴击伤害: 0.138 } },          // 声骸表 4C
        { name: '某个 3C', set: '沉日劫明', main: '湮灭伤害加成' },                                    // 只有 3C 有元素伤害
        { name: '某个 1C', set: '沉日劫明', main: { '攻击%': 0.18, 生命: 2280 } },                     // 固定副主属性 → 1C
        { id: 'x', name: '某个 3C', set: '沉日劫明', cost: 3, main: '攻击%' },
      ],
    })
    const { pieces, issues } = resolveInventory(inv, gd)
    expect(issues).toEqual([])
    expect(pieces.map(p => [p.id, p.cost, p.main])).toEqual([
      ['#1', 4, { 暴击率: 0.22, 攻击: 150 }], ['#2', 3, { 湮灭伤害加成: 0.3, 攻击: 100 }],
      ['#3', 1, { '攻击%': 0.18, 生命: 2280 }], ['x', 3, { '攻击%': 0.3, 攻击: 100 }],
    ])
  })
  test('推不出 cost、cost 与主词条对不上、id 重复都报错', () => {
    const { issues } = resolveInventory(InventorySchema.parse({
      echoes: [
        { name: '某个', set: '沉日劫明', main: '攻击%' },
        { id: 'a', name: '某个', set: '沉日劫明', cost: 1, main: '暴击率' },
        { id: 'a', name: '梦魇·无冠者', set: '沉日劫明', cost: 3, main: '暴击率' },
      ],
    }), gd)
    expect(issues).toEqual([
      '第 1 件（#1 某个）：不知道 cost（声骸表里没有这个声骸），写上 cost',
      '第 2 件（a 某个）：1C 声骸没有主词条"暴击率"',
      '第 3 件（a 梦魇·无冠者）：id 重复',
      '第 3 件（a 梦魇·无冠者）：cost 写的 3，声骸表是 4',
      '第 3 件（a 梦魇·无冠者）：3C 声骸没有主词条"暴击率"',
    ])
  })
})
