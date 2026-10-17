// tests/portable.test.ts —— 好移植（总设计 §10.1、§11 第 7 条）：装配结果去掉钩子表后是纯数据，JSON 往返再接上钩子，仿真结果逐条相同。
// 这保证引擎的输入里没有藏着函数、Map、Set、Infinity、对象身份之类 JSON 带不过去的东西——换实现时 pnpm conformance 的样例才可信。
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { portable, withHooks } from '../src/engine/portable'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario } from '../src/engine/types'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

/** JSON 往返后接上原来的钩子表 */
const roundTrip = (r: ResolvedScenario): ResolvedScenario => withHooks(JSON.parse(JSON.stringify(portable(r))), r.data.hooks)
const same = (r: ResolvedScenario) => {
  const a = simulate(r), b = simulate(roundTrip(r))
  expect(b.log).toEqual(a.log)
  expect(b.summary).toEqual(a.summary)
  expect(b.error).toEqual(a.error)
  return a
}

describe('装配结果 JSON 往返（人造角色，不依赖生成数据）', () => {
  test('带钩子与状态量的角色：往返后仿真逐条相同；钩子表是唯一不进 JSON 的东西', () => {
    const 甲: SynthChar = {
      name: '甲', vars: { 次数: 0 },
      actions: [action({ id: 'X', kind: 'skill', endFrame: 30, judgments: [judgment({ name: 'a', spawnFrame: 10 })] })],
      hooks: {
        onEvent: (ctx, ev) => { if (ev.type === 'hit' && ev.char === '甲') ctx.vars.次数 = Number(ctx.vars.次数) + 1 },
        modifyHit: (ctx, d) => { d.multiplier += Number(ctx.vars.次数) },        // 第几次命中就加几倍：状态量要跟着走
      },
    }
    const gd = synthData([甲, idle('乙'), idle('丙')])
    const r = resolveScenario(ScenarioSchema.parse({
      team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
      rotation: ['甲 X X X'],
    }), gd)
    const out = same(r)
    expect(out.log.filter(e => e.type === 'hit').length).toBe(3)
    expect(Object.keys(JSON.parse(JSON.stringify(portable(r))).data.hooks)).toEqual([])
  })

  test('状态量只能改声明过的：钩子加新键会报错', () => {
    const 甲: SynthChar = {
      name: '甲', vars: { 有: 0 },
      actions: [action({ id: 'X', kind: 'skill', endFrame: 30 })],
      hooks: { onEvent: ctx => { (ctx.vars as Record<string, number>)['没声明'] = 1 } },
    }
    const gd = synthData([甲, idle('乙'), idle('丙')])
    const sc = ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['甲 X'] })
    expect(() => simulate(resolveScenario(sc, gd))).toThrow(/not extensible|没声明/)
  })
})

dataDescribe('场景的装配结果 JSON 往返（依赖生成数据）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })
  const DIR = new URL('../scenarios/', import.meta.url)
  for (const f of readdirSync(DIR).filter(x => x.endsWith('.yaml')).sort()) {
    test(f, () => {
      const r = resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL(f, DIR), 'utf8'))), gd)
      same(r)
    })
  }
})
