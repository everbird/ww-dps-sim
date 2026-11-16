// tests/calibration.test.ts —— 观测（校准点，docs/calibration/points.yaml，docs/engine-quality-plan.md P4、DD-08 §3）：
// 填了实测值的按容差检查，对上过的以后改引擎、换数据版本不会悄悄跑偏；没填的列成待测（todo）。
// DD-08 §3.2：按场景各跑一次（prepareRun → runPrepared），比较交给 compareObservations（resourceAt 要的账本由它带诊断重跑取）；
// 读数声明了缺条件的（requires ∩ unknowns）是 insufficientCondition，不算失败。旧的 calibrate() 是薄包装，最后一组照旧用它。
// 依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { CalibrationFileSchema, type CalibrationPoint } from '../src/data/calibration.schema'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { calibrate } from '../src/engine/calibration'
import { compareObservations, hasReading, type ObservationComparison } from '../src/engine/observations'
import { prepareRun, runPrepared } from '../src/engine/run'
import type { PreparedRun } from '../src/engine/run-types'
import type { SimResult } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

const { points } = CalibrationFileSchema.parse(parse(readFileSync(new URL('../docs/calibration/points.yaml', import.meta.url), 'utf8')))

describe('观测清单', () => {
  test('id 不重复；场景、记录文件都在', () => {
    expect(new Set(points.map(p => p.id)).size).toBe(points.length)
    for (const p of points) {
      expect(() => readFileSync(new URL(`../scenarios/${p.scenario}`, import.meta.url))).not.toThrow()
      expect(() => readFileSync(new URL(`../docs/calibration/${p.record}`, import.meta.url))).not.toThrow()
    }
  })
})

dataDescribe('观测', () => {
  let gd: GameData
  const runs = new Map<string, { p: PreparedRun; res: SimResult }>()
  const runOf = (f: string) => {
    let x = runs.get(f)
    if (!x) {
      const prep = prepareRun(ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8'))), gd)
      if (!prep.ok) throw new Error(prep.issues.map(i => i.message).join('；'))
      x = { p: prep.run, res: runPrepared(prep.run) }
      runs.set(f, x)
    }
    return x
  }
  const compare = (o: CalibrationPoint): ObservationComparison => { const { p, res } = runOf(o.scenario); return compareObservations(p, res, [o]).data[0]! }
  beforeAll(async () => { gd = await loadGameData() }, 60_000)

  // 每条都取得到仿真值（名字、轮次、选择器写对了）；填了实测的要在容差内（声明了缺条件的除外）
  for (const p of points) {
    if (!hasReading(p)) {
      test(`${p.id}：取得到仿真值（待测）`, () => {
        expect(compare(p)).toMatchObject({ status: 'unassessable' })
      }, 120_000)
      test.todo(`${p.id}：实测（${p.record}）`)
    } else {
      test(`${p.id}：仿真与实测在容差内`, () => {
        const x = compare(p)
        expect(x.status, `${p.id}：仿真 ${JSON.stringify(x.sim)}，差 ${x.residual}（${x.reason ?? ''}）`).not.toMatch(/^(conflicted|unmatched)$/)
        if (x.status === 'insufficientCondition') expect(p.requires.length).toBeGreaterThan(0)
      }, 120_000)
    }
  }

  test('比对（calibrate 是薄包装）：跳字分支未知时返回 ambiguous，显式分支返回 passed/conflicted；超出容差标 conflicted', () => {
    const p = points.find((x): x is Extract<CalibrationPoint, { kind: 'hit' }> => x.id === '椿AAE.A1#1' && x.kind === 'hit')!
    const { p: run, res } = runOf(p.scenario)
    const check = (q: CalibrationPoint) => calibrate(q, run.resolved, res.log)
    const sim = check({ ...p, game: null }).sim!                   // [不暴击, 暴击]，记录里是 1,490 / 3,554
    expect(sim.map(Math.round)).toEqual([1490, 3554])
    expect(check({ ...p, game: 3554 })).toMatchObject({ comparison: 'ambiguous', status: 'ok', matched: null, diff: null })
    expect(check({ ...p, game: 1490 })).toMatchObject({ comparison: 'ambiguous', status: 'ok', matched: null, diff: null })
    expect(check({ ...p, branch: 'crit', game: 3554 })).toMatchObject({ comparison: 'passed', status: 'ok', matched: sim[1] })
    expect(check({ ...p, branch: 'nonCrit', game: 1490 })).toMatchObject({ comparison: 'passed', status: 'ok', matched: sim[0] })
    expect(check({ ...p, branch: 'crit', game: 1490 })).toMatchObject({ comparison: 'conflicted', status: 'off', matched: sim[1] })
    expect(check({ ...p, game: 1520 })).toMatchObject({ comparison: 'conflicted', status: 'off' })
    expect(check({ ...p, judgment: '没有这一下' })).toMatchObject({ comparison: 'unmatched', status: 'error' })
    // 薄包装与 compareObservations 给的状态一样
    expect(compare({ ...p, game: 3554 }).status).toBe(check({ ...p, game: 3554 }).comparison)
  }, 120_000)
})
