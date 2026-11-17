// DD-10 §8 C10-1～6、9～11：实际续跑，不以重跑伪装恢复。
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, test } from 'vitest'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { BOUNDARY_CASES, boundaryRun } from '../src/cli/conformance-cases'
import { ALL_DIAG } from '../src/engine/diagnostics'
import { canonicalJson } from '../src/engine/digest'
import { replayTo, stateAt, viewOf } from '../src/engine/query'
import { runPrepared, runToExecution } from '../src/engine/run'
import { captureSnapshot, snapshotAt, snapshotsAt, resumeFrom, MemorySnapshotCache } from '../src/engine/snapshot'
import type { PreparedRun } from '../src/engine/run-types'
import { action, judgment, dataDescribe } from './helpers/kernel-harness'
import { synthData, idle } from './helpers/synth'
import { preparedScenario } from './helpers/prepared-fixture'

function fixture(sample = false) {
  const X = action({ id: 'X', endFrame: 40, judgments: [judgment({ name: 'hit', spawnFrame: 10 })] })
  const data = synthData([{ name: '甲', actions: [X] }, idle('乙'), idle('丙')])
  const sc = ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 X X X'], options: { tuneBreak: 'off' } })
  return preparedScenario(sc, data, sample ? { sample: { seed: 93, jitter: 4, hand: { mean: 3, sd: 1 } } } : {})
}
function verify(p: PreparedRun, diag = false) {
  const opts = diag ? { diag: ALL_DIAG } : {}
  const full = replayTo(p, { kind: 'terminal' }, opts)
  expect(full.kind).toBe('complete')
  if (full.kind !== 'complete') throw new Error('terminal')
  const end = full.result.completion.coverage.completedTicks
  const frames = [0, Math.min(1, end), Math.floor(end / 3), Math.floor(end * 2 / 3), end]
  const snaps = snapshotsAt(p, frames, opts)
  if (!snaps.ok) throw new Error(JSON.stringify(snaps.error))
  for (const snap of snaps.value) {
    const resumed = resumeFrom(p, JSON.parse(JSON.stringify(snap)), { kind: 'terminal' }, opts)
    if (!resumed.ok || resumed.value.kind !== 'complete') throw new Error('resume')
    expect(canonicalJson(resumed.value.result), `result at ${snap.frame}`).toBe(canonicalJson(full.result))
    expect(canonicalJson(viewOf(resumed.value.state)), `state at ${snap.frame}`).toBe(canonicalJson(viewOf(full.state)))
  }
}

describe('DD-10 快照', () => {
  test('C10-1/2/4 合成轴、全诊断、JSON 往返', () => { verify(fixture()); verify(fixture(), true) })
  test('七种停止路径与相位边界恢复：上限边界不多走一帧', () => {
    for (const name of BOUNDARY_CASES) {
      const p = boundaryRun(name)
      if (runPrepared(p).completion.coverage.initCompleted) verify(p, true)
      else expect(snapshotAt(p, 0)).toMatchObject({ ok: false, error: { code: 'noLegalState' } })
    }
  })
  test('C10-3 抽样与操作延迟的 RNG 连续', () => verify(fixture(true), true))
  test('C10-10 S[0] 初始化生成判定保留业务链，恢复不再次初始化', () => {
    let initialized = 0
    const X = action({ id: 'X', endFrame: 30, judgments: [judgment({ name: 'spawned', spawnFrame: null })] })
    const data = synthData([{ name: '甲', actions: [X], hooks: {
      onResolve(ctx) { initialized++; ctx.addResource('concerto', 1) },
      onEvent(ctx, ev) { if (ev.type === 'resource' && ev.char === '甲') ctx.spawnJudgment('spawned') },
    } }, idle('乙'), idle('丙')])
    const sc = ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 X'], options: { tuneBreak: 'off' } })
    const p = preparedScenario(sc, data), opts = { diag: ALL_DIAG }
    const full = runPrepared(p, opts)
    const snap = snapshotAt(p, 0, opts)
    if (!snap.ok) throw new Error('snapshot')
    const before = initialized
    const r = resumeFrom(p, JSON.parse(JSON.stringify(snap.value)), { kind: 'terminal' }, opts)
    expect(initialized).toBe(before)
    if (!r.ok || r.value.kind !== 'complete') throw new Error('resume')
    expect(canonicalJson(r.value.result)).toBe(canonicalJson(full))
    expect(r.value.result.log.some(e => e.type === 'hit' && e.f === 0)).toBe(true)
    const long = preparedScenario({ ...sc, options: { ...sc.options, repeat: 80 } }, data)
    const cache = new MemorySnapshotCache()
    expect(stateAt(long, 601, { cache }).ok).toBe(true)
    const afterCold = initialized
    expect(stateAt(long, 1201, { cache }).ok).toBe(true)
    expect(initialized).toBe(afterCold) // 跨缓存间隔也不能从头重跑
    expect(cache.get(long.runId, 1201)!.frame).toBe(1200)
  })
  test('C10-10 S[0] spawned 丢失会改变连锁深度阈值判断', () => {
    // DD-10 §3.1 / DF-22：初始化 resource(depth 0) → spawned hit(1) → heal(2)。
    // 上限为 1：初始化合法，但第 0 帧 P4 必须报 chainDepth。
    const X = action({ id: 'X', endFrame: 30, judgments: [judgment({ name: 'spawned', spawnFrame: null })] })
    const data = synthData([{ name: '甲', actions: [X], hooks: {
      onResolve(ctx) { ctx.addResource('concerto', 1) },
      onEvent(ctx, ev) {
        if (ev.type === 'resource' && ev.char === '甲') ctx.spawnJudgment('spawned')
        if (ev.type === 'hit' && ev.char === '甲') ctx.heal('chain-threshold')
      },
    } }, idle('乙'), idle('丙')])
    const sc = ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 X'], options: { tuneBreak: 'off' } })
    const p = preparedScenario(sc, data, { rules: { maxChainDepth: 1 } })
    for (const opts of [{}, { diag: ALL_DIAG }]) {
      const full = replayTo(p, { kind: 'terminal' }, opts)
      if (full.kind !== 'complete') throw new Error('terminal')
      expect(full.result.completion).toMatchObject({ status: 'engineError', engineError: { code: 'chainDepth' } })
      expect(full.result.error).toMatchObject({ code: 'chainDepth', frame: 0 })
      const snap = snapshotAt(p, 0, opts)
      if (!snap.ok) throw new Error('snapshot')
      const resumed = resumeFrom(p, JSON.parse(JSON.stringify(snap.value)), { kind: 'terminal' }, opts)
      if (!resumed.ok || resumed.value.kind !== 'complete') throw new Error('resume')
      expect(canonicalJson(resumed.value.result)).toBe(canonicalJson(full.result))
      expect(canonicalJson(viewOf(resumed.value.state))).toBe(canonicalJson(viewOf(full.state)))

      // 故障注入：只删除已初始化执行体的链元数据，再经真实快照入口保存。
      const { x } = runToExecution(p, { ...opts, observer: { frames: new Set([0]), onBoundary: () => 'stop' } })
      expect([...x.sim.bus.spawned.values()]).toEqual([expect.objectContaining({ depth: 1 })])
      x.sim.bus.spawned.clear()
      const broken = resumeFrom(p, JSON.parse(JSON.stringify(captureSnapshot(p, x, opts))), { kind: 'terminal' }, opts)
      if (!broken.ok || broken.value.kind !== 'complete') throw new Error('resume')
      expect(broken.value.result.error).toBeUndefined()
      expect(broken.value.result.completion.status).not.toBe('engineError')
      expect(canonicalJson(broken.value.result)).not.toBe(canonicalJson(full.result))
    }
  })
  test('C10-5 身份与诊断不一致拒绝', () => {
    const p = fixture(), snap = snapshotAt(p, 1)
    if (!snap.ok) throw new Error('snapshot')
    expect(resumeFrom(fixture(true), snap.value, { kind: 'terminal' })).toMatchObject({ ok: false, error: { code: 'runIdMismatch' } })
    expect(resumeFrom(p, snap.value, { kind: 'terminal' }, { diag: ALL_DIAG })).toMatchObject({ ok: false, error: { code: 'unsupported' } })
    // 载荷损坏：返回查询错误，不往外抛（Antigravity 审查 M2）
    const broken = { ...snap.value, payload: { data: { view: 'x' }, schema: { kind: 'object', fields: { view: { kind: 'map' } } } } }
    expect(resumeFrom(p, broken, { kind: 'terminal' })).toMatchObject({ ok: false, error: { code: 'unsupported', what: expect.stringContaining('快照载荷解码失败') } })
    expect(resumeFrom(p, { ...snap.value, payload: null }, { kind: 'terminal' })).toMatchObject({ ok: false, error: { code: 'unsupported' } })
  })
  test('C10-9 非空队列与非边界拒绝', () => {
    const p = fixture()
    const { x } = runToExecution(p, { observer: { frames: new Set([1]), onBoundary: () => 'stop' } })
    x.sim.bus.cursor--
    expect(() => captureSnapshot(p, x)).toThrow('bookkeeping')
    x.sim.bus.cursor++
    x.k.at.phase = 'P2'
    expect(() => captureSnapshot(p, x)).toThrow('boundary')
  })
  test('C10-11 action / last / combo 同实例别名恢复', () => {
    const p = fixture(), snap = snapshotAt(p, 1)
    if (!snap.ok) throw new Error('snapshot')
    const r = resumeFrom(p, JSON.parse(JSON.stringify(snap.value)), { kind: 'boundary', frame: 1 })
    if (!r.ok) throw new Error('resume')
    const c = r.value.state.chars[0]
    expect(c.action).not.toBeNull()
    expect(c.action).toBe(c.last)
    expect(c.action).toBe(c.combo)
  })
  test('诊断关着拍的快照恢复到 evaluation 停止点：求值序号接得上，与从头跑停在同一帧、同一状态（DD-07 §4.4、DD-10 §3.1；Codex 审查 F5）', () => {
    // wait 30 的每一帧都是一次真实求值：第 10 次在第 10 帧。改之前诊断关着时不计数，从 S[5] 恢复的停在第 15 帧
    const X = action({ id: 'X', endFrame: 10 })
    const data = synthData([{ name: '甲', actions: [X] }, idle('乙'), idle('丙')])
    const sc = ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['wait 30', '甲 X'], options: { tuneBreak: 'off' } })
    const p = preparedScenario(sc, data)
    const direct = replayTo(p, { kind: 'evaluation', evaluationIndex: 10 })
    if (direct.kind !== 'prefix') throw new Error('direct')
    expect(direct.state.frame).toBe(10)
    for (const at of [1, 5, 9]) {
      const snap = snapshotAt(p, at)
      if (!snap.ok) throw new Error('snapshot')
      const r = resumeFrom(p, JSON.parse(JSON.stringify(snap.value)), { kind: 'evaluation', evaluationIndex: 10 })
      if (!r.ok || r.value.kind !== 'prefix') throw new Error(`resume from ${at}`)
      expect([at, r.value.state.frame]).toEqual([at, 10])
      expect(canonicalJson(viewOf(r.value.state))).toBe(canonicalJson(viewOf(direct.state)))
    }
  })
  test('C10-6 缓存状态与无缓存逐帧相同，缓存副本不可污染', () => {
    const p = fixture(), cache = new MemorySnapshotCache()
    for (let f = 1; f <= 100; f++) expect(stateAt(p, f, { cache })).toEqual(stateAt(p, f))
    const snap = cache.get(p.runId, 100)!
    ;(snap as { frame: number }).frame = 999
    expect(cache.get(p.runId, 100)!.frame).toBe(0)
  })
})

dataDescribe('DD-10 真实轴快照', () => {
  for (const name of ['m0-video-eq', 'xin-tower4-video']) test(name, async () => {
    const sc = ScenarioSchema.parse(parse(readFileSync(`scenarios/${name}.yaml`, 'utf8')))
    const p = preparedScenario(sc, await loadGameData())
    verify(p)
    verify(p, true)
  }, 120000)
})
