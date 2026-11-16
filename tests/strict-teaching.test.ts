// DD-02 §5：合成角色；P2 调度，P4 第20帧命中，下一 tick 才能变奏。
import { describe, expect, test } from 'vitest'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { prepareRun, runPrepared } from '../src/engine/run'
import { action, judgment } from './helpers/kernel-harness'
import { synthData, idle, eventsOfLog } from './helpers/synth'
const data = synthData([
  { name: '甲', actions: [action({ id: '打', endFrame: 40, cancelWindows: [{ from: 1, until: 40, row: 0 }], judgments: [judgment({ name: '命中', spawnFrame: 20, gains: { energy: 0, concerto: 10, core: [0, 0, 0] } })] }), action({ id: '谐破', kind: 'tuneBreak' }), action({ id: '跳', endFrame: 30, air: { from: 10, until: null } })], aliases: { TB: '谐破' } },
  { name: '乙', actions: [action({ id: 'QTE', kind: 'intro' }), action({ id: '空A', air: { from: 0, until: null }, kind: 'normal' }), action({ id: '出场', entrySkill: true }), action({ id: '长', endFrame: 200 })] }, idle('丙'),
])
const sc = (extra: Partial<ScenarioInput> = {}) => ScenarioSchema.parse({ team: ['甲','乙','丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, options: { strict: true, tuneBreak: 'off' }, tuneBreakOmitted: { reason: 'deliberate' }, rotation: ['甲 打', 'switch 乙 变奏'], initial: { concerto: [90,0,0] }, ...extra })
function run(extra: Partial<ScenarioInput> = {}, overrides: Parameters<typeof prepareRun>[2] = {}) {
  const p = prepareRun(sc(extra), data, overrides)
  if (!p.ok) throw new Error(JSON.stringify(p.issues))
  return runPrepared(p.run)
}
describe('DD-02 严格教学入口', () => {
  test('C02-1 协奏判定下一帧切人，独立等待码', () => {
    const r = run(); expect(r.completion.status).toBe('completed')
    expect(r.strictReport.intentWaits[0]).toMatchObject({ code: 'concertoSettle', frames: 21 })
    expect(eventsOfLog(r.log, 'switch')[0]?.intro).toBe(true)
  })
  test('C02-2/11 意图失败在切人前；续跑仍然失败', () => {
    const extra: Partial<ScenarioInput> = { initial: { concerto: [89,0,0] } }
    const r = run(extra); expect(r.completion.axisFailure?.unmetIntent?.actual).toContain('99')
    expect(eventsOfLog(r.log, 'switch')).toHaveLength(0)
    const c = run(extra, { continueAfterIntentUnmet: true })
    expect(c.completion.status).toBe('axisFailed'); expect(c.completion.coverage.loopExitAt.reason).toBe('idle')
    expect(c.strictReport.unmetIntents[0]?.continued).toBe(true)
    expect(c.completion.diagnosticContinuationFrom?.worldFrame).toBe(r.completion.coverage.completedTicks)
    expect(eventsOfLog(c.log, 'switch')[0]?.intro).toBe(false)
    expect(run(extra, { strict: false }).completion.status).toBe('completed')
  })
  test.each([['甲 打~','strict.filler'],['甲 打?','strict.optional'],['at 3','strict.at'],['能量满 甲','strict.external'],['敌人 失谐','strict.external']])('C02-6 %s', (line, code) => {
    const p = prepareRun(sc({ rotation: [line] }), data); expect(p).toMatchObject({ ok: false, issues: [{ code, line: 1, item: 1 }] })
  })
  test('C02-8/9/10 来源、录像与操作延迟', () => {
    expect(prepareRun(sc({ purpose: 'replay' }), data)).toMatchObject({ ok: false, issues: [{ code: 'strict.replay' }] })
    expect(run().identity.execution.strictSource).toBe('scenario')
    expect(run({}, { strict: false }).identity.execution).toMatchObject({ entryMode: 'standard', strictSource: 'cli-override' })
    expect(run({}, { options: { inputDelay: 6 } }).strictReport.earliestLegalBaseline).toBe(false)
  })
  test('C02-4b 多余强制提示', () => { expect(run({ rotation: ['甲 打', 'wait 60', '甲 打!'] }).strictReport.hints[0]?.code).toBe('forceNoCancel') })
  test('C02-3 空中、出场技失败', () => {
    expect(run({ rotation: ['甲 打', 'switch 乙', '乙 空A'] }).completion.axisFailure?.unmetIntent?.kind).toBe('airEntry')
    expect(run({ rotation: ['switch 乙 变奏', '乙 出场'], initial: { concerto: [100,0,0] } }).completion.axisFailure?.unmetIntent?.kind).toBe('entrySkill')
  })
  test('C02-14 出处校验与摘要排除', () => {
    expect(() => sc({ notation: { rotation: { '99': '不存在' } } })).toThrow()
    expect(run({ notation: { source: '作者' } }).runId).toBe(run().runId)
  })
  test('C02-15/16/17 谐破声明和别名检查', () => {
    expect(prepareRun(sc({ tuneBreakOmitted: undefined }), data)).toMatchObject({ ok: false, issues: [{ code: 'strict.tuneBreakUndeclared' }] })
    expect(() => sc({ options: { tuneBreak: 'auto' } })).toThrow()
    for (const strict of [false, true]) expect(prepareRun(sc({ rotation: ['甲 TB'], options: { strict, tuneBreak: 'manual' } }), data)).toMatchObject({ ok: false, issues: [{ code: 'tuneBreak.omittedButWritten' }] })
    expect(run({ tuneBreakOmitted: undefined, options: { tuneBreak: 'manual' } }).damageScope.tuneBreak).toEqual({ mode: 'omitted', reason: 'undeclared', gauge: 'accumulates' })
  })
  test('C02-5b 超时保留阻挡条件和资源', () => {
    const r = run({ rotation: ['甲 谐破'], tuneBreakOmitted: undefined, options: { strict: true, tuneBreak: 'manual', maxWait: 120 } })
    expect(r.strictReport.timeoutContext).toMatchObject({ maxWait: 120, blocked: { code: 'hook' }, blockingRole: 'actor', subjects: [{ char: '甲' }] })
  })
  test('C02-3a/3c 空中与后台动作等待', () => {
    const air = run({ rotation: ['甲 跳', 'switch 乙', '乙 空A'] })
    expect(air.completion.status).toBe('completed')
    expect(air.strictReport.intentWaits.some(w => w.code === 'airborne')).toBe(true)
    const busy = run({ initial: { onField: 1 }, rotation: ['乙 长', 'switch 甲', 'switch 乙', '乙 出场'] })
    expect(busy.completion.status).toBe('completed')
    expect(busy.strictReport.intentWaits.some(w => w.code === 'entryBusy')).toBe(true)
  })
  test('C02-18 切入者冷却超时与两方资源', () => {
    const r = run({ rotation: ['switch 乙', 'switch 甲'], options: { strict: true, tuneBreak: 'off', maxWait: 60, rules: { switchCooldown: 120 } } })
    expect(r.strictReport.timeoutContext).toMatchObject({ blocked: { code: 'switchCd' }, blockingRole: 'switchIn', subjects: [{ role: 'switchOut', char: '乙' }, { role: 'switchIn', char: '甲' }] })
  })
  test('C02-7/19 关闭手写谐破与自动混用的口径', () => {
    const source = sc({ rotation: ['甲 TB'], tuneBreakOmitted: undefined })
    expect(prepareRun(source, data)).toMatchObject({ ok: false, issues: [{ code: 'strict.tuneBreakOff', line: 1, item: 1 }] })
    const off = prepareRun(source, data, { strict: false })
    expect(off.ok && off.run.effective.damageScope.tuneBreak).toEqual({ mode: 'omitted', reason: 'disabledByOption', gauge: 'off' })
    expect(off.ok && off.warnings.length).toBeGreaterThan(0)
    const auto = prepareRun(source, data, { strict: false, options: { tuneBreak: 'auto' } })
    expect(auto.ok && auto.run.effective.damageScope.tuneBreak.mode).toBe('writtenPlusAuto')
  })
  test('变奏钩子回退与不存在 ID', () => {
    for (const [pick, status] of [[undefined, 'completed'], ['不存在', 'engineError']] as const) {
      const d = { ...data, hooks: { 乙: { introAction: () => pick } } }
      const p = prepareRun(sc(), d)
      expect(p.ok && runPrepared(p.run).completion.status).toBe(status)
    }
    const p = prepareRun(sc({ rotation: ['switch 丙 变奏'] }), data)
    expect(p).toMatchObject({ ok: false, issues: [{ code: 'strict.noIntroAction' }] })
  })

  test('C02-4 强制取消确实丢判定，C02-4b 后续不需要强制', () => {
    const ordinary = run({ rotation: ['甲 打', '甲 打'] })
    const forced = run({ rotation: ['甲 打', '甲 打!'] })
    const starts = (r: ReturnType<typeof run>) => eventsOfLog(r.log, 'actionStart').map(e => e.f)
    expect(starts(ordinary)[1]! - starts(forced)[1]!).toBe(20)
    expect(eventsOfLog(forced.log, 'hit')).toHaveLength(1)
    expect(forced.strictReport.hints).toEqual([])
    expect(run({ rotation: ['甲 打', 'wait 21', '甲 打!'] }).strictReport.hints[0]?.code).toBe('forceNoEffect')
  })
  test('C02-5a 先等待偏谐命中再手写谐破', () => {
    const d = { ...data, characters: { ...data.characters, 甲: { ...data.characters.甲!, tunabilityRate: 1, actions: { ...data.characters.甲!.actions, 打: action({ id: '打', endFrame: 40, cancelWindows: [{ from: 1, until: 40, row: 0 }], judgments: [judgment({ name: '偏谐', spawnFrame: 20, gauges: { toughness: 0, tunability: 10 } })] }) } } } }
    const p = prepareRun(sc({ enemy: { custom: { level: 90, tunabilityMax: 1 } }, rotation: ['甲 打', '甲 谐破'], tuneBreakOmitted: undefined, options: { strict: true, tuneBreak: 'manual' } }), d)
    if (!p.ok) throw new Error(JSON.stringify(p.issues))
    const r = runPrepared(p.run)
    expect(r.completion.status).toBe('completed')
    expect(eventsOfLog(r.log, 'wait').some(e => e.code === 'hook')).toBe(true)
  })

  test('续跑之后的不可续跑意图也进报告', () => {
    const r = run({ initial: { concerto: [89, 0, 0] }, rotation: ['甲 打', 'switch 乙 变奏', '乙 长', '乙 出场'] }, { continueAfterIntentUnmet: true })
    expect(r.strictReport.unmetIntents.map(d => [d.kind, d.continued])).toEqual([['introMissed', true], ['entrySkill', false]])
    expect(r.completion.axisFailure?.unmetIntent?.kind).toBe('introMissed')
  })

})
