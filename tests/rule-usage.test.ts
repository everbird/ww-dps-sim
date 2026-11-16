// tests/rule-usage.test.ts —— 规则使用（DD-05 §4；架构 §4.2）：判定点登记表、必有的摘要 ruleUsage、可选的逐次明细 diag.ruleTrace。
// C05-8、C05-9、C05-10 用人造动作；角色模块的三个判定点（心、卜灵的 forteKeep，爱弥斯的 trackNoConsume）用代表场景，缺数据时跳过。
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { propositionOf } from '../src/engine/propositions'
import { RULE_POINTS, type RulePointId } from '../src/engine/rule-points'
import { prepareRun, runPrepared } from '../src/engine/run'
import type { PreparedRun } from '../src/engine/run-types'
import type { SimResult } from '../src/engine/types'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { diagBase, preparedSynth } from './helpers/diag-team'
import { idle, type SynthChar } from './helpers/synth'

const usage = (res: SimResult, id: string) => res.ruleUsage.byProposition.find(x => x.propositionId === id)!
const pointTrace = (res: SimResult, point: RulePointId) => res.diag!.ruleTrace!.filter(x => x.point === point)

describe('判定点登记表（DD-05 §4.1）', () => {
  test('16 个判定点，ID 不重复，命题都在台账里', () => {
    expect(RULE_POINTS).toHaveLength(16)
    expect(new Set(RULE_POINTS.map(p => p.id)).size).toBe(16)
    expect(RULE_POINTS.filter(p => propositionOf(p.propositionId) === undefined)).toEqual([])
  })
})

describe('C05-8、C05-9 大招的切人锁来自"不响应输入"（ult-input-locks-switch）', () => {
  // 甲 R：大招，"第 60 帧前不响应输入"推出的切人锁（switchLockFromInput），40 帧结束；锁按局部帧越过结束帧照走（TD-04 §6.2）
  const 甲: SynthChar = {
    name: '甲',
    actions: [action({ id: 'R', kind: 'liberation', endFrame: 40, switchLockUntil: 60, switchLockFromInput: true, judgments: [judgment({ name: 'r', spawnFrame: 5 })] })],
  }
  const team: [SynthChar, SynthChar, SynthChar] = [甲, { name: '乙', actions: [] }, idle('丙')]
  const go = (rotation: string[], locks: boolean): SimResult =>
    runPrepared(preparedSynth(team, { rotation }, { rules: { ultInputLocksSwitch: locks } }), { diag: { ruleTrace: true } })
  const point = (res: SimResult) => {
    const t = pointTrace(res, 'sched.switch.ultInputLock')
    return { reads: t.length, decisive: t.filter(x => x.decisive).length, values: [...new Set(t.map(x => x.value))] }
  }
  const switchLockWaits = (res: SimResult) => res.log.filter(e => e.type === 'wait' && e.code === 'switchLock').length

  test('C05-8 紧接着切人、规则为 true：读到并决定了分支，有 switchLock 的等待', () => {
    const res = go(['甲 R', 'switch 乙'], true)
    const p = point(res)
    expect(p.reads).toBeGreaterThan(0)
    expect(p.decisive).toBeGreaterThan(0)
    expect(p.values).toEqual([true])
    expect(switchLockWaits(res)).toBe(1)
    expect(usage(res, 'ult-input-locks-switch')).toMatchObject({ readCount: p.reads, decisiveCount: p.decisive, firstFrame: 0 })
  })

  test('C05-8 同一条轴、规则为 false：这一处同样决定了分支（方向相反），没有等待', () => {
    const res = go(['甲 R', 'switch 乙'], false)
    const p = point(res)
    expect([p.reads > 0, p.decisive > 0, p.values]).toEqual([true, true, [false]])
    expect(switchLockWaits(res)).toBe(0)
    expect(res.log.find(e => e.type === 'switch')!.f).toBe(0)
  })

  test('C05-9 切人写在锁结束之后：读到了，没有决定分支', () => {
    for (const locks of [true, false]) {
      const res = go(['甲 R', 'wait 70', 'switch 乙'], locks)
      const u = usage(res, 'ult-input-locks-switch')
      expect([u.readCount > 0, u.decisiveCount]).toEqual([true, 0])
      expect(switchLockWaits(res)).toBe(0)
    }
  })
})

describe('C05-10 摘要与明细', () => {
  const p: PreparedRun = diagBase()
  const off = runPrepared(p)
  const on = runPrepared(p, { diag: { ruleTrace: true, eventMeta: true } })

  test('coverage 就是判定点表', () => {
    expect(off.ruleUsage.coverage).toEqual(RULE_POINTS.map(x => ({ pointId: x.id, propositionId: x.propositionId, symbol: x.symbol })))
  })

  test('byProposition 列出判定点表里的每条命题（没读到的记 0、firstFrame 为 null），按表里第一次出现的顺序', () => {
    const ids = [...new Set(RULE_POINTS.map(x => x.propositionId))]
    expect(off.ruleUsage.byProposition.map(x => x.propositionId)).toEqual(ids)
    for (const x of off.ruleUsage.byProposition) expect(x.readCount === 0 ? x.firstFrame : 0).toBe(x.readCount === 0 ? null : 0)
  })

  test('诊断关与开，ruleUsage 相同；ruleTrace 的条数等于各点 readCount 之和', () => {
    expect(on.ruleUsage).toEqual(off.ruleUsage)
    const reads = on.ruleUsage.byProposition.reduce((a, x) => a + x.readCount, 0)
    expect(on.diag!.ruleTrace).toHaveLength(reads)
    expect(reads).toBeGreaterThan(0)
  })

  test('明细的每一条：命题对得上判定点，afterEventSeq 在日志范围内且不倒退，有作用域时与那一刻的事件同属一个作用域号空间', () => {
    const byPoint = new Map(RULE_POINTS.map(x => [x.id, x.propositionId] as const))
    let last = -1
    for (const x of on.diag!.ruleTrace!) {
      expect(x.propositionId).toBe(byPoint.get(x.point))
      expect(x.afterEventSeq).toBeGreaterThanOrEqual(last)
      expect(x.afterEventSeq).toBeLessThan(on.log.length)
      last = x.afterEventSeq
    }
    // firstFrame 是第一次读到的战斗帧
    const first = new Map<string, number>()
    for (const x of on.diag!.ruleTrace!) if (!first.has(x.propositionId)) first.set(x.propositionId, x.battleFrame)
    for (const x of on.ruleUsage.byProposition) expect(x.firstFrame).toBe(first.get(x.propositionId) ?? null)
  })

  test('切人那一刻读到的 switchEndsStop 两个点都记了（evaluate 与 execute）', () => {
    expect(pointTrace(on, 'sched.switch.switchEndsStop').length).toBeGreaterThan(0)
    expect(pointTrace(on, 'sched.execute.switchEndsStop')).toHaveLength(1)
  })
})

dataDescribe('代表场景里的判定点（DD-05 §4.1）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  const run = (f: string, diag = false): SimResult => {
    const p = prepareRun(ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8'))), gd)
    if (!p.ok) throw new Error(p.issues.map(i => i.message).join('\n'))
    return runPrepared(p.run, diag ? { diag: { ruleTrace: true } } : {})
  }

  test('xin-team.yaml：心、卜灵切出时各读一次 forteKeep，值是 forteKept 的有效值；诊断关与开相同', () => {
    const on = run('xin-team.yaml', true)
    const switchesFrom = (char: string) => on.log.filter(e => e.type === 'switch' && e.from === char).length
    expect(pointTrace(on, 'char.心.forteKeep')).toHaveLength(switchesFrom('心'))
    expect(pointTrace(on, 'char.卜灵.forteKeep')).toHaveLength(switchesFrom('卜灵'))
    expect(new Set(pointTrace(on, 'char.心.forteKeep').map(x => x.value))).toEqual(new Set([true]))
    // 这条轴切出时两人都没有可清的状态：一次都没决定分支，与敏感度矩阵里 F7（forteKeepOnSwitch 翻过来）对 xin-team 没有影响一致
    expect([usage(on, 'forte-keep.心-照世相').decisiveCount, usage(on, 'forte-keep.卜灵-卦象').decisiveCount]).toEqual([0, 0])
    expect(run('xin-team.yaml').ruleUsage).toEqual(on.ruleUsage)
  }, 60_000)

  test('xin-team-r5-按套路重排.yaml：心、卜灵切出时有状态可清，forteKeep 决定了分支（翻过来这条轴就跑不通，assumption-sensitivity 的读法）', () => {
    const res = run('xin-team-r5-按套路重排.yaml')
    expect(usage(res, 'forte-keep.心-照世相').decisiveCount).toBeGreaterThan(0)
    expect(usage(res, 'forte-keep.卜灵-卦象').decisiveCount).toBeGreaterThan(0)
  }, 60_000)

  test('alm-爱琳莫.yaml：爱弥斯过载后第一次光翼共奏读 trackNoConsume，读到就决定分支', () => {
    const res = run('alm-爱琳莫.yaml', true)
    const t = pointTrace(res, 'char.爱弥斯.trackNoConsume')
    expect(t.length).toBeGreaterThan(0)
    expect(t.every(x => x.decisive && x.value === true)).toBe(true)
    expect(res.summary.assumptions.find(a => a.id === 'track-no-consume')?.count).toBe(t.length)
  }, 60_000)

  test('m0-video-eq.yaml：声骸起手优先级、操作延迟、谐破开关、defFloor 都读到了', () => {
    const res = run('m0-video-eq.yaml')
    for (const id of ['echo-input-priority', 'input-delay', 'tune-break-mode', 'def-floor', 'hitstop-in-global-stop'])
      expect(usage(res, id).readCount, id).toBeGreaterThan(0)
    expect(usage(res, 'echo-input-priority').decisiveCount).toBeGreaterThan(0)
  }, 60_000)
})
