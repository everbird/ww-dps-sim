// tests/xin-tower3.test.ts —— 心 · 雷主 · 卜灵 深塔 41 期中 3 的录像剖析（scenarios/xin-tower3-video.yaml，2026-10-26，docs/tower-20261026.md）：
// 第二版（2026-10-27）只照录像读：整局跑得通、前三次切人对上，心的几段在仿真里接得慢；借相切形态。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { compareMarks, traceCommands } from '../src/engine/trace'
import type { ResolvedScenario, SimResult } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

dataDescribe('心雷卜深塔 41 期中 3 的录像', () => {
  let sc: ScenarioInput
  let r: ResolvedScenario
  let out: SimResult
  beforeAll(async () => {
    const gd = await loadGameData()
    sc = parse(readFileSync(new URL('../scenarios/xin-tower3-video.yaml', import.meta.url), 'utf8'))
    r = resolveScenario(ScenarioSchema.parse(sc), gd)
    out = simulate(r)
  })

  test('整局跑得通，15 次切人都出现；前三次差不到 0.5 秒，之后心的几段在仿真里接得慢、最多差 11 秒（第二版，只照录像读）', () => {
    expect(out.error).toBeUndefined()
    const cmp = compareMarks(traceCommands(out.log, r, 1), sc.video!.marks!)
    expect(cmp.missing).toEqual([])
    expect(cmp.rows.length).toBe(15)
    for (const x of cmp.rows.slice(0, 3)) expect(Math.abs(x.diff)).toBeLessThan(0.5)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(11)
    // 前三次的切人类型和录像一致（普通、变奏、变奏）；之后心的几段在仿真里拖长，雷主攒协奏的时间跟着变，类型会和录像不同（文档里记着）
    const sw = out.log.filter(e => e.type === 'switch')
    expect(sw.slice(0, 3).map(e => e.type === 'switch' && e.intro)).toEqual([false, true, true])
  })

  test('借相（心相心生里的共鸣解放）切形态：第四轮镇寰宇后借相回应世相放应世 E，再借相回照世相放万阙垂天', () => {
    const acts = out.log.filter(e => e.type === 'actionStart' && e.char === '心').map(e => (e.type === 'actionStart' ? e.action : ''))
    const back = acts.indexOf('照世·借相-地面切换常态')
    const again = acts.indexOf('借相-地面切换岁主')
    expect(back).toBeGreaterThan(acts.lastIndexOf('照世·增幅强化重击', back))
    expect(acts.slice(back, again)).toContain('E')                   // 应世相的共鸣技能
    expect(acts[acts.indexOf('照世·大招', again)]).toBe('照世·大招')     // 回到照世相后放万阙垂天
    expect(acts.slice(back + 1, again).some(a => a.startsWith('照世·'))).toBe(false)
  })

  test('环境特性四条都在，敌人是 41塔中3 的无常凶鹭', () => {
    expect(r.buffs.filter(b => b.owner === 'env').map(b => b.def.id)).toEqual(['深塔41中3.受伤递增', '深塔41中3.抗性', '深塔41中3.变奏', '深塔41中3.电磁'])
    expect(r.enemy.id).toBe('41塔中3/无常凶鹭')
  })
})
