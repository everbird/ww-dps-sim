// tests/td07.test.ts —— TD-07 Buff 系统：叠层与刷新、nextIn、清除、内置冷却、先算伤害后触发、消耗型、标记型、触发数组、连锁上限（§10.2）
// M0 队伍的用例依赖 data/generated（缺数据时跳过）；"人造角色"的用例用 helpers/synth，总是运行。
import { beforeAll, describe, expect, test } from 'vitest'
import type { BuffDefInput } from '../src/data/buff.schema'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { at, m0Run } from './helpers/m0'
import { eventsOfLog, idle, synthRun, type SynthChar } from './helpers/synth'

let gd: GameData

dataDescribe('TD-07 M0 队伍', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('T07-1 叠层与刷新：千古洑流.攻击 最多 2 层，再次施加刷新持续时间', () => {
    const out = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 E1', 'wait 240', '椿 E2', 'wait 240', '椿 E1'] })
    const apply = eventsOfLog(out.log, 'buffApply').filter(e => e.buff === '千古洑流.攻击')
    expect(apply.map(e => [e.f, e.stacks, e.remaining])).toEqual([[0, 1, 600], [240, 2, 600], [480, 2, 600]])
    const hits = eventsOfLog(out.log, 'hit')
    expect(hits.find(h => h.action === 'E1')!.buffs).toContain('千古洑流.攻击')
    expect(hits.find(h => h.action === 'E2')!.buffs).toContain('千古洑流.攻击×2')
  })

  test('T07-2 nextIn 与 clear：散华延奏挂给变奏的椿，椿的普攻吃 38% 加深，切走椿时移除；覆盖率按战斗帧', () => {
    // A1 开始后要等一会儿再切：切人是前台的事，A1 刚开始就切走的话，延奏 buff 在 A1 命中前就被清掉了
    const out = m0Run(gd, { initial: { onField: 1, concerto: [0, 100, 0] }, rotation: ['switch 椿', '椿 A1', 'wait 30', 'switch 维里奈'] })
    const a1 = eventsOfLog(out.log, 'hit').find(h => h.judgment === 'A1')!
    expect(a1.buffs).toContain('散华.延奏')
    expect(a1.factors!.amplify).toBeCloseTo(1.38, 12)
    const off = eventsOfLog(out.log, 'switch')[1]!.f
    expect(eventsOfLog(out.log, 'buffExpire').map(e => [e.f, e.buff, e.target, e.reason])).toEqual([[off, '散华.延奏', '椿', 'switchOut']])
    expect(out.summary.buffUptime['散华.延奏→椿']).toBeCloseTo((off - 36) / out.summary.windowFrames, 12)
    expect(out.summary.buffUptime['椿.固有2→椿']).toBe(1)
  })

  test('T07-3 内置冷却：行进序曲"每 20 秒可触发 1 次"——第二次 E 在 20 秒内，只有施放资源', () => {
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E', '散华 E'] })
    const es = eventsOfLog(out.log, 'actionStart').filter(e => e.action === 'E').map(e => e.f)
    expect(es).toEqual([0, 600])                                   // 冷却 10 秒
    expect(at(out.log, 0).filter(x => x.includes('concerto'))).toEqual(['散华 concerto +8 行进序曲.协奏', '散华 concerto +15 cast'])
    expect(at(out.log, 600).filter(x => x.includes('concerto'))).toEqual(['散华 concerto +15 cast'])
  })

  test('T07-6 动作类别按技能归类：椿的 E 是共鸣技能（触发千古洑流），伤害仍是普攻（吃普攻加成）', () => {
    const 椿 = gd.characters['椿']!.actions
    expect([椿.E1!.kind, 椿.E2!.kind, 椿.E3!.kind]).toEqual(['skill', 'skill', 'skill'])
    expect(椿.E1!.judgments[0]!.tags).toEqual(['普攻'])
    expect(gd.characters['散华']!.actions['大招-引爆冰川']!.kind).toBe('liberation')   // 技能归类 8 不决定类别，按组名
    expect(gd.characters['维里奈']!.actions['QTE-撞']!.kind).toBe('intro')
    const out = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 E1'] })
    expect(at(out.log, 0)).toContain('+千古洑流.攻击→椿×1 600')
    expect(eventsOfLog(out.log, 'hit')[0]!.buffs).toEqual(['椿.固有1', '椿.固有2', '千古洑流.共鸣效率', '千古洑流.攻击'])
  })

  test('T07-7 trigger 数组：维里奈固有在大招开始与延奏时各施加一次（全队）；延奏的全伤害加深也给全队', () => {
    const out = m0Run(gd, { initial: { onField: 2, concerto: [0, 0, 100] }, rotation: ['维里奈 R', 'switch 椿'] })
    const outro = eventsOfLog(out.log, 'outro')[0]!.f
    const apply = eventsOfLog(out.log, 'buffApply').filter(e => e.buff.startsWith('维里奈.'))
    expect(apply.map(e => [e.f, e.buff, e.target])).toEqual([
      [0, '维里奈.固有1', '椿'], [0, '维里奈.固有1', '散华'], [0, '维里奈.固有1', '维里奈'],
      [outro, '维里奈.固有1', '椿'], [outro, '维里奈.固有1', '散华'], [outro, '维里奈.固有1', '维里奈'],
      [outro, '维里奈.延奏', '椿'], [outro, '维里奈.延奏', '散华'], [outro, '维里奈.延奏', '维里奈'],
    ])
  })
})

// ---------------------------------------------------------------------------
// 人造角色

const X = (judgments: ReturnType<typeof judgment>[], endFrame = 40) => action({ id: 'X', kind: 'skill', endFrame, judgments })
const buff = (o: Partial<BuffDefInput> & { id: string }): BuffDefInput =>
  ({ source: 't', zone: 'atkPct', value: 0.5, target: 'self', duration: 600, trigger: { on: 'actionStart' }, ...o }) as BuffDefInput

describe('TD-07 人造角色', () => {
  test('T07-4 先算伤害，后触发：触发它的那次结算不吃它，同一 tick 之后结算的判定吃它', () => {
    const 甲: SynthChar = {
      name: '甲', actions: [X([judgment({ name: 'a', spawnFrame: 10 }), judgment({ name: 'b', spawnFrame: 10 })])],
      buffs: [buff({ id: '甲.攻击', trigger: { on: 'judgmentSettle', where: { judgments: ['a'] } } })],
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const [a, b] = eventsOfLog(out.log, 'hit')
    expect([a!.f, a!.buffs, b!.f, b!.buffs]).toEqual([10, [], 10, ['甲.攻击']])
    expect(b!.dmg!.expected).toBeGreaterThan(a!.dmg!.expected)
  })

  test('T07-5 消耗型"下次…"：消耗它的那次结算吃得到，随后移除；只消耗几层的记一条 buffApply 说明剩下的层数', () => {
    const 甲: SynthChar = {
      name: '甲', actions: [X([judgment({ name: 'j1', spawnFrame: 10 }), judgment({ name: 'j2', spawnFrame: 20 })])],
      buffs: [
        buff({ id: '甲.下次', zone: 'DamageChange', value: 1.2, duration: 300, consume: { on: 'judgmentSettle', where: { judgments: ['j1', 'j2'] } } }),
        buff({ id: '甲.三层', maxStacks: 3, stackGain: 3, consume: { on: 'judgmentSettle', stacks: 1 } }),
      ],
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const [j1, j2] = eventsOfLog(out.log, 'hit')
    expect(j1!.buffs).toEqual(['甲.下次', '甲.三层×3'])
    expect(j2!.buffs).toEqual(['甲.三层×2'])
    expect(at(out.log, 10).filter(x => x.startsWith('-') || x.startsWith('+'))).toEqual(['-甲.下次→甲 removed', '+甲.三层→甲×2 590'])
    expect(at(out.log, 20).filter(x => x.startsWith('+'))).toEqual(['+甲.三层→甲×1 580'])
  })

  test('nextIn 由延奏以外的事件触发：挂起到下一次切入，持续时间从切入那一刻算', () => {
    const 甲: SynthChar = {
      name: '甲', actions: [X([])],
      buffs: [buff({ id: '甲.下一位', target: 'nextIn', duration: 120 })],
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X', 'wait 60', 'switch 乙'] })
    expect(eventsOfLog(out.log, 'buffApply').map(e => [e.f, e.buff, e.target, e.remaining])).toEqual([[60, '甲.下一位', '乙', 120]])
  })

  test('发出者过滤 where.by：self（缺省）只认持有者，team 认任何人，onField 认前台', () => {
    const 乙: SynthChar = {
      name: '乙', actions: [],
      buffs: [
        buff({ id: '乙.自己', trigger: { on: 'actionStart' } }),
        buff({ id: '乙.队伍', trigger: { on: 'actionStart', where: { by: 'team' } } }),
        buff({ id: '乙.前台', trigger: { on: 'actionStart', where: { by: 'onField' } } }),
      ],
    }
    const out = synthRun([{ name: '甲', actions: [X([])] }, 乙, idle('丙')], { rotation: ['甲 X'] })
    expect(eventsOfLog(out.log, 'buffApply').map(e => e.buff)).toEqual(['乙.队伍', '乙.前台'])
  })

  test('标记型 buff：不进伤害收集、不列在 hit.buffs 里；钩子读写，到期事件钩子收得到，覆盖率照算', () => {
    const seen: string[] = []
    const 甲: SynthChar = {
      name: '甲', actions: [X([judgment({ name: 'x', spawnFrame: 10 }), judgment({ name: 'y', spawnFrame: 20 })])],
      buffs: [{ id: '甲.标记', source: 't', target: 'enemy', duration: 30, trigger: { on: 'judgmentSettle', where: { judgments: ['x'] } } }],
      hooks: {
        onEvent: (ctx, ev) => {
          if (ev.type === 'hit' && ev.judgment === 'y') seen.push(`y 时标记 ${ctx.buffStacks('甲.标记', 'enemy')} 层`)
          if (ev.type === 'buffExpire') seen.push(`${ev.f} ${ev.buff} ${ev.reason}`)
        },
      },
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect(eventsOfLog(out.log, 'hit').map(h => h.buffs)).toEqual([[], []])
    expect(seen).toEqual(['y 时标记 1 层', '39 甲.标记 timeout'])       // 第 10 帧施加，30 帧：第 39 帧的 P6 移除
    expect(out.summary.buffUptime['甲.标记→enemy']).toBe(30 / 40)
  })

  test('T07-8 连锁上限：一条事件引出的事件链超过 rules.maxChainDepth 层报错，指出起点', () => {
    const 甲: SynthChar = {
      name: '甲', actions: [action({ id: 'X', endFrame: 10, castGains: [{ atFrame: 0, resource: 'concerto', amount: 1 }] })],
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'resource' && ev.char === '甲') ctx.addResource('core4', 1) } },
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect(out.error).toMatchObject({ code: 'chainDepth', frame: 0 })
    expect(out.error!.message).toContain('事件连锁超过 16 层')
    expect(out.error!.message).toContain('起点是第 0 帧的 甲 concerto +1（cast）')
    expect(eventsOfLog(out.log, 'resource').filter(e => e.cause === 'hook')).toHaveLength(17)   // 第 1–17 层，第 17 层处理时报错
  })
})
