// tests/trace.test.ts —— 调试用的表（TD-11 §3、§6）：分段、逐条、资源逐步、对照视频，以及开局核心资源 initial.core（TD-06 Q7）。
// 人造角色，不依赖生成数据
import { describe, expect, test } from 'vitest'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario, ResolveError } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { compareMarks, loopSpan, loopsOf, resourceSel, traceCommands, traceLedger, traceSegments, videoSeconds } from '../src/engine/trace'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

// 甲：X 30 帧，第 10 帧命中一次：协奏 +10、蕊 −5；开始时协奏 +5（进入即得）。核心资源 1 号槽"蕊"，上限 100
const 甲: SynthChar = {
  name: '甲',
  core: [{ slot: 1, name: '蕊', cap: 100 }],
  actions: [action({
    id: 'X', endFrame: 30, castGains: [{ atFrame: 0, resource: 'concerto', amount: 5 }],
    judgments: [judgment({ name: 'x', spawnFrame: 10, gains: { energy: 0, concerto: 10, core: [-5, 0, 0] } })],
  }), action({ id: 'Z', endFrame: 30, cooldown: 600 })],
}
const 乙: SynthChar = { ...idle('乙'), actions: [action({ id: 'Y', endFrame: 40 })] }

function run(sc: Partial<ScenarioInput>) {
  const data = synthData([甲, 乙, idle('丙')])
  const r = resolveScenario(ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, ...sc }), data)
  return { r, res: simulate(r) }
}
// 每轮：甲 X X → 切乙 → 乙 Y → 切甲（切人冷却 60 帧，第二次切人要等）
const ROT = ['甲 X X', 'switch 乙', '乙 Y', 'switch 甲']

describe('TD-11 分段与逐条', () => {
  // 第 2 轮：X 0、X 30（等派生 30）、切乙 60（切人冷却 30）、Y 60、切甲 120（切人冷却 60）；切甲恰好是第 3 轮开始那一帧
  test('分段：切人到切人；本轮开头不是切人时，第一段从本轮开始、上场的是那时的前台', () => {
    const { r, res } = run({ rotation: ROT, options: { repeat: 3 } })
    expect(loopsOf(res.log)).toEqual([1, 2, 3])
    const span = loopSpan(res.log, 2)!
    const segs = traceSegments(res.log, r, 2)
    expect(segs.map(x => [x.char, x.f - span.f, x.frames, x.line])).toEqual([['甲', 0, 60, null], ['乙', 60, 60, 2]])
    expect(segs.reduce((a, x) => a + x.frames, 0)).toBe(span.endF - span.f)
  })
  test('逐条：开始时刻、到下一条多久、之前在等什么；本轮最后一条落在下一轮开始那一帧也算本轮', () => {
    const { r, res } = run({ rotation: ROT, options: { repeat: 3 } })
    const span = loopSpan(res.log, 2)!
    const rows = traceCommands(res.log, r, 2)
    expect(rows.map(x => [`${x.line}.${x.item}`, x.label, x.f - span.f, x.frames, x.waits])).toEqual([
      ['1.1', '甲 X', 0, 30, []],
      ['1.2', '甲 X', 30, 30, [{ reason: '等 X 的派生窗口', frames: 30 }]],
      ['2.1', 'switch 乙', 60, 0, [{ reason: '切人冷却还剩 30 帧', frames: 30 }]],
      ['3.1', '乙 Y', 60, 60, []],
      ['4.1', 'switch 甲', 120, 0, [{ reason: '切人冷却还剩 60 帧', frames: 60 }]],
    ])
  })
  test('可选指令被跳过也列出来', () => {
    const { r, res } = run({ rotation: ['甲 Z', '甲 Z?', '甲 X'] })
    expect(traceCommands(res.log, r, 1).map(x => [x.kind, x.line, x.label])).toEqual([
      ['act', 1, '甲 Z'], ['skip', 2, expect.stringContaining('（跳过）')], ['act', 3, '甲 X'],
    ])
  })
})

describe('TD-11 资源逐步', () => {
  test('协奏：施放时的进入即得与逐段命中，按顺序重放出当时的值', () => {
    const { r, res } = run({ rotation: ['甲 X X'] })
    const sel = resourceSel(r, '协奏')
    if (typeof sel === 'string') throw new Error(sel)
    const rows = traceLedger(res.log, r, 1, sel, '甲')
    expect(rows.map(x => [x.label, x.source, x.deltas['甲'], x.values['甲']])).toEqual([
      ['甲 X 开始', '施放（进入即得）', 5, 5], ['甲 X 命中（x）', '命中', 10, 15],
      ['甲 X 开始', '施放（进入即得）', 5, 20], ['甲 X 命中（x）', '命中', 10, 30],
    ])
  })
  test('核心资源按名字找；开局值来自 initial.core；耗完就不再变', () => {
    const { r, res } = run({ rotation: ['甲 X X X'], initial: { core: { 甲: { 蕊: 7 } } } })
    expect(resourceSel(r, '红椿·蕊')).toMatch(/没有资源"红椿·蕊"：可选 协奏、能量、蕊/)
    const sel = resourceSel(r, '蕊')
    if (typeof sel === 'string') throw new Error(sel)
    expect(traceLedger(res.log, r, 1, sel).map(x => [x.deltas['甲'], x.values['甲']])).toEqual([[-5, 2], [-2, 0]])
  })
})

describe('开局核心资源 initial.core（TD-06 Q7）', () => {
  test('按角色名、资源名写；不在队伍、没有这个资源、超过上限都报错', () => {
    const { r } = run({ rotation: ['甲 X'], initial: { core: { 甲: { 蕊: 100 } } } })
    expect(r.initial.core[0]).toEqual([100, 0, 0, 0, 0])
    const bad = (core: Record<string, Record<string, number>>) => {
      try { run({ rotation: ['甲 X'], initial: { core } }); return '' } catch (e) { if (e instanceof ResolveError) return e.message; throw e }
    }
    expect(bad({ 丁: { 蕊: 1 } })).toContain('initial.core.丁：不在队伍里')
    expect(bad({ 甲: { 蕾: 1 } })).toContain('甲 没有这个核心资源')
    expect(bad({ 甲: { 蕊: 120 } })).toContain('超过上限 100')
  })
})

describe('TD-11 对照视频', () => {
  test('时间写法："分:秒"或秒数', () => {
    expect([videoSeconds('1:02.5'), videoSeconds('62.5'), videoSeconds(3), videoSeconds('0:00')]).toEqual([62.5, 62.5, 3, 0])
  })
  test('从最早的时间点起算：累计差 = 仿真 − 视频，本段差 = 比上一个时间点多出来的；本轮没有的条目单列', () => {
    const { r, res } = run({ rotation: ROT, options: { repeat: 3 } })
    const rows = traceCommands(res.log, r, 2)
    // 仿真：第 1 条 0 秒、第 2 条 1 秒（60 帧）、第 4 条 2 秒（120 帧）；视频：0、0.8、2.1 秒
    const cmp = compareMarks(rows, { 1: '1:00', 2: 60.8, 4: '1:02.1', 9: 70 })
    expect(cmp.missing).toEqual([9])
    expect(cmp.rows.map(x => [x.line, +x.video.toFixed(2), +x.sim.toFixed(2), +x.diff.toFixed(2), +x.step.toFixed(2)])).toEqual([
      [1, 0, 0, 0, 0], [2, 0.8, 1, 0.2, 0.2], [4, 2.1, 2, -0.1, -0.3],
    ])
  })
})
