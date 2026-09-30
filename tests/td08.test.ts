// tests/td08.test.ts —— TD-08 角色模块的通用能力（§3、§4）：skipJudgments、followUp、canStart、onEvent 收到全部事件
// 角色特有的机制（M0 三人的钩子）等 TD-08 §5 的问题确认后写进 tests/m0-team.test.ts；这里只用人造角色。
import { describe, expect, test } from 'vitest'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthRun, type SynthChar } from './helpers/synth'

const gains = (concerto: number) => ({ energy: 0, concerto, core: [0, 0, 0] as [number, number, number] })

describe('TD-08 通用能力', () => {
  test('P5 skipJudgments（actionStart 里）：跳过的版本不生成、不计入 onCast 协奏，也不挡"就绪"', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [
        action({ id: 'X', endFrame: 60, judgments: [judgment({ name: 'v1', spawnFrame: 10, gains: gains(5) }), judgment({ name: 'v2', spawnFrame: 30, gains: gains(7) })] }),
        action({ id: 'Y', endFrame: 20, priority: [{ fromFrame: 0, value: 5 }] }),
      ],
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'actionStart' && ev.char === '甲' && ev.action === 'X') ctx.skipJudgments(ev.instance, ['v2']) } },
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X Y'] })
    expect(eventsOfLog(out.log, 'hit').map(h => h.judgment)).toEqual(['v1'])
    expect(eventsOfLog(out.log, 'resource').map(e => [e.f, e.delta, e.cause])).toEqual([[0, 5, 'cast']])
    // v1 第 10 帧出手后 X 就算就绪（v2 不会出现），Y 第 11 帧开始；不跳过要等到 v2 之后
    expect(eventsOfLog(out.log, 'actionStart').map(e => [e.f, e.action])).toEqual([[0, 'X'], [11, 'Y']])
    expect(eventsOfLog(out.log, 'actionCancel')[0]!.dropped).toEqual([])
  })

  test('P5 skipJudgments（outro 里）：延奏动作的独立时间线按版本挑判定', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: '延奏', kind: 'outro', endFrame: 30, judgments: [judgment({ name: '普通', spawnFrame: 6 }), judgment({ name: '强化', spawnFrame: 6 })] })],
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'outro' && ev.char === '甲' && ev.instance !== undefined) ctx.skipJudgments(ev.instance, ['强化']) } },
    }
    const 乙: SynthChar = { name: '乙', actions: [action({ id: 'QTE', kind: 'intro', endFrame: 40, outroTriggerFrame: 10, priority: [{ fromFrame: 0, value: 11 }] })] }
    const out = synthRun([甲, 乙, idle('丙')], { initial: { concerto: [100, 0, 0] }, rotation: ['switch 乙'] })
    expect(eventsOfLog(out.log, 'hit').map(h => [h.f, h.char, h.judgment])).toEqual([[16, '甲', '普通']])
  })

  test('P10 followUp：判定第一次结算后立刻开始接续动作，继承指令出处（统计窗口按接续动作算）', () => {
    const 乙: SynthChar = {
      name: '乙',
      actions: [
        action({
          id: 'QTE', kind: 'intro', endFrame: 80, outroTriggerFrame: 30, priority: [{ fromFrame: 0, value: 11 }],
          judgments: [judgment({ name: '冲', spawnFrame: 30, multiplier: 0 })], followUp: { after: '冲', action: 'QTE-撞' },
        }),
        action({ id: 'QTE-撞', kind: 'intro', endFrame: 20, priority: [{ fromFrame: 0, value: 5 }], judgments: [judgment({ name: '撞', spawnFrame: 9 })] }),
      ],
    }
    const out = synthRun([idle('甲'), 乙, idle('丙')], { initial: { concerto: [100, 0, 0] }, rotation: ['switch 乙'] })
    const starts = eventsOfLog(out.log, 'actionStart')
    expect(starts.map(e => [e.f, e.action, e.cmd])).toEqual([
      [0, 'QTE', { line: 1, item: 1, loop: 1 }], [30, 'QTE-撞', { line: 1, item: 1, loop: 1 }],
    ])
    expect(eventsOfLog(out.log, 'actionCancel').map(e => [e.f, e.action, e.by])).toEqual([[30, 'QTE', 'QTE-撞']])
    // 第 30 帧 P4 开始，下一 tick 起推进：局部第 9 帧在第 40 帧；结束帧 20 → 第 51 帧
    expect(eventsOfLog(out.log, 'hit').map(h => [h.f, h.judgment])).toEqual([[30, '冲'], [40, '撞']])
    expect(out.summary.windowFrames).toBe(51)
    expect(eventsOfLog(out.log, 'outro').map(e => e.f)).toEqual([30])   // 延奏触发在冲的结算之前（P3）
  })

  test('canStart：不允许时等待，原因代码 hook，写进等待记录', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', endFrame: 10 })],
      hooks: { canStart: ctx => (ctx.state.frame >= 30 ? true : '还没到第 30 帧') },
    }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect(eventsOfLog(out.log, 'actionStart').map(e => e.f)).toEqual([30])
    expect(out.summary.waits).toEqual([{ line: 1, item: 1, loop: 1, code: 'hook', frames: 30, reason: '还没到第 30 帧' }])
  })

  test('onEvent 收到全部事件，包括队友的', () => {
    const seen: string[] = []
    const 乙: SynthChar = { name: '乙', actions: [], hooks: { onEvent: (_ctx, ev) => { if ('char' in ev && ev.char === '甲') seen.push(ev.type) } } }
    const out = synthRun([{ name: '甲', actions: [action({ id: 'X', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })] }, 乙, idle('丙')], { rotation: ['甲 X'] })
    expect(out.error).toBeUndefined()
    expect(seen).toEqual(['actionStart', 'judgmentSpawn', 'hit', 'actionEnd'])
  })
})
