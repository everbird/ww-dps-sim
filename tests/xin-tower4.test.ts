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

  test('整局跑得通；15 次切人类型都和录像一致、都差不到 0.3 秒（卜灵切走清卦象之后，第 13 段不再晚）', () => {
    expect(out.error).toBeUndefined()
    const cmp = compareMarks(traceCommands(out.log, r, 1), sc.video!.marks)
    expect(cmp.missing).toEqual([])
    expect(cmp.rows).toHaveLength(15)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(0.3)
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
    // 协奏环（2026-10-28）：133 个点，均方根差约 9.8%，仿真平均高约 5.6%（卜灵段中间给得早）
    expect(fit.concerto!.n).toBe(133)
    expect(fit.concerto!.rmse).toBeLessThan(0.11)
  })

  test('回路条上的应世心（video.core，2026-10-28）：均方根差不到 6%；开打、镇红尘之后到 E 都没打普攻，借相回应世只打一下 A1，第四次变奏入场约 70（原来带进去 39，入场就满）', () => {
    const fit = replayFit(r, out, sc.video!)
    expect(fit.core!.n).toBe(sc.video!.core!.length)
    expect(fit.core!.rmse).toBeLessThan(0.06)
    const qte = out.log.filter(e => e.type === 'resource' && e.char === '心' && e.resource === 'core1' && e.cause === 'cast' && e.delta === 60)   // 变奏入场 +60
    expect(qte).toHaveLength(4)
    const after = qte.map(e => (e.type === 'resource' ? e.value : 0))
    expect(after[3]).toBeGreaterThan(60)
    expect(after[3]).toBeLessThan(80)
    const bad = { ...sc.video!, core: ['33.0 心 照世心力 0.5'] }
    expect(() => replayFit(r, out, bad)).toThrow(/没有这项资源/)
  })

  test('卜灵的卦象：录像每段切入时是空的（forteKeepOnSwitch: false），每段都是"少阳 → 震为雷（少阴）→ 阴阳相生"再放大招；第 4 段空中入场，先震后艮是雷山小过', () => {
    expect(r.rules.forteKeepOnSwitch).toBe(false)
    const heavy = out.log.flatMap(e => (e.type === 'actionStart' && e.char === '卜灵' && /^重击/.test(e.action) ? [e.action] : []))
    expect(heavy).toEqual(['重击', '重击-震震', '重击', '重击-震震', '重击', '重击-震震', '重击-震艮前置', '重击-震震'])
    // 视频 175.5 雷主 E（雷引）离地时切卜灵，第一下是空中攻击（TD-09 §3.5 空中入场）
    const sw = out.log.findIndex(e => e.type === 'switch' && e.to === '卜灵' && Math.abs(vsec(e.f) - 175.5) < 0.1)
    expect(out.log.slice(sw).find(e => e.type === 'actionStart')).toMatchObject({ char: '卜灵', action: '空中攻击' })
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

  test('阵打出的判定带 summon（卜灵冲击波）：缺省算"角色附加"；rules.summonCountsAsChar = false 时不触发、心不转霆心域，踏月归心小一半多（假设 summon-as-char）', async () => {
    const applied = out.log.filter(e => e.type === 'enemyState' && e.change === 'effectApplied')
    expect(applied.some(e => e.type === 'enemyState' && e.summon && e.detail === '卜灵 大招-冲击波')).toBe(true)
    expect(applied.some(e => e.type === 'enemyState' && e.summon && e.by !== '卜灵')).toBe(false)
    expect(out.summary.assumptions.map(a => a.id)).toContain('summon-as-char')
    const tread = (res: SimResult) => res.log.flatMap(e => (e.type === 'hit' && e.judgment === '踏月归心·电磁效应' ? [e.dmg!.expected] : []))
    const gd = await loadGameData()
    const off = simulate(resolveScenario({ ...sc, options: { ...sc.options, rules: { ...sc.options.rules, summonCountsAsChar: false } } }, gd))
    expect(off.error).toBeUndefined()
    // 录像两次踏月归心 62476、32596；缺省 126811、72464，不算阵 54348、36232（2026-10-28 卜灵大招按逐帧量的时刻写之后一度是 42271；同日钉住的动作写 ! 之后回到 54348——第一次的值看卜灵冲击波和心 E 的先后，差几帧就变）
    const [a, b] = tread(out), [c, d] = tread(off)
    expect(Math.round(a!)).toBe(126811)
    expect(Math.round(b!)).toBe(72464)
    expect(c! / 62476).toBeGreaterThan(0.6)
    expect(c! / 62476).toBeLessThan(0.9)
    expect(d! / 32596).toBeGreaterThan(1)
    expect(d! / 32596).toBeLessThan(1.2)
  })
})
