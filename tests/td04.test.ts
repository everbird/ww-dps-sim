// tests/td04.test.ts —— TD-04 仿真内核的用例（§10）
// 真实数据来自当前数据版本（data/generated）的散华、仇远与"通用-中@女"块（按 assembleBlock 装配）；其余为人造动作。
// 期望值里的 f 都是世界帧：动作在 f = s 开始，局部帧 F 的事件在 f = s + F 发生（没有膨胀时）。
import { readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { ActionDef } from '../src/data/gamedata'
import { ticksWithinLife } from '../src/engine/kernel'
import { action, block, dataDescribe, hasData, hitstop, judgment, run } from './helpers/kernel-harness'
import type { Hit, RunResult } from './helpers/kernel-harness'

const common = hasData ? block('通用-中@女') : {}
const sh = hasData ? block('散华') : {}
const TEAM = [{ ...common, ...sh }, { ...common, ...sh }, { ...common, ...sh }]
const at = (r: RunResult, name: string) => r.hits.filter(h => h.judgment === name).map(h => h.f)
const brief = (hs: Hit[]) => hs.map(h => `${h.judgment}@${h.f}`)
const events = (r: RunResult, type: string) => r.s.log.filter(e => e.type === type)
const solo = (defs: Record<string, ActionDef>) => [defs, {}, {}]

dataDescribe('T04-1 帧约定：散华 E 单独出招', () => {
  const r = run(TEAM, [{ act: 0, action: 'E' }])
  test('发生帧 19 → 第 19 帧命中', () => expect(brief(r.hits)).toEqual(['E@19']))
  test('结束帧 96 → 第 96 帧结束，共 96 帧', () => {
    expect(events(r, 'actionEnd').map(e => e.f)).toEqual([96])
    expect(r.frames).toBe(96)
    expect(r.s.battleFrames).toBe(96)
  })
})

describe('T04-2 小数速率与区间边界', () => {
  const slow = { type: '攻击顿帧', anchor: 'action', start: 0, self: { rate: 0.5, duration: 2 } } as const
  const fast = { type: '攻击顿帧', anchor: 'action', start: 0, self: { rate: 3, duration: 1 } } as const
  const win = [{ from: 2, until: 10, row: 0 }]
  const defs = {
    X: action({ id: 'X', endFrame: 20, cancelWindows: win, dilations: [slow] }),
    X0: action({ id: 'X0', endFrame: 20, cancelWindows: win }),
    B: action({ id: 'B', endFrame: 5 }),
    Xs: action({ id: 'Xs', endFrame: 20, dilations: [slow], judgments: [judgment({ name: 'x3', spawnFrame: 3 })] }),
    Y: action({ id: 'Y', endFrame: 20, dilations: [fast], judgments: [1, 2, 3].map(n => judgment({ name: `y${n}`, spawnFrame: n })) }),
  }
  test('派生窗口 [2, 10)：无膨胀时第 2 帧接 B；0.5 倍速 2 帧后局部帧在第 3 帧开头恰为 2.0', () => {
    expect(events(run(solo(defs), [{ act: 0, action: 'X0' }, { act: 0, action: 'B' }]), 'actionStart').map(e => e.f)).toEqual([0, 2])
    expect(events(run(solo(defs), [{ act: 0, action: 'X' }, { act: 0, action: 'B' }]), 'actionStart').map(e => e.f)).toEqual([0, 3])
  })
  test('发生帧 3：局部区间 [3, 4) 落在第 4 帧', () => expect(brief(run(solo(defs), [{ act: 0, action: 'Xs' }]).hits)).toEqual(['x3@4']))
  test('3 倍速一帧走过 [1, 4)：三段同帧按顺序发生', () =>
    expect(brief(run(solo(defs), [{ act: 0, action: 'Y' }]).hits)).toEqual(['y1@1', 'y2@1', 'y3@1']))
})

dataDescribe('T04-3 攻击顿帧推迟派生：散华 A1 → A2', () => {
  const r = run(TEAM, [{ act: 0, action: 'A1' }, { act: 0, action: 'A2' }])
  test('A1 命中后自身 0.05 倍速 5 帧，派生帧 21 推到第 26 帧；A2 在第 51 帧命中', () => {
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 26])
    expect(brief(r.hits)).toEqual(['A1@13', 'A2@51'])
  })
  test('对照：去掉 A1 的顿帧，A2 在第 21 帧开始、第 46 帧命中', () => {
    const A1 = { ...sh['A1']!, judgments: sh['A1']!.judgments.map(j => ({ ...j, hitstop: null })) }
    const r0 = run([{ ...sh, A1 }, {}, {}], [{ act: 0, action: 'A1' }, { act: 0, action: 'A2' }])
    expect(events(r0, 'actionStart').map(e => e.f)).toEqual([0, 21])
    expect(brief(r0.hits)).toEqual(['A1@13', 'A2@46'])
  })
})

dataDescribe('T04-4 派生窗口越过结束帧、连段中断', () => {
  test('A1 在第 46 帧结束；窗口 [21, 50) 在第 54 帧仍开着（局部 49.25），A2 照接', () => {
    const r = run(TEAM, [{ act: 0, action: 'A1' }, { at: 54 }, { act: 0, action: 'A2' }])
    expect(events(r, 'actionEnd').map(e => e.f)).toEqual([46, 123])
    expect(brief(r.hits)).toEqual(['A1@13', 'A2@79'])
  })
  test('第 55 帧窗口已关：报错"连段中断"，不等待', () => {
    let msg = ''
    try { run(TEAM, [{ act: 0, action: 'A1' }, { at: 55 }, { act: 0, action: 'A2' }]) } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('A1 的派生窗口已过，连段中断')
  })
})

dataDescribe('T04-5 中断优先级与"取消不丢东西"', () => {
  test('A1 → E：E（4）可随时打断 A1（2），但默认等 A1 的判定出手（第 14 帧）；E 被 A1 残留的自身顿帧拖到第 37 帧命中', () => {
    const r = run(TEAM, [{ act: 0, action: 'A1' }, { act: 0, action: 'E' }])
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 14])
    expect(brief(r.hits)).toEqual(['A1@13', 'E@37'])
  })
  test('强制在第 5 帧取消：A1 的判定还没出现，作废', () => {
    const r = run(TEAM, [{ act: 0, action: 'A1' }, { at: 5 }, { act: 0, action: 'E', force: true }])
    expect(events(r, 'actionCancel').map(e => e.type === 'actionCancel' && e.dropped)).toEqual([['A1']])
    expect(brief(r.hits)).toEqual(['E@24'])
  })
  test('E → A1：E 的优先级 4 在第 60 帧降为 2（派生帧回退），同时派生窗口打开，A1 第 60 帧开始、第 73 帧命中', () => {
    const r = run(TEAM, [{ act: 0, action: 'E' }, { act: 0, action: 'A1' }])
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 60])
    expect(brief(r.hits)).toEqual(['E@19', 'A1@73'])
  })
  test('E → 闪避：闪避（6）高于 E（4），E 的判定第 19 帧出手后，第 20 帧即可闪避', () => {
    const r = run(TEAM, [{ act: 0, action: 'E' }, { act: 0, action: '闪避' }])
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 20])
  })
})

dataDescribe('T04-6 可脱手与出生帧：散华 重击（重击-2…4 的发生帧 = P + f(Q)，出生帧 11）', () => {
  test('第 12 帧强制闪避：已出现的重击-2…4 转为尾部照常命中，重击-5 作废', () => {
    const r = run(TEAM, [{ act: 0, action: '重击' }, { at: 12 }, { act: 0, action: '闪避', force: true }])
    expect(r.hits.filter(h => h.char === '甲' && h.judgment.startsWith('重击')).map(h => `${h.judgment}@${h.f}`))
      .toEqual(['重击-1@11', '重击-2@15', '重击-3@19', '重击-4@23'])
    expect(events(r, 'actionCancel').map(e => e.type === 'actionCancel' && e.dropped)).toEqual([['重击-5']])
  })
  test('第 10 帧强制闪避：还没出现，全部作废', () => {
    const r = run(TEAM, [{ act: 0, action: '重击' }, { at: 10 }, { act: 0, action: '闪避', force: true }])
    expect(r.hits.filter(h => h.judgment.startsWith('重击'))).toEqual([])
    expect(events(r, 'actionCancel').map(e => e.type === 'actionCancel' && e.dropped.length)).toEqual([5])
  })
})

dataDescribe('T04-7 多段判定与不可脱手：散华 A3（发生帧 18，每 6 帧一次，最多 4 次，不可脱手）', () => {
  test('A1 A2 A3 A4：A3 在 79/85/91/97 结算四次，A4 等第四次结算后于第 98 帧开始', () => {
    const r = run(TEAM, ['A1', 'A2', 'A3', 'A4'].map(a => ({ act: 0 as const, action: a })))
    expect(at(r, 'A3')).toEqual([79, 85, 91, 97])
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 26, 61, 98])
  })
  test('第 88 帧（A3 局部 27）强制闪避：A3 判定被移除，只结算两次', () => {
    const r = run(TEAM, [
      { act: 0, action: 'A1' }, { act: 0, action: 'A2' }, { act: 0, action: 'A3' }, { at: 88 }, { act: 0, action: '闪避', force: true },
    ])
    expect(at(r, 'A3')).toEqual([79, 85])
  })
  test('自然结束后仍存活的不可脱手判定，在该角色开始下一个动作时消失', () => {
    const defs = {
      P: action({ id: 'P', endFrame: 10, judgments: [judgment({ name: 'm', spawnFrame: 2, lifeFrames: 20, ticks: 4, tickInterval: 5, persistsOnCancel: false })] }),
      Q: action({ id: 'Q', endFrame: 5 }),
    }
    expect(at(run(solo(defs), [{ act: 0, action: 'P' }]), 'm')).toEqual([2, 7, 12, 17])
    const r = run(solo(defs), [{ act: 0, action: 'P' }, { act: 0, action: 'Q' }])
    expect(at(r, 'm')).toEqual([2, 7])
    expect(events(r, 'actionStart').map(e => e.type === 'actionStart' && [e.f, e.dropped ?? []])).toEqual([[0, []], [10, ['m']]])
  })
  test('寿命内放不下的次数按实际能结算的算：寿命 18、间隔 6、最多 8 次 → 结算 3 次，第三次（f = 14）之后即就绪', () => {
    const defs = {
      P: action({ id: 'P', endFrame: 40, judgments: [judgment({ name: 'c', spawnFrame: 2, lifeFrames: 18, ticks: 8, tickInterval: 6, persistsOnCancel: false })] }),
      Q: action({ id: 'Q', endFrame: 5, priority: [{ fromFrame: 0, value: 6 }] }),
    }
    const r = run(solo(defs), [{ act: 0, action: 'P' }, { act: 0, action: 'Q' }])
    expect(at(r, 'c')).toEqual([2, 8, 14])
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 15])
  })
})

dataDescribe('T04-8 尾部：仇远 强化A3（结束帧 50；强化A3-3…6 出生帧 20、发生帧 56/74/92/110）', () => {
  const qy = block('仇远')
  const team = [{ ...common, ...qy, 强化A3: { ...qy['强化A3']!, comboFrom: undefined } }, {}, {}]
  const tailHits = (r: RunResult) => r.hits.filter(h => /强化A3-[3-6]/.test(h.judgment)).map(h => h.f)
  test('单独出招：第 52 帧结束（被自身顿帧拖后 2 帧），其后的四段仍按动作时间线命中', () => {
    const r = run(team, [{ act: 0, action: '强化A3' }])
    expect(events(r, 'actionEnd').map(e => e.f)).toEqual([52])
    expect(tailHits(r)).toEqual([57, 75, 93, 111])
  })
  test('第 21 帧闪避取消（默认：出生帧 20 已过即可取消）：四段转为尾部，按战斗时钟准点命中', () => {
    const r = run(team, [{ act: 0, action: '强化A3' }, { act: 0, action: '闪避' }])
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 21])
    expect(tailHits(r)).toEqual([56, 74, 92, 110])
  })
  test('第 15 帧强制取消：还没出现，全部作废', () => {
    const r = run(team, [{ act: 0, action: '强化A3' }, { at: 15 }, { act: 0, action: '闪避', force: true }])
    expect(tailHits(r)).toEqual([])
  })
})

dataDescribe('T04-9 全局时停：散华 大招（局部帧 1 登记，敌 / 友 0 倍速 90 帧）', () => {
  test('战斗时钟停 90 帧；时停中的判定照常在发生帧结算', () => {
    const r = run(TEAM, [{ act: 0, action: '大招' }])
    expect(brief(r.hits)).toEqual(['大招-伤害@72'])
    expect(r.frames).toBe(130)                      // 结束帧 121，另被自身顿帧（0.2 倍速 11 帧）拖后 9 帧
    expect(r.s.battleFrames).toBe(40)               // 130 − 90
  })
  test('切人不打断：乙 E 转入后台后被冻结 90 帧，第 109 帧才命中', () => {
    const r = run(TEAM, [{ act: 1, action: 'E' }, { switch: 0 }, { act: 0, action: '大招' }], { onField: 1 })
    expect(r.hits.map(h => `${h.char}:${h.judgment}@${h.f}`)).toEqual(['甲:大招-伤害@72', '乙:E@109'])
  })
})

dataDescribe('T04-10 时停：散华 QTE（敌 / 友 0 倍速 53 帧，战斗时钟照走）', () => {
  const r = run(TEAM, [{ act: 0, action: 'E' }, { switch: 1 }, { act: 1, action: 'QTE' }])
  test('后台的甲 E 冻结 53 帧：第 72 帧命中；乙 QTE 第 55 帧命中；延奏在第 53 帧触发', () => {
    expect(r.hits.map(h => `${h.char}:${h.judgment}@${h.f}`)).toEqual(['乙:QTE@55', '甲:E@72'])
    expect(r.outros).toEqual([{ f: 53, char: '乙' }])
  })
  test('战斗时钟不停：结束时战斗帧 = 世界帧 = 149', () => {
    expect(r.frames).toBe(149)
    expect(r.s.battleFrames).toBe(149)
  })
})

describe('T04-10b 变奏被打断不影响延奏（延奏是下场角色发出的）', () => {
  const Q = action({ id: 'Q', kind: 'intro', endFrame: 60, outroTriggerFrame: 20 })
  const X = action({ id: 'X', priority: [{ fromFrame: 0, value: 10 }] })
  test('第 5 帧强制打断：延奏触发转为尾部，照样在第 20 帧发生', () => {
    const r = run([{ Q, X }, {}, {}], [{ act: 0, action: 'Q' }, { at: 5 }, { act: 0, action: 'X', force: true }])
    expect(r.s.log.filter(e => e.type === 'actionStart').map(e => e.f)).toEqual([0, 5])
    expect(r.outros).toEqual([{ f: 20, char: '甲' }])
  })
  test('延奏触发不挡"就绪"：不强制也在第 1 帧打断（没有判定要等）', () => {
    const r = run([{ Q, X }, {}, {}], [{ act: 0, action: 'Q' }, { act: 0, action: 'X' }])
    expect(r.s.log.filter(e => e.type === 'actionStart').map(e => e.f)).toEqual([0, 1])
    expect(r.outros).toEqual([{ f: 20, char: '甲' }])
  })
})

describe('T04-11 跟随顿帧', () => {
  const mk = (follow: boolean) => action({
    id: follow ? 'F' : 'N', endFrame: 40, judgments: [
      judgment({ name: 'h', spawnFrame: 2, hitstop: hitstop([0, 10]) }),     // 命中后自身冻结 10 帧
      judgment({ name: 'm', spawnFrame: 2, lifeFrames: 20, ticks: 4, tickInterval: 5, followHitstop: follow }),
    ],
  })
  const defs = { F: mk(true), N: mk(false) }
  test('跟随：多段判定随出伤者冻结，第 2 段起顺延 10 帧', () => expect(at(run(solo(defs), [{ act: 0, action: 'F' }]), 'm')).toEqual([2, 17, 22, 27]))
  test('不跟随：按战斗时钟准点结算', () => expect(at(run(solo(defs), [{ act: 0, action: 'N' }]), 'm')).toEqual([2, 7, 12, 17]))
})

describe('T04-12 攻击顿帧互相替换，时停与之并存', () => {
  const mk = (id: string, second: 'hitstop' | 'stop') => action({
    id, endFrame: 30, judgments: [
      judgment({ name: 'z1', spawnFrame: 1, hitstop: hitstop([0.5, 10]) }),
      judgment({ name: 'z2', spawnFrame: 3, hitstop: second === 'hitstop' ? hitstop([0, 2]) : { type: '时停', anchor: 'hit', start: 0, self: { rate: 0, duration: 2 } } }),
      judgment({ name: 'z3', spawnFrame: 10 }),
    ],
  })
  const defs = { Z: mk('Z', 'hitstop'), Zc: mk('Zc', 'stop') }
  test('第二个攻击顿帧替换第一个：z3 在第 13 帧', () => expect(at(run(solo(defs), [{ act: 0, action: 'Z' }]), 'z3')).toEqual([13]))
  test('换成时停：两者并存取最小，z3 在第 16 帧', () => expect(at(run(solo(defs), [{ act: 0, action: 'Zc' }]), 'z3')).toEqual([16]))
})

dataDescribe('T04-13 极限闪避 → 闪避反击（连段前置 + 减速随取消解除）', () => {
  const r = run(TEAM, [{ act: 0, action: '极限闪避' }, { act: 0, action: '闪避反击' }])
  test('0.6 倍速下局部帧在第 30 帧开头恰为 22.0，派生窗口打开，闪避反击开始', () =>
    expect(events(r, 'actionStart').map(e => e.f)).toEqual([0, 30]))
  test('闪避反击不再受减速：第 49 帧命中', () => expect(brief(r.hits)).toEqual(['闪避反击@49']))
})

dataDescribe('T04-14 全量：74 个块 1721 个动作组（20261003 版），单独出招、连按两次', () => {
  const keys = readdirSync(new URL('../data/generated/actions', import.meta.url)).map(f => f.replace(/\.json$/, ''))
  let groups = 0, spawnMismatch = 0, tickMismatch = 0, errors = 0, minusOneAfterEnd = 0
  for (const key of keys) {
    const b = block(key)
    for (const [id, def0] of Object.entries(b)) {
      groups++
      const def: ActionDef = { ...def0, comboFrom: undefined }
      const team = [{ ...common, ...b, [id]: def }, {}, {}]
      try {
        const r = run(team, [{ act: 0, action: id }], { maxFrames: 20000 })
        run(team, [{ act: 0, action: id }, { act: 0, action: id }], { maxFrames: 20000 })
        const spawnable = def.judgments.filter(j => j.spawnFrame !== null)
        const lost = spawnable.filter(j => j.lifeFrames === -1 && j.spawnFrame! >= def.endFrame).length
        if (lost > 0) minusOneAfterEnd++
        if (events(r, 'judgmentSpawn').length !== spawnable.length - lost) spawnMismatch++
        if (spawnable.every(j => j.lifeFrames !== -1)) {
          const expected = spawnable.reduce((n, j) => n + ticksWithinLife(j), 0)
          if (r.hits.length !== expected) tickMismatch++
        }
      } catch { errors++ }
    }
  }
  test('全部跑完、无异常', () => { expect(groups).toBe(1721); expect(errors).toBe(0) })
  test('生成数 = 有发生帧的判定数（持续帧 -1 且发生帧 ≥ 结束帧的除外，23 组）', () => {
    expect(spawnMismatch).toBe(0)
    expect(minusOneAfterEnd).toBe(23)                                       // 20261003 版（20260707 版 22）
  })
  test('结算次数 = 寿命内放得下的次数', () => expect(tickMismatch).toBe(0))
})
