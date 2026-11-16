// src/engine/run.ts —— 归一入口、运行身份、新的运行入口与完成状态（DD-01；架构 §2.1–§2.4、§9）
// prepareRun：合并覆盖 → 校验 → （严格入口检查，DD-02）→ 装配 → 算身份，得到一份冻结的 PreparedRun；编译、运行、查询、重跑都用它。
// runPrepared：跑一次，结果带运行身份、完成状态与必有记录；引擎与钩子里的异常不往外抛，记成 engineError。
// 纯函数：不读盘、不读时钟。提交号、内容指纹由命令行采集后经 overrides.environment 传进来（src/cli/run-env.ts）。
import { DEFAULT_RULES, type GameData } from '../data/gamedata'
import { ScenarioSchema, type Scenario } from '../data/scenario.schema'
import type { SimOptions } from './context'
import { cachedDigest, canonicalJson, digestOf, sha256Hex } from './digest'
import { ResolveError, resolveScenario } from './resolve'
import {
  OUTPUT_SCHEMA_VERSION,
  type AxisFailureKind, type DamageScope, type PreparedRun, type PrepareIssue, type PrepareResult, type RunCompletion, type RunCoverage,
  type RunEnvironment, type RunIdentity, type RunOptions, type RunOverrides, type StrictReport,
} from './run-types'
import { checkStrictSource, checkStrictResolved, STRICT_CHECKS } from './strict'
import { INTENT_WAITS, ScheduleError, type ScheduleErrorCode } from './scheduler'
import { execute, type Execution } from './simulate'
import { battleFrameOf, summarize, windowEnd } from './summary'
import type { ResolvedMember, ResolvedScenario, SimEvent, SimResult, Summary } from './types'

// ---------------------------------------------------------------------------
// §3.2 归一入口

/** 唯一的归一入口。按固定顺序做五步，前一步有问题就停：合并 → 校验 → 严格入口检查 → 装配 → 算身份。
 *  同样的输入得到同样的 runId；返回的 PreparedRun 冻结了顶层与 effective、identity（resolved 太大不深冻结，引擎不写它） */
export function prepareRun(scenario: Scenario, data: GameData, overrides: RunOverrides = {}): PrepareResult {
  // ① 合并：overrides 给了的 > 场景写了的 > schema 缺省
  let rules = scenario.options.rules
  if (overrides.rules && Object.keys(overrides.rules).length > 0) {
    const m = mergeRulePaths(rules, overrides.rules)
    if (!m.ok) return { ok: false, issues: m.issues.map(message => ({ stage: 'resolve', code: 'resolve', message })) }
    rules = m.rules
  }
  const given = Object.fromEntries(Object.entries(overrides.options ?? {}).filter(([, v]) => v !== undefined))
  const merged = {
    ...scenario,
    ...(overrides.goal !== undefined ? { goal: overrides.goal } : {}),
    ...(overrides.enemy !== undefined ? { enemy: overrides.enemy } : {}),
    options: { ...scenario.options, ...given, ...(overrides.strict !== undefined ? { strict: overrides.strict } : {}), ...(rules !== undefined ? { rules } : {}) },
  }
  // ② 校验：有效场景再过一遍 schema，覆盖项也要合法
  const parsed = ScenarioSchema.safeParse(merged)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i): PrepareIssue => {
        const [part, index] = i.path
        const at = (part === 'rotation' || part === 'opening') && typeof index === 'number'
          ? { line: index + 1, ...(part === 'opening' ? { opening: true as const } : {}) } : {}
        return { stage: 'schema', ...at, code: 'schema', message: `${i.path.join('.') || '场景'}：${i.message}` }
      }),
    }
  }
  const effective = parsed.data
  const sourceIssues = checkStrictSource(effective)
  if (sourceIssues.length) return { ok: false, issues: sourceIssues }
  // ③、④ 严格入口检查（DD-02 §3.2）
  // 装配后按动作种类检查谐破与变奏
  let resolved: ResolvedScenario
  try {
    resolved = resolveScenario(effective, data)
  } catch (e) {
    if (!(e instanceof ResolveError)) throw e
    return { ok: false, issues: e.details.map(({ stage, message, ...at }): PrepareIssue => ({ stage, ...at, code: stage, message })) }
  }
  const checks = checkStrictResolved(resolved)
  if (checks.issues.length) return { ok: false, issues: checks.issues }
  resolved.warnings.push(...checks.warnings)
  // 卡帧点的操作延迟场景里写不出来，装配后补进 options（跟着进身份）
  if (overrides.inputDelayAt && Object.keys(overrides.inputDelayAt).length > 0)
    resolved = { ...resolved, options: { ...resolved.options, inputDelayAt: { ...overrides.inputDelayAt } } }
  // ⑤ 算身份
  const { video: _video, search: _search, ...executable } = effective as Scenario & { notation?: unknown }
  delete executable.notation                 // video、search、notation 不影响执行，不进摘要（notation 由 DD-02 加）
  const run = sealed(resolved, {
    scenarioDigest: digestOf(executable),
    strict: effective.options.strict ?? false,                           // DD-02 §3.1
    strictSource: overrides.strict !== undefined ? 'cli-override' : scenario.options.strict !== undefined ? 'scenario' : 'default',
    continueAfterIntentUnmet: overrides.continueAfterIntentUnmet ?? false,
    sample: overrides.sample ?? null,
    environment: overrides.environment,
  })
  return { ok: true, run, warnings: resolved.warnings }
}

/** 过渡用：已经装配好的结果直接包成 PreparedRun（兼容外壳 simulate 与还没迁移的分析层用）。场景内容没法知道，scenarioDigest 记 'unknown'；
 *  runId 仍由整份身份算出，两次不同的装配结果不会撞。DD-10 把最后一个调用方迁走后删掉 */
export function prepareResolved(r: ResolvedScenario, opts: { sample?: SimOptions['sample']; environment?: RunEnvironment } = {}): PreparedRun {
  return sealed(r, {
    scenarioDigest: 'unknown', strict: (r.options as { strict?: boolean }).strict === true, strictSource: 'default',
    continueAfterIntentUnmet: false, sample: opts.sample ?? null, environment: opts.environment,
  })
}

/** 把 { 'forteKeepOnSwitchBy.心': false, 'energyShare.dealer': 2, defFloor: true } 展开并合并进 options.rules 的输入对象（DD-01 §3.2；DD-04 §4.2）。
 *  父对象逐层浅拷贝后设值，不整体替换：场景里已有的 forteKeepOnSwitchBy: { 卜灵: false } 再合并 'forteKeepOnSwitchBy.心'，两个键都在。
 *  路径的第一段不是 Rules 自己的键时返回问题。合并结果仍交给装配时的逐项校验（角色名、类型不对在那里报）。
 *  装配对对象类的规则只合并一层（resolve.ts 的 resolveRules）：三段以上的路径会把第二层的对象整个换掉，现在没有这样的规则在用 */
export function mergeRulePaths(base: Record<string, unknown> | undefined, paths: Readonly<Record<string, number | boolean | string>>):
  { ok: true; rules: Record<string, unknown> } | { ok: false; issues: string[] } {
  const issues: string[] = []
  const out: Record<string, unknown> = { ...base }
  for (const [path, value] of Object.entries(paths)) {
    const segs = path.split('.')
    if (segs.some(s => s === '') || !Object.hasOwn(DEFAULT_RULES, segs[0]!)) {
      issues.push(`rules.${path}：没有这条规则（现有：${Object.keys(DEFAULT_RULES).join('、')}）`)
      continue
    }
    let at = out
    for (const seg of segs.slice(0, -1)) {
      const cur = at[seg]
      const next: Record<string, unknown> = typeof cur === 'object' && cur !== null && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : {}
      at[seg] = next
      at = next
    }
    at[segs.at(-1)!] = value
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, rules: out }
}

// ---------------------------------------------------------------------------
// §3.3 运行身份与摘要

interface Effective {
  scenarioDigest: string
  strict: boolean
  strictSource: PreparedRun['effective']['strictSource']
  continueAfterIntentUnmet: boolean
  sample: SimOptions['sample'] | null
  environment: RunEnvironment | undefined
}

function sealed(resolved: ResolvedScenario, e: Effective): PreparedRun {
  const o = resolved.options
  const delayed = o.inputDelay > 0 || Object.keys(o.inputDelayAt ?? {}).length > 0 || (e.sample?.jitter ?? 0) > 0 || e.sample?.hand !== undefined
  const env = e.environment
  // rules、options、sample 各存一份自己的拷贝：身份是这一刻的快照，调用方之后改自己手里的对象不影响它
  const identity: RunIdentity = deepFreeze({
    data: {
      xlsxFileDate: resolved.data.version,
      ...(env?.xlsxSha256 !== undefined ? { xlsxSha256: env.xlsxSha256 } : {}),
      ...(env?.resourceVersion !== undefined ? { resourceVersion: env.resourceVersion } : {}),
    },
    execution: {
      gitCommit: env?.gitCommit ?? 'unknown',
      ...(env?.contentFingerprint !== undefined ? { contentFingerprint: env.contentFingerprint } : {}),
      scenarioDigest: e.scenarioDigest,
      resolvedDigest: resolvedDigestOf(resolved),
      entryMode: resolved.purpose === 'replay' ? 'replay' : e.strict ? 'strict' : 'standard',
      strictSource: e.strictSource,
      inputTiming: delayed ? 'delayed' : 'earliest',
      rules: structuredClone(resolved.rules),
      options: structuredClone(o),
      sample: e.sample ? structuredClone(e.sample) : null,
      continueAfterIntentUnmet: e.continueAfterIntentUnmet,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    },
  })
  return Object.freeze({
    runId: `run-${sha256Hex(canonicalJson(identity)).slice(0, 16)}`,
    identity,
    resolved,
    effective: Object.freeze({ damageScope: damageScopeOf(resolved), strict: e.strict, strictSource: e.strictSource, continueAfterIntentUnmet: e.continueAfterIntentUnmet, sample: identity.execution.sample }),
  })
}

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x)) deepFreeze(v)
  }
  return x
}

/** 装配结果的摘要：分块算、按对象缓存（digest.ts）。整份 GameData 只算一次；只差一个开关、一条轴的变体共用队员、buff 的摘要。
 *  rules 与 options 不在里面，它们在身份里单列；warnings 是装配期的提示，purpose 进身份的 entryMode，都不算装配内容。
 *  fresh = true：不走缓存重算（核对"这些对象创建后没被改写"用） */
export function resolvedDigestOf(r: ResolvedScenario, fresh = false): string {
  const of = <T extends object>(x: T, strip?: (x: T) => unknown) => cachedDigest(x, strip, fresh)
  /** 一个对象的各个顶层字段分别算摘要：浅拷贝出来的对象（withHooks、换面板的队员）共用没变的那些字段的缓存 */
  const fields = (x: object, skip: readonly string[] = []) =>
    Object.fromEntries(Object.entries(x).filter(([k]) => !skip.includes(k)).map(([k, v]) => [k, typeof v === 'object' && v !== null ? { digest: of(v) } : v]))
  const member = (m: ResolvedMember) => of(m, x => ({
    ...x,
    def: of(x.def),                                             // 角色定义、武器、声骸是 GameData 里的同一个对象
    weapon: { def: of(x.weapon.def), rank: x.weapon.rank },
    echoes: x.echoes.map(e => ({ ...e, def: e.def ? of(e.def) : null })),
    actions: of(x.actions, a => Object.entries(a).map(([id, def]) => [id, of(def)])),
  }))
  return digestOf({
    data: of(r.data, d => fields(d, ['hooks'])),                // 整份 GameData 去掉钩子表
    team: r.team.map(member),
    enemy: of(r.enemy),
    buffs: of(r.buffs, bs => bs.map(b => ({ ...b, def: of(b.def) }))),
    effects: of(r.effects, es => es.map(x => ({ ...x, def: of(x.def) }))),
    commands: digestOf(r.commands), opening: digestOf(r.opening),
    initial: r.initial, tuneBreakTiming: r.tuneBreakTiming, goal: r.goal,
    ...(r.tuneBreakOmitted ? { tuneBreakOmitted: r.tuneBreakOmitted } : {}),
  })
}

// ---------------------------------------------------------------------------
// §3.4 新的运行入口

/** 跑一次。结果带 runId、identity、completion 与必有记录；本身不抛：引擎与钩子里的异常记成 completion.status === 'engineError'，
 *  日志与汇总保留到出错为止。例外是观察回调（opts.onHit）自己抛的异常，原样抛给调用方（那是调用方的错，不是这次运行的结论）。
 *  opts 是观察选项，不进运行身份；diag 的记录由 DD-05、DD-06 做，现在给了也不产出 */
export function runPrepared(p: PreparedRun, opts: RunOptions = {}): SimResult {
  return runWithFailure(p, opts).res
}

/** 同 runPrepared，另外带出没被归成调度错误的原异常（uncaught）：兼容外壳 simulate 要把它重新抛出（DD-01 §3.7） */
export function runWithFailure(p: PreparedRun, opts: RunOptions = {}): { res: SimResult; uncaught: { error: unknown } | null } {
  const r = p.resolved
  const x = execute(r, { continueAfterIntentUnmet: p.effective.continueAfterIntentUnmet, ...(p.effective.sample ? { sample: p.effective.sample } : {}), ...(opts.onHit ? { onHit: opts.onHit } : {}) })
  const summary = summarize(x.s.log, r, x.s)                    // 任何状态下都算，包括初始化没走完（这时是空汇总）；用不用由调用方按 completion 决定
  const completion = buildCompletion(x, r, summary)
  const e = x.failure?.error
  const error: SimResult['error'] = !x.failure ? undefined
    : e instanceof ScheduleError ? { code: e.code, message: e.message, frame: e.frame, ...(e.cmd ? { line: e.cmd.line, loop: e.cmd.loop } : {}) }
    : { code: 'uncaught', message: messageOf(e), frame: x.s.frame }
  const res: SimResult = {
    log: x.s.log, summary, forte: x.forte, cooldowns: x.cooldowns, ...(error ? { error } : {}),
    runId: p.runId, identity: p.identity, completion, interventions: x.sim.interventions,
    strictReport: strictReportOf(p, x), damageScope: p.effective.damageScope, ruleUsage: { byProposition: [], coverage: [] },
  }
  return { res, uncaught: x.failure && !(e instanceof ScheduleError) ? x.failure : null }
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** DD-02 §3.4：所有入口均生成报告。 */
function strictReportOf(p: PreparedRun, execution: Execution): StrictReport {
  const x = p.identity.execution
  const unmetIntents = [...execution.sim.unmetIntents]
  const error = execution.failure?.error
  if (error instanceof ScheduleError && error.intent && !unmetIntents.some(d => d.worldFrame === error.frame && d.kind === error.intent!.kind && d.cmd.line === error.intent!.cmd.line && d.cmd.item === error.intent!.cmd.item && d.cmd.loop === error.intent!.cmd.loop))
    unmetIntents.push({ ...error.intent, worldFrame: error.frame, continued: false })
  return {
    entry: x.entryMode, earliestLegalBaseline: x.entryMode === 'strict' && x.inputTiming === 'earliest',
    compileChecks: p.effective.strict ? STRICT_CHECKS.map(code => ({ code, passed: true })) : [],
    intentWaits: execution.s.log.flatMap(e => e.type === 'wait' && INTENT_WAITS.some(c => c === e.code) ? [{ cmd: e.cmd, code: e.code as StrictReport['intentWaits'][number]['code'], fromFrame: e.from, frames: e.frames, battleFrames: e.battleFrames, reason: e.reason }] : []),
    unmetIntents,
    hints: execution.sim.hints,
    ...timeoutContextOf(p, execution),
  }
}

/** 谐度破坏的口径（DD-02 §3.7 的表）：按最终的有效配置分类，"轴里有没有谐破动作"看装配后的动作种类。
 *  省略原因来自场景声明；没有声明则记 undeclared */
export function damageScopeOf(r: ResolvedScenario): DamageScope {
  const written = [...r.opening, ...r.commands].some(c => c.kind === 'act' && r.team[c.slot].actions[c.action]?.kind === 'tuneBreak')
  const omittedReason = r.tuneBreakOmitted?.reason ?? 'undeclared'
  switch (r.options.tuneBreak) {
    case 'auto': return { tuneBreak: { mode: written ? 'writtenPlusAuto' : 'auto' } }
    case 'manual': return { tuneBreak: written ? { mode: 'written' } : { mode: 'omitted', reason: omittedReason, gauge: 'accumulates' } }
    case 'off': return { tuneBreak: { mode: 'omitted', reason: written ? 'disabledByOption' : omittedReason, gauge: 'off' } }
  }
}

// ---------------------------------------------------------------------------
// §3.6 完成状态

/** 轴失败的调度错误码：同名映射到 AxisFailureKind（DD-02 §3.3） */
const AXIS_CODES: readonly ScheduleErrorCode[] = ['intentUnmet', 'comboBroken', 'timeout', 'notOnField', 'switchSelf', 'airEntry', 'entrySkill']
const ENGINE_CODES: readonly ScheduleErrorCode[] = ['chainDepth', 'invariant']

/** 由运行体留下的簿记算完成状态（DD-01 §3.6 的判定表；架构 §2.3 的七条停止路径）。
 *  "相位"取 k.at.phase，"在处理"取 bus.inFlight，循环怎么退出的取 x.loopExit，失败收尾做没做取 ScheduleError.viaFail */
export function buildCompletion(x: Execution, r: ResolvedScenario, summary: Summary): RunCompletion {
  const { s, sim, k } = x
  const bus = sim.bus
  const err = x.failure?.error
  const sched = err instanceof ScheduleError ? err : null
  const inFlight = bus.inFlight !== null ? { inFlightEventSeq: bus.inFlight } : {}
  const prefix = { eventEndExclusive: s.log.length, handledEndExclusive: bus.inFlight ?? bus.cursor, interventionEndExclusive: sim.interventions.length }
  const engineError = (): NonNullable<RunCompletion['engineError']> =>
    ({ code: sched && ENGINE_CODES.includes(sched.code) ? (sched.code as 'chainDepth' | 'invariant') : 'uncaught', message: messageOf(err) })

  let status: RunCompletion['status']
  let loopExitAt: RunCoverage['loopExitAt']
  let finalization: RunCoverage['finalization']
  let terminal: RunCoverage['terminal']['kind']
  let detail: Pick<RunCompletion, 'axisFailure' | 'truncation' | 'engineError'> = {}
  const exit = x.loopExit && { reason: x.loopExit.why === 'idle' ? 'idle' as const : 'maxFrames' as const, worldFrame: x.loopExit.worldFrame, phase: x.loopExit.phase }
  if (!x.failure && exit) {
    // 循环正常返回，收尾的 drain 做完：自然结束，或到帧数上限时指令已发完
    status = x.loopExit!.why === 'idle' ? 'completed' : 'truncated'
    loopExitAt = exit
    finalization = { kind: 'postDrain', completed: true }
    terminal = 'afterPostDrain'
    if (status === 'truncated') detail = { truncation: { kind: 'inFlightRemains', remains: remainsOf(x) } }
  } else if (!x.initCompleted) {
    // 初始化不执行指令，这里出的错一律是引擎错误（DD01-Q5）；连 S[0] 都不成立
    status = 'engineError'
    loopExitAt = { reason: 'engineError', worldFrame: s.frame, phase: 'init', ...inFlight }
    finalization = { kind: 'none', completed: true }
    terminal = 'initIncomplete'
    detail = { engineError: engineError() }
  } else if (exit) {
    // 循环早已正常退出，错出在收尾的 drain：loopExitAt 照实记 idle 或 maxFrames，不改写成 tick 中途失败
    status = 'engineError'
    loopExitAt = exit
    finalization = { kind: 'postDrain', completed: false, ...inFlight }
    terminal = 'postDrainFailed'
    detail = { engineError: engineError() }
  } else if (sched?.code === 'maxFrames') {
    // 到帧数上限、指令没发完：P7 之后抛出，fail 已关掉等待段；那条 wait 没被处理，handledEndExclusive 自然比 eventEndExclusive 小 1
    status = 'truncated'
    loopExitAt = { reason: 'maxFrames', worldFrame: s.frame, phase: k.at.phase }
    finalization = { kind: 'failClose', completed: true }
    terminal = 'afterFailClose'
    detail = { truncation: { kind: 'commandsPending', remains: remainsOf(x) } }
  } else if (sched && AXIS_CODES.includes(sched.code)) {
    status = 'axisFailed'
    loopExitAt = { reason: 'axisFailed', worldFrame: s.frame, phase: k.at.phase, ...inFlight }
    finalization = { kind: sched.viaFail ? 'failClose' : 'none', completed: true }
    terminal = 'midTick'
    detail = { axisFailure: { kind: sched.code as AxisFailureKind, detail: sched.message, ...(sched.intent ? { unmetIntent: sched.intent } : {}) } }
  } else {
    // 连锁过深、不变量不成立、钩子抛错：不经调度器的 fail，等待段不关；正在处理的那条事件可能只跑了一部分处理器
    status = 'engineError'
    loopExitAt = { reason: 'engineError', worldFrame: s.frame, phase: k.at.phase, ...inFlight }
    finalization = { kind: 'none', completed: true }
    terminal = 'midTick'
    detail = { engineError: engineError() }
  }

  if (sim.unmetIntents.length && status !== 'engineError') {
    status = 'axisFailed'
    detail = { axisFailure: { kind: 'intentUnmet', unmetIntent: sim.unmetIntents[0]!, detail: sim.unmetIntents[0]!.actual } }
  }
  const loops = loopsOf(s.log, x, r, status)
  const st = summary.steady
  const steadyReached = (): boolean => {
    if (!st) return false
    // 稳态的每一轮：执行上结束边界已确认，统计上真实的结束边界不晚于统计窗口终点（DD-03 §7.1；endAt 可能把某一轮截掉一半）
    for (let n = st.from; n <= st.to; n++) {
      const end = loops.roundEnds.find(e => e.loop === n)?.endBattleFrame
      if (n > loops.completed || end === undefined || end > summary.windowFrames) return false
    }
    return true
  }
  const n = sim.interventions.length
  return {
    ...(sim.continuationFrom ? { diagnosticContinuationFrom: sim.continuationFrom } : {}),
    status, ...detail,
    coverage: {
      initCompleted: x.initCompleted,
      completedTicks: s.frame,                                  // 世界帧只在 P7 加 1，任何时刻都等于走完的 tick 数
      loggedEventEndExclusive: s.log.length,
      loopExitAt, finalization,
      terminal: { kind: terminal, prefix },
    },
    loops,
    goal: r.goal.kind === 'steady' ? { kind: 'steady', reached: steadyReached() } : { kind: r.goal.kind, reached: summary.goal?.reached ?? false },
    conditioning: n === 0 ? { basis: 'unconditioned', firstInterventionIndex: null } : { basis: 'conditioned', firstInterventionIndex: 0 },
  }
}

/** 截断时还剩什么（架构 §2.2）。没执行的指令分两支：还在启动轴时，后面是启动轴剩下的加整个循环轴的 repeat 轮 */
function remainsOf(x: Execution): NonNullable<RunCompletion['truncation']>['remains'] {
  const { s } = x
  const q = s.queue
  const pendingCommands = q.loop === 0
    ? (q.opening.length - q.next) + q.repeat * q.commands.length
    : (q.commands.length - q.next) + (q.repeat - q.loop) * q.commands.length
  return {
    pendingCommands,
    activeActions: s.chars.filter(c => c.action && !c.action.ended).length,
    pendingJudgments: s.judgments.length,
    pendingTails: s.tails.length,
  }
}

/** 执行轮数：只认日志里的轮边界（loop 事件），不看调度游标——末条指令发完了动作可能还在场上，游标前移了下一轮也可能还没开始。
 *  一轮的结束边界已确认 = 日志里有下一轮的 loop 事件，或者它是最后开始的一轮、并且整次运行自然结束（completed）。
 *  与汇总的分轮口径一致（第 k 轮 = [第 k 轮的 loop 事件, 第 k + 1 轮的 loop 事件)），但不受 endAt 影响：它只截统计窗口，不截执行 */
function loopsOf(log: readonly SimEvent[], x: Execution, r: ResolvedScenario, status: RunCompletion['status']): RunCompletion['loops'] {
  const marks = log.filter((e): e is Extract<SimEvent, { type: 'loop' }> => e.type === 'loop')
  const started = marks.filter(e => e.loop >= 1).length
  const roundEnds = marks.flatMap((e, i): RunCompletion['loops']['roundEnds'][number][] => {
    const next = marks[i + 1]
    if (next) return [{ loop: e.loop, endBattleFrame: battleFrameOf(next) }]
    return status === 'completed' ? [{ loop: e.loop, endBattleFrame: windowEnd(log, x.s) }] : []   // 不带 endAt 的统计窗口终点
  })
  return {
    planned: x.s.queue.repeat,
    started,
    completed: roundEnds.filter(e => e.loop >= 1).length,
    openingCompleted: r.opening.length === 0 ? null : started >= 1 || status === 'completed',
    roundEnds,
  }
}

// DD-02 §3.4：超时条件在 fail 清等待段之前保存；资源取失败终态。
function timeoutContextOf(p: PreparedRun, x: Execution): Pick<StrictReport, 'timeoutContext'> {
  const e = x.failure?.error
  if (!(e instanceof ScheduleError) || e.code !== 'timeout' || !e.blocked || !e.cmd) return {}
  const c = (e.cmd.loop === 0 ? p.resolved.opening : p.resolved.commands).find(c => c.line === e.cmd!.line && c.item === e.cmd!.item)
  type Role = 'actor' | 'switchOut' | 'switchIn'
  const subject = (slot: number, role: Role) => { const ch = x.s.chars[slot]!; return { role, char: ch.name, energy: ch.energy, concerto: ch.concerto, core: [...ch.core], cooldowns: { ...ch.cooldowns } } }
  const subjects = c?.kind === 'act' ? [subject(c.slot, 'actor')] : c?.kind === 'switch' ? [subject(x.s.onField, 'switchOut'), subject(c.to, 'switchIn')] : []
  const code = e.blocked.code
  const blockingRole: Role | undefined = ['input', 'delay'].includes(code) ? undefined : c?.kind === 'act' ? 'actor' : c?.kind === 'switch' ? (['switchCd', 'entryBusy'].includes(code) ? 'switchIn' : ['globalStop', 'concertoSettle', 'switchLock', 'airborne'].includes(code) ? 'switchOut' : undefined) : undefined
  return { timeoutContext: { maxWait: p.resolved.options.maxWait, cmd: e.cmd, blocked: e.blocked, subjects, ...(blockingRole ? { blockingRole } : {}) } }
}
