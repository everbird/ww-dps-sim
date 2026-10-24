// tests/scorecard.test.ts —— 轴卡片（TD-10 §6.3）：四个维度各有数、帕累托前沿。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { scorecards, type Scorecard } from '../src/engine/scorecard'
import { dataDescribe } from './helpers/kernel-harness'

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
