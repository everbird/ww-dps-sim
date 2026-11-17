// tests/insight.test.ts —— 操作延迟 options.inputDelay（TD-09 §3、总设计 T4）与结论（TD-10 §6）
import { runPrepared } from '../src/engine/run'
import { fixturePreparedRun } from './helpers/prepared-fixture'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { panelsOf } from '../src/analysis/analysis'
import { insight, mergeOverrides } from '../src/analysis/insight'
import { sensitivityMatrix } from '../src/analysis/sensitivity'
import { resolveScenario } from '../src/engine/resolve'

import { action, dataDescribe } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, synthRun, type SynthChar } from './helpers/synth'

describe('操作延迟 options.inputDelay', () => {
  const 甲: SynthChar = { name: '甲', actions: [action({ id: 'X', kind: 'skill', endFrame: 30 }), action({ id: 'Y', kind: 'skill', endFrame: 30 })] }
  const run = (inputDelay?: number, rotation = ['甲 X Y']) =>
    synthRun([甲, idle('乙'), idle('丙')], { rotation, ...(inputDelay !== undefined ? { options: { inputDelay } } : {}) })
  const starts = (out: ReturnType<typeof run>) => eventsOfLog(out.log, 'actionStart').map(e => [e.action, e.f])

  test('缺省 0：最早合法帧；写 N：每条出招合法之后再晚 N 帧，等待原因 input，不进汇总的 waits', () => {
    expect(starts(run())).toEqual([['X', 0], ['Y', 30]])
    const out = run(5)
    expect(starts(out)).toEqual([['X', 5], ['Y', 5 + 30 + 5]])   // X 第 5 帧开始、第 35 帧结束，Y 再晚 5 帧
    expect(eventsOfLog(out.log, 'wait').filter(w => w.code === 'input').map(w => [w.cmd.item, w.frames])).toEqual([[1, 5], [2, 5]])
    expect(out.summary.waits.some(w => w.code === 'input')).toBe(false)
  })

  test('切人也是决策点：切人冷却之外再晚 N 帧', () => {
    const out = run(4, ['甲 X', 'switch 乙'])
    expect(eventsOfLog(out.log, 'switch').map(e => e.f)).toEqual([4 + 4])   // X 在第 4 帧开始；切人从第 4 帧起就合法（切人冷却 0），再晚 4 帧
  })

  test('+N 与操作延迟相加：先 +N，再操作延迟', () => {
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X Y+10'], options: { inputDelay: 3 } })
    expect(starts(out)).toEqual([['X', 3], ['Y', 3 + 30 + 10 + 3]])   // X 第 3 帧开始、第 33 帧结束；+10 之后再晚 3 帧
  })
})

describe('命令行的 --strict 经 RunOverrides 进运行，不写回场景（DD-01 §3.2、DD-02 §3.1；Codex 审查补查第 5 条）', () => {
  const 甲: SynthChar = { name: '甲', actions: [action({ id: 'X', kind: 'skill', endFrame: 30 })] }
  const data = synthData([甲, idle('乙'), idle('丙')])
  // 缺省自动谐破：严格入口要拒绝（strict.tuneBreakAuto）；场景本身没写 strict
  const sc = ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 X'] })

  test('mergeOverrides：后一份优先，rules / options / inputDelayAt / panelDeltas 逐键合并', () => {
    expect(mergeOverrides({ strict: true, rules: { a: 1 }, options: { inputDelay: 3 } }, { rules: { b: 2 }, inputDelayAt: { '1.1': 6 } }))
      .toEqual({ strict: true, rules: { a: 1, b: 2 }, options: { inputDelay: 3 }, inputDelayAt: { '1.1': 6 } })
    expect(mergeOverrides({ options: { inputDelay: 3 } }, { options: { inputDelay: 6 } })).toEqual({ options: { inputDelay: 6 } })
  })

  test('insight、敏感度矩阵：基础覆盖的 strict 用上了（严格入口拒绝自动谐破），场景对象原样不动', () => {
    const before = structuredClone(sc)
    expect(() => insight(sc, data, { tight: 0, overrides: { strict: true } })).toThrow(/tuneBreakAuto/)
    expect(insight(sc, data, { tight: 0 }).basis.dps).toBeGreaterThanOrEqual(0)
    const m = sensitivityMatrix([{ name: 'x', sc }], data, undefined, { strict: true })
    expect(m.rows[0]!.base).toMatchObject({ dps: null, status: 'engineError', error: expect.stringContaining('tuneBreakAuto') })
    expect(sc).toEqual(before)
  })
})

dataDescribe('结论（M0 代表轴）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  const source = () => ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-team.yaml', import.meta.url), 'utf8')))
  const load = () => resolveScenario(source(), gd)

  test('连段的后续（有 comboFrom 的动作）不加操作延迟：玩家会预输入', () => {
    const r = load()
    const out = runPrepared(fixturePreparedRun({ ...r, options: { ...r.options, inputDelay: 6 } }))
    expect(out.error).toBeUndefined()
    const inputs = eventsOfLog(out.log, 'wait').filter(w => w.code === 'input')
    expect(inputs.length).toBeGreaterThan(0)
    for (const w of inputs) {
      const c = (w.cmd.loop === 0 ? r.opening : r.commands).find(x => x.line === w.cmd.line && x.item === w.cmd.item)!
      if (c.kind === 'act') expect([c.action, r.team[c.slot].actions[c.action]!.comboFrom ?? []]).toEqual([c.action, []])
    }
  }, 60_000)

  test('四项结论：能量需求不高于现在（这条轴不等能量）、操作越晚 DPS 越低、敏感度列出能翻的假设', () => {
    const x = insight(source(), gd, { delays: [0, 3, 6], tight: 0 })
    expect(x.energy.map(e => e.char)).toEqual(['椿', '散华', '维里奈'])
    for (const e of x.energy) {
      expect(e.waitSecs).toBe(0)
      expect(e.need).not.toBeNull()
      expect(e.need!).toBeLessThanOrEqual(e.current + 1e-9)
      expect(e.need!).toBeGreaterThanOrEqual(e.floor)
      expect(e.floor).toBeGreaterThanOrEqual(1)
    }
    // 下限 = 面板 100% + 常驻 buff（椿千古洑流 25.6%、散华轻云出月 2 件 10%）。椿、散华最低就是下限：不堆共鸣效率也够；维里奈要的比下限高
    expect(x.energy.map(e => e.floor)).toEqual([expect.closeTo(1.256, 9), expect.closeTo(1.1, 9), 1])
    expect(x.energy[0]!.need).toBe(x.energy[0]!.floor)
    expect(x.energy[1]!.need).toBe(x.energy[1]!.floor)
    expect(x.energy[2]!.need!).toBeGreaterThan(x.energy[2]!.floor)
    expect(x.tolerance[0]).toMatchObject({ delay: 0, change: 0, error: null })
    const dps = x.tolerance.map(t => t.dps!)
    expect(dps[1]!).toBeLessThan(dps[0]!)
    expect(dps[2]!).toBeLessThan(dps[1]!)
    expect(x.sensitivity.map(s => s.id)).toEqual(['earliest-frame', 'switch-no-lock', 'forte-keep-on-switch', 'hitstop-in-global-stop', 'switch-ends-stop', 'echo-input-priority', 'tune-break-auto'])   // 椿大招的全局时停盖过了 ult-no-switch（2026-10-22）；谐度破坏 89 帧能切、时停到 92，切人时清掉剩下的（2026-10-25）；大招过场里的自身顿帧（2026-10-28）
    expect(x.notHit).toEqual(['def-no-floor', 'effect-tick', 'effect-owner', 'ult-no-switch', 'resonance-rules', 'track-no-consume', 'summon-as-char'])    // M0 没有减防、没有异常效应、没有阵：翻了也一样，不跑
    for (const w of x.waits) expect(w.share).toBeGreaterThan(0)
  }, 60_000)   // 敏感度要跑好几遍：全量并发时会超过缺省的 5 秒（docs/engine-acceptance-2026-10-22.md P3）

  test('共鸣效率需求：把现在的共鸣效率压到需求以下就会等能量', () => {
    const r = load()
    const need = insight(source(), gd, { delays: [0], tight: 0 }).energy.find(e => e.char === '维里奈')!.need!
    const buffPart = panelsOf(r)[2]!.energyRegen - r.team[2].panel.energyRegen   // 常驻共鸣效率 buff 那部分（需求按面板 + 它算）
    const panel = need - 0.05 - buffPart                                            // 比需求低 5%
    const low = runPrepared(fixturePreparedRun({ ...r, team: r.team.map(t => (t.slot === 2 ? { ...t, panel: { ...t.panel, energyRegen: panel } } : t)) as typeof r.team }))
    const waits = eventsOfLog(low.log, 'wait').filter(w => w.code === 'resource' && w.reason.startsWith('大招能量'))
    expect(low.error !== undefined || waits.length > 0).toBe(true)
  }, 60_000)
})

dataDescribe('卡帧点（TD-10 §6 ⑥）：M0 视频轴 EQ 版', () => {
  // 2026-10-22 椿 E2 补上落地段后一轮 25.12 秒、超过两个大招 25 秒的冷却，几乎每个决策点都在关键路径上；
  // 2026-10-25 声骸起手能打断后摇（假设 echo-input-priority）后一轮回到 25.00 秒、等维里奈大招冷却：只有它晚了一轮跟着变长
  test('一轮 25.00 秒、等维里奈大招冷却：只有维里奈大招晚 6 帧一轮多 6 帧，其余不加长', async () => {
    const data = await loadGameData()
    const sc = ScenarioSchema.parse(parse(readFileSync('scenarios/m0-video-eq.yaml', 'utf8')))
    const x = insight(sc, data, { delays: [0] })
    expect(x.tightFrames).toBe(6)
    expect(x.tight.filter(t => (t.extraFrames ?? 0) > 0).map(t => t.what)).toEqual(['维里奈 大招'])
    expect(x.tight.filter(t => t.kind === 'slack').length).toBeGreaterThan(10)
    expect(x.tight.some(t => t.kind === 'better' || t.error)).toBe(false)
    // 连段后续不算决策点（玩家预输入）
    expect(x.tight.some(t => /盛绽·A2|A4|A5|强化空中A2/.test(t.what))).toBe(false)
  }, 120_000)
})
