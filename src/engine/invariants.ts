// src/engine/invariants.ts —— 不变量检查（总设计 §11 第 4 条，开发模式常开）
// 每个 tick 结束、每次结算各查一次；不成立就是引擎的错，报 SimResult.error（code 'invariant'），指出第几帧、哪一项。
import type { Sim } from './context'
import { ScheduleError } from './scheduler'
import type { HitEvent, ResolvedScenario, SimResult, SimState } from './types'

/** 1e-6 的余量：资源值取整到 1e-9，比较时不因浮点误差误报 */
const EPS = 1e-6
function bad(s: SimState, what: string): ScheduleError {
  return new ScheduleError('invariant', `不变量不成立（第 ${s.frame} 帧）：${what}`, null, s.frame)
}
function ok(v: number, lo: number, hi: number): boolean {
  return Number.isFinite(v) && v >= lo - EPS && v <= hi + EPS
}

/** tick 结束（P6 之后）：资源在 [0, 上限]、计时器不为负、战斗时钟不倒退。lastBattle = 上一次检查时的战斗帧 */
export function checkTick(sim: Sim, s: SimState, lastBattle: number): void {
  if (s.battleFrames < lastBattle) throw bad(s, `战斗时钟倒退：${lastBattle} → ${s.battleFrames}`)
  // 每个 tick 都跑：不建闭包、不用 Object.entries，免得这一步本身成了开销
  for (const c of s.chars) {
    const def = sim.r.team[c.slot].def
    if (!ok(c.energy, 0, def.energyCost)) throw bad(s, `${c.name} 的大招能量 ${c.energy} 不在 [0, ${def.energyCost}]`)
    if (!ok(c.concerto, 0, sim.r.rules.concertoMax)) throw bad(s, `${c.name} 的协奏 ${c.concerto} 不在 [0, ${sim.r.rules.concertoMax}]`)
    for (let i = 0; i < c.core.length; i++) {
      const v = c.core[i]!
      if (v === 0) continue
      let cap = Infinity
      for (const x of def.coreResources) if (x.slot === i + 1) cap = x.cap
      if (!ok(v, 0, cap)) throw bad(s, `${c.name} 的核心资源 ${i + 1} 为 ${v}，不在 [0, ${cap}]`)
    }
    for (const k in c.cooldowns) if (!(c.cooldowns[k]! >= 0)) throw bad(s, `${c.name} 的冷却 ${k} 为 ${c.cooldowns[k]}`)
    for (const k in c.charges) if (!(c.charges[k]!.spent >= 0)) throw bad(s, `${c.name} 的充能 ${k} 用掉 ${c.charges[k]!.spent} 次`)
  }
  if (!(s.switchCd >= 0)) throw bad(s, `切人冷却为 ${s.switchCd}`)
  for (const b of s.buffs) {
    if (b.remaining !== 'inf' && !(b.remaining > 0)) throw bad(s, `buff ${b.defId} 的剩余时间 ${b.remaining} 应已移除`)
    if (!(b.stacks >= 1)) throw bad(s, `buff ${b.defId} 的层数 ${b.stacks}`)
  }
  for (const d of s.dilations) if (!(d.remaining > 0)) throw bad(s, `膨胀窗口剩余 ${d.remaining} 应已移除`)
  const e = s.enemy                                               // 敌人量表（TD-06 §13）
  if (!ok(e.tunability, 0, e.preset.tunabilityMax)) throw bad(s, `偏谐值 ${e.tunability} 不在 [0, ${e.preset.tunabilityMax}]`)
  if (e.disharmony && e.tunability < e.preset.tunabilityMax - EPS) throw bad(s, `失谐时偏谐值 ${e.tunability} 未满`)
  if (!ok(e.whiteBar, 0, e.preset.whiteBarTough)) throw bad(s, `白条 ${e.whiteBar} 不在 [0, ${e.preset.whiteBarTough}]`)
}

/** 每次结算：伤害有限且不为负 */
export function checkHit(s: SimState, dmg: HitEvent['dmg'], char: string, judgment: string): void {
  if (!dmg) return
  if (!(dmg.nonCrit >= 0 && dmg.crit >= 0 && dmg.expected >= 0 && Number.isFinite(dmg.crit) && Number.isFinite(dmg.expected)))
    throw bad(s, `${char} ${judgment} 的伤害 ${JSON.stringify(dmg)}`)
}

// ---------------------------------------------------------------------------
// 跑完之后对整份事件日志查一遍（docs/engine-quality-plan.md P1）：tick 里查的是"状态在范围内"，这里查"日志自洽"——
// 有没有改了状态却没记日志、汇总与日志对不上、冷却没好就出招。返回不成立的各条（空 = 都成立），不抛错：
// 由调用方决定是报错（simulate 的 opts.checkLog）还是收集起来（pnpm fuzz）

const LOG_EPS = 1e-4

/** 事件日志与汇总的自洽检查；每条说明带世界帧 */
export function checkLog(r: ResolvedScenario, res: Pick<SimResult, 'log' | 'summary'>): string[] {
  const out: string[] = []
  const say = (f: number, what: string) => { if (out.length < 50) out.push(`第 ${f} 帧：${what}`) }
  const slotOf = new Map(r.team.map(m => [m.def.name, m.slot] as const))
  let lastF = -Infinity, lastT = -Infinity
  const open = new Map<number, { char: string; action: string }>()        // 开始了、还没结束 / 取消的动作实例
  const seen = new Set<number>()
  // 资源：每条 resource 事件的 value 应等于上一条的 value + delta；第一条接开局值
  const value = new Map<string, number>()
  for (const m of r.team) {
    value.set(`${m.def.name}|energy`, r.initial.energy[m.slot])
    value.set(`${m.def.name}|concerto`, r.initial.concerto[m.slot])
    r.initial.core[m.slot].forEach((v, i) => value.set(`${m.def.name}|core${i + 1}`, v))
  }
  let onField = r.team[r.initial.onField].def.name
  const lastUse = new Map<string, number>()                               // 冷却键 → 上次出招的战斗帧（只查不按次数充能的）
  for (const e of res.log) {
    if (e.f < lastF || e.t < lastT - LOG_EPS) say(e.f, `日志倒序：${e.type} 在第 ${lastF} 帧、战斗 ${lastT.toFixed(3)} 秒之后`)
    lastF = e.f; lastT = Math.max(lastT, e.t)
    switch (e.type) {
      case 'actionStart': {
        if (seen.has(e.instance)) say(e.f, `动作实例 ${e.instance}（${e.char} ${e.action}）开始了两次`)
        seen.add(e.instance); open.set(e.instance, { char: e.char, action: e.action })
        const slot = slotOf.get(e.char)
        const def = slot === undefined ? undefined : r.team[slot].actions[e.action]
        if (!def) { say(e.f, `${e.char} 没有动作 ${e.action}`); break }
        if (def.cooldown && !(def.charges !== undefined && def.charges > 1)) {
          const key = `${e.char}|${def.cooldownGroup ?? (def.kind === 'echo' ? 'echo' : def.id)}`
          const bf = e.t * 60, prev = lastUse.get(key)
          if (prev !== undefined && bf - prev < def.cooldown - 1)
            say(e.f, `${e.char} ${e.action} 冷却 ${def.cooldown} 帧，离上次只隔了 ${(bf - prev).toFixed(1)} 战斗帧`)
          lastUse.set(key, bf)
        }
        break
      }
      case 'actionEnd':
      case 'actionCancel': {
        const a = open.get(e.instance)
        if (!a) say(e.f, `${e.type === 'actionEnd' ? '结束' : '取消'}了没开始或已结束的动作实例 ${e.instance}（${e.char} ${e.action}）`)
        else if (a.char !== e.char || a.action !== e.action) say(e.f, `动作实例 ${e.instance} 开始时是 ${a.char} ${a.action}，结束时是 ${e.char} ${e.action}`)
        open.delete(e.instance)
        break
      }
      case 'switch':
        if (e.from !== onField) say(e.f, `切人的 from 是 ${e.from}，前台却是 ${onField}`)
        if (e.from === e.to) say(e.f, `切到自己 ${e.to}`)
        onField = e.to
        break
      case 'resource': {
        const key = `${e.char}|${e.resource}`
        const before = value.get(key) ?? 0
        if (Math.abs(before + e.delta - e.value) > LOG_EPS)
          say(e.f, `${e.char} 的 ${e.resource}：上一条记到 ${before}，这次 ${e.delta >= 0 ? '+' : ''}${e.delta} 却记成 ${e.value}（中间有没记日志的改动）`)
        value.set(key, e.value)
        break
      }
      case 'hit': {
        // 结算给的资源不记 resource 事件，实际增减写在 hit 的 gains 里（resources.ts settleGains）
        const bump = (key: string, d: number) => { if (d) value.set(key, (value.get(key) ?? 0) + d) }
        for (const [who, d] of Object.entries(e.gains.energy)) bump(`${who}|energy`, d ?? 0)
        bump(`${e.char}|concerto`, e.gains.concerto)
        e.gains.core.forEach((d, i) => bump(`${e.char}|core${i + 1}`, d))
        if (e.dmg && !(e.dmg.nonCrit <= e.dmg.expected + LOG_EPS && e.dmg.expected <= e.dmg.crit + LOG_EPS))
          say(e.f, `${e.char} ${e.judgment} 的期望伤害 ${e.dmg.expected} 不在不暴击 ${e.dmg.nonCrit} 与暴击 ${e.dmg.crit} 之间`)
        break
      }
    }
  }
  // 汇总：总伤害 = 各角色之和 = 各动作之和 = 各轮之和；稳态 = 所含各轮之和；覆盖率在 [0, 1]
  const s = res.summary
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-9)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  if (!near(sum(Object.values(s.byChar).map(c => c.damage)), s.totalDamage)) say(lastF, `各角色伤害之和 ≠ 总伤害 ${s.totalDamage}`)
  if (!near(sum(s.byAction.map(a => a.damage)), s.totalDamage)) say(lastF, `各动作伤害之和 ≠ 总伤害 ${s.totalDamage}`)
  if (s.perLoop?.length) {
    if (!near(sum(s.perLoop.map(l => l.damage)), s.totalDamage)) say(lastF, `各轮伤害之和 ${sum(s.perLoop.map(l => l.damage))} ≠ 总伤害 ${s.totalDamage}`)
    if (!near(sum(s.perLoop.map(l => l.frames)), s.windowFrames)) say(lastF, `各轮帧数之和 ${sum(s.perLoop.map(l => l.frames))} ≠ 窗口 ${s.windowFrames}`)
    if (s.steady) {
      const inRange = s.perLoop.filter(l => l.loop >= s.steady!.from && l.loop <= s.steady!.to)
      if (!near(sum(inRange.map(l => l.damage)), s.steady.damage)) say(lastF, `稳态伤害 ${s.steady.damage} ≠ 第 ${s.steady.from}–${s.steady.to} 轮之和`)
      if (!near(sum(inRange.map(l => l.frames)), s.steady.frames)) say(lastF, `稳态帧数 ${s.steady.frames} ≠ 第 ${s.steady.from}–${s.steady.to} 轮之和`)
    }
  }
  for (const [id, u] of Object.entries(s.buffUptime)) if (!(u >= -LOG_EPS && u <= 1 + LOG_EPS)) say(lastF, `buff ${id} 的覆盖率 ${u}`)
  return out
}
