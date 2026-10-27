// tests/xin-tower3.test.ts —— 心 · 雷主 · 卜灵 深塔 41 期中 3 的录像剖析（scenarios/xin-tower3-video.yaml，2026-10-26，docs/tower-20261026.md）：
// 第二版（2026-10-27）只照录像读：整局跑得通、前三次切人对上，心的几段在仿真里接得慢；谐度破坏照录像手写；借相切形态。
// 第三版（同日）：镇红尘按跳字往回推起手、E 后转相照录像抢帧、转相第 254 帧降优先级，15 次切人都差不到 2 秒。依赖 data/generated（缺数据时跳过）
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

  test('整局跑得通，15 次切人都出现，都差不到 2 秒（第三版；最多的 113.1 是第三轮心的能量攒得比录像慢）', () => {
    expect(out.error).toBeUndefined()
    const cmp = compareMarks(traceCommands(out.log, r, 1), sc.video!.marks!)
    expect(cmp.missing).toEqual([])
    expect(cmp.rows.length).toBe(15)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(2)
    // 切人类型：前 14 次和录像一致；最后一次雷主 → 心录像是普通（协奏环 0.06），仿真里雷主协奏满了（文档里记着）
    const sw = out.log.filter(e => e.type === 'switch')
    expect(sw.map(e => e.type === 'switch' && e.intro)).toEqual([false, true, true, true, false, true, true, true, false, true, true, true, false, true, true])
  })

  test('谐度破坏只放录像里按 B 的四次（tuneBreak: manual）：前两次打的是小怪，轴里先写"敌人 失谐"；雷主第一次差不到 0.5 秒', () => {
    expect(r.options.tuneBreak).toBe('manual')
    const tb = out.log.filter(e => e.type === 'actionStart' && /谐度破坏/.test(e.action)).map(e => (e.type === 'actionStart' ? [e.char, e.action, e.f / 60 + 11] as const : null)!)
    expect(tb.map(x => `${x[0]} ${x[1]}`)).toEqual(['雷主·男 谐度破坏', '心 照世·谐度破坏', '雷主·男 谐度破坏', '雷主·男 谐度破坏'])
    expect(Math.abs(tb[0]![2] - 28.6)).toBeLessThan(0.5)
    tb.forEach((x, i) => expect(x[2]).toBeGreaterThanOrEqual([28.6, 95.7, 134.8, 183.5][i]! - 0.1))   // 仿真不会比录像早
    const forced = out.log.filter(e => e.type === 'enemyState' && e.change === 'disharmony' && e.detail === '轴里写的（敌人 失谐）')
    expect(forced).toHaveLength(1)                                    // 95.7 那次仿真里目标自己已经失谐了，只把按钮再点亮
    expect(out.summary.assumptions.map(a => a.id)).toContain('forced-disharmony')
    expect(out.summary.assumptions.map(a => a.id)).not.toContain('tune-break-auto')
  })

  test('心的衔接对上录像（第三版）：第二轮镇红尘 → 声骸 / E → 转相 → 照世·E → 万阙连衡 → 万阙垂天，各差不到 0.3 秒', () => {
    // 录像（视频秒）：镇红尘起手约 39.67（跳字 41.5 往回推）、声骸 41.9、E 42.0、转相过场 42.5、照世·E 47.4、万阙连衡 49.0、万阙垂天过场 58.4
    // 转相按 xlsx 整段优先级 10 时照世·E 要等到第 331 帧（约 48.0）；第 254 帧降到 2 以后照世·E 47.4（心模块的覆盖）
    const at = (action: string) => out.log.find(e => e.type === 'actionStart' && e.char === '心' && e.action === action && e.f / 60 + 11 > 37)!.f / 60 + 11
    const want: [string, number][] = [['增幅强化重击', 39.67], ['Q·心召唤', 41.9], ['E', 42.0], ['大招', 42.5], ['照世·E', 47.4], ['照世·强化E', 49.0], ['照世·大招', 58.4]]
    for (const [a, t] of want) expect(Math.abs(at(a) - t), a).toBeLessThan(0.3)
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
