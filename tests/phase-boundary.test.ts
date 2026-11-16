// tests/phase-boundary.test.ts —— 相位边界用例（DD-05 §5；架构 §3.5）：冷却剩 1 帧、同帧命中与 buff 到期、同帧多个到期与交错触发。
// 用人造动作与人造角色，不依赖 data/generated。已有用例能覆盖的注明出处，这里只补缺的断言。
import { describe, expect, test } from 'vitest'
import type { BuffDefInput } from '../src/data/buff.schema'
import { ScenarioSchema } from '../src/data/scenario.schema'
import type { EventMeta } from '../src/engine/diagnostics'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { gainSteps, hitCauses } from '../src/engine/trace'
import type { SimResult } from '../src/engine/types'
import { action, eventsOf, judgment, run } from './helpers/kernel-harness'
import { oldGainSteps } from './helpers/old-owners'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

const buff = (o: Partial<BuffDefInput> & { id: string }): BuffDefInput =>
  ({ source: 't', zone: 'atkPct', value: 0.5, target: 'self', duration: 600, trigger: { on: 'actionStart' }, ...o }) as BuffDefInput

/** 三个人造角色跑一个场景，带事件来源（DD-05 §3）；返回结果与 eventMeta */
function traced(chars: [SynthChar, SynthChar, SynthChar], sc: Record<string, unknown>): { out: SimResult; meta: readonly EventMeta[]; r: ReturnType<typeof resolveScenario> } {
  const r = resolveScenario(ScenarioSchema.parse({ team: chars.map(c => ({ char: c.name, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, ...sc }), synthData(chars))
  const out = simulate(r, { diag: { eventMeta: true } })
  return { out, meta: out.diag!.eventMeta!, r }
}

describe('C05-1 冷却剩 1 帧：这一帧 P2 放不出，下一帧放出', () => {
  // 冷却在 P6 扣（架构 §3.1）：世界帧 0 放出、冷却 60 战斗帧，第 0…58 帧的 P6 各扣 1，第 59 帧 P2 时还剩 1，P6 扣到 0，第 60 帧放出。
  // 同类断言已有：tests/td09.test.ts T09-7（冷却 100，第二次在第 100 帧）。这里补"不在 59、等待段在 60 结束"
  const E = action({ id: 'E', endFrame: 30, cooldown: 60 })
  const r = run([{ E }, {}, {}], [{ act: 0, action: 'E' }, { act: 0, action: 'E' }])

  test('第二个 actionStart 在世界帧 60，不在 59', () => {
    expect(eventsOf(r, 'actionStart').map(e => e.f)).toEqual([0, 60])
  })

  test('冷却的等待段从动作结束（30）起、在第 60 帧结束：第 59 帧 P2 时冷却还没好', () => {
    const cd = eventsOf(r, 'wait').filter(w => w.code === 'cooldown')
    expect(cd.map(w => [w.from, w.from + w.frames, w.f])).toEqual([[30, 60, 60]])
    expect(cd[0]!.reason).toBe('E 冷却还剩 30 帧')                  // 原因按等待段开始那一帧写：第 30 帧还剩 30
  })
})

describe('C05-2 同帧命中与 buff 到期：P4 的结算仍吃到，buffExpire 在 P6、排在 hit 之后', () => {
  // buff 在战斗帧 0 挂上（动作 X 开始时，P2），持续 30：第 0 帧的 P6 扣第一次，第 29 帧的 P6 扣到 0 到期。
  // 判定 a、b 分别在世界帧 29、30 结算（没有时停，DF-23）
  const 甲: SynthChar = {
    name: '甲',
    actions: [action({ id: 'X', kind: 'skill', endFrame: 40, judgments: [judgment({ name: 'a', spawnFrame: 29 }), judgment({ name: 'b', spawnFrame: 30 })] })],
    buffs: [buff({ id: '甲.攻击', duration: 30, trigger: { on: 'actionStart', where: { actions: ['X'] } } })],
  }
  const { out, meta } = traced([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
  const hits = eventsOfLog(out.log, 'hit')
  const expire = out.log.findIndex(e => e.type === 'buffExpire' && e.buff === '甲.攻击')

  test('buff 在第 0 帧挂上、第 29 帧到期（timeout）', () => {
    expect(eventsOfLog(out.log, 'buffApply').map(e => [e.buff, e.f, e.remaining])).toEqual([['甲.攻击', 0, 30]])
    const e = out.log[expire]
    expect(e?.type === 'buffExpire' && [e.f, e.reason]).toEqual([29, 'timeout'])
  })

  test('第 29 帧的 hit 吃到它，第 30 帧的没有', () => {
    expect(hits.map(h => [h.judgment, h.f, h.buffs])).toEqual([['a', 29, ['甲.攻击']], ['b', 30, []]])
  })

  test('第 29 帧的 hit 下标小于 buffExpire，两条的 f 都是 29', () => {
    const hit29 = out.log.findIndex(e => e.type === 'hit' && e.judgment === 'a')
    expect(hit29).toBeGreaterThanOrEqual(0)
    expect(hit29).toBeLessThan(expire)
    expect([out.log[hit29]!.f, out.log[expire]!.f]).toEqual([29, 29])
  })

  test('eventMeta：hit 的相位是 P4，buffExpire 是 P6（来源是带实例号的 buff 计时器）', () => {
    const hit29 = out.log.findIndex(e => e.type === 'hit' && e.judgment === 'a')
    expect([meta[hit29]!.phase, meta[hit29]!.origin.kind]).toEqual(['P4', 'judgmentSettle'])
    const id = eventsOfLog(out.log, 'buffApply')[0]!.instanceId
    expect([meta[expire]!.phase, meta[expire]!.origin]).toEqual(['P6', { kind: 'timer', timerKind: 'buff', id, defId: '甲.攻击' }])
  })
})

describe('C05-3 同帧多个到期：各自引出的事件指向各自的到期，不串到最后一个头上（R02）', () => {
  // buff 甲 由 P 在第 0 帧挂上（30 帧），buff 乙 由 Q 在第 10 帧挂上（20 帧），同在第 29 帧到期；
  // 钩子：甲到期给 1 点核心资源、乙到期给 1 点协奏。日志顺序是 到期甲、到期乙、资源甲、资源乙
  const 甲: SynthChar = {
    name: '甲',
    core: [{ slot: 1, name: '甲核', cap: 10 }],
    actions: [action({ id: 'P', kind: 'skill', endFrame: 10 }), action({ id: 'Q', kind: 'skill', endFrame: 10 })],
    buffs: [
      buff({ id: '甲.buff甲', duration: 30, trigger: { on: 'actionStart', where: { actions: ['P'] } } }),
      buff({ id: '甲.buff乙', duration: 20, trigger: { on: 'actionStart', where: { actions: ['Q'] } } }),
    ],
    hooks: {
      onEvent(ctx, ev) {
        if (ev.type !== 'buffExpire') return
        if (ev.buff === '甲.buff甲') ctx.addResource('core1', 1, ctx.self, 'buff甲 到期')
        if (ev.buff === '甲.buff乙') ctx.addResource('concerto', 1, ctx.self, 'buff乙 到期')
      },
    },
  }
  const { out, meta, r } = traced([甲, idle('乙'), idle('丙')], { rotation: ['甲 P', '甲 Q', 'wait 30'] })   // wait：buff 不撑着运行，等到它们到期
  const seq = (pred: (e: SimResult['log'][number]) => boolean) => out.log.findIndex(pred)
  const e甲 = seq(e => e.type === 'buffExpire' && e.buff === '甲.buff甲')
  const e乙 = seq(e => e.type === 'buffExpire' && e.buff === '甲.buff乙')
  const x甲 = seq(e => e.type === 'resource' && e.resource === 'core1')
  const x乙 = seq(e => e.type === 'resource' && e.resource === 'concerto')

  test('前提：同帧到期，日志里两条到期在前、两条资源在后', () => {
    expect([out.log[e甲]!.f, out.log[e乙]!.f]).toEqual([29, 29])
    expect([e甲, e乙, x甲, x乙]).toEqual([e甲, e甲 + 1, e甲 + 2, e甲 + 3])
  })

  test('两条 resource 的 directParentSeq 分别指向各自的 buffExpire', () => {
    expect([meta[x甲]!.directParentSeq, meta[x乙]!.directParentSeq]).toEqual([e甲, e乙])
    expect(meta[x甲]!.origin).toEqual({ kind: 'trigger', directParentSeq: e甲, handlerKind: 'charHook', handlerId: '甲' })
  })

  test('两条 buffExpire 的来源是带不同实例号的 timer', () => {
    const o甲 = meta[e甲]!.origin, o乙 = meta[e乙]!.origin
    expect([o甲.kind, o乙.kind]).toEqual(['timer', 'timer'])
    expect(o甲.kind === 'timer' && o乙.kind === 'timer' && o甲.id !== o乙.id).toBe(true)
    expect([meta[e甲]!.scope === meta[e乙]!.scope]).toEqual([false])
  })

  test('旧的按日志邻近推来源（walkOwners，T05-8 删掉后搬在 tests/helpers/old-owners）：两条都归到了 buff乙 的施加者 Q——用例确实打到了 R02', () => {
    const steps = oldGainSteps(out.log, r).filter(g => g.how === 'hook')
    expect(steps.map(g => [g.resource, g.owner?.action, g.label])).toEqual([['core1', 'Q', '甲.buff乙 到时'], ['concerto', 'Q', '甲.buff乙 到时']])
  })

  test('C05-11 trace 的出处按 eventMeta：两条各归各的（甲到期的归 P、乙到期的归 Q），与旧算法不同', () => {
    const steps = gainSteps(out.log, r, meta).filter(g => g.how === 'hook')
    expect(steps.map(g => [g.resource, g.owner?.action, g.label])).toEqual([['core1', 'P', '甲.buff甲 到时'], ['concerto', 'Q', '甲.buff乙 到时']])
    expect(steps.map(g => g.owner?.action)).not.toEqual(oldGainSteps(out.log, r).filter(g => g.how === 'hook').map(g => g.owner?.action))
  })
})

describe('C05-4 队列交错：E1、E2 先后入队，E1 引出的 X1 写在 E2 之后', () => {
  // 一次结算先写 hit（E1），再写能量满的 resourceFull（E2），之后才处理队列：E1 的钩子写 X1、E2 的钩子写 X2
  const 甲: SynthChar = {
    name: '甲',
    core: [{ slot: 1, name: '甲核', cap: 10 }, { slot: 2, name: '甲核二', cap: 10 }],
    actions: [action({ id: 'X', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 3, gains: { energy: 500, concerto: 0, core: [0, 0, 0] } })] })],
    hooks: {
      onEvent(ctx, ev) {
        if (ev.type === 'hit' && ev.judgment === 'x') ctx.addResource('core1', 1, ctx.self, 'X1')
        if (ev.type === 'resourceFull' && ev.char === '甲') ctx.addResource('core2', 1, ctx.self, 'X2')
      },
    },
  }
  const { out, meta } = traced([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'], initial: { energy: 'empty' } })
  const e1 = out.log.findIndex(e => e.type === 'hit')
  const e2 = out.log.findIndex(e => e.type === 'resourceFull' && e.char === '甲')
  const x1 = out.log.findIndex(e => e.type === 'resource' && e.resource === 'core1')
  const x2 = out.log.findIndex(e => e.type === 'resource' && e.resource === 'core2')

  test('日志顺序是 E1、E2、X1、X2（中间还有队友能量满的 resourceFull）', () => {
    expect(e1).toBeGreaterThanOrEqual(0)
    expect([e1 < e2, e2 < x1, x1 < x2]).toEqual([true, true, true])
    expect(out.log.slice(e2, x1).every(e => e.type === 'resourceFull')).toBe(true)
  })

  test('X1 的父是 E1，X2 的父是 E2', () => {
    expect([meta[x1]!.directParentSeq, meta[x2]!.directParentSeq]).toEqual([e1, e2])
  })

  test('E1、E2 都是这次结算写的（同一个 judgmentSettle 作用域），说的是同一个判定', () => {
    expect(meta[e1]!.origin).toEqual(meta[e2]!.origin)
    expect(meta[e1]!.scope).toBe(meta[e2]!.scope)
    const spawn = out.log.findIndex(e => e.type === 'judgmentSpawn')
    expect([meta[e1]!.subjectSeq, meta[e2]!.subjectSeq]).toEqual([spawn, spawn])
  })
})
