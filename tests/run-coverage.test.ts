// tests/run-coverage.test.ts —— 完成状态与覆盖范围（DD-01 §3.5–§3.8；架构 §2.2、§2.3 的七条停止路径；用例 C01-8～C01-24）
// 人造角色，不依赖生成数据。每条停止路径都断言 status、loopExitAt、finalization、terminal.kind、completedTicks 与两个上界。
import { preparedScenario } from './helpers/prepared-fixture'
import { describe, expect, test } from 'vitest'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { RULE_POINTS } from '../src/engine/rule-points'
import { prepareRun, runPrepared } from '../src/engine/run'

import type { SimResult } from '../src/engine/types'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

const 乙 = idle('乙'), 丙 = idle('丙')
const scenarioOf = (甲: SynthChar, sc: Partial<ScenarioInput>) => ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, ...sc,
})
/** 新入口：prepareRun + runPrepared */
function go(甲: SynthChar, sc: Partial<ScenarioInput>): SimResult {
  const p = prepareRun(scenarioOf(甲, sc), synthData([甲, 乙, 丙]))
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
  return runPrepared(p.run)
}
/** 兼容外壳 */
const runSource = (甲: SynthChar, sc: Partial<ScenarioInput>): SimResult => runPrepared(preparedScenario(scenarioOf(甲, sc), synthData([甲, 乙, 丙])))
/** 两个上界 [已处理, 已记日志] */
const bounds = (r: SimResult) => { const p = r.completion.coverage.terminal.prefix; return [p.handledEndExclusive, p.eventEndExclusive] }

// X：10 帧、第 5 帧一个判定；C：10 帧、冷却 500 帧；L：10 帧、第 2 帧起一个 500 帧的持续判定；Y：只能接在 Z 后面
const X = action({ id: 'X', endFrame: 10, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })
const C = action({ id: 'C', endFrame: 10, cooldown: 500 })
const L = action({ id: 'L', endFrame: 10, judgments: [judgment({ name: '持续', spawnFrame: 2, lifeFrames: 500, ticks: 50, tickInterval: 10 })] })
const Y = action({ id: 'Y', endFrame: 10, comboFrom: ['Z'] }), Z = action({ id: 'Z', endFrame: 10 })
const 甲: SynthChar = { name: '甲', actions: [X, C, L, Y, Z] }
/** 收到任何动作的 actionEnd 就抛错的钩子 */
const boom: SynthChar = { name: '甲', actions: [X], hooks: { onEvent: (_ctx, ev) => { if (ev.type === 'actionEnd') throw new Error('boom') } } }
const COOLDOWN = { rotation: ['甲 C C'], options: { maxFrames: 100, maxWait: 1000 } }
const COMBO = { rotation: ['甲 X', '甲 Y'] }

describe('七条停止路径（DD-01 §3.6 的判定表）', () => {
  test('C01-8 自然结束：completed，P2 空闲退出，收尾的 drain 做完', () => {
    const r = go(甲, { rotation: ['甲 X'] })
    const c = r.completion
    expect(c.status).toBe('completed')
    expect(c.coverage).toEqual({
      initCompleted: true, completedTicks: 10, loggedEventEndExclusive: r.log.length,
      loopExitAt: { reason: 'idle', worldFrame: 10, phase: 'P2' },
      finalization: { kind: 'postDrain', completed: true },
      terminal: { kind: 'afterPostDrain', prefix: { eventEndExclusive: r.log.length, handledEndExclusive: r.log.length, interventionEndExclusive: 0 } },
    })
    expect(c.axisFailure ?? c.truncation ?? c.engineError).toBeUndefined()
    expect(c.loops).toEqual({ planned: 1, started: 1, completed: 1, openingCompleted: null, roundEnds: [{ loop: 1, endBattleFrame: 10 }] })
    expect(c.conditioning).toEqual({ basis: 'unconditioned', firstInterventionIndex: null })
    expect(r.error).toBeUndefined()
    // 必有记录都在；规则使用（DD-05 §4）的覆盖清单就是判定点表，这条轴没有切人、没有声骸，读到的只有结算的 defFloor 与插队的谐破开关
    expect(r.interventions).toEqual([])
    expect(r.strictReport).toEqual({ entry: 'standard', earliestLegalBaseline: false, compileChecks: [], intentWaits: [], unmetIntents: [], hints: [] })
    expect(r.ruleUsage.coverage.map(x => x.pointId)).toEqual(RULE_POINTS.map(p => p.id))
    expect(r.ruleUsage.byProposition.filter(x => x.readCount > 0).map(x => x.propositionId)).toEqual(['echo-input-priority', 'input-delay', 'tune-break-mode', 'def-floor'])
    expect(r.damageScope).toEqual({ tuneBreak: { mode: 'auto' } })
    expect(r.diag).toBeUndefined()
  })

  test('C01-9 不计入的那个 tick 里产生的事件属于终态：f 等于 completedTicks，仍在日志上界之内', () => {
    const r = go({
      name: '甲', actions: [action({ id: 'X', endFrame: 1 })], core: [{ slot: 1, name: '豆', cap: 10 }],
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'actionEnd' && ev.char === '甲') ctx.addResource('core1', 1) } },
    }, { rotation: ['甲 X'] })
    const cov = r.completion.coverage
    expect(r.completion.status).toBe('completed')
    expect(cov.completedTicks).toBe(1)
    const end = r.log.findIndex(e => e.type === 'actionEnd')
    expect(r.log.slice(end).map(e => [e.type, e.f])).toEqual([['actionEnd', 1], ['resource', 1]])   // 资源那条是收尾的 drain 引出的
    expect(r.log[end]!.f).toBe(cov.completedTicks)
    expect(cov.loggedEventEndExclusive).toBe(end + 2)
    expect(bounds(r)).toEqual([end + 2, end + 2])
  })

  test('C01-10 到帧数上限、指令已发完：truncated / inFlightRemains，记警告后照常收尾', () => {
    const r = go(甲, { rotation: ['甲 L'], options: { maxFrames: 100 } })
    const c = r.completion
    expect(c.status).toBe('truncated')
    expect(c.truncation).toEqual({ kind: 'inFlightRemains', remains: { pendingCommands: 0, activeActions: 0, pendingJudgments: 1, pendingTails: 0 } })
    expect(c.coverage).toMatchObject({
      initCompleted: true, completedTicks: 100, loggedEventEndExclusive: r.log.length,
      loopExitAt: { reason: 'maxFrames', worldFrame: 100, phase: 'afterP7' },
      finalization: { kind: 'postDrain', completed: true }, terminal: { kind: 'afterPostDrain' },
    })
    expect(bounds(r)).toEqual([r.log.length, r.log.length])
    expect(r.log.at(-1)).toMatchObject({ type: 'warning', code: 'maxFrames', f: 100 })
    expect(c.loops).toMatchObject({ started: 1, completed: 0, roundEnds: [] })       // 没自然结束，最后一轮的结束边界没确认
    expect(r.error).toBeUndefined()                                                  // 旧字段照旧：这条路径不算报错
  })

  test('C01-11 到帧数上限、指令没发完（在等冷却）：truncated / commandsPending，失败收尾关掉等待段', () => {
    const r = go(甲, COOLDOWN)
    const c = r.completion
    expect(c.status).toBe('truncated')
    expect(c.truncation).toEqual({ kind: 'commandsPending', remains: { pendingCommands: 1, activeActions: 0, pendingJudgments: 0, pendingTails: 0 } })
    expect(c.coverage).toMatchObject({
      initCompleted: true, completedTicks: 100, loggedEventEndExclusive: r.log.length,
      loopExitAt: { reason: 'maxFrames', worldFrame: 100, phase: 'afterP7' },
      finalization: { kind: 'failClose', completed: true }, terminal: { kind: 'afterFailClose' },
    })
    expect(r.log.at(-1)).toMatchObject({ type: 'wait', code: 'cooldown', f: 100 })
    expect(bounds(r)).toEqual([r.log.length - 1, r.log.length])                      // 关等待段写的那条 wait 没人处理
    expect(r.error).toMatchObject({ code: 'maxFrames', frame: 100, line: 1, loop: 1 })
  })

  test('C01-12 到上限时在等 wait 500（写轴的人要的等待也有等待段）；到上限那一帧第一条刚执行', () => {
    const r = go(甲, { rotation: ['甲 X', 'wait 500', '甲 X'], options: { maxFrames: 100, maxWait: 1000 } })
    expect(r.completion.status).toBe('truncated')
    expect(r.completion.truncation).toMatchObject({ kind: 'commandsPending', remains: { pendingCommands: 2 } })   // wait 与它后面那条
    expect(r.completion.coverage).toMatchObject({
      completedTicks: 100, loopExitAt: { reason: 'maxFrames', worldFrame: 100, phase: 'afterP7' },
      finalization: { kind: 'failClose', completed: true }, terminal: { kind: 'afterFailClose' },
    })
    expect(r.log.at(-1)).toMatchObject({ type: 'wait', code: 'wait' })
    expect(bounds(r)).toEqual([r.log.length - 1, r.log.length])
    // 第一条在第 0 帧执行，这一帧走完就到上限。现在的调度器在同一个 tick 里接着看第二条（createScheduler 的循环），
    // 所以它已经求值过、开了一段 1 帧的等待：同样是 afterFailClose，上界差 1。设计里"第二条还没求值过、没有等待段"
    // 的那种情形（handled === event）在现在的调度器下到不了；上界的算法不靠它（handled = inFlight ?? cursor）
    const b = go(甲, { rotation: ['甲 X X'], options: { maxFrames: 1, maxWait: 1000 } })
    expect(b.completion.status).toBe('truncated')
    expect(b.completion.truncation).toEqual({ kind: 'commandsPending', remains: { pendingCommands: 1, activeActions: 1, pendingJudgments: 0, pendingTails: 0 } })
    expect(b.completion.coverage).toMatchObject({
      completedTicks: 1, loopExitAt: { reason: 'maxFrames', worldFrame: 1, phase: 'afterP7' },
      finalization: { kind: 'failClose', completed: true }, terminal: { kind: 'afterFailClose' },
    })
    expect(b.log.map(e => e.type)).toEqual(['loop', 'actionStart', 'wait'])
    expect(bounds(b)).toEqual([2, 3])
  })

  test('C01-13 收尾的 drain 出错：engineError / uncaught，loopExitAt 照实记 idle，记下正在处理的那条', () => {
    const r = go(boom, { rotation: ['甲 X'] })
    const c = r.completion
    const end = r.log.findIndex(e => e.type === 'actionEnd')
    expect(c.status).toBe('engineError')
    expect(c.engineError).toEqual({ code: 'uncaught', message: 'boom' })
    expect(c.coverage).toEqual({
      initCompleted: true, completedTicks: 10, loggedEventEndExclusive: r.log.length,
      loopExitAt: { reason: 'idle', worldFrame: 10, phase: 'P2' },                   // 循环早已正常退出，不改写成 tick 中途失败
      finalization: { kind: 'postDrain', completed: false, inFlightEventSeq: end },
      terminal: { kind: 'postDrainFailed', prefix: { eventEndExclusive: r.log.length, handledEndExclusive: end, interventionEndExclusive: 0 } },
    })
    expect(c.loops).toMatchObject({ started: 1, completed: 0 })
    expect(r.error).toEqual({ code: 'uncaught', message: 'boom', frame: 10 })
    expect(r.summary.totalDamage).toBeGreaterThan(0)                                 // 日志与汇总保留到出错为止
  })

  test('C01-14 轴失败（连段接不上）：axisFailed / comboBroken，停在 P2，失败收尾做了', () => {
    const r = go(甲, COMBO)
    const c = r.completion
    expect(c.status).toBe('axisFailed')
    expect(c.axisFailure).toEqual({ kind: 'comboBroken', detail: '第 2 条 甲 Y：Y 只能接在 Z 之后' })
    expect(c.coverage).toEqual({
      initCompleted: true, completedTicks: 0, loggedEventEndExclusive: r.log.length,
      loopExitAt: { reason: 'axisFailed', worldFrame: 0, phase: 'P2' },
      finalization: { kind: 'failClose', completed: true },
      terminal: { kind: 'midTick', prefix: { eventEndExclusive: r.log.length, handledEndExclusive: r.log.length, interventionEndExclusive: 0 } },
    })
    expect(c.coverage.completedTicks).toBe(r.error!.frame)                           // 出错那一帧的世界帧：这个 tick 没走完，不计入
    // 等了一阵才失败的（等超时）：completedTicks 是出错那一帧，等待段由失败收尾关掉
    const t = go(甲, { rotation: ['甲 C C'], options: { maxWait: 30 } })
    expect(t.completion).toMatchObject({
      status: 'axisFailed', axisFailure: { kind: 'timeout' },
      coverage: { completedTicks: t.error!.frame, loopExitAt: { reason: 'axisFailed', phase: 'P2' }, finalization: { kind: 'failClose', completed: true }, terminal: { kind: 'midTick' } },
    })
    expect(t.completion.coverage.completedTicks).toBeGreaterThan(0)
    expect(t.log.at(-1)).toMatchObject({ type: 'wait', code: 'cooldown' })
    expect(bounds(t)).toEqual([t.log.length - 1, t.log.length])
  })

  test('C01-15 事件连锁过深：engineError / chainDepth，不经失败收尾，记下正在处理的那条', () => {
    const r = go({
      name: '甲', actions: [X], core: [{ slot: 1, name: '豆', cap: 1e9 }],
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'actionStart' || ev.type === 'resource') ctx.addResource('core1', 1) } },
    }, { rotation: ['甲 X'] })
    const c = r.completion
    expect(c.status).toBe('engineError')
    expect(c.engineError?.code).toBe('chainDepth')
    const seq = r.log.length - 1                                                     // 超过层数的那条：还没轮到处理器就报错了
    expect(c.coverage).toEqual({
      initCompleted: true, completedTicks: 0, loggedEventEndExclusive: r.log.length,
      loopExitAt: { reason: 'engineError', worldFrame: 0, phase: 'P2', inFlightEventSeq: seq },
      finalization: { kind: 'none', completed: true },
      terminal: { kind: 'midTick', prefix: { eventEndExclusive: r.log.length, handledEndExclusive: seq, interventionEndExclusive: 0 } },
    })
    expect(r.error).toMatchObject({ code: 'chainDepth', frame: 0 })
  })

  test('C01-16 初始化没走完（onResolve 抛错）：engineError，initIncomplete，一个 tick 都没有', () => {
    const r = go({ name: '甲', actions: [X], hooks: { onResolve: () => { throw new Error('init boom') } } }, { rotation: ['甲 X'] })
    const c = r.completion
    expect(c.status).toBe('engineError')
    expect(c.engineError).toEqual({ code: 'uncaught', message: 'init boom' })
    expect(c.coverage).toEqual({
      initCompleted: false, completedTicks: 0, loggedEventEndExclusive: 0,
      loopExitAt: { reason: 'engineError', worldFrame: 0, phase: 'init' },
      finalization: { kind: 'none', completed: true },
      terminal: { kind: 'initIncomplete', prefix: { eventEndExclusive: 0, handledEndExclusive: 0, interventionEndExclusive: 0 } },
    })
    expect(c.loops).toMatchObject({ started: 0, completed: 0 })
    expect(r.log).toEqual([])
    expect(r.summary.totalDamage).toBe(0)                                            // 空汇总，不抛
  })
})

describe('外部干预记录（DD-01 §3.8）', () => {
  test('C01-17 同步、敌人 失谐各记一条，排在自己引出的事件之前；运行算有条件的（原来用能量满，DD-09 T09-10 删了，换成同步）', () => {
    const r = go(甲, {
      rotation: ['甲 X', '同步 甲 能量 100%', '敌人 失谐', '甲 X'], initial: { energy: 'empty' },
      enemy: { custom: { level: 90, tunabilityMax: 100 } }, options: { tuneBreak: 'manual' },
    })
    expect(r.completion.status).toBe('completed')
    expect(r.interventions).toHaveLength(2)
    const [sync, dis] = r.interventions
    expect(r.log.some(e => e.type === 'resource' && e.char === '甲' && e.resource === 'energy')).toBe(false)   // 同步不写日志
    const st = r.log.findIndex(e => e.type === 'enemyState' && e.change === 'disharmony')
    expect(st).toBeGreaterThan(-1)
    expect(sync).toMatchObject({
      index: 0, phase: 'P2', orderInAnchor: 0, kind: 'sync', target: { slot: 0, resource: 'energy' }, before: 0, adopted: 100, delta: 100,
      firedTriggers: false, skippedTriggers: ['resource', 'resourceFull'],
    })
    expect(dis).toMatchObject({ index: 1, phase: 'P2', kind: 'enemyDisharmony', firedTriggers: true, skippedTriggers: [] })
    expect(sync!.afterEventSeq).toBeLessThan(st)
    expect(dis!.afterEventSeq).toBeLessThan(st)                                      // 排在自己引出的 enemyState 之前
    // 同步不写事件：两条挂在同一个锚点上，orderInAnchor 依次是 0、1
    expect([dis!.afterEventSeq, dis!.orderInAnchor]).toEqual([sync!.afterEventSeq, 1])
    expect(r.completion.conditioning).toEqual({ basis: 'conditioned', firstInterventionIndex: 0 })
    expect(r.completion.coverage.terminal.prefix.interventionEndExclusive).toBe(2)
    // 同一个锚点下连着两条：orderInAnchor 递增
    const two = go(甲, { rotation: ['同步 甲 能量 100%', '同步 乙 能量 100%', '甲 X'], initial: { energy: 'full' } })
    expect(two.interventions.map(i => [i.afterEventSeq, i.orderInAnchor, i.delta])).toEqual([[-1, 0, 0], [-1, 1, 0]])
  })
})

describe('endAt 只截统计窗口（DD-01 §3.6；DF-01、DF-25）', () => {
  const sc = (endAt?: number): Partial<ScenarioInput> => ({ rotation: ['甲 X', '甲 X'], options: { repeat: 3, ...(endAt ? { endAt } : {}) } })

  test('C01-18 设不设 endAt，日志与覆盖范围相同，只有汇总的窗口不同', () => {
    const a = go(甲, sc()), b = go(甲, sc(25))
    expect(b.log).toEqual(a.log)
    expect(b.completion.coverage).toEqual(a.completion.coverage)
    expect(b.completion.status).toBe(a.completion.status)
    expect([a.summary.windowFrames, b.summary.windowFrames]).toEqual([60, 25])
    expect(b.summary.totalDamage).toBeLessThan(a.summary.totalDamage)
    expect(b.runId).not.toBe(a.runId)                                                // 口径不同，是两次不同的运行
  })

  test('C01-24 只改 endAt，loops 的各字段（含 roundEnds）都相同', () => {
    const a = go(甲, sc()), b = go(甲, sc(25))
    expect(a.completion.loops).toEqual({
      planned: 3, started: 3, completed: 3, openingCompleted: null,
      roundEnds: [{ loop: 1, endBattleFrame: 20 }, { loop: 2, endBattleFrame: 40 }, { loop: 3, endBattleFrame: 60 }],
    })
    expect(b.completion.loops).toEqual(a.completion.loops)
    // 稳态目标：窗口把第 2 轮截掉了一半，稳态的轮没有都落在窗口里，不算达到
    expect([a.completion.goal, b.completion.goal]).toEqual([{ kind: 'steady', reached: true }, { kind: 'steady', reached: false }])
  })
})

describe('正式运行结果（DD-10 §5；DD-01 §3.7）', () => {
  test('C01-19 error 字段照旧：没有 / maxFrames / comboBroken；新字段也带着', () => {
    const ok = runSource(甲, { rotation: ['甲 X'] })
    expect(ok.error).toBeUndefined()
    expect(ok.completion.status).toBe('completed')
    expect(ok.identity.execution.scenarioDigest).toMatch(/^[0-9a-f]{64}$/)                     // 正式入口记录源场景摘要
    expect(ok.runId).toMatch(/^run-[0-9a-f]{16}$/)
    expect(runSource(甲, COOLDOWN).error).toEqual({ code: 'maxFrames', message: '超过 100 帧，第 1 条第 2 个还没执行；调大 options.maxFrames', frame: 100, line: 1, loop: 1 })
    expect(runSource(甲, COMBO).error).toEqual({ code: 'comboBroken', message: '第 2 条 甲 Y：Y 只能接在 Z 之后', frame: 0, line: 2, loop: 1 })
    expect(runSource(甲, { rotation: ['甲 L'], options: { maxFrames: 100 } }).error).toBeUndefined()
    // 同一份源场景，重复执行的日志与汇总相同
    const neu = go(甲, COOLDOWN), was = runSource(甲, COOLDOWN)
    expect(was.log).toEqual(neu.log)
    expect(was.summary).toEqual(neu.summary)
    expect(was.completion).toEqual(neu.completion)
  })

  test('C01-20 钩子异常记为 engineError，观察回调异常仍抛出（DD-10 §5）', () => {
    expect(runSource(boom, { rotation: ['甲 X'] }).completion).toMatchObject({ status: 'engineError', engineError: { code: 'uncaught', message: 'boom' } })
    expect(runSource({ name: '甲', actions: [X], hooks: { onResolve: () => { throw new Error('init boom') } } }, { rotation: ['甲 X'] }).completion).toMatchObject({ status: 'engineError', engineError: { code: 'uncaught', message: 'init boom' }, coverage: { initCompleted: false } })
    // 观察回调自己抛的错，新入口也原样抛：那是调用方的错，不是这次运行的结论
    const p = prepareRun(scenarioOf(甲, { rotation: ['甲 X'] }), synthData([甲, 乙, 丙]))
    expect(() => p.ok && runPrepared(p.run, { onHit: () => { throw new Error('observer') } })).toThrow('observer')
  })
})

describe('执行轮数（DD-01 §3.6；DF-01）', () => {
  test('C01-21 启动轴里失败：一轮都没开始；在那里截断时，没执行的指令 = 启动轴剩下的 + 整个循环轴的每一轮', () => {
    const opts = { rotation: ['甲 X', '甲 X'], options: { repeat: 2 } }
    const f = go(甲, { ...opts, opening: ['甲 X', '甲 Y', '甲 X'] })
    expect(f.completion.status).toBe('axisFailed')
    expect(f.completion.loops).toEqual({ planned: 2, started: 0, completed: 0, openingCompleted: false, roundEnds: [] })
    const t = go(甲, { rotation: opts.rotation, opening: ['甲 C', '甲 C', '甲 X'], options: { repeat: 2, maxFrames: 100, maxWait: 1000 } })
    expect(t.completion.status).toBe('truncated')
    expect(t.completion.truncation).toMatchObject({ kind: 'commandsPending', remains: { pendingCommands: 2 + 2 * 2 } })
    expect(t.completion.loops).toMatchObject({ started: 0, completed: 0, openingCompleted: false })
    // 启动轴走完的
    const done = go(甲, { ...opts, opening: ['甲 X'] })
    expect(done.completion.loops).toMatchObject({ started: 2, completed: 2, openingCompleted: true })
    expect(done.completion.loops.roundEnds.map(e => e.loop)).toEqual([0, 1, 2])
  })

  test('C01-22 第 2 轮的指令发完了、末条的判定还在场上就到上限：第 2 轮不算完成', () => {
    const r = go(甲, { rotation: ['甲 X', '甲 L'], options: { repeat: 2, maxFrames: 40 } })
    expect(r.completion.status).toBe('truncated')
    expect(r.completion.truncation).toMatchObject({ kind: 'inFlightRemains', remains: { pendingCommands: 0 } })
    expect(r.completion.truncation!.remains.pendingJudgments).toBeGreaterThanOrEqual(1)
    expect(eventsOfLog(r.log, 'actionStart').filter(e => e.action === 'L')).toHaveLength(2)
    expect(r.completion.loops).toEqual({ planned: 2, started: 2, completed: 1, openingCompleted: null, roundEnds: [{ loop: 1, endBattleFrame: 20 }] })
  })

  test('C01-23 第 1 轮末条执行后第 2 轮首条一直在等：调度游标已经到第 2 轮，日志里没有第 2 轮的边界', () => {
    const r = go(甲, { rotation: ['甲 C'], options: { repeat: 2, maxFrames: 100, maxWait: 1000 } })
    expect(r.completion.status).toBe('truncated')
    expect(r.error).toMatchObject({ code: 'maxFrames', loop: 2 })                    // 在等的是第 2 轮的指令（queue.loop === 2）
    expect(eventsOfLog(r.log, 'loop').map(e => e.loop)).toEqual([1])
    expect(r.completion.loops).toEqual({ planned: 2, started: 1, completed: 0, openingCompleted: null, roundEnds: [] })
    expect(r.completion.truncation).toMatchObject({ kind: 'commandsPending', remains: { pendingCommands: 1 } })
  })
})
