// src/engine/zero-interference.ts —— 零干扰对拍（DD-05 §6；架构 §4.3）。④ 分析层：tests/zero-interference.test.ts 与 pnpm conformance 共用。
// 同一份 PreparedRun 诊断全关跑一次、全开跑一次，比三样：
//   ① 结果去掉 diag：日志、汇总、forte、cooldowns、completion（整份，没有豁免字段）、interventions、strictReport、ruleUsage、runId；
//     报错行为也在里面——completion.status 与 engineError，以及兼容外壳会不会抛（error.code 为 'uncaught' 时它把原异常抛出，消息相同）；
//   ② 终态 SimState 的全部字段（会影响后续执行的状态也要相同，结果暂时相同不够）；
//   ③ 事件队列的游标 busCursor。
// 逐字段深比较：同一个引用直接算相同，对象比键的集合（值为 undefined 的键也算），所以比 canonicalJson 后逐字节相等更严。
import { ALL_DIAG, type DiagSink } from './diagnostics'
import { statesAt } from './query'
import { runForInspection, type InspectOptions } from './run'
import type { PreparedRun } from './run-types'
import type { SimState } from './types'

type Inspection = ReturnType<typeof runForInspection>

const show = (x: unknown): string => {
  if (typeof x === 'string') return JSON.stringify(x)
  if (typeof x === 'object' && x !== null) return Array.isArray(x) ? `数组（${x.length} 项）` : '对象'
  return String(x)
}

/** a、b 第一个不同的地方：路径与两边的值；相同时 null。NaN 等于 NaN；Map 按插入顺序比条目，Set 按插入顺序比元素 */
export function firstDifference(a: unknown, b: unknown, path = '$', seen: WeakMap<object, object> = new WeakMap()): string | null {
  if (Object.is(a, b)) return null
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}：${show(a)} ≠ ${show(b)}`
  if (seen.get(a) === b) return null                         // 正在比（有环）或已经比过
  seen.set(a, b)
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}：${show(a)} ≠ ${show(b)}`
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    if (a.length !== bb.length) return `${path}.length：${a.length} ≠ ${bb.length}`
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], bb[i], `${path}[${i}]`, seen)
      if (d) return d
    }
    return null
  }
  if (a instanceof Map || b instanceof Map || a instanceof Set || b instanceof Set) {
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return `${path}：类型不同`
    return firstDifference([...(a as Iterable<unknown>)], [...(b as Iterable<unknown>)], path, seen)
  }
  const oa = a as Record<string, unknown>, ob = b as Record<string, unknown>
  for (const k of Object.keys(oa)) if (!Object.hasOwn(ob, k)) return `${path}.${k}：只有一边有`
  for (const k of Object.keys(ob)) if (!Object.hasOwn(oa, k)) return `${path}.${k}：只有一边有`
  for (const k of Object.keys(oa)) {
    const d = firstDifference(oa[k], ob[k], `${path}.${k}`, seen)
    if (d) return d
  }
  return null
}

/** 两次检查之间的差别（DD-05 §6.2 的前三行）：result 去掉 diag、terminal、busCursor；相同时 null */
export function compareInspections(off: Inspection, on: Inspection): string | null {
  if (off.stoppedAt !== null || on.stoppedAt !== null) return `stoppedAt：${off.stoppedAt} ≠ ${on.stoppedAt}（零干扰对拍不该停在中途）`
  const strip = (x: Inspection) => {
    if (!x.result) return null
    const { diag: _diag, ...rest } = x.result
    return rest
  }
  return firstDifference(strip(off), strip(on), 'result')
    ?? firstDifference(off.terminal, on.terminal, 'terminal')
    ?? (off.busCursor === on.busCursor ? null : `busCursor：${off.busCursor} ≠ ${on.busCursor}`)
}

export interface ZeroInterferenceOptions {
  /** 诊断全关的那一侧已经跑过了（pnpm conformance 写样例用的那次），就不再跑 */
  readonly off?: Inspection
  /** 两侧都带的观察选项（onHit 等），不含 diag */
  readonly base?: Omit<InspectOptions, 'diag' | 'sink' | 'observer'>
  /** 测试用：开着的那一侧换一个收集器（反向用例：故意违规的子类） */
  readonly sink?: (s: Readonly<SimState>) => DiagSink
}

/** 诊断全关与全开各跑一次并比较；返回第一个不同的路径，相同时 null（DD-05 §6.2、§6.3） */
export function zeroInterference(p: PreparedRun, opts: ZeroInterferenceOptions = {}): string | null {
  const off = opts.off ?? runForInspection(p, { ...opts.base })
  const on = runForInspection(p, { ...opts.base, diag: ALL_DIAG, ...(opts.sink ? { sink: opts.sink } : {}) })
  return compareInspections(off, on)
}

/** 抽样边界上的 stateAt 零干扰对拍（DD-07 T07-3；架构 §4.3）：诊断全关与全开在各采样帧上的 StateView 与 StatePrefix 逐字段相等 */
export function zeroInterferenceStates(p: PreparedRun, frames?: readonly number[]): string | null {
  const term = runForInspection(p)
  const completed = term.result?.completion.coverage.completedTicks ?? 0
  const initOk = term.result?.completion.coverage.initCompleted ?? false
  if (!initOk) return null
  const targets = frames ?? [...new Set([0, Math.floor(completed / 2), completed])]
  const off = statesAt(p, targets)
  const on = statesAt(p, targets, { diag: ALL_DIAG })
  if (!off.ok) return `statesAt 失败：${JSON.stringify(off.error)}`
  if (!on.ok) return `statesAt 失败：${JSON.stringify(on.error)}`
  const stripLedger = off.value.map((x, i) => ({
    a: { frame: x.frame, view: x.view, prefix: x.prefix },
    b: { frame: on.value[i]!.frame, view: on.value[i]!.view, prefix: on.value[i]!.prefix },
  }))
  for (const { a, b } of stripLedger) {
    const diff = firstDifference(a, b, `stateAt[${a.frame}]`)
    if (diff) return diff
  }
  return null
}
