// tests/replay-input.test.ts —— 录像输入（DD-09 §3、§7）：状态同步（C09-1～C09-5、C09-18）、三种时段与填法展开（C09-6、C09-7）。
// 人造角色，不依赖 data/generated。
import { describe, expect, test } from 'vitest'
import { expandReplayCombos, fillCombos, givenConflicts, replayInserts } from '../src/data/replay'
import { parseRotationLine, ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { checkLedgerClosure } from '../src/engine/diagnostics'
import { checkLog } from '../src/engine/invariants'
import { replayResources } from '../src/engine/resource-replay'
import { prepareRun, runForInspection, runPrepared } from '../src/engine/run'
import type { InterventionRecord, PreparedRun, RunOverrides } from '../src/engine/run-types'
import type { CharacterHooks, SimEvent } from '../src/engine/types'
import { preparedSynth } from './helpers/diag-team'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

// 人造队伍：甲 X 30 帧、第 10 帧命中给协奏 10、能量 10（全队分）；核心资源"甲核"上限 10；协奏满时挂 甲.满（resourceFull 触发）
const 甲 = (hooks?: CharacterHooks): SynthChar => ({
  name: '甲',
  core: [{ slot: 1, name: '甲核', cap: 10 }],
  actions: [action({ id: 'X', kind: 'normal', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gains: { energy: 10, concerto: 10, core: [0, 0, 0] } })] })],
  buffs: [{ id: '甲.满', source: 't', zone: 'atkPct', value: 0.1, target: 'self', duration: 600, trigger: { on: 'resourceFull', where: { resource: 'concerto' } } }],
  ...(hooks ? { hooks } : {}),
})
const 乙: SynthChar = { name: '乙', actions: [action({ id: 'Y', kind: 'normal', endFrame: 20 })] }
const team = (hooks?: CharacterHooks): [SynthChar, SynthChar, SynthChar] => [甲(hooks), 乙, idle('丙')]
const prep = (sc: Partial<ScenarioInput>, hooks?: CharacterHooks, overrides: RunOverrides = {}): PreparedRun => preparedSynth(team(hooks), sc, overrides)

/** 数钩子 onEvent 被调了几次 */
function counted(): { hooks: CharacterHooks; n: () => number } {
  let n = 0
  return { hooks: { onEvent() { n++ } }, n: () => n }
}
/** 跑到底，交出结果与终态 */
function inspect(p: PreparedRun, diag = false) {
  const x = runForInspection(p, diag ? { diag: { resourceLedger: true } } : {})
  return { res: x.result!, s: x.terminal }
}

describe('状态同步（DD-09 §3.2）', () => {
  test('语法：同步 / sync，=绝对值或百分比；写错了报错', () => {
    expect(parseRotationLine('同步 甲 协奏 =62')).toEqual([{ kind: 'sync', char: '甲', resource: '协奏', value: 62, unit: 'value' }])
    expect(parseRotationLine('sync 甲 energy 50%')).toEqual([{ kind: 'sync', char: '甲', resource: 'energy', value: 0.5, unit: 'ratio' }])
    expect(parseRotationLine('同步 甲 甲核 ＝3')).toEqual([{ kind: 'sync', char: '甲', resource: '甲核', value: 3, unit: 'value' }])
    for (const bad of ['同步 甲 协奏 62', '同步 甲 协奏', '同步 甲 协奏 120%', 'sync 甲 协奏 =x']) expect(parseRotationLine(bad)).toHaveProperty('error')
    const p = prepareRun(ScenarioSchema.parse({ team: team().map(c => ({ char: c.name, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 X', '同步 甲 怒气 =3'] }), synthData(team()))
    expect(p.ok).toBe(false)
    expect(!p.ok && p.issues[0]!.message).toMatch(/甲 没有资源"怒气"（能写：能量、协奏、甲核）/)
  })

  test('C09-1 同步 甲 协奏 =62，此前是 40：状态里是 62；日志没有新的 resource 事件；onEvent 调用次数不变；干预记录 before 40、adopted 62、firedTriggers false', () => {
    const a = counted(), b = counted()
    const withSync = inspect(prep({ rotation: ['甲 X', 'wait 40', '同步 甲 协奏 =62'], initial: { concerto: [30, 0, 0] } }, a.hooks))
    const without = inspect(prep({ rotation: ['甲 X', 'wait 40'], initial: { concerto: [30, 0, 0] } }, b.hooks))
    expect(withSync.s.chars[0].concerto).toBe(62)
    expect(without.s.chars[0].concerto).toBe(40)
    expect(eventsOfLog(withSync.res.log, 'resource').length).toBe(eventsOfLog(without.res.log, 'resource').length)
    expect(withSync.res.log.map(e => e.type)).toEqual(without.res.log.map(e => e.type))
    expect(a.n()).toBe(b.n())
    expect(withSync.res.interventions).toEqual([expect.objectContaining({
      index: 0, kind: 'sync', target: { slot: 0, resource: 'concerto' }, before: 40, adopted: 62, delta: 22, firedTriggers: false, skippedTriggers: ['resource'],
    })])
    expect(withSync.res.completion.conditioning).toEqual({ basis: 'conditioned', firstInterventionIndex: 0 })
    expect(withSync.res.summary.assumptions.find(x => x.id === 'forced-sync')).toMatchObject({ count: 1 })
  })

  test('C09-2 同步到满：没有 resourceFull 事件，skippedTriggers 含它；"协奏满时"的 buff 没挂上（照常打满的对照挂上了）', () => {
    const synced = runPrepared(prep({ rotation: ['甲 X', 'wait 40', '同步 甲 协奏 100%'], initial: { concerto: [30, 0, 0] } }))
    expect(eventsOfLog(synced.log, 'resourceFull')).toEqual([])
    expect(synced.interventions[0]).toMatchObject({ before: 40, adopted: 100, firedTriggers: false, skippedTriggers: ['resource', 'resourceFull'] })
    expect(eventsOfLog(synced.log, 'buffApply').filter(e => e.buff === '甲.满')).toEqual([])
    const natural = runPrepared(prep({ rotation: ['甲 X', 'wait 40'], initial: { concerto: [95, 0, 0] } }))
    expect(eventsOfLog(natural.log, 'resourceFull').length).toBe(1)
    expect(eventsOfLog(natural.log, 'buffApply').filter(e => e.buff === '甲.满').length).toBe(1)
  })

  test('C09-3 连续两条同步、中间没有业务事件：afterEventSeq 相同、orderInAnchor 0 与 1；账本闭合；checkLog 通过（诊断关着）', () => {
    const p = prep({ rotation: ['甲 X', 'wait 40', '同步 甲 协奏 =62', '同步 甲 甲核 =7'], initial: { concerto: [30, 0, 0] } })
    const off = runPrepared(p)
    const [a, b] = off.interventions
    expect(a!.afterEventSeq).toBe(b!.afterEventSeq)
    expect([a!.orderInAnchor, b!.orderInAnchor]).toEqual([0, 1])
    expect(b).toMatchObject({ target: { slot: 0, resource: 'core1' }, before: 0, adopted: 7, skippedTriggers: ['resource'] })
    expect(checkLog(p.resolved, off)).toEqual([])
    const on = inspect(p, true)
    const ledger = on.res.diag!.resourceLedger!
    const syncs = ledger.filter(e => e.kind === 'sync')
    expect(syncs.map(e => [e.causeKind, e.relatedInterventionIndex, e.before, e.after])).toEqual([['sync', 0, 40, 62], ['sync', 1, 0, 7]])
    expect(checkLedgerClosure(ledger, on.res.diag!.ledgerMarks!.terminalEndExclusive, on.s)).toEqual([])
    // 诊断开关不改结果（零干扰）：除 diag 外相同
    const { diag: _d, ...rest } = on.res
    expect(rest).toEqual(off)
  })

  test('C09-4 严格入口的场景里写同步：编译期报 strict.external', () => {
    const p = prepareRun(ScenarioSchema.parse({
      team: team().map(c => ({ char: c.name, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
      rotation: ['甲 X', '同步 甲 协奏 =62'], options: { strict: true, tuneBreak: 'off' }, tuneBreakOmitted: { reason: 'deliberate' },
    }), synthData(team()))
    expect(p.ok).toBe(false)
    expect(!p.ok && p.issues.map(i => i.code)).toContain('strict.external')
  })

  test('C09-5 同一时刻既有同步又有没标 !given 的同种读数：编译期报错；标了 !given、或差 0.5 秒以上的不报', () => {
    const sc = (concerto: string[]) => ({
      purpose: 'replay' as const, replay: { videoOffset: 2 },
      rotation: ['甲 X', 'at 1.0', '同步 甲 协奏 =62'], video: { marks: { '1': 2 }, concerto },
    })
    const issue = (concerto: string[]) => {
      try { prep(sc(concerto)); return null } catch (e) { return (e as Error).message }
    }
    expect(issue(['3.2 甲 0.62'])).toMatch(/video\.concerto 第 1 条.*rotation 第 3 条的同步.*!given/)
    expect(issue(['3.2 甲 0.62 !given'])).toBeNull()
    expect(issue(['3.6 甲 0.62'])).toBeNull()
    expect(issue(['3.2 乙 0.62'])).toBeNull()                                     // 另一个人
    // 核心资源同名才算同一项；没有 videoOffset 时要求写上
    expect(givenConflicts(ScenarioSchema.parse({ ...base, ...sc([]), rotation: ['甲 X', 'at 1.0', '同步 甲 甲核 =3'], video: { marks: { '1': 2 }, core: ['3.0 甲 甲核 0.3'] } }))).toHaveLength(1)
    expect(givenConflicts(ScenarioSchema.parse({ ...base, ...sc([]), replay: undefined, purpose: 'replay', rotation: ['甲 X', 'at 1.0', '同步 甲 甲核 =3'], video: { marks: { '1': 2 }, core: ['3.0 甲 甲核 0.3'] } })))
      .toEqual([expect.objectContaining({ message: expect.stringMatching(/replay\.videoOffset/) })])
  })
})

const base = { team: team().map(c => ({ char: c.name, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } } }

describe('按日志重放资源要读干预记录（DD-09 §3.2，DF-09；C09-18）', () => {
  test('轮边界上一次同步：分轮的资源首尾差含同步；资源曲线逐点与状态一致；checkLog 通过', () => {
    // 每轮：甲 X（第 10 帧命中 +10 协奏）、等 40 帧、同步到 50。第 1 轮 0 → 10 → 50；第 2 轮 50 → 60，最后那次同步在统计窗口之外
    const p = prep({ rotation: ['甲 X', 'wait 40', '同步 甲 协奏 =50'], options: { repeat: 2 } })
    const frames = new Set<number>()
    for (let f = 0; f <= 200; f++) frames.add(f)
    const seen = new Map<number, number>()
    const x = runForInspection(p, { observer: { frames, onBoundary: (f, s) => { seen.set(f, s.chars[0].concerto) } } })
    const res = x.result!
    expect(res.interventions.map(i => i.kind)).toEqual(['sync', 'sync'])
    expect(res.summary.perLoop!.map(l => l.concertoDelta[0])).toEqual([50, 10])
    expect(checkLog(p.resolved, res)).toEqual([])
    // 资源曲线的第 f 帧 = 那一帧结束时 = 边界 S[f + 1]；最后一点是终态（含最后那个不计入的空闲 tick 里执行的同步）
    const tl = res.summary.resourceTimeline
    for (const pt of tl.slice(0, -1)) expect([pt.f, pt.concerto[0]]).toEqual([pt.f, seen.get(pt.f + 1)])
    expect(tl.length).toBeGreaterThan(2)
    expect(tl.at(-1)!.concerto[0]).toBe(x.terminal.chars[0].concerto)
    expect(x.terminal.chars[0].concerto).toBe(50)
  })

  test('同一锚点连续两次同步：按 orderInAnchor 依次套用，后一次为准', () => {
    const p = prep({ rotation: ['甲 X', 'wait 40', '同步 甲 协奏 =62', '同步 甲 协奏 =20'], initial: { concerto: [30, 0, 0] } })
    const { res, s } = inspect(p)
    expect(s.chars[0].concerto).toBe(20)
    expect(res.summary.resourceTimeline.at(-1)!.concerto[0]).toBe(20)
    expect(checkLog(p.resolved, res)).toEqual([])
  })

  test('只套用 kind sync：照旧写业务事件的干预（能量满、敌人 失谐）不重复计算', () => {
    const p = prep({ rotation: ['甲 X', '能量满 甲', '敌人 失谐', 'wait 40'], initial: { energy: 'empty' } })
    const { res, s } = inspect(p)
    expect(res.interventions.map(i => i.kind)).toEqual(['fill', 'enemyDisharmony'])
    expect(res.summary.resourceTimeline.at(-1)!.energy[0]).toBe(s.chars[0].energy)
    expect(checkLog(p.resolved, res)).toEqual([])
    // 直接喂一条 fill 记录给重放：resource 事件已经写了值，记录本身不再套用
    const r = p.resolved
    const log: SimEvent[] = [{ type: 'resource', f: 3, t: 0.05, char: '甲', resource: 'energy', delta: 100, value: 100, cause: 'forced' }]
    const fill: InterventionRecord = { index: 0, f: 3, phase: 'P2', afterEventSeq: -1, orderInAnchor: 0, kind: 'fill', target: { slot: 0, resource: 'energy' }, before: 0, adopted: 100, delta: 100, firedTriggers: true, skippedTriggers: [] }
    const sync: InterventionRecord = { ...fill, index: 1, afterEventSeq: 0, kind: 'sync', before: 100, adopted: 30, delta: -70, firedTriggers: false, skippedTriggers: ['resource'] }
    expect(replayResources(log, r, [fill]).energy[0]).toBe(100)
    expect(replayResources(log, r, [fill, sync]).energy[0]).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// 三种时段与填法（DD-09 §3.1）

const replaySc = (segments: unknown[], rotation = ['甲 X', 'at 1.0', '甲 X', 'at 3.0', '甲 X']) => ({
  ...base, purpose: 'replay' as const, rotation, replay: { videoOffset: 10, segments }, video: { marks: { '1': 10 } },
})

describe('三种时段与填法（DD-09 §3.1）', () => {
  test('填法插在闭合的 at 之前，条号接在 rotation 之后；原有各条的条号不变', () => {
    const sc = ScenarioSchema.parse(replaySc([{ kind: 'unobserved', from: 11.6, to: 13.0, reason: '镜头外', fills: [{ name: '补两下', lines: ['甲 X X'] }] }]))
    const ins = replayInserts(sc)
    expect(ins).toEqual({ issues: [], inserts: [{ segment: 0, fill: '补两下', beforeLine: 4, firstLine: 6, lines: ['甲 X X'] }] })
    const p = prepareRun(sc, synthData(team()))
    expect(p.ok).toBe(true)
    const cmds = p.ok ? p.run.resolved.commands.map(c => `${c.kind}:${c.line}.${c.item}`) : []
    expect(cmds).toEqual(['act:1.1', 'at:2.1', 'act:3.1', 'act:6.1', 'act:6.2', 'at:4.1', 'act:5.1'])
  })

  test('C09-6 一个未观测时段、两种填法：展开成两次运行，runId 不同；各带填法组合的名字', () => {
    const sc = ScenarioSchema.parse(replaySc([{
      kind: 'unobserved', from: 11.6, to: 13.0, reason: '镜头外',
      fills: [{ name: '补两下', lines: ['甲 X X'] }, { name: '不补', lines: [] }],
    }]))
    expect(fillCombos(sc).map(c => c.name)).toEqual(['11.6=补两下', '11.6=不补'])
    // 不展开直接跑：报"有 2 种填法"
    const raw = prepareRun(sc, synthData(team()))
    expect(raw.ok).toBe(false)
    expect(!raw.ok && raw.issues[0]!.message).toMatch(/有 2 种填法：先展开成各个组合分别跑/)
    const x = expandReplayCombos(sc)
    expect(x.ok).toBe(true)
    const runs = x.ok ? x.combos.map(c => ({ name: c.name, p: prepareRun(c.scenario, synthData(team())) })) : []
    expect(runs.map(r => r.name)).toEqual(['11.6=补两下', '11.6=不补'])
    const ids = runs.map(r => (r.p.ok ? r.p.run.runId : null))
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(2)
    // 只跑指定的组合；名字写错报错
    const one = expandReplayCombos(sc, ['11.6=不补'])
    expect(one.ok && one.combos.map(c => c.name)).toEqual(['11.6=不补'])
    expect(expandReplayCombos(sc, ['没有这个']).ok).toBe(false)
  })

  test('组合超过 16 个要指定跑哪几个', () => {
    const segs = [0, 1, 2, 3, 4].map(i => ({ kind: 'unobserved', from: 10.1 + i * 0.1, to: 10.15 + i * 0.1, reason: 'r', fills: [{ name: 'a', lines: [] }, { name: 'b', lines: [] }] }))
    const sc = ScenarioSchema.parse(replaySc(segs))
    expect(fillCombos(sc)).toHaveLength(32)
    const x = expandReplayCombos(sc)
    expect(x.ok).toBe(false)
    expect(!x.ok && x.message).toMatch(/32 个，超过 16 个/)
  })

  test('C09-7 idle 不写 basis：schema 报错；时段跨过一个已观测（钉了 at）的动作：编译期报错', () => {
    expect(ScenarioSchema.safeParse(replaySc([{ kind: 'idle', from: 11, to: 12 }])).success).toBe(false)
    expect(ScenarioSchema.safeParse(replaySc([{ kind: 'idle', from: 11, to: 12, basis: '回路条一直是空的' }])).success).toBe(true)
    // 10.5–12.0 跨过了第 2 条 at 1.0（视频 11.0）
    const sc = ScenarioSchema.parse(replaySc([{ kind: 'idle', from: 10.5, to: 12.0, basis: 'x' }]))
    const p = prepareRun(sc, synthData(team()))
    expect(p.ok).toBe(false)
    expect(!p.ok && p.issues[0]).toMatchObject({ stage: 'compile', message: expect.stringMatching(/跨过了第 2 条 at 1.*不能跨过已观测的动作/) })
  })

  test('时段的其他检查：from < to、不重叠、只在录像剖析里写、写了时段要给 videoOffset', () => {
    const bad = (sc: unknown) => ScenarioSchema.safeParse(sc).success
    expect(bad(replaySc([{ kind: 'idle', from: 12, to: 11, basis: 'x' }]))).toBe(false)
    expect(bad(replaySc([{ kind: 'idle', from: 11, to: 12, basis: 'x' }, { kind: 'idle', from: 11.5, to: 12.5, basis: 'y' }]))).toBe(false)
    expect(bad({ ...replaySc([]), purpose: 'rotation' })).toBe(false)
    expect(bad({ ...replaySc([{ kind: 'idle', from: 11, to: 12, basis: 'x' }]), replay: { segments: [{ kind: 'idle', from: 11, to: 12, basis: 'x' }] } })).toBe(false)
    expect(bad(replaySc([{ kind: 'unobserved', from: 11, to: 12, reason: 'r', fills: [{ name: 'a', lines: [] }, { name: 'a', lines: [] }] }]))).toBe(false)
  })

  test('填法的行写错了：报错指到哪个时段、哪种填法的第几行', () => {
    const sc = ScenarioSchema.parse(replaySc([{ kind: 'unobserved', from: 11.6, to: 13.0, reason: 'r', fills: [{ name: '补', lines: ['甲 X', '甲 没有的'] }] }]))
    const p = prepareRun(sc, synthData(team()))
    expect(p.ok).toBe(false)
    expect(!p.ok && p.issues[0]!.message).toMatch(/replay\.segments\[0\] 填法"补"第 2 行：甲 没有动作"没有的"/)
  })
})
