// tests/goal.test.ts —— 比较的目标（TD-10 §7）：稳态之外，打死几倍血要多少战斗秒、前 N 秒的伤害；命令行覆盖。
// 依赖 data/generated 的部分缺数据时跳过
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { withOverrides } from '../src/cli/format'
import type { EnemyPreset, GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { basisOf } from '../src/engine/analysis'
import { goalOf, resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { battleFrameOf, hitValue } from '../src/engine/summary'
import type { HitEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

describe('目标的写法', () => {
  const enemy = { hp: 1_000_000 } as EnemyPreset
  test('goal → Goal：kill 按敌人生命的倍数，window 换成战斗帧，缺省稳态', () => {
    expect(goalOf('steady', enemy)).toEqual({ kind: 'steady' })
    expect(goalOf({ kill: 2 }, enemy)).toEqual({ kind: 'kill', hp: 2_000_000, scale: 2 })
    expect(goalOf({ killHp: 2_600_000 }, enemy)).toEqual({ kind: 'kill', hp: 2_600_000, scale: null })
    expect(goalOf({ window: 30.5 }, enemy)).toEqual({ kind: 'window', frames: 1830 })
  })
  test('命令行 --goal、--repeat 覆盖场景；写错报错', () => {
    const sc = { goal: 'steady', options: { repeat: 4, maxFrames: 15000 } } as unknown as Scenario
    expect(withOverrides(sc, { goal: 'kill:1.5' }).goal).toEqual({ kill: 1.5 })
    expect(withOverrides(sc, { goal: 'window:60' }).goal).toEqual({ window: 60 })
    expect(withOverrides(sc, { goal: 'killHp:2600000' }).goal).toEqual({ killHp: 2600000 })
    expect(withOverrides(sc, { goal: 'steady' }).goal).toBe('steady')
    expect(withOverrides(sc, { repeat: '8' }).options).toMatchObject({ repeat: 8, maxFrames: 30000 })   // 帧数上限跟着放大
    expect(() => withOverrides(sc, { goal: 'kill' })).toThrow(/--goal/)
    expect(() => withOverrides(sc, { goal: 'steady:1' })).toThrow(/--goal/)
    expect(() => withOverrides(sc, { repeat: '0' })).toThrow(/--repeat/)
  })
})

let gd: GameData
const load = (f: string, goal?: Scenario['goal']) => {
  const sc = ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')))
  return resolveScenario(goal ? { ...sc, goal } : sc, gd)
}

dataDescribe('按目标比较（心队，全息 6 无常凶鹭约 132 万血）', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('打死 1 倍血：累计伤害到敌人生命的那一下，第 32.9 战斗秒（启动轴还没打完）', () => {
    const res = simulate(load('xin-team-r5.yaml'))
    const { kill } = res.summary
    expect(kill.hp).toBe(1_321_958)
    expect((kill.frame! / 60).toFixed(1)).toBe('32.9')
    const hits = res.log.filter((e): e is HitEvent => e.type === 'hit' && e.dmg !== null)
    const before = hits.filter(h => battleFrameOf(h) < kill.frame!).reduce((x, h) => x + hitValue(h), 0)
    expect(before).toBeLessThan(kill.hp)
    expect(res.summary.goal).toBeUndefined()                  // 缺省稳态
  })

  test('打死 2 倍血：比较口径 = 血量 ÷ 击杀秒；原轴比稳态最好的 C8 快（名次反过来）', () => {
    const base = simulate(load('xin-team-r5.yaml', { kill: 2 })), c8 = simulate(load('xin-team-r5-按套路重排-心补EQ-卜灵Q先放.yaml', { kill: 2 }))
    const b = basisOf(base), c = basisOf(c8)
    expect(b.label).toBe('打死 264.4 万血（敌人生命 ×2）')
    expect(b.dps).toBeCloseTo(2 * 1_321_958 / (b.hi / 60), 6)
    expect(base.summary.goal!.reached).toBe(true)
    expect(b.hi).toBeLessThan(c.hi)                           // 原轴 59.0 秒，C8 62.2 秒
    expect(b.dps).toBeGreaterThan(c.dps)
    // 稳态则相反
    expect(basisOf(simulate(load('xin-team-r5.yaml'))).dps).toBeLessThan(basisOf(simulate(load('xin-team-r5-按套路重排-心补EQ-卜灵Q先放.yaml'))).dps)
  })

  test('前 30 秒：窗口内命中之和；两条轴启动轴相同，一样', () => {
    const a = simulate(load('xin-team-r5.yaml', { window: 30 }))
    const hits = a.log.filter((e): e is HitEvent => e.type === 'hit' && e.dmg !== null && battleFrameOf(e) < 1800)
    expect(a.summary.goal!.damage).toBeCloseTo(hits.reduce((x, h) => x + hitValue(h), 0), 6)
    expect(basisOf(a).dps).toBeCloseTo(a.summary.goal!.damage / 30, 6)
    expect(basisOf(simulate(load('xin-team-r5-按套路重排-心补EQ-卜灵Q先放.yaml', { window: 30 }))).dps).toBeCloseTo(basisOf(a).dps, 6)
  })

  test('没打死：按稳态往后估、提示多跑几轮', () => {
    const res = simulate(load('xin-team-r5.yaml', { kill: 50 }))
    const g = res.summary.goal!
    expect(g.reached).toBe(false)
    expect(g.hi).toBeGreaterThan(res.log.at(-1)!.t * 60)
    expect(res.summary.warnings.some(w => w.code === 'goalNotReached')).toBe(true)
  })
})
