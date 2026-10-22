// tests/matrix.test.ts —— 矩阵计分（src/engine/matrix.ts、docs/matrix.md）：接力（打死、转场作废、溢出、限时）与分数；
// 敌人表"矩8"的血量与 DPM-Team-Builder v4.9.2 的 S2-3 缺省值对得上。依赖 data/generated 的部分缺数据时跳过
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { EnemyPreset, GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { MATRIX_RULES, matrixBosses, matrixOrders, ratioOf, relay, type MatrixBoss, type Tick } from '../src/engine/matrix'
import { dataDescribe } from './helpers/kernel-harness'

const boss = (label: string, round: number, pos: number, hp: number): MatrixBoss =>
  ({ label, round, pos, hp, preset: { id: `敌${pos}`, name: `敌${pos}` } as EnemyPreset })

describe('接力', () => {
  const bosses = [boss('R1-1', 1, 1, 100), boss('R1-2', 1, 2, 100), boss('R1-5', 1, 5, 50)]
  // 每 10 帧一下 10 点：对谁都一样
  const every = (n: number): Tick[] => Array.from({ length: n }, (_, i) => ({ f: i * 10, v: 10 }))

  test('打死一只：伤害封顶到剩余血量，下一只在转场之后才吃伤害，转场里的命中作废', () => {
    const rules = { ...MATRIX_RULES, teamFrames: 60 + 400, transFrames: 90 }
    const t = relay('甲', () => every(100), bosses, { boss: 0, hp: 100 }, rules)
    // 第 1 只：第 0..90 帧 10 下打死（第 90 帧）；第 2 只从第 180 帧起，180..270 打死；第 3 只从 360 帧起，到 400 帧限时 4 下 40 点
    expect(t.segments.map(s => [s.label, s.from, s.to, s.damage, s.killed])).toEqual([
      ['R1-1', 0, 90, 100, true], ['R1-2', 180, 270, 100, true], ['R1-5', 360, 400, 40, false],
    ])
    expect(t.end).toEqual({ boss: 2, hp: 10 })
    expect(t.lostDamage).toBe(16 * 10)   // 两次转场各 8 下（100..170、280..350）
    expect(t.score).toBeCloseTo((100 + 100) / 1e4 * 8.34 + 40 / 1e4 * 9.18, 9)
  })

  test('接着上一队剩的血打；打死第 5 只加分', () => {
    const t = relay('乙', () => every(10), bosses, { boss: 2, hp: 25 }, MATRIX_RULES)
    expect(t.segments).toHaveLength(1)
    expect(t.segments[0]).toMatchObject({ damage: 25, killed: true })
    expect(t.lostDamage).toBe(5)          // 第 3 下打出 10，只用 5
    expect(t.score).toBeCloseTo(25 / 1e4 * 9.18 + 1000, 9)
  })

  test('倍率：第 3 轮起一样，第 5 只按 1.1 倍取整后的值', () => {
    expect([1, 2, 3, 4].map(round => ratioOf({ round, pos: 1 }))).toEqual([8.34, 9.6, 10.43, 10.43])
    expect([1, 2, 3, 7].map(round => ratioOf({ round, pos: 5 }))).toEqual([9.18, 10.55, 11.47, 11.47])
  })
})

dataDescribe('矩8（S2-3、3.7 版）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })

  test('每轮 5 只、血量与 DPM 的缺省值一致；第 4 轮起按第 3 轮单利外推 5%', () => {
    const b = matrixBosses(gd, '矩8')
    expect(b.slice(0, 5).map(x => x.preset.name)).toEqual(['燎照之骑', '封庭械囿', '无冠者', '天傀劫煞', '矩阵奇藏'])
    const wan = (label: string) => Math.round(b.find(x => x.label === label)!.hp / 100) / 100
    expect([wan('R1-1'), wan('R1-2'), wan('R1-5'), wan('R2-1'), wan('R2-5'), wan('R3-1')]).toEqual([561.25, 561.27, 617.38, 954.15, 1275.61, 1938.9])
    expect(b.find(x => x.label === 'R4-1')!.hp).toBeCloseTo(b.find(x => x.label === 'R3-1')!.hp * 1.05, 3)
    expect(b.find(x => x.label === 'R5-2')!.hp).toBeCloseTo(b.find(x => x.label === 'R3-2')!.hp * 1.35, 3)
    expect(() => matrixBosses(gd, '矩99')).toThrow(/不是 5 只/)
  })

  test('两支队的两种出场顺序：按总分排，接力连得上', () => {
    const load = (f: string) => ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')))
    const res = matrixOrders([{ name: 'M0', sc: load('m0-video-eq.yaml') }, { name: '心', sc: load('xin-team.yaml') }], gd, '矩8')
    expect(res).toHaveLength(2)
    expect(res[0]!.score).toBeGreaterThanOrEqual(res[1]!.score)
    for (const r of res) {
      expect(r.teams[1]!.start).toEqual(r.teams[0]!.end)
      expect(r.score).toBeCloseTo(r.teams[0]!.score + r.teams[1]!.score, 6)
      expect(r.score).toBeGreaterThan(0)
    }
  }, 120_000)
})
