// tests/m3-cases.test.ts —— 总设计 §11 第 3 条"首批机制用例"（M3 的完成标志，§12）与第 4 条不变量检查
// 首批五条：半程切人（机制设计案例 A）、攒协奏 → 变奏 / 延奏 → 大招（案例 B）、取消与可脱手、全局时停、同帧顺序。
// "取消与可脱手"的细则在 tests/td04.test.ts（T04-4～T04-8）；这里用 M0 队伍的真实数据把其余四条各走一遍。
import { beforeAll, describe, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { m0Run } from './helpers/m0'
import { eventsOfLog, idle, synthRun } from './helpers/synth'

let gd: GameData
const bf = (e: { t: number }) => Math.round(e.t * 60)       // 事件的战斗帧

dataDescribe('§11 首批机制用例（M0 队伍）', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('案例 A 半程切人：切走后后台那半段照常结算并全队回能；第二次切人被 1 秒切人冷却挡住', () => {
    const out = m0Run(gd, { initial: { onField: 1, energy: 'empty' }, rotation: ['散华 A1 A2 A3 A4', 'switch 维里奈', 'switch 椿'] })
    const [sw1, sw2] = eventsOfLog(out.log, 'switch')
    const a4 = eventsOfLog(out.log, 'actionStart').find(e => e.action === 'A4')!
    expect(sw1!.f).toBe(a4.f)                                                     // A4 一开始就切走
    const bg = eventsOfLog(out.log, 'hit').filter(h => h.action === 'A4')
    expect(bg.map(h => h.f - a4.f)).toEqual([13, 24])                              // 后台照常命中
    for (const h of bg) {
      expect(h.char).toBe('散华')
      // 出伤者 1 × 自身效率，另两人 0.5 × 各自效率（A4 每段基础能量 0.71；椿的效率含千古洑流 25.6%）
      expect(h.gains.energy['散华']).toBeCloseTo(0.71 * 1.5184, 9)
      expect(h.gains.energy['椿']).toBeCloseTo(0.71 * 0.5 * 1.256, 9)
      expect(h.gains.energy['维里奈']).toBeCloseTo(0.71 * 0.5 * 1.5184, 9)
    }
    expect(sw2!.f - sw1!.f).toBe(60)
    expect(eventsOfLog(out.log, 'wait').map(w => [w.code, w.frames])).toContainEqual(['switchCd', 60])
  })

  test('案例 B 攒协奏 → 变奏 / 延奏 → 大招：协奏按命中攒满后变奏切人，延奏在变奏局部第 36 帧触发并清零协奏', () => {
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E R 重击居合 A1 A2 A3 A4 A5 重击', 'switch 椿', '椿 R'] })
    const full = eventsOfLog(out.log, 'resourceFull').find(e => e.char === '散华' && e.resource === 'concerto')!
    const sw = eventsOfLog(out.log, 'switch')[0]!
    expect(sw.intro).toBe(true)
    expect(sw.f).toBeGreaterThanOrEqual(full.f)                                   // 协奏是命中攒满的
    const outro = eventsOfLog(out.log, 'outro')[0]!
    expect([outro.char, outro.to, outro.f - sw.f]).toEqual(['散华', '椿', 36])
    expect(eventsOfLog(out.log, 'resource').find(e => e.cause === 'outro')).toMatchObject({ char: '散华', delta: -100, value: 0, f: outro.f })
    expect(eventsOfLog(out.log, 'buffApply').find(e => e.buff === '散华.延奏')).toMatchObject({ target: '椿', f: outro.f })
    const r = eventsOfLog(out.log, 'actionStart').find(e => e.char === '椿' && e.action === '大招')!
    expect(r.f).toBeGreaterThan(outro.f)
    expect(eventsOfLog(out.log, 'resource').find(e => e.f === r.f && e.cause === 'cost')).toMatchObject({ char: '椿', delta: -125 })
  })

  test('全局时停：战斗时钟停走，buff 计时与技能冷却一起暂停（总设计不变量 6）', () => {
    // 散华 E 留下冰棱（342 战斗帧）、E 冷却 600 战斗帧；随后的大招有 90 帧全局时停
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E R', '散华 E'], options: { maxWait: 1000 } })
    const ice = eventsOfLog(out.log, 'buffApply').find(e => e.buff === '散华.冰棱')!
    const gone = eventsOfLog(out.log, 'buffExpire').find(e => e.buff === '散华.冰棱')!
    expect([bf(ice), bf(gone)]).toEqual([19, 19 + 341])                           // 按战斗帧走满 342 帧（施加那一帧算第 1 帧）
    expect(gone.f - bf(gone)).toBe(90)                                            // 世界帧晚了 90
    const es = eventsOfLog(out.log, 'actionStart').filter(e => e.action === 'E')
    expect(es.map(bf)).toEqual([0, 600])                                          // 冷却按战斗帧算
    expect(es[1]!.f).toBe(690)                                                   // 世界帧也晚了 90
  })

  test('同帧顺序："xxx 后"的触发，触发它的那次结算自己不吃（散华 6 链）', () => {
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E 重击居合'] })
    const boom = eventsOfLog(out.log, 'hit').find(h => h.judgment === 'E-引爆冰棱')!
    expect(boom.buffs).not.toContain('散华.共鸣链6')
    const c6 = eventsOfLog(out.log, 'buffApply').find(e => e.buff === '散华.共鸣链6')!
    expect(c6.f).toBe(boom.f)
    expect(eventsOfLog(out.log, 'hit').find(h => h.judgment === '重击居合-2')!.buffs).toContain('散华.共鸣链6')
  })
})

describe('§11 第 4 条 不变量检查', () => {
  test('伤害为负时报错（code invariant），指出第几帧、哪个判定', () => {
    const 甲 = {
      name: '甲',
      actions: [action({ id: 'X', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })],
      buffs: [{ id: '甲.坏', source: 't', zone: 'DamageChange', value: -2, target: 'self', duration: 'inf', trigger: 'always' } as const],
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect(out.error).toMatchObject({ code: 'invariant', frame: 5 })
    expect(out.error!.message).toContain('甲 x 的伤害')
  })

  test('正常的轴不触发', () => {
    const out = synthRun([{ name: '甲', actions: [action({ id: 'X', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })] }, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect(out.error).toBeUndefined()
  })
})
