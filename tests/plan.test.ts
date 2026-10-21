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

dataDescribe('套路次数可变（--vary）：M0 视频轴 EQ 版', () => {
  test('次数 ±1：原轴仍排第 1（一轮卡在维里奈、椿 25 秒的大招冷却上，加减一段都接不上）；改了次数的标出差几次；跑出来一样的合成一条', async () => {
    const data = await loadGameData()
    const sc = ScenarioSchema.parse(parse(readFileSync('scenarios/m0-video-eq.yaml', 'utf8')))
    const x = planRotation(sc, data, { width: 3, vary: 1 })
    expect(x.refRank).toBe(1)
    expect(x.leaves[0]!.counts).toEqual({})
    const varied = x.leaves.filter(l => Object.keys(l.counts).length > 0)
    for (const l of varied) {
      expect(l.dps).toBeLessThan(x.ref.dps)
      const n = l.routines.length - x.ref.routines.length
      expect(Object.values(l.counts).reduce((a, b) => a + b, 0)).toBe(n)
    }
    const keys = x.leaves.map(l => `${l.dps.toFixed(6)}|${l.loopSecs}`)
    expect(new Set(keys).size).toBe(keys.length)
  }, 300_000)
})

dataDescribe('另加的套路（场景 search.routines，TD-10 §6.2 ①）', () => {
  test('写法有误直接报错：轴里已有、不是同一角色的出招行、角色不在队伍里', async () => {
    const data = await loadGameData()
    const raw = parse(readFileSync('scenarios/m0-video-eq.yaml', 'utf8'))
    const plan = (routines: unknown[]) => () => planRotation(ScenarioSchema.parse({ ...raw, search: { routines } }), data, { width: 1 })
    expect(plan(['散华 E Q'])).toThrow('轴里已经有了')
    expect(plan(['switch 散华'])).toThrow('不是同一角色的出招行')
    expect(plan([{ line: '心 E', max: 2 }])).toThrow('心 不在队伍里')
    expect(ScenarioSchema.parse({ ...raw, search: { routines: ['维里奈 Q', { line: '散华 E' }] } }).search!.routines).toEqual(['维里奈 Q', { line: '散华 E', max: 1 }])
  })
})
