// tests/observations.test.ts —— DD-08 §3 的观测：三种新种类与选择器的 schema（C08-1）、compareObservations 的取值与比较（C08-2～C08-6）。
// 人造角色，不依赖 data/generated。
import { describe, expect, test } from 'vitest'
import { CalibrationPointSchema, ObservationSchema, toleranceOf, type Observation } from '../src/data/calibration.schema'
import { compareObservations, compareValue, readObservation, selectEvent } from '../src/engine/observations'
import { runPrepared } from '../src/engine/run'
import type { PreparedRun } from '../src/engine/run-types'
import { preparedSynth } from './helpers/diag-team'
import { action, judgment } from './helpers/kernel-harness'
import { idle, type SynthChar } from './helpers/synth'

// 甲：X 100 帧（没有判定）；大招 140 帧，开头 60 帧全局时停（只停战斗时钟），第 140 帧前不能切人；C 10 帧，第 2 帧命中给协奏 10
const 甲: SynthChar = {
  name: '甲',
  actions: [
    action({ id: 'X', endFrame: 100 }),
    action({ id: '大招', kind: 'liberation', endFrame: 140, switchLockUntil: 140, globalStopUntil: 60, dilations: [{ type: '全局时停', anchor: 'action', start: 0, enemy: { rate: 0, duration: 60 } }] }),
    action({ id: 'C', endFrame: 10, judgments: [judgment({ name: 'c', spawnFrame: 2, gains: { energy: 0, concerto: 10, core: [0, 0, 0] } })] }),
  ],
}
const team = (): [SynthChar, SynthChar, SynthChar] => [甲, idle('乙'), idle('丙')]
const prepared = (rotation: string[], options: Record<string, unknown> = {}): PreparedRun =>
  preparedSynth(team(), { rotation, ...(Object.keys(options).length ? { options } : {}) })
const base = { record: 'synthetic.md', scenario: 'synthetic.yaml' }
const obs = (x: Record<string, unknown>): Observation => ObservationSchema.parse({ ...base, ...x })

describe('观测的 schema（DD-08 §3.1）', () => {
  test('C08-1 选择器写不存在的事件类型、interval 不写 clock：schema 报错', () => {
    const ok = { id: 'i', kind: 'interval', from: { type: 'actionStart', char: '甲' }, to: { type: 'switch' }, clock: 'world' }
    expect(CalibrationPointSchema.safeParse({ ...base, ...ok }).success).toBe(true)
    expect(CalibrationPointSchema.safeParse({ ...base, ...ok, from: { type: 'castStart' } }).success).toBe(false)
    const { clock: _clock, ...noClock } = ok
    expect(CalibrationPointSchema.safeParse({ ...base, ...noClock }).success).toBe(false)
    // 选择器只能写这种事件用得上的字段；switchType 没有数值、要选切人事件
    expect(CalibrationPointSchema.safeParse({ ...base, ...ok, to: { type: 'switch', judgment: 'c' } }).success).toBe(false)
    expect(CalibrationPointSchema.safeParse({ ...base, id: 's', kind: 'switchType', at: { type: 'switch' }, game: 1 }).success).toBe(false)
    expect(CalibrationPointSchema.safeParse({ ...base, id: 's', kind: 'switchType', at: { type: 'hit' }, expect: 'intro' }).success).toBe(false)
    // 缺省：unit frames、nth 1、when after、as value、expect null、requires []
    const i = obs(ok)
    expect(i.kind === 'interval' && [i.unit, i.from.nth, i.requires]).toEqual(['frames', 1, []])
    const r = obs({ id: 'r', kind: 'resourceAt', at: { type: 'hit' }, char: '甲', resource: 'concerto' })
    expect(r.kind === 'resourceAt' && [r.when, r.as]).toEqual(['after', 'value'])
    expect(obs({ id: 's', kind: 'switchType', at: { type: 'switch' } })).toMatchObject({ expect: null, game: null })
    // interval 的缺省容差是绝对帧数：60 帧录像 ±1，30 帧录像 ±2
    expect(toleranceOf(i)).toBe(1)
    expect(toleranceOf(obs({ ...ok, fps: 30 }))).toBe(2)
  })
})

describe('compareObservations（DD-08 §3.2）', () => {
  test('C08-2 大招在世界帧 100 开始、有 60 帧全局时停，切人在世界帧 240：按 world、battle 取得 140 与 80；观测写 [139, 141] 世界帧时 passed', () => {
    const p = prepared(['甲 X', '甲 大招', 'switch 乙'])
    const res = runPrepared(p)
    expect(res.completion.status).toBe('completed')
    const ult = res.log.find(e => e.type === 'actionStart' && e.action === '大招')!, sw = res.log.find(e => e.type === 'switch')!
    expect([ult.f, sw.f]).toEqual([100, 240])                     // 前提
    const interval = { kind: 'interval', from: { type: 'actionStart', char: '甲', action: '大招' }, to: { type: 'switch' } }
    const world = obs({ id: 'w', ...interval, clock: 'world', gameRange: [139, 141] })
    const battle = obs({ id: 'b', ...interval, clock: 'battle', game: 80 })
    const seconds = obs({ id: 's', ...interval, clock: 'world', unit: 'seconds', game: 140 / 60 })
    const far = obs({ id: 'f', ...interval, clock: 'world', game: 143 })
    const env = compareObservations(p, res, [world, battle, seconds, far])
    expect(env.data.map(x => [x.observationId, x.status, x.sim, x.residual, x.residualKind])).toEqual([
      ['w', 'passed', [140], 0, 'absoluteFrames'],
      ['b', 'passed', [80], 0, 'absoluteFrames'],
      ['s', 'passed', [140 / 60], 0, 'absoluteFrames'],
      ['f', 'conflicted', [140], -3, 'absoluteFrames'],          // 差 3 帧，容差 ±1
    ])
    expect(env.capability.observationSummary).toEqual({ passed: 3, conflicted: 1, unmatchedOrAmbiguous: 0, insufficientOrUnassessable: 0 })
    expect(env.identity).toBe(p.identity)
  })

  test('C08-3 resourceAt：命中给 10 协奏，when before 与 after 相差 10；取值来自账本', () => {
    const p = prepared(['甲 C'])
    const res = runPrepared(p)                                     // 没开诊断：compareObservations 经同一个 PreparedRun 带账本重跑
    const at = { type: 'hit', char: '甲', judgment: 'c' }
    const before = obs({ id: 'before', kind: 'resourceAt', at, when: 'before', char: '甲', resource: 'concerto', game: 0 })
    const after = obs({ id: 'after', kind: 'resourceAt', at, when: 'after', char: '甲', resource: 'concerto', game: 10 })
    const ratio = obs({ id: 'ratio', kind: 'resourceAt', at, char: '甲', resource: 'concerto', as: 'ratio', gameRange: [0.09, 0.11] })
    const env = compareObservations(p, res, [before, after, ratio])
    expect(env.data.map(x => [x.observationId, x.status, x.sim])).toEqual([['before', 'passed', [0]], ['after', 'passed', [10]], ['ratio', 'passed', [0.1]]])
    expect(env.capability.capabilitiesUsed).toEqual(['compareObservations', 'diag.resourceLedger', 'diag.eventMeta'])
    // 取值来自账本：把账本里这一笔改成 7，读出来的就是 7（日志里的 gains 仍是 10）
    const full = runPrepared(p, { diag: { resourceLedger: true, eventMeta: true } })
    const ledger = full.diag!.resourceLedger!.map(e => (e.kind === 'change' && e.resource === 'concerto' ? { ...e, actualDelta: 7, after: e.before + 7 } : e))
    const x = readObservation(after, { resolved: p.resolved, log: full.log, ledger, meta: full.diag!.eventMeta! })
    expect(x).toEqual({ ok: true, value: 7 })
    // 没有账本时取不到
    expect(readObservation(after, { resolved: p.resolved, log: full.log })).toMatchObject({ ok: false })
  })

  test('C08-4 switchType：expect intro，仿真里是普通切人 → conflicted、categorical', () => {
    const p = prepared(['甲 C', 'switch 乙'])
    const res = runPrepared(p)
    const s = obs({ id: 'sw', kind: 'switchType', at: { type: 'switch', char: '乙' }, expect: 'intro' })
    const [x] = compareObservations(p, res, [s]).data
    expect(x).toEqual({ observationId: 'sw', status: 'conflicted', sim: 'normal', residual: 1, residualKind: 'categorical' })
    expect(compareValue({ ...s, expect: 'normal' } as Observation, 'normal')).toMatchObject({ status: 'passed', residual: 0 })
    expect(compareValue({ ...s, expect: null } as Observation, 'normal')).toMatchObject({ status: 'unassessable', reason: '还没有实测值' })
  })

  test('C08-5 选择器指向运行截断之后的事件 → unmatched，reason 里有完成状态；跑完了还找不到的是另一种说明', () => {
    const p = prepared(['甲 X', '甲 大招'], { maxFrames: 50 })
    const res = runPrepared(p)
    expect(res.completion.status).toBe('truncated')
    const o = obs({ id: 'late', kind: 'interval', from: { type: 'actionStart', action: 'X' }, to: { type: 'actionStart', action: '大招' }, clock: 'world', game: 100 })
    const [x] = compareObservations(p, res, [o]).data
    expect(x!.status).toBe('unmatched')
    expect(x!.reason).toContain('truncated')
    const src = { resolved: p.resolved, log: res.log, completion: res.completion }
    expect(readObservation(o, src)).toMatchObject({ ok: false, covered: false })
    // 完整的运行里写错名字：covered true（不是没跑到）
    const done = prepared(['甲 X'])
    const r2 = runPrepared(done)
    const typo = obs({ id: 'typo', kind: 'switchType', at: { type: 'switch', char: '丁' }, expect: 'intro' })
    expect(readObservation(typo, { resolved: done.resolved, log: r2.log, completion: r2.completion })).toMatchObject({ ok: false, covered: true })
    expect(compareObservations(done, r2, [typo]).data[0]!.reason).not.toContain('completed')
  })

  test('C08-6 观测声明 requires: [敌人等级]，condition.unknowns 里有它 → insufficientCondition', () => {
    const p = prepared(['甲 X', '甲 大招', 'switch 乙'])
    const res = runPrepared(p)
    const o = obs({
      id: 'cond', kind: 'interval', from: { type: 'actionStart', action: '大招' }, to: { type: 'switch' }, clock: 'world', game: 140,
      requires: ['敌人等级'], condition: { gameVersion: '3.7', unknowns: ['敌人等级'] },
    })
    const [x] = compareObservations(p, res, [o]).data
    expect(x).toMatchObject({ status: 'insufficientCondition', sim: [140], residual: null })
    expect(x!.reason).toContain('敌人等级')
    // unknowns 里有别的、requires 的都知道：照常比
    const known = obs({ ...o, condition: { gameVersion: '3.7', unknowns: ['副词条'] } })
    expect(compareObservations(p, res, [known]).data[0]!.status).toBe('passed')
  })

  test('选择器：loop 限定轮次、nth 第几个、interval 的 to 从 from 之后数；同一帧几条分不清的事件、值不同时 ambiguous', () => {
    const p = prepared(['甲 C', '甲 C'], { repeat: 2 })
    const res = runPrepared(p)
    const hits = res.log.flatMap((e, i) => (e.type === 'hit' ? [i] : []))
    expect(hits).toHaveLength(4)
    expect(selectEvent({ type: 'hit', loop: 2, nth: 1 }, res.log, p.resolved)).toEqual({ index: hits[2], peers: [] })
    expect(selectEvent({ type: 'hit', nth: 2 }, res.log, p.resolved, hits[1])).toEqual({ index: hits[3], peers: [] })
    expect(selectEvent({ type: 'hit', loop: 3, nth: 1 }, res.log, p.resolved)).toContain('没有第 3 轮')
    // 同一帧两条事件、值不同：一个在容差内 → ambiguous，都不在 → conflicted
    const o = obs({ id: 'r', kind: 'resourceAt', at: { type: 'hit' }, char: '甲', resource: 'concerto', game: 10 })
    expect(compareValue(o, 10, { alternatives: [20] })).toMatchObject({ status: 'ambiguous', residual: null })
    expect(compareValue(o, 30, { alternatives: [20] })).toMatchObject({ status: 'conflicted' })
    expect(compareValue(o, 10, { alternatives: [10] })).toMatchObject({ status: 'passed', residual: 0 })
  })
})
