// tests/plan.test.ts —— 按套路排轴（TD-10 §6.2 ④ 第一版，⑥ 第 2 步"排回原轴"）
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { planRotation, renderRoutines, routineSequence } from '../src/engine/plan'
import { dataDescribe } from './helpers/kernel-harness'

describe('套路序列与写回成轴', () => {
  test('循环轴拆成套路：切人行去掉；不是同一角色出招的行（wait…）报错', () => {
    expect(routineSequence(['switch 乙', '乙 E', 'switch 甲 变奏', '甲 A1  A2', '甲 R'])).toEqual(['乙 E', '甲 A1 A2', '甲 R'])
    expect(() => routineSequence(['甲 A1', 'wait 30'])).toThrow('第一版只排')
  })
  test('写回成轴：开头切到第一个套路的角色，角色变了就切；上一个套路以补位结尾的写"变奏"（开头看最后一个套路）', () => {
    expect(renderRoutines(['乙 E', '甲 A1~ A2~', '甲 R', '乙 A1~'])).toEqual([
      'switch 乙 变奏', '乙 E', 'switch 甲', '甲 A1~ A2~', '甲 R', 'switch 乙', '乙 A1~',
    ])
    expect(renderRoutines(['乙 E', '甲 A1~', '乙 Q'])).toEqual(['switch 乙', '乙 E', 'switch 甲', '甲 A1~', 'switch 乙 变奏', '乙 Q'])
  })
})

dataDescribe('排回原轴：M0 视频轴 EQ 版', () => {
  test('8 个套路打乱后重排，原轴排第 1；出场技放不出的（变奏入场、切出者在空中…）调度器报错 entrySkill、被剪掉', async () => {
    const data = await loadGameData()
    const sc = ScenarioSchema.parse(parse(readFileSync('scenarios/m0-video-eq.yaml', 'utf8')))
    const x = planRotation(sc, data, { width: 3 })
    expect(x.library).toHaveLength(8)
    expect(x.refRank).toBe(1)
    expect(x.leaves[0]!.dps).toBeCloseTo(x.ref.dps, 6)
    expect(x.failures['entrySkill']).toBeGreaterThan(0)
    expect(x.leaves.every(l => l.introMissed === 0)).toBe(true)
  }, 120_000)
})
