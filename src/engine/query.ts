// src/engine/query.ts —— 状态查询、试算会话、"为什么没发生"、事件解释、跨运行比较（DD-07 §3–§9；架构 §2.5–§2.7、§3.4、§5、§7）。①D 查询与诊断。
// 纯函数：不读盘、不依赖 DOM / fs / Node 专有模块；需要诊断记录的查询经同一个 PreparedRun 重跑取得。
import type { ActionId, CharName, DilationSide, DilationType, EffectName, Frame, ResourceKind, Slot } from '../data/common'
import type { BuffDef, EnemyStateChange } from '../data/buff.schema'
import type { Command } from '../data/scenario.schema'
import { usableBasis } from './basis'
import type { Sim } from './context'
import { digestOf } from './digest'
import {
  type ActiveBuffContribution, type Diagnostics, type EventMeta, type HitInputs, type ResourceLedgerEntry, type RuleTraceEntry,
} from './diagnostics'
import { roundTo } from './num'
import {
  explainAct, explainExtend, explainFiring, explainSwitch, firstBlockingOf, freezeStateProjection, groupsWouldFire,
  probeEnvOf, readonlyContext, deterministicDelayOf,
  type ConditionCheck, type Occurrence, type TriggerCheckGroup, type TriggerOutcome, type TriggerTarget,
} from './probe'
import { runPrepared, runToExecution } from './run'
import { snapshotAt, snapshotFrom, resumeFrom, type SnapshotCache } from './snapshot'
import type { Inspect } from './simulate'
import type { PreparedRun, RunCompletion, RunOptions, RunStatus, StatePrefix } from './run-types'
import { INTENT_WAITS } from './scheduler'
import { battleFrameOf, hitValue } from './summary'
import { occurrencesOf } from './triggers'
import type {
  ActionRuntime, BuffRuntime, CommandRef, DilationRuntime, EffectRuntime, HookVars, JudgmentRuntime, ReadonlyHookContext,
  ResonanceKind, SimEvent, SimEventType, SimResult, SimState, TailRuntime, TimelineEvent, WaitCode, WaitSegment,
} from './types'
import type { RngState } from './rng'

// ---------------------------------------------------------------------------
// 通用返回类型与错误（DD-07 §3.3；架构 §2.6）

export interface EventHandle {
  readonly runId: string
  readonly eventSeq: number
}

export type QueryError =
  | { readonly code: 'outOfRange'; readonly completedTicks: Frame; readonly message: string }
  | { readonly code: 'noLegalState'; readonly message: string }
  | { readonly code: 'runIdMismatch'; readonly expected: string; readonly got: string }
  | { readonly code: 'eventOutOfRange'; readonly loggedEventEndExclusive: number }
  | { readonly code: 'unsupported'; readonly what: string }

export type QueryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: QueryError }

// ---------------------------------------------------------------------------
// §3.2 重放与停止点

export type StopPoint =
  | { readonly kind: 'boundary'; readonly frame: Frame }
  | { readonly kind: 'boundaries'; readonly frames: readonly Frame[]; readonly onReach: (f: Frame, v: StateView, prefix: StatePrefix) => void }
  | { readonly kind: 'evaluation'; readonly evaluationIndex: number }
  | { readonly kind: 'terminal' }

/** 停在中途得到的前缀：不是一次运行的结果，没有完成状态（DF-10） */
export interface ReplayPrefix {
  readonly kind: 'prefix'
  readonly state: SimState
  readonly sim: Sim
  readonly prefix: StatePrefix
  readonly ledgerEndExclusive?: number
  readonly log: readonly SimEvent[]
  readonly diag?: Diagnostics
}

/** 跑完了的运行：完整的 SimResult 与终态。停止点还没到运行就停了，也返回这个 */
export interface ReplayComplete {
  readonly kind: 'complete'
  readonly result: SimResult
  readonly state: SimState
  readonly sim: Sim
}

export function replayTo(p: PreparedRun, stop: StopPoint, opts: RunOptions = {}, resume?: Inspect['resume']): ReplayPrefix | ReplayComplete {
  if (stop.kind === 'terminal') {
    const { x, result } = runToExecution(p, { ...opts, ...(resume ? { resume } : {}) })
    return { kind: 'complete', result: result!, state: x.s, sim: x.sim }
  }
  if (stop.kind === 'boundary') {
    let captured: { prefix: StatePrefix; ledgerLength: number | null } | null = null
    const { x, result } = runToExecution(p, {
      ...opts, ...(resume ? { resume } : {}),
      observer: {
        frames: new Set([stop.frame]),
        onBoundary: (_f, _s, prefix, ledgerLength) => {
          captured = { prefix, ledgerLength }
          return 'stop'
        },
      },
    })
    if (result === null && captured !== null) {
      const cap = captured as { prefix: StatePrefix; ledgerLength: number | null }
      x.k.diag?.finish(x.s.log, x.k.at.phase)
      return {
        kind: 'prefix',
        state: x.s,
        sim: x.sim,
        prefix: cap.prefix,
        ...(cap.ledgerLength !== null ? { ledgerEndExclusive: cap.ledgerLength } : {}),
        log: [...x.s.log],
        ...(x.k.diag ? { diag: x.k.diag.result() } : {}),
      }
    }
    return { kind: 'complete', result: result!, state: x.s, sim: x.sim }
  }
  if (stop.kind === 'boundaries') {
    const set = new Set(stop.frames)
    const { x, result } = runToExecution(p, {
      ...opts, ...(resume ? { resume } : {}),
      observer: {
        frames: set,
        onBoundary: (f, s, prefix) => {
          stop.onReach(f, viewOf(s), prefix)
        },
      },
    })
    return { kind: 'complete', result: result!, state: x.s, sim: x.sim }
  }
  // stop.kind === 'evaluation'
  const { x, result } = runToExecution(p, {
    ...opts, ...(resume ? { resume } : {}),
    afterEvaluate: (_s, _c, _ref, _v, idx) => (idx === stop.evaluationIndex ? 'stop' : undefined),
  })
  if (result === null) {
    const prefix: StatePrefix = {
      eventEndExclusive: x.s.log.length,
      handledEndExclusive: x.sim.bus.inFlight ?? x.sim.bus.cursor,
      interventionEndExclusive: x.sim.interventions.length,
    }
    const ledgerLength = x.k.diag?.ledgerLength() ?? null
    x.k.diag?.finish(x.s.log, x.k.at.phase)
    return {
      kind: 'prefix',
      state: x.s,
      sim: x.sim,
      prefix,
      ...(ledgerLength !== null ? { ledgerEndExclusive: ledgerLength } : {}),
      log: [...x.s.log],
      ...(x.k.diag ? { diag: x.k.diag.result() } : {}),
    }
  }
  return { kind: 'complete', result, state: x.s, sim: x.sim }
}

// ---------------------------------------------------------------------------
// §3.3 StateView 与状态查询

export interface ActionView {
  readonly id: ActionId
  readonly instance: number
  readonly localFrame: number
  readonly startedAt: number
  readonly cursor: number
  readonly ended: boolean
  readonly coreGranted: readonly [boolean, boolean, boolean]
  readonly cmd?: CommandRef
  readonly skip?: readonly string[]
}

export interface CharView {
  readonly slot: Slot
  readonly name: CharName
  readonly switchCd: Frame
  readonly startedThisTick: boolean
  readonly energy: number
  readonly concerto: number
  readonly core: readonly [number, number, number, number, number]
  readonly cooldowns: Readonly<Record<string, Frame>>
  readonly charges: Readonly<Record<string, { readonly spent: number; readonly every: Frame }>>
  readonly vars: Readonly<HookVars>
  readonly action: ActionView | null
  readonly last: ActionView | null
  readonly combo: ActionView | null
}

export interface JudgmentView {
  readonly id: number
  readonly owner: Slot
  readonly action: ActionId
  readonly actionInstance: number
  readonly judgment: string
  readonly spawnedAt: number
  readonly age: number
  readonly ticksDone: number
  readonly detached?: true
}

export interface TailView {
  readonly owner: Slot
  readonly action: ActionId
  readonly instance: number
  readonly localFrame: number
  readonly events: readonly TimelineEvent[]
  readonly detached?: true
  readonly skip?: readonly string[]
  readonly noted?: true
}

export interface EnemyView {
  readonly presetId: string
  readonly whiteBar: number
  readonly broken: boolean
  readonly paralyzedUntil: number
  readonly poise: number
  readonly tunability: number
  readonly disharmony: boolean
  readonly tunabilityLockedUntil: number
  readonly tuneButtonUntil: number
  readonly tuneBreakBy?: number
  readonly shift?: { readonly kind: ResonanceKind; readonly by: Slot; readonly remaining: number }
  readonly interference?: { readonly kind: ResonanceKind; readonly stacks: number; readonly remaining: number }
  readonly effects: Partial<Record<EffectName, EffectRuntime>>
  readonly responseCd: Partial<Record<CharName, number>>
  readonly settledAt: Partial<Record<EffectName, number>>
}

export interface QueueView {
  readonly next: number
  readonly loop: number
  readonly loopBegun: boolean
  readonly waited: number
  readonly readyAt: number | null
  readonly extra: number | null
  readonly until: number | null
  readonly seg: WaitSegment | null
}

export interface StateView {
  readonly frame: number
  readonly battleFrames: number
  readonly onField: Slot
  readonly entry: SimState['entry']
  readonly chars: readonly [CharView, CharView, CharView]
  readonly judgments: readonly JudgmentView[]
  readonly tails: readonly TailView[]
  readonly buffs: readonly BuffRuntime[]
  readonly enemy: EnemyView
  readonly dilations: readonly DilationRuntime[]
  readonly queue: QueueView
  readonly nextId: number
  readonly outroLinks: readonly { readonly introInstance: number; readonly from: Slot }[]
  readonly pendingNextIn: readonly { readonly owner: Slot | 'env'; readonly defId: string; readonly stacks: number }[]
  readonly lastTrigger: Readonly<Record<string, number>>
  readonly assumed: Readonly<Record<string, { readonly n: number; readonly at: number; readonly detail: readonly string[] }>>
  readonly rng: RngState | null
}

function actionViewOf(a: ActionRuntime | null): ActionView | null {
  if (!a) return null
  return {
    id: a.id,
    instance: a.instance,
    localFrame: a.localFrame,
    startedAt: a.startedAt,
    cursor: a.cursor,
    ended: a.ended,
    coreGranted: [...a.coreGranted],
    ...(a.cmd ? { cmd: { ...a.cmd } } : {}),
    ...(a.skip ? { skip: [...a.skip] } : {}),
  }
}

/** 完整状态的可序列化投影（DD-07 §3.3）：所有数组与对象都是新拷贝，不含定义对象与日志 */
export function viewOf(s: Readonly<SimState>): StateView {
  const chars = s.chars.map((c): CharView => {
    const charges: Record<string, { spent: number; every: Frame }> = {}
    for (const [k, v] of Object.entries(c.charges)) charges[k] = { ...v }
    return {
      slot: c.slot,
      name: c.name,
      switchCd: c.switchCd,
      startedThisTick: c.startedThisTick,
      energy: c.energy,
      concerto: c.concerto,
      core: [...c.core],
      cooldowns: { ...c.cooldowns },
      charges,
      vars: { ...c.vars },
      action: actionViewOf(c.action),
      last: actionViewOf(c.last),
      combo: actionViewOf(c.combo),
    }
  }) as unknown as readonly [CharView, CharView, CharView]

  const judgments = s.judgments.map((j: JudgmentRuntime): JudgmentView => ({
    id: j.id,
    owner: j.owner,
    action: j.action,
    actionInstance: j.actionInstance,
    judgment: j.def.name,
    spawnedAt: j.spawnedAt,
    age: j.age,
    ticksDone: j.ticksDone,
    ...(j.detached ? { detached: true } : {}),
  }))

  const tails = s.tails.map((t: TailRuntime): TailView => ({
    owner: t.owner,
    action: t.action,
    instance: t.instance,
    localFrame: t.localFrame,
    events: t.events.map(e => ({ ...e })),
    ...(t.detached ? { detached: true } : {}),
    ...(t.skip ? { skip: [...t.skip] } : {}),
    ...(t.noted ? { noted: true } : {}),
  }))

  const effects: Partial<Record<EffectName, EffectRuntime>> = {}
  for (const [k, v] of Object.entries(s.enemy.effects)) {
    if (v) effects[k as EffectName] = { ...v }
  }

  const enemy: EnemyView = {
    presetId: s.enemy.preset.id,
    whiteBar: s.enemy.whiteBar,
    broken: s.enemy.broken,
    paralyzedUntil: s.enemy.paralyzedUntil,
    poise: s.enemy.poise,
    tunability: s.enemy.tunability,
    disharmony: s.enemy.disharmony,
    tunabilityLockedUntil: s.enemy.tunabilityLockedUntil,
    tuneButtonUntil: s.enemy.tuneButtonUntil,
    ...(s.enemy.tuneBreakBy !== undefined ? { tuneBreakBy: s.enemy.tuneBreakBy } : {}),
    ...(s.enemy.shift ? { shift: { ...s.enemy.shift } } : {}),
    ...(s.enemy.interference ? { interference: { ...s.enemy.interference } } : {}),
    effects,
    responseCd: { ...s.enemy.responseCd },
    settledAt: { ...s.enemy.settledAt },
  }

  const assumed: Record<string, { n: number; at: number; detail: string[] }> = {}
  for (const [k, v] of Object.entries(s.assumed)) assumed[k] = { n: v.n, at: v.at, detail: [...v.detail] }

  const dilations = s.dilations.map((d): DilationRuntime => ({
    type: d.type as DilationType,
    source: d.source,
    side: d.side as DilationSide,
    target: d.target,
    rate: d.rate,
    remaining: d.remaining,
    hitstop: d.hitstop,
    instance: d.instance,
  }))

  return {
    frame: s.frame,
    battleFrames: s.battleFrames,
    onField: s.onField,
    entry: s.entry ? { ...s.entry } : null,
    chars,
    judgments,
    tails,
    buffs: s.buffs.map(b => ({ ...b })),
    enemy,
    dilations,
    queue: {
      next: s.queue.next,
      loop: s.queue.loop,
      loopBegun: s.queue.loopBegun,
      waited: s.queue.waited,
      readyAt: s.queue.readyAt,
      extra: s.queue.extra,
      until: s.queue.until,
      seg: s.queue.seg ? { ...s.queue.seg } : null,
    },
    nextId: s.nextId,
    outroLinks: s.outroLinks.map(x => ({ ...x })),
    pendingNextIn: s.pendingNextIn.map(x => ({ ...x })),
    lastTrigger: { ...s.lastTrigger },
    assumed,
    rng: s.rng ? { ...s.rng } : null,
  }
}

export interface StateAt {
  readonly frame: Frame
  readonly view: StateView
  readonly prefix: StatePrefix
  readonly ledgerEndExclusive?: number
}

export function stateAt(p: PreparedRun, f: Frame, opts?: { diag?: RunOptions['diag']; cache?: SnapshotCache }): QueryResult<StateAt> {
  if (!Number.isInteger(f) || f < 0) {
    const term = runPrepared(p)
    const cov = term.completion.coverage
    if (!cov.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有任何合法状态边界' } }
    return {
      ok: false,
      error: { code: 'outOfRange', completedTicks: cov.completedTicks, message: `帧 ${f} 超出合法状态边界 [0, ${cov.completedTicks}]` },
    }
  }
  let cached = opts?.cache?.get(p.runId, f, opts.diag)
  if (opts?.cache && (!cached || f - cached.frame >= 600)) {
    const boundary = f - f % 600
    const snap = cached ? snapshotFrom(p, cached, boundary, opts) : snapshotAt(p, boundary, opts)
    if (snap.ok) { opts.cache.put(snap.value); cached = snap.value }
  }
  const resumed = cached ? resumeFrom(p, cached, { kind: 'boundary', frame: f }, opts) : undefined
  if (resumed && !resumed.ok) return resumed
  const r = resumed?.ok ? resumed.value : replayTo(p, { kind: 'boundary', frame: f }, opts)
  if (r.kind === 'prefix') {
    return {
      ok: true,
      value: {
        frame: f,
        view: viewOf(r.state),
        prefix: r.prefix,
        ...(r.ledgerEndExclusive !== undefined ? { ledgerEndExclusive: r.ledgerEndExclusive } : {}),
      },
    }
  }
  const cov = r.result.completion.coverage
  if (!cov.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有任何合法状态边界' } }
  return {
    ok: false,
    error: { code: 'outOfRange', completedTicks: cov.completedTicks, message: `帧 ${f} 超出合法状态边界 [0, ${cov.completedTicks}]` },
  }
}

export function statesAt(p: PreparedRun, frames: readonly Frame[], opts?: { diag?: RunOptions['diag'] }): QueryResult<StateAt[]> {
  if (frames.length === 0) {
    const term = runPrepared(p)
    if (!term.completion.coverage.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有任何合法状态边界' } }
    return { ok: true, value: [] }
  }
  const captured = new Map<number, StateAt>()
  const validSet = new Set(frames.filter(f => Number.isInteger(f) && f >= 0))
  const { result } = runToExecution(p, {
    ...opts,
    observer: {
      frames: validSet,
      onBoundary: (f, s, prefix, ledgerLength) => {
        captured.set(f, {
          frame: f,
          view: viewOf(s),
          prefix: { ...prefix },
          ...(ledgerLength !== null ? { ledgerEndExclusive: ledgerLength } : {}),
        })
      },
    },
  })
  const cov = result!.completion.coverage
  if (!cov.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有任何合法状态边界' } }
  for (const f of frames) {
    if (!captured.has(f)) {
      return {
        ok: false,
        error: { code: 'outOfRange', completedTicks: cov.completedTicks, message: `帧 ${f} 超出合法状态边界 [0, ${cov.completedTicks}]` },
      }
    }
  }
  return { ok: true, value: frames.map(f => captured.get(f)!) }
}

export function terminalState(
  p: PreparedRun,
  opts?: { diag?: RunOptions['diag'] },
): QueryResult<StateAt & { readonly kind: RunCompletion['coverage']['terminal']['kind']; readonly completion: RunCompletion }> {
  const r = replayTo(p, { kind: 'terminal' }, opts) as ReplayComplete
  const c = r.result.completion
  const ledgerEnd = r.result.diag?.ledgerMarks?.terminalEndExclusive
  return {
    ok: true,
    value: {
      frame: r.state.frame,
      view: viewOf(r.state),
      prefix: c.coverage.terminal.prefix,
      ...(ledgerEnd !== undefined ? { ledgerEndExclusive: ledgerEnd } : {}),
      kind: c.coverage.terminal.kind,
      completion: c,
    },
  }
}

// ---------------------------------------------------------------------------
// §3.4 事件查询

export interface EventRecord {
  readonly seq: number
  readonly event: SimEvent
  readonly meta?: EventMeta
}

export function eventsBySeq(res: SimResult, from: number, toExclusive: number): QueryResult<readonly EventRecord[]> {
  const max = res.completion.coverage.loggedEventEndExclusive
  if (!Number.isInteger(from) || !Number.isInteger(toExclusive) || from < 0 || toExclusive < from || toExclusive > max) {
    return { ok: false, error: { code: 'eventOutOfRange', loggedEventEndExclusive: max } }
  }
  const out: EventRecord[] = []
  const meta = res.diag?.eventMeta
  for (let seq = from; seq < toExclusive; seq++) {
    out.push({ seq, event: res.log[seq]!, ...(meta?.[seq] ? { meta: meta[seq] } : {}) })
  }
  return { ok: true, value: out }
}

export function eventsBetween(res: SimResult, loBattleFrame: number, hiBattleFrame: number): QueryResult<readonly EventRecord[]> {
  if (Number.isNaN(loBattleFrame) || Number.isNaN(hiBattleFrame) || loBattleFrame > hiBattleFrame) {
    return { ok: false, error: { code: 'unsupported', what: `无效的战斗帧窗口 [${loBattleFrame}, ${hiBattleFrame})` } }
  }
  const out: EventRecord[] = []
  const meta = res.diag?.eventMeta
  const max = res.completion.coverage.loggedEventEndExclusive
  for (let seq = 0; seq < max; seq++) {
    const ev = res.log[seq]!
    const bf = battleFrameOf(ev)
    if (bf >= loBattleFrame && bf < hiBattleFrame) {
      out.push({ seq, event: ev, ...(meta?.[seq] ? { meta: meta[seq] } : {}) })
    }
  }
  return { ok: true, value: out }
}

// ---------------------------------------------------------------------------
// §4.1 试算会话

export interface ProbeSession {
  readonly replay: ReplayPrefix
  readonly ro: readonly ReadonlyHookContext[]
}

export function openProbe(p: PreparedRun, stop: StopPoint): QueryResult<ProbeSession> {
  if (stop.kind === 'terminal' || stop.kind === 'boundaries') {
    return { ok: false, error: { code: 'unsupported', what: `openProbe 不支持停止点类型 ${stop.kind}` } }
  }
  const r = replayTo(p, stop)
  if (r.kind === 'complete') {
    const cov = r.result.completion.coverage
    if (!cov.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有合法状态' } }
    if (stop.kind === 'boundary') {
      return {
        ok: false,
        error: { code: 'outOfRange', completedTicks: cov.completedTicks, message: `帧 ${stop.frame} 超出合法状态边界 [0, ${cov.completedTicks}]` },
      }
    }
    return {
      ok: false,
      error: { code: 'unsupported', what: `运行在求值 #${stop.evaluationIndex} 到达前已停止（${r.result.completion.status}）` },
    }
  }
  const proj = freezeStateProjection(r.state)
  const env = probeEnvOf(p.resolved, p.effective.sample)
  const ro = ([0, 1, 2] as const).map(slot => readonlyContext(env, proj, slot, true))
  return { ok: true, value: { replay: r, ro } }
}

// ---------------------------------------------------------------------------
// §5 commandCheck 与 rawActionCheck

export interface CommandCheck {
  readonly cmd: CommandRef
  readonly outcome: 'executed' | 'skipped' | 'failedHere' | 'notReached'
  readonly firstAtHeadFrame: Frame | null
  readonly executedAtFrame: Frame | null
  readonly skip?: { readonly code: WaitCode; readonly reason: string }
  readonly notReachedBecause?: { readonly status: RunStatus; readonly stoppedAtFrame: Frame; readonly headCmd: CommandRef | null }
  readonly evaluations: readonly {
    readonly evaluationIndex: number
    readonly f: Frame
    readonly verdict: NonNullable<import('./diagnostics').CommandVerdict['verdict']>
  }[]
  readonly waits: readonly {
    readonly code: WaitCode
    readonly intent: boolean
    readonly fromFrame: Frame
    readonly frames: number
    readonly reason: string
  }[]
  readonly checkedEvaluation: number | null
  readonly conditions: readonly ConditionCheck[]
  readonly firstBlocking: string | null
  readonly context: (NonNullable<import('./diagnostics').CommandVerdict['context']> & { readonly entry: SimState['entry'] }) | null
}

const sameCmd = (a: CommandRef, b: CommandRef): boolean =>
  a.loop === b.loop && a.line === b.line && a.item === b.item

function findCommandDef(p: PreparedRun, cmd: CommandRef): Command | undefined {
  if (cmd.loop === 0) return p.resolved.opening.find(c => c.line === cmd.line && c.item === cmd.item)
  if (cmd.loop >= 1 && cmd.loop <= p.resolved.options.repeat) {
    return p.resolved.commands.find(c => c.line === cmd.line && c.item === cmd.item)
  }
  return undefined
}

export function commandCheck(p: PreparedRun, cmd: CommandRef, opts?: { evaluationIndex?: number }): QueryResult<CommandCheck> {
  const cDef = findCommandDef(p, cmd)
  if (!cDef) {
    return { ok: false, error: { code: 'unsupported', what: `场景里没有指令 ${cmd.loop}:${cmd.line}.${cmd.item}` } }
  }
  const res = runPrepared(p, { diag: { commandVerdicts: true } })
  const verdicts = res.diag?.commandVerdicts ?? []
  const headRec = verdicts.find(v => v.kind === 'head' && sameCmd(v.cmd, cmd))
  const execRec = verdicts.find(v => v.kind === 'execute' && sameCmd(v.cmd, cmd))
  const skipRec = verdicts.find(v => v.kind === 'skip' && sameCmd(v.cmd, cmd))
  const evalRecs = verdicts.filter(v => v.kind === 'evaluate' && sameCmd(v.cmd, cmd))
  const lastHead = [...verdicts].reverse().find(v => v.kind === 'head') ?? null

  if (opts?.evaluationIndex !== undefined && !evalRecs.some(v => v.evaluationIndex === opts.evaluationIndex)) {
    return {
      ok: false,
      error: {
        code: 'unsupported',
        what: `求值序号 ${opts.evaluationIndex} 不属于指令 ${cmd.loop}:${cmd.line}.${cmd.item}`,
      },
    }
  }

  let outcome: CommandCheck['outcome']
  let skipInfo: CommandCheck['skip'] | undefined
  let notReachedBecause: CommandCheck['notReachedBecause'] | undefined

  if (execRec) {
    outcome = 'executed'
  } else if (skipRec) {
    outcome = 'skipped'
    const sv = skipRec.verdict as { go: false; code: WaitCode; reason: string }
    skipInfo = { code: sv.code, reason: sv.reason }
  } else if (
    res.completion.status === 'axisFailed'
    && ((lastHead && sameCmd(lastHead.cmd, cmd))
      || (res.completion.axisFailure?.unmetIntent && sameCmd(res.completion.axisFailure.unmetIntent.cmd, cmd)))
  ) {
    outcome = 'failedHere'
  } else {
    outcome = 'notReached'
    notReachedBecause = {
      status: res.completion.status,
      stoppedAtFrame: res.completion.coverage.completedTicks,
      headCmd: lastHead?.cmd ?? null,
    }
  }

  const targetEval = opts?.evaluationIndex !== undefined
    ? evalRecs.find(v => v.evaluationIndex === opts.evaluationIndex)!
    : evalRecs.at(-1)

  let conditions: ConditionCheck[] = []
  let firstBlocking: string | null = null
  let context: CommandCheck['context'] = null
  let checkedEvaluation: number | null = null

  if (targetEval) {
    checkedEvaluation = targetEval.evaluationIndex
    const r = replayTo(p, { kind: 'evaluation', evaluationIndex: checkedEvaluation })
    if (r.kind !== 'prefix') {
      return { ok: false, error: { code: 'unsupported', what: `无法停在求值 #${checkedEvaluation}` } }
    }
    const st = r.state
    const env = probeEnvOf(p.resolved, p.effective.sample)
    const evalCtx = targetEval.context!
    context = { ...evalCtx, entry: st.entry ? { ...st.entry } : null }

    if (cDef.kind === 'act') {
      const def = p.resolved.team[cDef.slot]!.actions[cDef.action]!
      conditions = explainAct(st, r.sim.k, env, cDef.slot, def, {
        force: cDef.force,
        delay: cDef.delay,
        input: !def.comboFrom?.length,
        optional: cDef.optional,
        readyAt: evalCtx.readyAt,
        extra: evalCtx.extra,
        actions: p.resolved.team[cDef.slot]!.actions,
        deterministicInputDelay: deterministicDelayOf(env, st, cmd),
      })
    } else if (cDef.kind === 'switch') {
      const q = st.queue
      const list = q.loop === 0 ? q.opening : q.commands
      const nxt = list[q.next + 1] ?? (q.loop > 0 || q.commands.length ? q.commands[0] : undefined)
      const nextAction = nxt?.kind === 'act' && nxt.slot === cDef.to ? p.resolved.team[cDef.to]!.actions[nxt.action]! : null
      conditions = explainSwitch(st, r.sim.k, env, cDef, {
        expectIntro: cDef.expectIntro,
        nextAction,
        readyAt: evalCtx.readyAt,
        extra: evalCtx.extra,
        deterministicInputDelay: deterministicDelayOf(env, st, cmd),
      })
    } else if (cDef.kind === 'wait') {
      const until = evalCtx.until ?? st.battleFrames + cDef.frames
      const ok = st.battleFrames >= until
      conditions = [{
        id: 'wait',
        status: ok ? 'met' : 'unmet',
        expected: `战斗帧 ≥ ${until}`,
        actual: `${roundTo(st.battleFrames, 100)}`,
      }]
    } else if (cDef.kind === 'at') {
      const ok = st.frame >= cDef.frame
      conditions = [{
        id: 'at',
        status: ok ? 'met' : 'unmet',
        expected: `世界帧 ≥ ${cDef.frame}`,
        actual: `${st.frame}`,
      }]
    } else {
      conditions = []
    }
    firstBlocking = firstBlockingOf(conditions)
  }

  const waits = res.log
    .filter((e): e is Extract<SimEvent, { type: 'wait' }> => e.type === 'wait' && sameCmd(e.cmd, cmd))
    .map(e => ({
      code: e.code,
      intent: INTENT_WAITS.some(ic => ic === e.code),
      fromFrame: e.from,
      frames: e.frames,
      reason: e.reason,
    }))

  return {
    ok: true,
    value: {
      cmd,
      outcome,
      firstAtHeadFrame: headRec ? headRec.f : (evalRecs[0]?.f ?? null),
      executedAtFrame: execRec ? execRec.f : null,
      ...(skipInfo ? { skip: skipInfo } : {}),
      ...(notReachedBecause ? { notReachedBecause } : {}),
      evaluations: evalRecs.map(v => ({ evaluationIndex: v.evaluationIndex, f: v.f, verdict: v.verdict! })),
      waits,
      checkedEvaluation,
      conditions,
      firstBlocking,
      context,
    },
  }
}

/** 在 S[f] 上、不经过这一帧的 P1 与 endDueActions 直接检查。结果标 basis: 'preP1'，不是调度结论（DD-07 §5） */
export function rawActionCheck(
  p: PreparedRun,
  f: Frame,
  slot: Slot,
  action: ActionId,
): QueryResult<{ readonly basis: 'preP1'; readonly conditions: readonly ConditionCheck[] }> {
  const def = p.resolved.team[slot]?.actions[action]
  if (!def) {
    return { ok: false, error: { code: 'unsupported', what: `槽位 ${slot} 没有动作 ${action}` } }
  }
  const r = replayTo(p, { kind: 'boundary', frame: f })
  if (r.kind === 'complete') {
    const cov = r.result.completion.coverage
    if (!cov.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有合法状态' } }
    return {
      ok: false,
      error: { code: 'outOfRange', completedTicks: cov.completedTicks, message: `帧 ${f} 超出合法状态边界 [0, ${cov.completedTicks}]` },
    }
  }
  const env = probeEnvOf(p.resolved, p.effective.sample)
  const conditions = explainAct(r.state, r.sim.k, env, slot, def, {
    force: false,
    delay: 0,
    input: !def.comboFrom?.length,
    readyAt: null,
    extra: null,
    actions: p.resolved.team[slot]!.actions,
    deterministicInputDelay: env.options.inputDelay,
  })
  return { ok: true, value: { basis: 'preP1', conditions } }
}

// ---------------------------------------------------------------------------
// §6 触发为什么没发生

export type { TriggerOutcome, TriggerTarget } from './probe'

export interface TriggerCheck {
  readonly event: EventHandle
  readonly target: TriggerTarget
  readonly outcome: TriggerOutcome
  readonly notEnteredReason?: 'noOccurrence' | 'noInstance' | 'targetMismatch'
  readonly handlerNotRunReason?: 'failCloseUnhandled' | 'earlierHandlerThrew' | 'runStoppedBeforeHandling'
  readonly groups: readonly TriggerCheckGroup[]
  readonly afterFiring?: string
}

export type HypotheticalEvent = SimEvent | ({ readonly f?: number; readonly t?: number } & Omit<SimEvent, 'f' | 't'>)

export interface HypotheticalTriggerCheck {
  readonly hypothetical: true
  readonly atFrame: Frame
  readonly event: SimEvent
  readonly target: TriggerTarget
  readonly outcome: 'wouldFire' | 'wouldNotFire' | 'notEntered' | 'unsupported'
  readonly notEnteredReason?: 'noOccurrence' | 'noInstance' | 'targetMismatch'
  readonly groups: readonly TriggerCheckGroup[]
}

const sameTarget = (a: TriggerTarget, b: TriggerTarget): boolean =>
  a.kind === b.kind && a.owner === b.owner && a.id === b.id

export function whyDidEventNotTrigger(p: PreparedRun, event: EventHandle, target: TriggerTarget): QueryResult<TriggerCheck> {
  if (event.runId !== p.runId) {
    return { ok: false, error: { code: 'runIdMismatch', expected: p.runId, got: event.runId } }
  }
  const res = runPrepared(p, { diag: { triggerChecks: [target] } })
  const logged = res.completion.coverage.loggedEventEndExclusive
  if (!Number.isInteger(event.eventSeq) || event.eventSeq < 0 || event.eventSeq >= logged) {
    return { ok: false, error: { code: 'eventOutOfRange', loggedEventEndExclusive: logged } }
  }
  const rec = (res.diag?.triggerChecks ?? []).find(r => r.eventSeq === event.eventSeq && sameTarget(r.target, target))
  if (rec) {
    return {
      ok: true,
      value: {
        event,
        target,
        outcome: rec.outcome,
        ...(rec.notEnteredReason ? { notEnteredReason: rec.notEnteredReason } : {}),
        groups: rec.groups,
        ...(rec.afterFiring ? { afterFiring: rec.afterFiring } : {}),
      },
    }
  }
  const cov = res.completion.coverage
  const ev = res.log[event.eventSeq]
  let handlerNotRunReason: NonNullable<TriggerCheck['handlerNotRunReason']>
  if (cov.finalization.kind === 'failClose' && event.eventSeq === logged - 1 && ev?.type === 'wait') {
    handlerNotRunReason = 'failCloseUnhandled'
  } else if (cov.loopExitAt.inFlightEventSeq === event.eventSeq || cov.finalization.inFlightEventSeq === event.eventSeq) {
    handlerNotRunReason = 'earlierHandlerThrew'
  } else {
    handlerNotRunReason = 'runStoppedBeforeHandling'
  }
  return {
    ok: true,
    value: {
      event,
      target,
      outcome: 'handlerNotRun',
      handlerNotRunReason,
      groups: [],
    },
  }
}

export function wouldHypotheticalEventTrigger(
  p: PreparedRun,
  f: Frame,
  event: HypotheticalEvent,
  target: TriggerTarget,
): QueryResult<HypotheticalTriggerCheck> {
  if (!Number.isInteger(f) || f < 0) {
    const term = runPrepared(p)
    const cov = term.completion.coverage
    if (!cov.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有合法状态' } }
    return {
      ok: false,
      error: { code: 'outOfRange', completedTicks: cov.completedTicks, message: `帧 ${f} 超出合法状态边界 [0, ${cov.completedTicks}]` },
    }
  }
  const r = replayTo(p, { kind: 'boundary', frame: f })
  if (r.kind === 'complete') {
    const cov = r.result.completion.coverage
    if (!cov.initCompleted) return { ok: false, error: { code: 'noLegalState', message: '初始化未完成，没有合法状态' } }
    return {
      ok: false,
      error: { code: 'outOfRange', completedTicks: cov.completedTicks, message: `帧 ${f} 超出合法状态边界 [0, ${cov.completedTicks}]` },
    }
  }
  const st = r.state
  const fullEvent: SimEvent = {
    ...event,
    f: event.f ?? st.frame,
    t: event.t ?? st.battleFrames / 60,
  } as SimEvent

  if (target.kind === 'charHook') {
    return {
      ok: true,
      value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: 'unsupported', groups: [] },
    }
  }

  let occs: Occurrence[]
  try {
    occs = occurrencesOf(r.sim, fullEvent, false)
  } catch {
    return { ok: false, error: { code: 'unsupported', what: '假想事件里的角色名不在队伍中' } }
  }
  if (occs.length === 0) {
    return {
      ok: true,
      value: {
        hypothetical: true,
        atFrame: f,
        event: fullEvent,
        target,
        outcome: 'notEntered',
        notEnteredReason: 'noOccurrence',
        groups: [],
      },
    }
  }

  if (target.kind === 'buff') {
    const reg = p.resolved.buffs.find(b => b.owner === target.owner && b.def.id === target.id)
    if (!reg) {
      return {
        ok: true,
        value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: 'notEntered', notEnteredReason: 'noInstance', groups: [] },
      }
    }
    const groups = explainFiring(st, reg.def.trigger, reg.owner, reg.def.id, reg.def.icd, occs)
    return {
      ok: true,
      value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: groupsWouldFire(groups) ? 'wouldFire' : 'wouldNotFire', groups },
    }
  }

  if (target.kind === 'buffExtend') {
    const reg = p.resolved.buffs.find(b => b.owner === target.owner && b.def.id === target.id)
    if (!reg || !reg.def.extend || !st.buffs.some(b => b.defId === reg.def.id && b.owner === reg.owner)) {
      return {
        ok: true,
        value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: 'notEntered', notEnteredReason: 'noInstance', groups: [] },
      }
    }
    const { groups, fired } = explainExtend(st, reg.def, reg.owner, occs)
    return {
      ok: true,
      value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: fired ? 'wouldFire' : 'wouldNotFire', groups },
    }
  }

  if (target.kind === 'resourceEffect') {
    const eff = p.resolved.effects.find(e => e.owner === target.owner && e.def.id === target.id)
    if (!eff) {
      return {
        ok: true,
        value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: 'notEntered', notEnteredReason: 'noInstance', groups: [] },
      }
    }
    const groups = explainFiring(st, eff.def.trigger, eff.owner, eff.def.id, eff.def.icd, occs)
    return {
      ok: true,
      value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: groupsWouldFire(groups) ? 'wouldFire' : 'wouldNotFire', groups },
    }
  }

  // consume
  const instances = st.buffs.filter(b => b.owner === target.owner && b.defId === target.id)
  if (instances.length === 0) {
    return {
      ok: true,
      value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: 'notEntered', notEnteredReason: 'noInstance', groups: [] },
    }
  }
  const cSpec = p.resolved.buffs.find(b => b.owner === target.owner && b.def.id === target.id)?.def.consume
  if (!cSpec) {
    return {
      ok: true,
      value: {
        hypothetical: true,
        atFrame: f,
        event: fullEvent,
        target,
        outcome: 'wouldNotFire',
        groups: [{ occurrence: occs[0]!.on, spec: 0, conditions: [{ id: 'consume', status: 'unmet', expected: '存在 consume 规则', actual: '非消耗型 buff' }] }],
      },
    }
  }
  const matchedOccs = occs.filter(o => instances.some(b => b.target === o.by || b.target === 'enemy'))
  if (matchedOccs.length === 0) {
    return {
      ok: true,
      value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: 'notEntered', notEnteredReason: 'targetMismatch', groups: [] },
    }
  }
  const groups = explainFiring(st, { on: cSpec.on, ...(cSpec.where ? { where: cSpec.where } : {}) }, target.owner, target.id, undefined, matchedOccs)
  return {
    ok: true,
    value: { hypothetical: true, atFrame: f, event: fullEvent, target, outcome: groupsWouldFire(groups) ? 'wouldFire' : 'wouldNotFire', groups },
  }
}

// ---------------------------------------------------------------------------
// §7 & §8 explainEvent 与 buff 窗口差几帧

export interface BuffWindowMargin {
  readonly defId: string
  readonly owner: CharName | 'env'
  readonly target: CharName | 'enemy'
  readonly instanceId: number
  readonly state: 'present' | 'left' | 'appliedLater'
  readonly remainingBattleFrames?: number | 'inf'
  readonly leftBattleFramesAgo?: number
  readonly exitReason?: 'timeout' | 'switchOut' | 'removed'
  readonly appliedBattleFramesLater?: number
  readonly note: 'hint_only'
}

export interface EventExplanation {
  readonly event: EventHandle
  readonly type: SimEventType
  readonly f: Frame
  readonly battleFrame: number
  readonly origin: EventMeta['origin']
  readonly directCauses: readonly { readonly seq: number; readonly meta: EventMeta; readonly via: 'parent' | 'subject' }[]
  readonly businessRoot?: { readonly seq: number }
  readonly hitInputs?: HitInputs
  readonly resourceEntries: readonly ResourceLedgerEntry[]
  readonly ruleTrace: readonly RuleTraceEntry[]
  readonly windowMargins?: readonly BuffWindowMargin[]
  readonly scope: 'direct_causes_and_immediate_inputs_only'
}

export function explainEvent(
  p: PreparedRun,
  event: EventHandle,
  opts: { readonly lookback?: number; readonly lookahead?: number } = {},
): QueryResult<EventExplanation> {
  if (event.runId !== p.runId) {
    return { ok: false, error: { code: 'runIdMismatch', expected: p.runId, got: event.runId } }
  }
  const res = runPrepared(p, {
    diag: { eventMeta: true, resourceLedger: true, ruleTrace: true, hitInputs: true, hitMargins: true },
  })
  const logged = res.completion.coverage.loggedEventEndExclusive
  if (!Number.isInteger(event.eventSeq) || event.eventSeq < 0 || event.eventSeq >= logged) {
    return { ok: false, error: { code: 'eventOutOfRange', loggedEventEndExclusive: logged } }
  }

  const metaList = res.diag!.eventMeta!
  const selfMeta = metaList[event.eventSeq]!
  const ev = res.log[event.eventSeq]!

  // 沿直接父链或说的实体走到源头
  const directCauses: { seq: number; meta: EventMeta; via: 'parent' | 'subject' }[] = []
  let cur = event.eventSeq
  for (let guard = 0; guard <= logged; guard++) {
    const m = metaList[cur]!
    if (m.directParentSeq !== undefined) {
      cur = m.directParentSeq
      directCauses.push({ seq: cur, meta: metaList[cur]!, via: 'parent' })
    } else if (m.subjectSeq !== undefined) {
      cur = m.subjectSeq
      directCauses.push({ seq: cur, meta: metaList[cur]!, via: 'subject' })
    } else {
      break
    }
  }

  const rootSeq = res.diag?.businessRoots?.[event.eventSeq]
  const hitInputs = res.diag?.hitInputs?.[event.eventSeq]
  const resourceEntries = (res.diag?.resourceLedger ?? []).filter(e => e.relatedEventSeq === event.eventSeq)

  // 同作用域 + 直接因果链上事件所在作用域 + 链顶端若是 command 的求值规则明细
  const scopes = new Set<number>()
  if (selfMeta.scope !== undefined) scopes.add(selfMeta.scope)
  for (const c of directCauses) if (c.meta.scope !== undefined) scopes.add(c.meta.scope)
  const topMeta = directCauses.length > 0 ? directCauses.at(-1)!.meta : selfMeta
  const topCmd = topMeta.origin.kind === 'command' ? topMeta.origin.cmd : undefined
  const ruleTrace = (res.diag?.ruleTrace ?? []).filter(
    r => (r.scope !== undefined && scopes.has(r.scope)) || (topCmd !== undefined && r.cmd !== undefined && sameCmd(r.cmd, topCmd)),
  )

  // buff 窗口差几帧（DD-07 §8）
  let windowMargins: BuffWindowMargin[] | undefined
  const margin = res.diag?.hitMargins?.[event.eventSeq]
  if (margin) {
    const lookback = opts.lookback ?? 120
    const lookahead = opts.lookahead ?? 120
    const matchingKeys = new Set(margin.matchingDefs.map(d => `${d.owner}|${d.defId}`))
    const presentIds = new Set(margin.present.map(x => x.instanceId))
    const out: BuffWindowMargin[] = []

    for (const pr of margin.present) {
      out.push({
        defId: pr.defId,
        owner: pr.owner,
        target: pr.target,
        instanceId: pr.instanceId,
        state: 'present',
        remainingBattleFrames: pr.remainingBattleFrames,
        note: 'hint_only',
      })
    }

    const firstApplySeq = new Map<number, number>()
    for (let i = 0; i < res.log.length; i++) {
      const e = res.log[i]!
      if (e.type === 'buffApply' && !firstApplySeq.has(e.instanceId)) firstApplySeq.set(e.instanceId, i)
    }

    for (let i = 0; i < res.log.length; i++) {
      const e = res.log[i]!
      if (i < event.eventSeq && e.type === 'buffExpire') {
        if (!matchingKeys.has(`${e.owner}|${e.buff}`)) continue
        if (e.target !== margin.dealer && e.target !== 'enemy') continue
        if (presentIds.has(e.instanceId)) continue
        const ago = roundTo(margin.hitBattleFrame - battleFrameOf(e), 100)
        if (ago >= 0 && ago <= lookback) {
          out.push({
            defId: e.buff,
            owner: e.owner,
            target: e.target,
            instanceId: e.instanceId,
            state: 'left',
            leftBattleFramesAgo: ago,
            exitReason: e.reason,
            note: 'hint_only',
          })
        }
      } else if (i > event.eventSeq && e.type === 'buffApply' && firstApplySeq.get(e.instanceId) === i) {
        if (!matchingKeys.has(`${e.owner}|${e.buff}`)) continue
        if (e.target !== margin.dealer && e.target !== 'enemy') continue
        if (presentIds.has(e.instanceId)) continue
        const later = roundTo(battleFrameOf(e) - margin.hitBattleFrame, 100)
        if (later >= 0 && later <= lookahead) {
          out.push({
            defId: e.buff,
            owner: e.owner,
            target: e.target,
            instanceId: e.instanceId,
            state: 'appliedLater',
            appliedBattleFramesLater: later,
            note: 'hint_only',
          })
        }
      }
    }
    windowMargins = out
  }

  return {
    ok: true,
    value: {
      event,
      type: ev.type,
      f: ev.f,
      battleFrame: battleFrameOf(ev),
      origin: selfMeta.origin,
      directCauses,
      ...(rootSeq !== undefined ? { businessRoot: { seq: rootSeq } } : {}),
      ...(hitInputs ? { hitInputs } : {}),
      resourceEntries,
      ruleTrace,
      ...(windowMargins ? { windowMargins } : {}),
      scope: 'direct_causes_and_immediate_inputs_only',
    },
  }
}

// ---------------------------------------------------------------------------
// §9 跨运行比较 diffRuns

export type DiffTarget =
  | { readonly kind: 'metrics' }
  | { readonly kind: 'commands' }
  | { readonly kind: 'events'; readonly types?: readonly SimEventType[]; readonly cmd?: CommandRef }

export type CorrespondenceStatus = 'matched' | 'addedOrRemoved' | 'ambiguous' | 'unanalyzed'

export interface RunCorrespondence {
  readonly status: CorrespondenceStatus
  readonly base?: EventHandle
  readonly cand?: EventHandle
  readonly candidates?: readonly EventHandle[]
  readonly basis: 'commandRef' | 'explicitMapping' | 'structural'
  readonly delta?: { readonly worldFrames?: number; readonly battleFrames?: number; readonly value?: number }
  readonly unanalyzedReason?: string
}

export interface SideCoverage {
  readonly status: RunStatus
  readonly complete: boolean
  readonly completedTicks: Frame
  readonly loggedEventEndExclusive: number
}

export interface RunDiff {
  readonly base: { readonly runId: string; readonly completion: RunCompletion }
  readonly cand: { readonly runId: string; readonly completion: RunCompletion }
  readonly firstDivergence: { readonly baseEvent?: EventHandle; readonly candEvent?: EventHandle; readonly summary: string } | null
  readonly correspondences: readonly RunCorrespondence[]
}

export interface RunDiffExtra {
  readonly metrics: {
    readonly status: readonly [RunStatus, RunStatus]
    readonly steadyLoopBattleFrames: readonly [readonly number[] | null, readonly number[] | null]
    readonly dps: readonly [number | null, number | null]
    readonly comparable: boolean
    readonly notComparableReason?: string
  }
  readonly sameAxis: boolean
  readonly coverage: { readonly base: SideCoverage; readonly cand: SideCoverage }
  readonly commonStateFrames: Frame
}

function steadyLoopFramesOf(res: SimResult): number[] | null {
  const st = res.summary.steady
  return st ? (res.summary.perLoop ?? []).filter(l => l.loop >= st.from && l.loop <= st.to).map(l => l.frames) : null
}

function sideCoverageOf(res: SimResult): SideCoverage {
  return {
    status: res.completion.status,
    complete: res.completion.status === 'completed',
    completedTicks: res.completion.coverage.completedTicks,
    loggedEventEndExclusive: res.completion.coverage.loggedEventEndExclusive,
  }
}

function enumerateCommands(p: PreparedRun): { cmd: CommandRef; def: Command }[] {
  const out: { cmd: CommandRef; def: Command }[] = []
  for (const def of p.resolved.opening) out.push({ cmd: { loop: 0, line: def.line, item: def.item }, def })
  for (let loop = 1; loop <= p.resolved.options.repeat; loop++) {
    for (const def of p.resolved.commands) out.push({ cmd: { loop, line: def.line, item: def.item }, def })
  }
  return out
}

function cmdStructuralKey(cmd: CommandRef, def: Command): string {
  switch (def.kind) {
    case 'act': return `${cmd.loop}:act:${def.slot}:${def.action}`
    case 'switch': return `${cmd.loop}:switch:${def.to}:${def.expectIntro ? 1 : 0}`
    case 'wait': return `${cmd.loop}:wait:${def.frames}`
    case 'at': return `${cmd.loop}:at:${def.frame}`
    case 'enemy': return `${cmd.loop}:enemy:${def.state}`
    case 'fill': return `${cmd.loop}:fill:${def.slot}:${def.resource}`
  }
}

function topOriginOf(meta: readonly EventMeta[], seq: number): EventMeta['origin'] {
  let cur = seq
  for (let guard = 0; guard <= meta.length; guard++) {
    const m = meta[cur]!
    if (m.directParentSeq !== undefined) cur = m.directParentSeq
    else if (m.subjectSeq !== undefined) cur = m.subjectSeq
    else return m.origin
  }
  return meta[cur]!.origin
}

function eventValue(ev: SimEvent): number | undefined {
  switch (ev.type) {
    case 'hit': return hitValue(ev)
    case 'resource': return ev.delta
    case 'wait': return ev.frames
    case 'buffApply': return ev.stacks
    case 'effectTick': return ev.damage
    default: return undefined
  }
}

function eventContentKey(ev: SimEvent): string {
  switch (ev.type) {
    case 'actionStart': return `actionStart:${ev.char}:${ev.action}`
    case 'actionEnd': return `actionEnd:${ev.char}:${ev.action}`
    case 'actionCancel': return `actionCancel:${ev.char}:${ev.action}:${ev.by}`
    case 'judgmentSpawn': return `judgmentSpawn:${ev.char}:${ev.action}:${ev.judgment}`
    case 'hit': return `hit:${ev.char}:${ev.action}:${ev.judgment}:${ev.tick}:${ev.effect ?? ''}`
    case 'switch': return `switch:${ev.from}:${ev.to}`
    case 'intro': return `intro:${ev.char}:${ev.action}`
    case 'outro': return `outro:${ev.char}:${ev.to}`
    case 'buffApply': return `buffApply:${ev.buff}:${ev.owner}:${ev.target}`
    case 'buffExpire': return `buffExpire:${ev.buff}:${ev.owner}:${ev.target}`
    case 'resource': return `resource:${ev.char}:${ev.resource}:${ev.cause}`
    case 'resourceFull': return `resourceFull:${ev.char}:${ev.resource}`
    case 'heal': return `heal:${ev.char}:${ev.source}`
    case 'shield': return `shield:${ev.char}:${ev.by}:${ev.source}`
    case 'enemyState': return `enemyState:${ev.change}:${ev.by ?? ''}:${ev.effect ?? ''}`
    case 'effectTick': return `effectTick:${ev.effect}:${ev.source}`
    case 'wait': return `wait:${ev.code}`
    case 'skip': return `skip:${ev.code}`
    case 'loop': return `loop:${ev.loop}`
    case 'warning': return `warning:${ev.code}`
  }
}

export function diffRuns(
  a: { readonly p: PreparedRun; readonly res: SimResult },
  b: { readonly p: PreparedRun; readonly res: SimResult },
  target: DiffTarget,
  opts?: { readonly commandMapping?: readonly (readonly [CommandRef, CommandRef])[] },
): QueryResult<RunDiff & RunDiffExtra> {
  if (a.res.runId !== a.p.runId) {
    return { ok: false, error: { code: 'runIdMismatch', expected: a.p.runId, got: a.res.runId } }
  }
  if (b.res.runId !== b.p.runId) {
    return { ok: false, error: { code: 'runIdMismatch', expected: b.p.runId, got: b.res.runId } }
  }

  const sameAxis = digestOf({ opening: a.p.resolved.opening, commands: a.p.resolved.commands })
    === digestOf({ opening: b.p.resolved.opening, commands: b.p.resolved.commands })
  const covA = sideCoverageOf(a.res)
  const covB = sideCoverageOf(b.res)
  const commonStateFrames = Math.min(covA.completedTicks, covB.completedTicks)

  const ba = usableBasis(a.res)
  const bb = usableBasis(b.res)
  const framesA = steadyLoopFramesOf(a.res)
  const framesB = steadyLoopFramesOf(b.res)
  const dpsA = ba.ok ? ba.basis.dps : null
  const dpsB = bb.ok ? bb.basis.dps : null
  let comparable = true
  let notComparableReason: string | undefined
  if (!ba.ok) {
    comparable = false
    notComparableReason = ba.reason
  } else if (!bb.ok) {
    comparable = false
    notComparableReason = bb.reason
  } else if (a.res.summary.steady?.from !== b.res.summary.steady?.from || a.res.summary.steady?.to !== b.res.summary.steady?.to) {
    comparable = false
    notComparableReason = '稳态窗口轮次不一致'
  }

  const metrics: RunDiffExtra['metrics'] = {
    status: [a.res.completion.status, b.res.completion.status],
    steadyLoopBattleFrames: [framesA, framesB],
    dps: [dpsA, dpsB],
    comparable,
    ...(notComparableReason ? { notComparableReason } : {}),
  }

  const baseInfo = { runId: a.p.runId, completion: a.res.completion }
  const candInfo = { runId: b.p.runId, completion: b.res.completion }
  const baseExtra: RunDiffExtra = {
    metrics,
    sameAxis,
    coverage: { base: covA, cand: covB },
    commonStateFrames,
  }

  if (target.kind === 'metrics') {
    return {
      ok: true,
      value: {
        base: baseInfo,
        cand: candInfo,
        firstDivergence: null,
        correspondences: [],
        ...baseExtra,
      },
    }
  }

  const needMeta = true
  const needVerdicts = target.kind === 'commands'
  const resA = (!a.res.diag?.eventMeta && needMeta) || (needVerdicts && !a.res.diag?.commandVerdicts)
    ? runPrepared(a.p, { diag: { eventMeta: true, commandVerdicts: needVerdicts } })
    : a.res
  const resB = (!b.res.diag?.eventMeta && needMeta) || (needVerdicts && !b.res.diag?.commandVerdicts)
    ? runPrepared(b.p, { diag: { eventMeta: true, commandVerdicts: needVerdicts } })
    : b.res

  if (target.kind === 'commands') {
    const { correspondences, firstDivergence } = diffCommands(a.p, resA, b.p, resB, sameAxis, covA, covB, opts?.commandMapping)
    return {
      ok: true,
      value: { base: baseInfo, cand: candInfo, firstDivergence, correspondences, ...baseExtra },
    }
  }

  const { correspondences, firstDivergence } = diffEvents(
    a.p, resA, b.p, resB, sameAxis, covA, covB, target, opts?.commandMapping,
  )
  return {
    ok: true,
    value: { base: baseInfo, cand: candInfo, firstDivergence, correspondences, ...baseExtra },
  }
}

function commandHandleMap(p: PreparedRun, res: SimResult): Map<string, EventHandle> {
  const map = new Map<string, EventHandle>()
  const meta = res.diag?.eventMeta ?? []
  for (let seq = 0; seq < res.log.length; seq++) {
    const ev = res.log[seq]!
    const origin = meta[seq]?.origin
    let cmd: CommandRef | undefined
    if (origin?.kind === 'command') cmd = origin.cmd
    else if ('cmd' in ev && ev.cmd) cmd = ev.cmd
    if (!cmd) continue
    const key = `${cmd.loop}:${cmd.line}:${cmd.item}`
    // 优先选 actionStart / switch / skip（排除前置 wait）作为指令的锚定事件句柄
    if (!map.has(key) || (ev.type !== 'wait' && res.log[map.get(key)!.eventSeq]?.type === 'wait')) {
      map.set(key, { runId: p.runId, eventSeq: seq })
    }
  }
  return map
}

function diffCommands(
  pA: PreparedRun,
  resA: SimResult,
  pB: PreparedRun,
  resB: SimResult,
  sameAxis: boolean,
  covA: SideCoverage,
  covB: SideCoverage,
  mapping?: readonly (readonly [CommandRef, CommandRef])[],
): { correspondences: RunCorrespondence[]; firstDivergence: RunDiff['firstDivergence'] } {
  const cmdsA = enumerateCommands(pA)
  const cmdsB = enumerateCommands(pB)
  const handlesA = commandHandleMap(pA, resA)
  const handlesB = commandHandleMap(pB, resB)
  const keyOf = (c: CommandRef) => `${c.loop}:${c.line}:${c.item}`

  const outcomeOf = (res: SimResult) => {
    const m = new Map<string, { kind: 'execute' | 'skip'; f: Frame; battleFrame: number }>()
    for (const v of res.diag?.commandVerdicts ?? []) {
      if (v.kind === 'execute' || v.kind === 'skip') {
        m.set(keyOf(v.cmd), { kind: v.kind, f: v.f, battleFrame: v.battleFrame })
      }
    }
    return m
  }
  const outA = outcomeOf(resA)
  const outB = outcomeOf(resB)

  // 改轴且没给对应表：按结构键找候选，全部标 ambiguous（DD-07 §9；DF-14）
  if (!sameAxis && !mapping) {
    const byStructB = new Map<string, { cmd: CommandRef; handle?: EventHandle }[]>()
    for (const b of cmdsB) {
      const sk = cmdStructuralKey(b.cmd, b.def)
      const list = byStructB.get(sk) ?? []
      list.push({ cmd: b.cmd, handle: handlesB.get(keyOf(b.cmd)) })
      byStructB.set(sk, list)
    }
    const correspondences: RunCorrespondence[] = []
    for (const a of cmdsA) {
      const sk = cmdStructuralKey(a.cmd, a.def)
      const cands = (byStructB.get(sk) ?? []).map(x => x.handle).filter((h): h is EventHandle => h !== undefined)
      const baseH = handlesA.get(keyOf(a.cmd))
      correspondences.push({
        status: 'ambiguous',
        ...(baseH ? { base: baseH } : {}),
        candidates: cands,
        basis: 'structural',
      })
    }
    return { correspondences, firstDivergence: null }
  }

  const basis: 'commandRef' | 'explicitMapping' = sameAxis ? 'commandRef' : 'explicitMapping'
  const pairs: { refA?: CommandRef; refB?: CommandRef }[] = []
  if (sameAxis && !mapping) {
    for (const a of cmdsA) pairs.push({ refA: a.cmd, refB: a.cmd })
  } else {
    const mappedA = new Set<string>()
    const mappedB = new Set<string>()
    for (const [ra, rb] of mapping!) {
      pairs.push({ refA: ra, refB: rb })
      mappedA.add(keyOf(ra))
      mappedB.add(keyOf(rb))
    }
    for (const a of cmdsA) if (!mappedA.has(keyOf(a.cmd))) pairs.push({ refA: a.cmd })
    for (const b of cmdsB) if (!mappedB.has(keyOf(b.cmd))) pairs.push({ refB: b.cmd })
  }

  const correspondences: RunCorrespondence[] = []
  let bestDiv: { f: number; seq: number; summary: string; baseEvent?: EventHandle; candEvent?: EventHandle } | null = null

  for (const { refA, refB } of pairs) {
    const kA = refA ? keyOf(refA) : null
    const kB = refB ? keyOf(refB) : null
    const stA = kA ? outA.get(kA) : undefined
    const stB = kB ? outB.get(kB) : undefined
    const hA = kA ? handlesA.get(kA) : undefined
    const hB = kB ? handlesB.get(kB) : undefined

    if (!stA && !stB) {
      // 两边都未执行到（提前失败/截断）
      if (refA && refB) {
        correspondences.push({
          status: 'unanalyzed',
          ...(hA ? { base: hA } : {}),
          ...(hB ? { cand: hB } : {}),
          basis,
          unanalyzedReason: `两侧均未执行到此指令（base ${covA.status}，cand ${covB.status}）`,
        })
      }
      continue
    }

    if (stA && stB) {
      if (stA.kind !== stB.kind) {
        correspondences.push({
          status: 'addedOrRemoved',
          ...(hA ? { base: hA } : {}),
          ...(hB ? { cand: hB } : {}),
          basis,
        })
        const f = Math.min(stA.f, stB.f)
        const seq = hA?.eventSeq ?? hB?.eventSeq ?? 0
        if (!bestDiv || f < bestDiv.f || (f === bestDiv.f && seq < bestDiv.seq)) {
          bestDiv = { f, seq, summary: `指令 ${kA} 执行/跳过不同（${stA.kind} vs ${stB.kind}）`, ...(hA ? { baseEvent: hA } : {}), ...(hB ? { candEvent: hB } : {}) }
        }
        continue
      }
      const dw = stB.f - stA.f
      const db = roundTo(stB.battleFrame - stA.battleFrame, 100)
      correspondences.push({
        status: 'matched',
        ...(hA ? { base: hA } : {}),
        ...(hB ? { cand: hB } : {}),
        basis,
        delta: { worldFrames: dw, battleFrames: db },
      })
      if (dw !== 0 || db !== 0) {
        const f = Math.min(stA.f, stB.f)
        const seq = hA?.eventSeq ?? hB?.eventSeq ?? 0
        if (!bestDiv || f < bestDiv.f || (f === bestDiv.f && seq < bestDiv.seq)) {
          bestDiv = { f, seq, summary: `指令 ${kA} 帧差 ${dw} 世界帧（${db} 战斗帧）`, ...(hA ? { baseEvent: hA } : {}), ...(hB ? { candEvent: hB } : {}) }
        }
      }
      continue
    }

    if (stA && !stB) {
      if (!refB || covB.complete) {
        correspondences.push({ status: 'addedOrRemoved', ...(hA ? { base: hA } : {}), basis })
        const seq = hA?.eventSeq ?? 0
        if (!bestDiv || stA.f < bestDiv.f || (stA.f === bestDiv.f && seq < bestDiv.seq)) {
          bestDiv = { f: stA.f, seq, summary: `基准指令 ${kA} 在对照中未执行`, ...(hA ? { baseEvent: hA } : {}) }
        }
      } else {
        correspondences.push({
          status: 'unanalyzed',
          ...(hA ? { base: hA } : {}),
          basis,
          unanalyzedReason: `对照运行在到达之前停止（${covB.status}，第 ${covB.completedTicks} 帧）`,
        })
      }
      continue
    }

    // !stA && stB
    if (!refA || covA.complete) {
      correspondences.push({ status: 'addedOrRemoved', ...(hB ? { cand: hB } : {}), basis })
      const seq = hB?.eventSeq ?? 0
      if (!bestDiv || stB!.f < bestDiv.f || (stB!.f === bestDiv.f && seq < bestDiv.seq)) {
        bestDiv = { f: stB!.f, seq, summary: `对照新增或执行了指令 ${kB}`, ...(hB ? { candEvent: hB } : {}) }
      }
    } else {
      correspondences.push({
        status: 'unanalyzed',
        ...(hB ? { cand: hB } : {}),
        basis,
        unanalyzedReason: `基准运行在到达之前停止（${covA.status}，第 ${covA.completedTicks} 帧）`,
      })
    }
  }

  return {
    correspondences,
    firstDivergence: bestDiv
      ? { ...(bestDiv.baseEvent ? { baseEvent: bestDiv.baseEvent } : {}), ...(bestDiv.candEvent ? { candEvent: bestDiv.candEvent } : {}), summary: bestDiv.summary }
      : null,
  }
}

function diffEvents(
  pA: PreparedRun,
  resA: SimResult,
  pB: PreparedRun,
  resB: SimResult,
  sameAxis: boolean,
  covA: SideCoverage,
  covB: SideCoverage,
  target: Extract<DiffTarget, { kind: 'events' }>,
  mapping?: readonly (readonly [CommandRef, CommandRef])[],
): { correspondences: RunCorrespondence[]; firstDivergence: RunDiff['firstDivergence'] } {
  const metaA = resA.diag!.eventMeta!
  const metaB = resB.diag!.eventMeta!
  const cmdKey = (c: CommandRef) => `${c.loop}:${c.line}:${c.item}`

  // 改轴且没给映射：按结构键找候选，全部标 ambiguous（DD-07 §9）
  if (!sameAxis && !mapping) {
    const structKeyOf = (ev: SimEvent, meta: readonly EventMeta[], seq: number) => {
      const top = topOriginOf(meta, seq)
      const loop = top.kind === 'command' ? top.cmd.loop : 0
      return `${loop}|${eventContentKey(ev)}`
    }
    const candBuckets = new Map<string, EventHandle[]>()
    for (let i = 0; i < resB.log.length; i++) {
      const ev = resB.log[i]!
      if (target.types && !target.types.includes(ev.type)) continue
      const sk = structKeyOf(ev, metaB, i)
      const list = candBuckets.get(sk) ?? []
      list.push({ runId: pB.runId, eventSeq: i })
      candBuckets.set(sk, list)
    }
    const correspondences: RunCorrespondence[] = []
    for (let i = 0; i < resA.log.length; i++) {
      const ev = resA.log[i]!
      if (target.types && !target.types.includes(ev.type)) continue
      if (target.cmd) {
        const top = topOriginOf(metaA, i)
        if (top.kind !== 'command' || !sameCmd(top.cmd, target.cmd)) continue
      }
      const sk = structKeyOf(ev, metaA, i)
      correspondences.push({
        status: 'ambiguous',
        base: { runId: pA.runId, eventSeq: i },
        candidates: candBuckets.get(sk) ?? [],
        basis: 'structural',
      })
    }
    return { correspondences, firstDivergence: null }
  }

  const basis: 'commandRef' | 'explicitMapping' = sameAxis ? 'commandRef' : 'explicitMapping'
  const mapA = new Map<string, number>()
  const mapB = new Map<string, number>()
  if (mapping) {
    mapping.forEach(([ra, rb], idx) => {
      mapA.set(cmdKey(ra), idx)
      mapB.set(cmdKey(rb), idx)
    })
  }

  const filterCmdB = target.cmd && mapping
    ? (mapping.find(([ra]) => sameCmd(ra, target.cmd!))?.[1] ?? target.cmd)
    : target.cmd

  const rootKeyOf = (origin: EventMeta['origin'], side: 'A' | 'B'): { key: string; mapped: boolean } => {
    switch (origin.kind) {
      case 'command': {
        if (sameAxis) return { key: `cmd:${cmdKey(origin.cmd)}`, mapped: true }
        const m = side === 'A' ? mapA.get(cmdKey(origin.cmd)) : mapB.get(cmdKey(origin.cmd))
        return m !== undefined ? { key: `map:${m}`, mapped: true } : { key: `unmapped${side}:${cmdKey(origin.cmd)}`, mapped: false }
      }
      case 'autoInterject': return { key: `autoInterject:${origin.slot}:${origin.action}`, mapped: true }
      case 'timer': return { key: `timer:${origin.timerKind}:${origin.defId ?? ''}`, mapped: true }
      case 'init': return { key: `init:${origin.sourceId}`, mapped: true }
      case 'finalization': return { key: `finalization:${origin.step}`, mapped: true }
      default: return { key: `other:${origin.kind}`, mapped: true }
    }
  }

  interface SideItem { seq: number; ev: SimEvent; mapped: boolean }
  const collect = (res: SimResult, meta: readonly EventMeta[], side: 'A' | 'B', cmdFilter?: CommandRef) => {
    const items = new Map<string, SideItem>()
    const order: string[] = []
    const counts = new Map<string, number>()
    for (let seq = 0; seq < res.log.length; seq++) {
      const ev = res.log[seq]!
      if (target.types && !target.types.includes(ev.type)) continue
      const top = topOriginOf(meta, seq)
      if (cmdFilter && (top.kind !== 'command' || !sameCmd(top.cmd, cmdFilter))) continue
      const { key: rk, mapped } = rootKeyOf(top, side)
      const base = `${rk}|${eventContentKey(ev)}`
      const ord = counts.get(base) ?? 0
      counts.set(base, ord + 1)
      const fullKey = `${base}#${ord}`
      items.set(fullKey, { seq, ev, mapped })
      order.push(fullKey)
    }
    return { items, order }
  }

  const sideA = collect(resA, metaA, 'A', target.cmd)
  const sideB = collect(resB, metaB, 'B', filterCmdB)

  const seen = new Set<string>()
  const allKeys: string[] = []
  for (const k of sideA.order) { seen.add(k); allKeys.push(k) }
  for (const k of sideB.order) if (!seen.has(k)) { seen.add(k); allKeys.push(k) }

  const correspondences: RunCorrespondence[] = []
  let bestDiv: { f: number; seq: number; summary: string; baseEvent?: EventHandle; candEvent?: EventHandle } | null = null

  for (const k of allKeys) {
    const itA = sideA.items.get(k)
    const itB = sideB.items.get(k)

    if (itA && itB) {
      const hA: EventHandle = { runId: pA.runId, eventSeq: itA.seq }
      const hB: EventHandle = { runId: pB.runId, eventSeq: itB.seq }
      const dw = itB.ev.f - itA.ev.f
      const db = roundTo(battleFrameOf(itB.ev) - battleFrameOf(itA.ev), 100)
      const vA = eventValue(itA.ev), vB = eventValue(itB.ev)
      const dv = vA !== undefined && vB !== undefined ? roundTo(vB - vA, 1e6) : undefined
      correspondences.push({
        status: 'matched',
        base: hA,
        cand: hB,
        basis,
        delta: { worldFrames: dw, battleFrames: db, ...(dv !== undefined ? { value: dv } : {}) },
      })
      if (dw !== 0 || db !== 0 || (dv !== undefined && dv !== 0)) {
        const f = Math.min(itA.ev.f, itB.ev.f)
        if (!bestDiv || f < bestDiv.f || (f === bestDiv.f && itA.seq < bestDiv.seq)) {
          bestDiv = {
            f,
            seq: itA.seq,
            baseEvent: hA,
            candEvent: hB,
            summary: `${itA.ev.type} 事件不同（帧差 ${dw}${dv !== undefined && dv !== 0 ? `，数值差 ${dv}` : ''}）`,
          }
        }
      }
      continue
    }

    if (itA && !itB) {
      const hA: EventHandle = { runId: pA.runId, eventSeq: itA.seq }
      if (covB.complete && itA.mapped) {
        correspondences.push({ status: 'addedOrRemoved', base: hA, basis })
        if (!bestDiv || itA.ev.f < bestDiv.f || (itA.ev.f === bestDiv.f && itA.seq < bestDiv.seq)) {
          bestDiv = { f: itA.ev.f, seq: itA.seq, baseEvent: hA, summary: `对照缺少 ${itA.ev.type} 事件（seq ${itA.seq}）` }
        }
      } else {
        correspondences.push({
          status: 'unanalyzed',
          base: hA,
          basis,
          unanalyzedReason: !itA.mapped
            ? '所属指令未提供对应映射'
            : `对照运行未完整结束（${covB.status}，第 ${covB.completedTicks} 帧）`,
        })
      }
      continue
    }

    // !itA && itB
    const it = itB!
    const hB: EventHandle = { runId: pB.runId, eventSeq: it.seq }
    if (covA.complete && it.mapped) {
      correspondences.push({ status: 'addedOrRemoved', cand: hB, basis })
      if (!bestDiv || it.ev.f < bestDiv.f || (it.ev.f === bestDiv.f && it.seq < bestDiv.seq)) {
        bestDiv = { f: it.ev.f, seq: it.seq, candEvent: hB, summary: `对照多出 ${it.ev.type} 事件（seq ${it.seq}）` }
      }
    } else {
      correspondences.push({
        status: 'unanalyzed',
        cand: hB,
        basis,
        unanalyzedReason: !it.mapped
          ? '所属指令未提供对应映射'
          : `基准运行未完整结束（${covA.status}，第 ${covA.completedTicks} 帧）`,
      })
    }
  }

  return {
    correspondences,
    firstDivergence: bestDiv
      ? { ...(bestDiv.baseEvent ? { baseEvent: bestDiv.baseEvent } : {}), ...(bestDiv.candEvent ? { candEvent: bestDiv.candEvent } : {}), summary: bestDiv.summary }
      : null,
  }
}
