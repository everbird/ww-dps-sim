// tests/insight.test.ts —— 操作延迟 options.inputDelay（TD-09 §3、总设计 T4）与结论（TD-10 §6）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { panelsOf } from '../src/engine/analysis'
import { insight } from '../src/engine/insight'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { action, dataDescribe } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthRun, type SynthChar } from './helpers/synth'

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

dataDescribe('结论（M0 代表轴）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  const load = () => resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-team.yaml', import.meta.url), 'utf8'))), gd)

  test('连段的后续（有 comboFrom 的动作）不加操作延迟：玩家会预输入', () => {
    const r = load()
    const out = simulate({ ...r, options: { ...r.options, inputDelay: 6 } })
    expect(out.error).toBeUndefined()
    const inputs = eventsOfLog(out.log, 'wait').filter(w => w.code === 'input')
    expect(inputs.length).toBeGreaterThan(0)
    for (const w of inputs) {
      const c = (w.cmd.loop === 0 ? r.opening : r.commands).find(x => x.line === w.cmd.line && x.item === w.cmd.item)!
      if (c.kind === 'act') expect([c.action, r.team[c.slot].actions[c.action]!.comboFrom ?? []]).toEqual([c.action, []])
    }
  })

  test('四项结论：能量需求不高于现在（这条轴不等能量）、操作越晚 DPS 越低、敏感度列出能翻的假设', () => {
    const x = insight(load(), { delays: [0, 3, 6] })
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
    expect(x.sensitivity.map(s => s.id)).toEqual(['def-no-floor', 'earliest-frame', 'tune-break-auto'])
    expect(x.sensitivity[0]!.delta).toBe(0)                                     // M0 没有减防：取不取整都一样
    for (const w of x.waits) expect(w.share).toBeGreaterThan(0)
  })

  test('共鸣效率需求：把现在的共鸣效率压到需求以下就会等能量', () => {
    const r = load()
    const need = insight(r, { delays: [0] }).energy.find(e => e.char === '维里奈')!.need!
    const buffPart = panelsOf(r)[2]!.energyRegen - r.team[2].panel.energyRegen   // 常驻共鸣效率 buff 那部分（需求按面板 + 它算）
    const panel = need - 0.05 - buffPart                                            // 比需求低 5%
    const low = simulate({ ...r, team: r.team.map(t => (t.slot === 2 ? { ...t, panel: { ...t.panel, energyRegen: panel } } : t)) as typeof r.team })
    const waits = eventsOfLog(low.log, 'wait').filter(w => w.code === 'resource' && w.reason.startsWith('大招能量'))
    expect(low.error !== undefined || waits.length > 0).toBe(true)
  })
})
