// tests/fit.test.ts —— 录像剖析的贴合度（src/engine/fit.ts，DD-09 §4）在真实场景上：中 3 的各通道、切人晚了变差、变体分两张表、
// 不可评估（DD-03 §8 的 C03-15、C03-16）。合成数据的资格与排序见 tests/fit-eligibility.test.ts。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { CHANNELS, fitVariants, replayFit } from '../src/analysis/fit'
import { prepareRun, runPrepared } from '../src/engine/run'
import type { ResolvedScenario, SimResult } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

dataDescribe('录像剖析的贴合度', () => {
  let sc: Scenario
  let data: GameData
  let r: ResolvedScenario
  let res: SimResult
  beforeAll(async () => {
    sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/xin-tower3-video.yaml', import.meta.url), 'utf8')))
    data = await loadGameData()
    const p = prepareRun(sc, data)
    if (!p.ok) throw new Error(p.issues.map(i => i.message).join('\n'))
    r = p.run.resolved
    res = runPrepared(p.run)
  })

  test('中 3：切人、录像动作、跳字、血条、协奏环、回路条各通道都算上；score = Σ 通道系数 × 平均绝对残差', () => {
    const f = replayFit(r, res, sc.video!)
    expect(f.assessable).toBe(true)
    const by = (c: string) => f.observations.filter(o => o.channel === c)
    expect(by('switch')).toHaveLength(15)
    expect(by('switch').every(o => o.status === 'matched')).toBe(true)                  // 15 次切人类型全对
    expect(Math.max(...by('switch').map(o => Math.abs(o.residual!)))).toBeLessThan(0.5)
    expect(by('action').every(o => o.status === 'matched')).toBe(true)
    expect(by('hp')).toHaveLength(sc.video!.hp!.length)
    expect(f.residualByChannel.hp!.rmse).toBeLessThan(0.03)
    expect(f.residualByChannel.concerto!.rmse).toBeLessThan(0.13)
    expect(f.residualByChannel.concerto!.mean).toBeGreaterThan(0)                     // 卜灵段中间仿真给得早、整体偏高
    expect(f.residualByChannel.core!.rmse).toBeLessThan(0.11)
    const w = { switch: 1, action: 1, summon: 0.5, hit: 50, hp: 50, concerto: 10, core: 10 } as const
    expect(f.score).toBeCloseTo(CHANNELS.reduce((a, c) => a + (f.residualByChannel[c] ? w[c] * f.residualByChannel[c]!.mae : 0), 0), 9)
    // 每个通道的 mae 就是 matched 的评分观测的平均绝对残差
    const hp = by('hp').filter(o => o.status === 'matched').map(o => Math.abs(o.residual!))
    expect(f.residualByChannel.hp!.mae).toBeCloseTo(mean(hp), 12)
  })

  test('切人晚了贴合度变差：开头多等 2 秒，切人的平均差变大', () => {
    const f0 = replayFit(r, res, sc.video!)
    const late = ScenarioSchema.parse({ ...sc, rotation: ['wait 120', ...sc.rotation] })
    const marks = Object.fromEntries(Object.entries(sc.video!.marks).map(([k, v]) => [String(Number(k) + 1), v]))
    const p = prepareRun(late, data)
    if (!p.ok) throw new Error('prepare')
    const f1 = replayFit(p.run.resolved, runPrepared(p.run), { ...sc.video!, marks })
    expect(f1.residualByChannel.switch!.mae).toBeGreaterThan(f0.residualByChannel.switch!.mae)
  })

  test('变体：规则候选与改轴候选分两张表，组里按 score 从小到大', () => {
    const x = fitVariants(sc, data, { n: 4 })
    for (const t of [x.ruleCandidates, x.axisVariants]) for (const g of t.groups) {
      const scores = g.rows.map(row => row.fit!.score!)
      expect(scores).toEqual([...scores].sort((a, b) => a - b))
    }
    expect(x.ruleCandidates.groups.flatMap(g => g.rows).some(row => row.kind === 'rule')).toBe(true)
    expect(x.axisCandidates).toBeGreaterThan(4)
  }, 60_000) // 多个变体各跑完整仿真；验证分表与组内排序，不把默认 5 秒当性能门槛。

  test('C03-15：锚点全部失配时 assessable 为 false、score 为 null', () => {
    const f = replayFit(r, res, { loop: sc.video!.loop, marks: { '9999': '0:01' } })
    expect(f.assessable).toBe(false)
    expect(f.score).toBeNull()
    expect(f.anchors).toBe(0)
  })

  test('C03-16：fitVariants 中把锚点那一条的动作挪没的变体归入 unassessable、不进分组', () => {
    const sc2 = ScenarioSchema.parse({
      team: sc.team,
      enemy: sc.enemy,
      initial: { onField: sc.team.findIndex(m => m.char === '卜灵') },
      opening: [],
      rotation: ['卜灵 A1', '卜灵 A1', '卜灵 A1'],
      options: { repeat: 1 },
      video: { loop: 1, marks: { '3': '0:02' }, events: ['0:01 卜灵 A1'] },
    })
    const x = fitVariants(sc2, data, { n: 60, near: 4, rules: false })
    expect(x.base.assessable).toBe(true)
    expect(x.axisVariants.unassessable.length).toBeGreaterThan(0)
    expect(x.axisVariants.unassessable.every(u => u.fit !== null && !u.fit.assessable && u.fit.score === null)).toBe(true)
    expect(x.axisVariants.groups.flatMap(g => g.rows).every(row => row.fit!.assessable && row.fit!.score !== null)).toBe(true)
  })
})
