// tests/xin-tower3.test.ts —— 心 · 雷主 · 卜灵 深塔 41 期中 3 的录像剖析（scenarios/xin-tower3-video.yaml，2026-10-26，docs/tower-20261026.md）：
// 整局跑得通、多数切人对得上录像；心的万阙垂天在仿真里能量不够、比录像晚（xin-confirm X2 的旁证）。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { compareMarks, traceCommands } from '../src/engine/trace'
import type { ResolvedScenario, SimResult } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

dataDescribe('心雷卜深塔 41 期中 3 的录像', () => {
  let sc: ScenarioInput
  let r: ResolvedScenario
  let out: SimResult
  beforeAll(async () => {
    const gd = await loadGameData()
    sc = parse(readFileSync(new URL('../scenarios/xin-tower3-video.yaml', import.meta.url), 'utf8'))
    r = resolveScenario(ScenarioSchema.parse(sc), gd)
    out = simulate(r)
  })

  test('整局跑得通，15 次切人都出现；10 次以上差不到 0.5 秒，最多差 7 秒（心的万阙垂天那两段）', () => {
    expect(out.error).toBeUndefined()
    const cmp = compareMarks(traceCommands(out.log, r, 1), sc.video!.marks!)
    expect(cmp.missing).toEqual([])
    expect(cmp.rows.length).toBe(15)
    expect(cmp.rows.filter(x => Math.abs(x.diff) < 0.5).length).toBeGreaterThanOrEqual(10)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(7)
  })

  test('环境特性四条都在，敌人是 41塔中3 的无常凶鹭', () => {
    expect(r.buffs.filter(b => b.owner === 'env').map(b => b.def.id)).toEqual(['深塔41中3.受伤递增', '深塔41中3.抗性', '深塔41中3.变奏', '深塔41中3.电磁'])
    expect(r.enemy.id).toBe('41塔中3/无常凶鹭')
  })
})
