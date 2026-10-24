// tests/review-fixes.test.ts —— 2026-10-22 审查与验收报告的 R1–R7（docs/review-2026-10-22.md、docs/engine-acceptance-2026-10-22.md）的回归用例。
// 依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { marginal } from '../src/engine/analysis'
import { planRotation, renderRoutines } from '../src/engine/plan'
import { resolveScenario, setPieces } from '../src/engine/resolve'
import { dataDescribe } from './helpers/kernel-harness'
import { m0Run } from './helpers/m0'

const load = (f: string): Scenario => ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')))

describe('R1 套装件数按不同种类计', () => {
  test('同种两件只算一件；异相与本体是同一种；五种不同的照算五件', () => {
    const e = (name: string, set = '沉日劫明') => ({ name, set })
    expect(setPieces([e('梦魇·无冠者'), e('暗鬃狼'), e('暗鬃狼'), e('刺玫菇'), e('遁地鼠')]).get('沉日劫明')).toBe(4)
    expect(setPieces([e('梦魇·无冠者'), e('异相·梦魇·无冠者')]).get('沉日劫明')).toBe(1)
    expect(setPieces([e('梦魇·无冠者'), e('暗鬃狼'), e('刺玫菇'), e('刺玫菇（稚形）'), e('遁地鼠')]).get('沉日劫明')).toBe(5)
    expect(setPieces([e('暗鬃狼'), e('暗鬃狼', '轻云出月')])).toEqual(new Map([['沉日劫明', 1], ['轻云出月', 1]]))
  })
})

describe('R7 没有启动轴的轴：第一个套路就是开场在前台的角色', () => {
  test('开头不切，末尾切回第一个套路的角色；补位结尾时末尾写"变奏"；只跑前缀时不补', () => {
    expect(renderRoutines(['甲 E', '乙 Q'], '甲')).toEqual(['甲 E', 'switch 乙', '乙 Q', 'switch 甲'])
    expect(renderRoutines(['甲 E', '乙 Q~'], '甲')).toEqual(['甲 E', 'switch 乙', '乙 Q~', 'switch 甲 变奏'])
    expect(renderRoutines(['甲 E', '乙 Q'], '甲', false)).toEqual(['甲 E', 'switch 乙', '乙 Q'])
    expect(renderRoutines(['甲 E', '乙 Q'], '乙')).toEqual(['switch 甲', '甲 E', 'switch 乙', '乙 Q'])   // 第一个不是前台的：照旧
  })
})

dataDescribe('R1–R7（依赖数据）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })

  test('R1：装配不登记同种凑出来的五件套；五种不同的照常登记', () => {
    const sc = load('m0-team.yaml')
    const withEchoes = (names: string[]) => {
      const s = structuredClone(sc)
      const src = s.team[0]!.echoes
      s.team[0]!.echoes = names.map((name, i) => ({ ...src[i]!, name }))
      return resolveScenario(s, gd).buffs.filter(b => b.owner === 0).map(b => b.def.id)
    }
    const dup = withEchoes(['梦魇·无冠者', '暗鬃狼', '暗鬃狼', '刺玫菇（稚形）', '遁地鼠'])
    expect(dup).toContain('沉日劫明.2')
    expect(dup).not.toContain('沉日劫明.5')
    expect(withEchoes(['梦魇·无冠者', '暗鬃狼', '刺玫菇', '刺玫菇（稚形）', '遁地鼠'])).toContain('沉日劫明.5')
  })

  test('R2：维里奈强化空中攻击要光合能量，每段消耗 1 层', () => {
    const run = (n: number) => m0Run(gd, {
      initial: { onField: 2, core: { 维里奈: { 光合能量: n } } },
      rotation: ['维里奈 跳跃 强化空中A1? 强化空中A2? 强化空中A3?'], options: { tuneBreak: 'off' },
    })
    const hits = (n: number) => run(n).log.flatMap(e => (e.type === 'hit' && /^强化空中A\d$/.test(e.judgment) ? [e.judgment] : []))
    expect(hits(0)).toEqual([])
    expect(hits(1)).toEqual(['强化空中A1'])
    expect(hits(3)).toEqual(['强化空中A1', '强化空中A2', '强化空中A3'])
    // 被拒绝的强化攻击也不给固有1 的攻击提升
    expect(run(0).log.some(e => e.type === 'buffApply' && e.buff === '维里奈.固有1')).toBe(false)
  })

  test('R3：散华重击居合在重击爆裂之前被取消，冰不引爆；正常打完的照常引爆', () => {
    const run = (rotation: string[]) => m0Run(gd, { initial: { onField: 1 }, rotation, options: { tuneBreak: 'off' } })
    const booms = (rotation: string[]) => run(rotation).log.flatMap(e => (e.type === 'judgmentSpawn' && e.note === '重击爆裂引爆' ? [e.judgment] : []))
    expect(booms(['散华 E 重击居合 R!', 'wait 160'])).toEqual([])
    expect(booms(['散华 E R 重击居合', 'wait 60']).length).toBeGreaterThan(0)
  })

  test('R4：武器被动没写成机制时提示只算主副属性；写了的不提示', () => {
    const sc = load('m0-video-eq.yaml')
    const s = structuredClone(sc)
    s.team[0]!.weapon = { name: '裁春', rank: 1 }
    expect(resolveScenario(s, gd).warnings.some(w => w.includes('裁春') && w.includes('只算主副属性'))).toBe(true)
    expect(resolveScenario(sc, gd).warnings.some(w => w.includes('只算主副属性'))).toBe(false)
  })

  test('R5：只覆盖了冷却的首位声骸仍提示效果不计入；冷却照样按覆盖的算', () => {
    const s = structuredClone(load('m0-team.yaml'))
    s.team[0]!.echoes[0] = { ...s.team[0]!.echoes[0]!, name: '梦魇·无常凶鹭' }
    const r = resolveScenario(s, gd)
    expect(r.warnings.some(w => w.includes('梦魇·无常凶鹭') && w.includes('首位加成与技能附带的效果不计入'))).toBe(true)
    expect(gd.echoes['梦魇·无常凶鹭']!.actions[gd.echoes['梦魇·无常凶鹭']!.q]!.cooldown).toBe(1500)
    expect(gd.echoes['无常凶鹭']!.curated).toBe(true)                  // 写了首位加成的照旧
  })

  test('R6：基准跑不通时边际分析报错，不给全零的表', () => {
    const s = structuredClone(load('m0-team.yaml'))
    s.options.maxFrames = 100
    expect(() => marginal(s, gd, 0)).toThrow(/原场景跑不通（maxFrames）/)
  })

  test('R7：没有启动轴的 m0-team 能按套路排出候选，原轴也在里面', () => {
    const x = planRotation(load('m0-team.yaml'), gd, { width: 3 })
    expect(x.leaves.length).toBeGreaterThan(1)
    expect(x.leaves.some(l => l.isRef)).toBe(true)
    expect(x.refRank).not.toBeNull()
  }, 120_000)
})
