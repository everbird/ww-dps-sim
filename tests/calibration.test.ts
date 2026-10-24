// tests/calibration.test.ts —— 校准点（docs/calibration/points.yaml，docs/engine-quality-plan.md P4）：
// 填了实测值（game）的点按容差检查，对上过的点以后改引擎、换数据版本不会悄悄跑偏；没填的列成待测（todo）。
// 依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { CalibrationFileSchema, type CalibrationPoint } from '../src/data/calibration.schema'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { calibrate } from '../src/engine/calibration'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario, SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

const { points } = CalibrationFileSchema.parse(parse(readFileSync(new URL('../docs/calibration/points.yaml', import.meta.url), 'utf8')))

describe('校准点清单', () => {
  test('id 不重复；场景、记录文件都在', () => {
    expect(new Set(points.map(p => p.id)).size).toBe(points.length)
    for (const p of points) {
      expect(() => readFileSync(new URL(`../scenarios/${p.scenario}`, import.meta.url))).not.toThrow()
      expect(() => readFileSync(new URL(`../docs/calibration/${p.record}`, import.meta.url))).not.toThrow()
    }
  })
})

dataDescribe('校准点', () => {
  let gd: GameData
  const runs = new Map<string, { r: ResolvedScenario; log: SimEvent[] }>()
  const runOf = (f: string) => {
    let x = runs.get(f)
    if (!x) {
      const r = resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8'))), gd)
      x = { r, log: simulate(r).log }
      runs.set(f, x)
    }
    return x
  }
  const check = (p: CalibrationPoint) => { const { r, log } = runOf(p.scenario); return calibrate(p, r, log) }
  beforeAll(async () => { gd = await loadGameData() }, 60_000)

  // 每个点都取得到仿真值（名字、轮次写对了）；填了实测的要在容差内
  for (const p of points) {
    if (p.game === null) {
      test(`${p.id}：取得到仿真值（待测）`, () => { expect(check(p).status).toBe('todo') }, 60_000)
      test.todo(`${p.id}：实测（${p.record}）`)
    } else {
      test(`${p.id}：仿真与实测在容差内`, () => {
        const x = check(p)
        expect(x.error).toBeUndefined()
        expect(x.status, `仿真 ${x.matched}，实测 ${p.game}，差 ${((x.diff ?? 0) * 100).toFixed(2)}%`).toBe('ok')
      }, 60_000)
    }
  }

  test('比对：跳字按"不暴击 / 暴击"里接近实测的那个比；超出容差标 off', () => {
    const p = points.find((x): x is Extract<CalibrationPoint, { kind: 'hit' }> => x.id === '椿AAE.A1#1' && x.kind === 'hit')!
    const sim = check({ ...p, game: null }).sim!                   // [不暴击, 暴击]，记录里是 1,490 / 3,554
    expect(sim.map(Math.round)).toEqual([1490, 3554])
    expect(check({ ...p, game: 3554 })).toMatchObject({ status: 'ok', matched: sim[1] })
    expect(check({ ...p, game: 1490 })).toMatchObject({ status: 'ok', matched: sim[0] })
    expect(check({ ...p, game: 1520 }).status).toBe('off')           // 差 2%
    expect(check({ ...p, judgment: '没有这一下' }).status).toBe('error')
  }, 60_000)
})
