// tests/scorecard.test.ts —— 轴卡片（TD-10 §6.3）：四个维度各有数、帕累托前沿。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { scorecards, type Scorecard } from '../src/analysis/scorecard'
import { usableBasis } from '../src/engine/basis'
import { runPrepared } from '../src/engine/run'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { preparedScenario } from './helpers/prepared-fixture'
import { idle, synthData, type SynthChar } from './helpers/synth'

test('打死几倍血的各列各自过闸门：基准稳态可用，击杀重跑截断在没打死时不可用，不拿估计值当结论（DD-03 §7.1；Codex 审查 F3）', () => {
  // 甲 E：冷却 30 帧，另有一段 29 帧后才命中的判定；第 140 帧截断时最后一轮的那段还在路上（指令发完、判定在途）
  const 甲: SynthChar = { name: '甲', actions: [action({ id: 'E', endFrame: 1, cooldown: 30, judgments: [judgment({ name: 'hit', spawnFrame: 0, multiplier: 1 }), judgment({ name: 'late', spawnFrame: 0, delayFrames: 29, multiplier: 1 })] })] }
  const data = synthData([甲, idle('乙'), idle('丙')])
  const sc = ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90, hp: 1e12 } },
    rotation: ['甲 E'], options: { tuneBreak: 'manual', repeat: 5, maxFrames: 140 },
  })
  const base = runPrepared(preparedScenario(sc, data))
  expect([base.completion.status, base.completion.truncation?.kind, usableBasis(base).ok]).toEqual(['truncated', 'inFlightRemains', true])   // 前提
  const [card] = scorecards([{ name: '截断', sc }], data)
  expect(card!.kills.map(k => [k.scale, k.secs, k.estimated])).toEqual([[1, null, false], [2, null, false], [3, null, false]])
  expect(card!.kills.every(k => k.error?.startsWith('truncated：到帧数上限时目标还没达到'))).toBe(true)
}, 60_000)

let gd: GameData
let cards: Scorecard[]
const load = (f: string) => ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')))

dataDescribe('轴卡片：M0 视频轴与 D1（维里奈 Q 后移）', () => {
  beforeAll(async () => {
    gd = await loadGameData()
    cards = scorecards([{ name: '视频轴', sc: load('m0-video-eq.yaml') }, { name: 'D1', sc: load('m0-video-eq-维里奈Q后移.yaml') }], gd)
  }, 120_000)

  test('① 目标：稳态口径；打死 1 倍血约 45 秒，3 倍血跑不到、按稳态估', () => {
    const [v] = cards
    expect(v!.goal.label).toMatch(/^稳态/)
    expect(v!.kills[0]).toMatchObject({ scale: 1, estimated: false })
    expect(v!.kills[0]!.secs!).toBeGreaterThan(44)
    expect(v!.kills[0]!.secs!).toBeLessThan(47)
    expect(v!.kills[2]!.estimated).toBe(true)
  })

  test('② 手速档越慢掉得越多；D1 熟练档比视频轴掉得少；每分钟有决策点', () => {
    const [v, d] = cards
    const p = v!.hands.map(h => h.pct!)
    expect(p[0]!).toBeGreaterThan(p[1]!)
    expect(p[1]!).toBeGreaterThan(p[2]!)
    expect(d!.hands[1]!.pct!).toBeGreaterThan(v!.hands[1]!.pct!)
    expect(v!.density.perMin!).toBeGreaterThan(30)
    expect(v!.density.loopSecs!).toBeCloseTo(25, 0)
  })

  test('③ 散华 6 链降到 5 链掉得最多；协奏型武器的阶数不影响（协奏本来有富余）', () => {
    const [v] = cards
    const by = (char: string, what: RegExp) => v!.downgrades.find(d => d.char === char && what.test(d.what))!
    expect(by('散华', /链/).pct!).toBeLessThan(-0.03)
    expect(by('维里奈', /奇幻变奏/).pct!).toBeCloseTo(0, 6)
    expect(v!.energy.find(e => e.char === '维里奈')!.need!).toBeLessThan(v!.energy.find(e => e.char === '维里奈')!.current)
    expect(v!.energy.find(e => e.char === '椿')!.substats).toBe(0)                      // 不用堆
    // 5 星 0 链 1 精：维里奈 3 链 → 0 链、千古洑流精炼 5 → 1（4 星的散华、行进序曲不动）。
    // 2026-10-24 起跑不通：强化空中攻击要光合能量（R2），0 链少了 2 链"施放共鸣技能额外获得 1 点光合能量"，启动轴的"跳AAA"凑不够三层
    expect(v!.baseline.changed).toEqual(['千古洑流 精炼 5 → 1', '维里奈 3 链 → 0 链'])
    expect(v!.baseline.pct).toBeNull()
    expect(v!.baseline.error).not.toBeNull()
    expect(by('维里奈', /链/).error).toBeNull()                                         // 降一档到 2 链还有那 1 点，跑得通
    expect(by('椿', /千古洑流/).pct!).toBeLessThan(-0.02)
  })

  test('④ 列出碰到的假设与变得最多的开关；帕累托：D1 零帧、熟练都更好，视频轴不在前沿', () => {
    const [v, d] = cards
    expect(v!.assumptions).toContain('tune-break-auto')
    expect(v!.fragile).not.toBeNull()
    expect(d!.pareto).toBe(true)
    expect(v!.pareto).toBe(false)
  })
})
