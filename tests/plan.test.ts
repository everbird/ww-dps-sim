// tests/plan.test.ts —— 按套路排轴（TD-10 §6.2 ④ 第一版，⑥ 第 2 步"排回原轴"）
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { generateRoutines, planOpening, planRotation, renderOpening, renderRoutines, routineSequence } from '../src/engine/plan'
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
  test('写成启动轴：开局在前台的角色不用切，第一个套路是别人时先切；补位结尾写"变奏"', () => {
    expect(renderOpening(['甲 A1', '乙 E~', '甲 Q'], '甲')).toEqual(['甲 A1', 'switch 乙', '乙 E~', 'switch 甲 变奏', '甲 Q'])
    expect(renderOpening(['乙 E', '甲 Q'], '甲')).toEqual(['switch 乙', '乙 E', 'switch 甲', '甲 Q'])
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

dataDescribe('启动轴一起排（--opening）：M0 视频轴 EQ 版', () => {
  test('循环轴不动、启动轴的 8 个套路重排，按整个窗口的 DPS 比：原启动轴排第 1；出场技放不出、普通入场后写 A1 的报错剪掉', async () => {
    const data = await loadGameData()
    const sc = ScenarioSchema.parse(parse(readFileSync('scenarios/m0-video-eq.yaml', 'utf8')))
    const x = planOpening(sc, data, { width: 3 })
    expect(x.library).toHaveLength(8)
    expect(x.refRank).toBe(1)
    expect(x.leaves[0]!.dps).toBeCloseTo(x.ref.dps, 6)
    expect(x.failures['entrySkill']).toBeGreaterThan(0)
    expect(x.ref.openingSecs).toBeGreaterThan(20)
  }, 300_000)
})

dataDescribe('自动生成的套路（--gen，TD-10 §6.2 Q6）', () => {
  test('各人单放 E、R、Q；原轴各行在技能 / 大招 / 声骸 / 重击之前拆两半，不在普攻连段、补位中间拆；与原轴重复的不要', async () => {
    const data = await loadGameData()
    const sc = ScenarioSchema.parse(parse(readFileSync('scenarios/m0-video-eq.yaml', 'utf8')))
    const ref = routineSequence(sc.rotation)
    const g = generateRoutines(sc, data, ref)
    expect(g).toEqual(expect.arrayContaining(['维里奈 Q', '椿 R', '维里奈 A3-地面出场技 A4 A5 E', '维里奈 E Q', '散华 E R', '散华 重击居合']))
    expect(g).not.toContain('维里奈 A4 A5 E Q')                     // A4 是连段后续
    expect(g).not.toContain('椿 盛绽·A2 盛绽·A3 盛绽·A4 盛绽·A1 E2')
    expect(g.some(l => ref.includes(l))).toBe(false)
    expect(new Set(g).size).toBe(g.length)
    const xin = ScenarioSchema.parse(parse(readFileSync('scenarios/xin-team-r5.yaml', 'utf8')))
    expect(generateRoutines(xin, data, routineSequence(xin.rotation)).some(l => /^雷主·男 A2~/.test(l))).toBe(false)   // 补位中间不拆
  })
})
