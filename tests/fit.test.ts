// tests/fit.test.ts —— 录像剖析的贴合度（src/engine/fit.ts，2026-10-27）：按和录像差多少打分、变体按贴合度排，不比 DPS。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { fitVariants, replayFit, FIT_WEIGHTS } from '../src/engine/fit'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

dataDescribe('录像剖析的贴合度', () => {
  let sc: Scenario
  let r: ResolvedScenario
  beforeAll(async () => {
    sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/xin-tower3-video.yaml', import.meta.url), 'utf8')))
    r = resolveScenario(sc, await loadGameData())
  })

  test('中 3：切人、录像动作、血条、协奏环、回路条资源五项都算上；score 按权重折成秒', () => {
    const f = replayFit(r, simulate(r), sc.video!)
    expect(f.switches.n).toBe(15)
    expect(f.events.n).toBe(sc.video!.events!.length)
    expect(f.events.matched).toBe(f.events.n)
    expect(f.hp?.n).toBe(sc.video!.hp!.length)
    expect(f.hp!.rmse).toBeLessThan(0.03)                          // 第四版约 1.8%（第三版约 5%、第二版 15.5%，血条时间读错了）
    expect(f.switches.max).toBeLessThan(0.5)
    expect(f.switches.typeMiss).toBe(0)
    // 协奏环（2026-10-28）：前台角色的协奏 / 上限，约 11%；仿真整体偏高（卜灵段中间给得早，心约高 5%）
    expect(f.concerto?.n).toBe(sc.video!.concerto!.length)
    expect(f.concerto!.rmse).toBeLessThan(0.13)
    expect(f.concerto!.mean).toBeGreaterThan(0)
    // 回路条上的应世心（video.core，2026-10-28）：约 9%；仿真整体偏高（变奏入场后的那一下 +12 来得比回路条早）
    expect(f.core?.n).toBe(sc.video!.core!.length)
    expect(f.core!.rmse).toBeLessThan(0.11)
    expect(f.core!.mean).toBeGreaterThan(0)
    expect(f.score).toBeCloseTo(f.switches.mae + f.events.mae + FIT_WEIGHTS.typeMiss * f.switches.typeMiss
      + FIT_WEIGHTS.unmatched * (f.events.n - f.events.matched) + FIT_WEIGHTS.hpPct * f.hp!.rmse * 100
      + FIT_WEIGHTS.concertoPct * f.concerto!.rmse * 100 + FIT_WEIGHTS.corePct * f.core!.rmse * 100, 9)
  })

  test('切人晚了贴合度变差：开头多等 2 秒，切人平均差变大', () => {
    const f0 = replayFit(r, simulate(r), sc.video!)
    const late = ScenarioSchema.parse({ ...sc, rotation: ['wait 120', ...sc.rotation] })
    const r2 = resolveScenario(late, r.data)
    const marks = Object.fromEntries(Object.entries(sc.video!.marks).map(([k, v]) => [String(Number(k) + 1), v]))
    const f1 = replayFit(r2, simulate(r2), { ...sc.video!, marks })
    expect(f1.switches.mae).toBeGreaterThan(f0.switches.mae)
  })

  test('变体按贴合度从好到差排（跑不通的放最后）；有假设开关的变体', () => {
    const x = fitVariants(r, sc, { n: 4 })
    const scores = x.rows.flatMap(row => (row.fit ? [row.fit.score] : []))
    expect(scores).toEqual([...scores].sort((a, b) => a - b))
    expect(x.rows.some(row => row.desc.startsWith('假设 '))).toBe(true)
    expect(x.candidates).toBeGreaterThan(4)
  })
})
