// tests/state-query.test.ts —— DD-07 状态查询、试算、可解释性与跨运行比较验收用例（C07-1～C07-21、C07-24～C07-31；C07-22/23 在 wire-json.test.ts）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { BuffDefInput } from '../src/data/buff.schema'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { ALL_DIAG } from '../src/engine/diagnostics'
import { computeHit, computeTuneBreak, emptyAccumulator } from '../src/engine/formula'
import {
  deterministicDelayOf,
  explainAct,
  explainFiring,
  explainSwitch,
  firstBlockingOf,
  freezeStateProjection,
  probeEnvOf,
  readonlyContext,
  type ConditionCheck,
} from '../src/engine/probe'
import {
  commandCheck,
  diffRuns,
  eventsBySeq,
  explainEvent,
  openProbe,
  rawActionCheck,
  replayTo,
  stateAt,
  terminalState,
  whyDidEventNotTrigger,
  wouldHypotheticalEventTrigger,
  type StateView,
} from '../src/engine/query'
import { prepareRun, runPrepared, runToExecution } from '../src/engine/run'
import type { PreparedRun, RunOverrides } from '../src/engine/run-types'
import { envelope, toWire } from '../src/engine/wire'
import type { HitEvent, SimResult, WaitCode } from '../src/engine/types'
import { diagBase, preparedSynth } from './helpers/diag-team'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

const buff = (o: Partial<BuffDefInput> & { id: string }): BuffDefInput =>
  ({ source: 't', zone: 'atkPct', value: 0.5, target: 'self', duration: 600, trigger: { on: 'actionStart' }, ...o }) as BuffDefInput

const prep = (chars: [SynthChar, SynthChar, SynthChar], sc: Record<string, unknown>, overrides: RunOverrides = {}): PreparedRun =>
  preparedSynth(chars, sc, overrides)

/** probe.ts 的 ConditionCheck.id 映射到 scheduler 的 WaitCode */
function condIdToWaitCode(id: string): string {
  switch (id) {
    case 'entry.skillRequired':
    case 'entry.skillAllowed':
      return 'entry'
    case 'gate.combo': return 'combo'
    case 'gate.inputLock': return 'inputLock'
    case 'gate.priority': return 'priority'
    case 'gate.derive': return 'derive'
    case 'gate.started': return 'started'
    case 'hook.canStart': return 'hook'
    case 'inputDelay': return 'input'
    case 'airEntry': return 'airborne'
    default: return id
  }
}

/** 验证一条 PreparedRun 的全部真实求值点与只读检查 firstBlocking 一致（C07-9）：单次执行检查全部 eval + commandCheck 抽样对拍 */
function assertVerdictsMatchProbe(p: PreparedRun): void {
  const env = probeEnvOf(p.resolved, p.effective.sample)
  const kStub = { rules: p.resolved.rules } as unknown as import('../src/engine/kernel').Kernel
  const seen: { cmd: { loop: number; line: number; item: number }; evaluationIndex: number; firstBlocking: string | null }[] = []
  runToExecution(p, {
    diag: { commandVerdicts: true },
    afterEvaluate: (s, c, ref, verdict, evaluationIndex) => {
      if ('threw' in verdict) return
      const q = s.queue
      const proj = freezeStateProjection(s)
      let checks: ConditionCheck[] = []
      if (c.kind === 'act') {
        const def = p.resolved.team[c.slot]!.actions[c.action]!
        checks = explainAct(s, kStub, env, c.slot, def, {
          force: c.force,
          delay: c.delay,
          input: !def.comboFrom?.length,
          optional: c.optional,
          readyAt: q.readyAt,
          extra: q.extra,
          actions: p.resolved.team[c.slot]!.actions,
          deterministicInputDelay: deterministicDelayOf(env, s, ref),
          ro: readonlyContext(env, proj, c.slot, true),
        })
      } else if (c.kind === 'switch') {
        const list = q.loop === 0 ? q.opening : q.commands
        const nxt = list[q.next + 1] ?? (q.loop > 0 || q.commands.length ? q.commands[0] : undefined)
        const nextAction = nxt?.kind === 'act' && nxt.slot === c.to ? p.resolved.team[c.to]!.actions[nxt.action]! : null
        checks = explainSwitch(s, kStub, env, c, {
          expectIntro: c.expectIntro,
          nextAction,
          readyAt: q.readyAt,
          extra: q.extra,
          deterministicInputDelay: deterministicDelayOf(env, s, ref),
          roTo: readonlyContext(env, proj, c.to, true),
        })
      } else if (c.kind === 'wait') {
        const until = q.until ?? s.battleFrames + c.frames
        checks = [{ id: 'wait', status: s.battleFrames >= until ? 'met' : 'unmet', expected: `>= ${until}`, actual: `${s.battleFrames}` }]
      } else if (c.kind === 'at') {
        checks = [{ id: 'at', status: s.frame >= c.frame ? 'met' : 'unmet', expected: `>= ${c.frame}`, actual: `${s.frame}` }]
      }
      const fb = firstBlockingOf(checks)
      seen.push({ cmd: ref, evaluationIndex, firstBlocking: fb })
      if (verdict.go) {
        expect([null, 'introReady']).toContain(fb)
      } else {
        expect(fb).not.toBeNull()
        expect(condIdToWaitCode(fb!)).toBe(verdict.code)
      }
    },
  })
  expect(seen.length).toBeGreaterThan(0)
  const samples = [...new Set([0, Math.floor(seen.length / 2), seen.length - 1])]
  for (const idx of samples) {
    const item = seen[idx]!
    const chk = commandCheck(p, item.cmd, { evaluationIndex: item.evaluationIndex })
    expect(chk.ok).toBe(true)
    if (!chk.ok) continue
    expect(chk.value.firstBlocking).toBe(item.firstBlocking)
  }
}

describe('DD-07 状态查询与可解释性验收', () => {
  test('C07-1：onHit 回调里嵌套运行另一份 PreparedRun，外层日志与不嵌套时逐条相等', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [
        action({
          id: 'X', kind: 'skill', endFrame: 30, judgments: [
            judgment({ name: 'a', spawnFrame: 5 }),
            judgment({ name: 'b', spawnFrame: 12 }),
            judgment({ name: 'c', spawnFrame: null }),
          ],
        }),
      ],
      hooks: {
        onEvent(ctx, ev) {
          if (ev.type === 'hit' && ev.char === '甲' && ev.judgment === 'a') {
            ctx.spawnJudgment('c', { note: '嵌套前入队' })
          }
        },
      },
    }
    const outerP = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const innerP = diagBase()
    const clean = runPrepared(outerP)
    const nested = runPrepared(outerP, {
      onHit: () => {
        runPrepared(innerP)
      },
    })
    expect(nested.log).toEqual(clean.log)
  })

  test('C07-2：boundaries 一次重放与 20 个抽样帧的 stateAt 逐字段相等，且每帧日志已全部处理', () => {
    const 甲: SynthChar = {
      name: '甲',
      core: [{ slot: 1, name: '豆', cap: 10 }],
      actions: [
        action({
          id: 'A', kind: 'normal', endFrame: 50,
          judgments: [judgment({ name: 'h1', spawnFrame: 15, gains: { energy: 5, concerto: 8, core: [1, 0, 0] } })],
        }),
        action({
          id: 'B', kind: 'skill', endFrame: 60, cooldown: 90,
          judgments: [judgment({ name: 'h2', spawnFrame: 25 })],
        }),
      ],
      buffs: [buff({ id: '甲.增攻', duration: 120, trigger: { on: 'actionStart' } })],
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', '甲 B', 'wait 120', '甲 A'] })
    const term = terminalState(p)
    expect(term.ok).toBe(true)
    if (!term.ok) return
    const total = term.value.completion.coverage.completedTicks
    expect(total).toBeGreaterThanOrEqual(200)

    const sampleFrames = Array.from({ length: 20 }, (_, i) => Math.floor((i * total) / 19))
    const uniqueFrames = [...new Set(sampleFrames)]
    const byBoundaries = new Map<number, { view: StateView; prefix: { eventEndExclusive: number; handledEndExclusive: number } }>()
    replayTo(p, {
      kind: 'boundaries',
      frames: uniqueFrames,
      onReach: (f, view, prefix) => {
        expect(prefix.eventEndExclusive).toBe(prefix.handledEndExclusive)
        byBoundaries.set(f, { view, prefix })
      },
    })
    expect(byBoundaries.size).toBe(uniqueFrames.length)

    for (const f of uniqueFrames) {
      const s = stateAt(p, f)
      expect(s.ok).toBe(true)
      if (!s.ok) continue
      const b = byBoundaries.get(f)!
      expect(s.value.view).toEqual(b.view)
      expect(s.value.prefix.eventEndExclusive).toBe(s.value.prefix.handledEndExclusive)
      expect(s.value.prefix.eventEndExclusive).toBe(b.prefix.eventEndExclusive)
    }
  })

  test('C07-3：冷却 60 帧在 S[59] 剩 1、S[60] 为 0，第二个 actionStart 在 f=60', () => {
    const 甲: SynthChar = { name: '甲', actions: [action({ id: 'E', endFrame: 30, cooldown: 60 })] }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 E', '甲 E'] })
    const res = runPrepared(p)
    expect(res.log.filter(e => e.type === 'actionStart').map(e => e.f)).toEqual([0, 60])

    const s59 = stateAt(p, 59)
    const s60 = stateAt(p, 60)
    expect(s59.ok && s60.ok).toBe(true)
    if (!s59.ok || !s60.ok) return
    expect(s59.value.view.chars[0]!.cooldowns['E']).toBe(1)
    expect(s60.value.view.chars[0]!.cooldowns['E']).toBe(0)
  })

  test('C07-4：C01-9（1 帧动作）在 S[completedTicks] 动作未结束，terminalState 已结束且核心多 1', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', endFrame: 1 })],
      core: [{ slot: 1, name: '豆', cap: 10 }],
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'actionEnd' && ev.char === '甲') ctx.addResource('core1', 1) } },
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const term = terminalState(p)
    expect(term.ok).toBe(true)
    if (!term.ok) return
    expect(term.value.kind).toBe('afterPostDrain')
    expect(term.value.view.chars[0]!.action).toBeNull()
    expect(term.value.view.chars[0]!.core[0]).toBe(1)

    const b = stateAt(p, term.value.completion.coverage.completedTicks)
    expect(b.ok).toBe(true)
    if (!b.ok) return
    expect(b.value.view.chars[0]!.action).toMatchObject({ id: 'X', ended: false })
    expect(b.value.view.chars[0]!.core[0]).toBe(0)
    expect(b.value.prefix).not.toEqual(term.value.prefix)
  })

  test('C07-5：C01-11（截断且等待冷却）S[N] 有 queue.seg，terminalState 为空且 afterFailClose', () => {
    const 甲: SynthChar = { name: '甲', actions: [action({ id: 'E', endFrame: 30, cooldown: 500 })] }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 E', '甲 E'], options: { maxFrames: 100 } })
    const term = terminalState(p)
    expect(term.ok).toBe(true)
    if (!term.ok) return
    expect(term.value.kind).toBe('afterFailClose')
    expect(term.value.view.queue.seg).toBeNull()
    expect(term.value.prefix.handledEndExclusive).toBe(term.value.prefix.eventEndExclusive - 1)

    const b = stateAt(p, term.value.completion.coverage.completedTicks)
    expect(b.ok).toBe(true)
    if (!b.ok) return
    expect(b.value.view.queue.seg).not.toBeNull()
    expect(b.value.view.queue.seg!.code).toBe('cooldown')
  })

  test('C07-6：越界与无合法状态错误码（outOfRange / noLegalState / eventOutOfRange）', () => {
    const p = diagBase()
    const res = runPrepared(p)
    const ticks = res.completion.coverage.completedTicks
    const oob = stateAt(p, ticks + 1)
    expect(oob).toMatchObject({ ok: false, error: { code: 'outOfRange', completedTicks: ticks } })

    const evOob = eventsBySeq(res, 0, res.log.length + 1)
    expect(evOob).toEqual({ ok: false, error: { code: 'eventOutOfRange', loggedEventEndExclusive: res.log.length } })

    // 初始化阶段抛错：没有任何合法边界状态
    const ThrowOnInit: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', endFrame: 10 })],
      hooks: {
        onResolve() {
          throw new Error('init 时 onResolve 抛错')
        },
      },
    }
    const pBad = prep([ThrowOnInit, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const s0 = stateAt(pBad, 0)
    expect(s0.ok).toBe(false)
    if (!s0.ok) expect(s0.error.code).toBe('noLegalState')
  })

  test('C07-7：多次调 explainAct / explainSwitch / explainFiring，重放状态与日志文件完全不变', () => {
    const 甲: SynthChar = {
      name: '甲',
      vars: { count: 2, flag: true },
      actions: [
        action({ id: 'E', kind: 'skill', endFrame: 20, cooldown: 60 }),
      ],
      buffs: [buff({ id: '甲.攻击', duration: 60, icd: 60, trigger: { on: 'actionStart', where: { actions: ['E'] } } })],
    }
    const 乙: SynthChar = {
      name: '乙',
      actions: [action({ id: 'QTE', kind: 'intro', endFrame: 20 })],
    }
    const p = prep([甲, 乙, idle('丙')], { rotation: ['甲 E', 'wait 5', 'switch 乙 变奏'], initial: { concerto: [100, 0, 0] } })
    const rep = replayTo(p, { kind: 'boundary', frame: 3 })
    expect(rep.kind).toBe('prefix')
    if (rep.kind !== 'prefix') return
    const { state, sim } = rep
    const snap = structuredClone({
      lastTrigger: state.lastTrigger,
      assumed: state.assumed,
      queue: state.queue,
      rng: state.rng,
      vars: state.chars.map(c => c.vars),
      nextId: state.nextId,
      logLen: state.log.length,
    })

    const proj = freezeStateProjection(state)
    const env = probeEnvOf(p.resolved, p.effective.sample)
    const ro0 = readonlyContext(env, proj, 0, true)
    const ro1 = readonlyContext(env, proj, 1, true)
    for (let i = 0; i < 3; i++) {
      explainAct(state, sim.k, env, 0, p.resolved.team[0]!.actions['E']!, { force: false, delay: 0, input: true, ro: ro0 })
      explainSwitch(state, sim.k, env, { kind: 'switch', line: 3, item: 1, to: 1, expectIntro: true }, { expectIntro: true, nextAction: null, roTo: ro1 })
      explainFiring(state, p.resolved.buffs[0]!.def.trigger, 0, '甲.攻击', 60, [{ on: 'actionStart', by: 0, action: 'E', kind: 'skill' }])
    }

    expect({
      lastTrigger: state.lastTrigger,
      assumed: state.assumed,
      queue: state.queue,
      rng: state.rng,
      vars: state.chars.map(c => c.vars),
      nextId: state.nextId,
      logLen: state.log.length,
    }).toEqual(snap)
  })

  test('C07-8：canStart 里调用 ctx.addBuff 返回 unmodeled 且不产生 buff', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', endFrame: 10 }), action({ id: 'Bad', endFrame: 10 })],
      buffs: [buff({ id: '甲.非法加buff', trigger: 'hook', duration: 60 })],
      hooks: {
        canStart(ctx, actionId) {
          if (actionId === 'Bad') {
            (ctx as unknown as { addBuff: (id: string) => void }).addBuff('甲.非法加buff')
          }
          return true
        },
      },
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['wait 10'] })
    const probe = openProbe(p, { kind: 'boundary', frame: 5 })
    expect(probe.ok).toBe(true)
    if (!probe.ok) return
    const beforeBuffs = probe.value.replay.state.buffs.length
    const chk = rawActionCheck(p, 5, 0, 'Bad')
    expect(chk.ok).toBe(true)
    if (!chk.ok) return
    const hookCond = chk.value.conditions.find(c => c.id === 'hook.canStart')
    expect(hookCond?.status).toBe('unmodeled')
    expect(hookCond?.actual).toContain('不支持只读求值')
    expect(probe.value.replay.state.buffs.length).toBe(beforeBuffs)
  })

  test('C07-9：三条合成轴逐次求值检查点与 commandVerdicts 逐条一致', () => {
    const 甲: SynthChar = {
      name: '甲',
      core: [{ slot: 1, name: '豆', cap: 10 }],
      energyCost: 40,
      actions: [
        action({
          id: 'A', kind: 'normal', endFrame: 40, switchLockUntil: 15,
          priority: [{ fromFrame: 0, value: 2 }],
          cancelWindows: [{ from: 20, until: 40, row: 1 }],
          judgments: [judgment({ name: 'a', spawnFrame: 10, gains: { energy: 10, concerto: 40, core: [0, 0, 0] } })],
        }),
        action({ id: 'E', kind: 'skill', endFrame: 20, cooldown: 50, priority: [{ fromFrame: 0, value: 3 }] }),
        action({ id: 'R', kind: 'liberation', endFrame: 20, energyCost: 40, priority: [{ fromFrame: 0, value: 4 }] }),
        action({ id: '延奏', kind: 'outro', endFrame: 20 }),
      ],
    }
    const 乙: SynthChar = {
      name: '乙',
      actions: [
        action({ id: 'QTE', kind: 'intro', endFrame: 20, outroTriggerFrame: 5 }),
        action({ id: 'Z', kind: 'skill', endFrame: 20 }),
      ],
    }

    // 合成轴 1：! 与 +N 与等冷却
    assertVerdictsMatchProbe(prep([甲, 乙, idle('丙')], {
      rotation: ['甲 E', '甲 A', '甲 E!', '甲 E +10'],
    }))
    // 合成轴 2：等资源 + 操作延迟 6
    assertVerdictsMatchProbe(prep([甲, 乙, idle('丙')], {
      rotation: ['甲 A', '甲 R'],
      initial: { energy: [30, 0, 0] },
      options: { inputDelay: 6 },
    }))
    // 合成轴 3：切人锁 + 变奏等出手
    assertVerdictsMatchProbe(prep([甲, 乙, idle('丙')], {
      rotation: ['甲 A', 'switch 乙 变奏', '乙 Z'],
      initial: { concerto: [60, 0, 0] },
    }))
  })

  dataDescribe('C07-9：真实轴代表场景检查点一致', () => {
    let gd: GameData
    beforeAll(async () => { gd = await loadGameData() })
    test('m0-video-eq-不打谐破.yaml', () => {
      const sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-video-eq-不打谐破.yaml', import.meta.url), 'utf8')))
      const p = prepareRun(sc, gd)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      assertVerdictsMatchProbe(p.run)
    }, 30_000)
  })

  test('C07-10：第二条等冷却的 commandCheck（outcome / waits / checkedEvaluation / speculative）', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({
        id: 'E', kind: 'skill', endFrame: 20, cooldown: 60,
        cancelWindows: [{ from: 0, until: 20, row: 1 }],
        judgments: [judgment({ name: 'e', spawnFrame: 15 })],
      })],
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 E', '甲 E'] })
    const res = runPrepared(p, { diag: { commandVerdicts: true } })
    const evals2 = (res.diag?.commandVerdicts ?? []).filter(v => v.kind === 'evaluate' && v.cmd.line === 2)
    expect(evals2.length).toBeGreaterThanOrEqual(2)

    const chk = commandCheck(p, { loop: 1, line: 2, item: 1 }, { evaluationIndex: evals2[0]!.evaluationIndex })
    expect(chk.ok).toBe(true)
    if (!chk.ok) return
    expect(chk.value.outcome).toBe('executed')
    expect(chk.value.firstAtHeadFrame).not.toBeNull()
    expect(chk.value.executedAtFrame).not.toBeNull()
    expect(chk.value.firstAtHeadFrame!).toBeLessThan(chk.value.executedAtFrame!)
    expect(chk.value.waits.some(w => w.code === 'cooldown')).toBe(true)
    expect(chk.value.firstBlocking).toBe('cooldown')
    const settled = chk.value.conditions.find(c => c.id === 'settled')
    expect(settled?.speculative).toBe(true)
  })

  test('C07-11：! 强制取消与 +10 延迟的 commandCheck 差异', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [
        action({ id: 'A', kind: 'normal', endFrame: 30, judgments: [judgment({ name: 'a', spawnFrame: 20 })] }),
        action({ id: 'B', kind: 'skill', endFrame: 15, priority: [{ fromFrame: 0, value: 4 }] }),
      ],
    }
    const pNormal = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', '甲 B'] })
    const pForce = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', '甲 B!'] })
    const pDelay = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', '甲 B +10'] })

    const cNorm = commandCheck(pNormal, { loop: 1, line: 2, item: 1 })
    const cForce = commandCheck(pForce, { loop: 1, line: 2, item: 1 })
    const cDelay = commandCheck(pDelay, { loop: 1, line: 2, item: 1 })
    expect(cNorm.ok && cForce.ok && cDelay.ok).toBe(true)
    if (!cNorm.ok || !cForce.ok || !cDelay.ok) return

    expect(cNorm.value.context?.force).toBe(false)
    expect(cForce.value.context?.force).toBe(true)
    expect(cForce.value.conditions.find(c => c.id === 'settled')?.status).toBe('notApplicable')
    expect(cDelay.value.context?.delay).toBe(10)
    const forceLogF = runPrepared(pForce).log.find(e => e.type === 'actionStart' && e.action === 'B')!.f
    const normLogF = runPrepared(pNormal).log.find(e => e.type === 'actionStart' && e.action === 'B')!.f
    const delayLogF = runPrepared(pDelay).log.find(e => e.type === 'actionStart' && e.action === 'B')!.f
    expect(cForce.value.executedAtFrame).toBe(forceLogF)
    expect(cNorm.value.executedAtFrame).toBe(normLogF)
    expect(cDelay.value.executedAtFrame).toBe(delayLogF)
    expect(forceLogF).toBeLessThan(normLogF)
    expect(delayLogF).toBe(normLogF + 10)
  })

  test('C07-12：? 跳过、axisFailed 后面的 notReached、failedHere 与越属 evaluationIndex 报错', () => {
    const 甲: SynthChar = {
      name: '甲',
      energyCost: 100,
      actions: [
        action({ id: 'R', kind: 'liberation', endFrame: 20, energyCost: 100 }),
        action({ id: 'A', kind: 'normal', endFrame: 10 }),
      ],
    }
    const pSkip = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 R?', '甲 A'], initial: { energy: [0, 0, 0] } })
    const chkSkip = commandCheck(pSkip, { loop: 1, line: 1, item: 1 })
    expect(chkSkip.ok).toBe(true)
    if (chkSkip.ok) {
      expect(chkSkip.value.outcome).toBe('skipped')
      expect(chkSkip.value.skip?.code).toBe('resource')
    }

    const pFail = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 R', '甲 A'], initial: { energy: [0, 0, 0] }, options: { maxWait: 10 } })
    const chkFail = commandCheck(pFail, { loop: 1, line: 1, item: 1 })
    const chkAfter = commandCheck(pFail, { loop: 1, line: 2, item: 1 })
    expect(chkFail.ok && chkAfter.ok).toBe(true)
    if (chkFail.ok && chkAfter.ok) {
      expect(chkFail.value.outcome).toBe('failedHere')
      expect(chkAfter.value.outcome).toBe('notReached')
      expect(chkAfter.value.notReachedBecause?.status).toBe('axisFailed')
    }

    // evaluationIndex 指向另一条指令
    const rSkip = runPrepared(pSkip, { diag: { commandVerdicts: true } })
    const evalLine1 = (rSkip.diag?.commandVerdicts ?? []).find(v => v.kind === 'evaluate' && v.cmd.line === 1)!
    const wrongEval = commandCheck(pSkip, { loop: 1, line: 2, item: 1 }, { evaluationIndex: evalLine1.evaluationIndex })
    expect(wrongEval.ok).toBe(false)
    if (!wrongEval.ok) expect(wrongEval.error.code).toBe('unsupported')
  })

  test('C07-13：内置冷却 60 帧的 buff，隔 30 帧第二次触发被 icd 挡住', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', kind: 'skill', endFrame: 10 })],
      buffs: [buff({ id: '甲.短CD', duration: 20, icd: 60, trigger: { on: 'actionStart', where: { actions: ['X'] } } })],
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X', 'wait 30', '甲 X'] })
    const res = runPrepared(p)
    const starts = res.log.map((e, i) => ({ e, i })).filter(x => x.e.type === 'actionStart')
    expect(starts.map(x => x.e.f)).toEqual([0, 30])
    expect(res.log.filter(e => e.type === 'buffApply').map(e => e.f)).toEqual([0])

    const why = whyDidEventNotTrigger(p, { runId: p.runId, eventSeq: starts[1]!.i }, { kind: 'buff', owner: 0, id: '甲.短CD' })
    expect(why.ok).toBe(true)
    if (!why.ok) return
    expect(why.value.outcome).toBe('checkedNotFired')
    const conds = why.value.groups[0]!.conditions
    const icdCond = conds.find(c => c.id === 'icd')
    expect(icdCond?.status).toBe('unmet')
    expect(icdCond?.actual).toContain('还剩 30')
    for (const c of conds) {
      if (c.id !== 'icd') expect(c.status).toBe('met')
    }
  })

  test('C07-14：同一事件上先消耗掉 ownerHas buff，后续触发看到的是消耗后状态', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [
        action({ id: 'P', kind: 'skill', endFrame: 10 }),
        action({ id: 'X', kind: 'skill', endFrame: 10 }),
      ],
      buffs: [
        buff({
          id: '甲.燃料', duration: 600,
          trigger: { on: 'actionStart', where: { actions: ['P'] } },
          consume: { on: 'actionStart', where: { actions: ['X'] }, stacks: 'all' },
        }),
        buff({
          id: '甲.依赖燃料', duration: 600,
          trigger: { on: 'actionStart', where: { actions: ['X'], ownerHas: '甲.燃料' } },
        }),
      ],
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 P', '甲 X'] })
    const res = runPrepared(p)
    const xStartSeq = res.log.findIndex(e => e.type === 'actionStart' && e.action === 'X')
    expect(res.log.some(e => e.type === 'buffApply' && e.buff === '甲.依赖燃料')).toBe(false)

    const why = whyDidEventNotTrigger(p, { runId: p.runId, eventSeq: xStartSeq }, { kind: 'buff', owner: 0, id: '甲.依赖燃料' })
    expect(why.ok).toBe(true)
    if (!why.ok) return
    expect(why.value.outcome).toBe('checkedNotFired')
    expect(why.value.groups[0]!.conditions.find(c => c.id === 'where.ownerHas')?.status).toBe('unmet')
  })

  test('C07-15：charHook 目标返回 unsupported；假想事件返回 hypothetical 且不改 lastTrigger', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', kind: 'skill', endFrame: 10 })],
      buffs: [buff({ id: '甲.攻击', duration: 60, icd: 60, trigger: { on: 'actionStart', where: { actions: ['X'] } } })],
      hooks: { onEvent() {} },
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const res = runPrepared(p)
    const xSeq = res.log.findIndex(e => e.type === 'actionStart')
    const whyHook = whyDidEventNotTrigger(p, { runId: p.runId, eventSeq: xSeq }, { kind: 'charHook', owner: 0, id: '甲' })
    expect(whyHook.ok).toBe(true)
    if (whyHook.ok) expect(whyHook.value.outcome).toBe('unsupported')

    // 假想在 f=5 再放一次 actionStart（此时仍在 60 帧 icd 内，检查会查看 lastTrigger 但不应修改 state.lastTrigger）
    const repBefore = replayTo(p, { kind: 'boundary', frame: 5 })
    expect(repBefore.kind).toBe('prefix')
    const would = wouldHypotheticalEventTrigger(
      p, 5,
      { type: 'actionStart', char: '甲', action: 'X', instance: 99 },
      { kind: 'buff', owner: 0, id: '甲.攻击' },
    )
    expect(would.ok).toBe(true)
    if (!would.ok) return
    expect(would.value.hypothetical).toBe(true)
    expect(would.value.outcome).toBe('wouldNotFire')

    // 紧接着同一帧再试算把 icd 改成另一个刚触发过的独立 buff（无 side effects）或核对 S[5] lastTrigger 原样
    const repAfter = replayTo(p, { kind: 'boundary', frame: 5 })
    if (repBefore.kind === 'prefix' && repAfter.kind === 'prefix') {
      expect(repAfter.state.lastTrigger).toEqual(repBefore.state.lastTrigger)
    }
  })

  describe('C07-16：hitInputs 六例重算公式与日志 output 逐位一致', () => {
    const verifyDirectHitInputs = (p: PreparedRun, pickSeq?: (res: SimResult) => number) => {
      const res = runPrepared(p, { diag: ALL_DIAG })
      const seq = pickSeq ? pickSeq(res) : res.log.findIndex(e => e.type === 'hit' && e.dmg !== null)
      expect(seq).toBeGreaterThanOrEqual(0)
      const exp = explainEvent(p, { runId: p.runId, eventSeq: seq })
      expect(exp.ok).toBe(true)
      if (!exp.ok) return
      const hi = exp.value.hitInputs
      expect(hi?.path).toBe('direct')
      if (!hi || hi.path !== 'direct') return
      const recomputed = computeHit(hi.ctx, hi.acc, p.identity.execution.rules)
      expect(recomputed.nonCrit).toBe(hi.output.nonCrit)
      expect(recomputed.crit).toBe(hi.output.crit)
      expect(recomputed.expected).toBe(hi.output.expected)
      const hitEv = res.log[seq] as HitEvent
      expect(hi.output.nonCrit).toBe(hitEv.dmg!.nonCrit)
      expect(hi.output.crit).toBe(hitEv.dmg!.crit)
      expect(hi.output.expected).toBe(hitEv.dmg!.expected)
      return hi
    }

    test('1) 同名 buff 由甲与乙各自提供，buffs 含两条不同 owner 与 instanceId', () => {
      const 甲: SynthChar = {
        name: '甲',
        actions: [action({ id: 'X', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })],
        buffs: [buff({ id: '共鸣增幅', zone: 'atkPct', value: 0.25, target: 'team', trigger: { on: 'actionStart', where: { actions: ['X'] } } })],
      }
      const 乙: SynthChar = {
        name: '乙',
        actions: [action({ id: 'Y', kind: 'skill', endFrame: 20 })],
        buffs: [buff({ id: '共鸣增幅', zone: 'atkPct', value: 0.15, target: 'team', trigger: { on: 'actionStart', where: { actions: ['Y'] } } })],
      }
      const p = prep([甲, 乙, idle('丙')], { rotation: ['甲 X', 'switch 乙', '乙 Y', 'switch 甲', '甲 X'] })
      const hi = verifyDirectHitInputs(p, res => {
        const hits = res.log.map((e, i) => ({ e, i })).filter(x => x.e.type === 'hit')
        return hits[1]!.i
      })
      if (!hi) return
      expect(hi.buffs).toHaveLength(2)
      expect(hi.buffs[0]!.defId).toBe('共鸣增幅')
      expect(hi.buffs[1]!.defId).toBe('共鸣增幅')
      expect(hi.buffs[0]!.owner).not.toBe(hi.buffs[1]!.owner)
      expect(hi.buffs[0]!.instanceId).not.toBe(hi.buffs[1]!.instanceId)
    })

    test('2) 只有钩子 modifyHit 直接补的乘区', () => {
      const 甲: SynthChar = {
        name: '甲',
        actions: [action({ id: 'X', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })],
        hooks: {
          modifyHit(_ctx, draft) {
            draft.zones.DamageAmplify0 = (draft.zones.DamageAmplify0 ?? 0) + 0.2
          },
        },
      }
      const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
      const hi = verifyDirectHitInputs(p)
      expect(hi?.buffs).toEqual([])
      expect(hi?.acc.zones.DamageAmplify0 ?? 0).toBe(0.2)
    })

    test('3) 只有暴击专属加成（critOnly）', () => {
      const 甲: SynthChar = {
        name: '甲',
        actions: [action({ id: 'X', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })],
        buffs: [buff({ id: '甲.暴伤专精', zone: 'DamageChange', value: 0.4, filter: { critOnly: true }, trigger: { on: 'actionStart' } })],
      }
      const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
      const hi = verifyDirectHitInputs(p)
      expect(hi?.acc.critOnly.DamageChange).toBe(0.4)
      expect(hi?.acc.zones.DamageChange).toBe(0)
    })

    test('4) 倍率关联生命（relatedAttr: hp）', () => {
      const 甲: SynthChar = {
        name: '甲',
        actions: [action({ id: 'X', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5, relatedAttr: 'hp' })] })],
      }
      const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
      const hi = verifyDirectHitInputs(p)
      expect(hi?.ctx.attr).toBe('hp')
    })

    test('5) & 6) 谐度破坏与震谐响应走 computeTuneBreak', () => {
      const 甲: SynthChar = {
        name: '甲',
        actions: [
          action({
            id: 'HB', kind: 'skill', endFrame: 20,
            judgments: [judgment({ name: '破', spawnFrame: 5, tags: ['谐度破坏'], multiplier: 3.5, element: '物理' })],
          }),
          action({
            id: 'ZR', kind: 'skill', endFrame: 20,
            judgments: [judgment({ name: '震', spawnFrame: 5, tags: ['震谐响应'], multiplier: 2.2, element: '热熔' })],
          }),
        ],
      }
      const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 HB', '甲 ZR'], enemy: { custom: { level: 90, cost: 3 } } })
      const res = runPrepared(p, { diag: ALL_DIAG })
      const hits = res.log.map((e, i) => ({ e, i })).filter((x): x is { e: HitEvent; i: number } => x.e.type === 'hit')
      expect(hits).toHaveLength(2)

      for (const h of hits) {
        const exp = explainEvent(p, { runId: p.runId, eventSeq: h.i })
        expect(exp.ok).toBe(true)
        if (!exp.ok) continue
        const hi = exp.value.hitInputs
        expect(hi?.path).toBe('tuneBreak')
        if (!hi || hi.path !== 'tuneBreak') continue
        const acc = emptyAccumulator()
        acc.zones = { ...hi.acc.zones }
        acc.critOnly = { ...hi.acc.critOnly }
        const v = computeTuneBreak(hi.ctx, acc, p.identity.execution.rules)
        expect(v).toBe(hi.output.nonCrit)
        expect(v).toBe(hi.output.crit)
        expect(v).toBe(hi.output.expected)
        expect(v).toBe(h.e.dmg!.expected)
      }
    })
  })

  test('C07-17：onEvent 生成判定命中后给资源，directCauses 与 businessRoot 链路准确', () => {
    const p = diagBase()
    const res = runPrepared(p)
    // diagBase: 甲 X -> a 命中 -> 钩子生成 c -> c 命中; 或者甲.一到期给资源 -> 查看生成判定 c 命中给能源/协奏的夹具
    // 这里专门造一个 c 命中后在 onEvent 给 core1 资源的夹具以匹配 C07-17 全断言
    const 甲: SynthChar = {
      name: '甲',
      core: [{ slot: 1, name: '豆', cap: 10 }],
      actions: [
        action({
          id: 'X', kind: 'skill', endFrame: 30, judgments: [
            judgment({ name: 'a', spawnFrame: 5 }),
            judgment({ name: 'c', spawnFrame: null }),
          ],
        }),
      ],
      hooks: {
        onEvent(ctx, ev) {
          if (ev.type === 'hit' && ev.char === '甲' && ev.judgment === 'a') {
            ctx.spawnJudgment('c', { note: '连锁判定' })
          } else if (ev.type === 'hit' && ev.char === '甲' && ev.judgment === 'c') {
            ctx.addResource('core1', 2, ctx.self, 'c 命中')
          }
        },
      },
    }
    const pChain = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const resChain = runPrepared(pChain)
    const cResSeq = resChain.log.findIndex(e => e.type === 'resource' && e.note === 'c 命中')
    expect(cResSeq).toBeGreaterThan(0)

    const exp = explainEvent(pChain, { runId: pChain.runId, eventSeq: cResSeq })
    expect(exp.ok).toBe(true)
    if (!exp.ok) return
    const causeSeqs = exp.value.directCauses.map(c => c.seq)
    const causeTypes = causeSeqs.map(i => resChain.log[i]!.type)
    // c 命中 -> judgmentSpawn(c) -> a 命中 -> judgmentSpawn(a) -> actionStart(X)
    expect(causeTypes).toEqual(['hit', 'judgmentSpawn', 'hit', 'judgmentSpawn', 'actionStart'])
    expect(exp.value.directCauses.at(-1)!.meta.origin.kind).toBe('command')

    // 同时检查 c 命中的 hit 本身的 resourceEntries 与 businessRoot（在 diagBase 上 c 没有 gains，但这里 c 自身直接给资源时可同时核对 resourceEntries；
    // 而把 a 的 parent 与 entity 分开时 businessRoot != 父链顶端：让 乙 用 X 的判定由甲触发，或在 diagBase 上 a 命中生成 c）
    const cHitSeq = causeSeqs[0]!
    const expHit = explainEvent(pChain, { runId: pChain.runId, eventSeq: cHitSeq })
    expect(expHit.ok).toBe(true)
    if (expHit.ok) {
      // c 由 onEvent(hit(a)) 生成，事件链业务根是 hit(a)（causeSeqs[2]），与父链顶端 actionStart(X)（causeSeqs.at(-1)）不同
      expect(expHit.value.businessRoot?.seq).toBe(causeSeqs[2])
      expect(expHit.value.businessRoot?.seq).not.toBe(causeSeqs.at(-1))
      expect(res.log.length).toBeGreaterThan(0)
    }

    // 另一例验证 businessRoot 与父链顶端不同：actionStart(L) 在 actionEnd/尾部的延奏里生成：
    // diagBase 中 乙 QTE (from switch) 触发 outro(甲) -> o 命中：parent 为 QTE 的 intro/outro -> switch，entity/businessRoot 指向延奏 actionStart 自身
    const pOutro = diagBase()
    const resOutro = runPrepared(pOutro)
    const oHitSeq = resOutro.log.findIndex(e => e.type === 'hit' && e.judgment === 'o')
    expect(oHitSeq).toBeGreaterThan(0)
    const expO = explainEvent(pOutro, { runId: pOutro.runId, eventSeq: oHitSeq })
    expect(expO.ok).toBe(true)
    if (expO.ok) {
      const topSeq = expO.value.directCauses.at(-1)!.seq
      // o 命中的 directParent 是 outro(switch...)，entity/businessRoot 是 延奏 的 actionStart 或另一个起点
      expect(expO.value.businessRoot).toBeDefined()
      expect(topSeq).not.toBe(expO.value.businessRoot!.seq)
    }

    // 直接判定给资源时 hit 的 resourceEntries 为这一下的账本条目
    const pGain = prep([{
      name: '甲',
      core: [{ slot: 1, name: '豆', cap: 10 }],
      actions: [action({ id: 'G', kind: 'skill', endFrame: 15, judgments: [judgment({ name: 'g', spawnFrame: 5, gains: { energy: 5, concerto: 10, core: [1, 0, 0] } })] })],
    }, idle('乙'), idle('丙')], { rotation: ['甲 G'] })
    const rGain = runPrepared(pGain)
    const gSeq = rGain.log.findIndex(e => e.type === 'hit' && e.judgment === 'g')
    const expGain = explainEvent(pGain, { runId: pGain.runId, eventSeq: gSeq })
    expect(expGain.ok).toBe(true)
    if (expGain.ok) expect(expGain.value.resourceEntries.length).toBeGreaterThanOrEqual(2)
  })

  test('C07-18：异常效应定时结算 hit 省略 hitInputs，信封 unsupported 标明，origin 为 timer(effectTick)', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'E', kind: 'skill', endFrame: 10 })],
      hooks: {
        onEvent(ctx, ev) {
          if (ev.type === 'actionStart' && ev.char === '甲') ctx.applyEffect('风蚀效应', 1)
        },
      },
    }
    const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 E', 'wait 200'], options: { maxFrames: 250 } })
    const gdBase = synthData([甲, idle('乙'), idle('丙')])
    gdBase.effects['风蚀效应'] = { name: '风蚀效应', element: '气动', source: 't', maxStacks: 3, burstMax: 0, duration: 600, tickInterval: 180, decay: 0, settleAtMax: null, multipliers: [1, 2, 3] }
    gdBase.abnormalBaseByLevel = Array.from({ length: 90 }, () => 1000)
    const pEff = prepareRun(ScenarioSchema.parse({
      team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
      enemy: { custom: { level: 90 } },
      rotation: ['甲 E', 'wait 200'],
      options: { maxFrames: 250 },
    }), gdBase)
    if (!pEff.ok) throw new Error('prepare failed')
    const res = runPrepared(pEff.run)
    const effHitSeq = res.log.findIndex(e => e.type === 'hit' && e.effect === '风蚀效应')
    expect(effHitSeq).toBeGreaterThanOrEqual(0)

    const exp = explainEvent(pEff.run, { runId: pEff.run.runId, eventSeq: effHitSeq })
    expect(exp.ok).toBe(true)
    if (!exp.ok) return
    expect(exp.value.hitInputs).toBeUndefined()
    expect(exp.value.origin).toMatchObject({ kind: 'timer', timerKind: 'effectTick', defId: '风蚀效应' })
    const env = envelope(pEff.run, res, exp.value, ['explainEvent'], ['explainEvent.hitInputs: 异常效应伤害'])
    const wired = toWire(env) as { capability: { unsupported: string[] } }
    expect(wired.capability.unsupported).toContain('explainEvent.hitInputs: 异常效应伤害')
    expect(p.runId).not.toBe('')
  })

  test('C07-19：buffWindowMargin 精准报告命中前 18 帧到期、切人前 5 帧移除、命中后 10 帧挂上', () => {
    // 命中设在 f=29（由甲放出的可脱手判定 h 在后台第 29 帧结算，dealer='甲'）：
    // - 甲.短效：duration=12（f=0 挂，第 11 帧 P6 到期 -> ago = 29 - 11 = 18，timeout）
    // - 甲.切走清：onSwitchOut='clear'，target='self'（第 24 帧 switch 乙 时移除 -> ago = 29 - 24 = 5，switchOut）
    // - 乙.晚到：乙在 f=39 放 Y 挂上（target='team' -> 覆盖甲，later = 39 - 29 = 10，appliedLater）
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', kind: 'skill', endFrame: 24, judgments: [judgment({ name: 'h', spawnFrame: 29, persistsOnCancel: true })] })],
      buffs: [
        buff({ id: '甲.短效', zone: 'atkPct', target: 'self', duration: 12, trigger: { on: 'actionStart', where: { actions: ['X'] } } }),
        buff({ id: '甲.切走清', zone: 'atkPct', target: 'self', duration: 'inf', onSwitchOut: 'clear', trigger: { on: 'actionStart', where: { actions: ['X'] } } }),
      ],
    }
    const 乙: SynthChar = {
      name: '乙',
      actions: [action({ id: 'Y', kind: 'skill', endFrame: 10 })],
      buffs: [buff({ id: '乙.晚到', zone: 'atkPct', target: 'team', duration: 60, trigger: { on: 'actionStart', where: { actions: ['Y'] } } })],
    }
    const p = prep([甲, 乙, idle('丙')], { rotation: ['甲 X', 'wait 24', 'switch 乙', 'wait 15', '乙 Y'] })
    const res = runPrepared(p)
    const hSeq = res.log.findIndex(e => e.type === 'hit' && e.judgment === 'h')
    expect(hSeq).toBeGreaterThan(0)
    expect(res.log[hSeq]!.f).toBe(29)

    const exp = explainEvent(p, { runId: p.runId, eventSeq: hSeq })
    expect(exp.ok).toBe(true)
    if (!exp.ok) return
    const margins = exp.value.windowMargins ?? []
    const m1 = margins.find(m => m.defId === '甲.短效')
    const m2 = margins.find(m => m.defId === '甲.切走清')
    const m3 = margins.find(m => m.defId === '乙.晚到')
    expect(m1).toMatchObject({ state: 'left', leftBattleFramesAgo: 18, exitReason: 'timeout', note: 'hint_only' })
    expect(m2).toMatchObject({ state: 'left', leftBattleFramesAgo: 5, exitReason: 'switchOut', note: 'hint_only' })
    expect(m3).toMatchObject({ state: 'appliedLater', appliedBattleFramesLater: 10, note: 'hint_only' })
  })

  test('C07-20：diffRuns 同轴翻开关与截断不可比说明', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'A', kind: 'normal', endFrame: 30, judgments: [judgment({ name: 'a', spawnFrame: 15 })] })],
    }
    const pA = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'], options: { repeat: 2, maxFrames: 600 } })
    const pB = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'], options: { repeat: 2, maxFrames: 600 } }, { rules: { defFloor: true } })
    const pTrunc = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'], options: { repeat: 2, maxFrames: 40 } })

    const rA = runPrepared(pA)
    const rB = runPrepared(pB)
    const rT = runPrepared(pTrunc)

    const dOk = diffRuns({ p: pA, res: rA }, { p: pB, res: rB }, { kind: 'metrics' })
    expect(dOk.ok).toBe(true)
    if (dOk.ok) {
      expect(dOk.value.metrics.comparable).toBe(true)
      expect(dOk.value.metrics.steadyLoopBattleFrames).toEqual([[30], [30]])
    }

    const dBad = diffRuns({ p: pA, res: rA }, { p: pTrunc, res: rT }, { kind: 'metrics' })
    expect(dBad.ok).toBe(true)
    if (dBad.ok) {
      expect(dBad.value.metrics.comparable).toBe(false)
      expect(dBad.value.metrics.notComparableReason).toBeTruthy()
    }
  })

  test('C07-21：diffRuns 晚 6 帧指令对应与删行后无映射 ambiguous vs 给 mapping matched', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'A', kind: 'normal', endFrame: 20, judgments: [judgment({ name: 'a', spawnFrame: 5 })] })],
    }
    const pA = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', '甲 A'] })
    const pDelay = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', '甲 A'] }, { options: { inputDelay: 6 } })
    const pDel = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'] })

    const rA = runPrepared(pA)
    const rDelay = runPrepared(pDelay)
    const rDel = runPrepared(pDel)

    const dDelay = diffRuns({ p: pA, res: rA }, { p: pDelay, res: rDelay }, { kind: 'commands' })
    expect(dDelay.ok).toBe(true)
    if (dDelay.ok) {
      expect(dDelay.value.correspondences[0]).toMatchObject({ status: 'matched', delta: { worldFrames: 6 } })
      expect(dDelay.value.firstDivergence?.baseEvent?.eventSeq).toBe(dDelay.value.correspondences[0]!.base?.eventSeq)
    }

    const dAmb = diffRuns({ p: pA, res: rA }, { p: pDel, res: rDel }, { kind: 'commands' })
    expect(dAmb.ok).toBe(true)
    if (dAmb.ok) {
      expect(dAmb.value.correspondences.every(c => c.status === 'ambiguous')).toBe(true)
    }

    const dMap = diffRuns(
      { p: pA, res: rA },
      { p: pDel, res: rDel },
      { kind: 'commands' },
      { commandMapping: [[{ loop: 1, line: 2, item: 1 }, { loop: 1, line: 1, item: 1 }]] },
    )
    expect(dMap.ok).toBe(true)
    if (dMap.ok) {
      const m = dMap.value.correspondences.find(c => c.status === 'matched')
      expect(m).toBeDefined()
    }
  })

  test('C07-24：runIdMismatch（explainEvent、whyDidEventNotTrigger、diffRuns）', () => {
    const p1 = diagBase()
    const p2 = prep([idle('甲'), idle('乙'), idle('丙')], { rotation: ['wait 10'] })
    const r2 = runPrepared(p2)

    expect(explainEvent(p1, { runId: p2.runId, eventSeq: 0 })).toMatchObject({
      ok: false, error: { code: 'runIdMismatch', expected: p1.runId, got: p2.runId },
    })
    expect(whyDidEventNotTrigger(p1, { runId: p2.runId, eventSeq: 0 }, { kind: 'buff', owner: 0, id: '甲.一' })).toMatchObject({
      ok: false, error: { code: 'runIdMismatch', expected: p1.runId, got: p2.runId },
    })
    expect(diffRuns({ p: p1, res: runPrepared(p1) }, { p: p1, res: r2 }, { kind: 'metrics' })).toMatchObject({
      ok: false, error: { code: 'runIdMismatch', expected: p1.runId, got: p2.runId },
    })
  })

  test('C07-25：DF-10 四种边界态（f=0、截断指令未发完、截断已发完、自然结束、失败收尾改资源）', () => {
    const 甲: SynthChar = {
      name: '甲',
      core: [{ slot: 1, name: '豆', cap: 10 }],
      actions: [
        action({ id: 'L', kind: 'skill', endFrame: 120, judgments: [judgment({ name: 'l', spawnFrame: 110 })] }),
        action({ id: 'E', kind: 'skill', endFrame: 20, cooldown: 300 }),
        action({ id: 'X', kind: 'skill', endFrame: 10 }),
      ],
      hooks: {
        onEvent(ctx, ev) {
          if (ev.type === 'warning' && ev.code === 'maxFrames') {
            ctx.addResource('core1', 1)
          }
        },
      },
    }
    // 1. f=0 边界（prefix 不含完成状态）
    const p0 = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const s0 = stateAt(p0, 0)
    expect(s0.ok).toBe(true)
    if (s0.ok) {
      expect(s0.value.frame).toBe(0)
      expect((s0.value as unknown as Record<string, unknown>).completion).toBeUndefined()
    }
    // 2. 截断但指令已发完（maxFramesWarning + postDrain 会改资源）：S[maxFrames] 尚未发警告未加资源，terminalState 为 afterPostDrain 且 core[0]=1
    const pDispatched = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 L'], options: { maxFrames: 50 } })
    const sDispatched = stateAt(pDispatched, 50)
    const tDispatched = terminalState(pDispatched)
    expect(sDispatched.ok && tDispatched.ok).toBe(true)
    if (sDispatched.ok && tDispatched.ok) {
      expect(tDispatched.value.kind).toBe('afterPostDrain')
      expect(sDispatched.value.view.chars[0]!.core[0]).toBe(0)
      expect(tDispatched.value.view.chars[0]!.core[0]).toBe(1)
      expect(sDispatched.value.prefix).not.toEqual(tDispatched.value.prefix)
    }
    // 3. 截断且指令未发完（failClose）：S[maxFrames] 有等待段且无 failClose wait，terminalState 为 afterFailClose 且 queue.seg 为空、ProbeStop 不变 engineError
    const pPending = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 E', '甲 E'], options: { maxFrames: 60 } })
    const resPending = runPrepared(pPending)
    expect(resPending.completion.status).toBe('truncated')
    const sPending = stateAt(pPending, 60)
    const tPending = terminalState(pPending)
    expect(sPending.ok && tPending.ok).toBe(true)
    if (sPending.ok && tPending.ok) {
      expect(tPending.value.kind).toBe('afterFailClose')
      expect(sPending.value.view.queue.seg).not.toBeNull()
      expect(tPending.value.view.queue.seg).toBeNull()
      expect(tPending.value.prefix.handledEndExclusive).toBe(tPending.value.prefix.eventEndExclusive - 1)
      expect(sPending.value.prefix).not.toEqual(tPending.value.prefix)
    }
    // 4. replayTo 直接返回 ReplayPrefix，没有完成状态
    const rPref = replayTo(p0, { kind: 'boundary', frame: 0 })
    expect(rPref.kind).toBe('prefix')
    expect('result' in rPref).toBe(false)
  })

  test('C07-26：DF-13 违规 canStart 写冻结状态（直接字段、嵌套 vars、buffs.push）均判 unmodeled 且保留原错误、不污染后续条件', () => {
    const mk = (mode: 'energy' | 'vars' | 'push'): PreparedRun => {
      const 甲: SynthChar = {
        name: '甲',
        vars: { nested: 1 },
        actions: [action({ id: 'Bad', endFrame: 10 })],
        hooks: {
          canStart(ctx) {
            const st = ctx.state as unknown as {
              chars: { energy: number; vars: { nested: number } }[]
              buffs: unknown[]
            }
            if (mode === 'energy') st.chars[0]!.energy = 999
            else if (mode === 'vars') st.chars[0]!.vars.nested = 999
            else st.buffs.push({ fake: true })
            return true
          },
        },
      }
      return prep([甲, idle('乙'), idle('丙')], { rotation: ['wait 10'] })
    }

    for (const mode of ['energy', 'vars', 'push'] as const) {
      const p = mk(mode)
      const probe = openProbe(p, { kind: 'boundary', frame: 5 })
      expect(probe.ok).toBe(true)
      if (!probe.ok) continue
      const beforeEnergy = probe.value.replay.state.chars[0]!.energy
      const beforeVars = probe.value.replay.state.chars[0]!.vars.nested
      const beforeBuffLen = probe.value.replay.state.buffs.length

      const chk = rawActionCheck(p, 5, 0, 'Bad')
      expect(chk.ok).toBe(true)
      if (!chk.ok) continue
      const hc = chk.value.conditions.find(c => c.id === 'hook.canStart')
      expect(hc?.status).toBe('unmodeled')
      expect(hc?.actual).toContain('只读求值失败')
      expect(hc?.actual).not.toContain('尝试写状态')
      expect(hc?.actual).toContain('TypeError')
      // 同一次会话 / 后续条件看到未修改的状态
      expect(probe.value.ro[0]!.state.chars[0]!.energy).toBe(beforeEnergy)
      expect(probe.value.ro[0]!.state.chars[0]!.vars.nested).toBe(beforeVars)
      expect(probe.value.ro[0]!.state.buffs.length).toBe(beforeBuffLen)
    }
  })

  test('C07-27：DF-11 同帧插队与原指令求值、首次 +10、抽样延迟与 RNG 不变', () => {
    // 1. 同一帧先自动谐破插队、再对原指令求值
    const 甲: SynthChar = {
      name: '甲',
      actions: [
        action({
          id: 'P', kind: 'skill', endFrame: 10,
          judgments: [judgment({ name: 'p', spawnFrame: 5, gauges: { tunability: 200, toughness: 0 } })],
        }),
        action({
          id: '谐度破坏', kind: 'tuneBreak', endFrame: 10,
          judgments: [judgment({ name: 'tb', spawnFrame: 5, tags: ['谐度破坏'] })],
        }),
        action({ id: 'A', kind: 'normal', endFrame: 10 }),
      ],
    }
    const gdTB = synthData([甲, idle('乙'), idle('丙')])
    gdTB.tuneBreak = {
      variants: [],
      baseByLevel: Array.from({ length: 100 }, () => 10000),
      costFactor: { 1: 1, 3: 1, 4: 1 },
      rules: { lockFrames: { 1: 360, 3: 360, 4: 180 }, buttonFrames: 180 },
    }
    gdTB.characters['甲']!.tunabilityRate = 1
    gdTB.characters['甲']!.actions['谐度破坏-迅刀'] = gdTB.characters['甲']!.actions['谐度破坏']!
    const pTB = prepareRun(ScenarioSchema.parse({
      team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
      enemy: { custom: { level: 90, tunabilityMax: 100 } },
      rotation: ['甲 P', '甲 A'],
      options: { tuneBreak: 'auto' },
    }), gdTB)
    if (!pTB.ok) throw new Error('prepare failed')
    const rTB = runPrepared(pTB.run, { diag: { commandVerdicts: true } })
    const interjects = (rTB.diag?.commandVerdicts ?? []).filter(v => v.kind === 'interject')
    expect(interjects.length).toBeGreaterThanOrEqual(1)
    assertVerdictsMatchProbe(pTB.run)

    // 2. 首次遇到 +10：逐帧求值共 11 次（第 0 帧设 readyAt=0，第 10 帧执行），第 0 次与最后一次均可通过 evaluationIndex 区分
    const pPlus = prep([{ name: '甲', actions: [action({ id: 'A', kind: 'normal', endFrame: 10 })] }, idle('乙'), idle('丙')], { rotation: ['甲 A +10'] })
    const chkPlus = commandCheck(pPlus, { loop: 1, line: 1, item: 1 })
    expect(chkPlus.ok).toBe(true)
    if (chkPlus.ok) {
      expect(chkPlus.value.evaluations.length).toBe(11)
      expect(chkPlus.value.executedAtFrame).toBe(10)
      const firstChk = commandCheck(pPlus, { loop: 1, line: 1, item: 1 }, { evaluationIndex: chkPlus.value.evaluations[0]!.evaluationIndex })
      expect(firstChk.ok && firstChk.value.firstBlocking === 'delay').toBe(true)
      expect(chkPlus.value.firstBlocking).toBeNull()
    }

    // 3. 抽样模式操作延迟 + RNG 查询前后完全不变
    const pSample = prep([{ name: '甲', actions: [action({ id: 'A', kind: 'normal', endFrame: 10 })] }, idle('乙'), idle('丙')], {
      rotation: ['甲 A'],
    }, {
      sample: { seed: 42, hand: { mean: 4, sd: 1 } },
    })
    const resSample = runPrepared(pSample, { diag: ALL_DIAG })
    const execA = (resSample.diag?.commandVerdicts ?? []).find(v => v.kind === 'execute')!
    const chkSample = commandCheck(pSample, { loop: 1, line: 1, item: 1 })
    expect(chkSample.ok).toBe(true)
    if (chkSample.ok) {
      expect(chkSample.value.executedAtFrame).toBe(execA.f)
      expect(chkSample.value.firstBlocking).toBeNull()
    }
    const rAt1 = replayTo(pSample, { kind: 'boundary', frame: 1 })
    const rngBefore = rAt1.kind === 'prefix' ? structuredClone(rAt1.state.rng) : null
    rawActionCheck(pSample, 1, 0, 'A')
    const rAt1After = replayTo(pSample, { kind: 'boundary', frame: 1 })
    if (rAt1After.kind === 'prefix') expect(rAt1After.state.rng).toEqual(rngBefore)
  })

  test('C07-28：DF-11 末条为 wait 0 / wait 30 / at 3 / 静默同步，均返回 executed 及真实 execute 帧', () => {
    const 甲: SynthChar = { name: '甲', actions: [action({ id: 'A', kind: 'normal', endFrame: 10 })] }

    for (const [lastLine, refLine, expectedMinF] of [
      ['wait 0', 2, 0],
      ['wait 30', 2, 30],
      ['at 1', 2, 60],
      ['敌人 失谐', 2, 0],
    ] as const) {
      const p = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', lastLine] })
      const res = runPrepared(p, { diag: { commandVerdicts: true } })
      const execRec = (res.diag?.commandVerdicts ?? []).find(v => v.kind === 'execute' && v.cmd.line === refLine)!
      const chk = commandCheck(p, { loop: 1, line: refLine, item: 1 })
      expect(chk.ok).toBe(true)
      if (!chk.ok) continue
      expect(chk.value.outcome).toBe('executed')
      expect(chk.value.executedAtFrame).toBe(execRec.f)
      expect(chk.value.executedAtFrame).toBe(expectedMinF)
    }
  })

  test('C07-29：DF-12 五种 triggerChecks 细分原因（noOccurrence / noInstance / 消耗后 / earlierHandlerThrew / failCloseUnhandled）', () => {
    // 1. noOccurrence：异常效应自身伤害
    const 甲1: SynthChar = {
      name: '甲',
      actions: [action({ id: 'E', kind: 'skill', endFrame: 10 })],
      buffs: [buff({ id: '甲.增攻', duration: 60, trigger: { on: 'judgmentSettle' } })],
      hooks: { onEvent(ctx, ev) { if (ev.type === 'actionStart' && ev.char === '甲') ctx.applyEffect('风蚀效应', 1) } },
    }
    const gdEff = synthData([甲1, idle('乙'), idle('丙')])
    gdEff.effects['风蚀效应'] = { name: '风蚀效应', element: '气动', source: 't', maxStacks: 3, burstMax: 0, duration: 600, tickInterval: 180, decay: 0, settleAtMax: null, multipliers: [1, 2, 3] }
    gdEff.abnormalBaseByLevel = Array.from({ length: 90 }, () => 1000)
    const p1 = prepareRun(ScenarioSchema.parse({
      team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
      enemy: { custom: { level: 90 } }, rotation: ['甲 E', 'wait 200'], options: { maxFrames: 250 },
    }), gdEff)
    if (!p1.ok) throw new Error('prepare failed')
    const r1 = runPrepared(p1.run)
    const hitEffSeq = r1.log.findIndex(e => e.type === 'hit' && e.effect === '风蚀效应')
    const w1 = whyDidEventNotTrigger(p1.run, { runId: p1.run.runId, eventSeq: hitEffSeq }, { kind: 'buff', owner: 0, id: '甲.增攻' })
    expect(w1.ok && w1.value.outcome === 'notEntered' && w1.value.notEnteredReason === 'noOccurrence').toBe(true)

    // 2. noInstance：没有实例时的 extend 与 consume
    const 甲2: SynthChar = {
      name: '甲',
      actions: [action({ id: 'P', kind: 'skill', endFrame: 10 }), action({ id: 'X', kind: 'skill', endFrame: 10 })],
      buffs: [buff({
        id: '甲.可延长', duration: 60,
        trigger: { on: 'actionStart', where: { actions: ['P'] } },
        extend: { trigger: { on: 'actionStart', where: { actions: ['X'] } }, frames: 20, max: 1 },
        consume: { on: 'actionStart', where: { actions: ['X'] }, stacks: 'all' },
      })],
    }
    const p2 = prep([甲2, idle('乙'), idle('丙')], { rotation: ['甲 X'] })
    const r2 = runPrepared(p2)
    const xSeq2 = r2.log.findIndex(e => e.type === 'actionStart')
    const w2Ext = whyDidEventNotTrigger(p2, { runId: p2.runId, eventSeq: xSeq2 }, { kind: 'buffExtend', owner: 0, id: '甲.可延长' })
    const w2Con = whyDidEventNotTrigger(p2, { runId: p2.runId, eventSeq: xSeq2 }, { kind: 'consume', owner: 0, id: '甲.可延长' })
    expect(w2Ext.ok && w2Ext.value.outcome === 'notEntered' && w2Ext.value.notEnteredReason === 'noInstance').toBe(true)
    expect(w2Con.ok && w2Con.value.outcome === 'notEntered' && w2Con.value.notEnteredReason === 'noInstance').toBe(true)

    // 3. 前面的处理器（consume）先消耗掉了实例，随后的 buffExtend 看不到实例 -> notEntered / noInstance
    const p3 = prep([甲2, idle('乙'), idle('丙')], { rotation: ['甲 P', '甲 X'] })
    const r3 = runPrepared(p3)
    const xSeq3 = r3.log.findIndex(e => e.type === 'actionStart' && e.action === 'X')
    const w3 = whyDidEventNotTrigger(p3, { runId: p3.runId, eventSeq: xSeq3 }, { kind: 'buffExtend', owner: 0, id: '甲.可延长' })
    expect(w3.ok).toBe(true)
    if (w3.ok) {
      expect(w3.value.outcome).toBe('notEntered')
      expect(w3.value.notEnteredReason).toBe('noInstance')
    }

    // 4. 前面的处理器抛错 -> 后面未执行的 charHook 为 handlerNotRun / earlierHandlerThrew
    const 甲4: SynthChar = {
      name: '甲',
      actions: [action({ id: 'X', kind: 'skill', endFrame: 10 })],
      hooks: { onEvent(_ctx, ev) { if (ev.type === 'actionStart') throw new Error('甲 先抛错') } },
    }
    const 乙4: SynthChar = {
      name: '乙', actions: [], hooks: { onEvent() {} },
    }
    const p4 = prep([甲4, 乙4, idle('丙')], { rotation: ['甲 X'] })
    const r4 = runPrepared(p4)
    expect(r4.completion.status).toBe('engineError')
    const xSeq4 = r4.log.findIndex(e => e.type === 'actionStart')
    const w4 = whyDidEventNotTrigger(p4, { runId: p4.runId, eventSeq: xSeq4 }, { kind: 'charHook', owner: 1, id: '乙' })
    expect(w4.ok && w4.value.outcome === 'handlerNotRun' && w4.value.handlerNotRunReason === 'earlierHandlerThrew').toBe(true)

    // 5. 失败收尾留下的未处理 wait -> handlerNotRun / failCloseUnhandled
    const 甲5: SynthChar = { name: '甲', actions: [action({ id: 'E', endFrame: 20, cooldown: 500 })] }
    const p5 = prep([甲5, idle('乙'), idle('丙')], { rotation: ['甲 E', '甲 E'], options: { maxFrames: 60 } })
    const r5 = runPrepared(p5)
    const failWaitSeq = r5.log.length - 1
    expect(r5.log[failWaitSeq]!.type).toBe('wait')
    const w5 = whyDidEventNotTrigger(p5, { runId: p5.runId, eventSeq: failWaitSeq }, { kind: 'buff', owner: 0, id: '不存在' })
    expect(w5.ok && w5.value.outcome === 'handlerNotRun' && w5.value.handlerNotRunReason === 'failCloseUnhandled').toBe(true)
  })

  test('C07-30：DF-14 一方第 30 帧截断（第 60 帧判定标 unanalyzed）；删行不给映射 commands 全为 ambiguous', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'A', kind: 'skill', endFrame: 80, judgments: [judgment({ name: 'late', spawnFrame: 60 })] })],
    }
    const pFull = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'] })
    const pCut = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'], options: { maxFrames: 30 } })
    const rFull = runPrepared(pFull)
    const rCut = runPrepared(pCut)

    const lateSeq = rFull.log.findIndex(e => e.type === 'hit' && e.judgment === 'late')
    expect(lateSeq).toBeGreaterThan(0)
    const dEv = diffRuns({ p: pFull, res: rFull }, { p: pCut, res: rCut }, { kind: 'events', types: ['hit'] })
    expect(dEv.ok).toBe(true)
    if (dEv.ok) {
      const c = dEv.value.correspondences.find(x => x.base?.eventSeq === lateSeq)
      expect(c?.status).toBe('unanalyzed')
      expect(dEv.value.firstDivergence).toBeNull()
    }

    const pTwo = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A', '甲 A'] })
    const pOne = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'] })
    const dAmb = diffRuns({ p: pTwo, res: runPrepared(pTwo) }, { p: pOne, res: runPrepared(pOne) }, { kind: 'commands' })
    expect(dAmb.ok).toBe(true)
    if (dAmb.ok) expect(dAmb.value.correspondences.every(c => c.status === 'ambiguous')).toBe(true)
  })

  test('C07-31：DF-14 第二轮（1 帧动作延迟 0 vs 6、自己比自己含终态事件、对照少派生事件 addedOrRemoved）', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [action({ id: 'A', kind: 'normal', endFrame: 1 })],
    }
    const p0 = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'] })
    const p6 = prep([甲, idle('乙'), idle('丙')], { rotation: ['甲 A'] }, { options: { inputDelay: 6 } })
    const r0 = runPrepared(p0)
    const r6 = runPrepared(p6)

    // 1. 1 帧动作延迟 0 vs 6：actionStart 与 actionEnd 都 matched 且 delta.worldFrames === 6，firstDivergence 指向 actionStart
    const dDelay = diffRuns({ p: p0, res: r0 }, { p: p6, res: r6 }, { kind: 'events', types: ['actionStart', 'actionEnd'] })
    expect(dDelay.ok).toBe(true)
    if (dDelay.ok) {
      expect(dDelay.value.correspondences.length).toBe(2)
      for (const c of dDelay.value.correspondences) {
        expect(c.status).toBe('matched')
        expect(c.delta?.worldFrames).toBe(6)
      }
      expect(dDelay.value.firstDivergence?.baseEvent?.eventSeq).toBe(dDelay.value.correspondences[0]!.base?.eventSeq)
    }

    // 2. 同一次运行与自己比：全部 matched、差 0、没有分歧、终态那一帧的事件（actionEnd 在 f=1）也在对应里
    const dSelf = diffRuns({ p: p0, res: r0 }, { p: p0, res: r0 }, { kind: 'events' })
    expect(dSelf.ok).toBe(true)
    if (dSelf.ok) {
      const endSeq = r0.log.findIndex(e => e.type === 'actionEnd')
      expect(endSeq).toBeGreaterThan(0)
      expect(dSelf.value.firstDivergence).toBeNull()
      expect(dSelf.value.correspondences.every(c => c.status === 'matched' && c.delta?.worldFrames === 0)).toBe(true)
      expect(dSelf.value.correspondences.some(c => c.base?.eventSeq === endSeq)).toBe(true)
    }

    // 3. 两次完整运行里对照确实少一条派生事件（同一条轴开关触发条件）-> addedOrRemoved
    const 甲Summon: SynthChar = {
      name: '甲',
      actions: [action({
        id: 'A', kind: 'skill', endFrame: 10,
        judgments: [judgment({ name: 's', spawnFrame: 5, applies: { effect: '风蚀效应', stacks: 1 }, summon: true })],
      })],
      buffs: [buff({ id: '甲.召唤后', duration: 60, trigger: { on: 'enemyState', where: { enemyState: 'effectApplied' } } })],
    }
    const gdS = synthData([甲Summon, idle('乙'), idle('丙')])
    gdS.effects['风蚀效应'] = { name: '风蚀效应', element: '气动', source: 't', maxStacks: 3, burstMax: 0, duration: 600, tickInterval: 180, decay: 0, settleAtMax: null, multipliers: [1, 2, 3] }
    const scS = ScenarioSchema.parse({
      team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
      enemy: { custom: { level: 90 } }, rotation: ['甲 A'], options: { maxFrames: 60 },
    })
    const pTrue = prepareRun(scS, gdS, { rules: { summonCountsAsChar: true } })
    const pFalse = prepareRun(scS, gdS, { rules: { summonCountsAsChar: false } })
    if (!pTrue.ok || !pFalse.ok) throw new Error('prepare failed')
    const rTrue = runPrepared(pTrue.run)
    const rFalse = runPrepared(pFalse.run)
    const dRem = diffRuns({ p: pTrue.run, res: rTrue }, { p: pFalse.run, res: rFalse }, { kind: 'events', types: ['buffApply'] })
    expect(dRem.ok).toBe(true)
    if (dRem.ok) {
      expect(dRem.value.correspondences).toHaveLength(1)
      expect(dRem.value.correspondences[0]!.status).toBe('addedOrRemoved')
      expect(dRem.value.firstDivergence).not.toBeNull()
    }
  })
})
