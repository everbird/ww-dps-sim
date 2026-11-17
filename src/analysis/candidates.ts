// DD-04 §4–5：候选检查属于分析层；所有变体重新 prepareRun，不修改装配结果。
import { PER_CHAR_RULES, type GameData, type Rules } from '../data/gamedata'
import type { Scenario } from '../data/scenario.schema'
import { damageShareByTag, usableBasis } from '../engine'
import { canonicalJson } from '../engine'
import { PROPOSITIONS, type Binding, type Candidate, type Proposition, type ScenarioFeature } from '../engine'
import { prepareRun, runPrepared } from '../engine'
import type { PreparedRun, RunOverrides } from '../engine'
import { INTENDED, INTENT_WAITS } from '../engine'
import type { CommandRef, ResolvedScenario, SimResult, WaitCode } from '../engine'

export interface CandidateRef { readonly propositionId: string; readonly candidateId: string }
export interface PlannedCandidate extends CandidateRef { readonly candidate: Candidate }
export interface Exclusion { readonly candidates: readonly CandidateRef[]; readonly reason: string }
export interface CandidatePlan {
  mechanism: PlannedCandidate[]; policy: PlannedCandidate[]; excluded: Exclusion[]
  unimplemented: CandidateRef[]; notApplicable: CandidateRef[]; nonExhaustivePropositions: string[]
}
export function scenarioFeatures(p: PreparedRun): ReadonlySet<ScenarioFeature> {
  const r = p.resolved, features = new Set<ScenarioFeature>()
  if (p.effective.strict) features.add('strictEntry')
  if (r.options.tuneBreak === 'auto') features.add('hasAutoTuneBreak')
  for (const c of [...r.opening, ...r.commands]) {
    if (c.kind === 'act' && r.team[c.slot]!.actions[c.action]?.kind === 'tuneBreak') features.add('hasManualTuneBreak')
    if ('filler' in c && c.filler || 'optional' in c && c.optional) features.add('hasFillerOrOptional')
    if (c.kind === 'enemy' || c.kind === 'sync') features.add('hasForcedIntervention')
  }
  return features
}
/** 绑定的当前生效值。按角色覆盖的表（forteKeepOnSwitchBy.<角色>、concertoTimingBy.<角色>）表里没写这个角色时回退到共享的那条（DF-05、DD-08 §6） */
export function effectiveValue(b: Binding, r: ResolvedScenario): unknown {
  if (b.kind === 'rule' && b.path) {
    const [head, char, ...rest] = b.path.split('.')
    if (rest.length === 0 && char !== undefined && Object.hasOwn(PER_CHAR_RULES, head!)) {
      const by = r.rules[head as keyof typeof PER_CHAR_RULES] as Readonly<Record<string, unknown>>
      return Object.hasOwn(by, char) ? by[char] : r.rules[PER_CHAR_RULES[head as keyof typeof PER_CHAR_RULES] as keyof Rules]
    }
  }
  let v: unknown = b.kind === 'rule' ? r.rules : b.kind === 'option' ? r.options : undefined
  for (const key of b.path?.split('.') ?? []) v = v && typeof v === 'object' && Object.hasOwn(v, key) ? (v as Record<string, unknown>)[key] : undefined
  return v
}
export function pathConflict(a: Binding, b: Binding): string | null {
  if (a.kind !== b.kind || !a.path || !b.path) return null
  if (a.path === b.path) return a.value === b.value ? null : `路径 ${a.path} 的值不同`
  return a.path.startsWith(b.path + '.') || b.path.startsWith(a.path + '.') ? `父子路径冲突：${a.path} / ${b.path}` : null
}
export function classifyCandidates(p: PreparedRun, ledger: readonly Proposition[]): CandidatePlan {
  const plan: CandidatePlan = { mechanism: [], policy: [], excluded: [], unimplemented: [], notApplicable: [], nonExhaustivePropositions: [] }
  const features = scenarioFeatures(p)
  for (const prop of ledger) {
    if (!prop.candidatesExhaustive) plan.nonExhaustivePropositions.push(prop.id)
    for (const c of prop.candidates) {
      const b = c.binding
      if ((b.kind === 'rule' || b.kind === 'option') ? effectiveValue(b, p.resolved) === b.value : c.id === prop.adopted) continue
      const ref = { propositionId: prop.id, candidateId: c.id }
      const row = { ...ref, candidate: c }
      if (!c.implemented || b.kind === 'unimplemented') plan.unimplemented.push(ref)
      else if (prop.appliesToChars && !p.resolved.team.some(m => prop.appliesToChars!.includes(m.def.name))) plan.notApplicable.push(ref)
      else {
        const conflicts = c.conflictsWith?.filter(f => features.has(f)) ?? []
        if (conflicts.length) plan.excluded.push({ candidates: [ref], reason: conflicts.join(', ') })
        else if (c.changes === 'policy') plan.policy.push(row)
        else if (c.changes === 'input') plan.excluded.push({ candidates: [ref], reason: '改变的是轴的输入' })
        else if (b.kind !== 'rule' && b.kind !== 'option') plan.unimplemented.push(ref)
        else plan.mechanism.push(row)
      }
    }
  }
  return plan
}
const refOf = (c: PlannedCandidate): CandidateRef => ({ propositionId: c.propositionId, candidateId: c.candidateId })
export function steadyFrames(res: SimResult): number[] | null {
  const st = res.summary.steady
  return st ? (res.summary.perLoop ?? []).filter(l => l.loop >= st.from && l.loop <= st.to).map(l => l.frames) : null
}
const meanSeconds = (f: readonly number[] | null) => f?.length ? f.reduce((a, b) => a + b, 0) / f.length / 60 : null
export function compareOutcome(base: SimResult, res: SimResult, candidates: readonly PlannedCandidate[] = []) {
  const a = usableBasis(base), b = usableBasis(res), sa = base.summary.steady, sb = res.summary.steady
  const comparable = a.ok && b.ok && !!sa && !!sb && sa.from === sb.from && sa.to === sb.to
  const frames = b.ok ? steadyFrames(res) : null
  const ratio = comparable && sa.dps !== 0 ? sb.dps / sa.dps - 1 : null
  return {
    candidates: candidates.map(refOf), changes: candidates.map(c => c.candidate.changes), runId: res.runId,
    status: res.completion.status, completion: res.completion,
    comparedWindow: sb ? `稳态第 ${sb.from}–${sb.to} 轮` : '无稳态窗口',
    steadyLoopBattleFrames: frames, steadyLoopBattleSeconds: meanSeconds(frames), steadyDps: b.ok && sb ? sb.dps : null,
    loopTime: !comparable ? 'notComparable' as const : canonicalJson(steadyFrames(base)) === canonicalJson(frames) ? 'same' as const : 'changed' as const,
    dps: { status: ratio === null ? 'notComparable' as const : Math.abs(ratio) <= 1e-9 ? 'same' as const : 'changed' as const,
      delta: comparable ? sb.dps - sa.dps : null, ratio, withinWindowVariation: ratio === null ? null : Math.abs(ratio) <= sa!.spread },
    intentWaitCount: res.strictReport.intentWaits.length, identicalLog: canonicalJson(base.log) === canonicalJson(res.log),
    ...(!b.ok ? { failureDetail: b.reason } : {}),
  }
}
export type CandidateOutcome = ReturnType<typeof compareOutcome>
function overridesFor(base: RunOverrides, rows: readonly PlannedCandidate[]): RunOverrides {
  const rules = { ...base.rules }, options = { ...base.options }
  for (const { candidate: { binding: b } } of rows) {
    if (b.kind === 'rule') rules[b.path!] = b.value!
    else if (b.kind === 'option') Object.assign(options, { [b.path!]: b.value })
  }
  return { ...base, rules, options }
}

/** DD-04 §5.3：失败保留；pairsPlanned 是兼容性检查后真正计划执行的对数。ledger 参数供合成验收。 */
export function runCandidateReport(scenario: Scenario, data: GameData, opts: {
  overrides?: RunOverrides; pairs: boolean; onProgress?: (done: number, total: number) => void; ledger?: readonly Proposition[]
}) {
  const overrides = opts.overrides ?? {}, ledger: readonly Proposition[] = opts.ledger ?? PROPOSITIONS
  const p = prepareRun(scenario, data, overrides)
  if (!p.ok) throw new Error(p.issues.map(i => `${i.code}: ${i.message}`).join('\n'))
  const base = runPrepared(p.run), plan = classifyCandidates(p.run, ledger)
  const excluded = [...plan.excluded]
  const jobs: { rows: PlannedCandidate[]; run: PreparedRun; policy: boolean }[] = []
  function schedule(rows: PlannedCandidate[], policy: boolean) {
    const conflict = rows.length === 2 ? pathConflict(rows[0]!.candidate.binding, rows[1]!.candidate.binding) : null
    if (conflict) { excluded.push({ candidates: rows.map(refOf), reason: conflict }); return }
    const prep = prepareRun(scenario, data, overridesFor(overrides, rows))
    if (!prep.ok) { excluded.push({ candidates: rows.map(refOf), reason: prep.issues.map(i => `${i.code}: ${i.message}`).join('; ') }); return }
    const features = scenarioFeatures(prep.run)
    const conflicts = rows.flatMap(c => c.candidate.conflictsWith?.filter(f => features.has(f)) ?? [])
    if (conflicts.length) { excluded.push({ candidates: rows.map(refOf), reason: conflicts.join(', ') }); return }
    jobs.push({ rows, run: prep.run, policy })
  }
  for (const row of plan.mechanism) schedule([row], false)
  for (const row of plan.policy) schedule([row], true)
  if (opts.pairs) for (let i = 0; i < plan.mechanism.length; i++) for (let j = i + 1; j < plan.mechanism.length; j++) {
    const a = plan.mechanism[i]!, b = plan.mechanism[j]!
    if (a.propositionId !== b.propositionId) schedule([a, b], false)
  }
  const mechanismOutcomes: CandidateOutcome[] = [], policyTrials: CandidateOutcome[] = []
  for (const [i, job] of jobs.entries()) {
    const outcome = compareOutcome(base, runPrepared(job.run), job.rows)
    ;(job.policy ? policyTrials : mechanismOutcomes).push(outcome)
    opts.onProgress?.(i + 1, jobs.length)
  }
  const st = base.summary.steady
  const observedWaits = base.log.flatMap(e => e.type === 'wait' && st && e.cmd.loop >= st.from && e.cmd.loop <= st.to && !INTENDED.includes(e.code)
    ? [{ cmd: e.cmd, code: e.code, intent: INTENT_WAITS.some(c => c === e.code), battleFrames: e.battleFrames, reason: e.reason }] : [])
  const timingSensitive: { cmd: CommandRef; controlRunId: string; window: string; loopSecondsDelta: number; recordedWaits: WaitCode[]; gateConfirmed: false }[] = []
  const timingAbsorbed: { cmd: CommandRef; controlRunId: string }[] = []
  const timingFaster: typeof timingSensitive = [], timingUnassessable: { cmd: CommandRef; reason: string; runId?: string }[] = []
  for (const c of p.run.resolved.commands) {
    if (c.kind !== 'act' && c.kind !== 'switch') continue
    if (c.kind === 'act' && p.run.resolved.team[c.slot]!.actions[c.action]?.comboFrom?.length) continue
    const waits = observedWaits.filter(w => w.cmd.line === c.line && w.cmd.item === c.item)
    if (!waits.length) continue
    const cmd = waits[0]!.cmd, key = `${c.line}.${c.item}`
    const prep = prepareRun(scenario, data, { ...overrides, inputDelayAt: { ...overrides.inputDelayAt, [key]: (overrides.inputDelayAt?.[key] ?? 0) + 6 } })
    if (!prep.ok) { timingUnassessable.push({ cmd, reason: prep.issues.map(i => i.message).join('; ') }); continue }
    const outcome = compareOutcome(base, runPrepared(prep.run))
    const baseSecs = meanSeconds(steadyFrames(base))
    if (outcome.loopTime === 'notComparable' || baseSecs === null || outcome.steadyLoopBattleSeconds === null) {
      timingUnassessable.push({ cmd, runId: outcome.runId, reason: outcome.failureDetail ?? '稳态窗口不可比' }); continue
    }
    const delta = outcome.steadyLoopBattleSeconds - baseSecs
    if (Math.abs(delta) < 1e-9) timingAbsorbed.push({ cmd, controlRunId: outcome.runId })
    else (delta > 0 ? timingSensitive : timingFaster).push({ cmd, controlRunId: outcome.runId, window: outcome.comparedWindow,
      loopSecondsDelta: delta, recordedWaits: [...new Set(waits.map(w => w.code))], gateConfirmed: false })
  }
  let scopeReference
  if (base.damageScope.tuneBreak.mode === 'omitted') {
    const { tuneBreakOmitted: _omitted, ...referenceScenario } = scenario
    const prep = prepareRun(referenceScenario, data, { ...overrides, strict: false, options: { ...overrides.options, tuneBreak: 'auto' } })
    if (!prep.ok) throw new Error(`参考运行：${prep.issues.map(i => i.message).join('; ')}`)
    const res = runPrepared(prep.run), o = compareOutcome(base, res), u = usableBasis(res), rs = res.summary.steady
    const lo = rs ? res.summary.perLoop!.find(l => l.loop === rs.from)!.start : 0
    scopeReference = { runId: res.runId, status: res.completion.status, steadyDps: o.steadyDps, steadyLoopBattleFrames: o.steadyLoopBattleFrames,
      tuneBreakDamageShare: { steady: u.ok && rs ? damageShareByTag(res, '谐度破坏', { lo, hi: lo + rs.frames }) : null,
        wholeWindow: u.ok ? damageShareByTag(res, '谐度破坏', { lo: 0, hi: res.summary.windowFrames }) : null },
      dpsDeltaVsBaseline: o.dps.ratio, loopTimeChanged: o.loopTime === 'notComparable' ? null : o.loopTime === 'changed' }
  }
  const singles = mechanismOutcomes.filter(o => o.candidates.length === 1), pairs = mechanismOutcomes.filter(o => o.candidates.length === 2)
  return {
    baseline: { ...compareOutcome(base, base), identity: base.identity, strictReport: base.strictReport, damageScope: base.damageScope, warnings: base.summary.warnings },
    observedWaits, timingSensitive, timingAbsorbed, timingFaster, timingUnassessable,
    mechanismOutcomes, policyTrials, excluded, unimplemented: plan.unimplemented, notApplicable: plan.notApplicable,
    nonExhaustivePropositions: plan.nonExhaustivePropositions,
    unverifiedDependencies: ledger.filter(p => p.conclusion !== 'supported' && base.summary.assumptions.some(a => a.id === p.assumptionId)).map(p => p.id),
    coverage: { singlesPlanned: singles.length, singlesRun: singles.filter(o => o.status !== 'engineError').length,
      pairsPlanned: pairs.length, pairsRun: pairs.filter(o => o.status !== 'engineError').length,
      axisFailedCount: mechanismOutcomes.filter(o => o.status === 'axisFailed').length, engineErrorCount: mechanismOutcomes.filter(o => o.status === 'engineError').length,
      notRunCount: 0, higherOrderChecked: false as const },
    ...(scopeReference ? { scopeReference } : {}),
  }
}
export type StrictCandidateReport = ReturnType<typeof runCandidateReport>
