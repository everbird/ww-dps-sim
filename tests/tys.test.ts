// tests/tys.test.ts —— 桃祈 · 渊武 · 散华（桃渊散，2026-10-25，docs/tys-confirm.md）：渊武的雷柱（锋芒、协同、掀雷、引爆、敛光、雷厉风行）、
// 桃祈的磐岩护壁与刚柔化势、御反之隙；照录像记的整局（scenarios/tys-video.yaml）每段对得上视频、血条出现后的累计伤害对得上录像。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { compareMarks, traceCommands } from '../src/engine/trace'
import type { SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

dataDescribe('桃渊散', () => {
  let gd: GameData
  let base: ScenarioInput
  const sim = (sc: ScenarioInput) => {
    const r = resolveScenario(ScenarioSchema.parse(sc), gd)
    return { r, out: simulate(r) }
  }
  const run = (rotation: string[], onField = 1) => {
    const { out } = sim({ ...base, video: undefined, initial: { onField }, rotation, options: { repeat: 1, maxFrames: 6000 } })
    expect(out.error).toBeUndefined()
    return out.log
  }
  const hits = (log: SimEvent[], j: string) => log.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.judgment === j)
  beforeAll(async () => {
    gd = await loadGameData()
    base = parse(readFileSync(new URL('../scenarios/tys-video.yaml', import.meta.url), 'utf8'))
  }, 60_000)

  test('渊武：E 第 18 帧立雷柱，每秒 +6 锋芒；登场角色的命中给雷柱协同（1.2 秒一次）；锋芒满 100 放一次掀雷', () => {
    const log = run(['渊武 E A1 A2 A3 A4 A5 A1 A2 A3 A4 A5 A1 A2 A3 A4 A5 A1 A2 A3 A4 A5'])
    const summon = log.find(e => e.type === 'judgmentSpawn' && e.judgment === '雷柱-召唤')!
    expect(summon.f).toBe(18)
    const coord = hits(log, '雷柱-协同').map(e => e.f)
    expect(coord.length).toBeGreaterThan(3)
    for (let k = 1; k < coord.length; k++) expect(coord[k]! - coord[k - 1]!).toBeGreaterThanOrEqual(72)
    const full = log.filter(e => e.type === 'resource' && e.char === '渊武' && e.resource === 'core1' && e.value >= 100)
    expect(full.length).toBeGreaterThan(0)
    expect(hits(log, '雷柱-充能完毕')).toHaveLength(1)            // 满了之后不再重复放
  })

  test('渊武：万壑雷要 100 锋芒，引爆雷柱、进雷厉风行（普攻换强化版）；切走时锋芒没满会自动留雷柱（敛光）', () => {
    // 雷柱 12 秒：中间再按一次 E 立新的，锋芒满了再长按
    const log = run(['渊武 E A1 A2 A3 A4 A5 A1 A2 A3 A4 A5 E A1 A2 A3 A4 A5 A1 A2 A3 A4 A5 E长按 强化A1 强化A2', 'switch 桃祈 变奏', '桃祈 御反之隙-1'])
    expect(hits(log, '雷柱-引爆')).toHaveLength(1)
    const acts = log.flatMap(e => (e.type === 'actionStart' && e.char === '渊武' ? [e.action] : []))
    expect(acts.slice(-3)).toEqual(['E长按', '强化A1', '强化A2'])
    // 万壑雷把锋芒清空，切走时没满：留下一根雷柱
    const sw = log.find(e => e.type === 'switch')!
    expect(log.some(e => e.type === 'judgmentSpawn' && e.judgment === '雷柱-召唤' && e.f === sw.f)).toBe(true)
  })

  test('桃祈：E 生成 3 个磐岩护壁，A4 全换成刚柔化势（3 点）；没有护壁时 A4 不给；御反之隙每段用 1 点、给护盾', () => {
    const log = run(['桃祈 E A1 A2 A3 A4 后发制人 御反之隙-1 御反之隙-2 御反之隙-3 A1 A2 A3 A4'], 0)
    // A4 命中 +3（数据写死）、御反之隙三段各 −1 都在命中里；第二个 A4 没有护壁，钩子把 +3 退掉
    expect(hits(log, '御反之隙-3')).toHaveLength(1)
    const adj = log.filter((e): e is Extract<SimEvent, { type: 'resource' }> => e.type === 'resource' && e.char === '桃祈' && e.resource === 'core1')
    expect(adj.map(e => [e.delta, e.value])).toEqual([[-3, 0]])
    expect(log.filter(e => e.type === 'shield' && e.char === '桃祈')).toHaveLength(3)
    expect(log.some(e => e.type === 'buffApply' && e.buff === '桃祈.护心')).toBe(true)
  })

  test('异构武装（声骸表里没有，extra-echoes.json 补的：帧取 WuwaLAB、倍率连 nanoka）：散华 Q 第 50 帧命中 405% 冷凝，首位加成冷凝与共鸣技能各 12%', () => {
    const { r, out } = sim({ ...base, video: undefined, initial: { onField: 2 }, rotation: ['散华 Q'], options: { repeat: 1, maxFrames: 600 } })
    expect(out.error).toBeUndefined()
    const q = out.log.find(e => e.type === 'actionStart' && e.char === '散华' && e.action === 'Q·幻形')!
    const h = hits(out.log, '幻形-攻击')
    expect(h).toHaveLength(1)
    expect(h[0]!.f - q.f).toBe(50)
    const def = r.team[2]!.actions['Q·幻形']!
    expect([def.endFrame, def.cooldown, def.judgments[0]!.multiplier]).toEqual([82, 1500, 4.05])
    expect(r.buffs.filter(b => b.def.id.startsWith('异构武装.')).map(b => b.value)).toEqual([0.12, 0.12])
  })

  test('照录像记的整局（2026-10-26 逐帧重记）：每段（切人）对到视频的时刻，差不到 2 秒；叹息古龙血条出现后，仿真的累计伤害到 100 秒前和录像的血条差不到 4%', () => {
    const { r, out } = sim(base)
    expect(out.error).toBeUndefined()
    expect(base.purpose).toBe('replay')
    const cmp = compareMarks(traceCommands(out.log, r, 1), base.video!.marks)
    expect(cmp.missing).toEqual([])
    for (const row of cmp.rows) expect(Math.abs(row.diff)).toBeLessThan(2)
    // 世界秒 = 视频秒 − 10.8（场景开头的记法）；血条第一条是它出现的时刻
    const hp = base.video!.hp!.map(l => l.split(' ').map(Number) as [number, number])
    const dmg = (t: number) => out.log.reduce((n, e) => n + (e.type === 'hit' && e.dmg && e.f >= (hp[0]![0] - 10.8) * 60 && e.f <= (t - 10.8) * 60 ? e.dmg.expected : 0), 0)
    for (const [t, left] of hp.filter(([t]) => t <= 100.5)) expect(Math.abs(hp[0]![1] - dmg(t) / r.enemy.hp - left)).toBeLessThan(0.04)
  })
})
