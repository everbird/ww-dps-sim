// tests/jms.test.ts —— 景燃 · 莫特斐 · 守岸人（景莫守，2026-10-25，docs/jms-confirm.md）：莫特斐的火焰闪电、怒气值、浮翼狂想的协同攻击
// 与公用冷却、节奏自由、5 链；出场技（景燃阳A2、莫特斐 A4）与"等自己在后台的动作走完再切进来"。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

dataDescribe('景莫守', () => {
  let gd: GameData
  let log: SimEvent[] = []
  beforeAll(async () => {
    gd = await loadGameData()
    const out = simulate(resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/jms-5r18z.yaml', import.meta.url), 'utf8'))), gd))
    expect(out.error).toBeUndefined()
    expect(out.summary.warnings.filter(w => w.code === 'introMissed')).toEqual([])
    log = out.log
  }, 120_000)
  /** 第 k 轮里的事件 */
  const loop = (k: number) => {
    const l = log.flatMap(e => (e.type === 'loop' ? [e.f] : []))
    return log.filter(e => e.f >= l[k - 1]! && e.f < l[k]!)
  }

  test('莫特斐：变奏时怒气值已满，大招后先怒火赋格（E2）再激昂变奏（E1）', () => {
    const acts = loop(2).flatMap(e => (e.type === 'actionStart' && e.char === '莫特斐' && !e.action.endsWith('出场技') ? [e.action] : []))
    expect(acts).toEqual(['QTE', '大招', 'E2', 'E1', 'Q·冥月侍女'])
  })

  test('火焰闪电：前置一生成就爆炸（同一帧）', () => {
    for (const name of ['E1', 'E2', 'QTE']) {
      const pre = loop(2).filter(e => e.type === 'judgmentSpawn' && e.judgment === `${name}-前置`)
      const boom = loop(2).filter(e => e.type === 'hit' && e.judgment === `${name}-爆炸`)
      expect(pre).toHaveLength(1)
      expect(boom.map(e => e.f)).toEqual(pre.map(e => e.f))
    }
  })

  test('浮翼狂想：登场角色的普攻 1 发、重击 2 发，公用冷却 23 帧内不再打（1 链的也算在内）', () => {
    const shots = loop(2).flatMap(e => (e.type === 'hit' && e.judgment === '协同-加强音' && e.action !== 'C5加强音' ? [Math.round(e.t * 60)] : []))
    expect(shots.length).toBeGreaterThan(20)
    const times = [...new Set(shots)]
    for (let k = 1; k < times.length; k++) expect(times[k]! - times[k - 1]!).toBeGreaterThanOrEqual(23)
    // 同一刻最多 2 发（重击、1 链）
    for (const t of times) expect(shots.filter(x => x === t).length).toBeLessThanOrEqual(2)
  })

  test('节奏自由：每发加强音之后加一层，最多 50 层，浮翼狂想结束时清掉', () => {
    const ev = loop(2)
    const stacks = ev.flatMap(e => (e.type === 'buffApply' && e.buff === '莫特斐.节奏自由' ? [e.stacks] : []))
    expect(Math.max(...stacks)).toBeGreaterThan(10)
    expect(Math.max(...stacks)).toBeLessThanOrEqual(50)
    const end = ev.findIndex(e => e.type === 'buffExpire' && /^莫特斐\.浮翼狂想/.test(e.buff) && e.reason === 'timeout')
    expect(end).toBeGreaterThan(-1)
    expect(ev.slice(end).some(e => e.type === 'buffExpire' && e.buff === '莫特斐.节奏自由' && e.reason === 'removed')).toBe(true)
  })

  test('5 链：共鸣技能伤害命中后 4 发额外加强音，吃"伤害降低 50%"', () => {
    const ev = loop(2)
    const c5 = ev.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.action === 'C5加强音')
    expect(c5.length % 4).toBe(0)
    expect(c5.length).toBeGreaterThan(0)
    expect(c5.every(e => e.buffs.some(b => b.startsWith('莫特斐.共鸣链5')))).toBe(true)
  })

  test('出场技：景燃切进来打阳A2-地面出场技接阳A3，莫特斐每轮三次 A4-地面出场技', () => {
    const ev = loop(2)
    const acts = ev.flatMap(e => (e.type === 'actionStart' && e.char === '景燃' ? [e.action] : []))
    const k = acts.indexOf('阳A2-地面出场技')
    expect(acts.slice(k, k + 2)).toEqual(['阳A2-地面出场技', '阳A3'])
    expect(ev.filter(e => e.type === 'actionStart' && e.char === '莫特斐' && e.action === 'A4-地面出场技')).toHaveLength(3)
  })

  test('切人后第一下是出场技、切进来的人自己在后台的动作还没走完：切人等它走完（entryBusy），不报错', () => {
    // 景燃阳A3（94 帧）一起手就切莫特斐，莫特斐出场技之后切回景燃：切人冷却 60 帧过了，阳A3 还在后台
    const sc = parse(readFileSync(new URL('../scenarios/jms-5r18z.yaml', import.meta.url), 'utf8'))
    sc.opening = ['景燃 阳A1 阳A2 阳A3', 'switch 莫特斐', '莫特斐 A4-地面出场技', 'switch 景燃', '景燃 阳A2-地面出场技 阳A3']
    sc.rotation = ['景燃 阳A4']
    sc.options = { ...sc.options, repeat: 1 }
    const out = simulate(resolveScenario(ScenarioSchema.parse(sc), gd))
    expect(out.error).toBeUndefined()
    const w = out.log.filter(e => e.type === 'wait' && e.code === 'entryBusy')
    expect(w).toHaveLength(1)
    expect(w[0]!.type === 'wait' && w[0]!.reason).toMatch(/景燃 在后台的 阳A3 走完/)
    const a3 = out.log.find(e => e.type === 'actionStart' && e.char === '景燃' && e.action === '阳A3')!
    const back = out.log.find(e => e.type === 'switch' && e.to === '景燃')!
    expect(back.f).toBeGreaterThanOrEqual(a3.f + 94)
  })

  test('一轮约 25 秒（作者"严格的 25 秒轴"）', () => {
    const l = log.flatMap(e => (e.type === 'loop' ? [e.t] : []))
    expect(l[2]! - l[1]!).toBeGreaterThan(24.5)
    expect(l[2]! - l[1]!).toBeLessThan(26.5)
  })
})
