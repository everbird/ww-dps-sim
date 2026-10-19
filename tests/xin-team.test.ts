// tests/xin-team.test.ts —— 心 · 雷主 · 卜灵 队伍（2026-10-19）：带前缀并入的岁主形态、落地段、按角色换技能版本的声骸、
// 三个角色模块的机制（卦象与四式重击、雷法、电髓、两种形态、敕令、电磁+1）。机制用 5 阶奇幻变奏那份（xin-team-r5.yaml，每次都变奏）；
// 1 阶那份（xin-team.yaml）看工具报出"卜灵切雷主没变奏"（docs/xin-confirm.md X1）。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { SimEvent, SimResult } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'
import { eventsOfLog } from './helpers/synth'

let gd: GameData
let out: SimResult      // 5 阶
let r1: SimResult       // 1 阶
const load = (file = 'xin-team-r5.yaml') => resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${file}`, import.meta.url), 'utf8'))), gd)
/** 第 k 轮（0 = 启动轴）的事件 */
function loopEvents(log: readonly SimEvent[], k: number): SimEvent[] {
  const marks = log.filter(e => e.type === 'loop')
  const from = log.indexOf(marks[k]!)
  const to = marks[k + 1] ? log.indexOf(marks[k + 1]!) : log.length
  return log.slice(from, to)
}

dataDescribe('心 · 雷主 · 卜灵', () => {
  beforeAll(async () => {
    gd = await loadGameData()
    out = simulate(load())
    r1 = simulate(load('xin-team.yaml'))
  })

  test('心的岁主形态带前缀并入：动作 ID、块内连段、覆盖都按"照世·"；R 是万阙垂天（收能量），转相不收', () => {
    const a = gd.characters['心']!.actions
    expect(a['照世·强化A2']!.comboFrom).toEqual(['照世·强化A1'])
    expect(a['照世·A1']!.castGains.filter(g => g.resource === 'core2')).toEqual([])      // dropRows 去掉了"A1-150点核心能量"
    expect(a['照世·大招']!.energyCost).toBe(125)
    expect([a['大招']!.kind, a['大招']!.energyCost]).toEqual(['liberation', undefined])
    expect(a['照世·强化E']!.judgments.find(j => j.name === '强化E-1')!.applies).toEqual({ effect: '电磁效应', stacks: 5 })
  })

  test('落地段：卜灵空中攻击下落 38 帧落地，落地那一段第 39 帧出手、第 48 帧结束、第 46 帧起可派生', () => {
    const d = gd.characters['卜灵']!.actions['空中攻击']!
    expect([d.judgments.find(j => j.name === '空中攻击-落地')!.spawnFrame, d.endFrame, d.cancelWindows.map(w => [w.from, w.until])])
      .toEqual([39, 48, [[46, 79]]])
  })

  test('天演溯心按装配的角色换技能版本：心是心召唤，雷主是常规召唤', () => {
    const r = load()
    expect(r.team.map(m => m.aliases.Q)).toEqual(['Q·心召唤', 'Q·常规召唤', 'Q·爆气'])
  })

  test('整条轴跑完；循环里三次切人都是变奏（雷主 ← 心、雷主 ← 卜灵、心 ← 雷主）', () => {
    expect(out.error).toBeUndefined()
    for (const k of [1, 2, 3]) {
      const sw = eventsOfLog(loopEvents(out.log, k), 'switch').map(e => `${e.to}${e.intro ? '变奏' : ''}`)
      expect(sw).toEqual(['雷主·男变奏', '卜灵', '雷主·男变奏', '心变奏'])
    }
  })

  test('X1：奇幻变奏按阶回协奏（1 阶 8、5 阶 16）；1 阶时卜灵只攒到 98.9，工具报"switch 雷主·男 变奏"没变奏（没变奏的那轮协奏留到下一轮，隔一轮一次），5 阶不报', () => {
    const effect = (r: SimResult) => eventsOfLog(r.log, 'resource').find(e => e.char === '卜灵' && e.cause === '奇幻变奏.协奏')!.delta
    expect([effect(r1), effect(out)]).toEqual([8, 16])
    const missed = (r: SimResult) => eventsOfLog(r.log, 'warning').filter(w => w.code === 'introMissed')
      .map(w => [w.cmd!.loop, w.cmd!.line, /卜灵 协奏 ([\d.]+)/.exec(w.message)?.[1]])
    expect(r1.error).toBeUndefined()
    expect(missed(r1)).toEqual([[0, 7, '98.9'], [2, 6, '98.9'], [4, 6, '98.9']])
    expect(missed(out)).toEqual([])
  })

  test('卜灵：卦象从左到右震艮震震，两式重击是雷山小过、震为雷，之后飞雷诀·归一放强化伤害、开阵', () => {
    const ev = loopEvents(out.log, 2)
    const acts = eventsOfLog(ev, 'actionStart').filter(e => e.char === '卜灵').map(e => e.action)
    expect(acts).toEqual(['空中攻击', 'A2', 'E', 'A4#2', '重击-震艮前置', '重击-震震', 'Q·爆气', '大招'])
    const ult = eventsOfLog(ev, 'hit').filter(e => e.char === '卜灵' && e.action === '大招').map(e => e.judgment)
    expect(ult[0]).toBe('大招-强化伤害')
    expect(ult.filter(j => j === '大招-冲击波').length).toBeGreaterThan(0)
  })

  test('雷法：开阵后两次变奏升到三才合一（6 链 +25%），挂在三个人身上、只有前台出伤者吃到', () => {
    const ev = loopEvents(out.log, 2)
    const ups = eventsOfLog(ev, 'buffApply').filter(e => e.buff.startsWith('卜灵.雷法') || e.buff === '卜灵.共鸣链6')
    expect([...new Set(ups.map(e => e.buff))]).toEqual(['卜灵.雷法·两仪交泰', '卜灵.雷法·三才合一', '卜灵.共鸣链6'])
    const hits = eventsOfLog(ev, 'hit').filter(e => e.char === '心' && e.action === '照世·增幅强化重击' && e.dmg)
    expect(hits.every(h => h.buffs.includes('卜灵.雷法·三才合一') && h.buffs.includes('卜灵.共鸣链6'))).toBe(true)
  })

  test('雷主延奏：心拿到电髓，变奏里第一次附加电磁效应就换成全伤害加深 25%', () => {
    const ev = loopEvents(out.log, 2)
    const b = eventsOfLog(ev, 'buffApply').filter(e => e.target === '心' && (e.buff === '雷主·男.电髓' || e.buff === '雷主·男.延奏'))
    expect(b.map(e => e.buff)).toEqual(['雷主·男.电髓', '雷主·男.延奏'])
    const first = eventsOfLog(ev, 'enemyState').find(e => e.change === 'effectApplied' && e.by === '心')!
    expect(b[1]!.f).toBe(first.f)
  })

  test('心：转相进照世相、万阙垂天回应世相；电磁+1 让强化A附加 5 次；敕令每次转相至多 21 次', () => {
    const ev = loopEvents(out.log, 2)
    const acts = eventsOfLog(ev, 'actionStart').filter(e => e.char === '心').map(e => e.action)
    const i = acts.indexOf('大招'), j = acts.indexOf('照世·大招')
    expect(i).toBeGreaterThan(0)
    expect(acts.slice(i + 1, j).every(a => a.startsWith('照世·'))).toBe(true)
    expect(acts.slice(0, i).some(a => a.startsWith('照世·'))).toBe(false)
    const endow = eventsOfLog(ev, 'enemyState').filter(e => e.change === 'effectApplied' && /强化A/.test(e.detail ?? ''))
    expect(endow).toHaveLength(5)
    const strikes = eventsOfLog(out.log, 'hit').filter(e => e.judgment === '协同-飞阙')
    expect(strikes.length).toBeGreaterThan(0)
    expect(strikes.length).toBeLessThanOrEqual(21 * eventsOfLog(out.log, 'actionStart').filter(e => e.char === '心' && e.action === '大招').length)
  })

  test('电磁效应：常规 10 层、电磁爆发 10 层到顶；固有1 两名队友附加后叠满 2 层', () => {
    const st = eventsOfLog(out.log, 'enemyState').filter(e => e.change === 'effectApplied')
    expect(Math.max(...st.map(e => e.stacks!))).toBe(10)
    expect(Math.max(...st.map(e => e.burst!))).toBe(10)
    expect(Math.max(...eventsOfLog(out.log, 'buffApply').filter(e => e.buff === '心.固有1·电磁').map(e => e.stacks))).toBe(2)
  })
})
