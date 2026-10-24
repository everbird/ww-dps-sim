// tests/nanoka.test.ts —— 手填冷却、技能树属性、段数、协奏、大招能量与 nanoka 的核对（src/data/nanoka-check.ts；m0-confirm §5、docs/engine-quality-plan.md P5）
// 人造数据的用例总能跑；M0 队伍的用例依赖 data/generated/nanoka.json（pnpm build:data 联网取到后才有），没有时跳过。
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { NanokaFileSchema, type NanokaCharacter } from '../src/data/generated.schema'
import { checkConcerto, checkCooldowns, checkEnergyCost, checkHits, checkTreeStats, parseParts, treeStatKey } from '../src/data/nanoka-check'
import { loadGameData } from '../src/data/load'
import 椿 from '../data/curated/characters/椿'
import 散华 from '../data/curated/characters/散华'
import 维里奈 from '../data/curated/characters/维里奈'
import { action, character, hasData, judgment } from './helpers/kernel-harness'

const skill = (type: string, name: string, cds: [string, number][], values: [string, string][] = []): NanokaCharacter['skills'][number] =>
  ({ type, name, desc: '', cooldowns: cds.map(([n, s]) => ({ name: n, seconds: s, frames: s * 60 })), values: values.map(([n, text]) => ({ name: n, text })) })
const nk: NanokaCharacter = {
  id: 1, name: '甲', chains: [], treeStats: { 攻击提升: 0.12, 冷凝伤害加成提升: 0.12 },
  skills: [skill('共鸣技能', '技', [['冷却时间', 4]]), skill('共鸣解放', '解', [['冷却时间', 25]]), skill('共鸣回路', '回', [['一日花冷却时间', 25]])],
}
const aliases = { E: 'E1', R: '大招' }

describe('nanoka 冷却核对', () => {
  test('都对得上：不报', () => {
    const acts = { E1: action({ id: 'E1', cooldown: 240 }), 大招: action({ id: '大招', cooldown: 1500 }), E3: action({ id: 'E3', cooldown: 1500 }) }
    expect(checkCooldowns(acts, aliases, nk)).toEqual([])
  })
  test('别名指向的动作缺冷却、数不同；别的动作的冷却 nanoka 里没有；声骸不管', () => {
    const acts = {
      E1: action({ id: 'E1', cooldown: 300 }), 大招: action({ id: '大招' }),
      X: action({ id: 'X', cooldown: 60 }), 声骸: action({ id: '声骸', kind: 'echo', cooldown: 999 }),
    }
    expect(checkCooldowns(acts, aliases, nk)).toEqual([
      'E1（E）冷却 5 秒（300 帧），nanoka 共鸣技能「技」是 4 秒（240 帧）',
      '大招（R）没有冷却；nanoka 共鸣解放「解」冷却时间 25 秒（1500 帧）',
      'E1 冷却 5 秒（300 帧），nanoka 里没有这个数（有：共鸣技能·冷却时间 4 秒、共鸣解放·冷却时间 25 秒、共鸣回路·一日花冷却时间 25 秒）',
      'X 冷却 1 秒（60 帧），nanoka 里没有这个数（有：共鸣技能·冷却时间 4 秒、共鸣解放·冷却时间 25 秒、共鸣回路·一日花冷却时间 25 秒）',
    ])
  })
})

describe('nanoka 技能树属性核对', () => {
  test('节点名 → 属性键', () => {
    expect(['攻击提升', '暴击提升', '暴击伤害提升', '冷凝伤害加成提升', '治疗效果加成提升', '生命提升', '不认识'].map(treeStatKey))
      .toEqual(['攻击%', '暴击率', '暴击伤害', '冷凝伤害加成', '治疗效果加成', '生命%', undefined])
  })
  test('对得上不报；数不同、少写、多写都报', () => {
    expect(checkTreeStats({ '攻击%': 0.12, '冷凝伤害加成': 0.12 }, nk)).toEqual([])
    expect(checkTreeStats({ '攻击%': 0.1, '暴击率': 0.08 }, nk)).toEqual([
      '技能树 攻击%：角色模块 0.1，nanoka 0.12', '技能树 冷凝伤害加成：角色模块 0，nanoka 0.12', '技能树 暴击率：角色模块 0.08，nanoka 0',
    ])
  })
})

describe('nanoka 段数、协奏、大招能量核对', () => {
  test('倍率原文：n 下、几段相加；治疗量等认不出的不管', () => {
    expect(parseParts('35.79%*3+71.58%')).toEqual(new Map([[0.3579, 3], [0.7158, 1]]))
    expect(parseParts('39.72%+39.72%+119.15%')).toEqual(new Map([[0.3972, 2], [1.1915, 1]]))
    expect(parseParts('950+23.80%')).toBeNull()
  })
  const nk2: NanokaCharacter = {
    id: 2, name: '乙', chains: [], treeStats: {},
    skills: [
      skill('共鸣技能', '技', [], [['技能伤害', '35.79%*3+71.58%'], ['回复协奏能量', '30']]),
      skill('共鸣解放', '解', [], [['技能伤害', '100.00%'], ['消耗共鸣能量', '175']]),
      skill('共鸣回路', '回', [], [['派生伤害', '47.07%*2+235.33%']]),
    ],
  }
  const e = (ticks: number, concerto = 30) => action({
    id: 'E', kind: 'skill', castGains: [{ atFrame: 0, resource: 'concerto', amount: concerto }],
    judgments: [judgment({ name: 'E-1', multiplier: 0.3579, ticks }), judgment({ name: 'E-2', multiplier: 0.7158 })],
  })
  const rest = {
    大招: action({ id: '大招', kind: 'liberation', judgments: [judgment({ name: '大招', multiplier: 1 })] }),
    // 一个伤害条目分在两个动作里（雷主地面短E 自动派生剑止万律2）：合起来对上就不报
    短E: action({ id: '短E', kind: 'skill', judgments: [judgment({ name: '1', multiplier: 0.4707, ticks: 2 })] }),
    派生: action({ id: '派生', kind: 'skill', judgments: [judgment({ name: '2', multiplier: 2.3533 })] }),
  }
  test('下数都对上不报；少了的报出最接近的动作与少几下（维里奈 E 第一段 xlsx 只有 1 下）', () => {
    expect(checkHits({ E: e(3), ...rest }, nk2)).toEqual([])
    expect(checkHits({ E: e(1), ...rest }, nk2)).toEqual(['nanoka 共鸣技能「技能伤害」35.79%*3+71.58%：最接近的是 E，2/4 下（35.79% 少 2 下）'])
  })
  test('多出来的倍率报出来；延奏、谐度破坏不比（nanoka 不列）', () => {
    const extra = { ...rest, E: e(3), X: action({ id: 'X', kind: 'normal', judgments: [judgment({ name: 'X-1', multiplier: 0.2784 })] }) }
    const outro = action({ id: '延奏', kind: 'outro', judgments: [judgment({ name: '延奏', multiplier: 3.2924 })] })
    expect(checkHits({ ...extra, 延奏: outro }, nk2)).toEqual(['X「X-1」倍率 27.84%：nanoka 的伤害条目里没有'])
  })
  test('协奏：起手即得或合计对上都算；都不对报两个数', () => {
    expect(checkConcerto({ E: e(3), ...rest }, { E: 'E' }, nk2)).toEqual([])
    expect(checkConcerto({ E: e(3, 15), ...rest }, { E: 'E' }, nk2)).toEqual(['nanoka 共鸣技能「回复协奏能量」30：E 起手 15、合计 15'])
  })
  test('大招能量', () => {
    expect(checkEnergyCost(175, nk2)).toEqual([])
    expect(checkEnergyCost(125, nk2)).toEqual(['大招能量 125，nanoka 共鸣解放「消耗共鸣能量」175'])
  })
})

const NANOKA = new URL('../data/generated/nanoka.json', import.meta.url)
const m0 = hasData && existsSync(NANOKA) ? describe : describe.skip
m0('M0 队伍的冷却、技能树属性与 nanoka 一致（椿 E1 / E2 4 秒、E3 25 秒、大招 25 秒；散华 E 10 秒、大招 16 秒；维里奈 E 12 秒、大招 25 秒）', () => {
  const file = () => NanokaFileSchema.parse(JSON.parse(readFileSync(NANOKA, 'utf8')))
  for (const [mod, chain] of [[椿, 0], [散华, 6], [维里奈, 3]] as const) {
    test(mod.name, () => {
      const nkc = file().characters[mod.name]!
      expect(checkCooldowns(character(mod, chain), mod.aliases ?? {}, nkc)).toEqual([])
      expect(checkTreeStats(mod.treeStats ?? {}, nkc)).toEqual([])
    })
  }
})

m0('两队六个角色的段数、大招能量与 nanoka 一致，协奏只剩没有伤害条目可对的三条（2026-10-24 修了维里奈 E、强化空中A3，雷主 A3，心照世 A1）', () => {
  test('六个角色', async () => {
    const gd = await loadGameData()
    const f = NanokaFileSchema.parse(JSON.parse(readFileSync(NANOKA, 'utf8')))
    const out = ['椿', '散华', '维里奈', '卜灵', '雷主·男', '心'].flatMap(n => {
      const c = gd.characters[n]!, k = f.characters[n]!
      return [...checkEnergyCost(c.energyCost, k), ...checkHits(c.actions, k), ...checkConcerto(c.actions, c.aliases, k)].map(l => `${n}：${l}`)
    })
    expect(out).toEqual([
      '维里奈：nanoka 共鸣回路「每层【光合能量】回复协奏能量」12：找不到对应的动作，没核对',
      '卜灵：nanoka 常态攻击「重击·艮为山回复协奏能量」15：找不到对应的动作，没核对',
      '卜灵：nanoka 常态攻击「重击·震为雷回复协奏能量」15：找不到对应的动作，没核对',
    ])
  })
})
