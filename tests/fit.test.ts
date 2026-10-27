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

  test('中 3：切人、录像动作、血条三项都算上；score 按权重折成秒', () => {
    const f = replayFit(r, simulate(r), sc.video!)
    expect(f.switches.n).toBe(15)
    expect(f.events.n).toBe(sc.video!.events!.length)
    expect(f.events.matched).toBe(f.events.n)
    expect(f.hp?.n).toBe(sc.video!.hp!.length)
    expect(f.hp!.rmse).toBeLessThan(0.08)                          // 第三版（心的衔接对上录像后）约 5%，第二版 15.5%
    expect(f.switches.max).toBeLessThan(2)
    expect(f.score).toBeCloseTo(f.switches.mae + f.events.mae + FIT_WEIGHTS.typeMiss * f.switches.typeMiss
      + FIT_WEIGHTS.unmatched * (f.events.n - f.events.matched) + FIT_WEIGHTS.hpPct * f.hp!.rmse * 100, 9)
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
