// tests/cast-gain-timing.test.ts —— 起手即得什么时候给（规则 castGainTiming，台账 cast-gain-at-start 的两个候选，2026-11-27）：
// start（缺省）在动作开始那一帧给；firstHit 挪到时间线上最早生成的判定，它第一次结算时才给，在它生成之前被取消就不给
// （C9 实验：散华 E 被声骸抢帧打断后协奏环涨多少，docs/experiments/C9-散华E协奏起手即得.md）。人造角色，不依赖 data/generated。
import { describe, expect, test } from 'vitest'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { checkLedgerClosure, crossCheckLedger } from '../src/engine/diagnostics'
import { checkLog } from '../src/engine/invariants'
import { deferCastGains } from '../src/engine/resolve'
import { prepareRun, runForInspection, runPrepared } from '../src/engine/run'
import type { RunOverrides } from '../src/engine/run-types'
import type { SimResult } from '../src/engine/types'
import { preparedSynth } from './helpers/diag-team'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

// 甲：E 20 帧后摇的技能，起手即得协奏 +15、槽一 −2（扣除），第 19 帧生成判定 e（不给资源），第 30 帧另有一个 e2；
//     Q 优先级 5（比 E 的 4 高），第 40 帧命中；B 没有判定，起手即得协奏 +7
const 甲: SynthChar = {
  name: '甲',
  core: [{ slot: 1, name: '槽一', cap: 10 }],
  actions: [
    action({
      id: 'E', kind: 'skill', endFrame: 90, priority: [{ fromFrame: 0, value: 4 }, { fromFrame: 60, value: 2 }],
      castGains: [{ atFrame: 0, resource: 'concerto', amount: 15 }, { atFrame: 0, resource: 'core1', amount: -2 }],
      judgments: [judgment({ name: 'e2', spawnFrame: 30 }), judgment({ name: 'e', spawnFrame: 19 })],
    }),
    action({ id: 'Q', kind: 'echo', endFrame: 60, priority: [{ fromFrame: 0, value: 5 }], judgments: [judgment({ name: 'q', spawnFrame: 40 })] }),
    action({ id: 'B', kind: 'skill', endFrame: 20, castGains: [{ atFrame: 0, resource: 'concerto', amount: 7 }] }),
  ],
}
const team = (): [SynthChar, SynthChar, SynthChar] => [甲, idle('乙'), idle('丙')]
const prepared = (rotation: string[], timing?: 'start' | 'firstHit') => preparedSynth(
  team(), { rotation, initial: { core: { 甲: { 槽一: 5 } } } }, timing ? { rules: { castGainTiming: timing } } : {},
)
const run = (rotation: string[], timing?: 'start' | 'firstHit'): SimResult => runPrepared(prepared(rotation, timing), { diag: { ruleTrace: true } })
const concertoSteps = (res: SimResult) => eventsOfLog(res.log, 'resource').filter(e => e.char === '甲' && e.resource === 'concerto').map(e => [e.f, e.delta, e.cause])
const coreSteps = (res: SimResult) => eventsOfLog(res.log, 'resource').filter(e => e.char === '甲' && e.resource === 'core1').map(e => [e.f, e.delta, e.cause])

describe('起手即得的时机（castGainTiming）', () => {
  test('缺省 start：动作开始那一帧给；firstHit：挪到最早生成的判定（第 19 帧的 e，不是数组里靠前的 e2），命中那一帧在 hit 之后给', () => {
    expect(concertoSteps(run(['甲 E']))).toEqual([[0, 15, 'cast']])
    const late = run(['甲 E'], 'firstHit')
    expect(concertoSteps(late)).toEqual([[19, 15, 'cast']])
    const i = late.log.findIndex(e => e.type === 'resource' && e.char === '甲' && e.resource === 'concerto')
    expect(late.log[i - 1]).toMatchObject({ type: 'hit', judgment: 'e', tick: 0 })
  })

  test('E 在判定生成之前被 Q 抢帧打断：start 照样有 15；firstHit 这一笔不给', () => {
    const early = run(['甲 E Q!'])
    expect(eventsOfLog(early.log, 'actionCancel').map(e => [e.f, e.action, e.by])).toEqual([[1, 'E', 'Q']])
    expect(eventsOfLog(early.log, 'hit').map(e => e.judgment)).toEqual(['q'])
    expect(concertoSteps(early)).toEqual([[0, 15, 'cast']])
    expect(concertoSteps(run(['甲 E Q!'], 'firstHit'))).toEqual([])
  })

  test('负数项（扣除）照旧起手扣；没有时间线判定的动作照旧起手给', () => {
    for (const t of ['start', 'firstHit'] as const) {
      expect(coreSteps(run(['甲 E'], t))).toEqual([[0, -2, 'cast']])
      expect(concertoSteps(run(['甲 B'], t))).toEqual([[0, 7, 'cast']])
    }
  })

  test('装配：只有 firstHit 改动作定义；start 的装配结果与不写规则时相同', () => {
    const p = (o: RunOverrides) => preparedSynth(team(), { rotation: ['甲 E'] }, o)
    expect(p({ rules: { castGainTiming: 'start' } }).resolved.team[0].actions).toEqual(p({}).resolved.team[0].actions)
    const e = p({ rules: { castGainTiming: 'firstHit' } }).resolved.team[0].actions['E']!
    expect(e.castGains).toEqual([{ atFrame: 0, resource: 'core1', amount: -2 }])
    expect(e.judgments.map(j => [j.name, j.castOnFirstHit ?? null])).toEqual([['e2', null], ['e', { concerto: 15 }]])
    const plain = { B: 甲.actions[2]! }
    expect(deferCastGains(plain)).toEqual(plain)
  })

  test('取值只认 start、firstHit', () => {
    const p = prepareRun(ScenarioSchema.parse({
      team: team().map(c => ({ char: c.name, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 E'],
      options: { rules: { castGainTiming: 'onHit' } },
    }), synthData(team()))
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.issues.map(i => i.message)).toContain('options.rules.castGainTiming：应为 start 或 firstHit')
  })

  test('判定点 res.castGainTiming：有正数起手项又有时间线判定的动作决定分支，没有判定的只是读到；两种读法都记', () => {
    for (const t of ['start', 'firstHit'] as const) {
      const trace = (rotation: string[]) => run(rotation, t).diag!.ruleTrace!.filter(x => x.point === 'res.castGainTiming')
      expect(trace(['甲 E']).map(x => [x.value, x.decisive])).toEqual([[t, true]])
      expect(trace(['甲 B']).map(x => [x.value, x.decisive])).toEqual([[t, false]])
    }
    expect(run(['甲 E']).ruleUsage.byProposition.find(x => x.propositionId === 'cast-gain-at-start')).toMatchObject({ readCount: 1, decisiveCount: 1, firstFrame: 0 })
  })

  test('账本闭合、与日志交叉检查、日志自洽：两种读法、打断与否都成立', () => {
    for (const t of ['start', 'firstHit'] as const) for (const rotation of [['甲 E'], ['甲 E Q!'], ['甲 B', '甲 E']]) {
      const p = prepared(rotation, t)
      const x = runForInspection(p, { diag: { resourceLedger: true } })
      const res = x.result!, ledger = res.diag!.resourceLedger!
      const where = `${t} ${rotation.join(' / ')}`
      expect(checkLedgerClosure(ledger, res.diag!.ledgerMarks!.terminalEndExclusive, x.terminal!), where).toEqual([])
      expect(crossCheckLedger(res.log, ledger, ['甲', '乙', '丙']), where).toEqual([])
      expect(checkLog(p.resolved, res), where).toEqual([])
    }
  })
})
