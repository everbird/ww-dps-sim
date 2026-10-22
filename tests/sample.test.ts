// tests/sample.test.ts —— 抽样模式（总设计 T4）：随机数（rng.ts，Rust 对得上的前几个输出）、逐段抽暴击、操作抖动、多次抽样的分布
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { BuffDefInput } from '../src/data/buff.schema'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { nextFloat, nextNormal, nextU32, runSeeds, seedRng } from '../src/engine/rng'
import { HAND_PROFILES, sampleRuns, statsOf } from '../src/engine/sample'
import { simulate } from '../src/engine/simulate'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

describe('随机数 rng.ts', () => {
  test('种子 1 的状态与前 6 个输出（换语言时拿来对：一个独立的 Python 实现给出同样的数）', () => {
    const s = seedRng(1)
    expect(s).toEqual([2527132011, 314344336, 2535364964, 2041432039])
    expect(Array.from({ length: 6 }, () => nextU32(s))).toEqual([2442144158, 3238099751, 3819917871, 2104621829, 2021136066, 4223536128])
    const f = seedRng(42)
    expect(Array.from({ length: 3 }, () => nextFloat(f))).toEqual([0.6606156826019287, 0.12688004970550537, 0.11170190572738647])
  })

  test('小数在 [0, 1)；各次抽样的种子互不相同', () => {
    const s = seedRng(7)
    for (let i = 0; i < 10000; i++) { const x = nextFloat(s); expect(x >= 0 && x < 1).toBe(true) }
    const seeds = runSeeds(1, 1000)
    expect(new Set(seeds).size).toBe(1000)
  })
})

describe('逐段抽暴击（人造角色，暴击率 50%）', () => {
  const crit: BuffDefInput = { id: '甲.暴击', source: 't', zone: 'critRate', value: 0.45, target: 'self', duration: 'inf', trigger: 'always' }
  const 甲: SynthChar = {
    name: '甲', buffs: [crit],
    actions: [action({ id: 'X', kind: 'skill', endFrame: 200, judgments: [judgment({ name: 'a', spawnFrame: 1, lifeFrames: 200, ticks: 100, tickInterval: 2 })] })],
  }
  const gd = synthData([甲, idle('乙'), idle('丙')])
  const r = resolveScenario(ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 X'],
  }), gd)

  test('期望模式不带 isCrit；抽样模式每段都抽，同一种子结果相同、换种子不同', () => {
    const hits = (o?: { sample: { seed: number } }) => eventsOfLog(simulate(r, o).log, 'hit')
    expect(hits().every(h => h.dmg!.isCrit === undefined)).toBe(true)
    const a = hits({ sample: { seed: 1 } }), b = hits({ sample: { seed: 1 } }), c = hits({ sample: { seed: 2 } })
    expect(a.length).toBe(100)
    expect(a.map(h => h.dmg!.isCrit)).toEqual(b.map(h => h.dmg!.isCrit))
    expect(a.map(h => h.dmg!.isCrit)).not.toEqual(c.map(h => h.dmg!.isCrit))
    const n = a.filter(h => h.dmg!.isCrit).length
    expect(n).toBeGreaterThan(30)
    expect(n).toBeLessThan(70)
  })

  test('多次抽样的平均收敛到期望值（这里没有"暴击时触发"的效果，期望值就是精确值）', { timeout: 30_000 }, () => {
    const x = sampleRuns(r, { runs: 400, seed: 3 })
    expect(x.failed).toBe(0)
    const se = x.stats!.sd / Math.sqrt(400)
    expect(Math.abs(x.stats!.mean - x.expected)).toBeLessThan(4 * se)
  })

  test('statsOf：平均、样本标准差、就近取的分位数', () => {
    expect(statsOf([1, 2, 3, 4, 5])).toEqual({ mean: 3, sd: Math.sqrt(2.5), min: 1, p5: 1, p50: 3, p95: 5, max: 5 })
  })
})

dataDescribe('抽样（M0 代表轴）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  const load = () => resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-team.yaml', import.meta.url), 'utf8'))), gd)

  // 一次 M0 仿真约 0.1 秒：各抽 25 次（种子固定，结果是确定的）；标准差约 3%，25 次的平均误差约 0.6%
  test('只抽暴击：平均与期望值差不到 2%；加操作抖动：平均更低，等待原因里有 input', { timeout: 60_000 }, () => {
    const r = load()
    const plain = sampleRuns(r, { runs: 25, seed: 1 })
    expect(Math.abs(plain.stats!.mean / plain.expected - 1)).toBeLessThan(0.02)
    const jit = sampleRuns(r, { runs: 25, seed: 1, jitter: 6 })
    expect(jit.stats!.mean).toBeLessThan(plain.stats!.mean)
    const one = simulate(r, { sample: { seed: 5, jitter: 6 } })
    expect(eventsOfLog(one.log, 'wait').some(w => w.code === 'input')).toBe(true)
  })
})

describe('手速档（假设 hand-speed）', () => {
  test('nextNormal：一万个的平均约 0、标准差约 1；同一种子结果相同', () => {
    const s = seedRng(7)
    const xs = Array.from({ length: 10_000 }, () => nextNormal(s))
    const st = statsOf(xs)
    expect(Math.abs(st.mean)).toBeLessThan(0.03)
    expect(Math.abs(st.sd - 1)).toBeLessThan(0.03)
    expect(nextNormal(seedRng(7))).toBe(xs[0])
  })
  test('三档的平均依次变大', () => {
    expect([HAND_PROFILES.高手.mean, HAND_PROFILES.熟练.mean, HAND_PROFILES.普通.mean]).toEqual([3, 6, 10])
  })
})

dataDescribe('手速档：M0 视频轴 EQ 版', () => {
  test('高手 > 熟练 > 普通，都低于期望值；同一种子结果相同', async () => {
    const data = await loadGameData()
    const r = resolveScenario(ScenarioSchema.parse(parse(readFileSync('scenarios/m0-video-eq.yaml', 'utf8'))), data)
    const mean = (h: keyof typeof HAND_PROFILES) => sampleRuns(r, { runs: 8, seed: 3, hand: HAND_PROFILES[h] })
    const [a, b, c] = [mean('高手'), mean('熟练'), mean('普通')]
    expect(a.stats!.mean).toBeLessThan(a.expected)
    expect(a.stats!.mean).toBeGreaterThan(b.stats!.mean)
    expect(b.stats!.mean).toBeGreaterThan(c.stats!.mean)
    expect(mean('熟练').dps).toEqual(b.dps)
  }, 120_000)
})
