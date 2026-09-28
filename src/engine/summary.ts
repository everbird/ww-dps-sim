// src/engine/summary.ts —— 从事件日志汇总（总设计 §3.5、第 9 节）。所有数字都由日志派生，不在别处重算。
// DPS 口径：窗口 = 第 0 帧到"最后一条指令对应动作的结束帧"（options.endAt 可覆盖），按战斗时钟计；
// 窗口外仍在结算的伤害单列为溢出伤害，不计入 DPS。资源曲线、buff 覆盖率、分轮统计在 M3 / M5（TD-10）补上。
import type { CharName } from '../data/common'
import type { HitEvent, ResolvedScenario, SimEvent, SimState, Summary, WaitCode } from './types'

const INTENDED: WaitCode[] = ['delay', 'wait', 'at']
/** 事件的战斗帧（t 是战斗秒数） */
export const battleFrameOf = (e: SimEvent): number => Math.round(e.t * 60)

/** 统计窗口的终点（战斗帧）：最后一条指令——出招看它开始的动作何时结束或被取消，切人看切人那一刻，wait 看等完那一刻 */
export function windowEnd(log: readonly SimEvent[], s: SimState, endAt?: number): number {
  if (endAt !== undefined) return endAt
  let end = 0
  let lastAct: Extract<SimEvent, { type: 'actionStart' }> | null = null
  for (const e of log) {
    if (e.type === 'actionStart' && e.cmd) lastAct = e
    else if (e.type === 'switch' && e.cmd) end = Math.max(end, battleFrameOf(e))
    else if (e.type === 'wait' && e.code === 'wait') end = Math.max(end, battleFrameOf(e))
  }
  if (lastAct) {
    const done = log.find(e => (e.type === 'actionEnd' || e.type === 'actionCancel') && e.instance === lastAct!.instance)
    end = Math.max(end, done ? battleFrameOf(done) : s.battleFrames)
  }
  return end
}

export function summarize(log: readonly SimEvent[], r: ResolvedScenario, s: SimState): Summary {
  const windowFrames = windowEnd(log, s, r.options.endAt)
  const hits = log.filter((e): e is HitEvent => e.type === 'hit' && e.dmg !== null)
  let totalDamage = 0
  let overflowDamage = 0
  const byChar: Record<CharName, { damage: number; share: number }> = {}
  for (const m of r.team) byChar[m.def.name] = { damage: 0, share: 0 }
  const byAction = new Map<string, { char: CharName; action: string; damage: number; hits: number; share: number }>()
  for (const h of hits) {
    const v = h.dmg!.expected
    if (battleFrameOf(h) >= windowFrames) { overflowDamage += v; continue }
    totalDamage += v
    byChar[h.char]!.damage += v
    const key = `${h.char}|${h.action}`
    const a = byAction.get(key) ?? { char: h.char, action: h.action, damage: 0, hits: 0, share: 0 }
    a.damage += v
    a.hits += 1
    byAction.set(key, a)
  }
  const share = (x: number) => (totalDamage > 0 ? x / totalDamage : 0)
  for (const c of Object.values(byChar)) c.share = share(c.damage)
  const actions = [...byAction.values()].sort((a, b) => b.damage - a.damage)
  for (const a of actions) a.share = share(a.damage)
  return {
    totalDamage, windowFrames, dps: windowFrames > 0 ? totalDamage / (windowFrames / 60) : 0, overflowDamage,
    byChar, byAction: actions,
    resourceTimeline: [], buffUptime: {},
    waits: log.flatMap(e => (e.type === 'wait' && !INTENDED.includes(e.code)
      ? [{ line: e.cmd.line, item: e.cmd.item, loop: e.cmd.loop, code: e.code, frames: e.frames, reason: e.reason }] : [])),
    warnings: [
      ...r.warnings.map(message => ({ code: 'resolve', message })),
      ...log.flatMap(e => (e.type === 'warning' ? [{ code: e.code, message: e.message, ...(e.line !== undefined ? { line: e.line } : {}) }] : [])),
    ],
  }
}
