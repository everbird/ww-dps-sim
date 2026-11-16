// tests/zero-interference.test.ts —— 零干扰检查（DD-05 §6；架构 §4.3）：同一份 PreparedRun 诊断全关、全开各跑一次，结果（去掉 diag）、
// 终态 SimState、事件队列游标都要相同；报错行为在结果的 completion 与 error 里一起比。另有反向用例，证明检查真的抓得到干扰；
// 边界观察点 S[0] / S[maxFrames] 的取法（C05-14，DF-10）。
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { ALL_DIAG, DiagSink, type OriginContext } from '../src/engine/diagnostics'
import { prepareRun, runForInspection, runPrepared } from '../src/engine/run'
import type { StatePrefix } from '../src/engine/run-types'
import type { SimState } from '../src/engine/types'
import { compareInspections, firstDifference, zeroInterference } from '../src/engine/zero-interference'
import { dataDescribe } from './helpers/kernel-harness'
import { diagBase, diagTeam, preparedSynth } from './helpers/diag-team'

describe('firstDifference', () => {
  test('同一个引用、NaN、键的集合、数组长度', () => {
    const shared = { x: 1 }
    expect(firstDifference({ a: shared, n: NaN }, { a: shared, n: NaN })).toBeNull()
    expect(firstDifference({ a: 1 }, { a: 1, b: undefined })).toBe('$.b：只有一边有')
    expect(firstDifference([1, [2, 3]], [1, [2, 4]])).toBe('$[1][1]：3 ≠ 4')
    expect(firstDifference({ q: [1] }, { q: [1, 2] })).toBe('$.q.length：1 ≠ 2')
  })
})

describe('零干扰：合成场景（DD-05 §6.2）', () => {
  const cases: [string, () => ReturnType<typeof diagBase>][] = [
    ['主轴：同帧多个到期、钩子生成判定、取消留下尾部、延奏、召唤', () => diagBase()],
    ['截断：到帧数上限时指令没发完', () => diagBase({}, { options: { maxFrames: 50 } })],
    ['截断：到帧数上限时指令发完了、动作还在场上', () => preparedSynth(diagTeam(), { rotation: ['甲 L'], options: { maxFrames: 100 } })],
    ['轴失败：冷却等超时', () => preparedSynth(diagTeam(), { rotation: ['甲 W', '甲 W'], options: { maxWait: 100 } })],
    ['钩子抛错：engineError', () => diagBase({ throwOn: 'y' })],
    ['抽样模式：seed 7、jitter 3（看 rng）', () => diagBase({}, {}, { sample: { seed: 7, jitter: 3 } })],
  ]
  test.each(cases)('%s', (_name, make) => {
    const p = make()
    expect(zeroInterference(p)).toBeNull()
  })

  test('各变体确实走到了各自的停止路径', () => {
    const status = cases.map(([, make]) => runPrepared(make()).completion)
    expect(status.map(c => [c.status, c.truncation?.kind ?? c.axisFailure?.kind ?? c.engineError?.code ?? null])).toEqual([
      ['completed', null], ['truncated', 'commandsPending'], ['truncated', 'inFlightRemains'], ['axisFailed', 'timeout'],
      ['engineError', 'uncaught'], ['completed', null],
    ])
    const sampled = runPrepared(cases[5]![1]())
    expect(sampled.log.some(e => e.type === 'hit' && e.dmg?.isCrit !== undefined)).toBe(true)   // 抽样模式真的抽了暴击
  })

  test('S-04：给一个什么都不做的 onHit 与不给，结果与终态都相同', () => {
    const p = diagBase()
    expect(compareInspections(runForInspection(p), runForInspection(p, { onHit: () => {} }))).toBeNull()
  })

  test('诊断开着时结果多了 diag，其余字段相同；runId 不随诊断开关变', () => {
    const p = diagBase()
    const off = runPrepared(p)
    const on = runPrepared(p, { diag: ALL_DIAG })
    expect(off.diag).toBeUndefined()
    expect(on.diag?.eventMeta?.length).toBe(on.log.length)
    expect(on.runId).toBe(off.runId)
  })
})

describe('反向用例：检查真的抓得到干扰（DD-05 §6.2）', () => {
  /** 违规的收集器：每打开一个作用域就把 s.nextId 加 1（写法约束第 4 条不许碰 nextId） */
  class Meddler extends DiagSink {
    private readonly st: SimState
    constructor(st: SimState) { super(ALL_DIAG); this.st = st }
    open(origin: OriginContext, logLength: number, parentSeq?: number): number {
      this.st.nextId += 1
      return super.open(origin, logLength, parentSeq)
    }
  }
  test('在 open 里改 s.nextId：比较失败，指出不同的地方', () => {
    const d = zeroInterference(diagBase(), { sink: s => new Meddler(s as SimState) })
    expect(d).not.toBeNull()
    expect(d).toMatch(/^(result|terminal)\./)
  })
})

describe('C05-14 边界观察点 S[0] 与 S[maxFrames]（DF-10）', () => {
  type Seen = { f: number; logLength: number; prefix: StatePrefix; nextId: number }
  const observe = (p: ReturnType<typeof diagBase>, stopAt?: number) => {
    const seen: Seen[] = []
    const out = runForInspection(p, {
      observer: {
        frames: new Set([0, 100]),
        onBoundary: (f, s, prefix) => {
          seen.push({ f, logLength: s.log.length, prefix, nextId: s.nextId })
          return f === stopAt ? 'stop' : undefined
        },
      },
    })
    return { out, seen }
  }
  // 指令没发完：第二个 W 在等冷却，到第 100 帧报 maxFrames（失败收尾写那条 wait）；指令已发完：L 还在场上，到第 100 帧记警告
  const pending = () => preparedSynth(diagTeam(), { rotation: ['甲 W', '甲 W'], options: { maxFrames: 100, maxWait: 1000 } })
  const inflight = () => preparedSynth(diagTeam(), { rotation: ['甲 L'], options: { maxFrames: 100 } })

  test.each([['指令没发完', pending, 'wait'], ['指令已发完', inflight, 'warning']] as const)('%s：S[100] 在失败收尾 / 帧数上限警告之前', (_n, make, closing) => {
    const { out, seen } = observe(make())
    expect(seen.map(x => x.f)).toEqual([0, 100])
    expect(seen[0]!.prefix).toEqual({ eventEndExclusive: seen[0]!.logLength, handledEndExclusive: seen[0]!.logLength, interventionEndExclusive: 0 })
    const s100 = seen[1]!
    expect(s100.prefix.eventEndExclusive).toBe(s100.logLength)
    expect(s100.prefix.handledEndExclusive).toBe(s100.logLength)   // tick 边界上，处理完的与写出的相同
    // 收尾写的那一条在 S[100] 之后
    const log = out.result!.log
    const last = log.map(e => e.type).lastIndexOf(closing)
    expect(last).toBeGreaterThanOrEqual(s100.logLength)
    expect(log[last]!.f).toBe(100)
    expect(out.result!.completion.status).toBe('truncated')
  })

  test.each([['指令没发完', pending], ['指令已发完', inflight]] as const)('%s：在 S[100] 要求停下 → result 为 null、没有 engineError，终态就是 S[100]', (_n, make) => {
    const { out, seen } = observe(make(), 100)
    expect(out.result).toBeNull()
    expect(out.stoppedAt).toBe(100)
    expect(out.terminal.frame).toBe(100)
    expect(out.terminal.log.length).toBe(seen[1]!.logLength)       // 停下之后没有失败收尾、没有收尾的 drain
    expect(out.busCursor).toBe(seen[1]!.prefix.handledEndExclusive)
  })

  test('在 S[0] 要求停下：初始化做完、一个 tick 都没走', () => {
    const { out } = observe(diagBase(), 0)
    expect([out.result, out.stoppedAt, out.terminal.frame]).toEqual([null, 0, 0])
  })

  test('观察回调自己抛的异常原样抛给调用方', () => {
    const p = diagBase()
    expect(() => runForInspection(p, { observer: { frames: new Set([3]), onBoundary: () => { throw new Error('回调出错') } } })).toThrow('回调出错')
  })
})

dataDescribe('零干扰：代表场景（DD-05 §6.2）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  const load = (f: string) => ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')))
  test.each(['m0-video-eq.yaml', 'xin-team.yaml', 'xin-tower4-video.yaml'])('%s', f => {
    const p = prepareRun(load(f), gd)
    if (!p.ok) throw new Error(p.issues.map(i => i.message).join('\n'))
    expect(zeroInterference(p.run)).toBeNull()
  }, 60_000)
})
