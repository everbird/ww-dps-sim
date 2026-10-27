// tests/xin-tower4.test.ts —— 心 · 雷主 · 卜灵 深塔 41 期中 4 的录像剖析（scenarios/xin-tower4-video.yaml，2026-10-27，docs/tower-20261026.md 中 4）：
// 和中 3 同一套配装、同样只照录像读；两只 boss 先后打（异构武装打死后无冠者出来，轴里写"敌人 换"）。
// 跳字对照的几处是校准线索（镇红尘仿真少约 7%、卜灵声骸的全队攻击在录像里没体现），这里按现在的值钉住，改了引擎要回来看。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { replayFit } from '../src/engine/fit'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { compareMarks, hpPoints, traceCommands } from '../src/engine/trace'
import type { ResolvedScenario, SimResult } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

const T0 = 2.75   // 世界秒 = 视频秒 − 2.75
dataDescribe('心雷卜深塔 41 期中 4 的录像', () => {
  let sc: Scenario
  let r: ResolvedScenario
  let out: SimResult
  beforeAll(async () => {
    const gd = await loadGameData()
    sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/xin-tower4-video.yaml', import.meta.url), 'utf8')))
    r = resolveScenario(sc, gd)
    out = simulate(r)
  })
  const vsec = (f: number) => f / 60 + T0

  test('整局跑得通；15 次切人类型都和录像一致，14 次差不到 0.3 秒（第 13 段卜灵的普攻串凑不出山雷颐，185.5 雷主切入晚 1.6 秒）', () => {
    expect(out.error).toBeUndefined()
    const cmp = compareMarks(traceCommands(out.log, r, 1), sc.video!.marks)
    expect(cmp.missing).toEqual([])
    expect(cmp.rows).toHaveLength(15)
    expect(cmp.rows.filter(x => Math.abs(x.diff) < 0.3)).toHaveLength(14)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(2)
    const sw = out.log.filter(e => e.type === 'switch')
    expect(sw.map(e => e.type === 'switch' && e.intro)).toEqual([false, true, true, true, false, true, true, true, false, true, true, true, false, true, true])
  })

  test('两只 boss：视频 100.5 换成无冠者（假设 enemy-swap），血条按两段比，均方根差不到 3%', () => {
    const swaps = out.log.filter(e => e.type === 'enemyState' && e.change === 'swap')
    expect(swaps).toHaveLength(1)
    expect(Math.abs(vsec(swaps[0]!.f) - 100.5)).toBeLessThan(0.05)
    expect(out.summary.assumptions.map(a => a.id)).toContain('enemy-swap')
    const pts = hpPoints(sc.video!, r)
    expect(new Set(pts.map(p => p.enemy))).toEqual(new Set(['41塔中4/异构武装', '41塔中4/无冠者']))
    const fit = replayFit(r, out, sc.video!)
    expect(fit.hp!.rmse).toBeLessThan(0.03)
    expect(fit.switches.typeMiss).toBe(0)
    expect(fit.events.matched).toBe(fit.events.n)
  })

  test('谐度破坏照白色跳字写了四次；后两次仿真里无冠者的偏谐值没满，轴里先写"敌人 失谐"', () => {
    const tb = out.log.flatMap(e => (e.type === 'actionStart' && /谐度破坏/.test(e.action) ? [`${e.char} ${e.action}`] : []))
    expect(tb).toEqual(['心 照世·谐度破坏', '雷主·男 谐度破坏', '心 照世·谐度破坏', '雷主·男 谐度破坏'])
    expect(out.log.filter(e => e.type === 'enemyState' && e.change === 'disharmony' && e.detail === '轴里写的（敌人 失谐）')).toHaveLength(2)
  })

  test('跳字（校准线索）：万阙垂天第 1 轮对上录像 298012；镇红尘第 1 轮仿真少约 7%；第 2 轮仿真多吃了卜灵声骸的全队攻击（录像两轮一样）', () => {
    const crit = (judgment: string, t: number) => {
      const h = out.log.filter(e => e.type === 'hit' && e.judgment === judgment && e.dmg)
        .sort((a, b) => Math.abs(vsec(a.f) - t) - Math.abs(vsec(b.f) - t))[0]!
      return h.type === 'hit' ? { v: h.dmg!.crit, buffs: h.buffs } : null!
    }
    const ult = crit('大招-6', 58.0)
    expect(Math.abs(ult.v / 298012 - 1)).toBeLessThan(0.005)
    const z1 = crit('增幅强化重击-3', 36.8), z2 = crit('增幅强化重击-3', 90.5)
    expect(288240 / z1.v).toBeGreaterThan(1.06)                       // 录像 288240、仿真 267644：差 7.7%，还没找到是哪一项
    expect(288240 / z1.v).toBeLessThan(1.09)
    expect(z2.buffs).toContain('无归的谬误.攻击')                     // 录像第 1、2 轮都是 288240；仿真第 2 轮多 4.4%
    expect(z1.buffs).not.toContain('无归的谬误.攻击')
    expect(z2.v / z1.v).toBeGreaterThan(1.04)
  })
})
