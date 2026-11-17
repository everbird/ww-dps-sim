// src/analysis/observations.ts —— 观测与仿真的比较（DD-03 §4.2 的六种状态；DD-08 §3.2；架构 §10.1–§10.2）。④ 分析层。
// 两步分开：readObservation 从一次运行里取出观测对应的仿真值（取不到时说明为什么、是不是运行提前停了）；compareValue 拿一个值与观测的读数比。
// compareValue 是纯函数，闭环的 judge 拿冻结的预测值直接调它（DD-08 §4.2），不重跑仿真；compareObservations 是对一次运行的包装，
// 结果带信封（架构 §2.7）。旧的 calibrate()（面板、跳字、时长）是这里的薄包装（calibration.ts）。
import { toleranceOf, type EventSelector, type Observation } from '../data/calibration.schema'
import { splitVideoLine, type VideoPurpose } from '../data/replay'
import { videoTime, type Scenario } from '../data/scenario.schema'
import type { ResourceKind } from '../data/common'
// DD-10 §5：分析层只经显式公开入口调用执行与查询。
import { battleFrameOf, envelope, runPrepared, type EventMeta, type InterventionRecord, type ResourceLedgerEntry, type PreparedRun, type RunCompletion, type QueryEnvelope, type ResolvedMember, type ResolvedScenario, type SimEvent, type SimResult } from '../engine'
import { loopSpan, traceHits, tracePanel } from './trace'

/** 比较结果的状态（架构 §10.2；DD-08 §3.2 的表）：passed 落在读数（加容差）里；conflicted 落在外面、类别不同；unmatched 选择器在日志里
 *  找不到对应的事件（名字错、轮次不够、运行在那之前停了）；ambiguous 跳字分支未知而至少一支相容、或同一帧有几条分不清的事件；
 *  insufficientCondition 观测声明必需的条件（requires）在 condition.unknowns 里；unassessable 还没有实测值 */
export type ComparisonStatus =
  | 'passed'
  | 'conflicted'
  | 'unmatched'
  | 'ambiguous'
  | 'insufficientCondition'
  | 'unassessable'

/** 一条观测的预测值（DD-08 §4.1）：数（面板、时长、间隔、资源），[不暴击, 暴击]（跳字），类别 'intro' / 'normal'（切人类型）；取不到为 null */
export type Predicted = number | readonly [number, number] | string | null
export type PredictedValue = Exclude<Predicted, null>

export interface BranchResidual {
  readonly sim: number
  readonly diff: number
  readonly within: boolean
}

export type ResidualKind = 'relative' | 'absoluteFrames' | 'categorical'

export interface ObservationComparison {
  readonly observationId: string
  readonly status: ComparisonStatus
  readonly sim: readonly number[] | string | null      // 数值、类别，或取不到
  readonly residual: number | null                     // 相对差（relative）、帧差（absoluteFrames）、类别对不对（categorical：0 对、1 不对）
  readonly residualKind: ResidualKind | null
  readonly branches?: { readonly nonCrit: BranchResidual; readonly crit: BranchResidual }   // 跳字
  readonly reason?: string                             // unmatched / ambiguous / insufficientCondition / unassessable 时必填
}

export type ComparisonCore = Omit<ObservationComparison, 'observationId'>

// ---------------------------------------------------------------------------
// 比较（纯函数）

export interface CompareOptions {
  /** 同一帧有几条事件都满足选择器、各自的值（含 predicted 本身之外的那几个）：值不同时结果是 ambiguous 或 conflicted */
  readonly alternatives?: readonly PredictedValue[]
  /** predicted 为 null 时说明为什么取不到 */
  readonly missingReason?: string
}

const simOf = (v: Predicted): readonly number[] | string | null =>
  v === null ? null : typeof v === 'number' ? [v] : typeof v === 'string' ? v : [v[0], v[1]]

/** 观测有没有读数：switchType 看 expect，其余看 game / gameRange */
export const hasReading = (o: Observation): boolean =>
  o.kind === 'switchType' ? o.expect !== null : o.game !== null || o.gameRange !== undefined

/** 观测必需、却在 unknowns 里的条件 */
export const missingConditions = (o: Observation): string[] =>
  o.requires.filter(r => o.condition?.unknowns.includes(r))

function relDiff(sim: number, target: number): number {
  return target !== 0 ? sim / target - 1 : sim - target
}

/** 相对容差：点值按相对差；区间内为 0，区间外按较近的端点算 */
export function relativeResidual(sim: number, game: number | null, range: readonly [number, number] | undefined, tol: number): BranchResidual {
  if (game !== null) {
    const diff = relDiff(sim, game)
    return { sim, diff, within: Math.abs(diff) <= tol }
  }
  const [lo, hi] = range!
  if (sim >= lo && sim <= hi) return { sim, diff: 0, within: true }
  const diff = sim < lo ? relDiff(sim, lo) : relDiff(sim, hi)
  return { sim, diff, within: Math.abs(diff) <= tol }
}

/** interval 的帧差：观测的单位换成帧（unit: seconds 时 × 60），区间内为 0、区间外按较近的端点；容差是绝对的帧数 */
function frameResidual(o: Extract<Observation, { kind: 'interval' }>, sim: number, tol: number): BranchResidual {
  const toF = (x: number) => (o.unit === 'seconds' ? x * 60 : x)
  const s = toF(sim)
  let diff: number
  if (o.game !== null) diff = s - toF(o.game)
  else {
    const [lo, hi] = o.gameRange!.map(toF) as [number, number]
    diff = s < lo ? s - lo : s > hi ? s - hi : 0
  }
  diff = Math.round(diff * 1e6) / 1e6                  // 秒 × 60 的浮点误差
  return { sim, diff, within: Math.abs(diff) <= tol + 1e-9 }
}

/** 一个数值与观测的读数比（不含跳字） */
function numericResidual(o: Observation, v: number): BranchResidual {
  const tol = toleranceOf(o)
  if (o.kind === 'interval') return frameResidual(o, v, tol)
  return relativeResidual(v, o.game, o.gameRange, tol)
}

/** 拿一个值（仿真值或冻结的预测值）与观测的读数比（DD-08 §3.2）。先看条件够不够、取不取得到、有没有读数，再按种类比 */
export function compareValue(o: Observation, predicted: Predicted, opts: CompareOptions = {}): ComparisonCore {
  const sim = simOf(predicted)
  const lack = missingConditions(o)
  if (lack.length > 0) return { status: 'insufficientCondition', sim, residual: null, residualKind: null, reason: `条件不足：${lack.join('、')}不知道（观测 requires 了它）` }
  if (predicted === null) return { status: 'unmatched', sim: null, residual: null, residualKind: null, reason: opts.missingReason ?? '仿真里取不到' }
  if (!hasReading(o)) return { status: 'unassessable', sim, residual: null, residualKind: null, reason: '还没有实测值' }

  if (o.kind === 'switchType') {
    if (typeof predicted !== 'string') return { status: 'unmatched', sim, residual: null, residualKind: null, reason: '切人类型的预测应是 intro 或 normal' }
    const same = predicted === o.expect
    return { status: same ? 'passed' : 'conflicted', sim, residual: same ? 0 : 1, residualKind: 'categorical' }
  }
  if (o.kind === 'hit') {
    if (typeof predicted === 'number' || typeof predicted === 'string')
      return { status: 'unmatched', sim, residual: null, residualKind: null, reason: '跳字的预测应是 [不暴击, 暴击]' }
    const tol = toleranceOf(o)
    const nonCrit = relativeResidual(predicted[0], o.game, o.gameRange, tol)
    const crit = relativeResidual(predicted[1], o.game, o.gameRange, tol)
    const branches = { nonCrit, crit }
    if (o.branch === 'nonCrit' || o.branch === 'crit') {
      const picked = branches[o.branch]
      return { status: picked.within ? 'passed' : 'conflicted', sim, residual: picked.diff, residualKind: 'relative', branches }
    }
    if (nonCrit.within || crit.within) {
      const which = [nonCrit.within ? '不暴击' : '', crit.within ? '暴击' : ''].filter(Boolean).join('、')
      return { status: 'ambiguous', sim, residual: null, residualKind: 'relative', branches, reason: `分支未知：${which}一支在容差内` }
    }
    return { status: 'conflicted', sim, residual: null, residualKind: 'relative', branches }
  }
  if (typeof predicted !== 'number') return { status: 'unmatched', sim, residual: null, residualKind: null, reason: '这种观测的预测应是一个数' }
  const kind: ResidualKind = o.kind === 'interval' ? 'absoluteFrames' : 'relative'
  const main = numericResidual(o, predicted)
  const others = (opts.alternatives ?? []).filter((x): x is number => typeof x === 'number' && x !== predicted)
  if (others.length === 0) return { status: main.within ? 'passed' : 'conflicted', sim, residual: main.diff, residualKind: kind }
  // 同一帧有几条分不清的事件、值不同（DD-08 §3.2 的 ambiguous 第二种）：有一个在容差内就是 ambiguous，都不在是 conflicted
  const all = [main, ...others.map(v => numericResidual(o, v))]
  const values = [predicted, ...others].join(' / ')
  if (all.some(x => x.within)) return { status: 'ambiguous', sim, residual: null, residualKind: kind, reason: `同一帧有 ${all.length} 条事件都满足选择器，值分别是 ${values}，分不清是哪一条` }
  const best = all.reduce((a, b) => (Math.abs(b.diff) < Math.abs(a.diff) ? b : a))
  return { status: 'conflicted', sim, residual: best.diff, residualKind: kind, reason: `同一帧有 ${all.length} 条事件都满足选择器（值 ${values}），都在容差外` }
}

// ---------------------------------------------------------------------------
// 从一次运行里取观测对应的仿真值

/** 取值要用的运行材料：装配结果与日志必有；completion 给了时，运行提前停下的 unmatched 带上完成状态、记"没覆盖到"；
 *  resourceAt 另要资源账本与事件来源（DD-06、DD-05 的诊断），账本里有状态同步时还要外部干预记录（同步的位置在那里） */
export interface ObservationSource {
  readonly resolved: ResolvedScenario
  readonly log: readonly SimEvent[]
  readonly completion?: RunCompletion
  readonly ledger?: readonly ResourceLedgerEntry[]
  readonly meta?: readonly EventMeta[]
  readonly interventions?: readonly InterventionRecord[]
}

/** 取到的仿真值；alternatives：同一帧还有几条分不清的事件时它们的值。取不到时 covered 说明这条观测在不在运行的覆盖范围里
 *  （运行提前停了、事件还没发生 = false；跑完了还找不到 = true，多半是名字写错） */
export type SimReading =
  | { readonly ok: true; readonly value: PredictedValue; readonly alternatives?: readonly PredictedValue[] }
  | { readonly ok: false; readonly reason: string; readonly covered: boolean }

const stoppedEarly = (c: RunCompletion | undefined): boolean => c !== undefined && c.status !== 'completed'
const completionNote = (c: RunCompletion): string =>
  `运行 ${c.status}，${c.coverage.loopExitAt.reason} 停在世界帧 ${c.coverage.loopExitAt.worldFrame}`

/** 选择器说的是哪条事件（给报错用） */
export function describeSelector(s: EventSelector): string {
  const who = [s.char, s.action, s.judgment, s.buff].filter(Boolean).join(' ')
  return `${s.loop !== undefined ? `第 ${s.loop} 轮 ` : ''}${who ? `${who} 的` : ''}第 ${s.nth} 个 ${s.type}`
}

const memberOf = (r: ResolvedScenario, char: string): ResolvedMember | undefined => r.team.find(m => m.def.name === char)
/** 写的动作名就是 ID，或是这个角色的别名（中文键原样比，不做模糊匹配） */
const actionIs = (r: ResolvedScenario, char: string, id: string, written: string): boolean =>
  written === id || memberOf(r, char)?.aliases[written] === id

function eventMatches(e: SimEvent, s: EventSelector, r: ResolvedScenario): boolean {
  if (e.type !== s.type) return false
  switch (e.type) {
    case 'actionStart':
    case 'intro':
      return (s.char === undefined || e.char === s.char) && (s.action === undefined || actionIs(r, e.char, e.action, s.action))
    case 'hit':
      return (s.char === undefined || e.char === s.char) && (s.action === undefined || actionIs(r, e.char, e.action, s.action))
        && (s.judgment === undefined || e.judgment === s.judgment)
    case 'switch': return s.char === undefined || e.to === s.char
    case 'outro': return s.char === undefined || e.char === s.char
    case 'buffApply':
    case 'buffExpire':
      return (s.char === undefined || e.target === s.char) && (s.buff === undefined || e.buff === s.buff)
    default: return false
  }
}

/** 第 loop 轮在日志里的下标范围 [本轮 loop 事件, 下一轮 loop 事件) */
function loopRange(log: readonly SimEvent[], loop: number): [number, number] | null {
  const i = log.findIndex(e => e.type === 'loop' && e.loop === loop)
  if (i < 0) return null
  const j = log.findIndex((e, k) => k > i && e.type === 'loop')
  return [i, j < 0 ? log.length : j]
}

/** 选中的事件：index 是日志下标；peers 是同一世界帧里也满足选择器的其他事件（数第几个时分不清它们） */
export interface SelectedEvent { readonly index: number; readonly peers: readonly number[] }

/** 按选择器在日志里找事件；after：只看这个下标之后的（interval 的 to 从 from 之后数起）。找不到返回说明 */
export function selectEvent(s: EventSelector, log: readonly SimEvent[], r: ResolvedScenario, after = -1): SelectedEvent | string {
  let lo = 0, hi = log.length
  if (s.loop !== undefined) {
    const range = loopRange(log, s.loop)
    if (!range) return `${describeSelector(s)}：日志里没有第 ${s.loop} 轮`
    ;[lo, hi] = range
  }
  const found: number[] = []
  for (let i = Math.max(lo, after + 1); i < hi; i++) if (eventMatches(log[i]!, s, r)) found.push(i)
  const index = found[s.nth - 1]
  if (index === undefined) return `${describeSelector(s)}：只找到 ${found.length} 个`
  return { index, peers: found.filter(i => i !== index && log[i]!.f === log[index]!.f) }
}

/** 角色的资源名 → ResourceKind：energy、concerto 原样；核心资源按角色的 coreResources 的名字 */
function resourceKindOf(m: ResolvedMember, name: string): ResourceKind | null {
  if (name === 'energy' || name === 'concerto') return name
  const c = m.def.coreResources.find(x => x.name === name)
  return c ? (`core${c.slot}` as ResourceKind) : null
}

/** 账本里某人某资源在第 index 条事件前后的余额（DD-08 §3.2）。条目的位置取它关联的业务事件（relatedEventSeq）；
 *  状态同步（DD-09 §3.2）不写日志，位置取它的干预记录：排在 afterEventSeq 那条事件之后、下一条之前（记成 afterEventSeq + 0.5）。
 *  不能沿用上一条条目的位置：第 70 帧才做的同步会被当成第 2 帧那笔账的位置，污染它之后任何事件的"之前"（Codex 审查 F1）。
 *  没关联的条目（期初、实际变化为 0 的单人写入）不改余额。before：位置在事件之前的最后一条；after：位置是这条事件、或同一世界帧里
 *  由它直接引出（事件来源的 directParentSeq / subjectSeq 指向集合里的事件）的最后一条，没有就等于 before（同步不是事件引出的，不算 after） */
function balanceAround(
  ledger: readonly ResourceLedgerEntry[], meta: readonly EventMeta[] | undefined, log: readonly SimEvent[],
  slot: number, res: ResourceKind, index: number, when: 'before' | 'after', interventions?: readonly InterventionRecord[],
): { value: number; cap: number } | string {
  const chain = ledger.filter(e => e.slot === slot && e.resource === res)
  const opening = chain.find(e => e.kind === 'initial')
  if (!opening) return '账本里没有这个资源的期初条目'
  let caused: Set<number> | null = null
  if (when === 'after') {
    if (!meta) return 'after 要事件来源（diag.eventMeta）'
    caused = new Set([index])
    const f = log[index]!.f
    for (let i = index + 1; i < log.length && log[i]!.f === f; i++) {
      const m = meta[i]
      if (m && ((m.directParentSeq !== undefined && caused.has(m.directParentSeq)) || (m.subjectSeq !== undefined && caused.has(m.subjectSeq)))) caused.add(i)
    }
  }
  let before = opening.after, after: number | null = null
  for (const e of chain) {
    if (e.kind === 'initial') continue
    let pos: number
    if (e.relatedEventSeq !== undefined) pos = e.relatedEventSeq
    else if (e.relatedInterventionIndex !== undefined) {
      const rec = interventions?.[e.relatedInterventionIndex]
      if (!rec) return '账本里有状态同步的条目：要外部干预记录（SimResult.interventions）才定得了它在事件之间的位置'
      pos = rec.afterEventSeq + 0.5
    } else if (e.actualDelta === 0) continue
    else return `账本条目 #${e.index} 变了余额，却没有关联业务事件或干预记录（写入点漏接了账本，DD-06）`
    if (pos < index) before = e.after
    else if (caused?.has(pos)) after = e.after
  }
  return { value: when === 'before' ? before : after ?? before, cap: opening.cap }
}

/** 取观测对应的仿真值（DD-08 §3.1 的七种） */
export function readObservation(o: Observation, src: ObservationSource): SimReading {
  const { resolved: r, log, completion } = src
  const early = stoppedEarly(completion)
  const miss = (reason: string, couldBeLater: boolean): SimReading =>
    couldBeLater && early ? { ok: false, reason: `${reason}（${completionNote(completion!)}）`, covered: false } : { ok: false, reason, covered: true }
  switch (o.kind) {
    case 'panel': {
      const row = tracePanel(r, o.char).find(x => x.item === o.item)
      return row ? { ok: true, value: row.value } : miss(`${o.char} 的面板里没有"${o.item}"（pnpm trace <场景> 的面板表）`, false)
    }
    case 'hit': {
      const rows = traceHits(log, o.loop, o.char).filter(x => x.judgment === o.judgment)
      const row = rows[o.nth - 1]
      return row ? { ok: true, value: [row.nonCrit, row.crit] } : miss(`第 ${o.loop} 轮 ${o.char} 的"${o.judgment}"只有 ${rows.length} 下`, true)
    }
    case 'loop': {
      const span = loopSpan(log, o.loop)
      if (!span) return miss(`没有第 ${o.loop} 轮`, true)
      // 运行没跑完时，最后一轮的终点是日志的最后一条，不是这一轮真的结束（DD-01 的 roundEnds 只记结束边界已确认的轮）
      if (completion && !completion.loops.roundEnds.some(e => e.loop === o.loop)) return miss(`第 ${o.loop} 轮没有走完`, true)
      // DD-03 §3：显式区分战斗时钟（受全局时停影响）与世界时钟（60fps 墙钟帧/60）
      return { ok: true, value: o.clock === 'world' ? (span.endF - span.f) / 60 : span.endT - span.t }
    }
    case 'interval': {
      const a = selectEvent(o.from, log, r)
      if (typeof a === 'string') return miss(`from ${a}`, true)
      const b = selectEvent(o.to, log, r, a.index)
      if (typeof b === 'string') return miss(`to（从 from 之后数）${b}`, true)
      const ea = log[a.index]!, eb = log[b.index]!
      const frames = o.clock === 'world' ? eb.f - ea.f : battleFrameOf(eb) - battleFrameOf(ea)
      return { ok: true, value: o.unit === 'seconds' ? frames / 60 : frames }
    }
    case 'resourceAt': {
      const m = memberOf(r, o.char)
      if (!m) return miss(`${o.char} 不在队伍里`, false)
      const res = resourceKindOf(m, o.resource)
      if (!res) return miss(`${o.char} 没有资源"${o.resource}"（能写 energy、concerto 或核心资源名：${m.def.coreResources.map(c => c.name).join('、') || '无'}）`, false)
      if (!src.ledger) return { ok: false, reason: 'resourceAt 要资源账本（带 diag.resourceLedger 跑）', covered: true }
      const at = selectEvent(o.at, log, r)
      if (typeof at === 'string') return miss(`at ${at}`, true)
      const values: number[] = []
      for (const i of [at.index, ...at.peers]) {
        const b = balanceAround(src.ledger, src.meta, log, m.slot, res, i, o.when, src.interventions)
        if (typeof b === 'string') return { ok: false, reason: b, covered: true }
        if (o.as === 'ratio' && !Number.isFinite(b.cap)) return miss(`${o.char} 的"${o.resource}"没有上限，不能按比例`, false)
        values.push(o.as === 'ratio' ? b.value / b.cap : b.value)
      }
      const [value, ...alternatives] = values as [number, ...number[]]
      return alternatives.some(v => v !== value) ? { ok: true, value, alternatives } : { ok: true, value }
    }
    case 'switchType': {
      const at = selectEvent(o.at, log, r)
      if (typeof at === 'string') return miss(`at ${at}`, true)
      const e = log[at.index]!
      return e.type === 'switch' ? { ok: true, value: e.intro ? 'intro' : 'normal' } : miss('选中的不是切人事件', false)
    }
  }
}

/** 一条观测对一次运行：取值，再比 */
export function compareOne(o: Observation, src: ObservationSource): ObservationComparison {
  const x = readObservation(o, src)
  const c = x.ok ? compareValue(o, x.value, x.alternatives ? { alternatives: x.alternatives } : {}) : compareValue(o, null, { missingReason: x.reason })
  return { observationId: o.id, ...c }
}

/** 信封里的 observationSummary：按四类计数（架构 §2.7） */
export function observationSummary(rows: readonly { readonly status: ComparisonStatus }[]): NonNullable<QueryEnvelope<unknown>['capability']['observationSummary']> {
  const n = (...s: ComparisonStatus[]) => rows.filter(x => s.includes(x.status)).length
  return { passed: n('passed'), conflicted: n('conflicted'), unmatchedOrAmbiguous: n('unmatched', 'ambiguous'), insufficientOrUnassessable: n('insufficientCondition', 'unassessable') }
}

/** 一次运行对一组观测（DD-08 §3.2；架构 §2.5）。res 要是 p 跑出来的；有 resourceAt 而结果里没有账本与事件来源时，经同一个 PreparedRun
 *  带诊断重跑一次取（架构 §2.5：诊断关着时需要诊断记录的查询这样取，诊断不改变运行，DD-05 的零干扰） */
export function compareObservations(p: PreparedRun, res: SimResult, observations: readonly Observation[]): QueryEnvelope<readonly ObservationComparison[]> {
  if (res.runId !== p.runId) throw new Error(`compareObservations：结果的 runId ${res.runId} 不是这个 PreparedRun 的（${p.runId}）`)
  const used = ['compareObservations']
  let ledger = res.diag?.resourceLedger, meta = res.diag?.eventMeta
  if (observations.some(o => o.kind === 'resourceAt') && (!ledger || !meta)) {
    const again = runPrepared(p, { diag: { resourceLedger: true, eventMeta: true } })
    ledger = again.diag!.resourceLedger
    meta = again.diag!.eventMeta
    used.push('diag.resourceLedger', 'diag.eventMeta')
  }
  const src: ObservationSource = {
    resolved: p.resolved, log: res.log, completion: res.completion, interventions: res.interventions, ...(ledger ? { ledger } : {}), ...(meta ? { meta } : {}),
  }
  const data = observations.map(o => compareOne(o, src))
  const env = envelope(p, res, data, used, [])
  return { ...env, capability: { ...env.capability, observationSummary: observationSummary(data) } }
}

// ---------------------------------------------------------------------------
// 录像观测（DD-09 §4.1）：场景 video 块里的每条读数是一条有固定 ID 的观测。ID = 通道 + 它在原场景列表里的位置（从 1 数）；
// 变体不改 video，所以 ID 在变体之间稳定。按位置生成的 ID 只保证同一批候选之间对得上，不证明两份观测的内容相同（报告身份另算摘要）。

/** 七个通道：切人、前台动作、后台来源（召唤、阵、延奏）、单下跳字、boss 血条、协奏环、回路条上的核心资源 */
export type Channel = 'switch' | 'action' | 'summon' | 'hit' | 'hp' | 'concerto' | 'core'
export const CHANNELS: readonly Channel[] = ['switch', 'action', 'summon', 'hit', 'hp', 'concerto', 'core']
/** 要按事件一对一匹配的通道（其余三个取那一刻的值） */
export const EVENT_CHANNELS: readonly Channel[] = ['switch', 'action', 'summon', 'hit']

interface VideoObsBase { readonly id: string; readonly t: number; readonly purpose: VideoPurpose }
export type VideoObservation =
  /** reference：切人类型的参照来自哪里——video 是录像读数（video.switches），scenario 是过渡期从原场景的写法冻结的（DD-09 §4.3） */
  | (VideoObsBase & { readonly channel: 'switch'; readonly from: string; readonly to: string; readonly type: 'intro' | 'normal' | null; readonly reference: 'video' | 'scenario' })
  | (VideoObsBase & { readonly channel: 'action' | 'summon'; readonly char: string; readonly action: string })
  | (VideoObsBase & { readonly channel: 'hit'; readonly char: string; readonly judgment: string; readonly value: number; readonly branch: 'crit' | 'nonCrit' | 'unknown' })
  | (VideoObsBase & { readonly channel: 'hp'; readonly left: number; readonly enemy: string | null })
  | (VideoObsBase & { readonly channel: 'concerto'; readonly char: string; readonly ratio: number })
  | (VideoObsBase & { readonly channel: 'core'; readonly char: string; readonly resource: string; readonly ratio: number })

type VideoBlock = NonNullable<Scenario['video']>

/** 过渡期的切人参照（DD-09 §4.3）：场景还没写 video.switches 时，由原场景在生成变体之前冻结——marks 指到的切人那一条，
 *  时刻是 mark 的视频秒，类型按"写了变奏的应是变奏、没写的应是普通"。所有变体共用这一份 */
export interface FrozenSwitch { readonly line: number; readonly t: number; readonly from: string; readonly to: string; readonly type: 'intro' | 'normal' }

export function frozenSwitches(r: Pick<ResolvedScenario, 'team' | 'initial' | 'commands' | 'opening'>, video: VideoBlock): FrozenSwitch[] {
  const list = video.loop === 0 ? r.opening : r.commands
  let cur: number = r.initial.onField
  if (video.loop !== 0) for (const c of r.opening) if (c.kind === 'switch') cur = c.to
  const out: FrozenSwitch[] = []
  const seen = new Set<number>()
  for (const c of list) {
    if (c.kind !== 'switch') continue
    const mark = video.marks[String(c.line)]
    if (mark !== undefined && !seen.has(c.line)) {
      seen.add(c.line)
      out.push({ line: c.line, t: videoTime(mark), from: r.team[cur]!.def.name, to: r.team[c.to]!.def.name, type: c.expectIntro ? 'intro' : 'normal' })
    }
    cur = c.to
  }
  return out
}

/** video 块 → 观测列表（按通道、列表位置）。frozen：没写 video.switches 时用的过渡参照（frozenSwitches）；写了 switches 就不用它 */
export function videoObservations(video: VideoBlock, frozen: readonly FrozenSwitch[] = []): VideoObservation[] {
  const out: VideoObservation[] = []
  if (video.switches?.length) {
    video.switches.forEach((line, i) => {
      const x = splitVideoLine(line)
      const [pair, type] = x.tokens as [string, string | undefined]
      const [from, to] = pair.split(/→|->/) as [string, string]
      out.push({ id: `switch#${i + 1}`, channel: 'switch', t: x.t, purpose: x.purpose, from, to, type: type === 'intro' || type === 'normal' ? type : null, reference: 'video' })
    })
  } else {
    for (const s of frozen) out.push({ id: `switch#m${s.line}`, channel: 'switch', t: s.t, purpose: 'score', from: s.from, to: s.to, type: s.type, reference: 'scenario' })
  }
  ;(video.events ?? []).forEach((line, i) => {
    const x = splitVideoLine(line)
    const [char, act] = x.tokens as [string, string]
    const summon = act.startsWith('@')
    out.push({ id: `${summon ? 'summon' : 'action'}#${i + 1}`, channel: summon ? 'summon' : 'action', t: x.t, purpose: x.purpose, char, action: summon ? act.slice(1) : act })
  })
  ;(video.hits ?? []).forEach((line, i) => {
    const x = splitVideoLine(line)
    const [char, judgment, value, branch] = x.tokens as [string, string, string, string | undefined]
    out.push({ id: `hit#${i + 1}`, channel: 'hit', t: x.t, purpose: x.purpose, char, judgment, value: Number(value), branch: branch === 'crit' || branch === 'nonCrit' ? branch : 'unknown' })
  })
  ;(video.hp ?? []).forEach((line, i) => {
    const x = splitVideoLine(line)
    out.push({ id: `hp#${i + 1}`, channel: 'hp', t: x.t, purpose: x.purpose, left: Number(x.tokens[0]), enemy: x.tokens[1] ?? null })
  })
  ;(video.concerto ?? []).forEach((line, i) => {
    const x = splitVideoLine(line)
    out.push({ id: `concerto#${i + 1}`, channel: 'concerto', t: x.t, purpose: x.purpose, char: x.tokens[0]!, ratio: Number(x.tokens[1]) })
  })
  ;(video.core ?? []).forEach((line, i) => {
    const x = splitVideoLine(line)
    out.push({ id: `core#${i + 1}`, channel: 'core', t: x.t, purpose: x.purpose, char: x.tokens[0]!, resource: x.tokens[1]!, ratio: Number(x.tokens[2]) })
  })
  return out
}

// ---------------------------------------------------------------------------
// 一对一、保序的匹配（DD-09 §4.2，DF-18）：一个通道里的观测与仿真事件各按时刻排成一列；能不能配由调用方的 allowed 决定
// （键相同、时刻差不超过窗口），配上的各对之间不交叉。目标：先让配上的对数最多，对数相同时让时刻差的总和最小（带权的最长公共子序列）。
// 歧义：对每个配上的观测 o（当前配 e），对它的每个其他可配事件 e' 求"强制 o 配 e'"的最优对齐——o 与 e' 把两列各切成前后两段，
// 前段对前段、后段对后段各取最优，再加上 (o, e')；对数等于全局最优、代价不超过最优 + tol 的，o 记 ambiguous，候选列出 e 与这些 e'。
// 实现：正向、反向各做一遍动态规划，得到所有前缀、后缀的最优，每个强制解查表即得，总规模是两列长度之积。
// mayBeUnmatched：存在对数同为最优、代价在阈值内、而 o 落单的对齐（只是说明，不代替上面的检查）。

/** 歧义的阈值（秒）：另一种合法对齐的总时刻差不比最优多这么多 */
export const AMBIGUITY_SECONDS = 0.25
const ALIGN_EPS = 1e-9

export interface Alignment {
  readonly pairs: readonly (number | null)[]                     // 每条观测配到的事件下标；落单为 null
  readonly count: number
  readonly cost: number                                          // 配上的各对时刻差之和
  readonly alternatives: readonly (readonly number[] | null)[]   // 配上的观测：有同样好的另一种配法时，它可配的事件（含当前的）；没有为 null
  readonly mayBeUnmatched: readonly boolean[]
}

/** obsT、evT 各按时刻升序；allowed(i, j)：第 i 条观测能不能配第 j 个事件（键与窗口由调用方判） */
export function alignSequences(obsT: readonly number[], evT: readonly number[], allowed: (i: number, j: number) => boolean, tol = AMBIGUITY_SECONDS): Alignment {
  const n = obsT.length, m = evT.length, W = m + 1
  const at = (i: number, j: number) => i * W + j
  const fc = new Int32Array((n + 1) * W), fd = new Float64Array((n + 1) * W)   // 前缀 O[0, i) × E[0, j) 的最优（对数、代价）
  const bc = new Int32Array((n + 1) * W), bd = new Float64Array((n + 1) * W)   // 后缀 O[i, n) × E[j, m) 的最优
  const ok = new Uint8Array(n * m)
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) ok[i * m + j] = allowed(i, j) ? 1 : 0
  const gap = (i: number, j: number) => Math.abs(evT[j]! - obsT[i]!)
  const better = (c1: number, d1: number, c2: number, d2: number) => c1 > c2 || (c1 === c2 && d1 < d2 - ALIGN_EPS)
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let c = fc[at(i - 1, j)]!, d = fd[at(i - 1, j)]!
    if (better(fc[at(i, j - 1)]!, fd[at(i, j - 1)]!, c, d)) { c = fc[at(i, j - 1)]!; d = fd[at(i, j - 1)]! }
    if (ok[(i - 1) * m + j - 1]) {
      const c2 = fc[at(i - 1, j - 1)]! + 1, d2 = fd[at(i - 1, j - 1)]! + gap(i - 1, j - 1)
      if (better(c2, d2, c, d)) { c = c2; d = d2 }
    }
    fc[at(i, j)] = c; fd[at(i, j)] = d
  }
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    let c = bc[at(i + 1, j)]!, d = bd[at(i + 1, j)]!
    if (better(bc[at(i, j + 1)]!, bd[at(i, j + 1)]!, c, d)) { c = bc[at(i, j + 1)]!; d = bd[at(i, j + 1)]! }
    if (ok[i * m + j]) {
      const c2 = bc[at(i + 1, j + 1)]! + 1, d2 = bd[at(i + 1, j + 1)]! + gap(i, j)
      if (better(c2, d2, c, d)) { c = c2; d = d2 }
    }
    bc[at(i, j)] = c; bd[at(i, j)] = d
  }
  const count = fc[at(n, m)]!, cost = fd[at(n, m)]!
  const same = (c1: number, d1: number, c2: number, d2: number) => c1 === c2 && Math.abs(d1 - d2) <= ALIGN_EPS
  // 回溯一种最优对齐：能配就配（同样好时让后面的观测配后面的事件），否则先丢事件、再丢观测
  const pairs: (number | null)[] = Array.from({ length: n }, () => null)
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (ok[(i - 1) * m + j - 1] && same(fc[at(i, j)]!, fd[at(i, j)]!, fc[at(i - 1, j - 1)]! + 1, fd[at(i - 1, j - 1)]! + gap(i - 1, j - 1))) {
      pairs[i - 1] = j - 1; i--; j--
    } else if (same(fc[at(i, j)]!, fd[at(i, j)]!, fc[at(i, j - 1)]!, fd[at(i, j - 1)]!)) j--
    else i--
  }
  const within = (c: number, d: number) => c === count && d <= cost + tol + ALIGN_EPS
  const alternatives = pairs.map((e, i) => {
    if (e === null) return null
    const alt: number[] = []
    for (let j = 0; j < m; j++) {
      if (j === e || !ok[i * m + j]) continue
      if (within(fc[at(i, j)]! + 1 + bc[at(i + 1, j + 1)]!, fd[at(i, j)]! + gap(i, j) + bd[at(i + 1, j + 1)]!)) alt.push(j)
    }
    return alt.length ? [e, ...alt].sort((a, b) => a - b) : null
  })
  const mayBeUnmatched = pairs.map((e, i) => {
    if (e === null) return false
    for (let s = 0; s <= m; s++) if (within(fc[at(i, s)]! + bc[at(i + 1, s)]!, fd[at(i, s)]! + bd[at(i + 1, s)]!)) return true
    return false
  })
  return { pairs, count, cost, alternatives, mayBeUnmatched }
}
