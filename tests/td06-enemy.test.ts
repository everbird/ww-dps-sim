// tests/td06-enemy.test.ts —— 敌人量表（TD-06 §13）：偏谐值与失谐、谐度破坏（自动插入、对失谐、真空期、手写与关闭）、
// 白条与破盾回能、瘫痪与回满、Summary.enemy。人造角色，不依赖生成数据
import { describe, expect, test } from 'vitest'
import type { DilationDef, TuneBreakTable } from '../src/data/gamedata'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { SimResult } from '../src/engine/types'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

// 谐度破坏表：90 级基础值 10000，COST 系数都是 1（真实数据见 T03-7）
const TABLE: TuneBreakTable = {
  variants: [], baseByLevel: Array.from({ length: 100 }, (_, i) => (i === 89 ? 10000 : 0)), costFactor: { 1: 1, 3: 1, 4: 1 },
}
const globalStop = (frames: number): DilationDef => ({
  type: '全局时停', anchor: 'action', start: 1, enemy: { rate: 0, duration: frames }, ally: { rate: 0, duration: frames },
})

// 甲：X 第 10 帧命中一次（偏谐值 40、削韧值 20），30 帧结束；谐度破坏第 20 帧一段（倍率 16），带 50 帧全局时停
const 甲: SynthChar = {
  name: '甲',
  actions: [
    action({ id: 'X', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gauges: { toughness: 20, tunability: 40 } })] }),
    action({
      id: '谐度破坏', kind: 'tuneBreak', endFrame: 60, priority: [{ fromFrame: 0, value: 11 }], switchLockUntil: 60,
      dilations: [globalStop(50)],
      judgments: [judgment({ name: '谐度破坏-1', spawnFrame: 20, multiplier: 16, tags: ['谐度破坏'] })],
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
  test('全局时停：放谐度破坏的 50 帧里战斗时钟不走', () => {
    const r = run({ rotation: X(4) })
    const s = eventsOfLog(r.log, 'actionStart').find(e => e.action === '谐度破坏')!
    const e = eventsOfLog(r.log, 'actionStart').find(e => e.action === 'X' && e.cmd?.line === 4)!
    expect(e.f - s.f).toBe(60)                                           // 优先级 11 不可取消，等它 60 帧结束
    expect(Math.round((e.t - s.t) * 60)).toBe(10)                        // 战斗时钟只走了时停前后的 10 帧
  })
  test('真空期：命中后 300 战斗帧内的偏谐值不算', () => {
    const r = run({ rotation: X(16) })
    const ev = eventsOfLog(r.log, 'enemyState')
    const hb = ev.find(e => e.change === 'harmonyBreak')!
    const hitsAfter = eventsOfLog(r.log, 'hit').filter(h => h.judgment === 'x' && h.f > hb.f)
    const counted = hitsAfter.filter(h => h.t * 60 >= hb.t * 60 + 300)
    const dis2 = ev.filter(e => e.change === 'disharmony')[1]!
    expect(r.log.indexOf(dis2)).toBe(r.log.indexOf(counted[2]!) + 1)     // 真空期后的第 3 段才再次失谐
    expect(hitsAfter.length - counted.length).toBeGreaterThan(5)
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
  test('没有白条的敌人不破盾', () => {
    expect(states(run({ rotation: X(8), options: { tuneBreak: 'off' } }, 1, { whiteBar: 0 }))).toEqual([])
  })
})
