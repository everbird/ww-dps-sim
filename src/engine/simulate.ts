// src/engine/simulate.ts —— simulate(ResolvedScenario) → { 事件日志, 汇总 }（总设计 §3.4、§6）
// 把内核（TD-04）、调度器（TD-09）、伤害公式（TD-03）、切人（TD-05）、资源与敌人量表（TD-06）、buff 与触发（TD-07）、角色钩子（TD-08）接在一起：
// 每个 tick 由内核推进；开始动作、切人、延奏、每次结算之后都把新事件交给事件队列处理（TD-07 §5）。
import type { ActionId, DamageTag, EffectName, Slot } from '../data/common'
import type { ActionDef, JudgmentDef } from '../data/gamedata'
import { activeFor, applyBuff, applyTriggered, bookKey, makeBook, removeBuff, targetsOf, tickBuffs } from './buffs'
import { newBus, type Sim } from './context'
import { canTuneBreak, enemyTimers, hitGauges, onTuneBreakStart, tuneBreakActionOf } from './enemy'
import { accumulate, computeHit, computeTuneBreak, hitView, matchesFilter, tuneBase } from './formula'
import { checkHit, checkTick } from './invariants'
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
  let lastBattle = 0                                              // 不变量：战斗时钟不倒退
  const k: Kernel = {
    rules: r.rules,
    hooks: {
      settle: (st, j, n) => settle(sim, st, j, n),
      // 开始动作时的顺序（TD-06 §7）：（谐度破坏消耗失谐）→ 扣大招能量 → actionStart 的触发与钩子 → 施放资源
      actionStarted: (st, slot, a) => {
        onTuneBreakStart(st, a.def, a.instance)
        payCost(sim, st, slot, a.def); drain(sim, st); castResources(sim, st, slot, a); drain(sim, st)
      },
      castGain: (st, slot, src, i) => { castGainAt(sim, st, slot, src, i); drain(sim, st) },
      outroTrigger: (st, slot, src) => outroTrigger(sim, st, slot, src),
      timers: (st, rates) => {
        enemyTimers(st)                                           // 瘫痪结束、白条回满（TD-06 §13.2）
        tickBuffs(st, rates)
        drain(sim, st)
        sim.bus.spawned.clear()
        checkTick(sim, st, lastBattle)                            // 总设计 §11 第 4 条：每个 tick 结束查一次
        lastBattle = st.battleFrames
      },
    },
  }
  const sim: Sim = {
    r, k, book: makeBook(r.buffs), ctxs: [], slotOf: new Map(r.team.map(m => [m.def.name, m.slot])), warned: new Set(), bus: newBus(),
  }
  sim.ctxs = r.team.map(m => hookContext(sim, s, m.slot))
  const tuneBreaks = r.team.map(m => tuneBreakActionOf(m.actions))
  const schedule = createScheduler(k, r.team.map(m => m.actions), {
    maxWait: r.options.maxWait,
    canAfford,
    canStart: (st, slot, def) => {
      if (def.kind === 'tuneBreak') { const ok = canTuneBreak(sim, st); if (ok !== true) return ok }
      return r.team[slot].def.hooks?.canStart?.(sim.ctxs[slot]!, def.id) ?? true
    },
    onSwitch: (st, _k, from, to, cmd) => onSwitch(sim, st, from, to, cmd),
    // 目标失谐：前台角色在下一条指令之前放自己的谐度破坏（options.tuneBreak = auto，TD-06 §13.4）
    interject: st => {
      if (r.options.tuneBreak !== 'auto' || canTuneBreak(sim, st) !== true) return null
      const def = tuneBreaks[st.onField]
      return def ? { slot: st.onField, def, why: '谐度破坏' } : null
    },
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
    energy: r.initial.energy[m.slot], concerto: r.initial.concerto[m.slot], core: [0, 0, 0, 0, 0], cooldowns: {}, charges: {}, flags: {},
  })) as SimState['chars']
  const e = r.enemy
  const enemy: EnemyRuntime = {
    preset: e, whiteBar: e.whiteBarTough, broken: false, paralyzedUntil: 0, poise: e.poise.max, tunability: 0, disharmony: false,
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

/** 这几类伤害走另外的公式（TD-03 §5、§6）与触发时机（TD-06 v0.2 之后），还没接上；不按直接伤害算，只提示一次 */
const LATER: readonly DamageTag[] = ['异常效应', '震谐响应', '骇破响应']

function settle(sim: Sim, s: SimState, j: JudgmentRuntime, n: number): void {
  const r = sim.r
  const m = r.team[j.owner]
  const d = j.def
  const draft: HitDraft = {
    judgment: d, char: m.def.name, multiplier: d.multiplier, extraFlat: 0, element: d.element, tags: [...d.tags],
    selfEnergyScale: 1, zones: {}, critOnly: {},
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
    if (draft.tags.includes('谐度破坏')) {
      // 谐度破坏（TD-03 §6）：基础值按角色等级与敌人 COST，物理抗性，不暴击；没有消耗这次失谐的（不是对失谐放的）× 0.0001
      const v = computeTuneBreak({
        base: tuneBase(r.data.tuneBreak, r.rules.charLevel, r.enemy.cost), rate: draft.multiplier, level: r.rules.charLevel,
        enemy: { def: r.enemy.def, res: r.enemy.res['物理'] }, harmonyBreakBoost: m.panel.harmonyBreakBoost + acc.zones.harmonyBreakBoost,
        ...(s.enemy.tuneBreakBy !== j.actionInstance ? { vsNormal: true } : {}),
      }, acc, r.rules)
      dmg = { nonCrit: v, crit: v, expected: v }
    } else {
      const res = computeHit({
        rate: draft.multiplier, attr: d.relatedAttr, panel: m.panel, extraFlat: draft.extraFlat, level: r.rules.charLevel,
        enemy: { def: r.enemy.def, res: r.enemy.res[draft.element] },
      }, acc, r.rules)
      dmg = { nonCrit: res.nonCrit, crit: res.crit, expected: res.expected }
      factors = res.factors
    }
    checkHit(s, dmg, m.def.name, d.name)
    used = active.filter(b => b.def.zone !== undefined && matchesFilter(b.def.filter, view))   // 标记型不列
      .map(b => (b.stacks > 1 ? `${b.def.id}×${b.stacks}` : b.def.id))
  }
  const { gains, full } = settleGains(sim, s, j, draft.selfEnergyScale)
  log(s, {
    type: 'hit', char: m.def.name, action: j.action, judgment: d.name, id: j.id, tick: n,
    element: draft.element, tags: draft.tags, dmg, ...(factors ? { factors } : {}), buffs: used, gains,
  })
  const link = sim.bus.spawned.get(j.id)                           // 钩子生成的判定：结算接在生成它的那条事件链上
  if (link) sim.bus.chain.set(s.log.length - 1, link)
  const after: Parameters<typeof log>[1][] = [...full, ...(d.heals ? [{ type: 'heal', char: m.def.name, source: d.name } as const] : [])]
  for (const f of after) {
    log(s, f)
    if (link) sim.bus.chain.set(s.log.length - 1, link)
  }
  hitGauges(sim, s, j)                                            // 敌人量表：偏谐值、失谐、谐度破坏命中、白条（TD-06 §13）
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
    chain: m.chain,
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
    heal: source => { log(s, { type: 'heal', char: m.def.name, source }) },
    warn: message => log(s, { type: 'warning', code: 'hook', message: `${m.def.name}：${message}` }),
  }
}
