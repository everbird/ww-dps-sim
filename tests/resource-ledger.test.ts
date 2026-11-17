// tests/resource-ledger.test.ts —— 资源只读账本（DD-06 §5；架构 §6.3 的清单；RR-02）：期初、各写入点、截断、延奏清零、钩子修改、
// 任意帧边界与终态的闭合、降级续跑的上界、丢弃的不记、诊断开关、DF-07 的关联、调试表改用账本、与日志的交叉检查。
// 人造角色，不依赖 data/generated（最后一组用真实场景，缺数据时跳过）。带账本跑的用例最后都对终态做一次闭合检查（含相邻条目不变式）；
// C06-11 的第一条正是要它失败。
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import {
  ALL_DIAG, checkLedgerClosure, crossCheckLedger, DiagSink, ledgerPrefixForBoundary, ledgerTotals,
  type LedgerBalances, type ResourceLedgerEntry,
} from '../src/engine/diagnostics'
import { checkLog } from '../src/engine/invariants'
import { prepareRun, runForInspection } from '../src/engine/run'
import type { PreparedRun, RunOverrides } from '../src/engine/run-types'
import { gainSteps, metaOf, resourceSel, resourceTracks, traceLedger } from '../src/analysis/trace'
import type { CharacterHooks, SimEvent, SimResult, SimState } from '../src/engine/types'
import { zeroInterference } from '../src/analysis/zero-interference'
import { preparedSynth } from './helpers/diag-team'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

// ---------------------------------------------------------------------------
// 人造队伍
//   甲（槽 0）：核心资源槽 1"槽一"上限 10，没有槽 2。
//     X：30 帧，第 10 帧命中：基础能量 10（全队分）、协奏 10、槽一 +2，削韧 10（敌人白条 10 时打空 → 破盾回能）
//     C：10 帧，第 2 帧命中：只给协奏 10
//     R：大招，耗能 100，20 帧
//     W：共鸣技能 20 帧，起手即得 协奏 +5、槽一 +3
//     D：10 帧，第 2 帧命中给槽二 +5（甲没有槽二：丢弃、警告一次）
//     H：10 帧，第 2 帧命中带治疗，给协奏 10
//   乙（槽 1）：QTE（变奏，第 5 帧触发延奏，30 帧）；Y：20 帧，第 5 帧命中：基础能量 5、协奏 5。
//     常驻 buff 共鸣效率 +50%（面板 100% → 150%）；资源型效果"乙 Y 开始时回 4 点能量，受共鸣效率影响"
//   丙（槽 2）：陪跑
const 甲 = (hooks?: CharacterHooks): SynthChar => ({
  name: '甲',
  core: [{ slot: 1, name: '槽一', cap: 10 }],
  actions: [
    action({ id: 'X', kind: 'normal', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gains: { energy: 10, concerto: 10, core: [2, 0, 0] }, gauges: { toughness: 10, tunability: 0 } })] }),
    action({ id: 'C', endFrame: 10, judgments: [judgment({ name: 'c', spawnFrame: 2, gains: { energy: 0, concerto: 10, core: [0, 0, 0] } })] }),
    action({ id: 'R', kind: 'liberation', endFrame: 20, energyCost: 100 }),
    action({ id: 'W', kind: 'skill', endFrame: 20, castGains: [{ atFrame: 0, resource: 'concerto', amount: 5 }, { atFrame: 0, resource: 'core1', amount: 3 }] }),
    action({ id: 'D', endFrame: 10, judgments: [judgment({ name: 'd', spawnFrame: 2, gains: { energy: 0, concerto: 0, core: [0, 5, 0] } })] }),
    action({ id: 'H', endFrame: 10, judgments: [judgment({ name: 'h', spawnFrame: 2, heals: true, gains: { energy: 0, concerto: 10, core: [0, 0, 0] } })] }),
  ],
  ...(hooks ? { hooks } : {}),
})
const 乙: SynthChar = {
  name: '乙',
  actions: [
    action({ id: 'QTE', kind: 'intro', endFrame: 30, outroTriggerFrame: 5 }),
    action({ id: 'Y', kind: 'normal', endFrame: 20, judgments: [judgment({ name: 'y', spawnFrame: 5, gains: { energy: 5, concerto: 5, core: [0, 0, 0] } })] }),
  ],
  buffs: [{ id: '乙.效率', source: 't', zone: 'energyRegen', value: 0.5, target: 'self', trigger: 'always', duration: 'inf' }],
  effects: [{ id: '乙.回能', source: '施放 Y 时回复 4 点能量，此效果受共鸣效率影响', resource: 'energy', amount: 4, scaledByRegen: true, target: 'self', trigger: { on: 'actionStart', where: { actions: ['Y'] } } }],
}
const 丙 = idle('丙')

const prepared = (sc: Partial<ScenarioInput>, hooks?: CharacterHooks, overrides: RunOverrides = {}): PreparedRun =>
  preparedSynth([甲(hooks), 乙, 丙], sc, overrides)

/** 带账本跑；frames 给了就在这些 S[f] 记下每人的资源与这个边界的账本上界（DD-05 §6.1 的边界观察点）；eventMeta：另开事件来源（调试表要它） */
function ledgerRun(p: PreparedRun, frames: Iterable<number> = [], eventMeta = false) {
  const seen = new Map<number, { state: LedgerBalances; ledgerLength: number | null }>()
  const x = runForInspection(p, {
    diag: { resourceLedger: true, ...(eventMeta ? { eventMeta: true } : {}) },
    observer: { frames: new Set(frames), onBoundary: (f, s, _prefix, ledgerLength) => { seen.set(f, { state: balancesOf(s), ledgerLength }) } },
  })
  const res = x.result!
  return { res, ledger: res.diag!.resourceLedger!, marks: res.diag!.ledgerMarks!, terminal: x.terminal, seen }
}

/** 闭合检查要的那部分状态：拷贝成数（边界观察点收到的是状态本体） */
const balancesOf = (s: Readonly<SimState>): LedgerBalances =>
  ({ chars: s.chars.map(c => ({ slot: c.slot, name: c.name, energy: c.energy, concerto: c.concerto, core: [...c.core] })) })

/** 终态闭合（含相邻条目不变式）；每个用例最后都调 */
function expectClosed(run: { ledger: readonly ResourceLedgerEntry[]; marks: { terminalEndExclusive: number }; terminal: SimState }) {
  expect(run.marks.terminalEndExclusive).toBe(run.ledger.length)
  expect(checkLedgerClosure(run.ledger, run.marks.terminalEndExclusive, run.terminal)).toEqual([])
}

const changes = (ledger: readonly ResourceLedgerEntry[]) => ledger.filter(e => e.kind !== 'initial')
const ofChar = (ledger: readonly ResourceLedgerEntry[], slot: number, resource: string) => changes(ledger).filter(e => e.slot === slot && e.resource === resource)

// ---------------------------------------------------------------------------

describe('C06-1 期初', () => {
  test('前 21 条都是期初：按（槽位，资源）的固定顺序，两个增量都是 0，余额在 after 里', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 C'], initial: { energy: [50, 0, 100], concerto: 30, core: { 甲: { 槽一: 7 } } } }))
    const head = run.ledger.slice(0, 21)
    expect(head.every(e => e.kind === 'initial' && e.causeKind === 'initial' && e.cause === 'initial' && e.phase === 'init' && e.f === 0)).toBe(true)
    expect(head.every(e => e.requestedDelta === 0 && e.actualDelta === 0 && e.clippedDelta === 0 && e.before === e.after)).toBe(true)
    expect(head.map(e => `${e.slot}${e.resource}`)).toEqual([0, 1, 2].flatMap(s => ['energy', 'concerto', 'core1', 'core2', 'core3', 'core4', 'core5'].map(r => `${s}${r}`)))
    expect(head.map(e => e.index)).toEqual([...Array(21).keys()])
    const at = (slot: number, res: string) => head.find(e => e.slot === slot && e.resource === res)!
    expect([at(0, 'energy').after, at(1, 'energy').after, at(2, 'energy').after]).toEqual([50, 0, 100])
    expect([at(0, 'concerto').after, at(1, 'concerto').after, at(2, 'concerto').after]).toEqual([30, 30, 30])
    expect(at(0, 'core1').after).toBe(7)
    expect([at(0, 'energy').cap, at(0, 'concerto').cap, at(0, 'core1').cap, at(0, 'core2').cap]).toEqual([100, 100, 10, Infinity])   // 没登记的槽没有上限
    expect(run.ledger[21]?.kind).not.toBe('initial')
    expectClosed(run)
  })
})

describe('C06-2 初始化阶段钩子改资源', () => {
  const run = ledgerRun(prepared({ rotation: ['甲 C'], initial: { energy: 'empty' } }, { onResolve: ctx => ctx.addResource('core1', 5) }), [0, 1])
  const hook = run.ledger.find(e => e.causeKind === 'hook')!

  test('有一条 phase init、causeKind hook、f 0 的条目，排在期初之后', () => {
    expect(hook).toMatchObject({ phase: 'init', kind: 'change', f: 0, slot: 0, resource: 'core1', before: 0, requestedDelta: 5, actualDelta: 5, after: 5 })
    expect(hook.index).toBe(21)
    expect(run.res.log[hook.relatedEventSeq!]).toMatchObject({ type: 'resource', cause: 'hook', delta: 5, value: 5 })
  })

  test('S[0] 的前缀包含它并闭合；S[1] 的前缀里它只出现一次', () => {
    const p0 = ledgerPrefixForBoundary(run.ledger, 0)
    expect(p0).toContain(hook)
    expect(p0.length).toBe(run.seen.get(0)!.ledgerLength)
    expect(checkLedgerClosure(p0, p0.length, run.seen.get(0)!.state)).toEqual([])
    const p1 = ledgerPrefixForBoundary(run.ledger, 1)
    expect(p1.filter(e => e === hook)).toHaveLength(1)
    expect(p1.length).toBe(run.seen.get(1)!.ledgerLength)
    expect(checkLedgerClosure(p1, p1.length, run.seen.get(1)!.state)).toEqual([])
    expectClosed(run)
  })
})

describe('C06-3 正常获得', () => {
  test('一次命中：三人各一条 hit 的能量条目、甲一条协奏条目，都关联到那条 hit', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 X'], initial: { energy: 'empty' } }))
    const hit = run.res.log.findIndex(e => e.type === 'hit')
    const energy = changes(run.ledger).filter(e => e.resource === 'energy' && e.causeKind === 'hit')
    expect(energy.map(e => e.slot)).toEqual([0, 1, 2])
    // 出伤者全额、队友各一半，乘各自的共鸣效率（乙 150%）
    expect(energy.map(e => [e.requestedDelta, e.actualDelta, e.clippedDelta])).toEqual([[10, 10, 0], [7.5, 7.5, 0], [5, 5, 0]])
    const concerto = ofChar(run.ledger, 0, 'concerto')
    expect(concerto).toHaveLength(1)
    expect(concerto[0]).toMatchObject({ causeKind: 'hit', cause: 'hit', requestedDelta: 10, actualDelta: 10, clippedDelta: 0 })
    expect([...energy, ...concerto, ...ofChar(run.ledger, 0, 'core1')].every(e => e.relatedEventSeq === hit)).toBe(true)
    expectClosed(run)
  })
})

describe('C06-4 满格再获得', () => {
  test('95 + 10：实际 5、截掉 5；100 + 10：实际 0、截掉 10，这一条照样有；合计的两个口径分开', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 C C'], initial: { concerto: [95, 0, 0] } }))
    const [a, b] = ofChar(run.ledger, 0, 'concerto')
    expect([a!.before, a!.requestedDelta, a!.actualDelta, a!.clippedDelta, a!.after]).toEqual([95, 10, 5, 5, 100])
    expect([b!.before, b!.requestedDelta, b!.actualDelta, b!.clippedDelta, b!.after]).toEqual([100, 10, 0, 10, 100])
    // 第二次的命中照样关联（hit 在日志里，gains.concerto 记 0）
    expect(run.res.log[b!.relatedEventSeq!]).toMatchObject({ type: 'hit', gains: { concerto: 0 } })
    const t = ledgerTotals(run.ledger).find(x => x.slot === 0 && x.resource === 'concerto')!
    expect(t).toMatchObject({ initial: 95, gainRequested: 20, gainActual: 5, clippedAtCap: 15, spendActual: 0, final: 100 })
    expectClosed(run)
  })
})

describe('C06-5 扣到 0 以下', () => {
  test('只有 3 时扣 8：实际 −3、截掉 −5、after 0', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 C'], initial: { core: { 甲: { 槽一: 3 } } } }, {
      onEvent: (ctx, ev) => { if (ev.type === 'actionStart' && ev.action === 'C') ctx.addResource('core1', -8) },
    }))
    const [e] = ofChar(run.ledger, 0, 'core1')
    expect(e).toMatchObject({ causeKind: 'hook', requestedDelta: -8, actualDelta: -3, clippedDelta: -5, after: 0 })
    const t = ledgerTotals(run.ledger).find(x => x.slot === 0 && x.resource === 'core1')!
    expect(t).toMatchObject({ initial: 3, spendRequested: -8, spendActual: -3, clippedAtZero: -5, final: 0 })
    expectClosed(run)
  })
})

describe('C06-6 大招扣费', () => {
  test('能量满放大招：一条 cost，实际 −耗能，关联到 cause cost 的 resource 事件', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 R'] }))
    const [e] = ofChar(run.ledger, 0, 'energy')
    expect(e).toMatchObject({ causeKind: 'cost', cause: 'cost', before: 100, requestedDelta: -100, actualDelta: -100, clippedDelta: 0, after: 0 })
    expect(run.res.log[e!.relatedEventSeq!]).toMatchObject({ type: 'resource', cause: 'cost', char: '甲', resource: 'energy', delta: -100, value: 0 })
    expectClosed(run)
  })
})

describe('C06-7 延奏清零', () => {
  test('甲协奏满、变奏切乙：一条 outroReset，100 → 0；f 是变奏动作走到延奏触发帧的那一帧，不是切人那一帧', () => {
    const run = ledgerRun(prepared({ rotation: ['switch 乙 变奏', 'wait 30'], initial: { concerto: [100, 0, 0] } }))
    const resets = run.ledger.filter(e => e.kind === 'outroReset')
    expect(resets).toHaveLength(1)
    const e = resets[0]!
    expect(e).toMatchObject({ slot: 0, resource: 'concerto', causeKind: 'outro', cause: 'outro', before: 100, requestedDelta: -100, actualDelta: -100, clippedDelta: 0, after: 0, cap: 100 })
    const sw = eventsOfLog(run.res.log, 'switch')[0]!
    const outro = eventsOfLog(run.res.log, 'outro')[0]!
    expect(e.f).toBe(outro.f)
    expect(e.f).toBe(sw.f + 5)
    expect(run.res.log[e.relatedEventSeq!]).toMatchObject({ type: 'resource', cause: 'outro', delta: -100, value: 0 })
    expect(ledgerTotals(run.ledger).find(x => x.slot === 0 && x.resource === 'concerto')).toMatchObject({ outroReset: -100, spendActual: 0, final: 0 })
    expectClosed(run)
  })
})

describe('C06-8 运行中钩子改资源；资源型效果', () => {
  test('钩子给队友 2 点能量：那条的槽位是队友；受共鸣效率影响的效果给 4 点、接收者效率 150%：请求量 6', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 X', 'switch 乙', '乙 Y'], initial: { energy: 'empty' } }, {
      onEvent: (ctx, ev) => { if (ev.type === 'hit' && ev.judgment === 'x') ctx.addResource('energy', 2, 2, '给丙') },
    }))
    const hook = changes(run.ledger).find(e => e.causeKind === 'hook')!
    expect(hook).toMatchObject({ slot: 2, resource: 'energy', cause: 'hook：给丙', requestedDelta: 2, actualDelta: 2 })
    expect(run.res.log[hook.relatedEventSeq!]).toMatchObject({ type: 'resource', char: '丙', cause: 'hook', note: '给丙' })
    const eff = changes(run.ledger).find(e => e.causeKind === 'effect')!
    expect(eff).toMatchObject({ slot: 1, resource: 'energy', cause: '乙.回能', requestedDelta: 6, actualDelta: 6, clippedDelta: 0 })
    expect(run.res.log[eff.relatedEventSeq!]).toMatchObject({ type: 'resource', cause: '乙.回能', delta: 6 })
    expectClosed(run)
  })
})

// 含各种写入的合成轴（约 300 帧）：期初、初始化钩子、命中（全队能量、协奏、核心资源，到上限被截）、起手即得、钩子（给队友、扣到 0 以下）、
// 破盾回能、同步（外部干预，DD-09 §3.2；原来是能量满，T09-10 删了）、大招扣费、延奏清零、资源型效果
const MIXED: { sc: Partial<ScenarioInput>; hooks: CharacterHooks } = {
  sc: {
    rotation: ['甲 X', '甲 W', '同步 甲 能量 100%', '甲 R', '甲 C', 'switch 乙 变奏', '乙 Y', 'wait 200'],
    initial: { energy: [50, 0, 0], concerto: [95, 0, 0], core: { 甲: { 槽一: 9 } } },
    enemy: { custom: { level: 90, whiteBar: 10 } },
  },
  hooks: {
    onResolve: ctx => ctx.addResource('core1', -1),
    onEvent: (ctx, ev) => {
      if (ev.type === 'hit' && ev.judgment === 'x') ctx.addResource('energy', 2, 2, '给丙')
      if (ev.type === 'actionStart' && ev.action === 'W') ctx.addResource('core1', -20, ctx.self, '扣光')
    },
  },
}
const mixed = () => prepared(MIXED.sc, MIXED.hooks)

describe('C06-9 任意帧边界闭合', () => {
  const all = [...Array(1000).keys()]
  const run = ledgerRun(mixed(), all)
  const N = run.res.completion.coverage.completedTicks

  test('这条轴确实含各种写入', () => {
    expect(run.res.completion.status).toBe('completed')
    expect(N).toBeGreaterThanOrEqual(300)
    const kinds = new Set(run.ledger.map(e => e.causeKind))
    expect([...kinds].sort()).toEqual(['break', 'cast', 'cost', 'effect', 'hit', 'hook', 'initial', 'outro', 'sync'])
    expect(run.ledger.some(e => e.phase === 'init' && e.causeKind === 'hook')).toBe(true)
    expect(run.ledger.some(e => e.clippedDelta > 0)).toBe(true)
    expect(run.ledger.some(e => e.clippedDelta < 0)).toBe(true)
    expect(run.ledger.some(e => e.kind === 'change' && e.actualDelta === 0)).toBe(true)
    // 同步关联到那条外部干预记录（静默：没有对应的 resource 事件）
    const synced = run.ledger.find(e => e.causeKind === 'sync')!
    expect(synced).toMatchObject({ kind: 'sync', relatedInterventionIndex: 0 })
    expect(synced.relatedEventSeq).toBeUndefined()
    expect(run.res.interventions[0]).toMatchObject({ kind: 'sync', target: { slot: 0, resource: 'energy' }, firedTriggers: false })
    expectClosed(run)
  })

  test('S[0] … S[completedTicks] 每一个边界：按集合条件取的前缀闭合，长度就是观察点给的账本上界', () => {
    expect([...run.seen.keys()]).toEqual([...Array(N + 1).keys()])
    for (const [f, b] of run.seen) {
      const pre = ledgerPrefixForBoundary(run.ledger, f)
      expect(pre.length, `S[${f}]`).toBe(b.ledgerLength)
      expect(pre).toEqual(run.ledger.slice(0, pre.length))                // 集合条件取出来的正好是一个前缀
      expect(checkLedgerClosure(pre, pre.length, b.state), `S[${f}]`).toEqual([])
      expect(checkLedgerClosure(run.ledger, b.ledgerLength!, b.state), `S[${f}]`).toEqual([])
    }
    expectClosed(run)
  })

  test('与日志的交叉检查通过；checkLog 也通过（两种推法各自成立）', () => {
    expect(crossCheckLedger(run.res.log, run.ledger, ['甲', '乙', '丙'])).toEqual([])
    expect(checkLog(mixed().resolved, run.res)).toEqual([])
    expectClosed(run)
  })

  test('合计：两个口径之间差的就是被截掉的；不按来源过滤时 final = initial + 实际获得 + 实际消耗 + 延奏清零；窗口首尾相接', () => {
    const rows = ledgerTotals(run.ledger)
    expect(rows.map(r => `${r.slot}${r.resource}`)).toEqual([0, 1, 2].flatMap(s => ['energy', 'concerto', 'core1', 'core2', 'core3', 'core4', 'core5'].map(r => `${s}${r}`)))
    for (const r of rows) {
      expect(r.gainRequested - r.gainActual).toBeCloseTo(r.clippedAtCap, 9)
      expect(r.spendRequested - r.spendActual).toBeCloseTo(r.clippedAtZero, 9)
      expect(r.initial + r.gainActual + r.spendActual + r.outroReset + r.synced).toBeCloseTo(r.final, 9)
      const v = run.terminal.chars[r.slot]
      expect(r.final).toBe(r.resource === 'energy' ? v.energy : r.resource === 'concerto' ? v.concerto : v.core[Number(r.resource.slice(4)) - 1])
    }
    for (const clock of ['world', 'battle'] as const) {
      const cut = 100
      const a = ledgerTotals(run.ledger, { clock, toFrame: cut }), b = ledgerTotals(run.ledger, { clock, fromFrame: cut })
      rows.forEach((r, i) => {
        expect(b[i]!.initial).toBe(a[i]!.final)
        expect(a[i]!.initial).toBe(r.initial)
        expect(b[i]!.final).toBe(r.final)
        expect(a[i]!.gainRequested + b[i]!.gainRequested).toBeCloseTo(r.gainRequested, 9)
        expect(a[i]!.clippedAtCap + b[i]!.clippedAtCap).toBeCloseTo(r.clippedAtCap, 9)
      })
    }
    // 只看命中给的：甲的能量是 X 自己命中的 10 与乙 Y 命中分来的 2.5（破盾、同步、扣费不算）；initial / final 仍是实际余额
    const hitOnly = ledgerTotals(run.ledger, { causeKinds: ['hit'] }).find(r => r.slot === 0 && r.resource === 'energy')!
    expect(hitOnly).toMatchObject({ initial: 50, gainRequested: 12.5, gainActual: 12.5, spendRequested: 0, outroReset: 0 })
    expect(hitOnly.final).toBe(rows.find(r => r.slot === 0 && r.resource === 'energy')!.final)
    expectClosed(run)
  })
})

describe('C06-10 终态与 S[completedTicks] 分开（DD-01 C01-9）', () => {
  test('1 帧的动作、结束时钩子加资源：S[N] 的前缀不含那条钩子条目，terminalEndExclusive 含它，两者各自闭合', () => {
    const 豆: SynthChar = {
      name: '甲', actions: [action({ id: 'X', endFrame: 1 })], core: [{ slot: 1, name: '豆', cap: 10 }],
      hooks: { onEvent: (ctx, ev) => { if (ev.type === 'actionEnd' && ev.char === '甲') ctx.addResource('core1', 1) } },
    }
    const run = ledgerRun(preparedSynth([豆, idle('乙'), 丙], { rotation: ['甲 X'] }), [0, 1])
    const N = run.res.completion.coverage.completedTicks
    expect(N).toBe(1)
    const hook = run.ledger.find(e => e.causeKind === 'hook')!
    expect(hook).toMatchObject({ phase: 'post', f: N, actualDelta: 1 })
    const pre = ledgerPrefixForBoundary(run.ledger, N)
    expect(pre).not.toContain(hook)
    expect(pre.length).toBe(run.seen.get(N)!.ledgerLength)
    expect(checkLedgerClosure(pre, pre.length, run.seen.get(N)!.state)).toEqual([])
    expect(run.ledger.slice(0, run.marks.terminalEndExclusive)).toContain(hook)
    expectClosed(run)
    // S[N] 的状态里还没有这 1 点，终态里有
    expect([run.seen.get(N)!.state.chars[0]!.core[0], run.terminal.chars[0].core[0]]).toEqual([0, 1])
  })
})

describe('C06-11 能抓到漏记', () => {
  test('绕过 add 直接改能量（模拟没接进账本的新写入点）：闭合失败并指出角色与资源；相邻条目不变式在下一条能量条目处失败', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 C', '甲 X'], initial: { energy: 'empty' } }, {
      onEvent: (ctx, ev) => { if (ev.type === 'actionStart' && ev.action === 'C') (ctx.state as SimState).chars[0].energy += 5 },
    }))
    const bad = checkLedgerClosure(run.ledger, run.marks.terminalEndExclusive, run.terminal)
    const next = ofChar(run.ledger, 0, 'energy')[0]!                   // X 命中给甲的那一条：before 是 5，不是期初的 0
    expect(bad).toEqual([
      expect.objectContaining({ kind: 'chain', char: '甲', resource: 'energy', between: [0, next.index] }),
      expect.objectContaining({ kind: 'balance', char: '甲', resource: 'energy', expected: run.terminal.chars[0].energy - 5, actual: run.terminal.chars[0].energy }),
    ])
    expect(bad[0]!.message).toContain('甲 的 energy')
  })

  test('反过来：日志记错（hit.gains）时 checkLog 与交叉检查报出来，账本照样闭合', () => {
    // X 命中给协奏 10，之后 W 的起手即得协奏记一条 resource（带变化之后的值），checkLog 拿它对重放
    const p = prepared({ rotation: ['甲 X', '甲 W'], initial: { energy: 'empty' } })
    const run = ledgerRun(p)
    expect(crossCheckLedger(run.res.log, run.ledger, ['甲', '乙', '丙'])).toEqual([])
    expect(checkLog(p.resolved, run.res)).toEqual([])
    const log = structuredClone(run.res.log) as SimEvent[]
    const hit = log.find((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit')!
    hit.gains.concerto += 1
    expect(checkLedgerClosure(run.ledger, run.marks.terminalEndExclusive, run.terminal)).toEqual([])
    expect(crossCheckLedger(log, run.ledger, ['甲', '乙', '丙'])).toEqual([expect.stringContaining('甲 的 concerto')])
    expect(checkLog(p.resolved, { log, summary: run.res.summary })).toEqual([expect.stringContaining('甲 的 concerto')])
  })
})

describe('C06-12 调试表改用账本', () => {
  test('同一场景的资源轨道，给与不给账本：（帧，值）序列相同；不给时 fromLog', () => {
    const p = mixed()
    const run = ledgerRun(p, [], true)
    const res: SimResult = run.res
    const steps = gainSteps(res.log, p.resolved, metaOf(res), undefined, res.interventions)   // 静默的同步只在干预记录里（DD-09 §3.2）
    const fromLog = resourceTracks(steps, p.resolved)
    const fromLedger = resourceTracks(steps, p.resolved, run.ledger)
    expect(fromLog.every(x => x.fromLog === true)).toBe(true)
    expect(fromLedger.every(x => x.fromLog === undefined)).toBe(true)
    expect(fromLedger.map(x => x.tracks)).toEqual(fromLog.map(x => x.tracks))
    expect(run.ledger).toEqual(ledgerRun(mixed()).ledger)                 // 多开 eventMeta 不改账本
    expectClosed(run)
  })

  test('资源逐步表：给了账本，值相同，多出被截的量；整次被截掉的请求也有一行（变化 0）', () => {
    const p = prepared({ rotation: ['甲 C C'], initial: { concerto: [95, 0, 0] } })
    const run = ledgerRun(p, [], true)
    const res = run.res
    const sel = resourceSel(p.resolved, '协奏')
    if (typeof sel === 'string') throw new Error(sel)
    const meta = metaOf(res)
    const old = traceLedger(res.log, gainSteps(res.log, p.resolved, meta), p.resolved, 1, sel, '甲')
    const neu = traceLedger(res.log, gainSteps(res.log, p.resolved, meta, run.ledger), p.resolved, 1, sel, '甲')
    expect(old.map(x => [x.deltas['甲'], x.values['甲'], x.clipped ?? null])).toEqual([[5, 100, null]])
    expect(neu.map(x => [x.deltas['甲'], x.values['甲'], x.clipped ?? null])).toEqual([[5, 100, { 甲: 5 }], [0, 100, { 甲: 10 }]])
    expectClosed(run)
  })

  test('没有事件的写入（满了的钩子）也有一行，排在它之前那条事件后面、不归动作', () => {
    const p = prepared({ rotation: ['甲 C'], initial: { concerto: [100, 0, 0] } }, {
      onEvent: (ctx, ev) => { if (ev.type === 'actionStart' && ev.action === 'C') ctx.addResource('concerto', 3, ctx.self, '满了还给') },
    })
    const run = ledgerRun(p, [], true)
    const res = run.res
    const sel = resourceSel(p.resolved, '协奏')
    if (typeof sel === 'string') throw new Error(sel)
    const rows = traceLedger(res.log, gainSteps(res.log, p.resolved, metaOf(res), run.ledger), p.resolved, 1, sel, '甲')
    expect(rows.map(x => [x.source, x.deltas['甲'], x.values['甲'], x.clipped?.['甲']])).toEqual([
      ['角色钩子：满了还给', 0, 100, 3],                                  // 第 0 帧 C 开始时，没有 resource 事件
      ['命中', 0, 100, 10],                                               // 第 2 帧 c 命中
    ])
    expect(rows[0]!.label).toContain('只在账本里')
    expectClosed(run)
  })
})

describe('C06-13 降级续跑的上界（DD-02 C02-11）', () => {
  const 打甲: SynthChar = { name: '甲', actions: [action({ id: '打', endFrame: 40, cancelWindows: [{ from: 1, until: 40, row: 0 }], judgments: [judgment({ name: '命中', spawnFrame: 20, gains: { energy: 0, concerto: 10, core: [0, 0, 0] } })] })] }
  const QTE乙: SynthChar = { name: '乙', actions: [action({ id: 'QTE', kind: 'intro' }), action({ id: 'Y', endFrame: 20, judgments: [judgment({ name: 'y', spawnFrame: 5, gains: { energy: 5, concerto: 5, core: [0, 0, 0] } })] })] }
  /** 在 markContinuation 那一刻记下状态的收集器（测试用，同零干扰的反向用例） */
  class Snap extends DiagSink {
    snap: LedgerBalances | null = null
    private readonly st: Readonly<SimState>
    constructor(st: Readonly<SimState>) { super({ resourceLedger: true }); this.st = st }
    markContinuation(): void { this.snap ??= balancesOf(this.st); super.markContinuation() }
  }

  test('continuationFromEndExclusive 存在且小于 terminalEndExclusive；用它取的前缀与续跑起点的状态闭合', () => {
    const p = prepareRun(ScenarioSchema.parse({
      team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
      options: { strict: true, tuneBreak: 'off' }, tuneBreakOmitted: { reason: 'deliberate' },
      rotation: ['甲 打', 'switch 乙 变奏', '乙 Y'], initial: { concerto: [89, 0, 0], energy: 'empty' },
    }), synthData([打甲, QTE乙, 丙]), { continueAfterIntentUnmet: true })
    if (!p.ok) throw new Error(JSON.stringify(p.issues))
    const holder: { sink?: Snap } = {}
    const x = runForInspection(p.run, { diag: { resourceLedger: true }, sink: s => (holder.sink = new Snap(s)) })
    const sink = holder.sink!
    const res = x.result!
    expect(res.completion.status).toBe('axisFailed')
    expect(res.completion.diagnosticContinuationFrom).toBeDefined()
    const marks = res.diag!.ledgerMarks!
    const ledger = res.diag!.resourceLedger!
    expect(marks.continuationFromEndExclusive).toBeDefined()
    expect(marks.continuationFromEndExclusive!).toBeLessThan(marks.terminalEndExclusive)
    expect(checkLedgerClosure(ledger, marks.continuationFromEndExclusive!, sink.snap!)).toEqual([])
    expect(sink.snap!.chars[0]!.concerto).toBe(99)                    // 续跑起点：协奏 99，没满
    expect(ledger.slice(marks.continuationFromEndExclusive!).some(e => e.causeKind === 'hit')).toBe(true)   // 续跑之后乙 Y 的命中
    expectClosed({ ledger, marks, terminal: x.terminal })
  })
})

describe('C06-14 丢弃的不记', () => {
  test('动作数据给了角色没有的核心资源槽：有 coreSlot 警告，账本里没有对应条目，闭合成立', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 D D'] }))
    expect(eventsOfLog(run.res.log, 'warning').filter(w => w.code === 'coreSlot')).toHaveLength(1)
    expect(ofChar(run.ledger, 0, 'core2')).toEqual([])
    expect(run.terminal.chars[0].core[1]).toBe(0)
    expectClosed(run)
  })
})

describe('C06-15 诊断开关', () => {
  test('账本在零干扰对拍的"全开"集合里；开关账本前后业务事件、状态、触发次数一致', () => {
    expect(ALL_DIAG.resourceLedger).toBe(true)
    expect(zeroInterference(mixed())).toBeNull()
    expect(zeroInterference(prepared({ rotation: ['甲 C C'], initial: { concerto: [95, 0, 0] } }))).toBeNull()
    // 零干扰对拍比的是整份日志与终态；这里另把 DD-06 C06-15 说的"firing 成功的次数"（buffApply 与 resource 的条数）写明
    const off = runForInspection(mixed()).result!
    const on = ledgerRun(mixed())
    const count = (log: readonly SimEvent[]) => ['buffApply', 'resource'].map(t => log.filter(e => e.type === t).length)
    expect(count(on.res.log)).toEqual(count(off.log))
    expect(count(off.log).every(n => n > 0)).toBe(true)
    expect(off.diag).toBeUndefined()
    expectClosed(on)
  })

  test('账本关着时：诊断里没有账本，观察点的账本上界是 null', () => {
    let len: number | null | undefined
    const x = runForInspection(mixed(), { diag: { eventMeta: true }, observer: { frames: new Set([5]), onBoundary: (_f, _s, _p, l) => { len = l } } })
    expect(x.result!.diag!.resourceLedger).toBeUndefined()
    expect(x.result!.diag!.ledgerMarks).toBeUndefined()
    expect(len).toBeNull()
  })
})

describe('C06-16 DF-07：满格那一次的关联', () => {
  test('钩子给的能量让甲从差 1 点到满：关联到 resource，不是紧跟着的 resourceFull', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 C'], initial: { energy: [99, 0, 0] } }, {
      onEvent: (ctx, ev) => { if (ev.type === 'actionStart' && ev.action === 'C') ctx.addResource('energy', 1) },
    }))
    const [e] = ofChar(run.ledger, 0, 'energy')
    expect(run.res.log[e!.relatedEventSeq!]).toMatchObject({ type: 'resource', cause: 'hook', value: 100 })
    expect(run.res.log[e!.relatedEventSeq! + 1]).toMatchObject({ type: 'resourceFull', char: '甲', resource: 'energy' })
    expectClosed(run)
  })

  test('带治疗的命中让协奏满：关联到 hit，不是之后的 resourceFull 与 heal', () => {
    const run = ledgerRun(prepared({ rotation: ['甲 H'], initial: { concerto: [90, 0, 0] } }))
    const [e] = ofChar(run.ledger, 0, 'concerto')
    const seq = e!.relatedEventSeq!
    expect(run.res.log.slice(seq, seq + 3).map(x => x.type)).toEqual(['hit', 'resourceFull', 'heal'])
    expectClosed(run)
  })
})

dataDescribe('真实场景：终态闭合、与日志的交叉检查、轨道两种推法相同（DD-06 §5 末段）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  const load = (f: string) => ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')))
  test.each(['m0-video-eq.yaml', 'xin-team.yaml'])('%s', f => {
    const p = prepareRun(load(f), gd)
    if (!p.ok) throw new Error(p.issues.map(i => i.message).join('\n'))
    // 每个 S[f] 都记下资源与账本上界（只拷几个数）；闭合按样本查：每 37 帧一个，加上最后一个 S[completedTicks]
    const seen: { f: number; state: LedgerBalances; ledgerLength: number | null }[] = []
    const x = runForInspection(p.run, {
      diag: { eventMeta: true, resourceLedger: true },
      observer: { frames: new Set(Array.from({ length: p.run.resolved.options.maxFrames + 1 }, (_, i) => i)), onBoundary: (fr, s, _p, ledgerLength) => { seen.push({ f: fr, state: balancesOf(s), ledgerLength }) } },
    })
    const res = x.result!
    expect(res.completion.status).toBe('completed')
    const ledger = res.diag!.resourceLedger!
    expect(seen.at(-1)!.f).toBe(res.completion.coverage.completedTicks)
    for (const b of seen.filter((b, i) => b.f % 37 === 0 || i === seen.length - 1)) {
      const pre = ledgerPrefixForBoundary(ledger, b.f)
      expect(pre.length, `S[${b.f}]`).toBe(b.ledgerLength)
      expect(checkLedgerClosure(ledger, b.ledgerLength!, b.state), `S[${b.f}]`).toEqual([])
    }
    expect(checkLedgerClosure(ledger, res.diag!.ledgerMarks!.terminalEndExclusive, x.terminal)).toEqual([])
    expect(crossCheckLedger(res.log, ledger, x.terminal.chars.map(c => c.name))).toEqual([])
    const steps = gainSteps(res.log, p.run.resolved, metaOf(res))
    expect(resourceTracks(steps, p.run.resolved, ledger).map(t => t.tracks)).toEqual(resourceTracks(steps, p.run.resolved).map(t => t.tracks))
  }, 60_000)
})
