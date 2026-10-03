// src/engine/triggers.ts —— TD-07 §4、§5、§6：事件队列与触发
// 引擎记下的每条事件都排进本 tick 的队列（日志本身就是队列），逐条处理：① 消耗 → ② buff 触发 → ③ 资源型效果 → ④ 角色钩子 onEvent。
// 处理中产生的新事件排到队尾，同一 tick 内处理完；一条事件引出的事件链超过 rules.maxChainDepth 层报错。
import type { ActionId, ActionKind, DamageTag, Element, ResourceKind, Slot } from '../data/common'
import type { BuffDef, TriggerFilter, TriggerSpec } from '../data/buff.schema'
import { applyTriggered, bookKey, removeBuff } from './buffs'
import type { Sim } from './context'
import { log } from './kernel'
import { grant } from './resources'
import { ScheduleError } from './scheduler'
import type { SimEvent, SimState } from './types'

/** 一条日志事件对应的触发点（§4.1）。switch 一条对应 switchOut、switchIn 两个 */
interface Occurrence {
  on: TriggerSpec['on']
  by: Slot                                  // 发出者
  action?: ActionId
  kind?: ActionKind
  judgment?: string
  tags?: readonly DamageTag[]
  element?: Element
  resource?: ResourceKind
  to?: Slot                                 // outro：这次变奏的角色（nextIn 的去处）
}

/** 处理队列里所有还没处理的事件。可重入：处理中再调用直接返回，新事件由外层循环接着处理 */
export function drain(sim: Sim, s: SimState): void {
  const bus = sim.bus
  if (bus.draining) return
  bus.draining = true
  try {
    while (bus.cursor < s.log.length) {
      const i = bus.cursor++
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
      handle(sim, s, s.log[i]!)
      bus.current = null
      for (let x = before; x < s.log.length; x++) bus.chain.set(x, { depth: link.depth + 1, root: link.root })
    }
  } finally {
    bus.draining = false
    bus.current = null
  }
}

function describe(e: SimEvent): string {
  switch (e.type) {
    case 'hit': return ` ${e.char} ${e.judgment} 的结算`
    case 'actionStart': return ` ${e.char} 开始 ${e.action}`
    case 'resource': return ` ${e.char} ${e.resource} ${e.delta > 0 ? '+' : ''}${e.delta}（${e.cause}）`
    case 'buffApply': return ` ${e.buff} 施加到 ${e.target}`
    default: return ` ${e.type} 事件`
  }
}

/** 一条事件：① 消耗 → ② buff 触发 → ③ 资源型效果 → ④ 钩子（§5）。登记顺序即槽位 0 → 2、然后 env；同一角色内角色模块、武器、套装 */
function handle(sim: Sim, s: SimState, ev: SimEvent): void {
  const occs = occurrencesOf(sim, ev)
  if (occs.length > 0) {
    consume(sim, s, occs)
    for (const reg of sim.r.buffs) {
      if (typeof reg.def.trigger === 'string') continue      // 常驻、只由钩子施加的不看事件
      const occ = firing(s, reg.def.trigger, reg.owner, reg.def.id, reg.def.icd, occs)
      if (occ) applyTriggered(s, reg, occ.on === 'outro' ? occ.to : undefined)
    }
    for (const e of sim.r.effects) {                  // 已按共鸣链过滤、按谐振阶取值（resolve）
      const occ = firing(s, e.def.trigger, e.owner, e.def.id, e.def.icd, occs)
      if (!occ) continue
      for (const t of effectTargets(e.def.target, e.owner, s)) grant(sim, s, t, e.def.resource, e.amount, e.def.id, e.def.scaledByRegen)
    }
  }
  for (const m of sim.r.team) m.def.hooks?.onEvent?.(sim.ctxs[m.slot]!, ev)
}

function occurrencesOf(sim: Sim, ev: SimEvent): Occurrence[] {
  const slot = (name: string): Slot => sim.slotOf.get(name)!
  switch (ev.type) {
    case 'actionStart': {
      const by = slot(ev.char)
      const kind = sim.r.team[by].actions[ev.action]?.kind
      return [{ on: 'actionStart', by, action: ev.action, ...(kind ? { kind } : {}) }]
    }
    case 'hit':
      return [{ on: 'judgmentSettle', by: slot(ev.char), action: ev.action, judgment: ev.judgment, tags: ev.tags, element: ev.element }]
    case 'intro': return [{ on: 'intro', by: slot(ev.char), action: ev.action }]
    case 'outro': return [{ on: 'outro', by: slot(ev.char), to: slot(ev.to) }]
    case 'switch': return [{ on: 'switchOut', by: slot(ev.from) }, { on: 'switchIn', by: slot(ev.to) }]
    case 'resourceFull': return [{ on: 'resourceFull', by: slot(ev.char), resource: ev.resource }]
    default: return []                      // enemyState 在 M4（TD-06 v0.2）
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
    && where.enemyState === undefined && where.effect === undefined   // 敌人状态类在 M4
}

/** 这条定义被这批触发点中的哪一个触发（数组写法任一满足即可，一条事件只触发一次）；内置冷却按（持有者, 定义）记在 lastTrigger（§4.4） */
function firing(
  s: SimState, trigger: BuffDef['trigger'], owner: Slot | 'env', id: string, icd: number | undefined, occs: Occurrence[],
): Occurrence | undefined {
  if (typeof trigger === 'string') return undefined
  const specs = Array.isArray(trigger) ? trigger : [trigger]
  const occ = occs.find(o => specs.some(sp => matches(s, sp.on, sp.where, owner, o)))
  if (!occ || icd === undefined) return occ
  const key = `${owner}|${id}`
  const last = s.lastTrigger[key]
  if (last !== undefined && s.battleFrames - last < icd) return undefined
  s.lastTrigger[key] = s.battleFrames
  return occ
}

/** 消耗型"下次 X…"（§6）：先于触发处理。相关实例 = 挂在事件发出者身上的、挂在敌人身上的 */
function consume(sim: Sim, s: SimState, occs: Occurrence[]): void {
  for (const b of [...s.buffs]) {
    const c = sim.book.get(bookKey(b.owner, b.defId))?.def.consume
    if (!c) continue
    if (!occs.some(o => (b.target === o.by || b.target === 'enemy') && matches(s, c.on, c.where, b.owner, o))) continue
    if (c.stacks === 'all' || b.stacks <= c.stacks) removeBuff(s, b, 'removed')
    else {
      b.stacks -= c.stacks                   // 只消耗几层：记一条 buffApply 说明现在的层数
      log(s, { type: 'buffApply', buff: b.defId, target: b.target === 'enemy' ? 'enemy' : s.chars[b.target].name, stacks: b.stacks, remaining: b.remaining })
    }
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
