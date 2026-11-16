// DD-04 C04-4b～C04-16：合成轴验证分类、组合、失败覆盖与时刻对照。
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { loadGameData } from '../src/data/load'
import { classifyCandidates, compareOutcome, pathConflict, runCandidateReport, scenarioFeatures } from '../src/engine/candidates'
import { canonicalJson } from '../src/engine/digest'
import { PROPOSITIONS, type Binding, type Proposition } from '../src/engine/propositions'
import { prepareRun, runPrepared } from '../src/engine/run'
import { candidateMarkdown } from '../src/report/candidates'
import { action, judgment, dataDescribe } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

const sc = (extra: Partial<ScenarioInput> = {}) => ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
  rotation: ['甲 E'], options: { tuneBreak: 'manual', repeat: 5, maxFrames: 2000, maxWait: 60 }, ...extra,
})
const actor: SynthChar = { name: '甲', actions: [action({ id: 'E', endFrame: 1, cooldown: 30, judgments: [judgment({ name: 'hit', spawnFrame: 0, multiplier: 1 })] })] }
const dataOf = (c: SynthChar = actor) => synthData([c, idle('乙'), idle('丙')])
function prop(id: string, path: string, value: boolean): Proposition {
  return { id, proposition: id, scope: 'shared', adopted: 'base', candidatesExhaustive: true, evidence: [], conclusion: 'unverified', impact: { dps: 'unknown' },
    candidates: [
      { id: 'base', label: 'base', changes: 'mechanism', implemented: true, binding: { kind: 'rule', path, value: !value } },
      { id: 'flip', label: 'flip', changes: 'mechanism', implemented: true, binding: { kind: 'rule', path, value } },
    ] }
}
function prepared(s = sc(), data = dataOf()) {
  const p = prepareRun(s, data)
  if (!p.ok) throw new Error(JSON.stringify(p.issues))
  return p.run
}
const A = prop('A', 'defFloor', true), B = prop('B', 'echoInputPriority', false)

describe('候选分类与冲突', () => {
  test('C04-4b 旧共享开关 false：当前是 clear，检查 keep', () => {
    const data = synthData([idle('心'), idle('卜灵'), idle('丙')])
    const s = sc({ team: ['心', '卜灵', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), rotation: ['wait 1'], options: { rules: { forteKeepOnSwitch: false } } })
    const plan = classifyCandidates(prepared(s, data), PROPOSITIONS)
    expect(plan.mechanism.filter(c => c.propositionId.startsWith('forte-keep.')).map(c => c.candidateId)).toEqual(['keep', 'keep'])
  })
  test('C04-5 严格、手写谐破：冲突先于类别，不适用与未实现单列', () => {
    const data = dataOf({ name: '甲', actions: [action({ id: 'TB', kind: 'tuneBreak' })] })
    const p = prepared(sc({ rotation: ['甲 TB'], options: { strict: true, tuneBreak: 'manual' } }), data)
    expect([...scenarioFeatures(p)]).toEqual(['strictEntry', 'hasManualTuneBreak'])
    const unimplemented: Proposition = { ...A, id: 'unimplemented', candidates: [...A.candidates, { id: 'missing', label: 'missing', changes: 'mechanism', implemented: false, binding: { kind: 'unimplemented' } }] }
    const plan = classifyCandidates(p, [...PROPOSITIONS, unimplemented])
    expect(plan.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidates: [{ propositionId: 'tune-break-mode', candidateId: 'auto' }], reason: 'strictEntry' }),
      expect.objectContaining({ candidates: [{ propositionId: 'tune-break-mode', candidateId: 'off' }], reason: 'hasManualTuneBreak' }),
    ]))
    expect(plan.policy.some(c => c.propositionId === 'input-delay')).toBe(true)
    expect(plan.notApplicable.some(c => c.propositionId === 'track-no-consume')).toBe(true)
    expect(plan.unimplemented).toContainEqual({ propositionId: 'unimplemented', candidateId: 'missing' })
  })
  test('C04-6 同路径不同值、父子路径冲突；不同 kind 与同值不冲突', () => {
    const a: Binding = { kind: 'rule', path: 'a.b', value: true }
    expect(pathConflict(a, { ...a, value: false })).not.toBeNull()
    expect(pathConflict(a, { ...a, path: 'a' })).not.toBeNull()
    expect(pathConflict(a, { ...a, kind: 'option' })).toBeNull()
    expect(pathConflict(a, a)).toBeNull()
    expect(pathConflict(a, { ...a, path: 'a.bc' })).toBeNull()
  })
})

describe('运行与覆盖', () => {
  test('C04-7 / C04-10 断轴与引擎错误都不删行，只有后者不算已检查', () => {
    const data = dataOf({ ...actor, hooks: { canStart(ctx) {
      if (!ctx.rules.echoInputPriority) throw new Error('synthetic hook error')
      return ctx.rules.defFloor ? '永远不满足' : true
    } } })
    const r = runCandidateReport(sc(), data, { pairs: true, ledger: [A, B] })
    expect(r.mechanismOutcomes).toHaveLength(3)
    expect(r.mechanismOutcomes[0]).toMatchObject({ status: 'axisFailed', completion: { axisFailure: { kind: 'timeout' } } })
    expect(r.mechanismOutcomes[1]).toMatchObject({ status: 'engineError' })
    expect(r.coverage).toMatchObject({ singlesPlanned: 2, singlesRun: 1, pairsPlanned: 1, pairsRun: 0, axisFailedCount: 1, engineErrorCount: 2 })
  })
  test('C04-8 单项日志相同仍跑两两：两道门槛只有同时放宽才变快', () => {
    const data = dataOf({ ...actor, actions: [action({ id: 'E', endFrame: 1, judgments: actor.actions[0]!.judgments })], vars: { last: -30 }, hooks: {
      onEvent(ctx, e) { if (e.type === 'actionStart' && e.char === '甲') ctx.vars.last = ctx.state.battleFrames },
      canStart(ctx) { const since = ctx.state.battleFrames - Number(ctx.vars.last)
        return since < (ctx.rules.defFloor ? 15 : 30) || since < (ctx.rules.echoInputPriority ? 30 : 15) ? '双门槛' : true },
    } })
    const r = runCandidateReport(sc(), data, { pairs: true, ledger: [A, B] })
    expect(r.mechanismOutcomes.map(o => o.loopTime)).toEqual(['same', 'same', 'changed'])
    expect(r.mechanismOutcomes.slice(0, 2).every(o => o.identicalLog)).toBe(true)
  })
  test('C04-9 同一命题的两个候选不组成一对；不兼容对被排除', () => {
    const other: Proposition = { ...A, id: 'other', candidates: [{ ...A.candidates[1]!, id: 'same' }] }
    const r = runCandidateReport(sc(), dataOf(), { pairs: true, ledger: [A, { ...A, candidates: [...A.candidates, { ...A.candidates[1]!, id: 'another' }] }, other] })
    expect(r.mechanismOutcomes.filter(o => o.candidates.length === 2).every(o => o.candidates[0]!.propositionId !== o.candidates[1]!.propositionId)).toBe(true)
  })
  test('两两运行前重新检查合并后的特征，并排除路径值冲突', () => {
    const auto: Proposition = { ...A, id: 'auto-data', candidates: [{ ...A.candidates[1]!, binding: { kind: 'option', path: 'tuneBreak', value: 'auto' } }] }
    const conflict: Proposition = { ...B, candidates: [{ ...B.candidates[1]!, conflictsWith: ['hasAutoTuneBreak'] }] }
    const delay = (n: number): Proposition => ({ ...A, id: `delay-${n}`, candidates: [{ ...A.candidates[1]!, binding: { kind: 'option', path: 'inputDelay', value: n } }] })
    const r = runCandidateReport(sc(), dataOf(), { pairs: true, ledger: [auto, conflict, delay(6), delay(12)] })
    expect(r.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidates: [{ propositionId: 'auto-data', candidateId: 'flip' }, { propositionId: 'B', candidateId: 'flip' }], reason: 'hasAutoTuneBreak' }),
      expect.objectContaining({ reason: '路径 inputDelay 的值不同' }),
    ]))
    expect(r.coverage).toMatchObject({ singlesPlanned: 4, pairsPlanned: 4 })
  })
  test('C04-12 报告完整可重复，包括对照 runId', () => {
    const data = dataOf(), s = sc()
    expect(canonicalJson(runCandidateReport(s, data, { pairs: true, ledger: [A, B] }))).toBe(canonicalJson(runCandidateReport(s, data, { pairs: true, ledger: [A, B] })))
  })
  test('C04-15 小于窗口幅度也必须标 changed；不同稳态轮次不可比', () => {
    const base = runPrepared(prepared()), other = structuredClone(base)
    base.summary.steady!.dps = 100000; base.summary.steady!.spread = 0.02
    other.summary.steady!.dps = 101000
    expect(compareOutcome(base, other).dps).toMatchObject({ status: 'changed', delta: 1000, withinWindowVariation: true })
    expect(compareOutcome(base, other).dps.ratio).toBeCloseTo(0.01)
    other.summary.steady!.from++
    expect(compareOutcome(base, other).loopTime).toBe('notComparable')
  })
})

describe('口径参考（合成数据）', () => {
  test('C04-13/16 启动轴与稳态同窗计算占比，参考不计主表', () => {
    const data = dataOf({ name: '甲', actions: [
      action({ id: 'E', endFrame: 20, judgments: [judgment({ name: 'hit', gauges: { toughness: 0, tunability: 100 } })] }),
      action({ id: '大伤害', endFrame: 20, judgments: [judgment({ name: 'opening', multiplier: 100 })] }),
      action({ id: 'TB', kind: 'tuneBreak', endFrame: 10, priority: [{ fromFrame: 0, value: 11 }], judgments: [judgment({ name: 'tb', tags: ['谐度破坏'], multiplier: 1 })] }),
    ] })
    data.characters['甲']!.tunabilityRate = 1
    data.tuneBreak = { variants: [], baseByLevel: Array(100).fill(10000), costFactor: { 1: 1, 3: 1, 4: 1 }, rules: { lockFrames: { 1: 1, 3: 1, 4: 1 }, buttonFrames: 180 } }
    const s = sc({ opening: ['甲 大伤害'], rotation: ['甲 E', '甲 E'], enemy: { custom: { level: 90, tunabilityMax: 100 } },
      options: { strict: true, tuneBreak: 'off', repeat: 5 }, tuneBreakOmitted: { reason: 'sourceSilent' } })
    const r = runCandidateReport(s, data, { pairs: true, ledger: PROPOSITIONS.filter(p => p.id === 'tune-break-mode') })
    expect(r.coverage.singlesPlanned + r.coverage.pairsPlanned).toBe(0)
    expect(r.policyTrials[0]!.candidates[0]!.candidateId).toBe('manual')
    expect(r.scopeReference!.tuneBreakDamageShare.steady).toBeGreaterThan(0)
    expect(r.scopeReference!.tuneBreakDamageShare.steady).not.toEqual(r.scopeReference!.tuneBreakDamageShare.wholeWindow)
  })
})

describe('时刻对照', () => {
  test('C04-11 冷却等待决定轮长；后面更长的门槛吸收另一个决策点的延迟', () => {
    const data = dataOf({ ...actor, actions: [...actor.actions, action({ id: 'F', endFrame: 1, cooldown: 10 })] })
    const r = runCandidateReport(sc({ rotation: ['甲 E', '甲 F', '甲 F', '甲 E'] }), data, { pairs: false, ledger: [] })
    expect(r.timingSensitive.length).toBeGreaterThan(0)
    expect(r.timingSensitive.every(t => t.gateConfirmed === false)).toBe(true)
    expect(r.timingAbsorbed.some(t => t.cmd.line === 3)).toBe(true)
  })
  test('C04-14 双门槛只证明指令时刻敏感，不宣称冷却为瓶颈', () => {
    const data = dataOf({ ...actor, actions: [action({ id: 'E', endFrame: 1, cooldown: 30, energyCost: 10,
      judgments: [judgment({ name: '回能', spawnFrame: 0, delayFrames: 29, gains: { energy: 10, concerto: 0, core: [0, 0, 0] } })] })] })
    const r = runCandidateReport(sc({ rotation: ['甲 E', '甲 E'], initial: { energy: [10, 0, 0] } }), data, { pairs: false, ledger: [] })
    expect(r.timingSensitive.some(t => t.cmd.line === 2 && t.recordedWaits.includes('cooldown'))).toBe(true)
    expect(candidateMarkdown(r, 'test')).not.toContain('冷却是瓶颈')
  })
})

dataDescribe('严格代表轴集成（DD-04 §8、C04-13/16）', () => {
  test('参考口径、失败保留、覆盖与重复运行', async () => {
    const data = await loadGameData()
    const s = ScenarioSchema.parse(parse(readFileSync('scenarios/m0-video-eq-不打谐破.yaml', 'utf8')))
    const r = runCandidateReport(s, data, { pairs: true })
    expect(r.baseline.status).toBe('completed')
    expect(r.baseline.damageScope.tuneBreak).toMatchObject({ mode: 'omitted', reason: 'sourceSilent' })
    expect(r.policyTrials.map(o => o.candidates[0]!.candidateId)).toContain('manual')
    expect(r.excluded.some(x => x.reason === 'strictEntry')).toBe(true)
    expect(r.scopeReference!.tuneBreakDamageShare.steady).toBeGreaterThan(0)
    expect(r.scopeReference!.tuneBreakDamageShare.steady).not.toEqual(r.scopeReference!.tuneBreakDamageShare.wholeWindow)
    expect(r.scopeReference!.runId).not.toBe(r.baseline.runId)
    expect(r.mechanismOutcomes).toHaveLength(r.coverage.singlesPlanned + r.coverage.pairsPlanned)
    expect(r.coverage.higherOrderChecked).toBe(false)
    const p = prepared(s, data)
    expect(canonicalJson(runPrepared(p).log)).toBe(canonicalJson(runPrepared(p).log))
  }, 120000)
})
