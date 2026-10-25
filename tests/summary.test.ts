// tests/summary.test.ts —— 汇总（总设计 §3.5）：分轮与稳态（TD-09 §3.7 / §3.9 的边界、TD-10 §2 的稳态口径）
import { describe, expect, test } from 'vitest'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
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
    expect(out.summary.steady).toEqual({ from: 2, to: 3, frames: 60, damage: one * 2, dps: one * 2, spread: 0 })   // 各轮一样：窗口挪一轮不变
  })

  test('只循环 2 轮时稳态取第 2 轮；不循环时没有分轮', () => {
    const two = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'], options: { repeat: 2 } })
    expect(two.summary.steady).toMatchObject({ from: 2, to: 2, frames: 30 })
    const once = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    expect([once.summary.perLoop, once.summary.steady]).toEqual([undefined, undefined])
  })

  test('启动轴（opening）是第 0 轮，只跑一次；稳态只看循环轴的轮；报错写"启动第 k 条"', () => {
    const out = synthRun([甲, idle('乙'), idle('丙')], { opening: ['甲 X', 'wait 40'], rotation: ['甲 X'], options: { repeat: 4 } })
    expect(out.error).toBeUndefined()
    const loops = out.summary.perLoop!
    expect(loops.map(p => p.loop)).toEqual([0, 1, 2, 3, 4])
    expect(loops[0]!.frames).toBe(40)                                         // wait 一成为队首就起算（与 X 同时），启动轴 40 帧
    expect(out.summary.steady).toMatchObject({ from: 2, to: 3, frames: 60 })
    const once = synthRun([甲, idle('乙'), idle('丙')], { opening: ['甲 X'], rotation: ['甲 X'] })
    expect(once.summary.perLoop!.map(p => p.loop)).toEqual([0, 1])            // 循环轴只有 1 轮：有分轮，没有稳态
    expect(once.summary.steady).toBeUndefined()
    const bad = synthRun([甲, idle('乙'), idle('丙')], { opening: ['甲 X', 'wait 10', '甲 X'], rotation: ['甲 X'], options: { maxFrames: 20 } })
    expect(bad.error?.message).toContain('启动第 3 条')
  })
})


// 稳态可能受相位影响（2026-10-21）：心队每轮约 36 秒，谐度破坏的周期与轮对不上，4 轮时稳态（第 2–3 轮）忽高忽低
dataDescribe('稳态的相位提示 steadyPhase', () => {
  // 2026-10-22 雷主大招补上全局时停后各轮变短，心队 5 阶原轴 4 轮时各轮次数相同了，改用 1 阶（xin-team.yaml）
  test('心队 1 阶 4 轮：各轮的谐度破坏次数不同（1、1、2、1）、稳态只有 2 轮，提示多跑几轮；10 轮（稳态 8 轮）与 M0 两条轴不提示', async () => {
    const { readFileSync } = await import('node:fs')
    const { parse } = await import('yaml')
    const { loadGameData } = await import('../src/data/load')
    const { ScenarioSchema } = await import('../src/data/scenario.schema')
    const { resolveScenario } = await import('../src/engine/resolve')
    const { simulate } = await import('../src/engine/simulate')
    const data = await loadGameData()
    const run = (file: string, repeat?: number) => {
      const raw = parse(readFileSync(file, 'utf8'))
      if (repeat) raw.options.repeat = repeat
      return simulate(resolveScenario(ScenarioSchema.parse(raw), data)).summary.warnings.filter(w => w.code === 'steadyPhase')
    }
    const four = run('scenarios/xin-team.yaml', 4)
    expect(four).toHaveLength(1)
    expect(four[0]!.message).toMatch(/^稳态只取了 2 轮（第 2–3 轮），可各轮赶上的谐度破坏次数不一样（第 1 轮起依次 1、1、2、1 次）/)
    expect(run('scenarios/xin-team.yaml')).toEqual([])
    expect(run('scenarios/m0-video-eq.yaml')).toEqual([])
    expect(run('scenarios/m0-team.yaml')).toEqual([])    // 第 1、4 轮 DPS 不同是首尾的缘故（从空闲开始、没有下一轮的边界），不算
  }, 120_000)
})

// 误差条与漂移（docs/engine-quality-plan.md P3）：窗口挪一轮、前后两半各算一次 DPS 变多少
dataDescribe('稳态的误差条 steady.spread、漂移提示 steadyDrift 与自动跳过漂移的轮 steadySkip', () => {
  test('心队原轴：三轮一周期来回波动，稳态照旧从第 2 轮起、误差不到 1%；C2 前几轮靠开局的能量，稳态自动从第 5 轮起（2026-10-24）', async () => {
    const { readFileSync } = await import('node:fs')
    const { parse } = await import('yaml')
    const { loadGameData } = await import('../src/data/load')
    const { ScenarioSchema } = await import('../src/data/scenario.schema')
    const { resolveScenario } = await import('../src/engine/resolve')
    const { simulate } = await import('../src/engine/simulate')
    const data = await loadGameData()
    const run = (f: string) => simulate(resolveScenario(ScenarioSchema.parse(parse(readFileSync(`scenarios/${f}`, 'utf8'))), data)).summary
    const base = run('xin-team-r5.yaml'), c2 = run('xin-team-r5-心共鸣效率.yaml')
    expect(base.steady!.from).toBe(2)
    expect(base.steady!.spread).toBeGreaterThan(0)
    expect(base.steady!.spread).toBeLessThan(0.01)
    // C2：第 2–4 轮 66,136 / 65,744 / 62,134，之后各轮在 ±1% 以内；跳过以后两半不再差 1% 以上（原来第 2–9 轮两半差 -3.9%）
    expect(c2.steady).toMatchObject({ from: 5, to: 9 })
    expect(c2.steady!.spread).toBeLessThan(0.01)
    expect(c2.warnings.filter(w => w.code === 'steadyDrift')).toEqual([])
    expect(c2.warnings.find(w => w.code === 'steadySkip')!.message).toMatch(/^稳态从第 5 轮起：第 2–4 轮还在漂移/)
  }, 120_000)
})

// 2026-10-25 景尤守轮椅轴：守岸人"星域治疗计时"每 180 帧到期、钩子同一帧再挂上，到期那一帧原来算了两次，整局不断的覆盖率超过 1（checkLog 报出）
describe('buff 覆盖率 buffUptime', () => {
  test('到期那一帧整帧算在内；同一帧又挂上的从下一帧接着算，不重复', async () => {
    const { buffUptime } = await import('../src/engine/summary')
    const ev = (type: 'buffApply' | 'buffExpire', f: number) =>
      (type === 'buffApply'
        ? { type, f, t: f / 60, buff: '甲.计时', target: '甲', stacks: 1, remaining: 180 }
        : { type, f, t: f / 60, buff: '甲.计时', target: '甲', reason: 'timeout' }) as unknown as import('../src/engine/types').SimEvent
    // 第 0 帧挂上，第 179、359 帧到期并当帧续上，第 540 帧窗口结束
    const log = [ev('buffApply', 0), ev('buffExpire', 179), ev('buffApply', 179), ev('buffExpire', 359), ev('buffApply', 359)]
    expect(buffUptime(log, 0, 540)['甲.计时→甲']).toBe(1)
    // 到期后隔几帧再挂：中间空着的不算
    const gap = [ev('buffApply', 0), ev('buffExpire', 179), ev('buffApply', 200)]
    expect(buffUptime(gap, 0, 300)['甲.计时→甲']).toBe((180 + 100) / 300)
  })
})
