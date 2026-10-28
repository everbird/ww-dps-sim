// tests/xin-tower3.test.ts —— 心 · 雷主 · 卜灵 深塔 41 期中 3 的录像剖析（scenarios/xin-tower3-video.yaml，2026-10-26，docs/tower-20261026.md）：
// 第二版（2026-10-27）只照录像读：整局跑得通、前三次切人对上，心的几段在仿真里接得慢；谐度破坏照录像手写；借相切形态。
// 第三版（同日）：镇红尘按跳字往回推起手、E 后转相照录像抢帧、转相第 254 帧降优先级，15 次切人都差不到 2 秒。
// 第四版（同日）：第三轮万阙垂天前写"能量满 心"、194 改回变奏、boss 血条按正确的时间重读、心应世 E 的落地段后移。依赖 data/generated（缺数据时跳过）
// 第五版（2026-10-28）：大招、转相、镇寰宇、万阙垂天钉到 HUD 消失帧（同中 4），超负荷按冷却数字 25.0 出现的那一格，钉住的动作写 !；15 次切人、22 个录像动作都差不到 0.1 秒。
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

  test('整局跑得通，15 次切人都出现，都差不到 0.5 秒、类型都和录像一致（第四版）', () => {
    expect(out.error).toBeUndefined()
    const cmp = compareMarks(traceCommands(out.log, r, 1), sc.video!.marks!)
    expect(cmp.missing).toEqual([])
    expect(cmp.rows.length).toBe(15)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(0.5)
    // 切人类型（切人前一格的协奏环）：最后一次雷主 → 心是 0.95，变奏（第二版读的 0.06 是切人后那一格心自己的环）
    const sw = out.log.filter(e => e.type === 'switch')
    expect(sw.map(e => e.type === 'switch' && e.intro)).toEqual([false, true, true, true, false, true, true, true, false, true, true, true, false, true, true])
  })

  test('第五版：录像动作（大招类钉到 HUD 消失帧、谐度破坏）22 个都差不到 0.1 秒，15 次切人差不到 0.05 秒（超负荷按 10 fps 冷却数字重读后，第二轮雷主 → 心才是变奏）', () => {
    const cmp = compareMarks(traceCommands(out.log, r, 1), sc.video!.marks!)
    for (const x of cmp.rows) expect(Math.abs(x.diff)).toBeLessThan(0.05)
    const starts = out.log.flatMap(e => (e.type === 'actionStart' ? [[e.char, e.action, e.f / 60 + 11] as const] : []))
    const id: Record<string, string> = { 大招: '大招', 转相: '大招', 镇寰宇: '照世·增幅强化重击', 万阙垂天: '照世·大招', 谐度破坏: '谐度破坏', '照世·谐度破坏': '照世·谐度破坏' }
    expect(sc.video!.events).toHaveLength(22)
    for (const ev of sc.video!.events!) {
      const [t, who, act] = ev.split(' ') as [string, string, string]
      const near = starts.filter(([c, a]) => c === who && a === id[act]).map(([, , s]) => s - Number(t))
      expect(Math.min(...near.map(Math.abs)), ev).toBeLessThan(0.1)
    }
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

  test('第三轮万阙垂天：录像 107.4 镇寰宇过场一结束按钮就亮了，仿真能量差约 6 点（多敌人段），轴里写"能量满 心"补满；之后 113.1 切人对上', () => {
    const fill = out.log.filter(e => e.type === 'resource' && e.cause === 'forced')
    expect(fill).toHaveLength(1)
    const f = fill[0]!
    expect(f.type === 'resource' && f.char).toBe('心')
    expect(f.type === 'resource' && f.delta).toBeGreaterThan(0)
    expect(f.type === 'resource' && f.delta).toBeLessThan(15)
    const ult = out.log.find(e => e.type === 'actionStart' && e.char === '心' && e.action === '照世·大招' && e.f >= f.f)!
    expect(Math.abs(ult.f / 60 + 11 - 108.0)).toBeLessThan(0.3)
    expect(out.summary.assumptions.map(a => a.id)).toContain('forced-energy')
  })

  test('心应世 E 的落地段后移（E-落地第 86 帧）：E 后 0.5 秒就转相的三轮都没出踏月归心；第四轮借相回应世放的 E 打完了，出一次', () => {
    const tread = out.log.filter(e => e.type === 'hit' && e.judgment === '踏月归心·电磁效应').map(e => +(e.f / 60 + 11).toFixed(1))
    // 照世 E（E-2，第 90 帧）三轮各一次（录像 47.4 / 97.3 / 146.8 起手）+ 应世 E 一次（161.3 起手）
    expect(tread.filter(t => (t > 141 && t < 142.5) || (t > 90.5 && t < 92) || (t > 42 && t < 43.5))).toEqual([])
    expect(tread.some(t => t > 161.3 && t < 163.5)).toBe(true)
  })

  test('boss 血条（第四版重读）：均方根差不到 2.5%，单点最多不到 7%（大跳字前后差一点时间就差几个百分点：141.5 镇红尘 32 万、197.5 镇红尘 38 万；第五版大招钉到 HUD 消失帧后仿真多打约 1%，197.5 那点 −6.5%）', () => {
    const hp = sc.video!.hp!.map(s => s.split(' ').map(Number) as [number, number])
    const t0 = hp[0]![0]
    const hits = out.log.flatMap(e => (e.type === 'hit' && e.dmg ? [[e.f / 60 + 11, e.dmg.expected] as const] : []))
    const err = hp.map(([t, v]) => hp[0]![1] - hits.reduce((a, [s, d]) => (s >= t0 && s < t ? a + d : a), 0) / r.enemy.hp - v)
    expect(Math.sqrt(err.reduce((a, x) => a + x * x, 0) / err.length)).toBeLessThan(0.025)
    expect(Math.max(...err.map(Math.abs))).toBeLessThan(0.07)
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
