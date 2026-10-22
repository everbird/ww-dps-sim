// tests/wuwalab.test.ts —— 与 WuwaLAB 动作数据的核对（src/data/wuwalab-check.ts，docs/engine-quality-plan.md P5）：按倍率配对、报出差异
import { describe, expect, test } from 'vitest'
import { crosscheckWuwalab, type WlAbility } from '../src/data/wuwalab-check'
import { action, judgment } from './helpers/kernel-harness'

const ab = (o: Partial<WlAbility> & { name: string; hits: WlAbility['hits'] }): WlAbility => ({
  total_frames: 60, earliest_frame_cancel: 30, no_swap: 0, time_stop: 0, cooldown: null, priority_timeline: [[0, 2]],
  on_cast_energy: 0, on_cast_concerto: 0, ...o,
})
const hit = (frame: number, mv: number, energy = 0, concerto = 0) => ({ frame, motion_value: mv * 10000, energy: energy * 100, concerto: concerto * 100 })

describe('WuwaLAB 核对', () => {
  const acts = {
    X: action({ id: 'X', judgments: [judgment({ name: 'x', spawnFrame: 10, multiplier: 0.5, gains: { energy: 2, concerto: 3, core: [0, 0, 0] } })] }),
    R: action({
      id: 'R', kind: 'liberation', switchLockUntil: 225, globalStopUntil: 225, cooldown: 1500, priority: [{ fromFrame: 0, value: 10 }],
      judgments: [judgment({ name: 'r', spawnFrame: 190, multiplier: 4 })],
    }),
  }
  test('倍率对上、各项一致：没有差异', () => {
    const rows = crosscheckWuwalab(acts, [ab({ name: 'Basic', hits: [hit(11, 0.5, 2, 3)] })])
    expect(rows).toEqual([{ ability: 'Basic', action: 'X', alternatives: 0, diffs: [] }])
  })
  test('命中帧、时停、冷却、能量、协奏、优先级各报一条；倍率没对上的单列', () => {
    const rows = crosscheckWuwalab(acts, [
      ab({ name: 'Basic', hits: [hit(20, 0.5, 1, 3)], priority_timeline: '[[0,2],[30,1]]' }),
      ab({ name: 'Lib', hits: [hit(190, 4)], time_stop: 180, cooldown: 1200, priority_timeline: [[0, 10]] }),
      ab({ name: 'Other', hits: [hit(5, 9.9)] }),
    ])
    expect(rows[0]!.diffs).toEqual(['命中帧（WuwaLAB − 我们）10', '各击能量 WuwaLAB 1 / 我们 2', '优先级 WuwaLAB 0:2 30:1 / 我们 0:2'])
    expect(rows[1]!.diffs).toEqual(['时停 WuwaLAB 180 / 我们全局时停到 225', '切人 WuwaLAB no_swap 0、时停 180 / 我们锁到 225', '冷却 WuwaLAB 1200 / 我们 1500'])
    expect(rows[2]).toMatchObject({ action: null, diffs: ['倍率 9.900 没对上'] })
  })
})
