import { runPrepared } from '../src/engine/run'
import { fixturePreparedRun } from './helpers/prepared-fixture'
import { describe, expect, test } from 'vitest'
import { CalibrationFileSchema, CalibrationPointSchema, type CalibrationPoint } from '../src/data/calibration.schema'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { calibrate, simValue } from '../src/analysis/calibration'
import { resolveScenario } from '../src/engine/resolve'

import { loopSpan } from '../src/analysis/trace'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData } from './helpers/synth'

describe('CalibrationSchema（C03-1/C03-2）：clock、branch、gameRange、purpose、condition', () => {
  test('C03-1 & C03-2：缺省值与互斥校验', () => {
    const loopDef = CalibrationPointSchema.parse({
      id: 'l1', scenario: 'm0-team.yaml', kind: 'loop', loop: 1, game: null, record: 'test',
    })
    expect(loopDef.kind === 'loop' && loopDef.clock).toBe('battle')
    expect(loopDef.purpose).toBe('unspecified')

    const hitDef = CalibrationPointSchema.parse({
      id: 'h1', scenario: 'm0-team.yaml', kind: 'hit', char: '椿', judgment: 'A1', nth: 1, loop: 1,
      game: null, gameRange: [1400, 1600], record: 'test', purpose: 'independent_validation',
      condition: { gameVersion: '3.7', recordedAt: '2026-11-15', note: '深塔实战', unknowns: ['副词条细节'] },
    })
    expect(hitDef.kind === 'hit' && hitDef.branch).toBe('unknown')
    expect(hitDef.purpose).toBe('independent_validation')
    expect(hitDef.condition?.unknowns).toEqual(['副词条细节'])

    // game 与 gameRange 不能同时给（单点与文件 schema 都拒绝）
    const conflict = {
      id: 'bad', scenario: 'm0-team.yaml', kind: 'panel', char: '椿', item: '攻击',
      game: 2000, gameRange: [1900, 2100], record: 'test',
    }
    expect(CalibrationPointSchema.safeParse(conflict).success).toBe(false)
    expect(CalibrationFileSchema.safeParse({ points: [conflict] }).success).toBe(false)
  })
})

describe('calibrate 时钟、区间与分支语义（DD-03 §3–4）', () => {
  const act = action({
    id: '大招',
    kind: 'liberation',
    endFrame: 90,
    judgments: [judgment({ name: 'A1', spawnFrame: 10, multiplier: 2 })],
    dilations: [{ type: '全局时停', anchor: 'action', start: 0, enemy: { rate: 0, duration: 30 } }],
  })
  const gd = synthData([{ name: '甲', actions: [act] }, idle('乙'), idle('丙')])
  const r = resolveScenario(ScenarioSchema.parse({
    team: [
      { char: '甲', weapon: { name: '测试武器' } },
      { char: '乙', weapon: { name: '测试武器' } },
      { char: '丙', weapon: { name: '测试武器' } },
    ],
    enemy: { custom: { level: 90 } },
    rotation: ['甲 大招'],
    options: { repeat: 2 },
  }), gd)
  const log = runPrepared(fixturePreparedRun(r)).log

  test('C03-1：loop 点显式区分 clock: battle 与 clock: world', () => {
    const span = loopSpan(log, 1)!
    expect(span).toBeDefined()
    const base = { id: 'loop1', scenario: 'synth.yaml', kind: 'loop' as const, loop: 1, game: null, record: 'sim' }
    const pBattle = CalibrationPointSchema.parse({ ...base, clock: 'battle' })
    const pWorld = CalibrationPointSchema.parse({ ...base, clock: 'world' })

    const battleSim = simValue(pBattle, r, log) as number[]
    const worldSim = simValue(pWorld, r, log) as number[]
    expect(battleSim[0]).toBeCloseTo(span.endT - span.t, 6)
    expect(worldSim[0]).toBeCloseTo((span.endF - span.f) / 60, 6)
    // 大招含 30F 全局时停，世界时钟明显大于战斗时钟
    expect(worldSim[0]).toBeGreaterThan(battleSim[0]!)
  })

  test('C03-3：gameRange 区间内残差为 0，两端按较近端点算相对差', () => {
    const pAtk = CalibrationPointSchema.parse({
      id: 'atk', scenario: 'synth.yaml', kind: 'panel', char: '甲', item: '攻击', game: null, record: 'r',
    })
    const simAtk = (simValue(pAtk, r, log) as number[])[0]!

    const inRange = calibrate(
      CalibrationPointSchema.parse({ ...pAtk, gameRange: [simAtk - 10, simAtk + 10] }),
      r,
      log,
    )
    expect(inRange.comparison).toBe('passed')
    expect(inRange.diff).toBe(0)

    const loClose = simAtk * 1.0005
    const withinTol = calibrate(
      CalibrationPointSchema.parse({ ...pAtk, gameRange: [loClose, loClose + 100] }),
      r,
      log,
    )
    expect(withinTol.comparison).toBe('passed')
    expect(withinTol.diff!).toBeCloseTo(simAtk / loClose - 1, 8)

    const loFar = simAtk * 1.05
    const belowTol = calibrate(
      CalibrationPointSchema.parse({ ...pAtk, gameRange: [loFar, loFar + 100] }),
      r,
      log,
    )
    expect(belowTol.comparison).toBe('conflicted')
    expect(belowTol.diff!).toBeLessThan(0)

    const hiFar = simAtk * 0.9
    const aboveTol = calibrate(
      CalibrationPointSchema.parse({ ...pAtk, gameRange: [hiFar - 100, hiFar] }),
      r,
      log,
    )
    expect(aboveTol.comparison).toBe('conflicted')
    expect(aboveTol.diff!).toBeCloseTo(simAtk / hiFar - 1, 8)
    expect(aboveTol.diff!).toBeGreaterThan(0)
  })

  test('C03-4 & C03-4b：hit 分支 crit / nonCrit / unknown', () => {
    const baseHit = {
      id: 'h', scenario: 'synth.yaml', kind: 'hit' as const, char: '甲',
      judgment: 'A1', nth: 1, loop: 1, game: null, record: 'r',
    }
    const sim = simValue(CalibrationPointSchema.parse(baseHit), r, log) as number[]
    expect(sim).toHaveLength(2)
    const [nonCritSim, critSim] = sim as [number, number]

    // C03-4：显式 crit 对上 nonCrit 数值 → 冲突（不能靠另半边凑合通过）
    const critOnNonCrit = calibrate(
      CalibrationPointSchema.parse({ ...baseHit, branch: 'crit', game: nonCritSim }),
      r,
      log,
    )
    expect(critOnNonCrit.comparison).toBe('conflicted')
    expect(critOnNonCrit.matched).toBe(critSim)
    expect(critOnNonCrit.branches?.crit.within).toBe(false)
    expect(critOnNonCrit.branches?.nonCrit.within).toBe(true)

    const nonCritOk = calibrate(
      CalibrationPointSchema.parse({ ...baseHit, branch: 'nonCrit', game: nonCritSim }),
      r,
      log,
    )
    expect(nonCritOk.comparison).toBe('passed')
    expect(nonCritOk.matched).toBe(nonCritSim)

    // C03-4b：branch: unknown 命中一侧或两侧 → ambiguous，且 matched/diff 为 null（DD-03 §4.2 / C03-4）
    const unkOne = calibrate(
      CalibrationPointSchema.parse({ ...baseHit, game: critSim }),
      r,
      log,
    )
    expect(unkOne.comparison).toBe('ambiguous')
    expect(unkOne.status).toBe('ok')
    expect(unkOne.matched).toBeNull()
    expect(unkOne.diff).toBeNull()
    expect(unkOne.branches?.crit.within).toBe(true)
    expect(unkOne.branches?.nonCrit.within).toBe(false)

    const unkBoth = calibrate(
      CalibrationPointSchema.parse({ ...baseHit, gameRange: [nonCritSim - 1, critSim + 1] }),
      r,
      log,
    )
    expect(unkBoth.comparison).toBe('ambiguous')
    expect(unkBoth.matched).toBeNull()
    expect(unkBoth.diff).toBeNull()
    expect(unkBoth.branches?.nonCrit.within).toBe(true)
    expect(unkBoth.branches?.crit.within).toBe(true)

    const unkNone = calibrate(
      CalibrationPointSchema.parse({ ...baseHit, game: critSim * 2 }),
      r,
      log,
    )
    expect(unkNone.comparison).toBe('conflicted')
    expect(unkNone.status).toBe('off')
    expect(unkNone.matched).toBeNull()
    expect(unkNone.diff).toBeNull()
  })

  test('C03-5 & C03-5b：待测 unassessable、找不到 unmatched、独立验证用途保留', () => {
    const todo = calibrate(
      CalibrationPointSchema.parse({
        id: 'todo', scenario: 'synth.yaml', kind: 'panel', char: '甲', item: '攻击',
        game: null, record: 'r', purpose: 'independent_validation',
      }),
      r,
      log,
    )
    expect(todo.comparison).toBe('unassessable')
    expect(todo.point.purpose).toBe('independent_validation')

    const miss = calibrate(
      CalibrationPointSchema.parse({
        id: 'miss', scenario: 'synth.yaml', kind: 'panel', char: '甲', item: '不存在的项',
        game: 1000, record: 'r',
      }) as CalibrationPoint,
      r,
      log,
    )
    expect(miss.comparison).toBe('unmatched')
    expect(miss.sim).toBeNull()
  })
})
