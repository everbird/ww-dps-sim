// tests/td06-enemy.test.ts —— 敌人量表（TD-06 §13）：偏谐值与失谐、谐度破坏（自动插入、对失谐、真空期、手写与关闭）、
// 白条与破盾回能、瘫痪与回满、Summary.enemy；异常效应的层数（§18）。人造角色，不依赖生成数据
import { describe, expect, test } from 'vitest'
import type { DilationDef, EffectDef, TuneBreakTable } from '../src/data/gamedata'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { computeAbnormal, emptyAccumulator } from '../src/engine/formula'
import type { ResolvedScenario, SimResult } from '../src/engine/types'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

// 谐度破坏表：90 级基础值 10000，COST 系数都是 1（真实数据见 T03-7）；规则同 20260707 版附页2：谐破冷却 1C / 3C 6 秒、4C 3 秒，按钮 3 秒
const TABLE: TuneBreakTable = {
  variants: [], baseByLevel: Array.from({ length: 100 }, (_, i) => (i === 89 ? 10000 : 0)), costFactor: { 1: 1, 3: 1, 4: 1 },
  rules: { lockFrames: { 1: 360, 3: 360, 4: 180 }, buttonFrames: 180 },
}
const globalStop = (frames: number): DilationDef => ({
  type: '全局时停', anchor: 'action', start: 1, enemy: { rate: 0, duration: frames }, ally: { rate: 0, duration: frames },
})

// 甲：X 第 10 帧命中一次（偏谐值 40、削韧值 20），30 帧结束；Y1 → Y2 连段（Y1 同 X，第 15–30 帧可派生）；D 见下；
// 谐度破坏第 20 帧一段（倍率 16，按白条上限削 12.5%），带 50 帧全局时停
const 甲: SynthChar = {
  name: '甲',
  actions: [
    action({ id: 'X', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gauges: { toughness: 20, tunability: 40 } })] }),
    action({
      id: 'Y1', endFrame: 30, cancelWindows: [{ from: 15, until: 30, row: 0 }],
      judgments: [judgment({ name: 'y1', spawnFrame: 10, gauges: { toughness: 20, tunability: 40 } })],
    }),
    action({ id: 'Y2', endFrame: 30, comboFrom: ['Y1'], judgments: [judgment({ name: 'y2', spawnFrame: 10 })] }),
    // D：第 40 帧才命中（偏谐值 40），切走后在后台照样打出来
    action({ id: 'D', endFrame: 60, judgments: [judgment({ name: 'd', spawnFrame: 40, gauges: { toughness: 0, tunability: 40 } })] }),
    action({
      id: '谐度破坏', kind: 'tuneBreak', endFrame: 60, priority: [{ fromFrame: 0, value: 11 }], switchLockUntil: 60,
      dilations: [globalStop(50)],
      judgments: [judgment({ name: '谐度破坏-1', spawnFrame: 20, multiplier: 16, tags: ['谐度破坏'], gauges: { toughness: 0, tunability: 0, whiteBarRatio: 0.125 } })],
    }),
  ],
}

/** 偏谐效率按 rate 给（人造角色缺省 0）；敌人：90 级、偏谐值上限 100、白条 50（削韧值）、瘫痪 1 秒 */
function run(sc: Partial<ScenarioInput>, rate = 1, enemy: Record<string, unknown> = {}): SimResult {
  const data = synthData([甲, idle('乙'), idle('丙')])
  data.tuneBreak = TABLE
  data.characters['甲']!.tunabilityRate = rate
  return simulate(resolveScenario(ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
    enemy: { custom: { level: 90, tunabilityMax: 100, whiteBar: 1000, paralysisSec: 1, ...enemy } }, ...sc,
  }), data))
}
const X = (n: number) => Array(n).fill('甲 X') as string[]
const states = (r: SimResult) => eventsOfLog(r.log, 'enemyState').map(e => e.change)

describe('T06-9 偏谐值与失谐', () => {
  test('每段偏谐值 × 偏谐效率累积到上限即失谐；失谐期间不再累积', () => {
    const r = run({ rotation: X(4), options: { tuneBreak: 'manual' } })
    const hits = eventsOfLog(r.log, 'hit')
    const dis = eventsOfLog(r.log, 'enemyState').filter(e => e.change === 'disharmony')
    expect(dis).toHaveLength(1)
    expect(r.log.indexOf(dis[0]!)).toBe(r.log.indexOf(hits[2]!) + 1)    // 40、80、120 → 第 3 段满，事件紧跟在这次 hit 后面
    expect(r.summary.enemy).toMatchObject({ disharmony: 1, tuneBreaks: 0 })
  })
  test('偏谐效率 150%：第 2 段就满', () => {
    const r = run({ rotation: X(3), options: { tuneBreak: 'manual' } }, 1.5)
    const hits = eventsOfLog(r.log, 'hit')
    const dis = eventsOfLog(r.log, 'enemyState').find(e => e.change === 'disharmony')!
    expect(r.log.indexOf(dis)).toBe(r.log.indexOf(hits[1]!) + 1)
  })
  test('options.tuneBreak: off：不累积', () => {
    expect(states(run({ rotation: X(4), options: { tuneBreak: 'off' } }))).toEqual([])
  })
})

describe('T06-10 谐度破坏', () => {
  test('auto：失谐后前台角色在下一条指令之前放；按对失谐算伤害；命中时偏谐值清空', () => {
    const r = run({ rotation: X(4) })
    const starts = eventsOfLog(r.log, 'actionStart').map(e => [e.action, e.cmd?.line ?? null])
    expect(starts).toEqual([['X', 1], ['X', 2], ['X', 3], ['谐度破坏', null], ['X', 4]])
    const tb = eventsOfLog(r.log, 'hit').find(h => h.judgment === '谐度破坏-1')!
    // 10000 × 16 × 防御 1520 / (1520 + 1512) × 物理抗性 0.9（自定义敌人缺省 10%）
    expect(tb.dmg!.expected).toBe(Math.ceil(10000 * 16 * (1520 / 3032) * 0.9))
    expect(tb.dmg!.crit).toBe(tb.dmg!.nonCrit)                        // 不暴击
    expect(states(r)).toEqual(['disharmony', 'harmonyBreak'])
    expect(r.log.indexOf(eventsOfLog(r.log, 'enemyState')[1]!)).toBe(r.log.indexOf(tb) + 1)
    expect(r.summary.enemy).toEqual({ disharmony: 1, tuneBreaks: 1, tuneBreakDamage: tb.dmg!.expected, breaks: 0 })
  })
  test('auto：失谐落在连段中间时不拆连段，打完这串再放', () => {
    const r = run({ rotation: ['甲 X', '甲 X', '甲 Y1 Y2', '甲 X'] })   // Y1 命中时失谐，队首是连段后续 Y2
    expect(r.error).toBeUndefined()
    const starts = eventsOfLog(r.log, 'actionStart').map(e => [e.action, e.cmd?.line ?? null])
    expect(starts).toEqual([['X', 1], ['X', 2], ['Y1', 3], ['Y2', 3], ['谐度破坏', null], ['X', 4]])
    expect(states(r)).toEqual(['disharmony', 'harmonyBreak'])
  })
  test('全局时停：放谐度破坏的 50 帧里战斗时钟不走', () => {
    const r = run({ rotation: X(4) })
    const s = eventsOfLog(r.log, 'actionStart').find(e => e.action === '谐度破坏')!
    const e = eventsOfLog(r.log, 'actionStart').find(e => e.action === 'X' && e.cmd?.line === 4)!
    expect(e.f - s.f).toBe(60)                                           // 优先级 11 不可取消，等它 60 帧结束
    expect(Math.round((e.t - s.t) * 60)).toBe(10)                        // 战斗时钟只走了时停前后的 10 帧
  })
  test('谐破冷却按敌人 COST（附页2）：4C 命中后 180 战斗帧、1C 360 战斗帧内的偏谐值不算', () => {
    for (const [cost, lock] of [[4, 180], [1, 360]] as const) {
      const r = run({ rotation: X(24) }, 1, { cost })
      const ev = eventsOfLog(r.log, 'enemyState')
      const hb = ev.find(e => e.change === 'harmonyBreak')!
      const hitsAfter = eventsOfLog(r.log, 'hit').filter(h => h.judgment === 'x' && h.f > hb.f)
      const counted = hitsAfter.filter(h => h.t * 60 >= hb.t * 60 + lock - 1e-6)
      const dis2 = ev.filter(e => e.change === 'disharmony')[1]!
      expect(r.log.indexOf(dis2)).toBe(r.log.indexOf(counted[2]!) + 1)   // 冷却后的第 3 段才再次失谐
      expect(hitsAfter.length - counted.length).toBe(lock / 30)           // 冷却期间每 30 帧一段，都不算
    }
  })
  test('按钮（附页2）：对失谐目标打出偏谐值不为 0 的伤害后亮 180 战斗帧；灭了"谐度破坏?"就跳过，再打一段又亮', () => {
    const r = run({ rotation: [...X(3), 'wait 200', '甲 谐度破坏?', '甲 X', '甲 X', '甲 谐度破坏?'], options: { tuneBreak: 'manual' } })
    const skips = eventsOfLog(r.log, 'skip')
    expect(skips.map(e => e.cmd.line)).toEqual([5])                       // 第 3 段失谐后等了 200 帧，按钮已灭
    expect(skips[0]!.reason).toContain('按钮没亮')
    const starts = eventsOfLog(r.log, 'actionStart').map(e => [e.action, e.cmd?.line ?? null])
    expect(starts.slice(-3)).toEqual([['X', 6], ['X', 7], ['谐度破坏', 8]])
    expect(states(r)).toEqual(['disharmony', 'harmonyBreak'])
  })
  test('按钮只认前台角色的命中：后台那一段让目标失谐时不亮，切回来再打一段才亮', () => {
    const r = run({ rotation: ['甲 X', '甲 X', '甲 D', 'switch 乙', 'wait 120', 'switch 甲', '甲 X', '甲 X'] })
    const dis = eventsOfLog(r.log, 'enemyState').find(e => e.change === 'disharmony')!
    expect(dis.detail).toBe('甲 D')                                       // 乙在前台时，甲在后台的 D 让目标失谐
    const starts = eventsOfLog(r.log, 'actionStart').map(e => [e.action, e.cmd?.line ?? null])
    expect(starts).toEqual([['X', 1], ['X', 2], ['D', 3], ['X', 7], ['谐度破坏', null], ['X', 8]])
    expect(states(r)).toEqual(['disharmony', 'harmonyBreak'])
  })
  test('manual：手写的谐度破坏等到失谐才放；不写就不放', () => {
    const r = run({ rotation: ['甲 谐度破坏', ...X(3)], options: { tuneBreak: 'manual', maxWait: 30 } })
    expect(r.error?.code).toBe('timeout')
    expect(r.error?.message).toContain('目标没有失谐')
    const ok = run({ rotation: [...X(3), '甲 谐度破坏', '甲 X'], options: { tuneBreak: 'manual' } })
    expect(ok.error).toBeUndefined()
    expect(states(ok)).toEqual(['disharmony', 'harmonyBreak'])
    expect(states(run({ rotation: X(4), options: { tuneBreak: 'manual' } }))).toEqual(['disharmony'])
  })
})

describe('T06-12 留着谐度破坏：manual + 可选的"谐度破坏?"', () => {
  test('没失谐就跳过（记 skip）；失谐后照常出别的招（留着），到写了"谐度破坏?"的地方才放；留着的期间不累积偏谐值', () => {
    const r = run({ rotation: ['甲 谐度破坏?', ...X(3), '甲 X', '甲 谐度破坏?', '甲 X'], options: { tuneBreak: 'manual' } })
    const starts = eventsOfLog(r.log, 'actionStart').map(e => [e.action, e.cmd?.line])
    expect(starts).toEqual([['X', 2], ['X', 3], ['X', 4], ['X', 5], ['谐度破坏', 6], ['X', 7]])
    expect(eventsOfLog(r.log, 'skip').map(e => [e.cmd.line, e.reason])).toEqual([[1, '目标没有失谐']])
    expect(r.summary.skipped).toEqual([{ line: 1, item: 1, loop: 1, reason: '目标没有失谐' }])
    expect(states(r)).toEqual(['disharmony', 'harmonyBreak'])            // 第 4 条失谐，第 5 条那段不再累积，第 6 条放
  })
})

describe('T06-11 白条', () => {
  test('每段削韧值削白条；打空 → 破盾：全队每人 +3 × 共鸣效率，瘫痪 1 秒后回满；瘫痪期间不削', () => {
    const r = run({ rotation: X(8), initial: { energy: 'empty' }, options: { tuneBreak: 'off' } }, 1, { whiteBar: 50 })
    const ev = eventsOfLog(r.log, 'enemyState')
    expect(ev.map(e => e.change)).toEqual(['break', 'breakEnd', 'break'])
    const hits = eventsOfLog(r.log, 'hit')
    expect(r.log.indexOf(ev[0]!)).toBe(r.log.indexOf(hits[2]!) + 1)    // 20、40、60 → 第 3 段打空
    const gains = eventsOfLog(r.log, 'resource').filter(e => e.cause === 'break' && e.f === ev[0]!.f)
    expect(gains.map(g => [g.char, g.delta])).toEqual([['甲', 3], ['乙', 3], ['丙', 3]])
    expect(Math.round((ev[1]!.t - ev[0]!.t) * 60)).toBe(60)            // 瘫痪 60 战斗帧
    const during = hits.filter(h => h.f > ev[0]!.f && h.f < ev[1]!.f).length
    const after = hits.filter(h => h.f > ev[1]!.f)
    expect(during).toBeGreaterThan(0)
    expect(r.log.indexOf(ev[2]!)).toBe(r.log.indexOf(after[2]!) + 1)   // 回满后再打 3 段
    expect(r.summary.enemy.breaks).toBe(2)
  })
  test('谐度破坏按白条上限的比例削（dmg Damage.Percent0，合计 12.5%；m0-confirm §10 H3）', () => {
    const r = run({ rotation: X(4) }, 1, { whiteBar: 400 })
    const left = eventsOfLog(r.log, 'hit').map(h => [h.judgment, h.enemy?.whiteBar])
    expect(left).toEqual([['x', 380], ['x', 360], ['x', 340], ['谐度破坏-1', 290], ['x', 270]])   // 400 × 12.5% = 50
  })
  test('没有白条的敌人不破盾', () => {
    expect(states(run({ rotation: X(8), options: { tuneBreak: 'off' } }, 1, { whiteBar: 0 }))).toEqual([])
  })
})

// 异常效应（§18）：规则同 data/curated/effects.ts 的电磁效应（常规 10 层、电磁爆发 10 层、15 秒、5 秒一结算、结算后移除 50%）
const 电磁: EffectDef = {
  name: '电磁效应', element: '导电', source: 't', multipliers: [], maxStacks: 10, burstMax: 10, duration: 900, tickInterval: 300, decay: 0.5,
}
/** 甲的 E 第 10 帧命中、附加 4 层电磁效应，30 帧结束；乙的钩子在甲每次命中后以乙的名义附加 1 层 */
function runEffects(rotation: string[], withRule = true): SimResult {
  const 甲e: SynthChar = {
    name: '甲',
    actions: [action({ id: 'E', kind: 'skill', endFrame: 30, judgments: [judgment({ name: 'e', spawnFrame: 10, applies: { effect: '电磁效应', stacks: 4 } })] })],
    buffs: [{
      id: '甲.附加后', source: 't', zone: 'atkPct', value: 0.1, target: 'self', duration: 600,
      trigger: { on: 'enemyState', where: { enemyState: 'effectApplied', effect: '电磁效应' } },
    }],
  }
  const 乙e: SynthChar = {
    name: '乙', actions: [],
    buffs: [{ id: '乙.谁附加都算', source: 't', target: 'self', duration: 600, trigger: { on: 'enemyState', where: { by: 'team', enemyState: 'effectApplied' } } }],
    hooks: { onEvent: (ctx, ev) => { if (ev.type === 'hit' && ev.char === '甲') ctx.applyEffect('电磁效应', 1, '乙跟着挂') } },
  }
  const data = synthData([甲e, 乙e, idle('丙')])
  if (withRule) data.effects = { 电磁效应: 电磁 }
  return simulate(resolveScenario(ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation,
  }), data))
}
const applied = (r: SimResult) => eventsOfLog(r.log, 'enemyState').filter(e => e.change === 'effectApplied')
  .map(e => [e.f, e.by, e.added, e.stacks, e.burstAdded, e.burst])

describe('T06-13 异常效应的层数（§18）', () => {
  test('命中后附加：加到常规上限，超出的进电磁爆发，到顶不再加；到顶了也记一次附加', () => {
    const r = runEffects(Array(4).fill('甲 E') as string[])
    expect(applied(r)).toEqual([
      [10, '甲', 4, 4, 0, 0], [10, '乙', 1, 5, 0, 0],
      [40, '甲', 4, 9, 0, 0], [40, '乙', 1, 10, 0, 0],
      [70, '甲', 0, 10, 4, 4], [70, '乙', 0, 10, 1, 5],
      [100, '甲', 0, 10, 4, 9], [100, '乙', 0, 10, 1, 10],
    ])
    expect(r.summary.assumptions.map(a => a.id)).not.toContain('later-damage')   // 伤害由定时结算算（T06-14）
  })
  test('每次附加刷新持续时间，全部层数共用一个计时；到时整个消失（effectEnd）', () => {
    const r = runEffects(['甲 E', 'wait 300', '甲 E', 'wait 1000'])     // 只剩异常效应时仿真就停了，等一会儿才看得到到时
    const end = eventsOfLog(r.log, 'enemyState').filter(e => e.change === 'effectEnd')
    const last = applied(r).at(-1)![0] as number
    expect(end.map(e => [e.f, e.effect])).toEqual([[last + 899, '电磁效应']])   // 第 f 帧附加、900 帧：第 f + 899 帧的 P6 移除
  })
  test('触发"附加…后"：缺省只认持有者自己附加的；by: team 认任何人；钩子 applyEffect 以钩子所属角色的名义附加', () => {
    const r = runEffects(['甲 E'])
    const buffs = eventsOfLog(r.log, 'buffApply').map(e => [e.f, e.buff, e.target])
    expect(buffs).toEqual([[10, '甲.附加后', '甲'], [10, '乙.谁附加都算', '乙'], [10, '乙.谁附加都算', '乙']])
  })
  test('没写规则的效应：提示一次，不计层数', () => {
    const r = runEffects(['甲 E', '甲 E'], false)
    expect(applied(r)).toEqual([])
    expect(eventsOfLog(r.log, 'warning').filter(w => w.code === 'effect')).toHaveLength(1)
  })
})

// 定时结算（§18）：同上的电磁效应，带逐层倍率（dmg「异常伤害 / 电磁效应」1–10 层）；异常伤害基础值 90 级 3674（TD-03 §5）
const 倍率 = [0.5, 0.9065, 1.313, 1.7195, 2.126, 2.5325, 2.939, 3.3455, 3.752, 4.1585]
/** 甲的 E 第 10 帧命中、附加 4 层；乙按 extra 加规则、buff、钩子；丙记"命中时"触发了几次；rules 覆盖场景的 options.rules */
function runTicks(rotation: string[], extra: Partial<SynthChar> = {}, rules: Record<string, unknown> = {}): { res: SimResult; R: ResolvedScenario } {
  const 甲e: SynthChar = {
    name: '甲', actions: [action({ id: 'E', kind: 'skill', endFrame: 30, judgments: [judgment({ name: 'e', spawnFrame: 10, applies: { effect: '电磁效应', stacks: 4 } })] })],
  }
  const 丙e: SynthChar = {
    name: '丙', actions: [], buffs: [{ id: '丙.命中时', source: 't', target: 'self', duration: 600, trigger: { on: 'judgmentSettle', where: { by: 'team' } } }],
  }
  const data = synthData([甲e, { name: '乙', actions: [], ...extra }, 丙e])
  data.effects = { 电磁效应: { ...电磁, multipliers: 倍率 } }
  data.abnormalBaseByLevel = Array.from({ length: 100 }, (_, i) => (i === 89 ? 3674 : 0))
  const R = resolveScenario(ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation, options: { rules },
  }), data)
  return { res: simulate(R), R }
}
const ticks = (r: SimResult) => eventsOfLog(r.log, 'effectTick').map(e => [e.f, e.stacks, e.burst, e.left, e.source])
const effectHits = (r: SimResult) => eventsOfLog(r.log, 'hit').filter(h => h.effect).map(h => [h.f, h.char, h.judgment, h.dmg!.expected])
/** 期望的异常伤害：基础值 × 倍率 × 防御 × 抗性（× 0 类加深） */
const abn = (R: ResolvedScenario, multiplier: number, amp0 = 0): number => {
  const acc = emptyAccumulator()
  acc.zones.DamageAmplify0 = amp0
  return computeAbnormal({ base: 3674, multiplier, level: 90, enemy: { def: R.enemy.def, res: R.enemy.res['导电'] } }, acc, R.rules)
}
const 跟着挂: Partial<SynthChar> = { hooks: { onEvent: (ctx, ev) => { if (ev.type === 'hit' && ev.char === '甲') ctx.applyEffect('电磁效应', 1, '乙跟着挂') } } }

describe('T06-14 异常效应的定时结算（§18）', () => {
  test('从第一次附加起每 300 战斗帧一次：按当时的层数倍率出伤害，记在最后附加的人名下；之后移除 ⌊层数 × 50%⌋；到期那一帧先结算再消失', () => {
    const { res, R } = runTicks(['甲 E', 'wait 1000'], 跟着挂)          // 第 10 帧：甲 4 层、乙 1 层 → 5 层，最后附加的是乙
    expect(ticks(res)).toEqual([[309, 5, 0, 3, '乙'], [609, 3, 0, 2, '乙'], [909, 2, 0, 1, '乙']])
    expect(effectHits(res)).toEqual([
      [309, '乙', '电磁效应·定时结算', abn(R, 倍率[4]!)], [609, '乙', '电磁效应·定时结算', abn(R, 倍率[2]!)], [909, '乙', '电磁效应·定时结算', abn(R, 倍率[1]!)],
    ])
    const tick3 = res.log.findIndex(e => e.type === 'effectTick' && e.f === 909)
    expect(res.log.findIndex(e => e.type === 'enemyState' && e.change === 'effectEnd')).toBeGreaterThan(tick3)   // 第 10 帧附加、900 帧
    const h = eventsOfLog(res.log, 'hit').find(x => x.effect)!
    expect([h.action, h.element, h.tags, h.gains]).toEqual(['电磁效应', '导电', ['异常效应'], { energy: {}, concerto: 0, core: [0, 0, 0] }])
    expect(eventsOfLog(res.log, 'buffApply').filter(b => b.buff === '丙.命中时')).toHaveLength(1)   // 只有甲那一下算"命中时"
    expect(res.summary.byAction.find(a => a.action === '电磁效应')).toMatchObject({ char: '乙', hits: 3 })
    expect(res.summary.assumptions.map(a => a.id)).toEqual(expect.arrayContaining(['effect-tick', 'effect-owner']))
  })
  test('电磁爆发：结算时另加电磁爆发层数的倍率，结算后清零（假设 effect-burst）', () => {
    const { res, R } = runTicks([...Array(4).fill('甲 E') as string[], 'wait 1000'])   // 4 → 8 → 10 + 2 → 10 + 6
    expect(ticks(res)).toEqual([[309, 10, 6, 5, '甲'], [609, 5, 0, 3, '甲'], [909, 3, 0, 2, '甲']])
    expect(effectHits(res)[0]![3]).toBe(abn(R, 倍率[9]! + 倍率[5]!))
    expect(res.summary.assumptions.map(a => a.id)).toContain('effect-burst')
  })
  test('角色模块的 effectRules 写了 keepStacks：结算后不减层（心·共鸣模态·电磁）', () => {
    const { res } = runTicks(['甲 E', 'wait 1000'], { ...跟着挂, effectRules: { 电磁效应: { keepStacks: true, source: 't' } } })
    expect(ticks(res).map(t => t.slice(0, 4))).toEqual([[309, 5, 0, 5], [609, 5, 0, 5], [909, 5, 0, 5]])
  })
  test('钩子：takeBurst 消耗目标全部的电磁爆发（记 effectConsumed）；effectDamage 按"scale × 当前层数倍率"出伤害，不算一次结算', () => {
    const { res, R } = runTicks([...Array(4).fill('甲 E') as string[], 'wait 400'], {
      hooks: {
        onEvent: (ctx, ev) => {
          if (ev.type !== 'enemyState' || ev.change !== 'effectApplied' || !ev.burstAdded) return
          const n = ctx.takeBurst('电磁效应', '乙收走')
          ctx.effectDamage('电磁效应', 0.35 * n, '测试·电磁效应')
        },
      },
    })
    expect(eventsOfLog(res.log, 'enemyState').filter(e => e.change === 'effectConsumed').map(e => [e.f, e.by, e.stacks, e.burst]))
      .toEqual([[70, '乙', 10, 0], [100, '乙', 10, 0]])
    expect(effectHits(res)).toEqual([
      [70, '乙', '测试·电磁效应', abn(R, 0.35 * 2 * 倍率[9]!)], [100, '乙', '测试·电磁效应', abn(R, 0.35 * 4 * 倍率[9]!)],
      [309, '甲', '电磁效应·定时结算', abn(R, 倍率[9]!)],
    ])
    expect(ticks(res)).toEqual([[309, 10, 0, 5, '甲']])                // 电磁爆发已被收走；主动触发不改结算的时刻与层数
  })
  test('另两种读法（假设敏感度能翻）：rules.effectTickReset 每次附加都重新计时；rules.effectOwner 记在第一次附加的人 / 结算时在前台的人名下', () => {
    const rot = ['甲 E', 'wait 200', '甲 E', 'wait 1000']              // 第 10、210 帧附加
    expect(ticks(runTicks(rot).res).map(t => t[0])).toEqual([309, 609, 909])
    expect(ticks(runTicks(rot, {}, { effectTickReset: true }).res).map(t => t[0])).toEqual([509, 809, 1109])
    const who = (rules: Record<string, unknown>) => ticks(runTicks(['甲 E', 'switch 丙', 'wait 400'], 跟着挂, rules).res).map(t => t[4])
    expect([who({}), who({ effectOwner: 'first' }), who({ effectOwner: 'onField' })]).toEqual([['乙'], ['甲'], ['丙']])
  })
  test('buff 的 ownerOnField：给的人在前台时才算（玉阙玄华"若装备者处于前台，目标受到电磁效应伤害加深"）；filter.effects 只加在效应自身的伤害上', () => {
    const 加深: Partial<SynthChar> = {
      buffs: [{
        id: '乙.电磁加深', source: 't', zone: 'DamageAmplify0', value: 0.3, filter: { effects: ['电磁效应'] },
        target: 'enemy', duration: 'inf', trigger: 'always', ownerOnField: true,
      }],
    }
    const off = runTicks(['甲 E', 'wait 400'], 加深)
    const on = runTicks(['甲 E', 'switch 乙', 'wait 400'], 加深)
    expect(effectHits(off.res)).toEqual([[309, '甲', '电磁效应·定时结算', abn(off.R, 倍率[3]!)]])
    expect(effectHits(on.res)).toEqual([[309, '甲', '电磁效应·定时结算', abn(on.R, 倍率[3]!, 0.3)]])
    expect(eventsOfLog(on.res.log, 'hit').filter(h => h.effect).map(h => h.buffs)).toEqual([['乙.电磁加深']])
  })
})
