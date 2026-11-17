// src/engine/triggers.ts —— TD-07 §4、§5、§6：事件队列与触发
// 引擎记下的每条事件都排进本 tick 的队列（日志本身就是队列），逐条处理：① 消耗 → ② buff 触发 → ③ 资源型效果 → ④ 角色钩子 onEvent。
// 处理中产生的新事件排到队尾，同一 tick 内处理完；一条事件引出的事件链超过 rules.maxChainDepth 层报错。
import type { Slot } from '../data/common'
import type { BuffDef, TriggerFilter, TriggerSpec } from '../data/buff.schema'
import { applyTriggered, bookKey, extendBuff, ownerName, removeBuff } from './buffs'
import type { Sim } from './context'
import { log } from './kernel'
import { explainExtend, explainFiring, groupsWouldFire, type Occurrence, type TriggerTarget } from './probe'
import { grant } from './resources'
import { ScheduleError } from './types'
import type { SimEvent, SimState } from './types'

/** 处理队列里所有还没处理的事件。可重入：处理中再调用直接返回，新事件由外层循环接着处理 */
export function drain(sim: Sim, s: SimState): void {
  const bus = sim.bus
  if (bus.draining) return
  bus.draining = true
  try {
    while (bus.cursor < s.log.length) {
      const i = bus.cursor++
      bus.inFlight = i                                 // 在连锁深度检查之前写：chainDepth 也算"处理这条时出错"（DD-01 §3.5）
      const link = bus.chain.get(i) ?? { depth: 0, root: i }
      bus.chain.delete(i)
      if (link.depth > sim.r.rules.maxChainDepth) {
        const root = s.log[link.root]!
        throw new ScheduleError(
          'chainDepth',
          `事件连锁超过 ${sim.r.rules.maxChainDepth} 层（rules.maxChainDepth）：起点是第 ${root.f} 帧的${describe(root)}，多半是钩子或触发互相引发`,
          null, s.frame,
        )
      }
      const before = s.log.length
      bus.current = link
      sim.k.diag?.eventRoot(i, link.root)
      handle(sim, s, s.log[i]!, i)
      bus.current = null
      for (let x = before; x < s.log.length; x++) bus.chain.set(x, { depth: link.depth + 1, root: link.root })
      bus.inFlight = null                              // 只在正常处理完后清
    }
  } finally {
    bus.draining = false
    bus.current = null                                 // inFlight 不在这里清：抛错时要留着
  }
}

function describe(e: SimEvent): string {
  switch (e.type) {
    case 'hit': return ` ${e.char} ${e.judgment} 的结算`
    case 'actionStart': return ` ${e.char} 开始 ${e.action}`
    case 'resource': return ` ${e.char} ${e.resource} ${e.delta > 0 ? '+' : ''}${e.delta}（${e.cause}）`
    case 'buffApply': return ` ${e.buff} 施加到 ${e.target}`
    case 'heal': return ` ${e.char} 的治疗（${e.source}）`
    case 'shield': return ` ${e.char} 获得护盾（${e.by}：${e.source}）`
    default: return ` ${e.type} 事件`
  }
}

/** 一条事件：① 消耗 → ② buff 触发 → ③ 资源型效果 → ④ 钩子（§5）。登记顺序即槽位 0 → 2、然后 env；同一角色内角色模块、武器、套装。
 *  seq：这条事件的日志下标。每个处理器的一次执行各是一个 trigger 作用域，写出的事件的直接父事件就是它（DD-05 §3.2） */
function handle(sim: Sim, s: SimState, ev: SimEvent, seq: number): void {
  const k = sim.k
  const tc = k.diag?.opts.triggerChecks
  const recorded = tc?.length ? new Set<number>() : null
  const matchIdx = (kind: TriggerTarget['kind'], owner: Slot | 'env', id: string): number =>
    tc ? tc.findIndex((t, idx) => !recorded!.has(idx) && t.kind === kind && t.owner === owner && t.id === id) : -1
  const occs = occurrencesOf(sim, ev)
  if (occs.length === 0 && tc?.length) {
    tc.forEach((t, idx) => {
      if (t.kind !== 'charHook') {
        recorded!.add(idx)
        k.diag!.triggerCheck({ eventSeq: seq, target: t, outcome: 'notEntered', notEnteredReason: 'noOccurrence', groups: [] })
      }
    })
  }
  if (occs.length > 0) {
    consume(sim, s, occs, seq, tc, recorded ?? undefined)
    for (const reg of sim.r.buffs) {
      const idx = matchIdx('buff', reg.owner, reg.def.id)
      if (typeof reg.def.trigger === 'string') {
        if (idx >= 0) {
          recorded!.add(idx)
          k.diag!.triggerCheck({
            eventSeq: seq, target: tc![idx]!, outcome: 'checkedNotFired',
            groups: explainFiring(s, reg.def.trigger, reg.owner, reg.def.id, reg.def.icd, occs),
          })
        }
        continue      // 常驻、只由钩子施加的不看事件
      }
      const groups = idx >= 0 ? explainFiring(s, reg.def.trigger, reg.owner, reg.def.id, reg.def.icd, occs) : undefined
      const occ = firing(s, reg.def.trigger, reg.owner, reg.def.id, reg.def.icd, occs)
      if (!occ) {
        if (idx >= 0) {
          recorded!.add(idx)
          k.diag!.triggerCheck({ eventSeq: seq, target: tc![idx]!, outcome: 'checkedNotFired', groups: groups! })
        }
        continue
      }
      const sc = k.diag?.open({ kind: 'trigger', directParentSeq: seq, handlerKind: 'buffTrigger', handlerId: reg.def.id }, s.log.length)
      const beforeLog = s.log.length
      applyTriggered(s, reg, occ.on === 'outro' ? occ.to : undefined, occ.stacks, occ.by)
      if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
      if (idx >= 0) {
        recorded!.add(idx)
        const afterFiring = s.log.length === beforeLog
          ? (reg.def.target === 'nextIn' && occ.on !== 'outro' ? 'nextIn 挂起到下一次切入' : '未产生可见 buffApply')
          : undefined
        k.diag!.triggerCheck({
          eventSeq: seq, target: tc![idx]!, outcome: 'fired', groups: groups!,
          ...(afterFiring ? { afterFiring } : {}),
        })
      }
    }
    for (const reg of sim.r.buffs) {                  // 延长（BuffDef.extend）：在施加之后看，同一事件刚施加的实例也能被延长
      const idx = matchIdx('buffExtend', reg.owner, reg.def.id)
      const ext = reg.def.extend
      if (!ext) {
        if (idx >= 0) {
          recorded!.add(idx)
          k.diag!.triggerCheck({
            eventSeq: seq, target: tc![idx]!, outcome: 'checkedNotFired',
            groups: [{ occurrence: occs[0]!.on, spec: 0, conditions: [{ id: 'extend', status: 'unmet', expected: '存在 extend 规则', actual: '该 buff 不支持延长' }] }],
          })
        }
        continue
      }
      if (!s.buffs.some(b => b.defId === reg.def.id && b.owner === reg.owner)) {
        if (idx >= 0) {
          recorded!.add(idx)
          k.diag!.triggerCheck({ eventSeq: seq, target: tc![idx]!, outcome: 'notEntered', notEnteredReason: 'noInstance', groups: [] })
        }
        continue
      }
      const extExplain = idx >= 0 ? explainExtend(s, reg.def, reg.owner, occs) : undefined
      const occ = firing(s, ext.trigger, reg.owner, `${reg.def.id}#extend`, undefined, occs)
      if (!occ) {
        if (idx >= 0) {
          recorded!.add(idx)
          k.diag!.triggerCheck({ eventSeq: seq, target: tc![idx]!, outcome: 'checkedNotFired', groups: extExplain!.groups })
        }
        continue
      }
      const sc = k.diag?.open({ kind: 'trigger', directParentSeq: seq, handlerKind: 'buffExtend', handlerId: reg.def.id }, s.log.length)
      const extended = extendBuff(s, reg)
      if (extended) {
        for (const id of ext.grants ?? []) {
          const g = sim.book.get(bookKey(reg.owner, id))
          if (g) applyTriggered(s, g, undefined, g.def.stackGain, occ.by)
        }
      }
      if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
      if (idx >= 0) {
        recorded!.add(idx)
        k.diag!.triggerCheck({
          eventSeq: seq, target: tc![idx]!, outcome: extended ? 'fired' : 'checkedNotFired', groups: extExplain!.groups,
          ...(!extended ? { afterFiring: '已达延长次数上限或无限时长' } : {}),
        })
      }
    }
    for (const e of sim.r.effects) {                  // 已按共鸣链过滤、按谐振阶取值（resolve）
      const idx = matchIdx('resourceEffect', e.owner, e.def.id)
      const groups = idx >= 0 ? explainFiring(s, e.def.trigger, e.owner, e.def.id, e.def.icd, occs) : undefined
      const occ = firing(s, e.def.trigger, e.owner, e.def.id, e.def.icd, occs)
      if (!occ) {
        if (idx >= 0) {
          recorded!.add(idx)
          k.diag!.triggerCheck({ eventSeq: seq, target: tc![idx]!, outcome: 'checkedNotFired', groups: groups! })
        }
        continue
      }
      const sc = k.diag?.open({ kind: 'trigger', directParentSeq: seq, handlerKind: 'resourceEffect', handlerId: e.def.id }, s.log.length)
      const beforeLog = s.log.length
      for (const t of effectTargets(e.def.target, e.owner, s)) grant(sim, s, t, e.def.resource, e.amount, e.def.id, e.def.scaledByRegen)
      if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
      if (idx >= 0) {
        recorded!.add(idx)
        const afterFiring = s.log.length === beforeLog ? '资源已满或变化量为 0（未写业务事件）' : undefined
        k.diag!.triggerCheck({
          eventSeq: seq, target: tc![idx]!, outcome: 'fired', groups: groups!,
          ...(afterFiring ? { afterFiring } : {}),
        })
      }
    }
  }
  for (const m of sim.r.team) {
    const idx = matchIdx('charHook', m.slot, m.def.name)
    if (idx >= 0) {
      recorded!.add(idx)
      k.diag!.triggerCheck({ eventSeq: seq, target: tc![idx]!, outcome: 'unsupported', groups: [] })
    }
    const hooks = sim.hooks[m.slot]
    if (!hooks?.onEvent) continue
    const sc = k.diag?.open({ kind: 'trigger', directParentSeq: seq, handlerKind: 'charHook', handlerId: m.def.name }, s.log.length)
    hooks.onEvent(sim.ctxs[m.slot]!, ev)
    if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
  }
  if (tc?.length) {
    tc.forEach((t, idx) => {
      if (recorded!.has(idx)) return
      k.diag!.triggerCheck({ eventSeq: seq, target: t, outcome: 'notEntered', notEnteredReason: 'noInstance', groups: [] })
    })
  }
}

export function occurrencesOf(sim: Sim, ev: SimEvent, noteRules = true): Occurrence[] {
  const slot = (name: string): Slot => sim.slotOf.get(name)!
  switch (ev.type) {
    case 'actionStart': {
      const by = slot(ev.char)
      const kind = sim.r.team[by].actions[ev.action]?.kind
      return [{ on: 'actionStart', by, action: ev.action, ...(kind ? { kind } : {}) }]
    }
    case 'hit':                                     // 异常效应自身的伤害不是判定结算，不触发"命中时"（TD-06 §18）
      return ev.effect ? [] : [{ on: 'judgmentSettle', by: slot(ev.char), action: ev.action, judgment: ev.judgment, tags: ev.tags, element: ev.element }]
    case 'heal': return [{ on: 'heal', by: slot(ev.char) }]
    case 'shield': return [{ on: 'shield', by: slot(ev.char) }]       // by = 获得护盾的人
    case 'intro': return [{ on: 'intro', by: slot(ev.char), action: ev.action }]
    case 'outro': return [{ on: 'outro', by: slot(ev.char), to: slot(ev.to) }]
    case 'switch': return [{ on: 'switchOut', by: slot(ev.from) }, { on: 'switchIn', by: slot(ev.to) }]
    case 'resourceFull': return [{ on: 'resourceFull', by: slot(ev.char), resource: ev.resource }]
    // 敌人状态：记了发出者的才能触发（附加异常效应，TD-06 §18）；破盾、失谐等还没记谁造成的
    // 阵、召唤物附加的不算"角色附加"时（rules.summonCountsAsChar = false，假设 summon-as-char）不触发
    case 'enemyState':
      // 规则使用（DD-05 §4.1）：事件带 summon 时才读；记了附加者的，换个读法就触发 / 不触发"附加…后"
      if (ev.summon && noteRules) sim.k.rule.note('triggers.summonAsChar', sim.r.rules.summonCountsAsChar, ev.by !== undefined)
      if (ev.summon && !sim.r.rules.summonCountsAsChar) return []
      return ev.by !== undefined ? [{ on: 'enemyState', by: slot(ev.by), enemyState: ev.change, ...(ev.effect ? { effect: ev.effect } : {}) }] : []
    default: return []
  }
}

/** 触发条件是否满足（§4.1、§4.2）：where 各字段之间是"且"，同一字段的多个值是"或"；对这种事件没有意义的字段不满足 */
function matches(s: SimState, on: TriggerSpec['on'], where: TriggerFilter | undefined, owner: Slot | 'env', o: Occurrence): boolean {
  if (on !== o.on) return false
  const by = where?.by ?? 'self'
  if (by === 'self' && owner !== 'env' && o.by !== owner) return false
  if (by === 'onField' && o.by !== s.onField) return false
  if (!where) return true
  const any = <T>(want: readonly T[] | undefined, have: readonly T[] | undefined): boolean =>
    want === undefined || (have !== undefined && have.some(h => want.includes(h)))
  return any(where.actionKinds, o.kind ? [o.kind] : undefined)
    && any(where.actions, o.action !== undefined ? [o.action] : undefined)
    && any(where.judgments, o.judgment !== undefined ? [o.judgment] : undefined)
    && any(where.tags, o.tags)
    && any(where.elements, o.element ? [o.element] : undefined)
    && (where.resource === undefined || where.resource === o.resource)
    && (where.ownerHas === undefined || (owner !== 'env' && s.buffs.some(b => b.defId === where.ownerHas && b.owner === owner && b.target === owner)))
    && (where.enemyState === undefined || where.enemyState === o.enemyState)
    && (where.effect === undefined || where.effect === o.effect)
    && (where.afterBattle === undefined || s.battleFrames >= where.afterBattle)
}

/** 这条定义被这批触发点中的哪一个触发（数组写法任一满足即可，一条事件只触发一次）；内置冷却按（持有者, 定义）记在 lastTrigger（§4.4） */
function firing(
  s: SimState, trigger: BuffDef['trigger'], owner: Slot | 'env', id: string, icd: number | undefined, occs: Occurrence[],
): (Occurrence & { stacks?: number }) | undefined {
  if (typeof trigger === 'string') return undefined
  const specs = Array.isArray(trigger) ? trigger : [trigger]
  let spec: TriggerSpec | undefined
  const found = occs.find(o => (spec = specs.find(sp => matches(s, sp.on, sp.where, owner, o))) !== undefined)
  const occ = found && spec?.stacks !== undefined ? { ...found, stacks: spec.stacks } : found
  if (!occ || icd === undefined) return occ
  const key = `${owner}|${id}`
  const last = s.lastTrigger[key]
  if (last !== undefined && s.battleFrames - last < icd) return undefined
  s.lastTrigger[key] = s.battleFrames
  return occ
}

/** 消耗型"下次 X…"（§6）：先于触发处理。相关实例 = 挂在事件发出者身上的、挂在敌人身上的。每个被消耗的实例一个作用域（DD-05 §3.2） */
function consume(
  sim: Sim, s: SimState, occs: Occurrence[], seq: number,
  tc?: readonly TriggerTarget[], recorded?: Set<number>,
): void {
  const k = sim.k
  const seenInstance = tc && recorded ? new Set<number>() : null
  for (const b of [...s.buffs]) {
    const c = sim.book.get(bookKey(b.owner, b.defId))?.def.consume
    if (tc && recorded && seenInstance) {
      tc.forEach((t, idx) => {
        if (recorded.has(idx) || t.kind !== 'consume' || t.owner !== b.owner || t.id !== b.defId) return
        seenInstance.add(idx)
        if (!c) {
          recorded.add(idx)
          k.diag!.triggerCheck({
            eventSeq: seq, target: t, outcome: 'checkedNotFired',
            groups: [{ occurrence: occs[0]!.on, spec: 0, conditions: [{ id: 'consume', status: 'unmet', expected: '存在 consume 规则', actual: '该 buff 不是消耗型' }] }],
          })
          return
        }
        const matchedOccs = occs.filter(o => b.target === o.by || b.target === 'enemy')
        if (matchedOccs.length === 0) return
        recorded.add(idx)
        const groups = explainFiring(s, { on: c.on, ...(c.where ? { where: c.where } : {}) }, b.owner, b.defId, undefined, matchedOccs)
        k.diag!.triggerCheck({ eventSeq: seq, target: t, outcome: groupsWouldFire(groups) ? 'fired' : 'checkedNotFired', groups })
      })
    }
    if (!c) continue
    if (!occs.some(o => (b.target === o.by || b.target === 'enemy') && matches(s, c.on, c.where, b.owner, o))) continue
    const sc = k.diag?.open({ kind: 'trigger', directParentSeq: seq, handlerKind: 'consume', handlerId: b.defId }, s.log.length)
    if (c.stacks === 'all' || b.stacks <= c.stacks) removeBuff(s, b, 'removed')
    else {
      b.stacks -= c.stacks                   // 只消耗几层：记一条 buffApply 说明现在的层数
      log(s, { type: 'buffApply', buff: b.defId, owner: ownerName(s, b.owner), target: b.target === 'enemy' ? 'enemy' : s.chars[b.target].name, instanceId: b.id, stacks: b.stacks, remaining: b.remaining })
    }
    if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
  }
  if (tc && recorded && seenInstance) {
    tc.forEach((t, idx) => {
      if (recorded.has(idx) || t.kind !== 'consume') return
      recorded.add(idx)
      k.diag!.triggerCheck({
        eventSeq: seq, target: t, outcome: 'notEntered',
        notEnteredReason: seenInstance.has(idx) ? 'targetMismatch' : 'noInstance', groups: [],
      })
    })
  }
}

function effectTargets(target: 'self' | 'team' | 'teamExceptSelf' | 'onField', owner: Slot, s: SimState): Slot[] {
  const all: Slot[] = [0, 1, 2]
  switch (target) {
    case 'self': return [owner]
    case 'team': return all
    case 'teamExceptSelf': return all.filter(x => x !== owner)
    case 'onField': return [s.onField]
  }
}
