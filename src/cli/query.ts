// src/cli/query.ts —— 状态查询与可解释性命令行（DD-07 §10.3；T07-10）。
// 用法：pnpm query <场景.yaml> <子命令> [参数...]
// 退出码：0 正常 / truncated / axisFailed；1 engineError（仍输出信封）；2 参数错误、准备失败或 QueryError。
// 能力说明（信封的 capability）：capabilitiesUsed 与 unsupported 用 DD-07 §10.1 的固定字符串；伤害口径的两项（未含谐度破坏）由 envelope 自己补。
// 每个子命令尽量只跑一次：查询函数能复用这次运行的（statesAndResult、terminalStateOf、explainEvent / commandCheck 的 res），
// 信封里的完成状态就取这一次的；只有 why-not、would 还要另跑一次（触发检查要按目标插桩、假想事件只跑到那一帧）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ResourceKind, Slot } from '../data/common'
import type { Scenario } from '../data/scenario.schema'
import { loadGameData } from '../data/load'
import {
  checkLedgerClosure, ledgerTotals, type LedgerCauseKind, type ResourceLedgerEntry, type ResourceTotals,
} from '../engine/diagnostics'
import {
  commandCheck, diffRuns, eventsBetween, eventsBySeq, EXPLAIN_DIAG, explainEvent, replayTo, statesAndResult, terminalStateOf,
  whyDidEventNotTrigger, wouldHypotheticalEventTrigger,
  type DiffTarget, type HypotheticalEvent, type QueryResult, type TriggerTarget,
} from '../engine/query'
import { prepareRun, runPrepared } from '../engine/run'
import type { PrepareIssue, PreparedRun, RunOverrides } from '../engine/run-types'
import type { CommandRef, SimEventType, SimResult } from '../engine/types'
import { envelope, toWire } from '../engine/wire'
import { loadScenario, pickFillCombo } from './format'
import { collectRunEnvironment } from './run-env'

class CliArgError extends Error {}

function usage(): string {
  return [
    '用法：pnpm query <场景.yaml> <子命令> [参数...] [通用覆盖...]',
    '',
    '子命令：',
    '  run                                              汇总、strictReport、谐破口径、事件数（完成状态、身份、规则使用在信封里；--log 附完整事件日志）',
    '  state     --frame <f> | --frames <f1,f2,...>     查询 tick 边界 S[f] 状态视图',
    '  terminal                                         查询终态视图与完成覆盖范围',
    '  events    --seq <a..b> | --window <lo..hi>       查询日志事件 [from, to) 或战斗帧窗口（--types t1,t2 可选过滤）',
    '  explain   --seq <n> [--lookback N --lookahead N] 解释事件出处、命中输入、规则与 buff 窗口余量',
    '  command   --loop <l> --line <n> --item <i> [--evaluation <e>]  解释指令为何等待 / 跳过 / 执行',
    '  why-not   --seq <n> --kind <buff|buffExtend|resourceEffect|consume|charHook> --owner <0|1|2|角色|env> --id <id>',
    '  would     --frame <f> --event <JSON> --kind <buff|buffExtend|resourceEffect|consume|charHook> --owner <0|1|2|角色|env> --id <id>',
    '  ledger    [--totals] [--clock world|battle] [--from <a>] [--to <b>] [--slot <0|1|2> | --char <名>] [--resource <res>] [--cause <k1,k2>]',
    '  diff      [<另一场景.yaml>] [--target metrics|commands|events] [--types t1,t2] [--cmd <轮>:<条>.<项>] [--mapping <轮>:<条>.<项>=<轮>:<条>.<项> ...]',
    '            [--cand-fill <填法组合>] [--cand-rule k=v ...] [--cand-option k=v ...] [--cand-strict|--cand-no-strict]',
    '            --cmd 只比这条指令引出的事件（events）；--mapping 改了轴时两边指令的对应（可重复，DD-07 §9；不给时改轴的比较全部是 ambiguous）',
    '',
    '通用参数：',
    '  --strict / --no-strict         覆盖严格模式',
    '  --rule <path>=<value>          覆盖规则项（可重复）',
    '  --option <key>=<value>         覆盖 options（repeat/maxFrames/maxWait/endAt/tuneBreak/inputDelay，可重复）',
    '  --seed <n>                     使用随机种子（抽样模式）',
    '  --continue-after-intent-unmet  意图未满足后继续执行',
    '  --out <文件>                   输出 JSON 写入文件而非 stdout',
    '  --fill <组合名>                录像剖析有几个填法组合时选一个（DD-09 §3.1；对比场景用 --cand-fill）',
  ].join('\n')
}

interface ParsedCli {
  pos: string[]
  help: boolean
  strict?: boolean
  candStrict?: boolean
  continueAfterIntentUnmet: boolean
  totals: boolean
  withLog: boolean
  rules: string[]
  options: string[]
  candRules: string[]
  candOptions: string[]
  mappings: string[]
  single: Record<string, string>
}

const VALUE_FLAGS = new Set([
  '--rule', '--option', '--cand-rule', '--cand-option', '--seed', '--out',
  '--frame', '--frames', '--seq', '--window', '--lookback', '--lookahead',
  '--loop', '--line', '--item', '--evaluation',
  '--kind', '--owner', '--id', '--event',
  '--clock', '--from', '--to', '--slot', '--char', '--resource', '--cause',
  '--target', '--types', '--fill', '--cand-fill', '--cmd', '--mapping',
])

function parseCli(argv: string[]): ParsedCli {
  const args = argv.filter(a => a !== '--')
  const out: ParsedCli = {
    pos: [],
    help: false,
    continueAfterIntentUnmet: false,
    totals: false,
    withLog: false,
    rules: [],
    options: [],
    candRules: [],
    candOptions: [],
    mappings: [],
    single: {},
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--help' || a === '-h') { out.help = true; continue }
    if (a === '--strict') { out.strict = true; continue }
    if (a === '--no-strict') { out.strict = false; continue }
    if (a === '--cand-strict') { out.candStrict = true; continue }
    if (a === '--cand-no-strict') { out.candStrict = false; continue }
    if (a === '--continue-after-intent-unmet') { out.continueAfterIntentUnmet = true; continue }
    if (a === '--totals') { out.totals = true; continue }
    if (a === '--log') { out.withLog = true; continue }
    if (VALUE_FLAGS.has(a)) {
      if (i + 1 >= args.length) throw new CliArgError(`${a} 缺少参数值`)
      const v = args[++i]!
      if (a === '--rule') out.rules.push(v)
      else if (a === '--option') out.options.push(v)
      else if (a === '--cand-rule') out.candRules.push(v)
      else if (a === '--cand-option') out.candOptions.push(v)
      else if (a === '--mapping') out.mappings.push(v)
      else out.single[a.slice(2)] = v
      continue
    }
    if (a.startsWith('-')) throw new CliArgError(`未知参数：${a}`)
    out.pos.push(a)
  }
  return out
}

function parseScalar(raw: string): number | boolean | string {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

function parseKvList(items: readonly string[], flag: string): Record<string, number | boolean | string> {
  const rec: Record<string, number | boolean | string> = {}
  for (const item of items) {
    const eq = item.indexOf('=')
    if (eq <= 0) throw new CliArgError(`${flag} 格式应为 key=value，收到：${item}`)
    const key = item.slice(0, eq).trim()
    const val = item.slice(eq + 1).trim()
    if (!key) throw new CliArgError(`${flag} 的键为空：${item}`)
    rec[key] = parseScalar(val)
  }
  return rec
}

const INT_OPTIONS = new Set(['repeat', 'maxFrames', 'maxWait', 'endAt', 'inputDelay'])
const VALID_OPTIONS = new Set(['repeat', 'maxFrames', 'maxWait', 'endAt', 'tuneBreak', 'inputDelay'])

function parseOptionsMap(items: readonly string[], flag: string): RunOverrides['options'] {
  if (items.length === 0) return undefined
  const raw = parseKvList(items, flag)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!VALID_OPTIONS.has(k)) throw new CliArgError(`${flag} 不支持选项 "${k}"`)
    if (INT_OPTIONS.has(k)) {
      if (typeof v !== 'number' || !Number.isInteger(v)) throw new CliArgError(`${flag} ${k} 需要整数，收到：${String(v)}`)
      out[k] = v
    } else if (k === 'tuneBreak') {
      if (v !== 'auto' && v !== 'manual' && v !== 'off') throw new CliArgError(`${flag} tuneBreak 应为 auto|manual|off`)
      out[k] = v
    }
  }
  return out as RunOverrides['options']
}

function parseIntStrict(raw: string | undefined, name: string): number {
  if (raw === undefined || !/^-?\d+$/.test(raw)) throw new CliArgError(`${name} 需要整数，收到：${raw ?? '(未提供)'}`)
  return Number(raw)
}

function parseNumStrict(raw: string | undefined, name: string): number {
  if (raw === undefined || raw.trim() === '') throw new CliArgError(`${name} 缺少数字`)
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new CliArgError(`${name} 需要有限数字，收到：${raw}`)
  return n
}

function parseIntRange(raw: string): [number, number] {
  if (/^\d+$/.test(raw)) { const n = Number(raw); return [n, n + 1] }
  const m = /^(\d+)\.\.(\d+)$/.exec(raw)
  if (!m) throw new CliArgError(`--seq 应为 <from>..<to> 或单个序号，收到：${raw}`)
  return [Number(m[1]), Number(m[2])]
}

function parseFloatRange(raw: string): [number, number] {
  const m = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(raw)
  if (!m) throw new CliArgError(`--window 应为 <lo>..<hi>，收到：${raw}`)
  return [Number(m[1]), Number(m[2])]
}

/** 指令出处写成 <轮>:<条>.<项>（第 0 轮是启动轴），同报错里的写法 */
function parseCmdRef(raw: string, flag: string): CommandRef {
  const m = /^(\d+):(\d+)\.(\d+)$/.exec(raw.trim())
  if (!m) throw new CliArgError(`${flag} 应写成 <轮>:<条>.<项>（如 1:6.2），收到：${raw}`)
  return { loop: Number(m[1]), line: Number(m[2]), item: Number(m[3]) }
}

function parseMapping(items: readonly string[]): [CommandRef, CommandRef][] {
  return items.map(item => {
    const [a, b, ...rest] = item.split('=')
    if (!a || !b || rest.length) throw new CliArgError(`--mapping 应写成 <轮>:<条>.<项>=<轮>:<条>.<项>，收到：${item}`)
    return [parseCmdRef(a, '--mapping'), parseCmdRef(b, '--mapping')]
  })
}

const VALID_TRIGGER_KINDS = new Set(['buff', 'buffExtend', 'resourceEffect', 'consume', 'charHook'])

function parseTarget(single: Record<string, string>, p: PreparedRun): TriggerTarget {
  const rawKind = single.kind === 'extend' ? 'buffExtend' : single.kind
  if (!rawKind || !VALID_TRIGGER_KINDS.has(rawKind)) {
    throw new CliArgError(`--kind 应为 buff|buffExtend|resourceEffect|consume|charHook，收到：${single.kind ?? '(未提供)'}`)
  }
  const kind = rawKind as TriggerTarget['kind']
  const rawOwner = single.owner
  if (!rawOwner) throw new CliArgError('缺少 --owner <0|1|2|角色|env>')
  let owner: TriggerTarget['owner']
  if (rawOwner === 'env') {
    owner = 'env'
  } else if (rawOwner === '0' || rawOwner === '1' || rawOwner === '2') {
    owner = Number(rawOwner) as Slot
  } else {
    const idx = p.resolved.team.findIndex(m => m.def.name === rawOwner)
    if (idx < 0) throw new CliArgError(`--owner 找不到角色 "${rawOwner}"（应为 0/1/2/角色名/env）`)
    owner = idx as Slot
  }
  const id = single.id
  if (!id) throw new CliArgError('缺少 --id <buff或延长定义id>')
  return { kind, owner, id }
}

function formatPrepareIssues(issues: readonly PrepareIssue[]): string {
  return issues.map(i => `[${i.stage}/${i.code}] ${i.message}`).join('\n')
}

function formatQueryError(err: Extract<QueryResult<unknown>, { ok: false }>['error']): string {
  switch (err.code) {
    case 'outOfRange': return `查询越界：${err.message}（completedTicks=${err.completedTicks}）`
    case 'noLegalState': return `没有合法状态：${err.message}`
    case 'runIdMismatch': return `runId 不匹配：期望 ${err.expected}，实际 ${err.got}`
    case 'eventOutOfRange': return `事件序号越界：已记录范围 [0, ${err.loggedEventEndExclusive})`
    case 'unsupported': return `不支持的查询：${err.what}`
  }
}

function emitEnvelope(
  p: PreparedRun,
  res: SimResult,
  data: unknown,
  used: readonly string[],
  unsupported: readonly string[],
  outFile?: string,
  extraExitCode = 0,
): number {
  const wire = toWire(envelope(p, res, data, used, unsupported))
  const text = JSON.stringify(wire, null, 2) + '\n'
  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, text, 'utf8')
  } else {
    process.stdout.write(text)
  }
  if (res.completion.status === 'engineError') return 1
  return extraExitCode
}

async function main(): Promise<number> {
  const t0 = performance.now()
  let parsed: ParsedCli
  try {
    parsed = parseCli(process.argv.slice(2))
  } catch (e) {
    if (e instanceof CliArgError) {
      console.error(e.message)
      console.error(usage())
      return 2
    }
    throw e
  }

  if (parsed.help) {
    console.log(usage())
    return 0
  }

  const [scenarioPath, subcmd, thirdPos, ...restPos] = parsed.pos
  if (!scenarioPath || !subcmd || restPos.length > 0 || (thirdPos !== undefined && subcmd !== 'diff')) {
    console.error('参数数量不正确')
    console.error(usage())
    return 2
  }

  let scenario: Scenario
  try {
    scenario = pickFillCombo(loadScenario(scenarioPath), parsed.single.fill)   // 录像剖析有几个填法组合时 --fill 选一个（DD-09 §3.1）
  } catch (e) {
    console.error(`读取场景失败（${scenarioPath}）：${e instanceof Error ? e.message : String(e)}`)
    return 2
  }

  let env
  try {
    env = collectRunEnvironment()
  } catch {
    env = { gitCommit: 'unknown' }
  }

  let baseOverrides: RunOverrides
  try {
    const rules = parsed.rules.length > 0 ? parseKvList(parsed.rules, '--rule') : undefined
    const options = parseOptionsMap(parsed.options, '--option')
    const sample = parsed.single.seed !== undefined ? { seed: parseIntStrict(parsed.single.seed, '--seed') } : undefined
    baseOverrides = {
      ...(parsed.strict !== undefined ? { strict: parsed.strict } : {}),
      ...(parsed.continueAfterIntentUnmet ? { continueAfterIntentUnmet: true } : {}),
      ...(rules ? { rules } : {}),
      ...(options ? { options } : {}),
      ...(sample ? { sample } : {}),
      environment: env,
    }
  } catch (e) {
    if (e instanceof CliArgError) { console.error(e.message); return 2 }
    throw e
  }

  const data = await loadGameData()
  const prepA = prepareRun(scenario, data, baseOverrides)
  if (!prepA.ok) {
    console.error(formatPrepareIssues(prepA.issues))
    return 2
  }
  const p = prepA.run
  const outFile = parsed.single.out

  let code: number
  try {
    switch (subcmd) {
      case 'run': {
        // DD-07 §10.3：完成状态、身份、规则使用在信封里；数据部分是汇总的要点、strictReport（DD-02 §3.4）与谐破口径（DD-02 §3.7）
        const res = runPrepared(p)
        const payload = {
          runId: res.runId,
          summary: res.summary,
          strictReport: res.strictReport,
          damageScope: res.damageScope,
          eventCount: res.log.length,
          ...(parsed.withLog ? { log: res.log } : {}),
        }
        code = emitEnvelope(p, res, payload, ['run'], [], outFile)
        break
      }

      case 'state': {
        if (parsed.single.frame !== undefined && parsed.single.frames !== undefined) {
          throw new CliArgError('--frame 与 --frames 不能同时指定')
        }
        if (parsed.single.frame === undefined && parsed.single.frames === undefined) {
          throw new CliArgError('state 需要 --frame <f> 或 --frames <f1,f2,...>')
        }
        const single = parsed.single.frame !== undefined
        const frames = single
          ? [parseIntStrict(parsed.single.frame, '--frame')]
          : parsed.single.frames!.split(',').filter(Boolean).map(s => parseIntStrict(s.trim(), '--frames'))
        if (frames.length === 0) throw new CliArgError('--frames 不能为空')
        // 一次完整运行：边界上取状态，跑完的结果写信封（不为信封另跑一遍）
        const { states, result } = statesAndResult(p, frames)
        if (!states.ok) { console.error(formatQueryError(states.error)); return 2 }
        code = emitEnvelope(p, result, single ? states.value[0] : states.value, ['state.recompute'], [], outFile)
        break
      }

      case 'terminal': {
        const rep = replayTo(p, { kind: 'terminal' })
        if (rep.kind !== 'complete') throw new CliArgError('terminal 未返回完成结果')
        code = emitEnvelope(p, rep.result, terminalStateOf(rep), ['state.recompute'], [], outFile)
        break
      }

      case 'events': {
        if ((parsed.single.seq === undefined) === (parsed.single.window === undefined)) {
          throw new CliArgError('events 需要且只能指定 --seq <a..b> 或 --window <lo..hi> 之一')
        }
        const res = runPrepared(p, { diag: { eventMeta: true } })
        const qr = parsed.single.seq !== undefined
          ? eventsBySeq(res, ...parseIntRange(parsed.single.seq))
          : eventsBetween(res, ...parseFloatRange(parsed.single.window!))
        if (!qr.ok) { console.error(formatQueryError(qr.error)); return 2 }
        const typeSet = parsed.single.types ? new Set(parsed.single.types.split(',').map(s => s.trim()).filter(Boolean) as SimEventType[]) : null
        const list = typeSet ? qr.value.filter(r => typeSet.has(r.event.type)) : qr.value
        code = emitEnvelope(p, res, list, ['diag.eventMeta'], [], outFile)
        break
      }

      case 'explain': {
        const seq = parseIntStrict(parsed.single.seq, '--seq')
        const lookback = parsed.single.lookback !== undefined ? parseIntStrict(parsed.single.lookback, '--lookback') : undefined
        const lookahead = parsed.single.lookahead !== undefined ? parseIntStrict(parsed.single.lookahead, '--lookahead') : undefined
        const res = runPrepared(p, { diag: EXPLAIN_DIAG })              // 带解释要的诊断跑一次，查询直接用它（DD-05 的零干扰：完成状态与不带诊断时相同）
        const qr = explainEvent(p, { runId: p.runId, eventSeq: seq }, {
          ...(lookback !== undefined ? { lookback } : {}),
          ...(lookahead !== undefined ? { lookahead } : {}),
          res,
        })
        if (!qr.ok) { console.error(formatQueryError(qr.error)); return 2 }
        const exp = qr.value
        const used = ['diag.eventMeta', 'diag.hitInputs', 'diag.resourceLedger', 'diag.ruleTrace', ...(exp.windowMargins ? ['diag.hitMargins'] : [])]
        const ev = res.log[seq]
        // 只解释直接来源与当场的输入（scope: direct_causes_and_immediate_inputs_only）；异常效应自身的伤害没记公式输入
        const unsupported = ['间接的时序影响', ...(!exp.hitInputs && ev?.type === 'hit' && ev.effect !== undefined ? ['异常效应伤害的输入'] : [])]
        code = emitEnvelope(p, res, exp, used, unsupported, outFile)
        break
      }

      case 'command': {
        const loop = parseIntStrict(parsed.single.loop, '--loop')
        const line = parseIntStrict(parsed.single.line, '--line')
        const item = parseIntStrict(parsed.single.item, '--item')
        const evaluationIndex = parsed.single.evaluation !== undefined ? parseIntStrict(parsed.single.evaluation, '--evaluation') : undefined
        const res = runPrepared(p, { diag: { commandVerdicts: true } })   // 查询复用这一次（只另跑到要检查的那次求值）
        const qr = commandCheck(p, { loop, line, item }, { ...(evaluationIndex !== undefined ? { evaluationIndex } : {}), res })
        if (!qr.ok) { console.error(formatQueryError(qr.error)); return 2 }
        const def = (loop === 0 ? p.resolved.opening : p.resolved.commands).find(c => c.line === line && c.item === item)
        const used = ['state.recompute', 'diag.commandVerdicts', ...(def?.kind === 'act' ? ['probe.act'] : def?.kind === 'switch' ? ['probe.switch'] : [])]
        // 只读求值做不了的条件（钩子在检查里要写状态、抽样模式的操作延迟还没抽）：status unmodeled 的各列一项
        const unsupported = qr.value.conditions.filter(c => c.status === 'unmodeled').map(c => (c.id === 'inputDelay' ? '抽样模式的操作延迟' : `${c.id} 只读求值`))
        code = emitEnvelope(p, res, qr.value, used, unsupported, outFile)
        break
      }

      case 'why-not': {
        const seq = parseIntStrict(parsed.single.seq, '--seq')
        const target = parseTarget(parsed.single, p)
        const res = runPrepared(p)
        const qr = whyDidEventNotTrigger(p, { runId: p.runId, eventSeq: seq }, target)
        if (!qr.ok) { console.error(formatQueryError(qr.error)); return 2 }
        const unsupported = qr.value.outcome === 'unsupported' ? ['charHook 内部'] : []
        code = emitEnvelope(p, res, qr.value, ['diag.triggerChecks'], unsupported, outFile)
        break
      }

      case 'would': {
        const frame = parseIntStrict(parsed.single.frame, '--frame')
        if (!parsed.single.event) throw new CliArgError('would 需要 --event <JSON>')
        let rawEv: unknown
        try {
          rawEv = JSON.parse(parsed.single.event)
        } catch (e) {
          throw new CliArgError(`--event JSON 解析失败：${e instanceof Error ? e.message : String(e)}`)
        }
        if (typeof rawEv !== 'object' || rawEv === null || Array.isArray(rawEv) || typeof (rawEv as { type?: unknown }).type !== 'string') {
          throw new CliArgError('--event 必须是含 type 字段的 JSON 对象')
        }
        const target = parseTarget(parsed.single, p)
        const res = runPrepared(p)
        const qr = wouldHypotheticalEventTrigger(p, frame, rawEv as HypotheticalEvent, target)
        if (!qr.ok) { console.error(formatQueryError(qr.error)); return 2 }
        // 用的是 S[frame]（这一帧开始时的状态），不是帧内某一刻（DD-07 §6）
        const unsupported = ['帧内时刻', ...(qr.value.outcome === 'unsupported' ? ['charHook 内部'] : [])]
        code = emitEnvelope(p, res, qr.value, ['state.recompute', 'probe.firing'], unsupported, outFile)
        break
      }

      case 'ledger': {
        const clock = parsed.single.clock ?? 'world'
        if (clock !== 'world' && clock !== 'battle') throw new CliArgError(`--clock 应为 world 或 battle，收到：${clock}`)
        const fromFrame = parsed.single.from !== undefined ? parseNumStrict(parsed.single.from, '--from') : undefined
        const toFrame = parsed.single.to !== undefined ? parseNumStrict(parsed.single.to, '--to') : undefined
        if (parsed.single.slot !== undefined && parsed.single.char !== undefined) {
          throw new CliArgError('--slot 与 --char 不能同时指定')
        }
        let slotFilter: Slot | undefined
        if (parsed.single.slot !== undefined) {
          const s = parseIntStrict(parsed.single.slot, '--slot')
          if (s !== 0 && s !== 1 && s !== 2) throw new CliArgError(`--slot 应为 0/1/2，收到：${s}`)
          slotFilter = s
        } else if (parsed.single.char !== undefined) {
          const idx = p.resolved.team.findIndex(m => m.def.name === parsed.single.char)
          if (idx < 0) throw new CliArgError(`队伍里没有角色：${parsed.single.char}`)
          slotFilter = idx as Slot
        }
        const resourceFilter = parsed.single.resource as ResourceKind | undefined
        const causeKinds = parsed.single.cause
          ? parsed.single.cause.split(',').map(s => s.trim()).filter(Boolean) as LedgerCauseKind[]
          : undefined

        const rep = replayTo(p, { kind: 'terminal' }, { diag: { resourceLedger: true } })
        if (rep.kind !== 'complete') throw new CliArgError('ledger 未返回完成结果')
        const res = rep.result
        const fullLedger: readonly ResourceLedgerEntry[] = res.diag?.resourceLedger ?? []
        const closureEnd = res.diag?.ledgerMarks?.terminalEndExclusive ?? fullLedger.length
        const closureMismatches = res.completion.coverage.initCompleted
          ? checkLedgerClosure(fullLedger, closureEnd, rep.state)
          : []

        const used = ['diag.resourceLedger', 'ledger.closure']
        if (parsed.totals) {
          used.push('ledger.totals')
          const rawTotals: ResourceTotals[] = ledgerTotals(fullLedger, {
            clock,
            ...(fromFrame !== undefined ? { fromFrame } : {}),
            ...(toFrame !== undefined ? { toFrame } : {}),
            ...(causeKinds && causeKinds.length > 0 ? { causeKinds } : {}),
          })
          const totals = rawTotals.filter(t =>
            (slotFilter === undefined || t.slot === slotFilter)
            && (resourceFilter === undefined || t.resource === resourceFilter),
          )
          const payload = {
            clock,
            ...(fromFrame !== undefined ? { fromFrame } : {}),
            ...(toFrame !== undefined ? { toFrame } : {}),
            totals,
            closureMismatches,
          }
          code = emitEnvelope(p, res, payload, used, [], outFile)
        } else {
          const causeSet = causeKinds ? new Set(causeKinds) : null
          const entries = fullLedger.filter(e => {
            if (slotFilter !== undefined && e.slot !== slotFilter) return false
            if (resourceFilter !== undefined && e.resource !== resourceFilter) return false
            if (causeSet && !causeSet.has(e.causeKind)) return false
            const at = clock === 'battle' ? e.battleFrame : e.f
            if (fromFrame !== undefined && at < fromFrame) return false
            if (toFrame !== undefined && at >= toFrame) return false
            return true
          })
          const payload = {
            clock,
            ...(fromFrame !== undefined ? { fromFrame } : {}),
            ...(toFrame !== undefined ? { toFrame } : {}),
            entries,
            closureMismatches,
          }
          code = emitEnvelope(p, res, payload, used, [], outFile)
        }
        break
      }

      case 'diff': {
        const targetKind = parsed.single.target ?? 'metrics'
        if (targetKind !== 'metrics' && targetKind !== 'commands' && targetKind !== 'events') {
          throw new CliArgError(`--target 应为 metrics|commands|events，收到：${targetKind}`)
        }
        const types = parsed.single.types
          ? parsed.single.types.split(',').map(s => s.trim()).filter(Boolean) as SimEventType[]
          : undefined
        if (types && targetKind !== 'events') throw new CliArgError('--types 只能配合 --target events 使用')
        const cmd = parsed.single.cmd !== undefined ? parseCmdRef(parsed.single.cmd, '--cmd') : undefined
        if (cmd && targetKind !== 'events') throw new CliArgError('--cmd 只能配合 --target events 使用')
        const mapping = parseMapping(parsed.mappings)
        if (mapping.length && targetKind === 'metrics') throw new CliArgError('--mapping 只对 --target commands|events 有用')
        if (parsed.single['cand-fill'] !== undefined && thirdPos === undefined) throw new CliArgError('--cand-fill 要配合另一个场景用')

        let candScenario: Scenario = scenario
        if (thirdPos !== undefined) {
          try {
            // 对比场景同样按填法组合选一个（DD-09 §3.1）：--cand-fill；只有一个组合时就是它
            candScenario = pickFillCombo(loadScenario(thirdPos), parsed.single['cand-fill'])
          } catch (e) {
            console.error(`读取对比场景失败（${thirdPos}）：${e instanceof Error ? e.message : String(e)}`)
            return 2
          }
        }
        const candRulesExtra = parsed.candRules.length > 0 ? parseKvList(parsed.candRules, '--cand-rule') : undefined
        const candOptsExtra = parseOptionsMap(parsed.candOptions, '--cand-option')
        const mergedRules = (baseOverrides.rules || candRulesExtra)
          ? { ...(thirdPos === undefined ? baseOverrides.rules : {}), ...candRulesExtra }
          : undefined
        const mergedOpts = (baseOverrides.options || candOptsExtra)
          ? { ...(thirdPos === undefined ? baseOverrides.options : {}), ...candOptsExtra }
          : undefined
        const candStrict = parsed.candStrict !== undefined
          ? parsed.candStrict
          : (thirdPos === undefined ? baseOverrides.strict : undefined)
        const candOverrides: RunOverrides = {
          ...(candStrict !== undefined ? { strict: candStrict } : {}),
          ...(parsed.continueAfterIntentUnmet ? { continueAfterIntentUnmet: true } : {}),
          ...(mergedRules ? { rules: mergedRules } : {}),
          ...(mergedOpts ? { options: mergedOpts } : {}),
          ...(baseOverrides.sample ? { sample: baseOverrides.sample } : {}),
          environment: env,
        }
        const prepB = prepareRun(candScenario, data, candOverrides)
        if (!prepB.ok) {
          console.error(`对比场景准备失败：\n${formatPrepareIssues(prepB.issues)}`)
          return 2
        }
        const pB = prepB.run
        // 只带比较要的诊断（diffRuns 缺了会自己重跑）：指令要事件来源与求值记录，事件要事件来源，指标什么都不要
        const diag = targetKind === 'commands' ? { eventMeta: true, commandVerdicts: true } : targetKind === 'events' ? { eventMeta: true } : undefined
        const resA = runPrepared(p, diag ? { diag } : {})
        const resB = runPrepared(pB, diag ? { diag } : {})
        const target: DiffTarget = targetKind === 'events'
          ? { kind: 'events', ...(types && types.length > 0 ? { types } : {}), ...(cmd ? { cmd } : {}) }
          : { kind: targetKind }
        const qr = diffRuns({ p, res: resA }, { p: pB, res: resB }, target, mapping.length ? { commandMapping: mapping } : {})
        if (!qr.ok) { console.error(formatQueryError(qr.error)); return 2 }
        const payload = {
          baseIdentity: p.identity,
          candIdentity: pB.identity,
          diff: qr.value,
        }
        const candFailed = resB.completion.status === 'engineError' ? 1 : 0
        code = emitEnvelope(p, resA, payload, [`diff.${targetKind}`], ['三项及以上的归因'], outFile, candFailed)
        break
      }

      default:
        throw new CliArgError(`未知子命令：${subcmd}`)
    }
  } catch (e) {
    if (e instanceof CliArgError) {
      console.error(e.message)
      return 2
    }
    throw e
  }

  const elapsed = performance.now() - t0
  if (elapsed > 2000) {
    console.error(`[query] 查询耗时 ${Math.round(elapsed)} ms（> 2000 ms）：命令行每次调用都从头跑（快照缓存 MemorySnapshotCache 只在同一进程里有用，DD-07 §3.5、DD-10 §3）`)
  }
  return code
}

main()
  .then(code => { process.exitCode = code })
  .catch(err => {
    console.error(err)
    process.exitCode = 2
  })
