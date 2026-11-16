// tests/event-origin.test.ts —— 事件的直接来源与实体来源（DD-05 §3.2、§3.3、§8）：C05-5、C05-6、C05-7、C05-12、C05-13。
// 合成场景用 helpers/diag-team 的主轴（不依赖 data/generated）；代表场景 m0-video-eq.yaml 缺数据时跳过。
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData, TuneBreakTable } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import type { Diagnostics, EventMeta, OriginContext } from '../src/engine/diagnostics'
import { prepareRun, runPrepared } from '../src/engine/run'
import type { SimEvent, SimResult } from '../src/engine/types'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { diagBase, diagTeam, preparedSynth } from './helpers/diag-team'
import { idle, synthData, type SynthChar } from './helpers/synth'

const withMeta = (res: SimResult): { log: readonly SimEvent[]; meta: readonly EventMeta[]; diag: Diagnostics } =>
  ({ log: res.log, meta: res.diag!.eventMeta!, diag: res.diag! })

/** 每种事件写在哪些来源里是合理的（C05-5）。hit 只在判定结算里写，异常效应自身的伤害另有定时结算与钩子主动触发两种 */
const ALLOWED: Record<SimEvent['type'], readonly OriginContext['kind'][]> = {
  actionStart: ['command', 'autoInterject', 'judgmentSettle'],
  actionEnd: ['actionLifecycle'],
  actionCancel: ['command', 'autoInterject', 'judgmentSettle'],
  judgmentSpawn: ['timeline', 'trigger', 'judgmentSettle', 'judgmentExpire', 'init'],
  hit: ['judgmentSettle', 'timer', 'trigger'],
  switch: ['command'],
  intro: ['command'],
  outro: ['timeline'],
  buffApply: ['init', 'command', 'trigger', 'judgmentSettle'],
  buffExpire: ['timer', 'command', 'trigger', 'judgmentSettle'],
  resource: ['command', 'actionLifecycle', 'timeline', 'trigger', 'judgmentSettle', 'init'],
  resourceFull: ['command', 'actionLifecycle', 'timeline', 'trigger', 'judgmentSettle', 'init'],
  heal: ['judgmentSettle', 'trigger', 'init'],
  shield: ['judgmentSettle', 'trigger', 'init'],
  enemyState: ['command', 'judgmentSettle', 'trigger', 'timer'],
  effectTick: ['timer', 'judgmentSettle', 'trigger'],
  wait: ['command', 'finalization'],
  skip: ['command'],
  loop: ['command'],
  warning: ['command', 'autoInterject', 'actionLifecycle', 'timeline', 'judgmentSettle', 'judgmentExpire', 'timer', 'trigger', 'finalization', 'init'],
}

/** C05-5、C05-6 的断言：一一对应、没有 unattributed、来源种类合理；每个（非异常效应的）hit 都能回到它的 judgmentSpawn */
function checkOrigins(log: readonly SimEvent[], meta: readonly EventMeta[], diag: Diagnostics): void {
  expect(meta.length).toBe(log.length)
  expect(meta.filter(m => m.origin.kind === 'unattributed')).toEqual([])
  const odd = log.flatMap((e, i) => {
    const kind = meta[i]!.origin.kind
    if (!ALLOWED[e.type].includes(kind)) return [`第 ${i} 条 ${e.type} 的来源是 ${kind}`]
    if (e.type === 'hit' && kind !== 'judgmentSettle' && !e.effect) return [`第 ${i} 条 hit 不是异常效应，却不在判定结算里（${kind}）`]
    return []
  })
  expect(odd).toEqual([])
  // 直接父事件与说的实体都是更早写的事件
  meta.forEach((m, i) => {
    if (m.directParentSeq !== undefined) expect(m.directParentSeq).toBeLessThan(i)
    if (m.subjectSeq !== undefined) expect(m.subjectSeq).toBeLessThan(i)
  })
  const judgments = new Map(diag.entityOrigins!.judgments.map(j => [j.id, j]))
  const lost = log.flatMap((e, i) => {
    if (e.type !== 'hit' || e.effect) return []
    const j = judgments.get(e.id)
    const by = j?.createdBySeq ?? null
    const ok = j !== undefined && by !== null && log[by]?.type === 'judgmentSpawn' && (log[by] as Extract<SimEvent, { type: 'judgmentSpawn' }>).id === e.id
    return ok && meta[i]!.subjectSeq === by ? [] : [`第 ${i} 条 hit（${e.char} ${e.judgment}，id ${e.id}）回不到它的 judgmentSpawn`]
  })
  expect(lost).toEqual([])
}

/** 沿"直接父事件，没有就沿说的实体"往上走（DD-05 §3.3 的解释规则），返回经过的事件下标与每一步走的是哪种关系 */
function walk(meta: readonly EventMeta[], from: number): { seq: number; via: 'parent' | 'subject' | null }[] {
  const out: { seq: number; via: 'parent' | 'subject' | null }[] = [{ seq: from, via: null }]
  for (let i = from; ;) {
    const m = meta[i]!
    if (m.directParentSeq !== undefined) { i = m.directParentSeq; out.push({ seq: i, via: 'parent' }) }
    else if (m.subjectSeq !== undefined) { i = m.subjectSeq; out.push({ seq: i, via: 'subject' }) }
    else return out
  }
}

describe('合成主轴（helpers/diag-team）', () => {
  const res = runPrepared(diagBase(), { diag: { eventMeta: true } })
  const { log, meta, diag } = withMeta(res)
  const at = (pred: (e: SimEvent) => boolean) => log.findIndex(pred)

  test('前提：跑完了，轴里的几样都出现了', () => {
    expect(res.completion.status).toBe('completed')
    expect(log.filter(e => e.type === 'actionCancel').map(e => (e as { action: string }).action)).toEqual(['X'])
    expect(log.some(e => e.type === 'outro')).toBe(true)
    // o 是延奏尾部第 81 帧的；z 要等 QTE 结束（第 96 帧）才开始
    expect(log.filter(e => e.type === 'hit').map(e => (e as { judgment: string }).judgment)).toEqual(['a', 'c', 'y', 'b', 'q', 'o', 'z', '召唤物'])
  })

  test('C05-5、C05-6：一一对应，没有 unattributed，来源种类合理，hit 都回得到 judgmentSpawn', () => {
    checkOrigins(log, meta, diag)
  })

  test('C05-7：被取消的动作留下的尾部——hit 沿 subjectSeq 回到 judgmentSpawn → actionCancel → A 的 actionStart（指令 A）；取消的发起方是指令 B', () => {
    const hit = at(e => e.type === 'hit' && e.judgment === 'b')
    const chain = walk(meta, hit)
    expect(chain.map(x => [log[x.seq]!.type, x.via])).toEqual([
      ['hit', null], ['judgmentSpawn', 'subject'], ['actionCancel', 'subject'], ['actionStart', 'subject'],
    ])
    const cancel = chain[2]!.seq, startA = chain[3]!.seq
    expect(meta[startA]!.origin).toEqual({ kind: 'command', cmd: { line: 1, item: 1, loop: 1 } })   // 被取消的 A 是指令 1 开始的
    expect(meta[cancel]!.origin).toEqual({ kind: 'command', cmd: { line: 2, item: 1, loop: 1 } })   // 发起取消的是指令 2（B）
    expect(meta[chain[1]!.seq]!.origin).toMatchObject({ kind: 'timeline', detached: true })         // 尾部的时间线节点
    const tail = diag.entityOrigins!.tails.find(t => t.createdBySeq === cancel)
    expect(tail?.origin).toEqual({ kind: 'command', cmd: { line: 2, item: 1, loop: 1 } })
  })

  test('C05-7：延奏动作的尾部——hit 回到 outro → 变奏动作的 actionStart → 那条 switch（切人指令）', () => {
    const hit = at(e => e.type === 'hit' && e.judgment === 'o')
    const chain = walk(meta, hit)
    expect(chain.map(x => [log[x.seq]!.type, x.via])).toEqual([
      ['hit', null], ['judgmentSpawn', 'subject'], ['outro', 'subject'], ['actionStart', 'subject'], ['switch', 'parent'],
    ])
    expect(meta[chain.at(-1)!.seq]!.origin).toEqual({ kind: 'command', cmd: { line: 4, item: 1, loop: 1 } })
    // 延奏动作开始时的施放资源（这里没有）之外，outro 写在变奏动作时间线的节点里
    expect(meta[chain[2]!.seq]!.origin).toMatchObject({ kind: 'timeline' })
  })

  test('钩子在 onEvent 里生成的判定落在 charHook 作用域：直接父事件是触发它的那次命中', () => {
    const spawnC = at(e => e.type === 'judgmentSpawn' && e.judgment === 'c')
    const hitA = at(e => e.type === 'hit' && e.judgment === 'a')
    expect(meta[spawnC]!.origin).toEqual({ kind: 'trigger', directParentSeq: hitA, handlerKind: 'charHook', handlerId: '甲' })
    expect(meta[spawnC]!.directParentSeq).toBe(hitA)
  })

  test('C05-12：召唤类声骸的尾部，createdBySeq 指向它自己的 actionStart（不是更早的事件）', () => {
    const start = at(e => e.type === 'actionStart' && e.action === '声骸')
    const instance = (log[start] as Extract<SimEvent, { type: 'actionStart' }>).instance
    const tails = diag.entityOrigins!.tails.filter(t => t.createdBySeq === start)
    expect(tails).toHaveLength(1)
    expect(tails[0]!.id).not.toBe(instance)                       // 召唤物的实例号另取
    expect(tails[0]!.origin).toEqual({ kind: 'command', cmd: { line: 6, item: 1, loop: 1 } })
    const hit = at(e => e.type === 'hit' && e.judgment === '召唤物')
    expect(walk(meta, hit).map(x => log[x.seq]!.type)).toEqual(['hit', 'judgmentSpawn', 'actionStart'])
  })

  test('C05-13：变奏切人——切走即移除的 buffExpire、挂起 buff 的 buffApply、变奏动作的 actionStart、intro 的直接父事件都是那条 switch', () => {
    const sw = at(e => e.type === 'switch')
    const sub = (pred: (e: SimEvent) => boolean) => { const i = log.findIndex((e, j) => j > sw && pred(e)); expect(i).toBeGreaterThan(sw); return i }
    const expire = sub(e => e.type === 'buffExpire' && e.buff === '甲.切走即清' && e.reason === 'switchOut')
    const apply = sub(e => e.type === 'buffApply' && e.buff === '甲.下一位' && e.target === '乙')
    const qte = sub(e => e.type === 'actionStart' && e.action === 'QTE')
    const intro = sub(e => e.type === 'intro')
    expect([expire, apply, qte, intro].map(i => meta[i]!.directParentSeq)).toEqual([sw, sw, sw, sw])
    expect([expire, apply, qte, intro].map(i => meta[i]!.origin.kind)).toEqual(['command', 'command', 'command', 'command'])
    expect(meta[sw]!.directParentSeq).toBeUndefined()
    // 切出者那条 buff 说的实体是它第一次挂上的那条 buffApply
    const first = log.findIndex(e => e.type === 'buffApply' && e.buff === '甲.切走即清')
    expect(meta[expire]!.subjectSeq).toBe(first)
  })

  test('同帧多个到期：两条 buffExpire 各自一个 timer 作用域，钩子写的资源各指各的', () => {
    const e1 = at(e => e.type === 'buffExpire' && e.buff === '甲.一')
    const e2 = at(e => e.type === 'buffExpire' && e.buff === '甲.二')
    const r1 = at(e => e.type === 'resource' && e.resource === 'core1')
    const r2 = at(e => e.type === 'resource' && e.resource === 'concerto' && e.cause === 'hook')
    expect([log[e1]!.f, log[e2]!.f, e2]).toEqual([19, 19, e1 + 1])
    expect([meta[r1]!.directParentSeq, meta[r2]!.directParentSeq]).toEqual([e1, e2])
  })
})

describe('C05-12：自动谐度破坏先等待、随后放出', () => {
  // 甲 U 优先级 12、第 5 帧打满偏谐值：失谐后谐度破坏（优先级 11）要插队，先等 U 结束（第 40 帧）；插队分支关等待段写的 wait 落在指令 2 的作用域里
  const TABLE: TuneBreakTable = {
    variants: [], baseByLevel: Array.from({ length: 100 }, (_, i) => (i === 89 ? 10000 : 0)), costFactor: { 1: 1, 3: 1, 4: 1 },
    rules: { lockFrames: { 1: 360, 3: 360, 4: 180 }, buttonFrames: 180 },
  }
  const 甲: SynthChar = {
    name: '甲',
    actions: [
      action({ id: 'U', kind: 'skill', endFrame: 40, priority: [{ fromFrame: 0, value: 12 }], judgments: [judgment({ name: 'u', spawnFrame: 5, gauges: { toughness: 0, tunability: 100 } })] }),
      action({ id: 'X', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 2 })] }),
      action({ id: '谐度破坏', kind: 'tuneBreak', endFrame: 30, priority: [{ fromFrame: 0, value: 11 }], judgments: [judgment({ name: '谐度破坏-1', spawnFrame: 10, multiplier: 1, tags: ['谐度破坏'] })] }),
    ],
  }
  const data = synthData([甲, idle('乙'), idle('丙')])
  data.tuneBreak = TABLE
  data.characters['甲']!.tunabilityRate = 1
  const p = preparedSynth([甲, idle('乙'), idle('丙')], { rotation: ['甲 U', '甲 X'], enemy: { custom: { level: 90, tunabilityMax: 100 } } }, {}, data)
  const res = runPrepared(p, { diag: { eventMeta: true } })
  const { log, meta } = withMeta(res)

  test('谐度破坏是插队放的（不带指令出处），之前等了 U', () => {
    const starts = log.filter((e): e is Extract<SimEvent, { type: 'actionStart' }> => e.type === 'actionStart').map(e => [e.action, e.cmd?.line ?? null, e.f])
    expect(starts).toEqual([['U', 1, 0], ['谐度破坏', null, 40], ['X', 2, 70]])
  })

  test('插队分支写出的 wait 的来源是 command（指令 2），不是 unattributed；谐度破坏的 actionStart 来源是 autoInterject', () => {
    // 插队分支先关等待段（写 wait）再开始谐度破坏：那条 wait 紧挨在谐度破坏的 actionStart 前面。等的原因代码与 X 先前等的相同（priority），
    // 所以是同一段，从第 1 帧起（DF-06）
    const tb = log.findIndex(e => e.type === 'actionStart' && e.action === '谐度破坏')
    const w = tb - 1
    expect(log[w]).toMatchObject({ type: 'wait', code: 'priority', f: 40 })
    expect(meta[w]!.origin).toEqual({ kind: 'command', cmd: { line: 2, item: 1, loop: 1 } })
    expect(meta[tb]!.origin).toEqual({ kind: 'autoInterject', slot: 0, action: '谐度破坏' })
    checkOrigins(log, meta, res.diag!)
  })
})

describe('截断、失败收尾与帧数上限的警告（S-05 的 finalization）', () => {
  test('到帧数上限时指令没发完：失败收尾写的 wait 来源是 finalization failClose，相位 post', () => {
    const res = runPrepared(diagBase({}, { options: { maxFrames: 50 } }), { diag: { eventMeta: true } })
    const { log, meta } = withMeta(res)
    const last = log.length - 1
    expect(log[last]!.type).toBe('wait')
    expect([meta[last]!.origin, meta[last]!.phase]).toEqual([{ kind: 'finalization', step: 'failClose' }, 'post'])
    expect(meta.filter(m => m.origin.kind === 'unattributed')).toEqual([])
  })

  test('轴失败（等超时）：失败收尾的 wait 在 P2', () => {
    const p = preparedSynth(diagTeam(), { rotation: ['甲 W', '甲 W'], options: { maxWait: 100 } })
    const res = runPrepared(p, { diag: { eventMeta: true } })
    const { log, meta } = withMeta(res)
    expect(res.completion.status).toBe('axisFailed')
    const last = log.length - 1
    expect([log[last]!.type, meta[last]!.origin, meta[last]!.phase]).toEqual(['wait', { kind: 'finalization', step: 'failClose' }, 'P2'])
  })

  test('钩子抛错：没关的作用域由 finish 从内到外收尾，没有 unattributed', () => {
    const res = runPrepared(diagBase({ throwOn: 'y' }), { diag: { eventMeta: true } })
    expect(res.completion.status).toBe('engineError')
    const { log, meta } = withMeta(res)
    expect(meta.length).toBe(log.length)
    expect(meta.filter(m => m.origin.kind === 'unattributed')).toEqual([])
  })
})

dataDescribe('代表场景 m0-video-eq.yaml（C05-5、C05-6）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  test('一一对应，没有 unattributed，来源种类合理，hit 都回得到 judgmentSpawn', () => {
    const sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-video-eq.yaml', import.meta.url), 'utf8')))
    const p = prepareRun(sc, gd)
    if (!p.ok) throw new Error(p.issues.map(i => i.message).join('\n'))
    const res = runPrepared(p.run, { diag: { eventMeta: true } })
    const { log, meta, diag } = withMeta(res)
    expect(res.completion.status).toBe('completed')
    checkOrigins(log, meta, diag)
  }, 60_000)
})
