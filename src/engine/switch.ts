// src/engine/switch.ts —— TD-05：切人之后的事
// 普通切人与变奏切人（§2）、延奏触发与协奏清零（§4.2）、延奏动作的独立时间线（§4.3）、"第nF后切人结束技能"（§5）。
// 切人的调度条件（切人冷却、切人锁）归 TD-09；这里在调度器换完前台、启动切人冷却之后接手。
import type { Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import { applyPendingNextIn, clearOnSwitchOut } from './buffs'
import type { Sim } from './context'
import { cancelAction, log, startAction, timelineOf, type EventSource } from './kernel'
import { castResources } from './resources'
import { drain } from './triggers'
import type { CommandRef, ResolvedMember, SimState, TailRuntime } from './types'

/** 变奏动作：别名 QTE 指向的动作；没有别名时取 id 为 QTE、kind = intro 的动作（§2.1） */
export function introOf(m: ResolvedMember): ActionDef | undefined {
  const id = m.aliases.QTE
  if (id !== undefined) return m.actions[id]
  const d = m.actions.QTE
  return d?.kind === 'intro' ? d : undefined
}

/** 延奏动作：别名"延奏"指向的动作；没有别名时取 id 为"延奏"、kind = outro 的动作；都没有 = 延奏只有 buff 效果（§4.3） */
export function outroOf(m: ResolvedMember): ActionDef | undefined {
  const id = m.aliases['延奏']
  if (id !== undefined) return m.actions[id]
  const d = m.actions['延奏']
  return d?.kind === 'outro' ? d : undefined
}

/** TD-09 的 onSwitch（§2）：记 switch → 切出者的 switchOut（清除 buff、切人结束技能）→ 切入者的 switchIn（挂起的 nextIn）
 *  → 变奏时开始变奏动作（其后发施放资源）→ intro。switchOut / switchIn 的触发由 switch 事件派生（TD-07 §4.1） */
export function onSwitch(sim: Sim, s: SimState, from: Slot, to: Slot, cmd: CommandRef): void {
  const introDef = introOf(sim.r.team[to])
  const full = s.chars[from].concerto >= sim.r.rules.concertoMax
  const intro = full && introDef !== undefined
  log(s, { type: 'switch', from: s.chars[from].name, to: s.chars[to].name, intro, cmd })
  if (full && !introDef) {
    log(s, { type: 'warning', code: 'noIntro', message: `${s.chars[to].name} 没有变奏动作（别名 QTE），按普通切人处理，${s.chars[from].name} 的协奏不清零` })
  }
  // ① 切出者
  clearOnSwitchOut(s, sim.book, from)
  const a = s.chars[from].action
  if (a && a.def.endOnSwitchOut !== undefined && a.localFrame >= a.def.endOnSwitchOut) cancelAction(s, sim.k, from, '切人')
  // ② 切入者：变奏动作不走合法性检查，取消切入者在后台的动作（TD-04 §4.2）；actionStart 带切人指令的出处（统计窗口按它算）
  applyPendingNextIn(s, sim.book, to)
  if (intro) {
    const ia = startAction(s, sim.k, to, introDef, cmd)
    s.outroLinks.push({ introInstance: ia.instance, from })
    log(s, { type: 'intro', char: s.chars[to].name, action: introDef.id })
  }
  drain(sim, s)
}

/** TD-04 的 hooks.outroTrigger（§4.2）：变奏动作（或它的尾部）走到 outroTriggerFrame。
 *  切出者协奏清零 → outro 事件（延奏 buff 在这里挂上，钩子可挑延奏动作的判定版本）→ 延奏动作以独立时间线开始，发施放资源 */
export function outroTrigger(sim: Sim, s: SimState, slot: Slot, src: EventSource): void {
  const i = s.outroLinks.findIndex(l => l.introInstance === src.instance)
  if (i < 0) return                                               // 不是变奏切人开始的（测试台直接开始变奏动作）
  const { from } = s.outroLinks[i]!
  s.outroLinks.splice(i, 1)
  const c = s.chars[from]
  if (c.concerto !== 0) {
    const before = c.concerto
    c.concerto = 0                                                // 清零是"设为 0"，不是"减 100"
    log(s, { type: 'resource', char: c.name, resource: 'concerto', delta: -before, value: 0, cause: 'outro' })
  }
  const def = outroOf(sim.r.team[from])
  let tail: TailRuntime | undefined
  if (def) {
    // 持续帧 -1 的判定"直到动作结束"：延奏动作不是进行中的动作，它们不存在（同 TD-04 §4.3 自然结束的规则）
    const events = timelineOf(def).filter(e => e.kind !== 'outro' && !(e.kind === 'spawn' && def.judgments[e.index]!.lifeFrames === -1))
    tail = { owner: from, action: def.id, def, instance: s.nextId++, localFrame: 0, events, detached: true }
    s.tails.push(tail)
  }
  log(s, { type: 'outro', char: c.name, to: s.chars[slot].name, ...(tail ? { instance: tail.instance } : {}) })
  drain(sim, s)
  if (tail) {
    castResources(sim, s, from, tail)
    drain(sim, s)
  }
}
