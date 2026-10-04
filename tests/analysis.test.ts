// tests/analysis.test.ts —— 配装对比与副词条边际（总设计 §3.5"对比"、M5；TD-10 §3、§4）
import { beforeAll, describe, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { basisOf, compareRuns, marginal, runScenario, tierValue } from '../src/engine/analysis'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { M0 } from './helpers/m0'
import { idle, synthData, type SynthChar } from './helpers/synth'

describe('对比（人造数据）', () => {
  const X = action({ id: 'X', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10 })] })
  const sc = (extra: SynthChar['buffs'] = [], repeat = 1) => ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
    enemy: { custom: { level: 90 } }, rotation: ['甲 X'], options: { repeat },
  })
  const data = (buffs: SynthChar['buffs'] = []) => synthData([{ name: '甲', actions: [X], buffs }, idle('乙'), idle('丙')])
  const atk = [{ id: '甲.攻击', source: 't', zone: 'atkPct', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' } as const]

  test('口径：没循环比整个窗口，循环了比稳态；差额拆到角色、动作、buff 覆盖率，加起来等于 DPS 差', () => {
    const a = runScenario(sc(), data())
    const b = runScenario(sc(), data(atk))
    const c = compareRuns(a, b)
    expect([c.base.label, c.base.lo, c.base.hi]).toEqual(['整个窗口', 0, 30])
    expect(c.delta).toBeGreaterThan(0)
    expect(c.byChar.reduce((x, d) => x + d.delta, 0)).toBeCloseTo(c.delta, 6)
    expect(c.byAction.map(d => d.key)).toEqual(['甲 X'])
    expect(c.uptime).toEqual([{ key: '甲.攻击→甲', base: 0, other: 1, delta: 1 }])
    expect(c.panels.other[0]!.atk).toBe(c.panels.base[0]!.atk)                    // 常驻 buff 在命中时才叠，不进静态面板
    expect(basisOf(runScenario(sc([], 3), data()).res).label).toBe('稳态（第 2 轮）')
  })

  test('一档的数值：各档平均（比例到 0.0001、固定值取整）/ 最高 / 最低', () => {
    expect(tierValue([0.063, 0.069, 0.075, 0.081, 0.087, 0.093, 0.099, 0.105], 'avg')).toBe(0.084)
    expect(tierValue([320, 360, 390, 430, 470, 510, 540, 580], 'avg')).toBe(450)
    expect([tierValue([30, 40, 50], 'max'), tierValue([30, 40, 50], 'min')]).toEqual([50, 30])
  })
})

let gd: GameData
dataDescribe('副词条边际（M0 椿）', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('暴击、普攻加成有收益；椿的 E 打的是普攻伤害，共鸣技能伤害加成没有收益；生命没有收益；不等能量时共鸣效率没有收益', () => {
    const team: ScenarioInput['team'] = structuredClone(M0)
    team[0] = { ...team[0]!, echoes: [{ name: '异相·无妄者', set: '沉日劫明', main: {}, subs: {} }] }
    const sc = ScenarioSchema.parse({ team, enemy: { preset: '全息6/朔雷之鳞' }, initial: { onField: 0 }, rotation: ['椿 A1 A2 A3 A4 A5 E1 盛绽·A1'] })
    const m = marginal(sc, gd, 0)
    const by = Object.fromEntries(m.rows.map(r => [r.stat, r]))
    expect(m.rows).toHaveLength(13)
    expect(by['暴击率']!.delta).toBeGreaterThan(0)
    expect(by['普攻伤害加成']!.delta).toBeGreaterThan(0)
    expect(by['暴击率']!.value).toBe(0.084)
    for (const k of ['共鸣技能伤害加成', '生命', '生命%', '共鸣效率']) expect(by[k]!.delta).toBe(0)
    expect(m.rows[0]!.delta).toBeGreaterThanOrEqual(m.rows.at(-1)!.delta)        // 从大到小
  })

  test('同一个场景自己比自己：差都是 0', () => {
    const sc = ScenarioSchema.parse({ team: M0, enemy: { preset: '全息6/朔雷之鳞' }, initial: { onField: 0 }, rotation: ['椿 A1 A2'] })
    const c = compareRuns(runScenario(sc, gd), runScenario(sc, gd))
    expect([c.delta, c.byAction.every(d => d.delta === 0), c.uptime.every(d => d.delta === 0)]).toEqual([0, true, true])
  })
})
