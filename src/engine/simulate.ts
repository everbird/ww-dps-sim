// src/engine/simulate.ts —— simulate(ResolvedScenario) → { 事件日志, 汇总 }（总设计 §3.4、§6）
// 把内核（TD-04）、调度器（TD-09）、伤害公式（TD-03）接在一起：每个 tick 由内核推进，P4 的每次结算在这里算伤害。
// M2 的范围：常驻 buff、伤害结算、钩子 onResolve / canStart / modifyHit。能量与协奏（TD-06）、切人变奏 / 延奏（TD-05）、
// 触发型 buff（TD-07）、onEvent 钩子在 M3 接上。
import type { ActionId, DamageTag, EffectName, Slot } from '../data/common'
import type { ActionDef, JudgmentDef } from '../data/gamedata'
import { activeFor, applyBuff, bookKey, makeBook, removeBuff, targetsOf, tickBuffs, type BuffBook } from './buffs'
import { accumulate, computeHit, hitView, matchesFilter } from './formula'
import { log, spawnJudgment, type Kernel } from './kernel'
import { createScheduler, newQueue, runLoop, ScheduleError } from './scheduler'
import { summarize } from './summary'
import type {
  CharRuntime, EnemyRuntime, HitDraft, HookContext, JudgmentRuntime, ResolvedScenario, SimResult, SimState,
} from './types'

export function simulate(r: ResolvedScenario): SimResult {
  const s = initialState(r)
  const book = makeBook(r.buffs)
  const ctxs = r.team.map(m => hookContext(s, r, book, m.slot))
  const warned = new Set<string>()                               // 同一件事只提示一次

  for (const reg of r.buffs) {                                   // 常驻 buff 开场即有（总设计 §3.3 第 3 步）
    if (reg.def.trigger !== 'always') continue
    for (const t of targetsOf(reg.def, reg.owner, s)) applyBuff(s, reg, t)
  }
  for (const m of r.team) m.def.hooks?.onResolve?.(ctxs[m.slot]!)

  const k: Kernel = {
    rules: r.rules,
    hooks: {
      settle: (st, j, n) => settle(st, r, book, ctxs, warned, j, n),
      timers: tickBuffs,
    },
  }
  const schedule = createScheduler(k, r.team.map(m => m.actions), {
    maxWait: r.options.maxWait,
    canStart: (st, slot, def) => r.team[slot].def.hooks?.canStart?.(ctxs[slot]!, def.id) ?? true,
  })
  let error: SimResult['error']
  try {
    runLoop(s, k, schedule, r.options.maxFrames)
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
  }
}

// ---------------------------------------------------------------------------
// P4 一次结算（TD-03 §4）：草稿 → modifyHit → 收集 buff → computeHit → hit 事件

/** 这几类伤害走另外的公式（TD-03 §5、§6）与触发时机（TD-06），M4 接上；在那之前不按直接伤害算，只提示一次 */
const LATER: readonly DamageTag[] = ['异常效应', '谐度破坏', '震谐响应', '骇破响应']

function settle(
  s: SimState, r: ResolvedScenario, book: BuffBook, ctxs: HookContext[], warned: Set<string>, j: JudgmentRuntime, n: number,
): void {
  const m = r.team[j.owner]
  const d = j.def
  const draft: HitDraft = {
    judgment: d, char: m.def.name, multiplier: d.multiplier, extraFlat: 0, element: d.element, tags: [...d.tags],
    zones: {}, critOnly: {},
  }
  m.def.hooks?.modifyHit?.(ctxs[j.owner]!, draft)
  let dmg: { nonCrit: number; crit: number; expected: number } | null = null
  let factors
  let used: string[] = []
  const later = draft.tags.find(t => LATER.includes(t))
  if (later && !warned.has(`${m.def.name}|${d.name}`)) {
    warned.add(`${m.def.name}|${d.name}`)
    log(s, { type: 'warning', code: 'later', message: `${m.def.name} ${d.name}：${later}的伤害要到 M4 才计算，这次记 0` })
  }
  if (!later && d.calc === 'damage' && d.target === 'enemy' && (draft.multiplier > 0 || draft.extraFlat > 0)) {
    const view = hitView(draft, j.action, new Set(Object.keys(s.enemy.effects) as EffectName[]))
    const active = activeFor(s, book, j.owner)
    const acc = accumulate(view, active, draft)
    const res = computeHit({
      rate: draft.multiplier, attr: d.relatedAttr, panel: m.panel, extraFlat: draft.extraFlat, level: r.rules.charLevel,
      enemy: { def: r.enemy.def, res: r.enemy.res[draft.element] },
    }, acc, r.rules)
    dmg = { nonCrit: res.nonCrit, crit: res.crit, expected: res.expected }
    factors = res.factors
    used = active.filter(b => matchesFilter(b.def.filter, view)).map(b => (b.stacks > 1 ? `${b.def.id}×${b.stacks}` : b.def.id))
  }
  log(s, {
    type: 'hit', char: m.def.name, action: j.action, judgment: d.name, id: j.id, tick: n, dmg,
    ...(factors ? { factors } : {}), buffs: used,
    gains: { energy: {}, concerto: 0, core: [] },                   // 资源发放在 M3（TD-06）
  })
}

// ---------------------------------------------------------------------------
// 钩子的受控接口（总设计 §6.9、TD-02 §7.4）

function hookContext(s: SimState, r: ResolvedScenario, book: BuffBook, self: Slot): HookContext {
  const m = r.team[self]
  const findJudgment = (name: string, action?: ActionId): { action: ActionDef; j: JudgmentDef } | null => {
    const pool = action ? [m.actions[action]].filter((a): a is ActionDef => a !== undefined) : Object.values(m.actions)
    for (const a of pool) {
      const j = a.judgments.find(x => x.name === name)
      if (j) return { action: a, j }
    }
    return null
  }
  return {
    self,
    state: s,
    buffStacks: (id, target = self) => s.buffs.find(b => b.defId === id && b.owner === self && b.target === target)?.stacks ?? 0,
    addBuff: (id, opts = {}) => {
      const reg = book.get(bookKey(self, id))
      if (!reg) throw new Error(`${m.def.name} 的钩子要加的 buff "${id}" 不在它的 buffs 里`)
      const targets = opts.target !== undefined ? [opts.target] : targetsOf(reg.def, self, s)
      for (const t of targets) applyBuff(s, reg, t, opts.stacks)
    },
    removeBuff: (id, target) => {
      for (const b of s.buffs.filter(x => x.defId === id && x.owner === self && (target === undefined || x.target === target)))
        removeBuff(s, b, 'removed')
    },
    addResource: (resource, amount, slot = self) => {
      const c = s.chars[slot]
      const clamp = (v: number, cap: number) => Math.max(0, Math.min(cap, v))
      let before: number, value: number
      if (resource === 'energy') { before = c.energy; value = c.energy = clamp(before + amount, r.team[slot].def.energyCost) }
      else if (resource === 'concerto') { before = c.concerto; value = c.concerto = clamp(before + amount, r.rules.concertoMax) }
      else {
        const k = Number(resource.slice(4))
        const cap = r.team[slot].def.coreResources.find(x => x.slot === k)?.cap ?? Infinity
        before = c.core[k - 1]!
        value = c.core[k - 1] = clamp(before + amount, cap)
      }
      log(s, { type: 'resource', char: c.name, resource, delta: value - before, value, cause: 'hook' })
    },
    spawnJudgment: (name, opts = {}) => {
      const hit = findJudgment(name, opts.action)
      if (!hit) throw new Error(`${m.def.name} 的钩子要生成的判定"${name}"不存在`)
      const running = s.chars[self].action
      spawnJudgment(s, self, hit.action.id, running?.id === hit.action.id ? running.instance : s.nextId++, hit.j)
    },
    setFlag: (key, value) => { s.chars[self].flags[key] = value },
    getFlag: key => s.chars[self].flags[key],
    warn: message => log(s, { type: 'warning', code: 'hook', message: `${m.def.name}：${message}` }),
  }
}
