// src/engine/simulate.ts —— simulate(ResolvedScenario) → { 事件日志, 汇总 }（总设计 §3.4、§6）
// 把内核（TD-04）、调度器（TD-09）、伤害公式（TD-03）、切人（TD-05）、资源（TD-06）、buff 与触发（TD-07）、角色钩子（TD-08）接在一起：
// 每个 tick 由内核推进；开始动作、切人、延奏、每次结算之后都把新事件交给事件队列处理（TD-07 §5）。
import type { ActionId, DamageTag, EffectName, Slot } from '../data/common'
import type { ActionDef, JudgmentDef } from '../data/gamedata'
import { activeFor, applyBuff, applyTriggered, bookKey, makeBook, removeBuff, targetsOf, tickBuffs } from './buffs'
import { newBus, type Sim } from './context'
import { accumulate, computeHit, hitView, matchesFilter } from './formula'
import { log, spawnJudgment, startAction, type Kernel } from './kernel'
import { canAfford, castGainAt, castResources, grant, payCost, settleGains } from './resources'
import { createScheduler, newQueue, runLoop, ScheduleError } from './scheduler'
import { summarize } from './summary'
import { onSwitch, outroTrigger } from './switch'
import { drain } from './triggers'
import type {
  CharRuntime, EnemyRuntime, HitDraft, HookContext, JudgmentRuntime, ResolvedScenario, SimResult, SimState,
} from './types'

export function simulate(r: ResolvedScenario): SimResult {
  const s = initialState(r)
  const k: Kernel = {
    rules: r.rules,
    hooks: {
      settle: (st, j, n) => settle(sim, st, j, n),
      // 开始动作时的顺序（TD-06 §7）：扣大招能量 → actionStart 的触发与钩子 → 施放资源
      actionStarted: (st, slot, a) => { payCost(sim, st, slot, a.def); drain(sim, st); castResources(sim, st, slot, a); drain(sim, st) },
      castGain: (st, slot, src, i) => { castGainAt(sim, st, slot, src, i); drain(sim, st) },
      outroTrigger: (st, slot, src) => outroTrigger(sim, st, slot, src),
      timers: (st, rates) => { tickBuffs(st, rates); drain(sim, st); sim.bus.spawned.clear() },
    },
  }
  const sim: Sim = {
    r, k, book: makeBook(r.buffs), ctxs: [], slotOf: new Map(r.team.map(m => [m.def.name, m.slot])), warned: new Set(), bus: newBus(),
  }
  sim.ctxs = r.team.map(m => hookContext(sim, s, m.slot))
  const schedule = createScheduler(k, r.team.map(m => m.actions), {
    maxWait: r.options.maxWait,
    canAfford,
    canStart: (_st, slot, def) => r.team[slot].def.hooks?.canStart?.(sim.ctxs[slot]!, def.id) ?? true,
    onSwitch: (st, _k, from, to, cmd) => onSwitch(sim, st, from, to, cmd),
  })
  let error: SimResult['error']
  try {
    for (const reg of r.buffs) {                                 // 常驻 buff 开场即有（总设计 §3.3 第 3 步）
      if (reg.def.trigger !== 'always') continue
      for (const t of targetsOf(reg.def, reg.owner, s)) applyBuff(s, reg, t)
    }
    for (const m of r.team) m.def.hooks?.onResolve?.(sim.ctxs[m.slot]!)
    drain(sim, s)
    runLoop(s, k, schedule, r.options.maxFrames)
    drain(sim, s)                                                 // 最后一个 tick 在 P2 就结束时记下的事件
  } catch (e) {
    if (!(e instanceof ScheduleError)) throw e
    error = { code: e.code, message: e.message, frame: e.frame, ...(e.cmd ? { line: e.cmd.line, loop: e.cmd.loop } : {}) }
  }
  return { log: s.log, summary: summarize(s.log, r, s), ...(error ? { error } : {}) }
}

// ---------------------------------------------------------------------------
// 初始状态

function initialState(r: ResolvedScenario): SimState {
  const chars = r.team.map((m): CharRuntime => ({
    slot: m.slot, name: m.def.name, action: null, last: null, startedThisTick: false,
    energy: r.initial.energy[m.slot], concerto: r.initial.concerto[m.slot], core: [0, 0, 0, 0, 0], cooldowns: {}, flags: {},
  })) as SimState['chars']
  const e = r.enemy
  const enemy: EnemyRuntime = {
    preset: e, whiteBar: e.whiteBar.max, broken: false, poise: e.poise.max, tunability: 0, disharmony: false,
    tunabilityLockedUntil: 0, effects: {}, responseCd: {},
  }
  return {
    frame: 0, battleFrames: 0, onField: r.initial.onField, switchCd: 0, chars, judgments: [], tails: [], buffs: [],
    enemy, dilations: [], queue: newQueue(r.commands, r.options.repeat), log: [], nextId: 1,
    outroLinks: [], pendingNextIn: [], lastTrigger: {},
  }
}

// ---------------------------------------------------------------------------
// P4 一次结算（TD-03 §4、TD-06 §7）：草稿 → modifyHit → 收集 buff → computeHit → 资源 → hit 事件 → 触发 → 接续动作

/** 这几类伤害走另外的公式（TD-03 §5、§6）与触发时机（TD-06），M4 接上；在那之前不按直接伤害算，只提示一次 */
const LATER: readonly DamageTag[] = ['异常效应', '谐度破坏', '震谐响应', '骇破响应']

function settle(sim: Sim, s: SimState, j: JudgmentRuntime, n: number): void {
  const r = sim.r
  const m = r.team[j.owner]
  const d = j.def
  const draft: HitDraft = {
    judgment: d, char: m.def.name, multiplier: d.multiplier, extraFlat: 0, element: d.element, tags: [...d.tags],
    energyScale: 1, zones: {}, critOnly: {},
  }
  m.def.hooks?.modifyHit?.(sim.ctxs[j.owner]!, draft)
  let dmg: { nonCrit: number; crit: number; expected: number } | null = null
  let factors
  let used: string[] = []
  const later = draft.tags.find(t => LATER.includes(t))
  if (later && !sim.warned.has(`${m.def.name}|${d.name}`)) {
    sim.warned.add(`${m.def.name}|${d.name}`)
    log(s, { type: 'warning', code: 'later', message: `${m.def.name} ${d.name}：${later}的伤害要到 M4 才计算，这次记 0` })
  }
  if (!later && d.calc === 'damage' && d.target === 'enemy' && (draft.multiplier > 0 || draft.extraFlat > 0)) {
    const view = hitView(draft, j.action, new Set(Object.keys(s.enemy.effects) as EffectName[]))
    const active = activeFor(s, sim.book, j.owner)
    const acc = accumulate(view, active, draft)
    const res = computeHit({
      rate: draft.multiplier, attr: d.relatedAttr, panel: m.panel, extraFlat: draft.extraFlat, level: r.rules.charLevel,
      enemy: { def: r.enemy.def, res: r.enemy.res[draft.element] },
    }, acc, r.rules)
    dmg = { nonCrit: res.nonCrit, crit: res.crit, expected: res.expected }
    factors = res.factors
    used = active.filter(b => b.def.zone !== undefined && matchesFilter(b.def.filter, view))   // 标记型不列
      .map(b => (b.stacks > 1 ? `${b.def.id}×${b.stacks}` : b.def.id))
  }
  const { gains, full } = settleGains(sim, s, j, draft.energyScale)
  log(s, {
    type: 'hit', char: m.def.name, action: j.action, judgment: d.name, id: j.id, tick: n,
    element: draft.element, tags: draft.tags, dmg, ...(factors ? { factors } : {}), buffs: used, gains,
  })
  const link = sim.bus.spawned.get(j.id)                           // 钩子生成的判定：结算接在生成它的那条事件链上
  if (link) sim.bus.chain.set(s.log.length - 1, link)
  for (const f of full) {
    log(s, f)
    if (link) sim.bus.chain.set(s.log.length - 1, link)
  }
  drain(sim, s)
  // 接续动作（TD-08 P10）：本动作的该判定第一次结算后立刻开始，继承指令出处
  const a = s.chars[j.owner].action
  const f = a?.def.followUp
  if (n === 0 && a && f && a.instance === j.actionInstance && f.after === d.name) startAction(s, sim.k, j.owner, m.actions[f.action]!, a.cmd)
}

// ---------------------------------------------------------------------------
// 钩子的受控接口（总设计 §6.9、TD-08 §3.2）

function hookContext(sim: Sim, s: SimState, self: Slot): HookContext {
  const m = sim.r.team[self]
  const findJudgment = (name: string, action?: ActionId): { action: ActionDef; j: JudgmentDef } | null => {
    const pool = action ? [m.actions[action]].filter((a): a is ActionDef => a !== undefined) : Object.values(m.actions)
    for (const a of pool) {
      const j = a.judgments.find(x => x.name === name)
      if (j) return { action: a, j }
    }
    return null
  }
  const reg = (id: string) => {
    const b = sim.book.get(bookKey(self, id))
    if (!b) throw new Error(`${m.def.name} 的钩子要用的 buff "${id}" 不在它的 buffs 里（或共鸣链不够）`)
    return b
  }
  return {
    self,
    state: s,
    buffStacks: (id, target = self) => s.buffs.find(b => b.defId === id && b.owner === self && b.target === target)?.stacks ?? 0,
    addBuff: (id, opts = {}) => {
      const b = reg(id)
      if (opts.target !== undefined) applyBuff(s, b, opts.target, opts.stacks)
      else applyTriggered(s, b, undefined, opts.stacks)             // nextIn 挂起到下一次切入（TD-07 §3）
    },
    removeBuff: (id, target) => {
      for (const b of s.buffs.filter(x => x.defId === id && x.owner === self && (target === undefined || x.target === target)))
        removeBuff(s, b, 'removed')
    },
    addResource: (resource, amount, slot = self) => { grant(sim, s, slot, resource, amount, 'hook') },
    spawnJudgment: (name, opts = {}) => {
      const hit = findJudgment(name, opts.action)
      if (!hit) throw new Error(`${m.def.name} 的钩子要生成的判定"${name}"不存在`)
      const running = s.chars[self].action
      const j = spawnJudgment(s, self, hit.action.id, running?.id === hit.action.id ? running.instance : s.nextId++, hit.j)
      const cur = sim.bus.current
      if (cur) sim.bus.spawned.set(j.id, { depth: cur.depth + 1, root: cur.root })
    },
    skipJudgments: (instance, names) => {
      const src = s.chars.find(c => c.action?.instance === instance)?.action ?? s.tails.find(t => t.instance === instance)
      if (!src) {
        log(s, { type: 'warning', code: 'hook', message: `${m.def.name}：skipJudgments 找不到进行中的动作实例 ${instance}（已结束或不存在）` })
        return
      }
      src.skip = [...new Set([...(src.skip ?? []), ...names])]
    },
    setFlag: (key, value) => { s.chars[self].flags[key] = value },
    getFlag: key => s.chars[self].flags[key],
    warn: message => log(s, { type: 'warning', code: 'hook', message: `${m.def.name}：${message}` }),
  }
}
