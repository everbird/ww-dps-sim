// tests/trace.test.ts —— 调试用的表（TD-11 §3、§6）：分段、逐条、资源逐步、对照视频，以及开局核心资源 initial.core（TD-06 Q7）。
// 人造角色，不依赖生成数据
import { describe, expect, test } from 'vitest'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario, ResolveError } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { actionGains, compareMarks, gainSteps, hitCauses, loopSpan, loopsOf, resourceSel, traceCommands, traceLedger, traceSegments, videoSeconds } from '../src/engine/trace'
import { timelineModel } from '../src/report/timeline'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

// 甲：X 30 帧，第 10 帧命中一次：协奏 +10、蕊 −5；开始时协奏 +5（起手即得）。核心资源 1 号槽"蕊"，上限 100
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
  test('协奏：起手即得与逐段命中，按顺序重放出当时的值', () => {
    const { r, res } = run({ rotation: ['甲 X X'] })
    const sel = resourceSel(r, '协奏')
    if (typeof sel === 'string') throw new Error(sel)
    const rows = traceLedger(res.log, r, 1, sel, '甲')
    expect(rows.map(x => [x.label, x.source, x.deltas['甲'], x.values['甲']])).toEqual([
      ['甲 X 开始', '起手即得', 5, 5], ['甲 X 命中（x）', '命中', 10, 15],
      ['甲 X 开始', '起手即得', 5, 20], ['甲 X 命中（x）', '命中', 10, 30],
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

describe('资源出处：每次变化归到哪个动作（时间轴的检查器、动作提示；调试表的事件列）', () => {
  // 丁：Y（共鸣技能）开始时起手即得协奏 +5，武器式的效果"施放共鸣技能时协奏 +8"；第 10 帧命中：协奏 +10、基础能量 4、蕊 −10，
  // 钩子在消耗蕊的命中之后协奏 +4（带说明）。Q 扣 50 能量，开始时钩子生成 Z 的判定 z（Z 本身从没开始过），并挂上 20 帧的"计时"；
  // 计时到时钩子生成 Y 组里的判定 y2（没有发生帧，同散华重击居合引爆 E 的冰棱），附说明"计时到了"
  const 丁: SynthChar = {
    name: '丁', energyCost: 50, core: [{ slot: 1, name: '蕊', cap: 100 }],
    actions: [
      action({
        id: 'Y', kind: 'skill', endFrame: 30, castGains: [{ atFrame: 0, resource: 'concerto', amount: 5 }],
        judgments: [
          judgment({ name: 'y', spawnFrame: 10, gains: { energy: 4, concerto: 10, core: [-10, 0, 0] } }),
          judgment({ name: 'y2', spawnFrame: null, gains: { energy: 0, concerto: 6, core: [0, 0, 0] } }),
        ],
      }),
      action({ id: 'Q', kind: 'liberation', endFrame: 30, energyCost: 50 }),
      action({ id: 'Z', endFrame: 30, judgments: [judgment({ name: 'z', spawnFrame: null, gains: { energy: 0, concerto: 3, core: [0, 0, 0] } })] }),
    ],
    effects: [{
      id: '丁.技能协奏', source: '施放共鸣技能时，回复8点协奏能量。', resource: 'concerto', amount: 8,
      trigger: { on: 'actionStart', where: { actionKinds: ['skill'] } },
    }],
    buffs: [{ id: '丁.计时', source: 't', target: 'self', duration: 20, trigger: { on: 'actionStart', where: { actions: ['Q'] } } }],
    hooks: {
      onEvent: (ctx, ev) => {
        if (ev.type === 'hit' && ev.char === '丁' && (ev.gains.core[0] ?? 0) < 0) ctx.addResource('concerto', 4, ctx.self, '每消耗 10 点蕊')
        if (ev.type === 'actionStart' && ev.char === '丁' && ev.action === 'Q') ctx.spawnJudgment('z')
        if (ev.type === 'buffExpire' && ev.buff === '丁.计时' && ev.reason === 'timeout') ctx.spawnJudgment('y2', { note: '计时到了' })
      },
    },
  }
  const data = synthData([丁, idle('乙'), idle('丙')])
  // 丁的能量开局就满（命中只给队友），乙、丙是空的
  const sc = ScenarioSchema.parse({
    team: ['丁', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
    rotation: ['丁 Y Q'], initial: { energy: [50, 0, 0], core: { 丁: { 蕊: 50 } } },
  })
  const r = resolveScenario(sc, data)
  const res = simulate(r)

  test('按动作合计：效果、起手即得、命中、钩子归 Y；扣除与钩子生成的判定归引发它的 Q；同一种资源里按先后', () => {
    const gains = actionGains(gainSteps(res.log, r))
    expect(gains.map(g => [g.char, g.action, g.items.map(it => [it.resource, it.how, it.what, it.n, it.dt, it.base ?? null, it.of ?? null, it.deltas])])).toEqual([
      ['丁', 'Y', [
        ['concerto', 'effect', '丁.技能协奏', 1, 0, null, null, { 丁: 8 }],          // 效果在施放资源之前（TD-06 §7：actionStart 的触发先于施放资源）
        ['concerto', 'cast', '', 1, 0, null, null, { 丁: 5 }],
        ['concerto', 'hit', 'y', 1, 0.17, 10, null, { 丁: 10 }],
        ['concerto', 'hook', '每消耗 10 点蕊', 1, 0.17, null, null, { 丁: 4 }],
        ['energy', 'hit', 'y', 1, 0.17, 4, null, { 乙: 2, 丙: 2 }],                    // 丁满了不再加；队友各 50%
      ]],
      ['丁', 'Q', [
        ['concerto', 'hit', 'z', 1, 0, 3, 'Z', { 丁: 3 }],                             // Q 开始时钩子生成的
        ['concerto', 'hit', 'y2', 1, 0.33, 6, 'Y', { 丁: 6 }],                         // Q 挂的计时到时生成的：判定在 Y 组里，仍算 Q
        ['energy', 'cost', '', 1, 0, null, null, { 丁: -50 }],
      ]],
    ])
  })

  test('命中归到的动作同资源（TD-11 §6.1）：y 归 Y；Q 引发的 z、y2 归 Q（判定在 Z、Y 组里）；时间轴模型的命中带上那个动作的实例号', () => {
    const causes = hitCauses(res.log, r)
    expect(eventsOfLog(res.log, 'hit').map(e => [e.judgment, causes.get(e)?.owner?.action ?? null, causes.get(e)?.trigger ?? null]))
      .toEqual([['y', 'Y', null], ['z', 'Q', null], ['y2', 'Q', null]])      // z、y2 由动作开始、buff 到时引出，不是命中触发的
    // 引出原因（TD-11 §6.1）：钩子在什么之后生成的、钩子附的说明；不是钩子生成的没有
    expect(eventsOfLog(res.log, 'hit').map(e => causes.get(e)?.origin ?? null))
      .toEqual([null, { via: '丁 Q 开始', note: null }, { via: '丁.计时 到时', note: '计时到了' }])
    expect(actionGains(gainSteps(res.log, r)).find(g => g.action === 'Q')!.items.filter(it => it.how === 'hit').map(it => [it.what, it.note ?? null, it.via ?? null]))
      .toEqual([['z', null, '丁 Q 开始'], ['y2', '计时到了', '丁.计时 到时']])
    const inst = (a: string) => eventsOfLog(res.log, 'actionStart').find(e => e.action === a)!.instance
    const m = timelineModel('丁.yaml', sc, r, res)
    expect(m.log.filter(e => e.type === 'hit').map(e => [e.type === 'hit' ? e.judgment : '', e.owner, e.via ?? null, e.note ?? null]))
      .toEqual([['y', inst('Y'), null, null], ['z', inst('Q'), '丁 Q 开始', null], ['y2', inst('Q'), '丁.计时 到时', '计时到了']])
  })

  test('调试表的事件列：效果写它跟在哪个动作开始后面，钩子写跟在哪次命中后面、来源带说明', () => {
    const sel = resourceSel(r, '协奏')
    if (typeof sel === 'string') throw new Error(sel)
    expect(traceLedger(res.log, r, 1, sel, '丁').map(x => [x.label, x.source, x.deltas['丁'], x.values['丁']])).toEqual([
      ['丁 Y 开始', '效果 丁.技能协奏', 8, 8], ['丁 Y 开始', '起手即得', 5, 13],
      ['丁 Y 命中（y）', '命中', 10, 23], ['丁 Y 命中后', '角色钩子：每消耗 10 点蕊', 4, 27],
      ['丁 Z 命中（z；丁 Q 开始）', '命中', 3, 30], ['丁 Y 命中（y2；计时到了（丁.计时 到时））', '命中', 6, 36],
    ])
  })
})

describe('命中触发：钩子在命中后生成的判定，记下由谁的命中触发（维里奈的协同攻击，TD-11 §6.1）', () => {
  // 戊：R 组里的判定 c 没有发生帧，任何人的命中（c 自己除外）都让钩子生成一次，同维里奈的协同攻击。
  // 戊 R 第 5 帧自己命中 r，切甲后甲 X 第 10 帧命中 x，各触发一次 c
  const 戊: SynthChar = {
    name: '戊',
    actions: [action({ id: 'R', kind: 'liberation', endFrame: 30, judgments: [judgment({ name: 'r', spawnFrame: 5 }), judgment({ name: 'c', spawnFrame: null })] })],
    hooks: { onEvent: (ctx, ev) => { if (ev.type === 'hit' && ev.judgment !== 'c') ctx.spawnJudgment('c', { action: 'R' }) } },
  }
  const data = synthData([戊, 甲, idle('丙')])
  const sc = ScenarioSchema.parse({
    team: ['戊', '甲', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
    rotation: ['戊 R', 'switch 甲', '甲 X'],
  })
  const r = resolveScenario(sc, data)
  const res = simulate(r)

  test('自己命中触发的归那一下、记触发者；队友命中触发的仍归 R、触发者是队友；时间轴模型的命中带上 trigger', () => {
    const causes = hitCauses(res.log, r)
    const trig = (t: { char: string; action: string; judgment: string } | null | undefined) => (t ? `${t.char} ${t.action}（${t.judgment}）` : null)
    expect(eventsOfLog(res.log, 'hit').map(e => [`${e.char} ${e.judgment}`, causes.get(e)?.owner?.action ?? null, trig(causes.get(e)?.trigger), causes.get(e)?.origin?.via ?? null])).toEqual([
      ['戊 r', 'R', null, null], ['戊 c', 'R', '戊 R（r）', '戊 R 命中'], ['甲 x', 'X', null, null], ['戊 c', 'R', '甲 X（x）', '甲 X 命中'],
    ])
    const m = timelineModel('戊.yaml', sc, r, res)
    expect(m.log.filter(e => e.type === 'hit').map(e => trig(e.trigger))).toEqual([null, '戊 R（r）', null, '甲 X（x）'])
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
