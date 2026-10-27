// src/engine/simulate.ts —— simulate(ResolvedScenario) → { 事件日志, 汇总 }（总设计 §3.4、§6）
// 把内核（TD-04）、调度器（TD-09）、伤害公式（TD-03）、切人（TD-05）、资源与敌人量表（TD-06）、buff 与触发（TD-07）、角色钩子（TD-08）接在一起：
// 每个 tick 由内核推进；开始动作、切人、延奏、每次结算之后都把新事件交给事件队列处理（TD-07 §5）。
import { EFFECT_NAMES, type ActionId, type DamageTag, type EffectName, type Slot } from '../data/common'
import type { ActionDef, JudgmentDef } from '../data/gamedata'
import { assume } from './assumptions'
import { roundTo } from './num'
import { nextFloat, nextInt, nextNormal, seedRng } from './rng'
import { activeFor, applyBuff, applyTriggered, bookKey, makeBook, removeBuff, targetsOf, tickBuffs } from './buffs'
import { newBus, type HitRecord, type Sim, type SimOptions } from './context'
import {
  applyEffect, applyShift, canTuneBreak, forceDisharmony, effectDamage, effectTicks, enemyTimers, hitGauges, onTuneBreakStart, takeBurst, tuneBreakActionsOf,
} from './enemy'
import { accumulate, computeHit, computeTuneBreak, hitView, matchesFilter, tuneBase } from './formula'
import { checkHit, checkTick } from './invariants'
import { cooldownKey, log, spawnJudgment, startAction, type Kernel } from './kernel'
import { canAfford, castGainAt, castResources, grant, payCost, settleGains } from './resources'
import { createScheduler, newQueue, runLoop, ScheduleError } from './scheduler'
import { summarize } from './summary'
import { onSwitch, outroTrigger } from './switch'
import { drain } from './triggers'
import type {
  CharRuntime, CooldownStep, EnemyRuntime, ForteStep, HitDraft, HitEvent, HookContext, JudgmentRuntime, ResolvedScenario, SimResult, SimState,
} from './types'

export function simulate(r: ResolvedScenario, opts: SimOptions = {}): SimResult {
  const s = initialState(r)
  if (opts.sample) s.rng = seedRng(opts.sample.seed)              // 抽样模式（总设计 T4）
  const jitter = opts.sample?.jitter ?? 0
  const hand = opts.sample?.hand
  let lastBattle = 0                                              // 不变量：战斗时钟不倒退
  const k: Kernel = {
    rules: r.rules,
    hooks: {
      settle: (st, j, n) => settle(sim, st, j, n),
      // 开始动作时的顺序（TD-06 §7）：（谐度破坏消耗失谐）→ 扣大招能量 → actionStart 的触发与钩子 → 施放资源
      actionStarted: (st, slot, a) => {
        // 不带指令出处的谐度破坏是自动插的（options.tuneBreak = auto，假设 tune-break-auto）
        if (a.def.kind === 'tuneBreak' && !a.cmd) assume(st, 'tune-break-auto', `${st.chars[slot].name} ${a.id}`)
        onTuneBreakStart(st, a.def, a.instance)
        payCost(sim, st, slot, a.def); drain(sim, st); castResources(sim, st, slot, a); drain(sim, st)
      },
      castGain: (st, slot, src, i) => { castGainAt(sim, st, slot, src, i); drain(sim, st) },
      expired: (st, j) => { if (j.def.spawns?.on === 'end') spawnLinked(sim, st, j, '持续帧结束后生成') },
      outroTrigger: (st, slot, src) => outroTrigger(sim, st, slot, src),
      timers: (st, rates) => {
        effectTicks(sim, st, rates)                               // 异常效应定时结算（§18）：到期那一刻赶上的先结算
        enemyTimers(st, rates)                                    // 瘫痪结束、白条回满（TD-06 §13.2）；异常效应到时（§18）
        tickBuffs(st, rates)
        drain(sim, st)
        sim.bus.spawned.clear()
        captureForte(st)
        captureCooldowns(st, rates.battle)
        checkTick(sim, st, lastBattle)                            // 总设计 §11 第 4 条：每个 tick 结束查一次
        lastBattle = st.battleFrames
      },
    },
  }
  const sim: Sim = {
    r, k, book: makeBook(r.buffs), hooks: r.team.map(m => r.data.hooks[m.def.name]), ctxs: [], slotOf: new Map(r.team.map(m => [m.def.name, m.slot])), warned: new Set(), bus: newBus(),
    keepStacks: new Set(r.team.flatMap(m => EFFECT_NAMES.filter(e => m.def.effectRules?.[e]?.keepStacks))),
    ...(opts.onHit ? { onHit: opts.onHit } : {}),
  }
  sim.ctxs = r.team.map(m => hookContext(sim, s, m.slot))
  // 按面板属性换算的 buff 在装配时按静态面板定了数值（BuffDef.scale）
  for (const b of r.buffs) if (b.def.scale) assume(s, 'stat-scaling-static', b.def.id)
  // 共鸣回路的状态说明（钩子 forte，只读）：每个 tick 结束取一次，变了才记；只供时间轴的检查器显示
  const forte: ForteStep[] = []
  const shown: (string | undefined)[] = r.team.map(() => undefined)
  const captureForte = (st: SimState) => {
    for (const m of r.team) {
      const text = sim.hooks[m.slot]?.forte?.(sim.ctxs[m.slot]!)
      if (text === undefined || text === shown[m.slot]) continue
      shown[m.slot] = text
      forte.push({ f: st.frame, char: m.def.name, text })
    }
  }
  // 技能冷却（时间轴视图 E 显示）：P6 扣过冷却之后取，"这一 tick 走完后的战斗帧 + 剩余"在倒计时期间不变（全局时停里也不变），
  // 就是从哪个战斗帧起能用；变了（放了技能、充能回复一次）才记
  const cooldowns: CooldownStep[] = []
  const maxCharges = r.team.map(m => new Map(Object.values(m.actions).flatMap(a => (a.cooldown && (a.charges ?? 1) > 1 ? [[cooldownKey(a), a.charges!] as const] : []))))
  const cdShown = r.team.map(() => new Map<string, { ready: number | null; charges?: number }>())
  const captureCooldowns = (st: SimState, rate: number) => {
    for (const m of r.team) {
      const c = st.chars[m.slot]
      for (const [key, left] of Object.entries(c.cooldowns)) {
        const max = maxCharges[m.slot]!.get(key), ch = c.charges[key]
        const charges = max !== undefined ? max - (ch?.spent ?? 0) : undefined
        const ready = left > 1e-6 ? roundTo(st.battleFrames + rate + left, 10) : null
        // 膨胀里战斗时钟按小数走，留半帧的余量
        const was = cdShown[m.slot]!.get(key)
        if (was && was.charges === charges && (was.ready === null ? ready === null : ready !== null && Math.abs(ready - was.ready) < 0.5)) continue
        cdShown[m.slot]!.set(key, { ready, ...(charges !== undefined ? { charges } : {}) })
        cooldowns.push({ f: st.frame, char: m.def.name, key, ready, ...(charges !== undefined ? { charges } : {}) })
      }
    }
  }
  const tuneBreaks = r.team.map(m => tuneBreakActionsOf(m.actions))
  const delayAt = (st: SimState): number => {
    const at = r.options.inputDelayAt
    const c = at && st.queue.loop > 0 ? st.queue.commands[st.queue.next] : undefined
    return c ? at![`${c.line}.${c.item}`] ?? 0 : 0
  }
  const schedule = createScheduler(k, r.team.map(m => m.actions), {
    maxWait: r.options.maxWait,
    // 操作延迟：期望模式是固定的 options.inputDelay（卡帧点另给某几条加 inputDelayAt）；抽样模式另加 [0, jitter] 帧的抖动（调度器里唯一的随机注入点）
    inputDelay: st => r.options.inputDelay + delayAt(st) + (st.rng && jitter > 0 ? nextInt(st.rng, jitter) : 0)
      + (st.rng && hand ? Math.max(0, roundTo(hand.mean + hand.sd * nextNormal(st.rng), 1)) : 0),
    canAfford,
    canStart: (st, slot, def) => {
      if (def.kind === 'tuneBreak') { const ok = canTuneBreak(sim, st); if (ok !== true) return ok }
      return sim.hooks[slot]?.canStart?.(sim.ctxs[slot]!, def.id) ?? true
    },
    onSwitch: (st, _k, from, to, cmd) => onSwitch(sim, st, from, to, cmd),
    enemyCommand: st => forceDisharmony(sim, st),
    // 能量满 <角色>（录像剖析，假设 forced-energy）：补到大招能量上限，记一条 resource（cause forced）
    fillCommand: (st, slot) => {
      assume(st, 'forced-energy', `${st.chars[slot].name} 第 ${st.frame} 帧`)
      grant(sim, st, slot, 'energy', r.team[slot]!.def.energyCost - st.chars[slot].energy, 'forced')
    },
    // 目标失谐：前台角色在下一条指令之前放自己的谐度破坏（options.tuneBreak = auto，TD-06 §13.4）
    interject: st => {
      if (r.options.tuneBreak !== 'auto' || canTuneBreak(sim, st) !== true) return null
      // 有几种谐度破坏的（椿：常态 / 盛绽），挑角色钩子允许的那个（m0-confirm §10 H5）
      const slot = st.onField
      const def = tuneBreaks[slot]!.find(d => (sim.hooks[slot]?.canStart?.(sim.ctxs[slot]!, d.id) ?? true) === true)
      return def ? { slot, def, why: '谐度破坏' } : null
    },
  })
  let error: SimResult['error']
  try {
    for (const reg of r.buffs) {                                 // 常驻 buff 开场即有（总设计 §3.3 第 3 步）
      if (reg.def.trigger !== 'always') continue
      for (const t of targetsOf(reg.def, reg.owner, s)) applyBuff(s, reg, t)
    }
    for (const m of r.team) sim.hooks[m.slot]?.onResolve?.(sim.ctxs[m.slot]!)
    drain(sim, s)
    runLoop(s, k, schedule, r.options.maxFrames)
    drain(sim, s)                                                 // 最后一个 tick 在 P2 就结束时记下的事件
  } catch (e) {
    if (!(e instanceof ScheduleError)) throw e
    error = { code: e.code, message: e.message, frame: e.frame, ...(e.cmd ? { line: e.cmd.line, loop: e.cmd.loop } : {}) }
  }
  return { log: s.log, summary: summarize(s.log, r, s), forte, cooldowns, ...(error ? { error } : {}) }
}

// ---------------------------------------------------------------------------
// 初始状态

function initialState(r: ResolvedScenario): SimState {
  const chars = r.team.map((m): CharRuntime => ({
    slot: m.slot, name: m.def.name, action: null, last: null, combo: null, switchCd: 0, startedThisTick: false,
    energy: r.initial.energy[m.slot], concerto: r.initial.concerto[m.slot], core: [...r.initial.core[m.slot]!] as typeof r.initial.core[0], cooldowns: {}, charges: {},
    vars: Object.seal({ ...m.def.vars }),                      // 只能改声明过的状态量，加新键会报错（总设计 §10.1）
  })) as SimState['chars']
  const e = r.enemy
  const enemy: EnemyRuntime = {
    preset: e, whiteBar: e.whiteBarTough, broken: false, paralyzedUntil: 0, poise: e.poise.max, tunability: 0, disharmony: false,
    tunabilityLockedUntil: 0, tuneButtonUntil: 0, effects: {}, responseCd: {}, settledAt: {},
  }
  return {
    frame: 0, battleFrames: 0, onField: r.initial.onField, chars, judgments: [], tails: [], buffs: [],
    enemy, dilations: [], queue: newQueue(r.commands, r.options.repeat, r.opening), log: [], nextId: 1,
    outroLinks: [], pendingNextIn: [], lastTrigger: {}, assumed: {}, rng: null, entry: null,
  }
}

// ---------------------------------------------------------------------------
// P4 一次结算（TD-03 §4、TD-06 §7）：草稿 → modifyHit → 收集 buff → computeHit → 资源 → hit 事件 → 触发 → 接续动作

/** 这几类判定的伤害走另外的公式（TD-03 §5、§6）与触发时机，还没接上；不按直接伤害算，只提示一次。
 *  异常效应自身的伤害（定时结算、钩子主动触发）在 enemy.ts，不经过判定（TD-06 §18） */
const LATER: readonly DamageTag[] = ['异常效应', '骇破响应']

function settle(sim: Sim, s: SimState, j: JudgmentRuntime, n: number): void {
  const r = sim.r
  const m = r.team[j.owner]
  const d = j.def
  const draft: HitDraft = {
    judgment: d, char: m.def.name, multiplier: d.multiplier, extraFlat: 0, element: d.element, tags: [...d.tags],
    selfEnergyScale: 1, zones: {}, critOnly: {},
  }
  sim.hooks[j.owner]?.modifyHit?.(sim.ctxs[j.owner]!, draft)
  let dmg: HitEvent['dmg'] = null
  let factors
  let used: string[] = []
  let rec: HitRecord | null = null
  const later = draft.tags.find(t => LATER.includes(t))
  if (later) assume(s, 'later-damage', `${m.def.name} ${d.name}（${later}）`)
  if (d.flags.length > 0) assume(s, 'data-guess', `${m.def.name}·${d.name}：${d.flags.join('、')}`)
  if (later && !sim.warned.has(`${m.def.name}|${d.name}`)) {
    sim.warned.add(`${m.def.name}|${d.name}`)
    log(s, { type: 'warning', code: 'later', message: `${m.def.name} ${d.name}：${later}的伤害要到 M4 才计算，这次记 0` })
  }
  if (!later && d.calc === 'damage' && d.target === 'enemy' && (draft.multiplier > 0 || draft.extraFlat > 0)) {
    const view = hitView(draft, j.action, new Set(Object.keys(s.enemy.effects) as EffectName[]))
    const active = activeFor(s, sim.book, j.owner)
    const acc = accumulate(view, active, draft)
    if (acc.zones.TargetDefRate !== 0 || acc.zones.RoleIgnoreDefRate !== 0)
      assume(s, 'def-no-floor', `${m.def.name} ${d.name}`)                    // 有减防 / 无视防御时，取不取整才有区别（TD-03 Q1）
    if (draft.tags.includes('谐度破坏') || draft.tags.includes('震谐响应')) {
      // 谐度破坏（TD-03 §6）：基础值按角色等级与敌人 COST，物理抗性，不暴击；没有消耗这次失谐的（不是对失谐放的）× 0.0001。
      // 震谐响应（伤害类型 12，含爱弥斯光翼共奏追加的震谐伤害）同一公式：按行上的元素算抗性，没有"目标未失谐"这一项（TD-03 §6、TD-06 §19）
      const tb = draft.tags.includes('谐度破坏')
      const v = computeTuneBreak({
        base: tuneBase(r.data.tuneBreak, r.rules.charLevel, r.enemy.cost), rate: draft.multiplier, level: r.rules.charLevel,
        enemy: { def: r.enemy.def, res: r.enemy.res[tb ? '物理' : draft.element] }, harmonyBreakBoost: m.panel.harmonyBreakBoost + acc.zones.harmonyBreakBoost,
        ...(tb && s.enemy.tuneBreakBy !== j.actionInstance ? { vsNormal: true } : {}),
      }, acc, r.rules)
      dmg = { nonCrit: v, crit: v, expected: v }
    } else {
      const hc = {
        rate: draft.multiplier, attr: d.relatedAttr, extraFlat: draft.extraFlat, level: r.rules.charLevel,
        enemy: { def: r.enemy.def, res: r.enemy.res[draft.element] },
      }
      const res = computeHit({ ...hc, panel: m.panel }, acc, r.rules)
      if (sim.onHit) rec = { slot: j.owner, index: -1, ctx: hc, view, active, draft: { zones: draft.zones, critOnly: draft.critOnly } }
      dmg = { nonCrit: res.nonCrit, crit: res.crit, expected: res.expected }
      if (s.rng) dmg.isCrit = nextFloat(s.rng) < res.critRate          // 抽样模式：这一段暴击了没有（结算时的随机注入点）
      factors = res.factors
    }
    checkHit(s, dmg, m.def.name, d.name)
    used = active.filter(b => b.def.zone !== undefined && matchesFilter(b.def.filter, view))   // 标记型不列
      .map(b => (b.stacks > 1 ? `${b.def.id}×${b.stacks}` : b.def.id))
  }
  const { gains, full } = settleGains(sim, s, j, draft.selfEnergyScale)
  const hitIndex = s.log.length
  log(s, {
    type: 'hit', char: m.def.name, action: j.action, judgment: d.name, id: j.id, tick: n,
    element: draft.element, tags: draft.tags, dmg, ...(factors ? { factors } : {}), buffs: used, gains,
  })
  if (rec) sim.onHit!({ ...rec, index: hitIndex })
  const link = sim.bus.spawned.get(j.id)                           // 钩子生成的判定：结算接在生成它的那条事件链上
  if (link) sim.bus.chain.set(s.log.length - 1, link)
  const after: Parameters<typeof log>[1][] = [...full, ...(d.heals ? [{ type: 'heal', char: m.def.name, source: d.name } as const] : [])]
  for (const f of after) {
    log(s, f)
    if (link) sim.bus.chain.set(s.log.length - 1, link)
  }
  hitGauges(sim, s, j)                                            // 敌人量表：偏谐值、失谐、谐度破坏命中、白条（TD-06 §13）
  const e = s.enemy
  if (d.target === 'enemy' && (e.preset.tunabilityMax > 0 || e.preset.whiteBarTough > 0))
    (s.log[hitIndex] as HitEvent).enemy = { tunability: e.tunability, whiteBar: e.whiteBar }
  if (d.applies && d.target === 'enemy') {                        // 命中后附加异常效应（TD-06 §18）
    applyEffect(sim, s, j.owner, d.applies.effect, d.applies.stacks, `${m.def.name} ${d.name}`)
    if (link) sim.bus.chain.set(s.log.length - 1, link)
  }
  drain(sim, s)
  if (n === 0 && d.spawns?.on === 'hit') spawnLinked(sim, s, j, '命中后生成')
  // 接续动作（TD-08 P10）：本动作的该判定第一次结算后立刻开始，继承指令出处
  const a = s.chars[j.owner].action
  const f = a?.def.followUp
  if (n === 0 && a && f && a.instance === j.actionInstance && f.after === d.name) startAction(s, sim.k, j.owner, m.actions[f.action]!, a.cmd)
}

/** 判定的 spawns（备注"命中后立即生成X""持续帧结束后生成X"）：在同一动作实例里生成那些事件判定，跟着来源判定脱不脱手 */
function spawnLinked(sim: Sim, s: SimState, j: JudgmentRuntime, why: string): void {
  const a = sim.r.team[j.owner]!.actions[j.action]
  for (const name of j.def.spawns!.judgments) {
    const def = a?.judgments.find(x => x.name === name)
    if (def) spawnJudgment(s, j.owner, j.action, j.actionInstance, def, j.detached, `${j.def.name} ${why}`)
  }
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
    rules: sim.r.rules,
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
    addResource: (resource, amount, slot = self, note) => { grant(sim, s, slot, resource, amount, 'hook', false, note) },
    spawnJudgment: (name, opts = {}) => {
      const hit = findJudgment(name, opts.action)
      if (!hit) throw new Error(`${m.def.name} 的钩子要生成的判定"${name}"不存在`)
      const running = s.chars[self].action
      const j = spawnJudgment(s, self, hit.action.id, running?.id === hit.action.id ? running.instance : s.nextId++, hit.j, undefined, opts.note)
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
    get vars() { return s.chars[self].vars },
    heal: source => { log(s, { type: 'heal', char: m.def.name, source }) },
    stat: name => { assume(s, 'stat-scaling-static', `${m.def.name} 的钩子读 ${name}`); return m.stats[name] },
    shield: (source, target = self) => { log(s, { type: 'shield', char: sim.r.team[target].def.name, by: m.def.name, source }) },
    applyEffect: (effect, stacks, note) => applyEffect(sim, s, self, effect, stacks, note ?? `${m.def.name} 的钩子`),
    applyShift: (kind, frames, note) => applyShift(s, self, kind, frames, note ?? `${m.def.name} 的钩子`),
    effectDamage: (effect, scale, judgment) => effectDamage(sim, s, self, effect, scale, judgment),
    takeBurst: (effect, note) => takeBurst(s, self, effect, note ?? `${m.def.name} 的钩子`),
    warn: message => log(s, { type: 'warning', code: 'hook', message: `${m.def.name}：${message}` }),
    assume: (id, detail) => assume(s, id, detail),
  }
}
