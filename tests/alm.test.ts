// tests/alm.test.ts —— 爱弥斯 · 琳奈 · 莫宁 / 守岸人（2026-10-25，docs/alm-confirm.md）：震谐的干涉与响应、爱弥斯的轨迹与两次光翼共奏、
// 过载 → 终结、莫宁的观测与谐振场、琳奈的绮彩巡游与视觉冲击。依赖 data/generated（缺数据时跳过）
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

dataDescribe('爱琳莫 / 爱琳守', () => {
  let gd: GameData
  const logs: Record<string, SimEvent[]> = {}
  const run = (f: string) => {
    const out = simulate(resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8'))), gd))
    expect(out.error).toBeUndefined()
    expect(out.summary.warnings.filter(w => w.code === 'introMissed')).toEqual([])
    return out.log
  }
  beforeAll(async () => {
    gd = await loadGameData()
    logs['莫'] = run('alm-爱琳莫.yaml')
    logs['守'] = run('alm-爱琳守.yaml')
  }, 120_000)
  /** 第 k 轮里的事件 */
  const loop = (key: string, k: number) => {
    const log = logs[key]!
    const l = log.flatMap(e => (e.type === 'loop' ? [e.f] : []))
    return log.filter(e => e.f >= l[k - 1]! && e.f < l[k]!)
  }

  test('爱琳莫：每轮爱弥斯机兵 A4 后谐度破坏 → 震谐·干涉，三人各响应一次（莫宁在后台也响应）', () => {
    const ev = loop('莫', 2)
    const st = ev.flatMap(e => (e.type === 'enemyState' && ['interference', 'response'].includes(e.change) ? [`${e.change}:${e.by}`] : []))
    expect(st).toEqual(['interference:爱弥斯', 'response:爱弥斯', 'response:琳奈', 'response:莫宁'])
    const hits = ev.filter(e => e.type === 'hit' && e.judgment === '震谐响应')
    expect(hits.map(h => (h as { char: string }).char)).toEqual(['爱弥斯', '琳奈', '莫宁'])
  })

  test('爱琳莫：两次光翼共奏都吃满 30 层轨迹（过载后第一次不消耗），各追加 10 段震谐伤害；之后速蓄 → 强化重击 → 终结', () => {
    const ev = loop('莫', 2)
    const boost = ev.flatMap(e => (e.type === 'buffApply' && e.buff === '爱弥斯.轨迹增幅' ? [e.stacks] : []))
    expect(boost).toEqual([30, 30])
    const extra = ev.filter(e => e.type === 'hit' && e.judgment === '强化E-震谐增幅')
    expect(extra).toHaveLength(20)
    const acts = ev.flatMap(e => (e.type === 'actionStart' && e.char === '爱弥斯' && /大招|强化/.test(e.action) ? [e.action] : []))
    expect(acts).toEqual(['大招1', '机兵·强化E', '强化E', '机兵·强化重击', '大招2'])
  })

  test('爱琳莫：星与星之间满 3 层（三人都挂过偏移或打出震谐伤害）', () => {
    const st = logs['莫']!.flatMap(e => (e.type === 'buffApply' && e.buff === '爱弥斯.星与星之间' ? [e.stacks] : []))
    expect(Math.max(...st)).toBe(3)
  })

  test('莫宁：变奏进观测、展开谐振场（全队偏谐效率 +50%），大招换成强谐振场', () => {
    const ev = loop('莫', 2)
    const applied = ev.flatMap(e => (e.type === 'buffApply' && /^莫宁\.(谐振场|强谐振场)$/.test(e.buff) && e.target === '莫宁' ? [e.buff] : []))
    expect(applied).toEqual(['莫宁.谐振场', '莫宁.强谐振场'])
    expect(ev.some(e => e.type === 'actionStart' && e.action === '观测重击')).toBe(true)
  })

  test('琳奈：灵感碰撞后进绮彩巡游，三段幻光折跃攒满本色放视觉冲击（全队谐破增幅 +40）', () => {
    const ev = loop('莫', 2)
    const acts = ev.flatMap(e => (e.type === 'actionStart' && e.char === '琳奈' ? [e.action] : []))
    expect(acts).toContain('E4')
    expect(ev.some(e => e.type === 'buffApply' && e.buff === '琳奈.视觉冲击' && e.target === '爱弥斯')).toBe(true)
  })

  test('声骸起手的优先级取通用块"召唤声骸 / 变身声骸"行（5），不改共用的声骸定义（假设 echo-input-priority）', () => {
    const r = resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/alm-爱琳守.yaml', import.meta.url), 'utf8'))), gd)
    const q = r.team.map(m => m.actions[m.aliases.Q!]!)
    expect(q.map(a => [a.id, a.summon ?? false, a.inputPriority])).toEqual([['Q·A', true, 5], ['Q·棱镜1', true, 5], ['Q·爆气', true, 5]])
    expect(gd.echoes['无归的谬误']!.actions['Q·爆气']!.inputPriority).toBeUndefined()
  })

  test('爱琳守：守岸人没有响应，干涉时只有爱弥斯、琳奈响应（轨迹 20 层）；谐度破坏隔一轮才赶上一次', () => {
    const log = logs['守']!
    const resp = log.flatMap(e => (e.type === 'enemyState' && e.change === 'response' ? [e.by] : []))
    expect(new Set(resp)).toEqual(new Set(['爱弥斯', '琳奈']))
    const boost = log.flatMap(e => (e.type === 'buffApply' && e.buff === '爱弥斯.轨迹增幅' ? [e.stacks] : []))
    expect(Math.max(...boost)).toBe(20)
  })
})
