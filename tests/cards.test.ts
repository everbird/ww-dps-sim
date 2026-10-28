// tests/cards.test.ts —— 套路卡（TD-10 §6.2 ②、③、⑥ 第 1 步）：套路怎么拆、队里与单独量的对得上、补位随缺口变、切走太早会被标出来
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type Scenario } from '../src/data/scenario.schema'
import { measureCards, routinesOf, type Card } from '../src/engine/cards'
import { dataDescribe } from './helpers/kernel-harness'

const load = (f: string): Scenario => ScenarioSchema.parse(parse(readFileSync(f, 'utf8')))

describe('套路怎么拆（routinesOf）', () => {
  test('每行同一角色的出招是一个套路，写法一样的算一个；铺垫是同一角色的上一个套路，接自己是下一个套路的第一个动作（循环轴首尾相接）', () => {
    const rs = routinesOf({
      opening: ['甲 A1 E', 'switch 乙', '乙 E'],
      rotation: ['switch 甲', '甲 E  Q', 'switch 乙', '乙 E', '乙 R A1~'],
    })
    expect(rs).toEqual([
      { char: '甲', line: '甲 A1 E', setup: null, next: '甲 E' },
      { char: '乙', line: '乙 E', setup: null, next: '乙 E' },
      { char: '甲', line: '甲 E Q', setup: '甲 A1 E', next: '甲 E' },
      { char: '乙', line: '乙 R A1~', setup: '乙 E', next: '乙 E' },
    ])
  })
})

dataDescribe('套路卡：M0 视频轴 EQ 版（§6.2 ③）', () => {
  let data: GameData
  let cards: Card[]
  const card = (line: string) => cards.find(c => c.line === line)!
  beforeAll(async () => {
    data = await loadGameData()
    cards = measureCards(load('scenarios/m0-video-eq.yaml'), data, {
      lines: ['散华 E R 重击居合', '椿 盛绽·A1 盛绽·A2 盛绽·A3 盛绽·A4 盛绽·A1 E2', '维里奈 A3-地面出场技 A4 A5 E Q'],
    }).cards
  })

  test('入场方式、铺垫、出口相同时，队里每轮的时长与单独量的一样（差 0）', () => {
    const erz = card('散华 E R 重击居合')
    expect(erz.team.filter(t => t.loop >= 1).map(t => [t.entry, t.m.secs.toFixed(2), t.match! < 1e-6])).toEqual(Array(4).fill(['intro', '2.02', true]))   // 2026-10-28 大招过场里的自身顿帧不拖慢（hitstop-in-global-stop）：2.17 → 2.02
    const intro = erz.rows.find(r => !r.setup && r.entry === 'intro' && r.exit === 'switch')!
    expect(intro.m!.secs).toBeCloseTo(2.02, 2)
    // 普通切入少了变奏的时间（散华约 1.05 秒），协奏少一份变奏的量
    const plain = erz.rows.find(r => !r.setup && r.entry === 'switch' && r.exit === 'switch')!
    expect(plain.m!.secs).toBeCloseTo(0.97, 2)                       // 2026-10-28 前 1.12（同上）
    expect(card('椿 盛绽·A1 盛绽·A2 盛绽·A3 盛绽·A4 盛绽·A1 E2').team.every(t => t.match! < 1e-6 && t.m.secs.toFixed(2) === '5.48')).toBe(true)
    expect(card('维里奈 A3-地面出场技 A4 A5 E Q').team.every(t => t.entry === 'switch' && t.match! < 1e-6)).toBe(true)
  })

  test('要前置状态的不铺垫跑不通，标 needsSetup；原因照写', () => {
    const c = card('椿 盛绽·A1 盛绽·A2 盛绽·A3 盛绽·A4 盛绽·A1 E2')
    expect(c.flags).toContain('needsSetup')
    expect(c.rows.find(r => !r.setup)!.error).toContain('要在盛绽状态下')
    expect(c.rows.filter(r => r.setup && r.m).length).toBeGreaterThan(0)
  })
})

dataDescribe('套路卡：心 · 雷主 · 卜灵（§6.2 ③）', () => {
  let data: GameData
  let sc: Scenario
  const SURGE = '雷主·男 A1~ A2~ A3~ A4~ A1~ A2~ A3~ A4~ A1~ A2~ A3~ A4~ 超负荷 Q'
  beforeAll(async () => {
    data = await loadGameData()
    sc = load('scenarios/xin-team-r5.yaml')
  })

  test('补位是参数：进来时电涌已满只打两三下，从零开始 12 下补位全打', () => {
    const [c] = measureCards(sc, data, { lines: [SURGE] }).cards
    const fresh = c!.rows.find(r => !r.setup && r.entry === 'switch' && r.exit === 'switch')!.m!
    expect([fresh.actions, fresh.skipped]).toEqual([14, 0])
    // 只打两三下；第 1 轮电涌还没攒满、打六下（2026-10-25 声骸起手能打断后摇之后一轮变短，echo-input-priority）
    for (const t of c!.team.filter(t => t.loop >= 2)) expect(t.m.skipped).toBeGreaterThanOrEqual(10)
  })

  test('卜灵雷山小过震为雷 QR：队里与铺垫后接着打的一样（1.85 秒）', () => {
    const [c] = measureCards(sc, data, { lines: ['卜灵 雷山小过 震为雷 Q R'] }).cards
    // 有几轮这段中间自动插了谐度破坏（全局时停，战斗秒不走），差 0.1～0.2 秒；其余各轮都对得上。
    // 2026-10-25 声骸起手能打断震为雷的后摇（echo-input-priority）：3.47 → 2.15 秒；
    // 2026-10-28 大招过场里的自身顿帧不拖慢（hitstop-in-global-stop）→ 1.85 秒，10 轮里有 4 轮插了谐度破坏（差 0.22 秒）
    const team = c!.team.filter(t => t.loop >= 1)
    expect(team.filter(t => t.match !== null && t.match < 0.05).length).toBeGreaterThanOrEqual(team.length - 4)
    expect(c!.rows.find(r => r.setup && r.entry === 'field' && r.exit === 'self')!.m!.secs).toBeCloseTo(1.85, 2)
  })

  test('切走太早会被标出来：把雷主大招的切人锁去掉（模拟 2026-10-21 之前的漏读），标 switchAtStart；有锁时不标', () => {
    const line = '雷主·男 A1~ A2~ A3~ A4~ A1~ A2~ A3~ A4~ A1~ A2~ A3~ A4~ R'
    expect(measureCards(sc, data, { lines: [line] }).cards[0]!.flags).not.toContain('switchAtStart')
    const ult = data.characters['雷主·男']!.actions['大招']!
    const saved = ult.switchLockUntil, stop = ult.globalStopUntil
    try {
      delete ult.switchLockUntil
      delete ult.globalStopUntil                                // 2026-10-22 起全局时停另外挡切人，一起去掉才是漏读时的样子
      const [c] = measureCards(sc, data, { lines: [line] }).cards
      expect(c!.flags).toContain('switchAtStart')
      expect(c!.rows.find(r => !r.setup && r.entry === 'intro' && r.exit === 'switch')!.m!.exit).toEqual({ action: '大招', frame: 0 })
    } finally { ult.switchLockUntil = saved; ult.globalStopUntil = stop }
  })
})
