// tests/env-buffs.test.ts —— 深塔环境特性（data/curated/env-buffs.ts）：41 期中 3 的四条，拿心雷卜（scenarios/xin-team.yaml）跑。
// 触发条件 afterBattle（战斗多少帧以后才触发）、环境特性写"自身"的给触发者（2026-10-26，docs/tower-20261026.md）。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

type Apply = Extract<SimEvent, { type: 'buffApply' }>

dataDescribe('深塔 41 期中 3 的环境特性', () => {
  let log: SimEvent[]
  const applies = (id: string) => log.filter((e): e is Apply => e.type === 'buffApply' && e.buff === id)
  beforeAll(async () => {
    const gd = await loadGameData()
    const base = parse(readFileSync(new URL('../scenarios/xin-team.yaml', import.meta.url), 'utf8')) as ScenarioInput
    const sc = {
      ...base, enemy: { preset: '41塔中3/无常凶鹭' }, options: { ...base.options, repeat: 4 },
      environment: ['深塔41中3.受伤递增', '深塔41中3.抗性', '深塔41中3.变奏', '深塔41中3.电磁'],
    }
    const out = simulate(resolveScenario(ScenarioSchema.parse(sc), gd))
    expect(out.error).toBeUndefined()
    log = out.log
  })

  test('受伤递增：战斗 60 秒以后才加，之后每 5 秒一层，12 层封顶', () => {
    const a = applies('深塔41中3.受伤递增')
    expect(a[0]!.t).toBeGreaterThanOrEqual(60)
    expect(a[0]!.target).toBe('enemy')
    for (let k = 1; k < a.length; k++) expect(a[k]!.t - a[k - 1]!.t).toBeGreaterThanOrEqual(5 - 1e-9)
    expect(Math.max(...a.map(e => e.stacks))).toBe(12)
  })

  test('电磁：给附加电磁效应的那个人（同一帧有他的 effectApplied）', () => {
    const a = applies('深塔41中3.电磁')
    expect(a.length).toBeGreaterThan(0)
    for (const e of a) {
      expect(log.some(x => x.type === 'enemyState' && x.change === 'effectApplied' && x.effect === '电磁效应' && x.by === e.target && x.f === e.f)).toBe(true)
    }
  })

  test('变奏：给全队', () => {
    const first = applies('深塔41中3.变奏').filter((e, _, all) => e.f === all[0]!.f)
    expect(first.map(e => e.target).sort()).toEqual(['卜灵', '心', '雷主·男'].sort())
  })
})
