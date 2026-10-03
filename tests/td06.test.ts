// tests/td06.test.ts —— TD-06 资源：大招能量、协奏、核心资源（§9 的用例）
// M0 队伍的用例依赖 data/generated（缺数据时跳过）；"人造角色"的用例用 helpers/synth，总是运行。
import { beforeAll, describe, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { at, finalResources, m0Run } from './helpers/m0'
import { eventsOfLog, idle, synthRun, type SynthChar } from './helpers/synth'

let gd: GameData
const onHit = { rules: { concertoTiming: 'onHit' } }
const onCast = { rules: { concertoTiming: 'onCast' } }

dataDescribe('TD-06 M0 队伍', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('T06-1 全队分配：出伤者 1 × 自身效率，另两人 0.5 × 各自效率（千古洑流的共鸣效率 buff 算在椿的效率里）', () => {
    const out = m0Run(gd, { initial: { onField: 1, energy: 'empty' }, rotation: ['散华 E'] })
    const e = eventsOfLog(out.log, 'hit').find(h => h.judgment === 'E')!
    expect(e.f).toBe(19)
    expect(e.gains.energy).toEqual({ 散华: 15.184, 椿: 6.28, 维里奈: 7.592 })   // 10 × 1.5184、5 × 1.256、5 × 1.5184
  })

  test('T06-2 大招门槛：能量不够就等（resource），等超时报错', () => {
    const out = m0Run(gd, { initial: { onField: 1, energy: 'empty' }, rotation: ['散华 R'], options: { maxWait: 60 } })
    expect(out.error).toMatchObject({ code: 'timeout', message: '第 1 条等了 60 帧仍不能执行：大招能量 0 / 100', frame: 60 })
    expect(out.summary.waits).toEqual([{ line: 1, item: 1, loop: 1, code: 'resource', frames: 60, reason: '大招能量 0 / 100' }])
  })

  test('T06-3 扣除与施放资源：开始时先扣能量，再是 actionStart 的触发（散华 C4 +10，定值不乘效率），最后施放资源', () => {
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 R'] })
    expect(at(out.log, 0)).toEqual([
      'loop', 'start 散华 大招', '散华 energy -100 cost', '+散华.共鸣链4→散华×1 300', '散华 energy +10 散华.共鸣链4.能量',
      '散华 concerto +20 cast', '散华 core1 +2 cast',
    ])
  })

  test('T06-4 协奏时机：onCast 在动作开始时发（按段数汇总），onHit 随每次结算发；进入即得两种模式都在开始时', () => {
    const cast = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 A1'], options: onCast })
    expect(at(cast.log, 0)).toContain('散华 concerto +2 cast')
    expect(eventsOfLog(cast.log, 'hit')[0]!.gains.concerto).toBe(0)
    const hit = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 A1'], options: onHit })
    expect(eventsOfLog(hit.log, 'resource')).toEqual([])
    expect(eventsOfLog(hit.log, 'hit').map(h => [h.f, h.gains.concerto])).toEqual([[13, 2]])
    const dflt = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 A1'] })   // 默认按命中给（2026-10-03 实测，TD-06 Q1）
    expect(eventsOfLog(dflt.log, 'hit').map(h => h.gains.concerto)).toEqual([2])
    for (const opts of [onCast, onHit]) {                 // E 的 15 是"进入即得"
      const e = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E'], options: opts })
      expect(at(e.log, 0)).toContain('散华 concerto +15 cast')
    }
  })

  test('T06-4 事件生成的判定（E-引爆冰棱）：它每次结算时给，含它自己的"进入即得"', () => {
    const data = structuredClone(gd)
    data.characters['散华'] = {
      ...gd.characters['散华']!,
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'hit' && ev.judgment === 'E') ctx.spawnJudgment('E-引爆冰棱') } },
    }
    const out = m0Run(data, { initial: { onField: 1 }, rotation: ['散华 E'] })
    const ice = eventsOfLog(out.log, 'hit').find(h => h.judgment === 'E-引爆冰棱')!
    expect([ice.f, ice.gains.concerto]).toEqual([19, 15])
  })

  test('T06-5 多段：onCast 在开始时按 4 段汇总，onHit 每段一次；能量两种模式都是每段一次', () => {
    const a3 = (opts: object) => {
      const out = m0Run(gd, { initial: { onField: 1, energy: 'empty' }, rotation: ['散华 A1 A2 A3'], options: opts })
      const start = eventsOfLog(out.log, 'actionStart').find(e => e.action === 'A3')!.f
      return { start: at(out.log, start), hits: eventsOfLog(out.log, 'hit').filter(h => h.action === 'A3') }
    }
    const cast = a3(onCast)
    const hit = a3(onHit)
    expect(cast.start).toContain('散华 concerto +8 cast')
    expect(hit.start.filter(x => x.includes('cast'))).toEqual([])
    for (const { hits } of [cast, hit]) expect(hits.map(h => h.gains.energy['散华'])).toEqual(Array(4).fill(0.576992))   // 0.38 × 1.5184
    expect(hit.hits.map(h => h.gains.concerto)).toEqual([2, 2, 2, 2])
    expect(cast.hits.map(h => h.gains.concerto)).toEqual([0, 0, 0, 0])
  })

  test('T06-6 消耗与下限：数据里负数的回收就是消耗，截在 0', () => {
    const out = m0Run(gd, { initial: { onField: 1, concerto: [0, 100, 0] }, rotation: ['switch 椿', '椿 A1'] })
    const a1 = eventsOfLog(out.log, 'hit').find(h => h.judgment === 'A1')!
    expect(a1.gains.core).toEqual([-6.15, 0, 0])                   // 变奏给的红椿·蕊 100 → 93.85
    const zero = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 A1'] })
    expect(eventsOfLog(zero.log, 'hit')[0]!.gains.core).toEqual([0, 0, 0])
  })

  test('T06-7 上限与 resourceFull：溢出作废，从不满到满记一次', () => {
    const out = m0Run(gd, { initial: { onField: 1, concerto: [0, 90, 0] }, rotation: ['散华 E', '散华 A1'] })
    expect(at(out.log, 0)).toEqual([
      'loop', 'start 散华 E', '散华 concerto +8 行进序曲.协奏', '散华 concerto +2 cast', '散华 concerto 满',
    ])
    expect(eventsOfLog(out.log, 'resourceFull')).toHaveLength(1)
    expect(finalResources(out).concerto[1]).toBe(100)
  })

  test('T06-8 共鸣链版本：椿 0 链一日花的施放资源只有一日花那一版（不是三个版本的和）', () => {
    const out = m0Run(gd, { initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['椿 E3'] })
    expect(at(out.log, 0).filter(x => x.includes('cast'))).toEqual(['椿 concerto -70 cast', '椿 core1 +100 cast'])
  })

  test('资源曲线：每 30 个世界帧采样一次，外加最后一帧', () => {
    const out = m0Run(gd, { initial: { onField: 1, energy: 'empty' }, rotation: ['散华 E'] })
    const tl = out.summary.resourceTimeline
    expect(tl.map(x => x.f)).toEqual([0, 30, 60, 90, 95])
    expect(tl[0]).toEqual({ f: 0, energy: [0, 0, 0], concerto: [0, 23, 0] })
    expect(tl[1]).toEqual({ f: 30, energy: [6.28, 15.184, 7.592], concerto: [0, 23, 0] })
  })
})

// ---------------------------------------------------------------------------
// 人造角色

describe('TD-06 人造角色', () => {
  const hitAt = (name: string, spawnFrame: number, o: Parameters<typeof judgment>[0] extends infer J ? Partial<J> : never = {}) =>
    judgment({ name, spawnFrame, ...o })

  test('核心回收合并区：同一动作实例里只在第一次结算时发', () => {
    const 甲: SynthChar = {
      name: '甲', core: [{ slot: 1, name: '层数', cap: 10 }],
      actions: [action({
        id: 'X', endFrame: 40,
        judgments: [1, 2, 3].map(i => hitAt(`x${i}`, i * 10, { gains: { energy: 0, concerto: 0, core: [2, 0, 0] }, coreOncePerAction: [true, false, false] })),
      })],
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect(eventsOfLog(out.log, 'hit').map(h => h.gains.core[0])).toEqual([2, 0, 0])
  })

  test('没有这个核心资源槽：丢弃，每个角色每个槽只提示一次', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', endFrame: 40, judgments: [1, 2].map(i => hitAt(`x${i}`, i * 10, { gains: { energy: 0, concerto: 0, core: [0, 3, 0] } })) })],
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect(eventsOfLog(out.log, 'hit').map(h => h.gains.core)).toEqual([[0, 0, 0], [0, 0, 0]])
    expect(eventsOfLog(out.log, 'warning').map(w => w.code)).toEqual(['coreSlot'])
  })

  test('selfEnergyScale（modifyHit）只放大出伤者自己那份，队友那 50% 不变；大招所需能量为 0 的角色不收能量', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', endFrame: 40, judgments: [hitAt('x', 10, { gains: { energy: 4, concerto: 0, core: [0, 0, 0] } })] })],
      hooks: { modifyHit: (_ctx, d) => { d.selfEnergyScale = 2.5 } },
    }
    const out = synthRun([甲, idle('乙'), { name: '丙', actions: [], energyCost: 0 }], { initial: { energy: 'empty' }, rotation: ['甲 X'] })
    expect(eventsOfLog(out.log, 'hit')[0]!.gains.energy).toEqual({ 甲: 10, 乙: 2 })   // 基础 4：甲 4 × 2.5，乙 4 × 0.5
    // ×0（椿含苞）：出伤者拿不到，队友照常
    const zero = synthRun([{ ...甲, hooks: { modifyHit: (_ctx, d) => { d.selfEnergyScale = 0 } } }, idle('乙'), idle('丙')],
      { initial: { energy: 'empty' }, rotation: ['甲 X'] })
    expect(eventsOfLog(zero.log, 'hit')[0]!.gains.energy).toEqual({ 乙: 2, 丙: 2 })
  })

  test('资源型效果：定值默认不乘共鸣效率，scaledByRegen 才乘（TD-06 Q3）', () => {
    const regen = { id: '甲.效率', source: 't', zone: 'energyRegen', value: 0.5, target: 'self', duration: 'inf', trigger: 'always' } as const
    const flat = { id: '甲.定值', source: 't', resource: 'energy', amount: 10, trigger: { on: 'actionStart' } } as const
    const 甲: SynthChar = {
      name: '甲', buffs: [regen], effects: [flat, { ...flat, id: '甲.乘效率', scaledByRegen: true }],
      actions: [action({ id: 'X', endFrame: 10 })],
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { initial: { energy: 'empty' }, rotation: ['甲 X'] })
    expect(eventsOfLog(out.log, 'resource').map(e => [e.cause, e.delta])).toEqual([['甲.定值', 10], ['甲.乘效率', 15]])
  })
})
