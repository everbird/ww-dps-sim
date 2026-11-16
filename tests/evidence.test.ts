// tests/evidence.test.ts —— DD-08 §4 的证据闭环：候选级判断与决策表（C08-7、C08-13～C08-16、C08-19～C08-22）、登记与过期（C08-17）、
// 采用前后的重跑（C08-10、C08-18）、区分度（C08-8）、实验要先登记（C08-9）、predict 两次结果相同（C08-12）。合成数据，不依赖 data/generated。
import { describe, expect, test } from 'vitest'
import { ObservationSchema, type Observation } from '../src/data/calibration.schema'
import { ClosureRecordSchema, type ClosureRecord, type ClosureRecordInput } from '../src/data/evidence.schema'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { closureText, parseClosure } from '../src/cli/evidence-file'
import { canonicalJson } from '../src/engine/digest'
import {
  distinguishability, EvidenceError, evidenceFromClosure, evidenceViolations, judgeClosure, predictClosure, registerClosure, rerunClosure,
  verifyPredictions, type EvidenceContext,
} from '../src/engine/evidence'
import type { Candidate, Proposition } from '../src/engine/propositions'
import { evidenceTable, summarizeClosure, CONCLUSION_LABEL } from '../src/report/evidence'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

// ---------------------------------------------------------------------------
// 只比冻结预测的合成闭环（不跑仿真）

/** 合成命题：候选都按 defFloor 绑定（不跑仿真时用不到）；unimplemented 的绑定 unimplemented */
function prop(cands: readonly (string | { id: string; implemented: false })[], o: { adopted?: string; exhaustive?: boolean } = {}): Proposition {
  const adopted = o.adopted ?? 'A'
  const candidates: Candidate[] = cands.map(c => typeof c === 'string'
    ? { id: c, label: c, implemented: true, changes: 'mechanism', binding: { kind: 'rule', path: 'defFloor', value: c !== adopted } }
    : { id: c.id, label: c.id, implemented: false, changes: 'mechanism', binding: { kind: 'unimplemented' } })
  return {
    id: 'syn', proposition: '合成命题', scope: 'shared', adopted, candidatesExhaustive: o.exhaustive ?? false, candidates,
    evidence: [], conclusion: 'unverified', impact: { dps: 'unknown' },
  }
}
/** 间隔观测（帧，容差绝对）：game 是读数，tol 是容差 */
const interval = (id: string, game: number, tol: number, purpose = 'independent_validation'): Observation => ObservationSchema.parse({
  id, record: 'syn.md', scenario: 'syn.yaml', kind: 'interval', clock: 'world', from: { type: 'actionStart' }, to: { type: 'switch' },
  game, tolerance: tol, purpose, condition: { gameVersion: '3.7', note: '合成' },
})
type Pred = number | null | { predicted: number | null; covered: boolean; reason?: string }
/** 合成记录：一个 setup，各候选在各观测上的预测；status 是各候选运行的状态 */
function record(obs: readonly Observation[], preds: Record<string, Record<string, Pred> | 'unimplemented'>, x: Partial<ClosureRecordInput> & { status?: Record<string, 'completed' | 'truncated' | 'axisFailed' | 'engineError'> } = {}): ClosureRecord {
  const { status, ...rest } = x
  return ClosureRecordSchema.parse({
    id: 'syn.case', propositionId: 'syn', question: '合成', kind: 'backfill', setups: [{ id: 'S', scenario: 'syn.yaml' }],
    candidates: Object.entries(preds).map(([candidateId, ps]) => ({
      candidateId, conditions: `${candidateId} 的条件`,
      runs: ps === 'unimplemented' ? [] : [{ setupId: 'S', runId: `run-${candidateId}`, status: status?.[candidateId] ?? 'completed' }],
      predictions: ps === 'unimplemented' ? [] : Object.entries(ps).map(([observationId, v]) =>
        v !== null && typeof v === 'object' ? { observationId, ...v } : { observationId, predicted: v, covered: v !== null }),
    })),
    criteria: '合成判据', observationIds: obs.map(o => o.id), scopeTested: '合成', ...rest,
  })
}
const judge = (r: ClosureRecord, p: Proposition, obs: readonly Observation[]) => judgeClosure(r, p, obs)
/** 三处一致（DD-08 §4.1）：judge 的结论、总表重算的、台账（证据条目 + 结论）过入账约束 */
function threeWay(r: ClosureRecord, p: Proposition, obs: readonly Observation[]) {
  const j = judge(r, p, obs)
  const judged = { ...r, verdicts: j.verdicts, conclusion: j.conclusion }
  const row = summarizeClosure(judged, p, obs)
  const ledger: Proposition = { ...p, evidence: evidenceFromClosure(judged, j, p, obs), conclusion: j.conclusion.proposition }
  expect(row.consistent).toBe(true)
  expect(row.conclusion).toEqual(j.conclusion)
  expect(evidenceTable([row])).toContain(CONCLUSION_LABEL[j.conclusion.proposition])
  expect(evidenceViolations(ledger)).toEqual([])
  return { j, ledger }
}

describe('候选级判断与决策表（DD-08 §4.1；DF-16）', () => {
  test('C08-7 两个候选、观测只与采用的 A 相容：标 independent_validation → supported（第 4 行）；同一组数值标 selection → provisional；decision 都没被自动填', () => {
    const p = prop(['A', 'B'])
    for (const [purpose, want] of [['independent_validation', 'supported'], ['selection', 'provisional']] as const) {
      const obs = [interval('O1', 100, 1, purpose)]
      const r = record(obs, { A: { O1: 100 }, B: { O1: 130 } })
      const { j } = threeWay(r, p, obs)
      expect(j.verdicts.map(v => [v.candidateId, v.overall])).toEqual([['A', 'consistent'], ['B', 'inconsistent']])
      expect(j.conclusion).toMatchObject({ proposition: want, about: 'A', rule: 4 })
      expect(j.conclusion.basis.excludedBy).toEqual({ B: purpose === 'selection' ? { independent: [], other: ['O1'] } : { independent: ['O1'], other: [] } })
      expect(j.relations[0]).toMatchObject({ supports: ['A'], refutes: ['B'], consistentWith: [] })
      expect('decision' in j).toBe(false)
      expect(r.decision).toBeUndefined()
    }
  })

  test('C08-13 采用 A，独立观测只和 B 相容 → refuted、about A、suggests [B]（第 7 行）', () => {
    const obs = [interval('O1', 100, 1)]
    const { j } = threeWay(record(obs, { A: { O1: 130 }, B: { O1: 100 } }), prop(['A', 'B']), obs)
    expect(j.conclusion).toEqual({ proposition: 'refuted', about: 'A', basis: { independent: ['O1'], other: [] }, rule: 7, suggests: ['B'] })
  })

  test('C08-14 A 相容；B 未实现，或 B 的运行在观测之前就截断了 → 都是 provisional（第 5 行），B notAssessed，原因各是 unimplemented、noCoveredObservation', () => {
    const obs = [interval('O1', 100, 1)]
    const un = threeWay(record(obs, { A: { O1: 100 }, B: 'unimplemented' }), prop(['A', { id: 'B', implemented: false }]), obs).j
    const cut = threeWay(record(obs, { A: { O1: 100 }, B: { O1: { predicted: null, covered: false, reason: '截断' } } }, { status: { B: 'truncated' } }), prop(['A', 'B']), obs).j
    for (const [j, why] of [[un, 'unimplemented'], [cut, 'noCoveredObservation']] as const) {
      expect(j.conclusion).toMatchObject({ proposition: 'provisional', about: 'A', rule: 5 })
      expect(j.conclusion.basis).toEqual({ independent: ['O1'], other: [] })     // 其余全是 notAssessed：列与 A 相容的观测
      expect(j.verdicts[1]).toMatchObject({ candidateId: 'B', overall: 'notAssessed', notAssessedReason: why })
    }
    expect(cut.verdicts[1]!.runStatuses).toEqual(['truncated'])
  })

  test('C08-15 一条覆盖范围以内的观测加一条截断之后才发生的：后者 covered: false，不算不相容，也不抹掉前者的预测；结论只由前者定', () => {
    const obs = [interval('O1', 100, 1), interval('O2', 50, 1)]
    const r = record(obs, { A: { O1: 100, O2: 50 }, B: { O1: 130, O2: { predicted: null, covered: false, reason: '运行在那之前截断' } } }, { status: { B: 'truncated' } })
    const { j } = threeWay(r, prop(['A', 'B']), obs)
    const b = j.verdicts.find(v => v.candidateId === 'B')!
    expect(b.perObservation).toEqual([
      { observationId: 'O1', status: 'conflicted', residual: 30, purpose: 'independent_validation', covered: true },
      { observationId: 'O2', status: 'unmatched', residual: null, purpose: 'independent_validation', covered: false },
    ])
    expect(b.overall).toBe('inconsistent')
    expect(j.conclusion).toMatchObject({ proposition: 'supported', rule: 4, basis: { excludedBy: { B: { independent: ['O1'], other: [] } } } })
    expect(j.relations.find(x => x.observationId === 'O2')).toMatchObject({ compatible: ['A'], conflicting: [], consistentWith: ['A'] })
  })

  test('C08-16 所有候选都相容 → ambiguous（第 3 行）；没填 discriminatingObservationNeeded 时校验失败', () => {
    const obs = [interval('O1', 100, 3)]
    const r = record(obs, { A: { O1: 100 }, B: { O1: 102 } })
    const { j } = threeWay({ ...r, discriminatingObservationNeeded: '合成：再测一条' }, prop(['A', 'B']), obs)
    expect(j.conclusion).toMatchObject({ proposition: 'ambiguous', about: 'A', rule: 3, basis: { independent: ['O1'], other: [] } })
    const judged = { ...r, verdicts: j.verdicts, conclusion: j.conclusion }
    expect(ClosureRecordSchema.safeParse(judged).success).toBe(false)
    expect(ClosureRecordSchema.safeParse({ ...judged, discriminatingObservationNeeded: '训练场逐帧读' }).success).toBe(true)
  })

  test('C08-19 混合用途：旧 selection 观测排除 B，新 independent 观测两者都相容 → 仍采用 A、provisional，excludedBy.B 只有选模观测；新观测改成明确排斥 B 后才 supported', () => {
    const p = prop(['A', 'B'])
    const obs = [interval('Osel', 100, 1, 'selection'), interval('Oind', 102, 3)]
    const weak = threeWay(record(obs, { A: { Osel: 100, Oind: 100 }, B: { Osel: 130, Oind: 104 } }), p, obs).j
    expect(weak.conclusion).toMatchObject({ proposition: 'provisional', about: 'A', rule: 4 })
    expect(weak.conclusion.basis.excludedBy).toEqual({ B: { independent: [], other: ['Osel'] } })
    expect(weak.relations.find(x => x.observationId === 'Oind')).toMatchObject({ supports: [], consistentWith: ['A', 'B'] })
    const strong = threeWay(record(obs, { A: { Osel: 100, Oind: 100 }, B: { Osel: 130, Oind: 110 } }), p, obs).j
    expect(strong.conclusion).toMatchObject({ proposition: 'supported', rule: 4, basis: { excludedBy: { B: { independent: ['Oind'], other: ['Osel'] } } } })
  })

  test('C08-20 候选 A、B，一条独立观测反驳 A、与 B 相容（第 7 行）→ refuted、suggests [B]，basis.independent 含这条观测', () => {
    const obs = [interval('O1', 200, 2), interval('O2', 50, 1, 'selection')]
    const { j } = threeWay(record(obs, { A: { O1: 190, O2: 50 }, B: { O1: 200, O2: 50 } }), prop(['A', 'B']), obs)
    expect(j.conclusion).toEqual({ proposition: 'refuted', about: 'A', basis: { independent: ['O1'], other: [] }, rule: 7, suggests: ['B'] })
  })

  test('C08-21 只登记候选 A：candidatesExhaustive 真 / 假 × independent / selection，观测都与 A 相容 → 四种都是 provisional（第 6 行），consistentWith [A]、supports []，basis 不为空，三处一致', () => {
    for (const exhaustive of [true, false]) for (const purpose of ['independent_validation', 'selection'] as const) {
      const obs = [interval('O1', 100, 1, purpose)]
      const p = prop(['A'], { exhaustive })
      const { j, ledger } = threeWay(record(obs, { A: { O1: 100 } }), p, obs)
      expect(j.conclusion).toMatchObject({ proposition: 'provisional', about: 'A', rule: 6 })
      expect(j.conclusion.basis.independent.length + j.conclusion.basis.other.length).toBe(1)
      expect(j.conclusion.basis.excludedBy).toBeUndefined()
      expect(j.relations[0]).toMatchObject({ supports: [], refutes: [], consistentWith: ['A'] })
      expect(ledger.evidence.map(e => [e.supports, e.consistentWith, e.purpose])).toEqual([[[], ['A'], purpose]])
    }
  })

  test('C08-22 只登记候选 A，一条独立观测与它冲突（第 8 行）：candidatesExhaustive 为真时 conflicted、为假时 outOfScope；basis.independent 含这条观测', () => {
    const obs = [interval('O1', 100, 1)]
    for (const [exhaustive, want] of [[true, 'conflicted'], [false, 'outOfScope']] as const) {
      const { j } = threeWay(record(obs, { A: { O1: 120 } }), prop(['A'], { exhaustive }), obs)
      expect(j.conclusion).toEqual({ proposition: want, about: 'A', basis: { independent: ['O1'], other: [] }, rule: 8 })
    }
  })

  test('第 1、2、9 行与 given 不参与判断', () => {
    // A 没覆盖到任何观测：别的候选也都没评估 → 第 1 行；B 可评估 → 第 2 行
    const obs = [interval('O1', 100, 1)]
    const none = { predicted: null, covered: false, reason: '截断' } as const
    expect(judge(record(obs, { A: { O1: none }, B: 'unimplemented' }, { status: { A: 'truncated' } }), prop(['A', { id: 'B', implemented: false }]), obs).conclusion)
      .toEqual({ proposition: 'unverified', about: null, basis: { independent: [], other: [] }, rule: 1 })
    expect(judge(record(obs, { A: { O1: none }, B: { O1: 100 } }, { status: { A: 'truncated' } }), prop(['A', 'B']), obs).conclusion)
      .toMatchObject({ proposition: 'unverified', about: 'A', rule: 2 })
    // A 不相容，其余没有相容的、有没评估的 → 第 9 行
    expect(judge(record(obs, { A: { O1: 120 }, B: 'unimplemented' }), prop(['A', { id: 'B', implemented: false }]), obs).conclusion)
      .toMatchObject({ proposition: 'refuted', about: 'A', rule: 9, basis: { independent: ['O1'] } })
    // given 的观测是输入：与 A 冲突也不算
    const given = [interval('G', 100, 1, 'given'), interval('O1', 100, 1)]
    const g = judge(record(given, { A: { G: 999, O1: 100 }, B: { G: 100, O1: 100 } }), prop(['A', 'B']), given)
    expect(g.verdicts.map(v => v.overall)).toEqual(['consistent', 'consistent'])
    expect(g.relations.map(r => r.observationId)).toEqual(['O1'])
    // engineError 的运行作废：它的观测都不算
    const err = judge(record(obs, { A: { O1: 100 }, B: { O1: 130 } }, { status: { B: 'engineError' } }), prop(['A', 'B']), obs)
    expect(err.verdicts[1]).toMatchObject({ overall: 'notAssessed', notAssessedReason: 'engineError' })
    expect(err.conclusion).toMatchObject({ proposition: 'provisional', rule: 5 })
  })

  test('C08-8 两个候选在全部观测上预测相同：区分度检查报"可能区分不了"；judge 后对两者都是 consistentWith，结论 ambiguous', () => {
    const obs = [interval('O1', 100, 1), interval('O2', 60, 1)]
    const r = record(obs, { A: { O1: 100, O2: 60 }, B: { O1: 100, O2: 60 } })
    const check = distinguishability(r, obs)
    expect(check.anySeparable).toBe(false)
    expect(check.lines.join('\n')).toContain('可能区分不了')
    expect(check.lines.at(-1)).toContain('都区分不了')
    const j = judge(r, prop(['A', 'B']), obs)
    expect(j.relations.map(x => x.consistentWith)).toEqual([['A', 'B'], ['A', 'B']])
    expect(j.conclusion).toMatchObject({ proposition: 'ambiguous', rule: 3 })
    // 接受区间不重叠才"可区分"：A 100、B 103，容差 ±1 → 可区分；±2 → 重叠
    expect(distinguishability(record([interval('O1', 100, 1)], { A: { O1: 100 }, B: { O1: 103 } }), obs).anySeparable).toBe(true)
    expect(distinguishability(record([interval('O1', 100, 2)], { A: { O1: 100 }, B: { O1: 103 } }), [interval('O1', 100, 2)]).anySeparable).toBe(false)
  })

  test('C08-9 kind: experiment、没有 preRegistration → judge 拒绝运行', () => {
    const obs = [interval('O1', 100, 1)]
    expect(() => judge(record(obs, { A: { O1: 100 }, B: { O1: 130 } }, { kind: 'experiment' }), prop(['A', 'B']), obs)).toThrow(/没有登记预测/)
  })
})

// ---------------------------------------------------------------------------
// 跑仿真的合成闭环：predict / register / verify / judge / rerun

// 甲：C 10 帧，第 2 帧命中给协奏 10（onHit 时命中才给，onCast 时起手就给）；大招带 60 帧全局时停（碰到假设 dilation-rules）
const 甲 = (mult = 1): SynthChar => ({
  name: '甲',
  actions: [
    action({ id: 'C', endFrame: 10, judgments: [judgment({ name: 'c', spawnFrame: 2, multiplier: mult, gains: { energy: 0, concerto: 10, core: [0, 0, 0] } })] }),
    action({ id: '大招', kind: 'liberation', endFrame: 80, dilations: [{ type: '全局时停', anchor: 'action', start: 0, enemy: { rate: 0, duration: 30 } }] }),
  ],
})
const chars = (mult = 1): [SynthChar, SynthChar, SynthChar] => [甲(mult), idle('乙'), idle('丙')]
const scenario: Scenario = ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
  enemy: { custom: { level: 90 } }, rotation: ['甲 C', '甲 大招'],
})
/** 协奏到账时机的合成命题：onHit（采用）/ onCast，按 concertoTiming 绑定；assumptionId 让重跑找到受影响的场景 */
const timing = (adopted: 'onHit' | 'onCast' = 'onHit'): Proposition => ({
  id: 'syn-timing', proposition: '合成：协奏逐段所得按命中给', scope: 'shared', adopted, candidatesExhaustive: true, assumptionId: 'dilation-rules',
  candidates: (['onHit', 'onCast'] as const).map(v => ({ id: v, label: v, implemented: true, changes: 'mechanism' as const, binding: { kind: 'rule' as const, path: 'concertoTiming', value: v } })),
  evidence: [], conclusion: 'unverified', impact: { dps: 'unknown' },
})
/** C 命中之前甲的协奏（按 onHit 是 0，按 onCast 是 10） */
const beforeHit = (game: number | null = null, tolerance?: number): Observation => ObservationSchema.parse({
  id: 'before-c', record: 'syn.md', scenario: 'syn.yaml', kind: 'resourceAt', at: { type: 'hit', judgment: 'c' }, when: 'before',
  char: '甲', resource: 'concerto', game, purpose: 'independent_validation', ...(tolerance ? { tolerance } : {}),
})
const experiment = (): ClosureRecord => ClosureRecordSchema.parse({
  id: 'syn.exp', propositionId: 'syn-timing', question: 'C 命中之前协奏到了没有', kind: 'experiment',
  setups: [{ id: 'S', scenario: 'syn.yaml' }],
  candidates: [{ candidateId: 'onHit', conditions: '命中时给' }, { candidateId: 'onCast', conditions: '起手时给' }],
  criteria: '协奏点值，容差 1%', observationIds: ['before-c'], scopeTested: '合成',
})
const ctxOf = (o: Partial<EvidenceContext> = {}): EvidenceContext => ({
  data: synthData(chars()), scenarios: new Map([['syn.yaml', scenario]]), observations: [beforeHit()], proposition: timing(),
  environment: { gitCommit: 'abc123' }, ...o,
})

describe('predict、登记与过期（DD-08 §4.2；DF-17）', () => {
  test('C08-12 同一份闭环文件 predict 两次：记录与写出的文本都相同；预测带 runId 与状态', () => {
    const r = experiment()
    const a = predictClosure(r, ctxOf()), b = predictClosure(r, ctxOf())
    expect(canonicalJson(a.record)).toBe(canonicalJson(b.record))
    expect(a.record.candidates.map(c => [c.candidateId, c.predictions.map(p => p.predicted)])).toEqual([['onHit', [0]], ['onCast', [10]]])
    expect(a.record.candidates.every(c => c.runs.length === 1 && c.runs[0]!.status === 'completed' && c.runs[0]!.runId.startsWith('run-'))).toBe(true)
    expect(a.check.anySeparable).toBe(true)
    const yaml = `${Object.entries(r).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n`
    const { doc } = parseClosure(yaml)
    const once = closureText(doc, { candidates: a.record.candidates })
    const twice = closureText(parseClosure(once).doc, { candidates: b.record.candidates })
    expect(twice).toBe(once)
  })

  test('C08-17 登记之后只改倍率（代码变）：--verify 报"预测已过期"；只改判据的容差：judge 拒绝；只填游戏读数：正常判', () => {
    const ctx = ctxOf()
    const predicted = predictClosure(experiment(), ctx).record
    const reg = registerClosure(predicted, ctx, { date: '2026-11-16', identityPath: id => `runs/syn.json#${id}` })
    expect(reg.record.preRegistration).toMatchObject({ commit: 'abc123', date: '2026-11-16', identities: [`runs/syn.json#${predicted.candidates[0]!.runs[0]!.runId}`, `runs/syn.json#${predicted.candidates[1]!.runs[0]!.runId}`] })
    const registered = new Map(reg.files.map(f => [f.path.split('#')[1]!, f.identity]))
    // 登记过的不能再登记
    expect(() => registerClosure(reg.record, ctx, { date: 'x', identityPath: id => id })).toThrow(EvidenceError)
    // 代码没变：--verify 通过；只换了提交号：输入相同，仍有效
    expect(verifyPredictions(reg.record, ctx, registered).ok).toBe(true)
    const moved = verifyPredictions(reg.record, ctxOf({ environment: { gitCommit: 'def456' } }), registered)
    expect(moved.ok).toBe(true)
    expect(moved.lines.join('\n')).toContain('只有提交号不同')
    // ① 只改倍率（数据 / 代码变）
    const stale = verifyPredictions(reg.record, ctxOf({ data: synthData(chars(2)) }), registered)
    expect(stale.ok).toBe(false)
    expect(stale.lines.join('\n')).toContain('预测已过期')
    // ② 只改判据的容差：judge 拒绝
    expect(() => judgeClosure(reg.record, timing(), [beforeHit(0, 0.05)])).toThrow(/登记后改过/)
    // ③ 只填游戏读数：正常判（条件、说明也是读数时填的）
    const read = ObservationSchema.parse({ ...beforeHit(0), condition: { gameVersion: '3.7', recordedAt: '2026-11-20', note: '训练场' } })
    const j = judgeClosure(reg.record, timing(), [read])
    expect(j.verdicts.map(v => [v.candidateId, v.overall])).toEqual([['onHit', 'consistent'], ['onCast', 'inconsistent']])
    expect(j.conclusion).toMatchObject({ proposition: 'supported', about: 'onHit', rule: 4 })
    // 改了预测：judge 也拒绝
    const tampered = { ...reg.record, candidates: reg.record.candidates.map(c => ({ ...c, predictions: c.predictions.map(p => ({ ...p, predicted: 5 })) })) }
    expect(() => judgeClosure(tampered, timing(), [read])).toThrow(/登记后改过/)
  })

  test('登记要先 predict、工作区要干净；回填记录不登记', () => {
    const ctx = ctxOf()
    expect(() => registerClosure(experiment(), ctx, { date: 'x', identityPath: id => id })).toThrow(/先 pnpm evidence predict/)
    const predicted = predictClosure(experiment(), ctx).record
    expect(() => registerClosure(predicted, ctxOf({ environment: { gitCommit: 'abc', contentFingerprint: 'f' } }), { date: 'x', identityPath: id => id })).toThrow(/没提交的改动/)
    expect(() => registerClosure({ ...predicted, kind: 'backfill' }, ctx, { date: 'x', identityPath: id => id })).toThrow(/回填/)
  })
})

describe('采用决定之后的重跑（DD-08 §4.2 rerun；DF-17）', () => {
  const judged = (adoptedBefore: string, adopted: string, defaultChanged: boolean): ClosureRecord =>
    ({ ...predictClosure(experiment(), ctxOf()).record, decision: { adoptedBefore, adopted, defaultChanged, note: '合成' } })
  const scenarios = new Map([['syn.yaml', scenario]])

  test('C08-10 defaultChanged: false：每个场景 changed === false；人为让它变了时报问题（命令以非零退出）', () => {
    const same = rerunClosure(judged('onHit', 'onHit', false), timing('onHit'), synthData(chars()), scenarios)
    expect(same.affected).toEqual([{ scenario: 'syn.yaml', why: '碰到假设 dilation-rules' }])
    expect(same.reruns.map(x => x.changed)).toEqual([false])
    expect(same.reruns[0]!.before.runId).toBe(same.reruns[0]!.after.runId)
    expect(same.problems).toEqual([])
    const forced = rerunClosure(judged('onHit', 'onCast', false), timing('onHit'), synthData(chars()), scenarios)
    expect(forced.reruns.map(x => x.changed)).toEqual([true])
    expect(forced.problems.join('\n')).toMatch(/defaultChanged 为 false/)
  })

  test('C08-18 缺省已经改成新值之后跑 rerun：两次运行的 rules 里这个开关分别是旧值与新值，身份都带上', () => {
    const out = rerunClosure(judged('onHit', 'onCast', true), timing('onCast'), synthData(chars()), scenarios, { gitCommit: 'abc123' })
    expect(out.problems).toEqual([])
    const [x] = out.reruns
    expect(x!.changed).toBe(true)
    expect(out.identities.get(x!.before.runId)!.execution.rules.concertoTiming).toBe('onHit')
    expect(out.identities.get(x!.after.runId)!.execution.rules.concertoTiming).toBe('onCast')
    expect(out.identities.get(x!.after.runId)!.execution.gitCommit).toBe('abc123')
    // 台账还没跟着改：报出来
    expect(rerunClosure(judged('onHit', 'onCast', true), timing('onHit'), synthData(chars()), scenarios).problems.join('\n')).toMatch(/台账/)
  })
})
