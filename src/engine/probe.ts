// src/engine/probe.ts —— 试算会话的只读上下文与纯检查函数（DD-07 §4.2–§4.3；架构 §7.1；DF-08、DF-11、DF-13）。①D 查询与诊断。
// 三个纯检查函数（explainAct / explainSwitch / explainFiring）不写任何状态、不调 assume、不调 opts.inputDelay、不碰 RNG、不抛调度错误；
// 角色只读钩子（canStart / introAction）拿到深冻结的状态投影（无 log）与禁止写入的上下文。
import type { ActionId, ActionKind, CharName, DamageTag, Element, Frame, ResourceKind, Slot } from '../data/common'
import type { BuffDef, EnemyStateChange, TriggerSpec } from '../data/buff.schema'
import type { ActionDef } from '../data/gamedata'
import type { Command } from '../data/scenario.schema'
import { canTuneBreakWith } from './enemy'
import { airborne, cooldownKey, gate, settled, type Kernel } from './kernel'
import { roundTo } from './num'
import { canAfford } from './resources'
import { introOf } from './switch'
import type {
  CharacterHooks, DeepReadonly, EntryBlock, HookVars, ReadonlyHookContext, ResolvedScenario, SimState, StaticStats,
} from './types'

export type ConditionStatus = 'met' | 'unmet' | 'shortCircuited' | 'notApplicable' | 'unmodeled'

export interface ConditionCheck {
  readonly id: string
  readonly status: ConditionStatus
  readonly expected?: string
  readonly actual?: string
  /** 真实执行里这一项被前面的条件短路了，这里是额外试算出来的 */
  readonly speculative?: boolean
}

export interface TriggerTarget {
  readonly kind: 'buff' | 'buffExtend' | 'resourceEffect' | 'consume' | 'charHook'
  readonly owner: Slot | 'env'
  readonly id: string
}

export type TriggerOutcome = 'fired' | 'checkedNotFired' | 'notEntered' | 'handlerNotRun' | 'unsupported'

export interface TriggerCheckGroup {
  readonly occurrence: string
  readonly spec: number
  readonly conditions: readonly ConditionCheck[]
}

/** 一条日志事件对应的触发点（TD-07 §4.1）：switch 一条对应 switchOut、switchIn 两个 */
export interface Occurrence {
  readonly on: TriggerSpec['on']
  readonly by: Slot
  readonly action?: ActionId
  readonly kind?: ActionKind
  readonly judgment?: string
  readonly tags?: readonly DamageTag[]
  readonly element?: Element
  readonly resource?: ResourceKind
  readonly to?: Slot
  readonly enemyState?: EnemyStateChange
  readonly effect?: import('../data/common').EffectName
}

/** 违规在只读钩子上下文里调用写入方法时抛出（DD-07 §4.3、C07-8） */
export class UnsupportedWrite extends Error {
  readonly method: string
  constructor(method: string) {
    super(`只读钩子上下文禁止调用写入方法 ${method}`)
    this.name = 'UnsupportedWrite'
    this.method = method
  }
}

export interface ProbeEnv {
  readonly team: ResolvedScenario['team']
  readonly rules: ResolvedScenario['rules']
  readonly options: ResolvedScenario['options']
  readonly tuneBreakTiming: ResolvedScenario['tuneBreakTiming']
  readonly hooks: readonly (CharacterHooks | undefined)[]
  readonly isSampledRandomDelay?: boolean
}

export function probeEnvOf(r: ResolvedScenario, sample?: { jitter?: number; hand?: unknown } | null): ProbeEnv {
  return {
    team: r.team,
    rules: r.rules,
    options: r.options,
    tuneBreakTiming: r.tuneBreakTiming,
    hooks: r.team.map(m => r.data.hooks[m.def.name]),
    isSampledRandomDelay: Boolean(sample && ((sample.jitter ?? 0) > 0 || sample.hand !== undefined)),
  }
}

/** 深拷贝并递归冻结运行期状态投影（DD-07 §4.3，DF-13）：
 *  - 省略 log（ReadonlyHookContext 的类型如实表达不含日志）；
 *  - 定义对象（ActionRuntime/TailRuntime.def、JudgmentRuntime.def、EnemyRuntime.preset、queue.commands/opening）按引用保留，不拷贝也不冻结；
 *  - 其余运行期对象与数组（含 chars[*].vars、buffs 等）保持共享引用关系并逐层 Object.freeze */
const KEEP_BY_REF = new Set(['def', 'preset', 'commands', 'opening'])

export function freezeStateProjection(s: Readonly<SimState>): DeepReadonly<Omit<SimState, 'log'>> {
  const seen = new Map<object, unknown>()
  const clone = (val: unknown, key?: string): unknown => {
    if (key !== undefined && KEEP_BY_REF.has(key)) return val
    if (typeof val !== 'object' || val === null) return val
    if (seen.has(val)) return seen.get(val)
    if (Array.isArray(val)) {
      const arr: unknown[] = []
      seen.set(val, arr)
      for (let i = 0; i < val.length; i++) arr.push(clone(val[i]))
      return Object.freeze(arr)
    }
    const src = val as Record<string, unknown>
    const out: Record<string, unknown> = {}
    seen.set(val, out)
    for (const k of Object.keys(src)) out[k] = clone(src[k], k)
    return Object.freeze(out)
  }
  const top: Record<string, unknown> = {}
  for (const k of Object.keys(s) as (keyof SimState)[]) {
    if (k === 'log') continue
    top[k] = clone(s[k], k)
  }
  return Object.freeze(top) as DeepReadonly<Omit<SimState, 'log'>>
}

/** 构造只读钩子上下文（DD-07 §4.3）：state 与 vars 是深冻结投影；stat() 直接读静态面板不调 assume；
 *  运行期若绕过类型调用写入方法（addBuff 等）一律抛 UnsupportedWrite */
export function readonlyContext<V extends HookVars = HookVars>(
  env: Pick<ProbeEnv, 'team' | 'rules'>,
  stateOrProjection: Readonly<SimState> | DeepReadonly<Omit<SimState, 'log'>>,
  self: Slot,
  alreadyFrozen = false,
): ReadonlyHookContext<V> {
  const m = env.team[self]!
  const state = alreadyFrozen
    ? (stateOrProjection as DeepReadonly<Omit<SimState, 'log'>>)
    : freezeStateProjection(stateOrProjection as Readonly<SimState>)
  const reject = (method: string) => () => { throw new UnsupportedWrite(method) }
  const ctx = {
    self,
    chain: m.chain,
    rules: env.rules,
    state,
    buffStacks: (id: string, target: Slot | 'enemy' = self) =>
      state.buffs.find(b => b.defId === id && b.owner === self && b.target === target)?.stacks ?? 0,
    get vars() { return state.chars[self]!.vars as DeepReadonly<V> },
    stat: (name: keyof StaticStats) => m.stats[name],
    // 防御绕过 TS 强转调用的写入方法：统一抛 UnsupportedWrite（C07-8）
    addBuff: reject('addBuff'),
    removeBuff: reject('removeBuff'),
    addResource: reject('addResource'),
    spawnJudgment: reject('spawnJudgment'),
    skipJudgments: reject('skipJudgments'),
    applyEffect: reject('applyEffect'),
    applyShift: reject('applyShift'),
    effectDamage: reject('effectDamage'),
    takeBurst: reject('takeBurst'),
    heal: reject('heal'),
    shield: reject('shield'),
    warn: reject('warn'),
    assume: reject('assume'),
    noteRule: reject('noteRule'),
  }
  return Object.freeze(ctx) as ReadonlyHookContext<V>
}

// ---------------------------------------------------------------------------
// 辅助

const ENTRY_WHY: Record<EntryBlock, string> = {
  intro: '这次是变奏入场',
  acted: '入场后已经出过招',
  busy: '切回来时自己在后台的动作还没走完',
  air: '切出的角色在空中，切进来也在空中',
}

function entryWhyText(s: Readonly<SimState>, slot: Slot): string {
  const e = s.entry
  if (e?.slot !== slot) return '开场就在前台，不是切人入场'
  return ENTRY_WHY[e.block!]
}

export function firstBlockingOf(checks: readonly ConditionCheck[]): string | null {
  return checks.find(c => c.status === 'unmet' || c.status === 'unmodeled')?.id ?? null
}

function withSpeculative(raw: readonly ConditionCheck[]): ConditionCheck[] {
  const firstIdx = raw.findIndex(c => c.status === 'unmet' || c.status === 'unmodeled')
  if (firstIdx < 0) return [...raw]
  return raw.map((c, i) => (i > firstIdx ? { ...c, speculative: true } : c))
}

function formatErr(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

/** 确定性计算当前队首（或指定指令）的操作延迟：仅当非随机或未走抽样随机抖动时有效 */
export function deterministicDelayOf(env: Pick<ProbeEnv, 'options'>, s: Readonly<SimState>, ref?: { line: number; item: number; loop: number }): number {
  const at = env.options.inputDelayAt
  if (!at) return env.options.inputDelay
  const loop = ref?.loop ?? s.queue.loop
  const c = loop > 0 ? (ref ?? s.queue.commands[s.queue.next]) : undefined
  return env.options.inputDelay + (c ? at[`${c.line}.${c.item}`] ?? 0 : 0)
}

// ---------------------------------------------------------------------------
// explainAct（DD-07 §4.2）

export interface ActContext {
  readonly force: boolean
  readonly delay: number
  readonly input: boolean
  readonly optional?: boolean
  readonly readyAt?: number | null
  readonly extra?: number | null
  readonly actions?: Record<ActionId, ActionDef>
  readonly deterministicInputDelay?: number
  readonly ro?: ReadonlyHookContext
}

/** 纯检查：出招指令或动作的 14 项条件，按调度真实检查顺序排列，不写任何状态（DD-07 §4.2） */
export function explainAct(s: SimState, k: Kernel, env: ProbeEnv, slot: Slot, def: ActionDef, ctx: ActContext): ConditionCheck[] {
  const ch = s.chars[slot]
  const raw: ConditionCheck[] = []
  const actions = ctx.actions ?? env.team[slot]!.actions

  // 1. onField
  const onFieldOk = slot === s.onField
  raw.push({
    id: 'onField',
    status: onFieldOk ? 'met' : 'unmet',
    expected: `${ch.name} 在前台`,
    actual: onFieldOk ? `${ch.name} 在前台` : `${ch.name} 不在前台（当前前台 ${s.chars[s.onField].name}）`,
  })

  // 2. entry.skillRequired（写了 A1 而普通切人入场后应该写出场技）
  const entrySkillDef = def.id === 'A1' ? Object.values(actions).find(a => a.entrySkill) : undefined
  if (def.id !== 'A1' || !entrySkillDef) {
    raw.push({ id: 'entry.skillRequired', status: 'notApplicable', expected: '普通切人首下写 A1 且角色有出场技时检查', actual: def.id })
  } else {
    const reqOk = !(s.entry?.slot === slot && s.entry.block === null)
    raw.push({
      id: 'entry.skillRequired',
      status: reqOk ? 'met' : 'unmet',
      expected: `普通切人入场后第一下写 ${entrySkillDef.id}`,
      actual: reqOk ? '非普通切人首下' : '普通切人入场后第一下写了 A1',
    })
  }

  // 3. entry.skillAllowed（出场技要普通切人入场后第一个出）
  if (!def.entrySkill) {
    raw.push({ id: 'entry.skillAllowed', status: 'notApplicable', expected: '仅出场技检查', actual: def.id })
  } else {
    const allowOk = s.entry?.slot === slot && s.entry.block === null
    raw.push({
      id: 'entry.skillAllowed',
      status: allowOk ? 'met' : 'unmet',
      expected: '地面普通切人入场后第一个出',
      actual: allowOk ? '满足出场技入场条件' : entryWhyText(s, slot),
    })
  }

  // 4-7. gate.combo / gate.inputLock / gate.priority / gate.derive（第一版不拆 gateRules）
  const g = gate(ch, def, k.rules.echoInputPriority)
  const gateOrder = ['gate.combo', 'gate.inputLock', 'gate.priority', 'gate.derive'] as const
  const failGateId = g.ok || g.code === 'started'
    ? null
    : g.code === 'combo' || g.code === 'comboBroken'
      ? 'gate.combo'
      : g.code === 'inputLock'
        ? 'gate.inputLock'
        : g.code === 'priority'
          ? 'gate.priority'
          : 'gate.derive'
  const failIdx = failGateId ? gateOrder.indexOf(failGateId) : 99

  if (failIdx === 0) {
    raw.push({ id: 'gate.combo', status: 'unmet', expected: `接在 ${def.comboFrom?.join(' / ') ?? ''} 的派生窗口内`, actual: !g.ok ? g.reason : '' })
  } else if (!def.comboFrom?.length) {
    raw.push({ id: 'gate.combo', status: 'notApplicable', expected: '无连段前置', actual: '不适用' })
  } else {
    raw.push({ id: 'gate.combo', status: 'met', expected: `接在 ${def.comboFrom.join(' / ')} 的派生窗口内`, actual: `已在 ${ch.combo?.id ?? ''} 派生窗口内` })
  }

  if (1 > failIdx) {
    raw.push({ id: 'gate.inputLock', status: 'shortCircuited', expected: '当前动作未锁定此类输入', actual: '被连段检查短路' })
  } else if (!ch.action) {
    raw.push({ id: 'gate.inputLock', status: 'notApplicable', expected: '角色当前空闲', actual: '无进行中动作' })
  } else if (failIdx === 1) {
    raw.push({ id: 'gate.inputLock', status: 'unmet', expected: '当前动作未锁定此类输入', actual: !g.ok ? g.reason : '' })
  } else {
    raw.push({ id: 'gate.inputLock', status: 'met', expected: '当前动作未锁定此类输入', actual: '未受输入锁限制' })
  }

  if (2 > failIdx) {
    raw.push({ id: 'gate.priority', status: 'shortCircuited', expected: '优先级足够打断当前动作', actual: '被前置门控短路' })
  } else if (!ch.action) {
    raw.push({ id: 'gate.priority', status: 'notApplicable', expected: '角色当前空闲', actual: '无进行中动作' })
  } else if (failIdx === 2) {
    raw.push({ id: 'gate.priority', status: 'unmet', expected: `优先级高于或可派生 ${ch.action.id}`, actual: !g.ok ? g.reason : '' })
  } else {
    raw.push({ id: 'gate.priority', status: 'met', expected: `优先级高于或可派生 ${ch.action.id}`, actual: g.ok ? `放行（${g.via}）` : '通过' })
  }

  if (3 > failIdx) {
    raw.push({ id: 'gate.derive', status: 'shortCircuited', expected: '在当前动作的派生窗口内', actual: '被前置门控短路' })
  } else if (!ch.action) {
    raw.push({ id: 'gate.derive', status: 'notApplicable', expected: '角色当前空闲', actual: '无进行中动作' })
  } else if (failIdx === 3) {
    raw.push({ id: 'gate.derive', status: 'unmet', expected: `在 ${ch.action.id} 的派生窗口内`, actual: !g.ok ? g.reason : '' })
  } else {
    raw.push({ id: 'gate.derive', status: 'met', expected: `在 ${ch.action.id} 的派生窗口内`, actual: '满足优先级或派生窗口' })
  }

  // 8. cooldown
  const cdKey = cooldownKey(def)
  const cd = ch.cooldowns[cdKey] ?? 0
  if (def.charges !== undefined && def.charges > 1) {
    const spent = ch.charges[cdKey]?.spent ?? 0
    const cdOk = spent < def.charges
    raw.push({
      id: 'cooldown',
      status: cdOk ? 'met' : 'unmet',
      expected: `${def.id} 充能次数 > 0`,
      actual: cdOk ? `剩余 ${def.charges - spent} / ${def.charges} 次` : `还剩 ${Math.ceil(cd)} 帧`,
    })
  } else {
    const cdOk = cd <= 0
    raw.push({
      id: 'cooldown',
      status: cdOk ? 'met' : 'unmet',
      expected: `${def.id} 冷却 = 0`,
      actual: cdOk ? '冷却 = 0' : `还剩 ${Math.ceil(cd)} 帧`,
    })
  }

  // 9. resource
  const res = canAfford(s, slot, def)
  raw.push({
    id: 'resource',
    status: res === true ? 'met' : 'unmet',
    expected: (def.energyCost ?? 0) > 0 ? `大招能量 ≥ ${def.energyCost}` : '无大招能量门槛',
    actual: res === true ? `大招能量 ${Math.floor(ch.energy * 10) / 10}` : res,
  })

  // 10. hook.canStart（含谐度破坏的 canTuneBreak）
  let hookCheck: ConditionCheck
  if (def.kind === 'tuneBreak') {
    const tb = canTuneBreakWith(env.options.tuneBreak, env.tuneBreakTiming.buttonFrames, s)
    if (tb !== true) {
      hookCheck = { id: 'hook.canStart', status: 'unmet', expected: '谐度破坏条件与角色条件满足', actual: tb }
      raw.push(hookCheck)
    } else {
      hookCheck = evalCanStartHook(env, s, slot, def.id, ctx.ro)
      raw.push(hookCheck)
    }
  } else {
    hookCheck = evalCanStartHook(env, s, slot, def.id, ctx.ro)
    raw.push(hookCheck)
  }

  // 11. settled
  if (ctx.force) {
    raw.push({ id: 'settled', status: 'notApplicable', expected: '无需等出手（写了 !）', actual: '强制取消' })
  } else {
    const setOk = settled(s, slot)
    raw.push({
      id: 'settled',
      status: setOk ? 'met' : 'unmet',
      expected: '当前动作已出手或空闲',
      actual: setOk ? '已就绪' : `等 ${ch.action?.id ?? ''} 出手`,
    })
  }

  // 12. gate.started
  raw.push({
    id: 'gate.started',
    status: !ch.startedThisTick ? 'met' : 'unmet',
    expected: '本 tick 尚未开始动作',
    actual: !ch.startedThisTick ? '本 tick 尚未开始动作' : '同一角色一个 tick 只能开始一个动作',
  })

  // 13. delay（+N）
  const readyAt = ctx.readyAt !== undefined ? ctx.readyAt : s.queue.readyAt
  if (ctx.delay <= 0) {
    raw.push({ id: 'delay', status: 'notApplicable', expected: '无 +N 延迟', actual: '不适用' })
  } else if (readyAt === null) {
    raw.push({ id: 'delay', status: 'unmet', expected: `等待 +${ctx.delay} 帧`, actual: `尚未开始计时（需等 ${ctx.delay} 帧）` })
  } else {
    const delayOk = s.battleFrames >= readyAt + ctx.delay
    raw.push({
      id: 'delay',
      status: delayOk ? 'met' : 'unmet',
      expected: `等待 +${ctx.delay} 帧`,
      actual: delayOk ? `已等满 ${ctx.delay} 帧` : `还剩 ${roundTo(readyAt + ctx.delay - s.battleFrames, 100)} 帧`,
    })
  }

  // 14. inputDelay（读取本次求值写下的 q.extra，不重新调用 opts.inputDelay 也不碰 RNG）
  raw.push(checkInputDelay(s, env, ctx.input, ctx.delay, readyAt, ctx.extra, ctx.deterministicInputDelay))

  return withSpeculative(raw)
}

function evalCanStartHook(env: ProbeEnv, s: Readonly<SimState>, slot: Slot, actionId: ActionId, prebuiltRo?: ReadonlyHookContext): ConditionCheck {
  const hook = env.hooks[slot]?.canStart
  if (!hook) return { id: 'hook.canStart', status: 'met', expected: '角色钩子 canStart 允许', actual: '无额外限制' }
  const ro = prebuiltRo ?? readonlyContext(env, s, slot)
  try {
    const res = hook(ro, actionId)
    if (res === true || res === undefined) return { id: 'hook.canStart', status: 'met', expected: '角色钩子 canStart 允许', actual: '允许' }
    return { id: 'hook.canStart', status: 'unmet', expected: '角色钩子 canStart 允许', actual: res }
  } catch (e) {
    if (e instanceof UnsupportedWrite) {
      return {
        id: 'hook.canStart',
        status: 'unmodeled',
        expected: '角色钩子 canStart 允许',
        actual: `钩子在检查里尝试写状态，不支持只读求值（${e.method}）`,
      }
    }
    return {
      id: 'hook.canStart',
      status: 'unmodeled',
      expected: '角色钩子 canStart 允许',
      actual: `只读求值失败（${formatErr(e)}）`,
    }
  }
}

function checkInputDelay(
  s: Readonly<SimState>,
  env: ProbeEnv,
  input: boolean,
  delay: number,
  readyAtOpt: number | null | undefined,
  extraOpt: number | null | undefined,
  detFallback?: number,
): ConditionCheck {
  if (!input) return { id: 'inputDelay', status: 'notApplicable', expected: '无操作延迟（非决策点）', actual: '不适用' }
  const extraVal = extraOpt !== undefined ? extraOpt : s.queue.extra
  if (extraVal === null || extraVal === undefined) {
    if (env.isSampledRandomDelay) {
      return { id: 'inputDelay', status: 'unmodeled', expected: '操作延迟', actual: '抽样模式下操作延迟尚未抽样（前置条件未满足）' }
    }
    const det = detFallback ?? env.options.inputDelay
    if (det <= 0) return { id: 'inputDelay', status: 'notApplicable', expected: '操作延迟 = 0', actual: '0 帧' }
    const baseReady = (readyAtOpt !== undefined ? readyAtOpt : s.queue.readyAt) ?? s.battleFrames
    const ok = s.battleFrames >= baseReady + delay + det
    return {
      id: 'inputDelay',
      status: ok ? 'met' : 'unmet',
      expected: `操作延迟 +${det} 帧`,
      actual: ok ? `已等满 ${det} 帧` : `还剩 ${roundTo(baseReady + delay + det - s.battleFrames, 100)} 帧`,
    }
  }
  if (extraVal <= 0) return { id: 'inputDelay', status: 'notApplicable', expected: '操作延迟 = 0', actual: '0 帧' }
  const baseReady = (readyAtOpt !== undefined ? readyAtOpt : s.queue.readyAt) ?? s.battleFrames
  const ok = s.battleFrames >= baseReady + delay + extraVal
  return {
    id: 'inputDelay',
    status: ok ? 'met' : 'unmet',
    expected: `操作延迟 +${extraVal} 帧`,
    actual: ok ? `已等满 ${extraVal} 帧` : `还剩 ${roundTo(baseReady + delay + extraVal - s.battleFrames, 100)} 帧`,
  }
}

// ---------------------------------------------------------------------------
// explainSwitch（DD-07 §4.2）

export interface SwitchContext {
  readonly expectIntro?: boolean
  readonly nextAction: ActionDef | null
  readonly readyAt?: number | null
  readonly extra?: number | null
  readonly deterministicInputDelay?: number
  readonly roTo?: ReadonlyHookContext
}

/** 纯检查：切人指令的 9 项条件（8 项调度检查 + execute 的 introReady，DD-07 §4.2、DF-08） */
export function explainSwitch(
  s: SimState,
  k: Kernel,
  env: ProbeEnv,
  c: Extract<Command, { kind: 'switch' }>,
  ctx: SwitchContext,
): ConditionCheck[] {
  const from = s.onField
  const to = c.to
  const fromChar = s.chars[from]
  const toChar = s.chars[to]
  const expectIntro = ctx.expectIntro ?? c.expectIntro ?? false
  const raw: ConditionCheck[] = []

  // 1. switchSelf
  raw.push({
    id: 'switchSelf',
    status: to !== from ? 'met' : 'unmet',
    expected: `切到非当前前台角色（当前 ${fromChar.name}）`,
    actual: to !== from ? `目标 ${toChar.name}` : `${toChar.name} 已经在前台`,
  })

  // 2. switchCd
  const back = toChar.switchCd
  raw.push({
    id: 'switchCd',
    status: back <= 0 ? 'met' : 'unmet',
    expected: `${toChar.name} 切人冷却 = 0`,
    actual: back <= 0 ? '冷却 = 0' : `还剩 ${Math.ceil(back)} 帧`,
  })

  // 3. globalStop
  const last = fromChar.last
  const stop = last?.def.globalStopUntil
  const written = last?.def.switchLockUntil !== undefined && !last.def.switchLockFromInput && !last.def.switchLockFromInvincible
  const early = k.rules.switchEndsStop && written && stop !== undefined && last!.def.switchLockUntil! < stop && last!.localFrame >= last!.def.switchLockUntil!
  if (!last || stop === undefined) {
    raw.push({ id: 'globalStop', status: 'notApplicable', expected: '不在全局时停中', actual: '无全局时停' })
  } else {
    const stopOk = last.localFrame >= stop || early
    raw.push({
      id: 'globalStop',
      status: stopOk ? 'met' : 'unmet',
      expected: early ? `过了切人锁（第 ${last.def.switchLockUntil} 帧）可提前切出` : `全局时停到第 ${stop} 帧结束`,
      actual: stopOk ? (early ? '已过写明切人锁，switchEndsStop 放行' : '全局时停已结束') : `${last.id} 全局时停到第 ${stop} 帧（当前 ${roundTo(last.localFrame, 100)}）`,
    })
  }

  // 4. concertoSettle
  if (!expectIntro) {
    raw.push({ id: 'concertoSettle', status: 'notApplicable', expected: '普通切人无需等变奏出手', actual: '未写变奏' })
  } else {
    const csOk = fromChar.concerto >= k.rules.concertoMax || settled(s, from)
    raw.push({
      id: 'concertoSettle',
      status: csOk ? 'met' : 'unmet',
      expected: `协奏满 ${k.rules.concertoMax} 或当前动作已出手`,
      actual: csOk
        ? (fromChar.concerto >= k.rules.concertoMax ? `协奏已满（${roundTo(fromChar.concerto, 100)}）` : '当前动作已出手')
        : `等 ${fromChar.action?.id ?? ''} 出手（当前协奏 ${roundTo(fromChar.concerto, 100)}）`,
    })
  }

  // 5. switchLock
  const lock = last?.def.switchLockUntil
  const off = last && ((last.def.switchLockFromInput && !k.rules.ultInputLocksSwitch) || (last.def.switchLockFromInvincible && !k.rules.invincibleLocksSwitch))
  if (!last || lock === undefined) {
    raw.push({ id: 'switchLock', status: 'notApplicable', expected: '无切人锁', actual: '未设切人锁' })
  } else {
    const lockOk = last.localFrame >= lock || !!off
    raw.push({
      id: 'switchLock',
      status: lockOk ? 'met' : 'unmet',
      expected: off ? '该推断锁已关闭' : `过第 ${lock} 帧切人锁`,
      actual: lockOk
        ? (off ? '规则关闭此切人锁' : `已过第 ${lock} 帧（当前 ${roundTo(last.localFrame, 100)}）`)
        : `${last.id} 第 ${lock} 帧前不能切人（当前 ${roundTo(last.localFrame, 100)}）`,
    })
  }

  // 6. airEntry
  const first = ctx.nextAction
  if (!(first?.air?.from === 0 && (first.kind === 'normal' || first.kind === 'heavy'))) {
    raw.push({ id: 'airEntry', status: 'notApplicable', expected: '切入后第一下非起始空中攻击', actual: first?.id ?? '无' })
  } else {
    const airOk = airborne(s, from)
    const cur = fromChar.action
    const up = cur && !cur.ended ? cur.def.air : undefined
    raw.push({
      id: 'airEntry',
      status: airOk ? 'met' : 'unmet',
      expected: `切出者 ${fromChar.name} 在空中`,
      actual: airOk
        ? `${fromChar.name} 在空中`
        : up && cur!.localFrame < up.from
          ? `等 ${cur!.id} 跳起（第 ${up.from} 帧）`
          : `${fromChar.name} 在地面`,
    })
  }

  // 7. entryBusy
  const busy = toChar.action
  if (!first?.entrySkill) {
    raw.push({ id: 'entryBusy', status: 'notApplicable', expected: '切入后第一下非地面出场技', actual: first?.id ?? '无' })
  } else {
    const busyOk = !busy || busy.ended
    raw.push({
      id: 'entryBusy',
      status: busyOk ? 'met' : 'unmet',
      expected: `${toChar.name} 后台动作已结束`,
      actual: busyOk ? '后台空闲' : `等 ${toChar.name} 在后台的 ${busy.id} 走完`,
    })
  }

  // 8. inputDelay
  const readyAt = ctx.readyAt !== undefined ? ctx.readyAt : s.queue.readyAt
  raw.push(checkInputDelay(s, env, true, 0, readyAt, ctx.extra, ctx.deterministicInputDelay))

  // 9. introReady（DF-08：只在 execute 里检查；写了变奏时检查协奏满且有变奏动作）
  if (!expectIntro) {
    raw.push({ id: 'introReady', status: 'notApplicable', expected: '普通切人无需变奏', actual: '未写变奏' })
  } else {
    raw.push(evalIntroReady(env, s, from, to, ctx.roTo))
  }

  return withSpeculative(raw)
}

function evalIntroReady(env: ProbeEnv, s: Readonly<SimState>, from: Slot, to: Slot, prebuiltRo?: ReadonlyHookContext): ConditionCheck {
  const fromChar = s.chars[from]
  const toMember = env.team[to]!
  const hook = env.hooks[to]?.introAction
  let introDef: ActionDef | undefined
  if (hook) {
    const ro = prebuiltRo ?? readonlyContext(env, s, to)
    try {
      const pick = hook(ro)
      if (pick !== undefined) {
        introDef = toMember.actions[pick]
        if (!introDef) {
          return {
            id: 'introReady',
            status: 'unmodeled',
            expected: `切出者协奏 ≥ ${env.rules.concertoMax} 且有变奏动作`,
            actual: `只读求值失败（introAction 返回了不存在的动作 "${pick}"）`,
          }
        }
      } else {
        introDef = introOf(toMember)
      }
    } catch (e) {
      if (e instanceof UnsupportedWrite) {
        return {
          id: 'introReady',
          status: 'unmodeled',
          expected: `切出者协奏 ≥ ${env.rules.concertoMax} 且有变奏动作`,
          actual: `钩子在检查里尝试写状态，不支持只读求值（${e.method}）`,
        }
      }
      return {
        id: 'introReady',
        status: 'unmodeled',
        expected: `切出者协奏 ≥ ${env.rules.concertoMax} 且有变奏动作`,
        actual: `只读求值失败（${formatErr(e)}）`,
      }
    }
  } else {
    introDef = introOf(toMember)
  }
  const concertoOk = fromChar.concerto >= env.rules.concertoMax
  const hasIntro = introDef !== undefined
  const ok = concertoOk && hasIntro
  return {
    id: 'introReady',
    status: ok ? 'met' : 'unmet',
    expected: `切出者 ${fromChar.name} 协奏 ≥ ${env.rules.concertoMax}，且 ${toMember.def.name} 有变奏动作`,
    actual: ok
      ? `协奏 ${roundTo(fromChar.concerto, 100)}，变奏动作 ${introDef!.id}`
      : !concertoOk
        ? `${fromChar.name} 协奏 ${roundTo(fromChar.concerto, 100)}（不足 ${env.rules.concertoMax}）`
        : `${toMember.def.name} 没有变奏动作`,
  }
}

// ---------------------------------------------------------------------------
// explainFiring（DD-07 §4.2、§6）

const labelOfOcc = (o: Occurrence): string => o.on

const charLabel = (s: Readonly<SimState>, slot: Slot | 'env'): string =>
  slot === 'env' ? 'env' : s.chars[slot].name

/** 纯检查：按触发点与规格分组列出全部条件（不写 lastTrigger）；
 *  where.* 只列写了的字段；真实 matches / firing 短路之后的条件标 speculative: true */
export function explainFiring(
  s: Readonly<SimState>,
  trigger: BuffDef['trigger'],
  owner: Slot | 'env',
  id: string,
  icd: number | undefined,
  occs: readonly Occurrence[],
): TriggerCheckGroup[] {
  if (typeof trigger === 'string') {
    return [{
      occurrence: occs[0]?.on ?? 'none',
      spec: 0,
      conditions: [{
        id: 'on',
        status: 'unmet',
        expected: '声明式事件触发规格',
        actual: `触发类型是 '${trigger}'（非事件触发）`,
      }],
    }]
  }
  const specs = Array.isArray(trigger) ? trigger : [trigger]
  if (occs.length === 0) {
    return specs.map((_sp, spec) => ({
      occurrence: 'none',
      spec,
      conditions: [{
        id: 'occurrence',
        status: 'unmet',
        expected: '事件产生触发点',
        actual: '该事件没有触发点（如异常效应自身伤害或无产生者）',
      }],
    }))
  }

  const groups: TriggerCheckGroup[] = []
  for (const o of occs) {
    specs.forEach((sp, spec) => {
      const raw: ConditionCheck[] = []
      raw.push({
        id: 'occurrence',
        status: 'met',
        expected: '事件产生触发点',
        actual: labelOfOcc(o),
      })
      raw.push({
        id: 'on',
        status: sp.on === o.on ? 'met' : 'unmet',
        expected: sp.on,
        actual: o.on,
      })
      const w = sp.where
      const byRule = w?.by ?? 'self'
      const byOk = byRule === 'self'
        ? (owner === 'env' || o.by === owner)
        : byRule === 'onField'
          ? o.by === s.onField
          : true
      raw.push({
        id: 'by',
        status: byOk ? 'met' : 'unmet',
        expected: byRule === 'self' ? (owner === 'env' ? '任意（env）' : charLabel(s, owner)) : byRule === 'onField' ? `前台（${charLabel(s, s.onField)}）` : '全队任意角色',
        actual: charLabel(s, o.by),
      })

      if (w) {
        if (w.actionKinds !== undefined) {
          const ok = o.kind !== undefined && w.actionKinds.includes(o.kind)
          raw.push({ id: 'where.actionKinds', status: ok ? 'met' : 'unmet', expected: w.actionKinds.join(' / '), actual: o.kind ?? '无' })
        }
        if (w.actions !== undefined) {
          const ok = o.action !== undefined && w.actions.includes(o.action)
          raw.push({ id: 'where.actions', status: ok ? 'met' : 'unmet', expected: w.actions.join(' / '), actual: o.action ?? '无' })
        }
        if (w.judgments !== undefined) {
          const ok = o.judgment !== undefined && w.judgments.includes(o.judgment)
          raw.push({ id: 'where.judgments', status: ok ? 'met' : 'unmet', expected: w.judgments.join(' / '), actual: o.judgment ?? '无' })
        }
        if (w.tags !== undefined) {
          const ok = o.tags !== undefined && o.tags.some(t => w.tags!.includes(t))
          raw.push({ id: 'where.tags', status: ok ? 'met' : 'unmet', expected: w.tags.join(' / '), actual: o.tags?.length ? o.tags.join('、') : '无' })
        }
        if (w.elements !== undefined) {
          const ok = o.element !== undefined && w.elements.includes(o.element)
          raw.push({ id: 'where.elements', status: ok ? 'met' : 'unmet', expected: w.elements.join(' / '), actual: o.element ?? '无' })
        }
        if (w.resource !== undefined) {
          const ok = o.resource === w.resource
          raw.push({ id: 'where.resource', status: ok ? 'met' : 'unmet', expected: w.resource, actual: o.resource ?? '无' })
        }
        if (w.ownerHas !== undefined) {
          const ok = owner !== 'env' && s.buffs.some(b => b.defId === w.ownerHas && b.owner === owner && b.target === owner)
          raw.push({ id: 'where.ownerHas', status: ok ? 'met' : 'unmet', expected: `持有者有 ${w.ownerHas}`, actual: ok ? '持有' : '没有' })
        }
        if (w.enemyState !== undefined) {
          const ok = o.enemyState === w.enemyState
          raw.push({ id: 'where.enemyState', status: ok ? 'met' : 'unmet', expected: w.enemyState, actual: o.enemyState ?? '无' })
        }
        if (w.effect !== undefined) {
          const ok = o.effect === w.effect
          raw.push({ id: 'where.effect', status: ok ? 'met' : 'unmet', expected: w.effect, actual: o.effect ?? '无' })
        }
        if (w.afterBattle !== undefined) {
          const ok = s.battleFrames >= w.afterBattle
          raw.push({ id: 'where.afterBattle', status: ok ? 'met' : 'unmet', expected: `战斗帧 ≥ ${w.afterBattle}`, actual: `${roundTo(s.battleFrames, 100)}` })
        }
      }

      if (icd !== undefined) {
        const last = s.lastTrigger[`${owner}|${id}`]
        const left = last !== undefined ? icd - (s.battleFrames - last) : 0
        const ok = last === undefined || left <= 0
        raw.push({
          id: 'icd',
          status: ok ? 'met' : 'unmet',
          expected: `内置冷却 ≥ ${icd} 战斗帧`,
          actual: ok ? '冷却已好' : `还剩 ${roundTo(left, 100)} 战斗帧`,
        })
      }

      groups.push({ occurrence: labelOfOcc(o), spec, conditions: withSpeculative(raw) })
    })
  }
  return groups
}

/** 延长型 buff 的额外检查（extendLimit：实例是否未达延长次数上限） */
export function explainExtend(
  s: Readonly<SimState>,
  def: BuffDef,
  owner: Slot | 'env',
  occs: readonly Occurrence[],
): { groups: TriggerCheckGroup[]; fired: boolean } {
  const ext = def.extend!
  const baseGroups = explainFiring(s, ext.trigger, owner, `${def.id}#extend`, undefined, occs)
  const instances = s.buffs.filter(b => b.defId === def.id && b.owner === owner)
  const canExtend = instances.some(b => b.remaining !== 'inf' && b.extended < ext.max)
  const maxExt = instances.length ? Math.min(...instances.map(b => b.extended)) : 0
  const limitCond: ConditionCheck = {
    id: 'extendLimit',
    status: canExtend ? 'met' : 'unmet',
    expected: `延长次数 < ${ext.max}（且非无限时长）`,
    actual: canExtend ? `已延长 ${maxExt} / ${ext.max} 次` : `已达上限 ${ext.max} 次或无限时长`,
  }
  const groups = baseGroups.map(g => ({
    ...g,
    conditions: withSpeculative([...g.conditions, limitCond]),
  }))
  const fired = groups.some(g => g.conditions.every(c => c.status === 'met' || c.status === 'notApplicable'))
  return { groups, fired }
}

export function groupsWouldFire(groups: readonly TriggerCheckGroup[]): boolean {
  return groups.some(g => g.conditions.every(c => c.status === 'met' || c.status === 'notApplicable'))
}
