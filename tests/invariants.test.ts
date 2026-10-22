// tests/invariants.test.ts —— 跑完后的日志自洽检查 checkLog（docs/engine-quality-plan.md P1）：
// 拿一个真实场景的日志，故意改坏一处，看检查能不能指出来。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { checkLog } from '../src/engine/invariants'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario, SimEvent, SimResult } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

let r: ResolvedScenario
let base: SimResult
const copy = (): SimResult => structuredClone(base)
const first = <T extends SimEvent['type']>(x: SimResult, type: T, pred: (e: Extract<SimEvent, { type: T }>) => boolean = () => true) =>
  x.log.findIndex(e => e.type === type && pred(e as Extract<SimEvent, { type: T }>))

dataDescribe('checkLog：改坏一处要能查出来', () => {
  beforeAll(async () => {
    const sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-video-eq.yaml', import.meta.url), 'utf8')))
    r = resolveScenario(sc, await loadGameData())
    base = simulate(r)
  })

  test('原样：没有问题', () => { expect(checkLog(r, base)).toEqual([]) })

  test('资源：value 和上一条 + delta 对不上（有没记日志的改动）', () => {
    const x = copy()
    const i = first(x, 'resource')
    ;(x.log[i] as Extract<SimEvent, { type: 'resource' }>).value += 5
    expect(checkLog(r, x).join('\n')).toMatch(/中间有没记日志的改动/)
  })

  test('动作：结束了没开始的实例、同一实例开始两次', () => {
    const x = copy()
    const i = first(x, 'actionStart')
    x.log.splice(i, 1)
    expect(checkLog(r, x).join('\n')).toMatch(/(结束|取消)了没开始或已结束的动作实例/)
    const y = copy()
    const j = first(y, 'actionStart')
    y.log.splice(j + 1, 0, y.log[j]!)
    expect(checkLog(r, y).join('\n')).toMatch(/开始了两次/)
  })

  test('冷却：冷却没好又出了一次', () => {
    const x = copy()
    const i = first(x, 'actionStart', e => !!r.team.find(m => m.def.name === e.char)!.actions[e.action]!.cooldown)
    const e = x.log[i] as Extract<SimEvent, { type: 'actionStart' }>
    x.log.splice(i + 1, 0, { ...e, instance: 1e9, t: e.t + 0.1 })
    expect(checkLog(r, x).join('\n')).toMatch(/离上次只隔了/)
  })

  test('切人：from 不是前台的人', () => {
    const x = copy()
    const i = first(x, 'switch')
    const e = x.log[i] as Extract<SimEvent, { type: 'switch' }>
    e.from = e.to
    expect(checkLog(r, x).join('\n')).toMatch(/前台却是|切到自己/)
  })

  test('汇总：总伤害、稳态和各部分之和对不上', () => {
    const x = copy()
    x.summary.totalDamage += 1000
    expect(checkLog(r, x).join('\n')).toMatch(/各角色伤害之和/)
    const y = copy()
    y.summary.steady!.damage += 1000
    expect(checkLog(r, y).join('\n')).toMatch(/稳态伤害/)
  })

  test('日志倒序', () => {
    const x = copy()
    const k = x.log.length - 1
    ;[x.log[1], x.log[k]] = [x.log[k]!, x.log[1]!]
    expect(checkLog(r, x).join('\n')).toMatch(/日志倒序/)
  })
})
