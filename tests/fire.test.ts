// tests/fire.test.ts —— 三火（嘉贝莉娜 · 达妮娅 · 露帕，2026-10-26，docs/tower-20261026.md）的角色模块。先写了达妮娅：
// 两种形态、熵变强化与蚀刻繁彩、虚质粒子下黑A按强化版算、放逐按黯核加倍率、聚爆模态挂层、蚀域。依赖 data/generated（缺数据时跳过）
import { beforeAll, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>
const of = <T extends SimEvent['type']>(log: SimEvent[], t: T) => log.filter((e): e is Ev<T> => e.type === t)

dataDescribe('达妮娅', () => {
  let gd: GameData
  const team: ScenarioInput['team'] = [
    {
      char: '达妮娅', chain: 0, weapon: { name: '赝作的矮星', rank: 1 },
      echoes: [
        { name: '达妮娅', set: '斑驳粉饰之沫', main: { 暴击伤害: 0.44, 攻击: 150 } },
        { name: '异相·冠顶苍隼', set: '斑驳粉饰之沫', main: { 热熔伤害加成: 0.3, 攻击: 100 } },
        { name: '双极·星升辉铳', set: '斑驳粉饰之沫', main: { 热熔伤害加成: 0.3, 攻击: 100 } },
        { name: '影烁者', set: '斑驳粉饰之沫', main: { '攻击%': 0.18, 生命: 2280 } },
        { name: '噼啪啪', set: '斑驳粉饰之沫', main: { '攻击%': 0.18, 生命: 2280 } },
      ],
    },
    { char: '散华', chain: 6, weapon: { name: '千古洑流', rank: 1 } },
    { char: '椿', chain: 0, weapon: { name: '千古洑流', rank: 1 } },
  ]
  const run = (rotation: string[]) => {
    const out = simulate(resolveScenario(ScenarioSchema.parse({
      data: '20261019', team, enemy: { preset: '41塔中1/辉萤军势' }, initial: { onField: 0 }, rotation, options: { repeat: 1, maxFrames: 6000 },
    }), gd))
    expect(out.error).toBeUndefined()
    return out.log
  }
  beforeAll(async () => { gd = await loadGameData() })

  const ROT = [
    '达妮娅 白A1 白A2 白A3 白A4 白E 白大招',
    '达妮娅 黑A1 黑A2 黑A3 黑A4 放逐 放逐2 黑A1~ 黑A2~ 黑A3~ 黑A4~ 黑A1~ 黑A2~ 黑A3~ 黑A4~ 黑A1~ 黑A2~ 黑A3~ 黑A4~ 黑R',
    'wait 600',
  ]

  test('白大招切到幻灭之形：熵变·幻灭（攻击 +30%）与蚀刻繁彩（全队热熔 +30%）；黑大招切回布景，换成熵变·布景', () => {
    const log = run(ROT)
    const apply = of(log, 'buffApply')
    const ult = of(log, 'actionStart').find(e => e.action === '白大招')!.f
    expect(apply.filter(e => e.buff === '达妮娅.蚀刻繁彩·幻灭' && e.f === ult).map(e => e.target).sort()).toEqual(['椿', '散华', '达妮娅'].sort())
    const black = of(log, 'actionStart').find(e => e.action === '黑大招')!.f
    expect(apply.some(e => e.buff === '达妮娅.熵变·布景' && e.f === black)).toBe(true)
    expect(of(log, 'buffExpire').some(e => e.buff === '达妮娅.熵变·幻灭' && e.f === black)).toBe(true)
  })

  test('有虚质粒子时黑A按强化版：倍率 ×1.5、共鸣解放伤害、扣虚质粒子；用完后回到普攻', () => {
    const log = run(ROT)
    const a1 = of(log, 'hit').filter(e => e.judgment === '黑A1')
    expect(a1[0]!.tags).toEqual(['共鸣解放'])
    expect(a1.at(-1)!.tags).toEqual(['普攻'])
    expect(a1[0]!.factors!.base / a1.at(-1)!.factors!.base).toBeCloseTo(1.5, 2)
    expect(of(log, 'resource').some(e => e.char === '达妮娅' && e.resource === 'core1' && e.delta === -18)).toBe(true)
  })

  test('放逐第二段消耗全部黯核（进入战斗补到 2 枚），倍率每枚 +150%', () => {
    const log = run(ROT)
    const e2 = of(log, 'hit').find(e => e.judgment === '黑强化E2')!
    const e1 = of(log, 'hit').find(e => e.judgment === '黑强化E1')!
    // 同一时段攻击相同：第二段的基础伤害 / (112.01% + 2 × 150%) = 第一段的基础伤害 / 34.68%
    expect(e2.factors!.base / (1.1201 + 3)).toBeCloseTo(e1.factors!.base / 0.3468, 0)
    expect(of(log, 'resource').filter(e => e.resource === 'core3' && e.delta < 0).map(e => e.delta)).toEqual([-2])
  })

  test('聚爆模态：白A3 / 白A4 各 1 层、白大招 2 层；加到 10 层当场引爆一次', () => {
    const log = run(ROT)
    const applied = of(log, 'enemyState').filter(e => e.change === 'effectApplied' && e.effect === '聚爆效应')
    expect(applied.slice(0, 3).map(e => e.added)).toEqual([1, 1, 2])
    const ticks = of(log, 'effectTick').filter(e => e.effect === '聚爆效应')
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) expect([t.stacks, t.left]).toEqual([10, 0])
  })

  test('黑大招生成蚀域：第 157 帧第一次出伤害，之后每 240 帧一次，30 秒', () => {
    const log = run(ROT)
    const black = of(log, 'actionStart').find(e => e.action === '黑大招')!
    const fs = of(log, 'hit').filter(e => e.judgment === '蚀域-伤害').map(e => e.f)
    expect(fs.length).toBeGreaterThan(3)
    for (let k = 1; k < fs.length; k++) expect(fs[k]! - fs[k - 1]!).toBe(240)
    expect(fs[0]! - black.f).toBeGreaterThanOrEqual(157)
  })
})
