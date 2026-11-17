// tests/fit-eligibility.test.ts —— 贴合度的匹配、资格与排序（DD-09 §4、§7：C09-6、C09-8～C09-17、C09-19～C09-23；架构 §10.3 的四种情形）。
// 人造角色，不依赖 data/generated。
import { describe, expect, test } from 'vitest'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import {
  commonSubset, comparableReports, fitCombos, fitVariants, groupRows, replayFit, reportIdentity, scoreDefOf,
  type FitResult, type FitRow,
} from '../src/analysis/fit'
import { alignSequences, frozenSwitches, videoObservations, type VideoObservation } from '../src/analysis/observations'
import { prepareRun, runPrepared } from '../src/engine/run'
import type { CharacterHooks, SimResult } from '../src/engine/types'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

// 甲：A 普攻 10 帧（第 5 帧命中 a）、E 技能 20 帧（第 5 帧命中 e）、R 大招 20 帧、Z 抛错用；乙：Y 10 帧
const team = (hooks?: CharacterHooks): [SynthChar, SynthChar, SynthChar] => [{
  name: '甲',
  actions: [
    action({ id: 'A', kind: 'normal', endFrame: 10, judgments: [judgment({ name: 'a', spawnFrame: 5, multiplier: 1 })] }),
    action({ id: 'E', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'e', spawnFrame: 5, multiplier: 2 })] }),
    action({ id: 'R', kind: 'liberation', endFrame: 20 }),
    action({ id: 'Z', kind: 'skill', endFrame: 20 }),
  ],
  ...(hooks ? { hooks } : {}),
}, { name: '乙', actions: [action({ id: 'Y', kind: 'normal', endFrame: 10 })] }, idle('丙')]

const scenario = (rotation: string[], video: Record<string, unknown>, extra: Partial<ScenarioInput> = {}) => ScenarioSchema.parse({
  team: team().map(c => ({ char: c.name, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
  purpose: 'replay', rotation, video: { loop: 1, ...video }, ...extra,
})
/** 跑一份场景，按给定的观测与评分定义算贴合度（缺省按场景自己的 video） */
function fitOf(sc: ReturnType<typeof scenario>, opts: { observations?: readonly VideoObservation[]; ids?: string[]; hooks?: CharacterHooks } = {}): { fit: FitResult; res: SimResult } {
  const p = prepareRun(sc, synthData(team(opts.hooks)))
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('\n'))
  const res = runPrepared(p.run)
  const obs = opts.observations ?? videoObservations(sc.video!, sc.video!.switches?.length ? [] : frozenSwitches(p.run.resolved, sc.video!))
  const def = scoreDefOf(obs, opts.ids ? { scoreObservationIds: opts.ids } : {})
  return { fit: replayFit(p.run.resolved, res, sc.video!, { observations: obs, scoreDef: def }), res }
}
const row = (desc: string, fit: FitResult, kind: FitRow['kind'] = 'axis'): FitRow => ({ desc, kind, fit })
const status = (f: FitResult, id: string) => f.observations.find(o => o.id === id)!.status

// 世界秒 = 视频秒：第 1 条（甲 A，第 0 帧）的锚点是视频 0 秒
const MARKS = { marks: { '1': 0 } }

describe('一对一、保序的匹配（DD-09 §4.2，DF-18）', () => {
  const key = (os: string[], es: string[], window = 10) => (ot: number[], et: number[]) =>
    (i: number, j: number) => os[i] === es[j] && Math.abs(et[j]! - ot[i]!) <= window

  test('C09-9 录像两条同名动作隔 1 秒、仿真只有一下落在中间：只配上一条，另一条落单；配上的那条可能落单', () => {
    const ot = [0, 1], et = [0.5]
    const a = alignSequences(ot, et, key(['E', 'E'], ['E'])(ot, et))
    expect(a.count).toBe(1)
    expect(a.pairs.filter(p => p !== null)).toEqual([0])
    expect(a.alternatives.every(x => x === null)).toBe(true)
    const matched = a.pairs.findIndex(p => p !== null)
    expect(a.mayBeUnmatched[matched]).toBe(true)
    // 经 replayFit：一条 matched、一条 unmatched，不会两条都配同一下
    const sc = scenario(['甲 A', 'at 0.5', '甲 E'], { ...MARKS, events: ['0 甲 E', '1 甲 E'] })
    const { fit } = fitOf(sc)
    expect(['action#1', 'action#2'].map(id => status(fit, id)).sort()).toEqual(['matched', 'unmatched'])
  })

  test('C09-10 一条观测、两下同名动作离它几乎一样近（两种对齐都合法、对数相同）：ambiguous，候选两个', () => {
    const ot = [1.0], et = [0.9, 1.12]
    const a = alignSequences(ot, et, key(['E'], ['E', 'E'])(ot, et))
    expect(a.count).toBe(1)
    expect(a.alternatives[0]).toEqual([0, 1])
    const sc = scenario(['甲 A', 'at 0.9', '甲 E', 'at 1.12', '甲 E'], { ...MARKS, events: ['1.0 甲 E'] })
    const { fit } = fitOf(sc)
    const o = fit.observations.find(x => x.id === 'action#1')!
    expect(o.status).toBe('ambiguous')
    expect(o.candidates).toHaveLength(2)
  })

  test('C09-19 录像同一角色先 E（10 秒）后 R（11 秒），仿真先 R（10 秒）后 E（11 秒）：只配上一对', () => {
    const ot = [10, 11], et = [10, 11]
    const a = alignSequences(ot, et, key(['E', 'R'], ['R', 'E'])(ot, et))
    expect(a.count).toBe(1)
    expect(a.pairs.filter(p => p === null)).toHaveLength(1)
    const sc = scenario(['甲 A', 'at 10', '甲 R', 'at 11', '甲 E'], { ...MARKS, events: ['10 甲 E', '11 甲 R'] })
    const { fit } = fitOf(sc)
    expect(['action#1', 'action#2'].map(id => status(fit, id)).sort()).toEqual(['matched', 'unmatched'])
  })

  test('C09-20 两条观测与两条仿真事件分别在 0、0.1 秒，唯一的满配对齐：都 matched，不因为邻居在 0.25 秒内就标歧义', () => {
    const ot = [0, 0.1], et = [0, 0.1]
    const a = alignSequences(ot, et, key(['E', 'E'], ['E', 'E'])(ot, et))
    expect(a.pairs).toEqual([0, 1])
    expect(a.alternatives).toEqual([null, null])
  })

  test('C09-23 三条观测在 0、0.1、0.2 秒，两条仿真事件在 0.1、0.2 秒：O1 是 ambiguous，候选含 E0 与 E1；C09-20 的唯一满配仍无歧义', () => {
    const ot = [0, 0.1, 0.2], et = [0.1, 0.2]
    const a = alignSequences(ot, et, key(['E', 'E', 'E'], ['E', 'E'])(ot, et))
    expect(a.count).toBe(2)
    expect(a.cost).toBeCloseTo(0, 9)
    expect(a.pairs).toEqual([null, 0, 1])
    expect(a.alternatives[1]).toEqual([0, 1])
    expect(a.alternatives[2]).toBeNull()                         // O2 强制配 E0 会少配一对，不算歧义
    expect(a.mayBeUnmatched[2]).toBe(true)                      // O0→E0、O1→E1 同样配两对、只多 0.2 秒
  })

  test('匹配有歧义、可配的每一下都与录像的跳字定性冲突：是 conflicted（进资格、最早偏差），不藏在 ambiguous 里；都对得上时仍是 ambiguous（DD-09 §4.2；Codex 审查 F8）', () => {
    // 两下 e 在第 41、61 帧（第二个 E 等第一个放完），录像跳字记在两者正中间：两种配法一样好，是歧义
    const rotation = ['甲 A', 'at 0.6', '甲 E', '甲 E']
    const bad = fitOf(scenario(rotation, { ...MARKS, hits: ['0.85 甲 e 999999 nonCrit'] })).fit
    const o = bad.observations.find(x => x.id === 'hit#1')!
    expect(o).toMatchObject({ status: 'conflicted', conflict: expect.stringContaining('2 个可配的仿真事件都冲突') })
    expect(o.candidates).toHaveLength(2)
    expect(bad.eligibility.hasQualitativeConflict).toBe(true)
    expect(bad.earliestDeviation).toMatchObject({ observationId: 'hit#1' })
    // 读数就是仿真的那个值：两下都对得上，分不清配哪一下——ambiguous，没有冲突
    const { res } = fitOf(scenario(rotation, MARKS))
    const value = res.log.find((e): e is Extract<typeof e, { type: 'hit' }> => e.type === 'hit' && e.judgment === 'e')!.dmg!.nonCrit
    const good = fitOf(scenario(rotation, { ...MARKS, hits: [`0.85 甲 e ${value} nonCrit`] })).fit
    expect(good.observations.find(x => x.id === 'hit#1')).toMatchObject({ status: 'ambiguous' })
    expect(good.eligibility.hasQualitativeConflict).toBe(false)
  })

  test('评分集合只能放评分用的观测：显式子集、直接传评分定义放进 !given、!display 的都拒绝（DD-09 §3.2、§4.4；Codex 审查 F9）', () => {
    const sc = scenario(['甲 A'], { ...MARKS, events: ['0 甲 A', '0.5 甲 @e !display'], hp: ['0 1', '1 0.9 !given'] })
    const obs = videoObservations(sc.video!)
    expect(() => scoreDefOf(obs, { scoreObservationIds: ['action#1', 'hp#2'] })).toThrow(/hp#2（!given）/)
    expect(() => scoreDefOf(obs, { scoreObservationIds: ['summon#2'] })).toThrow(/summon#2（!display）/)
    // 绕过 scoreDefOf、直接拼一份评分定义传给 replayFit：同样拒绝
    const p = prepareRun(sc, synthData(team()))
    if (!p.ok) throw new Error('prepare')
    const def = { ...scoreDefOf(obs), scoreObservationIds: ['action#1', 'hp#2'] }
    expect(() => replayFit(p.run.resolved, runPrepared(p.run), sc.video!, { observations: obs, scoreDef: def })).toThrow(/!given/)
  })

  test('C09-21 后台召唤与前台动作交错：两个通道各自匹配，召唤不受前台顺序约束', () => {
    // 仿真：A 第 0 帧、E 第 60 帧（它的判定 e 第 65 帧生成）。录像把 e 记早了（0.6 秒，在 E 之前）：放进同一列会和 E 交叉
    const sc = scenario(['甲 A', 'at 1.0', '甲 E'], { ...MARKS, events: ['0 甲 A', '1.0 甲 E', '0.6 甲 @e'] })
    const { fit } = fitOf(sc)
    expect(fit.observations.map(o => [o.id, o.status])).toEqual([['action#1', 'matched'], ['action#2', 'matched'], ['summon#3', 'matched']])
    expect(fit.observations.find(o => o.id === 'summon#3')!.residual).toBeCloseTo(65 / 60 - 0.6, 6)
    // 同样的四个时刻放进一列，只能配两对
    const a = alignSequences([0, 0.6, 1.0], [0, 1.0, 65 / 60], (i, j) => ['A', 'e', 'E'][i] === ['A', 'E', 'e'][j])
    expect(a.count).toBe(2)
  })
})

describe('观测的 ID 与通道（DD-09 §4.1；C09-8）', () => {
  test('ID = 通道 + 在原场景列表里的位置；行末 !given / !display 是用途', () => {
    const obs = videoObservations(scenario(['甲 A'], {
      ...MARKS, switches: ['1.0 甲→乙 intro', '2.0 乙->甲'], events: ['0 甲 A', '0.5 甲 @e !display'], hits: ['0.08 甲 a 1000 crit'],
      hp: ['0 1', '1 0.9 !given'], concerto: ['1 甲 0.5'], core: ['1 甲 某 0.5 !display'],
    }).video!)
    expect(obs.map(o => [o.id, o.channel, o.purpose])).toEqual([
      ['switch#1', 'switch', 'score'], ['switch#2', 'switch', 'score'], ['action#1', 'action', 'score'], ['summon#2', 'summon', 'display'],
      ['hit#1', 'hit', 'score'], ['hp#1', 'hp', 'score'], ['hp#2', 'hp', 'given'], ['concerto#1', 'concerto', 'score'], ['core#1', 'core', 'display'],
    ])
    expect(obs[0]).toMatchObject({ from: '甲', to: '乙', type: 'intro', reference: 'video' })
    expect(obs[1]).toMatchObject({ type: null })
    expect(scoreDefOf(obs).scoreObservationIds).toEqual(['switch#1', 'switch#2', 'action#1', 'hit#1', 'hp#1', 'concerto#1'])
  })

  test('C09-8 对同一场景生成删掉一个动作的变体：变体里各观测的 ID 与原场景相同；空出来的行留成空行，锚点照旧指得对', () => {
    const sc = scenario(['甲 A', 'at 1.0', '甲 E', 'at 2.0', '甲 R'], { ...MARKS, events: ['1.0 甲 E', '2.0 甲 R'] })
    const rep = fitVariants(sc, synthData(team()), { n: 20, rules: false })
    const ids = rep.base.observations.map(o => o.id)
    const rows = [...rep.axisVariants.groups.flatMap(g => g.rows), ...rep.axisVariants.unassessable]
    expect(rows.some(x => x.desc.startsWith('去掉 甲 E'))).toBe(true)
    for (const x of rows) expect(x.fit!.observations.map(o => o.id)).toEqual(ids)
    const drop = rows.find(x => x.desc.startsWith('去掉 甲 E'))!.fit!
    expect(drop.anchors).toBe(1)                                // 第 1 条的锚点还在
    expect(status(drop, 'action#1')).toBe('unmatched')
  })
})

describe('资格与排序（DD-09 §4.4；架构 §10.3 的四种情形，第四种是最后的"不可评估"）', () => {
  test('C09-11 情形一：A 只匹配 O1、B 只匹配 O2：签名不同，不在同一组，没有先后', () => {
    const video = { ...MARKS, events: ['1.0 甲 E', '3.0 甲 R'] }
    const A = fitOf(scenario(['甲 A', 'at 1.0', '甲 E'], video)).fit
    const B = fitOf(scenario(['甲 A', 'at 3.0', '甲 R'], video)).fit
    expect(A.eligibility.matchedScoreIds).toEqual(['action#1'])
    expect(B.eligibility.matchedScoreIds).toEqual(['action#2'])
    expect(A.eligibility.signature).not.toBe(B.eligibility.signature)
    const t = groupRows(row('A', A, 'base'), [row('B', B)])
    expect(t.groups).toHaveLength(2)
    expect(t.groups.map(g => g.rows.length)).toEqual([1, 1])
    expect(t.groups[1]!.versusBase).toEqual({ moreMatched: ['action#2'], lessMatched: ['action#1'], conflicts: [] })
  })

  test('C09-12 情形二：A 全覆盖但一处切人类型冲突；B 删掉那次切人：B 不排在 A 前面；--common-subset 才比共有子集并列出各自被排除的', () => {
    const video = { ...MARKS, switches: ['1.0 甲→乙 intro'], events: ['0.5 甲 E'] }
    const A = fitOf(scenario(['甲 A', 'at 0.5', '甲 E', 'at 1.0', 'switch 乙'], video)).fit
    const B = fitOf(scenario(['甲 A', 'at 0.5', '甲 E', 'at 2.0', '甲 A'], video)).fit
    expect(status(A, 'switch#1')).toBe('conflicted')
    expect(A.observations.find(o => o.id === 'switch#1')!.conflict).toBe('switchType: 录像 intro，仿真 normal')
    expect(A.eligibility.hasQualitativeConflict).toBe(true)
    expect(status(B, 'switch#1')).toBe('unmatched')
    expect(B.eligibility.hasQualitativeConflict).toBe(false)
    expect(A.eligibility.signature).not.toBe(B.eligibility.signature)
    const t = groupRows(row('A', A, 'base'), [row('B', B)])
    expect(t.groups.find(g => g.rows.some(x => x.desc === 'A'))!.rows.map(x => x.desc)).toEqual(['A'])
    const def = scoreDefOf(videoObservations(scenario(['甲 A'], video).video!))
    const c = commonSubset(A, B, def)
    expect(c).toMatchObject({ ids: ['action#1'], excludedA: [], excludedB: [], note: '只比共有子集，不是整体更贴合' })
    expect(c.scoreA).toBeCloseTo(c.scoreB, 9)
  })

  test('C09-13 情形三：O0 必需、O1 可有可无；A 两条都匹配（残差 0 与 9 秒），B 只匹配 O0：放进评分集合则签名不同；不放进则两者 score 相同', () => {
    const video = { ...MARKS, events: ['1.0 甲 E', '10.0 甲 R'] }
    const scA = scenario(['甲 A', 'at 1.0', '甲 E', 'at 19.0', '甲 R'], video)
    const scB = scenario(['甲 A', 'at 1.0', '甲 E'], video)
    // O1 在评分集合里：B 少匹配一条，签名不同（DD-03 之前"删掉动作从 9 分变 5 分"的反例在这里关掉）
    const A1 = fitOf(scA).fit, B1 = fitOf(scB).fit
    expect(A1.observations.find(o => o.id === 'action#2')).toMatchObject({ status: 'matched', residual: expect.closeTo(9, 6) })
    expect(B1.eligibility.matchedScoreIds).toEqual(['action#1'])
    expect(A1.eligibility.signature).not.toBe(B1.eligibility.signature)
    expect(groupRows(row('A', A1, 'base'), [row('B', B1)]).groups).toHaveLength(2)
    // O1 不在评分集合里：A 的 9 秒不计，两者 score 相同（都是 0），同一组
    const A2 = fitOf(scA, { ids: ['action#1'] }).fit, B2 = fitOf(scB, { ids: ['action#1'] }).fit
    expect(A2.eligibility.signature).toBe(B2.eligibility.signature)
    expect(A2.score).toBeCloseTo(0, 9)
    expect(B2.score).toBeCloseTo(A2.score!, 9)
    const g = groupRows(row('A', A2, 'base'), [row('B', B2)])
    expect(g.groups).toHaveLength(1)
    expect(g.groups[0]!.rows[0]!.desc).toBe('A')                // 分数相同，B 不排到 A 前面
  })

  test('C09-14 两份评分定义不同的报告：拒绝并排比较；观测内容不同也拒绝', () => {
    const video = scenario(['甲 A'], { ...MARKS, events: ['1.0 甲 E', '2.0 甲 R'] }).video!
    const obs = videoObservations(video)
    const a = { identity: reportIdentity(scoreDefOf(obs), obs, video, ['run-1']) }
    const b = { identity: reportIdentity(scoreDefOf(obs, { scoreObservationIds: ['action#1'] }), obs, video, ['run-1']) }
    const c = { identity: reportIdentity(scoreDefOf(obs, { weights: { action: 2 } as never }), obs, video, ['run-1']) }
    expect(comparableReports(a, a)).toEqual({ ok: true })
    expect(comparableReports(a, b)).toMatchObject({ ok: false, reason: expect.stringMatching(/评分定义不同/) })
    expect(comparableReports(a, c).ok).toBe(false)
    const video2 = scenario(['甲 A'], { ...MARKS, events: ['1.0 甲 E', '2.5 甲 R'] }).video!
    const obs2 = videoObservations(video2)
    expect(comparableReports(a, { identity: reportIdentity(scoreDefOf(obs2), obs2, video2, ['run-1']) })).toMatchObject({ ok: false, reason: expect.stringMatching(/观测内容/) })
  })

  test('C09-15 fitVariants 的输出：规则候选与改轴候选在两张表里，任何一张表里没有另一类', () => {
    const sc = scenario(['甲 A', 'at 1.0', '甲 E', 'at 2.0', '甲 R'], { ...MARKS, events: ['1.0 甲 E', '2.0 甲 R'] })
    const rep = fitVariants(sc, synthData(team()), { n: 8 })
    const kinds = (t: typeof rep.ruleCandidates) => [...t.groups.flatMap(g => g.rows), ...t.unassessable, ...t.engineErrors, ...t.notRun].map(x => x.kind)
    const rule = kinds(rep.ruleCandidates), axis = kinds(rep.axisVariants)
    expect(rule.filter(k => k !== 'base').length).toBeGreaterThan(0)
    expect(axis.filter(k => k !== 'base').length).toBeGreaterThan(0)
    expect(rule.every(k => k === 'rule' || k === 'base')).toBe(true)
    expect(axis.every(k => k === 'axis' || k === 'base')).toBe(true)
    // 规则候选都带台账的引用；策略类等没跑的列出原因
    expect(rep.ruleCandidates.groups.flatMap(g => g.rows).filter(x => x.kind === 'rule').every(x => x.candidate?.propositionId)).toBe(true)
    expect(rep.ruleNotRun.every(x => x.reason.length > 0)).toBe(true)
  })

  test('C09-16 三条观测依次：匹配且残差小、残差超过容差、切人类型冲突：earliestDeviation 指向第二条', () => {
    const video = { ...MARKS, events: ['1.0 甲 E', '2.0 甲 R'], switches: ['3.0 甲→乙 intro'] }
    const { fit } = fitOf(scenario(['甲 A', 'at 1.0', '甲 E', 'at 2.8', '甲 R', 'at 3.0', 'switch 乙'], video))
    expect(fit.observations.map(o => [o.id, o.status])).toEqual([['switch#1', 'conflicted'], ['action#1', 'matched'], ['action#2', 'matched']])
    expect(fit.observations.find(o => o.id === 'action#2')!.residual).toBeCloseTo(0.8, 6)
    expect(fit.earliestDeviation).toEqual({ observationId: 'action#2', videoSeconds: 2.0, channel: 'action' })
    expect(fit.residualByChannel.action).toMatchObject({ n: 2, mae: expect.closeTo(0.4, 6), mean: expect.closeTo(0.4, 6) })
  })

  test('C09-17 跳字通道：标了 crit 而仿真暴击支对不上：conflicted，进 hasQualitativeConflict；对上的是 matched，分支未知时两支都比', () => {
    const base = fitOf(scenario(['甲 A'], { ...MARKS })).res
    const hit = base.log.find(e => e.type === 'hit' && e.judgment === 'a')!
    const dmg = hit.type === 'hit' ? hit.dmg! : null!
    const t = (hit.f / 60).toFixed(3)
    const sc = scenario(['甲 A'], { ...MARKS, hits: [`${t} 甲 a ${Math.round(dmg.crit * 1.1)} crit`, `${t} 甲 a ${Math.round(dmg.crit)} crit`, `${t} 甲 a ${Math.round(dmg.nonCrit)}`] })
    // 同一下打了三条读数：一对一只能配一条；分开三个场景各比一条
    const one = (k: number) => fitOf(scenario(['甲 A'], { ...MARKS, hits: [sc.video!.hits![k]!] })).fit
    const bad = one(0)
    expect(bad.observations[0]).toMatchObject({ status: 'conflicted', conflict: expect.stringMatching(/^hit: 暴击支 .*超出容差/) })
    expect(bad.eligibility.hasQualitativeConflict).toBe(true)
    expect(one(1).observations[0]!.status).toBe('matched')
    expect(one(2).observations[0]!.status).toBe('matched')         // 分支未知：不暴击那一支在容差内
    expect(Math.abs(one(2).observations[0]!.residual!)).toBeLessThan(0.002)
  })

  test('C09-22 只改一个观测的读数、只改一个锚点：runId 不变而报告身份变了；两个签名相同的引擎错误都 score null、都没有名次', () => {
    const sc = scenario(['甲 A', 'at 1.0', '甲 E'], { ...MARKS, events: ['1.0 甲 E'] })
    const data = synthData(team())
    const a = fitVariants(sc, data, { rules: false, axis: false })
    const b = fitVariants({ ...sc, video: { ...sc.video!, events: ['1.1 甲 E'] } }, data, { rules: false, axis: false })
    const c = fitVariants({ ...sc, video: { ...sc.video!, marks: { '1': 0.2 } } }, data, { rules: false, axis: false })
    expect(b.base.runId).toBe(a.base.runId)
    expect(c.base.runId).toBe(a.base.runId)
    expect(b.identity.observationSetDigest).not.toBe(a.identity.observationSetDigest)
    expect(c.identity.observationSetDigest).not.toBe(a.identity.observationSetDigest)
    expect(b.identity.digest).not.toBe(a.identity.digest)
    expect(c.identity.digest).not.toBe(a.identity.digest)
    expect(comparableReports(a, b).ok).toBe(false)
    // 引擎错误：钩子在 Z 开始时抛错。两条都在 Z 之前就有可比的观测、签名相同，也不给名次
    const hooks: CharacterHooks = { onEvent(_ctx, ev) { if (ev.type === 'actionStart' && ev.action === 'Z') throw new Error('钩子坏了') } }
    const err = (rot: string[]) => {
      const p = prepareRun(scenario(rot, sc.video!), synthData(team(hooks)))
      if (!p.ok) throw new Error('prepare')
      const res = runPrepared(p.run)
      expect(res.completion.status).toBe('engineError')
      return replayFit(p.run.resolved, res, sc.video!)
    }
    const e1 = err(['甲 A', 'at 1.0', '甲 E', 'at 2.0', '甲 Z']), e2 = err(['甲 A', 'at 1.0', '甲 E', 'at 3.0', '甲 Z'])
    expect([e1.score, e2.score]).toEqual([null, null])
    expect(e1.eligibility.signature).toBe(e2.eligibility.signature)
    const t = groupRows(row('原场景', a.base, 'base'), [row('e1', e1), row('e2', e2)])
    expect(t.groups.flatMap(g => g.rows).map(x => x.desc)).toEqual(['原场景'])
    expect(t.engineErrors.map(x => x.desc)).toEqual(['e1', 'e2'])
  })

  test('不可评估：没有对上的锚点；评分集合里除了第一个锚点自己没有别的观测', () => {
    const none = fitOf(scenario(['甲 A'], { marks: { '9': 0 }, events: ['0 甲 A'] })).fit
    expect(none).toMatchObject({ assessable: false, score: null, anchors: 0 })
    const self = fitOf(scenario(['甲 A', 'switch 乙'], { marks: { '2': 1.0 } })).fit
    expect(self.observations.map(o => o.id)).toEqual(['switch#m2'])     // 过渡期：切人参照从原场景冻结
    expect(self).toMatchObject({ assessable: false, score: null })
    expect(groupRows(row('self', self, 'base'), []).unassessable.map(x => x.desc)).toEqual(['self'])
  })
})

describe('填法组合分别报告（DD-09 §3.1；C09-6 的报告部分）', () => {
  test('两种填法：报告里两行各带填法名；没有"上下界"之类的合并字段', () => {
    const sc = scenario(['甲 A', 'at 1.0', '甲 E', 'at 3.0', '甲 R'], { ...MARKS, events: ['1.0 甲 E', '3.0 甲 R'] }, {
      replay: { videoOffset: 0, segments: [{ kind: 'unobserved', from: 1.5, to: 3.0, reason: '镜头外', fills: [{ name: '补普攻', lines: ['甲 A A'] }, { name: '不补', lines: [] }] }] },
    })
    const rows = fitCombos(sc, synthData(team()))
    expect(rows.map(x => x.name)).toEqual(['1.5=补普攻', '1.5=不补'])
    expect(rows.map(x => x.fit!.fillCombo)).toEqual(['1.5=补普攻', '1.5=不补'])
    expect(rows[0]!.fit!.runId).not.toBe(rows[1]!.fit!.runId)
    for (const x of rows) expect(Object.keys(x).sort()).toEqual(['fit', 'name'])
  })
})
