// tests/search.test.ts —— 轴搜索（TD-10 §6.1，总设计 §3.7、M7）：在循环轴上改一处（挪动 / 去掉），完整仿真打分
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { withRotation } from '../src/data/scenario-text'
import { lineText, neighbors, parseLines, rotationKey, searchRotation } from '../src/engine/search'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

describe('轴搜索：候选怎么生成', () => {
  test('挪动 Q：同一角色的行里每个位置各一种，不含原位；别人的行、切人、等待原样保留', () => {
    const lines = parseLines(['甲 A1 A2 Q', 'switch 乙', '乙 E Q', 'switch 甲', '甲 E +3'])
    const ch = neighbors(lines, { chars: ['甲'] })
    expect(ch.map(c => c.desc)).toEqual([
      '甲 Q：第 1 条第 3 个 → 第 1 条第 1 个（开头，A1 之前）',
      '甲 Q：第 1 条第 3 个 → 第 1 条第 2 个（A1 之后、A2 之前）',
      '甲 Q：第 1 条第 3 个 → 第 5 条第 1 个（开头，E 之前）',
      '甲 Q：第 1 条第 3 个 → 第 5 条第 2 个（E 之后，末尾）',
    ])
    expect(ch[3]!.lines.map(lineText)).toEqual(['甲 A1 A2', 'switch 乙', '乙 E Q', 'switch 甲', '甲 E +3 Q'])
    expect(neighbors(lines)).toHaveLength(4 + 1)                             // 不限角色：乙的 Q 在自己那一行里另有 1 个位置（E 前面）
  })

  test('去掉：只试写了的动作；行空了就去掉这一行；后缀（! ? ~ +N）跟着动作走', () => {
    const lines = parseLines(['甲 A1~ E! +2', 'switch 乙', '乙 Q', 'switch 甲', '甲 A1'])
    const ch = neighbors(lines, { move: [], drop: ['Q'] })
    expect(ch.map(c => c.desc)).toEqual(['去掉 乙 Q（第 3 条第 1 个）'])
    expect(ch[0]!.lines.map(lineText)).toEqual(['甲 A1~ E! +2', 'switch 乙', 'switch 甲', '甲 A1'])
  })

  test('对调（第二版）：同一行相邻的两个、行末与紧接着的同一角色那一行开头；两个都是补位的、写法一样的不试', () => {
    const lines = parseLines(['甲 A1~ A2~ E Q', '甲 R', 'switch 乙', '乙 E E'])
    const ch = neighbors(lines, { move: [], swap: true })
    expect(ch.map(c => c.desc)).toEqual(['甲：对调 A2 与 E（第 1 条第 2、3 个）', '甲：对调 E 与 Q（第 1 条第 3、4 个）', '甲：对调 Q 与 R（第 1 条末尾与第 2 条开头）'])
    expect(ch[2]!.lines.map(lineText)).toEqual(['甲 A1~ A2~ E R', '甲 Q', 'switch 乙', '乙 E E'])
    expect(neighbors(lines, { move: [], swap: true, chars: ['乙'] })).toEqual([])
  })

  test('插入（第二版）：有这个动作的角色，每行每个位置各一种；后缀照写', () => {
    const lines = parseLines(['甲 X Y', 'switch 乙', '乙 Z'])
    const ch = neighbors(lines, { move: [], insert: ['X~'], has: (c, a) => c === '甲' && a === 'X' })
    expect(ch.map(c => c.lines[0] && lineText(c.lines[0]))).toEqual(['甲 X~ X Y', '甲 X X~ Y', '甲 X Y X~'])
    expect(ch[1]!.desc).toBe('插入 甲 X~：第 1 条第 2 个（X 之后、Y 之前）')
    expect(() => neighbors(lines, { insert: ['switch 乙'] })).toThrow(/要写一个动作/)
  })

  test('去重的键是指令序列：同一角色相邻两行，Q 放在一行末尾与下一行开头是同一条轴', () => {
    const key = (xs: string[]) => rotationKey(parseLines(xs))
    expect(key(['甲 A1 Q', '甲 E'])).toBe(key(['甲 A1', '甲 Q E']))
    expect(key(['甲 A1 Q', '甲 E'])).not.toBe(key(['甲 Q A1', '甲 E']))
  })
})

describe('轴搜索：人造角色', () => {
  // Q 给 1 秒伤害 +50%；Y 是 2 秒的空动作。循环里 Q 紧挨在 X 前面（Q X Y，或循环意义上同一条的 X Y Q）X 才吃得到
  const 甲: SynthChar = {
    name: '甲',
    actions: [
      action({ id: 'X', kind: 'skill', endFrame: 30, judgments: [judgment({ name: 'X', spawnFrame: 10 })] }),
      action({ id: 'Y', kind: 'skill', endFrame: 120 }),
      action({ id: 'Q', kind: 'skill', endFrame: 10 }),
    ],
    buffs: [{ id: '甲.Q', source: '测试：Q 之后 1 秒内伤害 +50%', zone: 'DamageChange', value: 0.5, target: 'self', duration: 60, trigger: { on: 'actionStart', where: { actions: ['Q'] } } }],
  }
  const data = synthData([甲, idle('乙'), idle('丙')])
  const r = resolveScenario(ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
    rotation: ['甲 X Q Y'], options: { repeat: 4 },
  }), data)

  test('从 X Q Y 出发：挪到 X 前面（或循环意义上同一条的 Y 后面）稳态 DPS 更高，原轴排最后', () => {
    const x = searchRotation(r, ['甲 X Q Y'], [])
    expect(x.tried).toBe(2)
    expect(x.results.map(c => c.lines[0])).toEqual(['甲 Q X Y', '甲 X Y Q', '甲 X Q Y'])
    expect(x.results[0]!.dps).toBeCloseTo(x.results[1]!.dps!, 6)
    expect(x.results[0]!.dps! / x.base.dps!).toBeCloseTo(1.5, 2)            // 每轮一下 X，吃到 +50%（伤害取整，差一点）
    expect(x.results[0]!.steps).toEqual(['甲 Q：第 1 条第 2 个 → 第 1 条第 1 个（开头，X 之前）'])
    expect(x.stoppedBy).toBe('rounds')
  })

  test('对调与插入（第二版）：从 Q Y X 出发对调出 Q X Y；从 X Y 出发插入 Q，插在 X 前面最好', () => {
    const sw = searchRotation(r, ['甲 Q Y X'], [], { move: [], swap: true })
    expect(sw.results[0]!.dps! / sw.base.dps!).toBeCloseTo(1.5, 2)
    expect(sw.results.slice(0, 2).map(c => c.lines[0]).sort()).toEqual(['甲 Q X Y', '甲 Y Q X'])
    const ins = searchRotation(r, ['甲 X Y'], [], { move: [], insert: ['Q'] })
    expect(ins.tried).toBe(3)
    expect(ins.results[0]!.lines).toEqual(['甲 Q X Y'])
    expect(() => searchRotation(r, ['甲 X Y'], [], { insert: ['Z'] })).toThrow(/没有人有动作 Z/)
  })

  test('多轮：第 2 轮没有比最好的更好，停；仿真次数有上限', () => {
    const x = searchRotation(r, ['甲 X Q Y'], [], { rounds: 3 })
    expect([x.rounds, x.stoppedBy]).toEqual([2, 'noBetter'])
    expect(new Set(x.results.map(c => c.lines.join('\n'))).size).toBe(x.results.length)
    const capped = searchRotation(r, ['甲 X Q Y'], [], { maxRuns: 2 })
    expect([capped.runs, capped.stoppedBy]).toEqual([2, 'maxRuns'])
  })
})

dataDescribe('轴搜索：M0 代表轴（依赖生成数据）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })

  test('挪动三人的 Q：插进普攻连段中间的断连段、丢掉；跑通的按 DPS 从高到低，没有重复的轴', () => {
    const sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-team.yaml', import.meta.url), 'utf8')))
    const x = searchRotation(resolveScenario(sc, gd), sc.rotation, sc.opening)
    expect(x.failures.comboBroken).toBeGreaterThan(0)
    expect(x.results).toContain(x.base)
    const dps = x.results.map(c => c.dps!)
    expect(dps).toEqual([...dps].sort((a, b) => b - a))
    expect(new Set(x.results.map(c => rotationKey(parseLines(c.lines)))).size).toBe(x.results.length)
    expect(x.tried).toBe(x.results.length - 1 + Object.values(x.failures).reduce((a, b) => a + b, 0))
  }, 60000)
})

describe('另存：只换循环轴（src/data/scenario-text.ts，命令行 --save 与网页共用）', () => {
  test('块状写法：没改的行连注释原样保留，改了的行注明；其余照原文', () => {
    const text = ['team: []   # 队伍', 'rotation:', '  - 甲 X Q Y   # 原来的说明', '  - switch 乙', 'options: { repeat: 4 }', ''].join('\n')
    expect(withRotation(text, ['甲 X Q Y', 'switch 乙'], ['甲 Q X Y', 'switch 乙'])).toBe(
      ['team: []   # 队伍', 'rotation:', '  - 甲 Q X Y   # 轴搜索改的', '  - switch 乙', 'options: { repeat: 4 }', ''].join('\n'))
  })
  test('不是块状写法：用 yaml 的 Document 改', () => {
    expect(withRotation('rotation: [甲 X]\n', ['甲 X'], ['甲 Y'])).toBe('rotation:\n  - 甲 Y\n')
  })
})
