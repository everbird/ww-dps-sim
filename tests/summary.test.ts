// tests/summary.test.ts —— 汇总（总设计 §3.5）：分轮与稳态（TD-09 §3.7 / §3.9 的边界、Q10 的稳态口径；AGENTS.md 差异 3）
import { describe, expect, test } from 'vitest'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthRun } from './helpers/synth'

describe('分轮与稳态', () => {
  // 甲 X：第 10 帧命中一次，给自己 10 点能量（队友各 5 点）、5 点协奏；结束帧 30。每轮"甲 X、wait 20"
  const 甲 = {
    name: '甲',
    actions: [action({ id: 'X', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gains: { energy: 10, concerto: 5, core: [0, 0, 0] } })] })],
  }

  test('第 k 轮 = [本轮 loop 事件, 下一轮 loop 事件)，最后一轮到窗口终点；每轮的伤害、DPS、资源首尾差', () => {
    const out = synthRun([甲, idle('乙'), idle('丙')], { initial: { energy: 'empty' }, rotation: ['甲 X', 'wait 20'], options: { repeat: 4 } })
    expect(out.error).toBeUndefined()
    const loops = out.summary.perLoop!
    // 下一轮的 X 要等这一轮的 X 结束（同优先级、没有派生窗口）：每轮从第 0、30、60、90 帧起；最后一轮到 X 结束的第 120 帧
    expect(loops.map(p => [p.loop, p.start, p.frames])).toEqual([[1, 0, 30], [2, 30, 30], [3, 60, 30], [4, 90, 30]])
    const one = loops[0]!.damage
    expect(one).toBeGreaterThan(0)
    expect(loops.every(p => p.damage === one && p.dps === one * 2)).toBe(true)          // 30 帧 = 0.5 秒
    expect(loops.map(p => p.energyDelta)).toEqual(Array(4).fill([10, 5, 5]))
    expect(loops.map(p => p.concertoDelta)).toEqual(Array(4).fill([5, 0, 0]))
    expect(out.summary.steady).toEqual({ from: 2, to: 3, frames: 60, damage: one * 2, dps: one * 2 })
  })

  test('只循环 2 轮时稳态取第 2 轮；不循环时没有分轮', () => {
    const two = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'], options: { repeat: 2 } })
    expect(two.summary.steady).toMatchObject({ from: 2, to: 2, frames: 30 })
    const once = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect([once.summary.perLoop, once.summary.steady]).toEqual([undefined, undefined])
  })
})
