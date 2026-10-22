// tests/xin-team.test.ts —— 心 · 雷主 · 卜灵 队伍（2026-10-19）：带前缀并入的岁主形态、落地段、按角色换技能版本的声骸、
// 三个角色模块的机制（卦象与四式重击、雷法、电髓、两种形态、敕令、电磁+1），电磁效应的结算（第二步：不减层、霆心域、踏月归心）。机制用 5 阶奇幻变奏那份（xin-team-r5.yaml，每次都变奏）；
// 1 阶那份（xin-team.yaml）看工具报出"卜灵切雷主没变奏"（docs/xin-confirm.md X1）。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { gainSteps, resourceTracks } from '../src/engine/trace'
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

  test('天演溯心按装配的角色换技能版本：心是心召唤，雷主是常规召唤；对照场景里雷主的首位是绝息魄（xin-confirm §6 C1）', () => {
    expect(load().team.map(m => m.aliases.Q)).toEqual(['Q·心召唤', 'Q·常规召唤', 'Q·爆气'])
    expect(load('xin-team-r5-绝息魄.yaml').team.map(m => m.aliases.Q)).toEqual(['Q·心召唤', 'Q·伤害', 'Q·爆气'])
  })

  test('绝息魄在雷主首位（对照场景，只差这一处）：放完 15 秒内雷主延奏，变奏登场的心导电伤害加成 +12%（15 秒），心吃到；天演溯心的首位加成不在雷主身上', () => {
    const jx = simulate(load('xin-team-r5-绝息魄.yaml'))
    const k2 = loopEvents(jx.log, 2)
    expect(eventsOfLog(k2, 'buffApply').filter(e => e.buff === '绝息魄.导电').map(e => [e.target, e.remaining])).toEqual([['心', 900]])
    expect(eventsOfLog(k2, 'hit').some(h => h.char === '心' && h.buffs.includes('绝息魄.导电'))).toBe(true)
    expect(eventsOfLog(jx.log, 'buffApply').some(e => e.buff.startsWith('天演溯心.') && e.target === '雷主·男')).toBe(false)
    // 主场景（天演溯心在首位）没有绝息魄的加成，雷主有天演溯心的首位加成
    expect(eventsOfLog(out.log, 'buffApply').some(e => e.buff === '绝息魄.导电')).toBe(false)
    expect(eventsOfLog(out.log, 'buffApply').some(e => e.buff === '天演溯心.首位' && e.target === '雷主·男')).toBe(true)
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
    expect(missed(r1)).toEqual([[0, 7, '98.9'], ...[2, 4, 6, 8, 10].map(k => [k, 6, '98.9'])])   // 10 轮（TD-10 §2）：隔一轮一次
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

  test('共鸣回路（时间轴检查器）：卜灵卦象的排列、少阳与阴阳相生、开阵后雷法升阶；心的形态与电磁+1；核心资源只列这次有变化的槽', () => {
    const marks = out.log.filter(e => e.type === 'loop')
    const [from, to] = [marks[2]!.f, marks[3]!.f]
    const texts = (char: string) => out.forte.filter(x => x.char === char && x.f >= from && x.f < to).map(x => x.text)
    expect(texts('卜灵').slice(0, 9)).toEqual([
      '卦象 震○○○', '卦象 震艮○○', '卦象 震艮震○', '卦象 震艮震震',              // 空中攻击、A2、E、E 派生 A4
      '卦象 震震○○ · 少阳', '卦象 ○○○○ · 阴阳相生', '卦象 ○○○○',                 // 雷山小过、震为雷；大招用掉阴阳相生
      '卦象 ○○○○ · 开阵 · 雷法一气初动 · 冲击波 0/10', '卦象 ○○○○ · 开阵 · 雷法两仪交泰 · 冲击波 0/10',   // 雷主变奏升一阶
    ])
    expect(texts('卜灵')).toContain('卦象 ○○○○ · 开阵 · 雷法三才合一 · 冲击波 4/10')   // 心变奏再升一阶
    const xin = texts('心')
    const turn = xin.findIndex(t => t.startsWith('照世相'))
    expect(xin.slice(0, turn).every(t => t.startsWith('应世相'))).toBe(true)
    // 霆霓：电磁爆发一加上就被心收成霆心域，队友之后的附加又能进电磁爆发，转相前已攒满 10 层（固有2，含进了电磁爆发的）
    // 承天则（镇寰宇，24 秒一次）按战斗时钟计：2026-10-22 雷主大招补上全局时停后，这一轮转相时还在冷却
    expect(xin[turn]).toBe('照世相 · 心相心生 · 承天则冷却中 · 敕令 21 · 霆霓 10 · 霆心域 49 · 额外能量')
    expect(xin.some(t => t.includes('统御众机') && t.includes('电磁+1 ×5'))).toBe(true)
    const r = load()
    expect(resourceTracks(gainSteps(out.log, r), r).map(x => [x.char, x.tracks.map(t => t.name)])).toEqual([
      ['心', ['能量', '协奏', '应世心', '照世心']], ['雷主·男', ['能量', '协奏', '电涌']], ['卜灵', ['能量', '协奏', '卦象']],
    ])
  })

  test('电磁效应的结算（第二步，TD-06 §18）：心在队伍里时不减层；电磁爆发一加上就被心收成霆心域；踏月归心在应世 E-落地 / 照世 E-2 出伤害；'
    + '霆心域 ≥ 50 才停滞目标；玉阙玄华第 4 条只在心在前台时加在结算上', () => {
    const ticks = eventsOfLog(out.log, 'effectTick')
    expect(ticks.length).toBeGreaterThan(30)
    expect(ticks.every(t => t.effect === '电磁效应' && t.left === t.stacks && t.stacks === 10)).toBe(true)   // 一直顶在 10 层
    const st = eventsOfLog(out.log, 'enemyState')
    const burst = st.filter(e => e.change === 'effectApplied' && (e.burstAdded ?? 0) > 0)
    const taken = st.filter(e => e.change === 'effectConsumed')
    expect(taken).toHaveLength(burst.length)
    expect(taken.every(e => e.by === '心' && e.burst === 0)).toBe(true)
    const hits = eventsOfLog(out.log, 'hit')
    const last = hits.filter(h => h.char === '心' && ((h.action === 'E' && h.judgment === 'E-落地') || (h.action === '照世·E' && h.judgment === 'E-2')))
    const tread = hits.filter(h => h.judgment === '踏月归心·电磁效应')
    expect(tread.length).toBeGreaterThan(0)
    expect(tread.every(h => h.char === '心' && h.effect === '电磁效应' && h.dmg!.expected > 0 && last.some(x => x.f === h.f))).toBe(true)
    const stall = eventsOfLog(out.log, 'judgmentSpawn').filter(e => e.judgment === 'E-停滞')
    expect(stall.length).toBeLessThan(eventsOfLog(out.log, 'actionStart').filter(e => e.char === '心' && e.action === '照世·E').length)
    const settled = hits.filter(h => h.judgment === '电磁效应·定时结算')
    expect(settled.some(h => h.buffs.includes('玉阙玄华.电磁加深'))).toBe(true)
    expect(settled.some(h => !h.buffs.includes('玉阙玄华.电磁加深'))).toBe(true)
  })

  test('电磁效应：常规 10 层、电磁爆发 10 层到顶；固有1 两名队友附加后叠满 2 层', () => {
    const st = eventsOfLog(out.log, 'enemyState').filter(e => e.change === 'effectApplied')
    expect(Math.max(...st.map(e => e.stacks!))).toBe(10)
    expect(Math.max(...st.map(e => e.burst!))).toBe(10)
    expect(Math.max(...eventsOfLog(out.log, 'buffApply').filter(e => e.buff === '心.固有1·电磁').map(e => e.stacks))).toBe(2)
  })
})
