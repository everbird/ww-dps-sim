// tests/fire.test.ts —— 三火（嘉贝莉娜 · 达妮娅 · 露帕，2026-10-26，docs/tower-20261026.md）的角色模块与中 1 的录像剖析。
// 达妮娅：两种形态、熵变强化与蚀刻繁彩、虚质粒子下黑A按强化版算、放逐按黯核加倍率、聚爆模态挂层、蚀域；
// 露帕：狼焰与狼魂、追猎加层与你无法逃离、延燃；嘉贝莉娜：罪火满才进恶魔位格、余火、死运既定、恶魔位格 50 战斗秒。依赖 data/generated（缺数据时跳过）
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

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>
const of = <T extends SimEvent['type']>(log: SimEvent[], t: T) => log.filter((e): e is Ev<T> => e.type === t)

dataDescribe('达妮娅', () => {
  let gd: GameData
  const team: ScenarioInput['team'] = [
    {
      char: '达妮娅', chain: 0, weapon: { name: '赝作的矮星', rank: 1 },
      echoes: [
        { name: '达妮娅', set: '斑驳粉饰之沫', main: { 暴击伤害: 0.44, 攻击: 150 } },
        { name: '异相·冠顶苍隼', set: '斑驳粉饰之沫', main: { 热熔伤害加成: 0.3, 攻击: 100 } },
        { name: '双极·星升辉铳', set: '斑驳粉饰之沫', main: { 热熔伤害加成: 0.3, 攻击: 100 } },
        { name: '影烁者', set: '斑驳粉饰之沫', main: { '攻击%': 0.18, 生命: 2280 } },
        { name: '噼啪啪', set: '斑驳粉饰之沫', main: { '攻击%': 0.18, 生命: 2280 } },
      ],
    },
    { char: '散华', chain: 6, weapon: { name: '千古洑流', rank: 1 } },
    { char: '椿', chain: 0, weapon: { name: '千古洑流', rank: 1 } },
  ]
  const run = (rotation: string[]) => {
    const out = simulate(resolveScenario(ScenarioSchema.parse({
      data: '20261019', team, enemy: { preset: '41塔中1/辉萤军势' }, initial: { onField: 0 }, rotation, options: { repeat: 1, maxFrames: 6000 },
    }), gd))
    expect(out.error).toBeUndefined()
    return out.log
  }
  beforeAll(async () => { gd = await loadGameData() })

  const ROT = [
    '达妮娅 白A1 白A2 白A3 白A4 白E 白大招',
    '达妮娅 黑A1 黑A2 黑A3 黑A4 放逐 放逐2 黑A1~ 黑A2~ 黑A3~ 黑A4~ 黑A1~ 黑A2~ 黑A3~ 黑A4~ 黑A1~ 黑A2~ 黑A3~ 黑A4~ 黑R',
    'wait 600',
  ]

  test('白大招切到幻灭之形：熵变·幻灭（攻击 +30%）与蚀刻繁彩（全队热熔 +30%）；黑大招切回布景，换成熵变·布景', () => {
    const log = run(ROT)
    const apply = of(log, 'buffApply')
    const ult = of(log, 'actionStart').find(e => e.action === '白大招')!.f
    expect(apply.filter(e => e.buff === '达妮娅.蚀刻繁彩·幻灭' && e.f === ult).map(e => e.target).sort()).toEqual(['椿', '散华', '达妮娅'].sort())
    const black = of(log, 'actionStart').find(e => e.action === '黑大招')!.f
    expect(apply.some(e => e.buff === '达妮娅.熵变·布景' && e.f === black)).toBe(true)
    expect(of(log, 'buffExpire').some(e => e.buff === '达妮娅.熵变·幻灭' && e.f === black)).toBe(true)
  })

  test('有虚质粒子时黑A按强化版：倍率 ×1.5、共鸣解放伤害、扣虚质粒子；用完后回到普攻', () => {
    const log = run(ROT)
    const a1 = of(log, 'hit').filter(e => e.judgment === '黑A1')
    expect(a1[0]!.tags).toEqual(['共鸣解放'])
    expect(a1.at(-1)!.tags).toEqual(['普攻'])
    expect(a1[0]!.factors!.base / a1.at(-1)!.factors!.base).toBeCloseTo(1.5, 2)
    expect(of(log, 'resource').some(e => e.char === '达妮娅' && e.resource === 'core1' && e.delta === -18)).toBe(true)
  })

  test('放逐第二段消耗全部黯核（进入战斗补到 2 枚），倍率每枚 +150%', () => {
    const log = run(ROT)
    const e2 = of(log, 'hit').find(e => e.judgment === '黑强化E2')!
    const e1 = of(log, 'hit').find(e => e.judgment === '黑强化E1')!
    // 同一时段攻击相同：第二段的基础伤害 / (112.01% + 2 × 150%) = 第一段的基础伤害 / 34.68%
    expect(e2.factors!.base / (1.1201 + 3)).toBeCloseTo(e1.factors!.base / 0.3468, 0)
    expect(of(log, 'resource').filter(e => e.resource === 'core3' && e.delta < 0).map(e => e.delta)).toEqual([-2])
  })

  test('聚爆模态：白A3 / 白A4 各 1 层、白大招 2 层；加到 10 层当场引爆一次', () => {
    const log = run(ROT)
    const applied = of(log, 'enemyState').filter(e => e.change === 'effectApplied' && e.effect === '聚爆效应')
    expect(applied.slice(0, 3).map(e => e.added)).toEqual([1, 1, 2])
    const ticks = of(log, 'effectTick').filter(e => e.effect === '聚爆效应')
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) expect([t.stacks, t.left]).toEqual([10, 0])
  })

  test('黑大招生成蚀域：第 157 帧第一次出伤害，之后每 240 帧一次，30 秒', () => {
    const log = run(ROT)
    const black = of(log, 'actionStart').find(e => e.action === '黑大招')!
    const fs = of(log, 'hit').filter(e => e.judgment === '蚀域-伤害').map(e => e.f)
    expect(fs.length).toBeGreaterThan(3)
    for (let k = 1; k < fs.length; k++) expect(fs[k]! - fs[k - 1]!).toBe(240)
    expect(fs[0]! - black.f).toBeGreaterThanOrEqual(157)
  })
})

dataDescribe('三火深塔 41 期中 1 的录像（露帕、嘉贝莉娜）', () => {
  let log: SimEvent[]
  let cmp: ReturnType<typeof compareMarks>
  beforeAll(async () => {
    const gd = await loadGameData()
    const sc = parse(readFileSync(new URL('../scenarios/fire-tower1-video.yaml', import.meta.url), 'utf8')) as ScenarioInput
    const r = resolveScenario(ScenarioSchema.parse(sc), gd)
    const out = simulate(r)
    expect(out.error).toBeUndefined()
    log = out.log
    cmp = compareMarks(traceCommands(log, r, 1), sc.video!.marks!)
  })
  const starts = (char: string) => of(log, 'actionStart').filter(e => e.char === char)

  test('整局跑得通，9 次切人都出现，和录像差不到 5 秒', () => {
    expect(cmp.missing).toEqual([])
    expect(cmp.rows.length).toBe(9)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(5)
  })

  test('露帕：狼咬、锐爪各消耗 50 点狼焰；大招给全队追猎，每次变奏 +1 层，满 3 层后的变奏是你无法逃离！', () => {
    const res = of(log, 'resource').filter(e => e.char === '露帕' && e.resource === 'core1' && e.delta === -50)
    expect(res.length).toBeGreaterThanOrEqual(2)
    const hunt = of(log, 'buffApply').filter(e => e.buff === '露帕.追猎' && e.target === '露帕').map(e => e.stacks)
    expect(Math.max(...hunt)).toBe(3)
    // 满 3 层以后露帕的变奏都是你无法逃离！（这一局第三轮切露帕时嘉贝莉娜协奏没满，没有变奏，碰不到）
    const full = of(log, 'buffApply').find(e => e.buff === '露帕.追猎' && e.stacks === 3)!
    for (const a of starts('露帕').filter(e => (e.action === 'QTE' || e.action === '强化QTE') && e.f > full.f)) expect(a.action).toBe('强化QTE')
  })

  test('环境特性（nanoka 41 期深境之塔第 1 层）：附加异常效应时的暴伤只给附加的人（队里只有达妮娅附加聚爆效应）', () => {
    const t = of(log, 'buffApply').filter(e => e.buff === '深塔41中1.异常暴伤').map(e => e.target)
    expect(t.length).toBeGreaterThan(0)
    expect(new Set(t)).toEqual(new Set(['达妮娅']))
  })

  test('露帕：狼舞的决意后切走，8 秒内队友放大招，露帕出一次延燃', () => {
    expect(of(log, 'hit').some(e => e.char === '露帕' && e.action === '延燃')).toBe(true)
  })

  test('嘉贝莉娜：恶魔普攻只在恶魔位格里出，余火按层挂上；死运既定最多 4 层；恶魔位格最多 50 战斗秒', () => {
    const e3 = starts('嘉贝莉娜').find(e => e.action === 'E3')!
    const on = of(log, 'buffApply').filter(e => e.buff === '嘉贝莉娜.恶魔位格').map(e => e.f)
    const off = of(log, 'buffExpire').filter(e => e.buff === '嘉贝莉娜.恶魔位格').map(e => e.f)
    for (const a of starts('嘉贝莉娜').filter(e => e.action.startsWith('恶魔'))) {   // 起手扣净炼火扣到 0 的，同一帧退出
      expect(on.some((f, k) => f <= a.f && a.f <= (off[k] ?? Infinity))).toBe(true)
    }
    expect(of(log, 'buffApply').some(e => e.buff === '嘉贝莉娜.余火' && e.f === e3.f && e.stacks > 0)).toBe(true)
    expect(Math.max(...of(log, 'buffApply').filter(e => e.buff === '嘉贝莉娜.死运既定').map(e => e.stacks))).toBe(4)
    // 净炼火耗完提前退出（removed），否则 50 战斗秒到时（timeout）
    const end = of(log, 'buffExpire').find(e => e.buff === '嘉贝莉娜.恶魔位格')!
    if (end.reason === 'timeout') expect(end.t - e3.t).toBeCloseTo(50, 0)
    else expect(end.t - e3.t).toBeLessThan(50)
  })

  test('事件生成的判定（备注推出的 spawns）：露帕破敌的 E3-伤害（投枪命中后，协奏 20）、嘉贝莉娜迫近的 E1-爆炸（踢命中后）；9 次切人都是变奏', () => {
    const n = (char: string, action: string) => starts(char).filter(e => e.action === action).length
    const hits = (char: string, j: string) => of(log, 'hit').filter(e => e.char === char && e.judgment === j)
    expect(n('露帕', 'E3')).toBeGreaterThan(0)
    expect(hits('露帕', 'E3-伤害').length).toBe(n('露帕', 'E3'))
    expect(hits('露帕', 'E3-伤害').every(e => e.gains.concerto === 20)).toBe(true)
    expect(hits('嘉贝莉娜', 'E1-爆炸').length).toBe(n('嘉贝莉娜', 'E1'))
    // 录像里每次切人前协奏环都满了（原来少了破敌的 20 点，露帕 → 达妮娅是普通切人）
    expect(of(log, 'switch').filter(e => !e.intro).length).toBe(1)   // 只有开局切露帕
  })

  test('嘉贝莉娜：恶魔普攻起手扣净炼火扣到 0 也退出恶魔位格；三次变奏上场都在阈限（录像里共鸣回路是灰角）', () => {
    // 原来只在命中扣到 0 时退出，起手扣到 0 的留在恶魔位格里，第二轮上场还是恶魔位格（和录像不符）
    const ends = of(log, 'buffExpire').filter(e => e.buff === '嘉贝莉娜.恶魔位格')
    expect(ends.length).toBeGreaterThan(0)
    for (const end of ends) {
      expect(end.reason).not.toBe('timeout')
      const last = of(log, 'resource').filter(e => e.char === '嘉贝莉娜' && e.resource === 'core1' && e.f <= end.f).at(-1)!
      expect(last.value).toBeLessThanOrEqual(0)
    }
    const on = of(log, 'buffApply').filter(e => e.buff === '嘉贝莉娜.恶魔位格').map(e => e.f)
    const off = ends.map(e => e.f)
    for (const q of starts('嘉贝莉娜').filter(e => e.action === 'QTE')) {
      expect(on.some((f, k) => f <= q.f && q.f < (off[k] ?? Infinity))).toBe(false)
    }
  })
})

dataDescribe('三火深塔 41 期中 2 的录像', () => {
  let log: SimEvent[]
  let cmp: ReturnType<typeof compareMarks>
  beforeAll(async () => {
    const gd = await loadGameData()
    const sc = parse(readFileSync(new URL('../scenarios/fire-tower2-video.yaml', import.meta.url), 'utf8')) as ScenarioInput
    const r = resolveScenario(ScenarioSchema.parse(sc), gd)
    const out = simulate(r)
    expect(out.error).toBeUndefined()
    log = out.log
    cmp = compareMarks(traceCommands(log, r, 1), sc.video!.marks!)
  })

  test('整局跑得通，9 次切人都出现，和录像差不到 5 秒；嘉贝莉娜放了 3 次恶翼扬升、3 次大招', () => {
    expect(cmp.missing).toEqual([])
    expect(cmp.rows.length).toBe(9)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(5)
    const g = of(log, 'actionStart').filter(e => e.char === '嘉贝莉娜')
    expect(g.filter(e => e.action === 'E3').length).toBe(3)
    expect(g.filter(e => e.action === '大招').length).toBe(3)
  })
})
