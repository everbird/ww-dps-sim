// src/analysis/evidence.ts —— 证据闭环（DD-08 §4、§5.2；架构 §8.1 的证据部分）。④ 分析层：纯函数，不读盘、不调 git，文件与身份由命令行给。
// 一条闭环 = 候选 → 条件化预测 → 观测及误差范围 → 判断 → 采用决定 → 受影响场景重跑（路线图 §9.1 第 4 条）：
//   predictClosure   每个候选在每个 setup 上跑一次，逐个观测取仿真值作为预测（截断、轴失败的运行覆盖范围以内照常有预测，DF-16）；
//   registerClosure  登记：冻结预测运行的完整身份、观测定义与预测值的两个摘要（DF-17）；
//   verifyPredictions 用当前代码重跑登记过的预测，核对有没有过期；
//   judgeClosure     拿冻结的预测与观测的读数比（compareValue，不重跑），按 §4.1 的规则算候选级判断与命题结论；
//   rerunClosure     采用决定之后，在同一份代码上对受影响的场景各跑采用前、后两个值（DF-17）。
// 命题结论只由 concludeFromVerdicts 按 §4.1 的决策表算：闭环 YAML（judge）、pnpm evidence --md 的总表、台账（tests 核对）三处用同一个函数。
import { toleranceOf, type Observation } from '../data/calibration.schema'
import type { CandidateVerdict, ClosurePrediction, ClosureRecord, ClosureRunRef, ConclusionRecord } from '../data/evidence.schema'
import type { GameData } from '../data/gamedata'
import type { Scenario } from '../data/scenario.schema'
// DD-10 §5：DD-08 闭环也属于分析层，只经公开入口调用引擎。
import { usableBasis, canonicalJson, digestOf, RULE_POINTS, prepareRun, runPrepared, type Candidate, type Evidence, type EvidencePurpose, type Proposition, type PreparedRun, type RunEnvironment, type RunIdentity, type RunOverrides, type RunStatus, type SimResult } from '../engine'
import { steadyFrames } from './candidates'
import { compareValue, hasReading, readObservation, type ComparisonStatus, type PredictedValue } from './observations'

// ---------------------------------------------------------------------------
// 共用

/** 闭环的计算环境：数据、各 setup 的场景（键是 setup 的 scenario 字段，相对 scenarios/）、全部观测、台账里这条命题 */
export interface EvidenceContext {
  readonly data: GameData
  readonly scenarios: ReadonlyMap<string, Scenario>
  readonly observations: readonly Observation[]
  readonly proposition: Proposition
  readonly environment?: RunEnvironment
}

export class EvidenceError extends Error {}

/** 记录引用的观测，按 observationIds 的顺序；缺了报错 */
export function observationsOf(record: Pick<ClosureRecord, 'observationIds' | 'id'>, all: readonly Observation[]): Observation[] {
  return record.observationIds.map(id => {
    const o = all.find(x => x.id === id)
    if (!o) throw new EvidenceError(`${record.id}：观测 ${id} 不在 docs/calibration/points.yaml 里`)
    return o
  })
}

/** 观测在哪个 setup 上比：setup 的 scenario 与观测的 scenario 相同，恰好一个 */
export function setupOf(record: Pick<ClosureRecord, 'setups' | 'id'>, o: Observation): ClosureRecord['setups'][number] {
  const list = record.setups.filter(s => s.scenario === o.scenario)
  if (list.length !== 1) throw new EvidenceError(`${record.id}：观测 ${o.id} 的场景 ${o.scenario} 对应 ${list.length} 个 setup（要恰好一个）`)
  return list[0]!
}

/** 候选能不能跑：台账里 implemented 且绑定不是 unimplemented */
export const runnable = (c: Candidate): boolean => c.implemented && c.binding.kind !== 'unimplemented'

/** 候选怎么落到运行上（DD-04 §3.1）：rule / option 显式写进 RunOverrides（不靠缺省，DD-08 §4.2 的 rerun 同样）；
 *  curated / hook 只有当前采用的那个能跑，照现在的代码；scenario 不改覆盖、换场景跑（scenarioFor）；不能跑的返回 null */
export function overridesFor(c: Candidate): RunOverrides | null {
  if (!runnable(c)) return null
  const b = c.binding
  if (b.kind === 'rule') return { rules: { [b.path!]: b.value! } }
  if (b.kind === 'option') return { options: { [b.path!]: b.value } as RunOverrides['options'] }
  return {}
}

/** 这个候选在 setup 上用哪份场景：scenario 绑定的换成它自己的（DD-09 §5：录像里漏记的一下这类"轴的输入"候选），其余用 setup 的 */
export const scenarioFor = (c: Candidate, setupScenario: string): string => (c.binding.kind === 'scenario' ? c.binding.path! : setupScenario)

/** 记录的候选要与台账这条命题的候选一一对上（DD-08 §4.1：其余候选的情况照记，不漏） */
function checkCandidates(record: ClosureRecord, p: Proposition): void {
  if (record.propositionId !== p.id) throw new EvidenceError(`${record.id}：记录说的是 ${record.propositionId}，给的命题是 ${p.id}`)
  const mine = record.candidates.map(c => c.candidateId).sort(), theirs = p.candidates.map(c => c.id).sort()
  if (canonicalJson(mine) !== canonicalJson(theirs))
    throw new EvidenceError(`${record.id}：候选（${mine.join('、')}）与台账 ${p.id} 的候选（${theirs.join('、')}）对不上`)
}
const candidateOf = (p: Proposition, id: string): Candidate => p.candidates.find(c => c.id === id)!

// ---------------------------------------------------------------------------
// 预测（DD-08 §4.2 predict）

export interface PredictOutput {
  /** 只改了各候选的 runs 与 predictions（没实现的候选保留手算的预测） */
  readonly record: ClosureRecord
  readonly identities: ReadonlyMap<string, RunIdentity>
  readonly results: readonly { readonly candidateId: string; readonly setupId: string; readonly run: PreparedRun; readonly result: SimResult }[]
  readonly check: Distinguishability
}

/** 严格入口里变奏意图没满足、轴停在那次切人上时（DF-16）：观测要的正是这次切人的类型，就预测"不是变奏"——经这条观测算不相容 */
function failedIntroSwitch(o: Observation, res: SimResult, run: PreparedRun): boolean {
  const intent = res.completion.axisFailure?.unmetIntent
  if (o.kind !== 'switchType' || res.completion.status !== 'axisFailed' || intent?.kind !== 'introMissed') return false
  const list = intent.cmd.loop === 0 ? run.resolved.opening : run.resolved.commands
  const cmd = list.find(c => c.line === intent.cmd.line && c.item === intent.cmd.item)
  if (cmd?.kind !== 'switch') return false
  const to = run.resolved.team[cmd.to]!.def.name
  if ((o.at.char !== undefined && o.at.char !== to) || (o.at.loop !== undefined && o.at.loop !== intent.cmd.loop)) return false
  // 这次切人之前、同样满足选择器的切人有几次：正好 nth - 1 次，选中的就是没切成的这一次
  let inLoop = o.at.loop === undefined, before = 0
  for (const e of res.log) {
    if (e.type === 'loop') inLoop = o.at.loop === undefined || e.loop === o.at.loop
    else if (inLoop && e.type === 'switch' && (o.at.char === undefined || e.to === o.at.char)) before++
  }
  return before === o.at.nth - 1
}

function predictionOf(o: Observation, run: PreparedRun, res: SimResult): ClosurePrediction {
  if (res.completion.status === 'engineError')
    return { observationId: o.id, predicted: null, covered: false, reason: `引擎错误，这次运行作废：${res.completion.engineError?.message ?? ''}` }
  const x = readObservation(o, {
    resolved: run.resolved, log: res.log, completion: res.completion, interventions: res.interventions,
    ...(res.diag?.resourceLedger ? { ledger: res.diag.resourceLedger } : {}), ...(res.diag?.eventMeta ? { meta: res.diag.eventMeta } : {}),
  })
  if (x.ok) {
    const alt = x.alternatives?.filter((v): v is number => typeof v === 'number')
    const v = x.value
    const predicted: ClosurePrediction['predicted'] = typeof v === 'number' || typeof v === 'string' ? v : [v[0], v[1]]
    return { observationId: o.id, predicted, covered: true, ...(alt?.length ? { alternatives: alt } : {}) }
  }
  if (failedIntroSwitch(o, res, run))
    return { observationId: o.id, predicted: 'normal', covered: true, reason: `这个候选下变奏意图不成立：${res.completion.axisFailure!.detail}` }
  return { observationId: o.id, predicted: null, covered: x.covered, reason: x.reason }
}

function runRefOf(setupId: string, res: SimResult): ClosureRunRef {
  const c = res.completion
  const detail = c.status === 'axisFailed' ? `${c.axisFailure?.kind}：${c.axisFailure?.detail}`
    : c.status === 'truncated' ? `截断（${c.truncation?.kind}），停在世界帧 ${c.coverage.loopExitAt.worldFrame}`
    : c.status === 'engineError' ? `${c.engineError?.code}：${c.engineError?.message}` : undefined
  return { setupId, runId: res.runId, status: c.status, ...(detail ? { detail } : {}) }
}

/** 跑各候选在各 setup 上的运行，填 runs 与 predictions（DD-08 §4.2）。同样的输入得到同样的记录（C08-12） */
export function predictClosure(record: ClosureRecord, ctx: EvidenceContext): PredictOutput {
  checkCandidates(record, ctx.proposition)
  const obs = observationsOf(record, ctx.observations)
  const bySetup = new Map(record.setups.map(s => [s.id, [] as Observation[]]))
  for (const o of obs) bySetup.get(setupOf(record, o).id)!.push(o)
  const identities = new Map<string, RunIdentity>()
  const results: { candidateId: string; setupId: string; run: PreparedRun; result: SimResult }[] = []
  const candidates = record.candidates.map(rc => {
    const cand = candidateOf(ctx.proposition, rc.candidateId)
    const ov = overridesFor(cand)
    if (ov === null) return { ...rc, runs: [], predictions: rc.predictions.filter(p => p.manual) }   // 没实现：只留手算的
    const runs: ClosureRunRef[] = []
    const preds = new Map<string, ClosurePrediction>()
    for (const s of record.setups) {
      const file = scenarioFor(cand, s.scenario)
      const sc = ctx.scenarios.get(file)
      if (!sc) throw new EvidenceError(`${record.id}：没有给 setup ${s.id} 的场景 ${file}`)
      const prep = prepareRun(sc, ctx.data, { ...ov, ...(ctx.environment ? { environment: ctx.environment } : {}) })
      if (!prep.ok) throw new EvidenceError(`${record.id}：候选 ${rc.candidateId} 在 setup ${s.id} 上准备不了：${prep.issues.map(i => i.message).join('；')}`)
      const list = bySetup.get(s.id)!
      const res = runPrepared(prep.run, list.some(o => o.kind === 'resourceAt') ? { diag: { resourceLedger: true, eventMeta: true } } : {})
      identities.set(res.runId, res.identity)
      results.push({ candidateId: rc.candidateId, setupId: s.id, run: prep.run, result: res })
      runs.push(runRefOf(s.id, res))
      for (const o of list) preds.set(o.id, predictionOf(o, prep.run, res))
    }
    return { ...rc, runs, predictions: record.observationIds.map(id => preds.get(id)!) }
  })
  const out = { ...record, candidates }
  return { record: out, identities, results, check: distinguishability(out, ctx.observations) }
}

// ---------------------------------------------------------------------------
// 区分度（DD-08 §5.2 第 3 步）：按预登记的判据，各候选的接受区间两两比

export interface PairCheck { readonly a: string; readonly b: string; readonly separable: boolean }
export interface ObservationCheck {
  readonly observationId: string
  readonly pairs: readonly PairCheck[]
  readonly notes: readonly string[]                    // 预测取不到、容差小于读数精度…
}
export interface Distinguishability {
  readonly observations: readonly ObservationCheck[]
  /** 至少有一条评分观测能区分至少一对候选 */
  readonly anySeparable: boolean
  readonly lines: readonly string[]
}

type Accept = { readonly kind: 'ranges'; readonly ranges: readonly (readonly [number, number])[] } | { readonly kind: 'category'; readonly value: string }

/** 一个预测值下，哪些（点）读数会被判相容：相对容差 |v/g − 1| ≤ tol → g ∈ [v/(1+tol), v/(1−tol)]；帧差 |v − g| ≤ tol；跳字按分支 */
export function acceptance(o: Observation, v: PredictedValue): Accept {
  const tol = toleranceOf(o)
  const rel = (x: number): readonly [number, number] => {
    if (x === 0) return [-tol, tol]
    const a = x / (1 + tol), b = tol < 1 ? x / (1 - tol) : Infinity * Math.sign(x)
    return a <= b ? [a, b] : [b, a]
  }
  if (o.kind === 'switchType') return { kind: 'category', value: String(v) }
  if (o.kind === 'interval') {
    const t = o.unit === 'seconds' ? tol / 60 : tol
    return { kind: 'ranges', ranges: [[(v as number) - t, (v as number) + t]] }
  }
  if (o.kind === 'hit' && Array.isArray(v)) {
    const [n, c] = v as readonly [number, number]
    return { kind: 'ranges', ranges: o.branch === 'nonCrit' ? [rel(n)] : o.branch === 'crit' ? [rel(c)] : [rel(n), rel(c)] }
  }
  return { kind: 'ranges', ranges: [rel(v as number)] }
}

const overlaps = (a: Accept, b: Accept): boolean =>
  a.kind === 'category' || b.kind === 'category'
    ? a.kind === b.kind && (a as { value: string }).value === (b as { value: string }).value
    : a.ranges.some(x => b.ranges.some(y => x[0] <= y[1] && y[0] <= x[1]))

/** 读数精度（只有 interval 有结构化的：录像一格是几个世界帧） */
const precisionOf = (o: Observation): number | null => (o.kind === 'interval' ? (o.fps !== undefined && o.fps < 60 ? 60 / o.fps : 1) : null)

export function distinguishability(record: ClosureRecord, all: readonly Observation[]): Distinguishability {
  const obs = observationsOf(record, all)
  const rows: ObservationCheck[] = []
  const lines: string[] = []
  for (const o of obs) {
    if (o.purpose === 'given') continue
    const notes: string[] = []
    const prec = precisionOf(o)
    if (prec !== null && toleranceOf(o) < prec) notes.push(`容差 ${toleranceOf(o)} 帧小于读数精度 ${prec} 帧`)
    const acc: { id: string; accept: Accept | null }[] = record.candidates.map(c => {
      const p = c.predictions.find(x => x.observationId === o.id)
      if (!p || p.predicted === null) return { id: c.candidateId, accept: null }
      const extra = (p.alternatives ?? []).map(v => acceptance(o, v))
      const main = acceptance(o, p.predicted)
      return { id: c.candidateId, accept: main.kind === 'ranges' ? { kind: 'ranges', ranges: [...main.ranges, ...extra.flatMap(x => (x.kind === 'ranges' ? x.ranges : []))] } : main }
    })
    for (const x of acc) if (!x.accept) notes.push(`${x.id} 没有预测`)
    const pairs: PairCheck[] = []
    for (let i = 0; i < acc.length; i++) for (let j = i + 1; j < acc.length; j++) {
      const a = acc[i]!, b = acc[j]!
      if (!a.accept || !b.accept) continue
      pairs.push({ a: a.id, b: b.id, separable: !overlaps(a.accept, b.accept) })
    }
    rows.push({ observationId: o.id, pairs, notes })
    const pairText = pairs.map(p => `${p.a} × ${p.b} ${p.separable ? '可区分' : '可能区分不了（接受区间重叠）'}`).join('；') || '没有可比的一对'
    lines.push(`${o.id}：${pairText}${notes.length ? `（${notes.join('；')}）` : ''}`)
  }
  const anySeparable = rows.some(r => r.pairs.some(p => p.separable))
  if (!anySeparable) lines.push(record.kind === 'experiment'
    ? '全都区分不了：按 DD-08 §5.2 第 3 步，这个实验先不做（在闭环文件里写明原因）'
    : '现有观测都区分不了这几个候选（回填照实记：结论最多是分不清或暂定，写出下一项能区分的观测）')
  return { observations: rows, anySeparable, lines }
}

// ---------------------------------------------------------------------------
// 登记（DD-08 §5.2 第 4 步；DF-17）

/** 参与判断的观测定义：去掉实测读数（game、gameRange、switchType 的 expect）与读数时填的条件、说明、记录文件，容差取实际用的值 */
export function observationDefinition(o: Observation): Record<string, unknown> {
  const { game: _g, gameRange: _r, condition: _c, note: _n, record: _f, ...rest } = o as Observation & { expect?: unknown }
  if (o.kind === 'switchType') delete (rest as { expect?: unknown }).expect
  return { ...rest, tolerance: toleranceOf(o) }
}

export const observationsDigest = (record: ClosureRecord, all: readonly Observation[]): string =>
  digestOf(observationsOf(record, all).map(observationDefinition))

/** 全部预测值（含各运行的 runId 与状态）的摘要 */
export const predictionsDigest = (record: ClosureRecord): string =>
  digestOf(record.candidates.map(c => ({ candidateId: c.candidateId, runs: c.runs, predictions: c.predictions })))

/** 登记前后都能核对的两个摘要：判据或读数之外的定义改了、预测改了，返回问题（judge 拒绝，DD-08 §4.2） */
export function registrationProblems(record: ClosureRecord, all: readonly Observation[]): string[] {
  const reg = record.preRegistration
  if (!reg) return record.kind === 'experiment' ? ['实验记录没有登记预测（preRegistration 为空）：先 pnpm evidence predict、register 再进游戏'] : []
  const out: string[] = []
  if (observationsDigest(record, all) !== reg.observationsDigest) out.push('观测的定义（选择器、单位、时钟、分支、用途、容差、requires）在登记后改过')
  if (predictionsDigest(record) !== reg.predictionsDigest) out.push('预测在登记后改过')
  return out.length ? [`预测或判据在登记后改过，需另开一条记录：${out.join('；')}`] : []
}

export interface RegisterOutput {
  readonly record: ClosureRecord
  readonly files: readonly { readonly path: string; readonly identity: RunIdentity }[]
}

/** 登记预测：先核对文件里的预测就是现在跑出来的，再冻结身份与两个摘要。identityPath：一次运行的身份文件放在哪（相对仓库根） */
export function registerClosure(record: ClosureRecord, ctx: EvidenceContext, opts: { readonly date: string; readonly identityPath: (runId: string) => string }): RegisterOutput {
  if (record.kind !== 'experiment') throw new EvidenceError(`${record.id}：回填记录不登记预测（DD-08 §6），直接 judge`)
  if (record.preRegistration) throw new EvidenceError(`${record.id}：已经登记过（${record.preRegistration.date}），要改预测或判据就另开一条记录`)
  if (ctx.environment?.contentFingerprint) throw new EvidenceError(`${record.id}：工作区有没提交的改动（src、data、scenarios…）：先提交代码与 setup 场景，再登记`)
  const read = observationsOf(record, ctx.observations).filter(o => o.purpose !== 'given' && hasReading(o)).map(o => o.id)
  if (read.length) throw new EvidenceError(`${record.id}：${read.join('、')} 已经有读数了——预测要在读数之前登记（DD-08 §5.2）；已有的材料按回填（kind: backfill）记`)
  const now = predictClosure(record, ctx)
  if (canonicalJson(now.record.candidates) !== canonicalJson(record.candidates))
    throw new EvidenceError(`${record.id}：文件里的预测与现在跑出来的不同，先 pnpm evidence predict`)
  const runIds = [...new Set(record.candidates.flatMap(c => c.runs.map(r => r.runId)))]
  const files = runIds.map(id => ({ path: opts.identityPath(id), identity: now.identities.get(id)! }))
  const commits = [...new Set(files.map(f => f.identity.execution.gitCommit))]
  return {
    record: {
      ...record,
      preRegistration: {
        commit: commits.length === 1 ? commits[0]! : commits.join(','), date: opts.date, identities: files.map(f => f.path),
        observationsDigest: observationsDigest(record, ctx.observations), predictionsDigest: predictionsDigest(record),
      },
    },
    files,
  }
}

export interface VerifyOutput { readonly ok: boolean; readonly lines: readonly string[] }

/** 身份里不同的字段（去掉 gitCommit、contentFingerprint 另说） */
function identityDiff(a: RunIdentity, b: RunIdentity): string[] {
  const out: string[] = []
  for (const k of Object.keys({ ...a.data, ...b.data }) as (keyof RunIdentity['data'])[])
    if (canonicalJson(a.data[k]) !== canonicalJson(b.data[k])) out.push(`data.${k}`)
  for (const k of Object.keys({ ...a.execution, ...b.execution }) as (keyof RunIdentity['execution'])[]) {
    if (k === 'gitCommit' || k === 'contentFingerprint') continue
    if (canonicalJson(a.execution[k]) !== canonicalJson(b.execution[k])) out.push(`execution.${k}`)
  }
  return out
}

/** 用当前代码重跑登记过的预测（DD-08 §4.2 的 --verify）。runId 相同就是没变；不同时看原因：除了提交号还有别的身份字段不同
 *  （数据、装配结果、场景、规则……），或者重跑出来的预测值不同，都是"预测已过期"；只有提交号不同、预测也一样时照样有效，单列说明
 *  （runId 含提交号，只改文档的提交也会让它变，DD-08 §9 的实施记录）。registered：登记时存下的身份（runId → 身份） */
export function verifyPredictions(record: ClosureRecord, ctx: EvidenceContext, registered: ReadonlyMap<string, RunIdentity>): VerifyOutput {
  if (!record.preRegistration) return { ok: false, lines: ['没有登记过预测，不用 --verify'] }
  const now = predictClosure(record, ctx)
  const lines: string[] = []
  let ok = true
  for (const rc of record.candidates) {
    const nc = now.record.candidates.find(c => c.candidateId === rc.candidateId)!
    for (const r of rc.runs) {
      const n = nc.runs.find(x => x.setupId === r.setupId)
      if (!n) { ok = false; lines.push(`${rc.candidateId} / ${r.setupId}：现在没有这次运行`); continue }
      if (n.runId === r.runId) continue
      const old = registered.get(r.runId), fresh = now.identities.get(n.runId)!
      const diff = old ? identityDiff(old, fresh) : ['（登记时的身份文件缺失）']
      if (diff.length > 0) { ok = false; lines.push(`${rc.candidateId} / ${r.setupId}：预测已过期——${diff.join('、')} 与登记时不同（${r.runId} → ${n.runId}）`) }
      else lines.push(`${rc.candidateId} / ${r.setupId}：只有提交号不同（${old!.execution.gitCommit.slice(0, 12)} → ${fresh.execution.gitCommit.slice(0, 12)}），输入相同`)
    }
    if (canonicalJson(nc.predictions) !== canonicalJson(rc.predictions)) { ok = false; lines.push(`${rc.candidateId}：重跑出来的预测值与登记的不同，预测已过期`) }
  }
  if (ok) lines.push('登记的预测仍然有效')
  return { ok, lines }
}

// ---------------------------------------------------------------------------
// 判断（DD-08 §4.1；DF-16）

const COMPATIBLE: readonly ComparisonStatus[] = ['passed', 'ambiguous']
const scoring = (o: Observation): boolean => o.purpose !== 'given'
const isIndependent = (p: EvidencePurpose): boolean => p === 'independent_validation'

/** 一条观测与各候选的关系（架构 §8.1 的三种）：P 相容、C 冲突。P、C 都不空：支持 P（相对 C）、反驳 C；只有 P：相容但区分不了；只有 C：反驳 C */
export interface ObservationRelation {
  readonly observationId: string
  readonly purpose: EvidencePurpose
  readonly compatible: readonly string[]
  readonly conflicting: readonly string[]
  readonly supports: readonly string[]
  readonly refutes: readonly string[]
  readonly consistentWith: readonly string[]
}

export function relationsOf(verdicts: readonly CandidateVerdict[], obs: readonly Observation[]): ObservationRelation[] {
  return obs.filter(scoring).map(o => {
    const at = (v: CandidateVerdict) => v.perObservation.find(x => x.observationId === o.id)
    const compatible = verdicts.filter(v => { const x = at(v); return !!x && x.covered && COMPATIBLE.includes(x.status) }).map(v => v.candidateId)
    const conflicting = verdicts.filter(v => { const x = at(v); return !!x && x.covered && x.status === 'conflicted' }).map(v => v.candidateId)
    const both = compatible.length > 0 && conflicting.length > 0
    return {
      observationId: o.id, purpose: o.purpose, compatible, conflicting,
      supports: both ? compatible : [], refutes: conflicting, consistentWith: both ? [] : compatible,
    }
  })
}

/** 候选级判断（DD-08 §4.1）：只用评分观测（purpose 不是 given）；passed、ambiguous 算相容，conflicted 算不相容，其余两边都不算；
 *  engineError 的运行作废；截断、轴失败的运行覆盖范围以外的记 covered: false */
export function verdictsOf(record: ClosureRecord, p: Proposition, obs: readonly Observation[]): CandidateVerdict[] {
  return record.candidates.map(rc => {
    const c = candidateOf(p, rc.candidateId)
    if (!runnable(c)) return { candidateId: rc.candidateId, perObservation: [], overall: 'notAssessed', notAssessedReason: 'unimplemented', runStatuses: [] }
    const missing = record.setups.filter(s => !rc.runs.some(r => r.setupId === s.id))
    if (missing.length) throw new EvidenceError(`${record.id}：候选 ${rc.candidateId} 在 ${missing.map(s => s.id).join('、')} 上还没有预测，先 pnpm evidence predict`)
    const perObservation = obs.map(o => {
      const run = rc.runs.find(r => r.setupId === setupOf(record, o).id)!
      const pred = rc.predictions.find(x => x.observationId === o.id)
      const usable = !!pred && run.status !== 'engineError'
      const covered = usable && pred.covered
      const cmp = compareValue(o, usable ? pred.predicted : null, { ...(pred?.alternatives ? { alternatives: pred.alternatives } : {}), ...(pred?.reason ? { missingReason: pred.reason } : {}) })
      return { observationId: o.id, status: cmp.status, residual: cmp.residual, purpose: o.purpose, covered }
    })
    const counted = perObservation.filter(x => x.purpose !== 'given' && x.covered)
    const runStatuses = record.setups.map(s => rc.runs.find(r => r.setupId === s.id)!.status)
    const intentFailures = rc.runs.filter(r => r.status === 'axisFailed').map(r => `${r.setupId}：${r.detail ?? '轴失败'}`)
    const base = { candidateId: rc.candidateId, perObservation, runStatuses, ...(intentFailures.length ? { intentFailures } : {}) }
    if (counted.some(x => x.status === 'conflicted')) return { ...base, overall: 'inconsistent' as const }
    if (counted.some(x => COMPATIBLE.includes(x.status))) return { ...base, overall: 'consistent' as const }
    const reason = counted.length === 0 ? (rc.runs.some(r => r.status === 'engineError') ? 'engineError' as const : 'noCoveredObservation' as const)
      : counted.every(x => x.status === 'insufficientCondition' || x.status === 'unassessable') ? 'allInsufficient' as const
      : 'noCoveredObservation' as const
    return { ...base, overall: 'notAssessed' as const, notAssessedReason: reason }
  })
}

const split = (ids: readonly string[], obs: readonly Observation[]) => {
  const purpose = new Map(obs.map(o => [o.id, o.purpose]))
  const uniq = [...new Set(ids)].sort((a, b) => obs.findIndex(o => o.id === a) - obs.findIndex(o => o.id === b))
  return { independent: uniq.filter(id => isIndependent(purpose.get(id)!)), other: uniq.filter(id => !isIndependent(purpose.get(id)!) && purpose.get(id) !== 'given') }
}

/** 命题结论的决策表（DD-08 §4.1，九行互斥、覆盖全部情形）。adopted 是当前采用的候选 A；exhaustive 是台账的 candidatesExhaustive。
 *  闭环 YAML、--md 总表、台账核对都调它 */
export function concludeFromVerdicts(
  verdicts: readonly CandidateVerdict[], adopted: string, exhaustive: boolean, obs: readonly Observation[],
): ConclusionRecord {
  const A = verdicts.find(v => v.candidateId === adopted)
  if (!A) throw new EvidenceError(`采用的候选 ${adopted} 不在判断里`)
  const others = verdicts.filter(v => v.candidateId !== adopted)
  const assessable = (v: CandidateVerdict) => v.overall !== 'notAssessed'
  const scored = obs.filter(scoring)
  const at = (v: CandidateVerdict, id: string) => v.perObservation.find(x => x.observationId === id)
  const compat = (v: CandidateVerdict, id: string) => { const x = at(v, id); return !!x && x.covered && COMPATIBLE.includes(x.status) }
  const conflict = (v: CandidateVerdict, id: string) => { const x = at(v, id); return !!x && x.covered && x.status === 'conflicted' }
  const aCompatible = scored.filter(o => compat(A, o.id)).map(o => o.id)
  const aConflicting = scored.filter(o => conflict(A, o.id)).map(o => o.id)
  const empty = { independent: [] as string[], other: [] as string[] }

  if (A.overall === 'notAssessed')
    return others.some(assessable) ? { proposition: 'unverified', about: adopted, basis: empty, rule: 2 } : { proposition: 'unverified', about: null, basis: empty, rule: 1 }
  if (A.overall === 'consistent') {
    if (others.length === 0) return { proposition: 'provisional', about: adopted, basis: split(aCompatible, obs), rule: 6 }
    if (others.some(v => v.overall === 'consistent')) return { proposition: 'ambiguous', about: adopted, basis: split(aCompatible, obs), rule: 3 }
    // 没有其他相容的：被判 inconsistent 的竞争候选各被哪些观测排除（A 相容、它冲突），独立的与其他的分开
    const losers = others.filter(v => v.overall === 'inconsistent')
    const excludedBy: Record<string, { independent: string[]; other: string[] }> = {}
    for (const v of losers) excludedBy[v.candidateId] = split(scored.filter(o => compat(A, o.id) && conflict(v, o.id)).map(o => o.id), obs)
    const exclusion = Object.values(excludedBy).flatMap(x => [...x.independent, ...x.other])
    const anyEmpty = Object.values(excludedBy).some(x => x.independent.length + x.other.length === 0)
    const ids = losers.length === 0 ? aCompatible : anyEmpty ? [...exclusion, ...aCompatible] : exclusion
    const basis = losers.length === 0 ? split(ids, obs) : { ...split(ids, obs), excludedBy }
    if (others.some(v => v.overall === 'notAssessed')) return { proposition: 'provisional', about: adopted, basis, rule: 5 }
    const allIndependent = losers.every(v => excludedBy[v.candidateId]!.independent.length > 0)
    return { proposition: allIndependent ? 'supported' : 'provisional', about: adopted, basis, rule: 4 }
  }
  // A 不相容：basis 列与 A 冲突的观测（反驳不要求独立观测，DD-08 §4.1）
  const basis = split(aConflicting, obs)
  const consistentOthers = others.filter(v => v.overall === 'consistent').map(v => v.candidateId)
  if (consistentOthers.length > 0) return { proposition: 'refuted', about: adopted, basis, rule: 7, suggests: consistentOthers }
  if (others.some(v => v.overall === 'notAssessed')) return { proposition: 'refuted', about: adopted, basis, rule: 9 }
  return { proposition: exhaustive ? 'conflicted' : 'outOfScope', about: adopted, basis, rule: 8 }
}

export interface JudgeOutput {
  readonly verdicts: CandidateVerdict[]
  readonly conclusion: ConclusionRecord
  readonly relations: ObservationRelation[]
}

/** 拿冻结的预测与观测的读数比，算候选级判断与命题结论（DD-08 §4.2 judge）。不重跑仿真；采用决定（decision）留给人填。
 *  实验记录要先登记，且两个摘要与登记时相同（DF-17）；不满足时抛 EvidenceError */
export function judgeClosure(record: ClosureRecord, p: Proposition, all: readonly Observation[]): JudgeOutput {
  checkCandidates(record, p)
  const problems = registrationProblems(record, all)
  if (problems.length) throw new EvidenceError(`${record.id}：${problems.join('；')}`)
  const obs = observationsOf(record, all)
  const verdicts = verdictsOf(record, p, obs)
  return { verdicts, conclusion: concludeFromVerdicts(verdicts, p.adopted, p.candidatesExhaustive, obs), relations: relationsOf(verdicts, obs) }
}

// ---------------------------------------------------------------------------
// 进台账（DD-08 §4.3）

const versionOf = (o: Observation): string => {
  const v = o.condition?.gameVersion
  return v === undefined || v === 'unknown' || v === '' ? '未知' : v
}

const conditionText = (o: Observation): string =>
  [o.condition?.note, o.condition?.unknowns.length ? `不知道：${o.condition.unknowns.join('、')}` : ''].filter(Boolean).join('；') || '见观测记录'

/** 一条闭环给台账的证据条目（DD-08 §4.3）：有关系的评分观测（P、C 都空的不是证据）按"同一个 setup、同一种用途、同样的三种关系、
 *  同一个游戏版本与日期"并成一条，条件里列出是哪几条观测（细节在 points.yaml）。simulationRunId 取采用候选在那个 setup 上的预测运行。
 *  id 是 <闭环 ID>:<setup>:<第几组> */
export function evidenceFromClosure(record: ClosureRecord, judged: Pick<JudgeOutput, 'relations' | 'verdicts'>, p: Proposition, all: readonly Observation[]): Evidence[] {
  const obs = observationsOf(record, all)
  const groups = new Map<string, { setup: string; ids: string[]; r: ObservationRelation; o: Observation }>()
  for (const r of judged.relations) {
    if (r.compatible.length + r.conflicting.length === 0) continue
    const o = obs.find(x => x.id === r.observationId)!
    const setup = setupOf(record, o).id
    const key = canonicalJson([setup, r.purpose, r.supports, r.refutes, r.consistentWith, versionOf(o), o.condition?.recordedAt ?? null])
    const g = groups.get(key)
    if (g) g.ids.push(o.id)
    else groups.set(key, { setup, ids: [o.id], r, o })
  }
  const nth = new Map<string, number>()
  return [...groups.values()].map(({ setup, ids, r, o }) => {
    const k = (nth.get(setup) ?? 0) + 1
    nth.set(setup, k)
    const runOf = (cid: string) => record.candidates.find(c => c.candidateId === cid)?.runs.find(x => x.setupId === setup)?.runId
    const runId = runOf(p.adopted) ?? record.candidates.map(c => runOf(c.candidateId)).find(Boolean)
    const status = judged.verdicts.map(v => {
      if (v.notAssessedReason === 'unimplemented') return `${v.candidateId} 没实现`
      const xs = ids.map(id => v.perObservation.find(x => x.observationId === id)?.status ?? '没取到')
      const counts = [...new Set(xs)].map(st => `${st}${xs.filter(x => x === st).length > 1 ? ` ×${xs.filter(x => x === st).length}` : ''}`)
      return `${v.candidateId} ${counts.join(' / ')}`
    }).join('；')
    return {
      id: `${record.id}:${setup}:${k}`, supports: r.supports, refutes: r.refutes, consistentWith: r.consistentWith, purpose: r.purpose,
      observation: {
        gameVersion: versionOf(o), ...(o.condition?.recordedAt ? { recordedAt: o.condition.recordedAt } : {}),
        condition: ids.length === 1 ? `${o.id}：${conditionText(o)}` : `${ids.join('、')}（各条的条件见 docs/calibration/points.yaml）`,
      },
      ...(runId ? { simulationRunId: runId } : {}),
      summary: `${ids.length} 条观测：${status}`, ref: `docs/evidence/${record.id}.yaml`,
    }
  })
}

/** 台账的用途约束（DD-08 §4.3；tests/propositions.test.ts）：supported 的命题要有 independent_validation 且 supports 含当前采用候选的证据；
 *  同一条证据里一个候选不能同时在两种关系里；关系里的候选要是这条命题的 */
export function evidenceViolations(p: Proposition): string[] {
  const out: string[] = []
  if (p.conclusion === 'supported' && !p.evidence.some(e => isIndependent(e.purpose) && e.supports.includes(p.adopted)))
    out.push(`${p.id}：结论 supported，却没有 independent_validation 且 supports 含 ${p.adopted} 的证据（只有选模材料的最多 provisional）`)
  const ids = new Set(p.candidates.map(c => c.id))
  for (const e of p.evidence) {
    const all = [...e.supports, ...e.refutes, ...e.consistentWith]
    if (new Set(all).size !== all.length) out.push(`${p.id} / ${e.id}：同一个候选出现在两种关系里`)
    for (const c of all) if (!ids.has(c)) out.push(`${p.id} / ${e.id}：${c} 不是这条命题的候选`)
  }
  return out
}

// ---------------------------------------------------------------------------
// 采用决定之后的重跑（DD-08 §4.2 rerun；DF-17）

export interface RerunOutput {
  readonly reruns: ClosureRecord['reruns']
  readonly identities: ReadonlyMap<string, RunIdentity>
  readonly affected: readonly { readonly scenario: string; readonly why: string }[]
  readonly problems: readonly string[]
  /** 没有要重跑的场景时说明为什么（scenario 绑定：采用的是轴的输入，DD-09 §5） */
  readonly note?: string
}

const sideOf = (res: SimResult): ClosureRecord['reruns'][number]['before'] => {
  const u = usableBasis(res)
  return { runId: res.runId, status: res.completion.status as RunStatus, dps: u.ok ? u.basis.dps : null, steadyLoopBattleFrames: u.ok ? steadyFrames(res) : null }
}

/** 采用决定填好之后：在同一份当前代码上，对每个受影响的场景跑两次——采用前的值与采用后的值都显式写进 RunOverrides。
 *  受影响：purpose 为 rotation 的场景里，基准运行的 ruleUsage 中这条命题 decisiveCount > 0，或 summary.assumptions 碰到对应假设。
 *  命题既没有登记判定点（rule-points.ts）、也没有对应的假设时，这两条永远找不到场景：改按 appliesToChars（队里有这些角色的场景），
 *  都没有就没有受影响的场景（DD-08 §9 的实施记录）。
 *  defaultChanged 为假时两次应当相同，照样跑并核对；变了记进 problems（命令以非零退出）。scenarios：文件名（相对 scenarios/）→ 场景 */
export function rerunClosure(record: ClosureRecord, p: Proposition, data: GameData, scenarios: ReadonlyMap<string, Scenario>, environment?: RunEnvironment): RerunOutput {
  const d = record.decision
  if (!d) throw new EvidenceError(`${record.id}：还没有采用决定（decision），先由人填`)
  checkCandidates(record, p)
  const problems: string[] = []
  if (p.adopted !== d.adopted) problems.push(`台账 ${p.id} 采用的还是 ${p.adopted}，与采用决定的 ${d.adopted} 不一致：先改 propositions.ts 与规则的缺省值`)
  const before = candidateOf(p, d.adoptedBefore), after = candidateOf(p, d.adopted)
  if (!before || !after) throw new EvidenceError(`${record.id}：采用决定里的候选 ${d.adoptedBefore} / ${d.adopted} 不在台账里`)
  // scenario 绑定（DD-09 §5）：采用前后各是一份场景，改的是那一份场景的输入，引擎的缺省没变——没有别的场景要重跑；
  // 两份场景各自的运行 predict 已经跑过（runs 里有 runId）
  if (before.binding.kind === 'scenario' || after.binding.kind === 'scenario') {
    if (d.defaultChanged) problems.push(`${d.adoptedBefore} → ${d.adopted} 是轴的输入（scenario 绑定），引擎的缺省没变：defaultChanged 应为 false`)
    return { reruns: [], identities: new Map(), affected: [], problems, note: `${d.adoptedBefore} → ${d.adopted} 改的是轴的输入（scenario 绑定，采用的场景 ${after.binding.kind === 'scenario' ? after.binding.path! : '—'}）：引擎的缺省没变，没有要重跑的场景；采用前后两份场景的运行见 predict 的 runs` }
  }
  let ovBefore = overridesFor(before), ovAfter = overridesFor(after)
  if (ovBefore === null || ovAfter === null) throw new EvidenceError(`${record.id}：采用前后的候选要能跑（${d.adoptedBefore} → ${d.adopted}）`)
  const flippable = (c: Candidate) => c.binding.kind === 'rule' || c.binding.kind === 'option'
  if (before.id !== after.id && !(flippable(before) && flippable(after))) {
    problems.push(`${d.adoptedBefore} / ${d.adopted} 的绑定不能经覆盖翻（curated / hook），两次都照当前代码跑；跨代码版本的变化看登记时的身份`)
    ovBefore = ovAfter = {}
  }
  const env = environment ? { environment } : {}
  const instrumented = p.assumptionId !== undefined || RULE_POINTS.some(x => x.propositionId === p.id)
  const identities = new Map<string, RunIdentity>()
  const affected: { scenario: string; why: string }[] = []
  const reruns: ClosureRecord['reruns'] = []
  for (const [file, sc] of [...scenarios].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (sc.purpose !== 'rotation') continue
    const base = prepareRun(sc, data, env)
    if (!base.ok) { problems.push(`${file}：准备不了（${base.issues.map(i => i.message).join('；')}）`); continue }
    const res = runPrepared(base.run)
    const decisive = res.ruleUsage.byProposition.find(x => x.propositionId === p.id)?.decisiveCount ?? 0
    const hit = p.assumptionId !== undefined && res.summary.assumptions.some(a => a.id === p.assumptionId)
    const byChars = !instrumented && (p.appliesToChars ?? []).some(c => base.run.resolved.team.some(m => m.def.name === c))
    if (decisive === 0 && !hit && !byChars) continue
    affected.push({ scenario: file, why: [decisive > 0 ? `规则使用 decisive ${decisive} 次` : '', hit ? `碰到假设 ${p.assumptionId}` : '', byChars ? `队里有 ${p.appliesToChars!.join('、')}（命题没有判定点与假设）` : ''].filter(Boolean).join('，') })
    const run = (ov: RunOverrides) => {
      const prep = prepareRun(sc, data, { ...ov, ...env })
      if (!prep.ok) throw new EvidenceError(`${file}：${prep.issues.map(i => i.message).join('；')}`)
      const r = runPrepared(prep.run)
      identities.set(r.runId, r.identity)
      return r
    }
    const b = run(ovBefore), a = run(ovAfter)
    const changed = digestOf(b.log) !== digestOf(a.log) || digestOf(b.summary) !== digestOf(a.summary)
    reruns.push({ scenario: file, before: sideOf(b), after: sideOf(a), changed })
    if (changed && !d.defaultChanged) problems.push(`${file}：defaultChanged 为 false，采用前后两次运行却不同`)
  }
  return { reruns, identities, affected, problems }
}
