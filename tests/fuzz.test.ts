// tests/fuzz.test.ts —— 模糊测试的变体生成（src/engine/fuzz.ts，docs/engine-quality-plan.md P1）：按连段整块挪动、去掉、对调；
// 带资源账本跑的检查（DD-06 T06-4）
import { describe, expect, test } from 'vitest'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { blockChanges, fuzzScenario, ledgerRun } from '../src/engine/fuzz'
import { resolveScenario } from '../src/engine/resolve'
import { lineText, parseLines } from '../src/engine/search'
import type { SimState } from '../src/engine/types'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

const acts = {
  A1: action({ id: 'A1' }), A2: action({ id: 'A2', comboFrom: ['A1'] }), A3: action({ id: 'A3', comboFrom: ['A2'] }),
  E: action({ id: 'E' }), Q: action({ id: 'Q' }),
}
const members = [{ name: '甲', actions: acts, aliases: {} }]

describe('按连段整块的变体（2026-10-24）', () => {
  test('A1 A2 A3 接成一块，整块挪、去掉、对调，不拆开', () => {
    const out = blockChanges(parseLines(['甲 E A1 A2 A3 Q']), members).map(c => `${lineText(c.lines[0]!)}｜${c.desc}`)
    expect(out).toContain('甲 A1 A2 A3 E Q｜甲（第 1 条）对调「E」与「A1 A2 A3」')
    expect(out).toContain('甲 E Q｜甲（第 1 条）去掉连段「A1 A2 A3」')
    expect(out).toContain('甲 E Q A1 A2 A3｜甲（第 1 条）「A1 A2 A3」整块挪到第 4 块的位置')
    // 每条变体里 A1 A2 A3 都连在一起、顺序不变
    for (const o of out) if (o.includes('A1')) expect(o).toMatch(/A1 A2 A3/)
  })
  test('没有连段（每块一个动作）的行不生成：那些由单个挪动覆盖', () => {
    expect(blockChanges(parseLines(['甲 E Q A1']), members)).toEqual([])
    expect(blockChanges(parseLines(['switch 甲']), members)).toEqual([])
  })
})

describe('带资源账本（pnpm fuzz --ledger，DD-06 §3.6、T06-4）', () => {
  const 甲: SynthChar = {
    name: '甲', core: [{ slot: 1, name: '豆', cap: 10 }],
    actions: [
      action({ id: 'X', endFrame: 20, judgments: [judgment({ name: 'x', spawnFrame: 5, gains: { energy: 10, concerto: 10, core: [3, 0, 0] } })] }),
      action({ id: 'E', endFrame: 20 }),
    ],
  }
  const scenario = (hooks?: SynthChar['hooks']) => {
    const chars: [SynthChar, SynthChar, SynthChar] = [{ ...甲, ...(hooks ? { hooks } : {}) }, idle('乙'), idle('丙')]
    return resolveScenario(ScenarioSchema.parse({
      team: chars.map(c => ({ char: c.name, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } },
      rotation: ['甲 X E X'], initial: { energy: 'empty' },
    }), synthData(chars))
  }

  test('正常的轴：终态闭合、与日志对得上，没有问题；变体也都带账本跑', () => {
    expect(ledgerRun(scenario()).problems).toEqual([])
    const x = fuzzScenario(scenario(), ['甲 X E X'], [], 10, { ledger: true })
    expect(x.ran).toBeGreaterThan(0)
    expect(x.problems).toEqual([])
  })

  test('绕过账本改资源（没接进账本的写入点）：报出闭合的问题', () => {
    const bad = scenario({ onEvent: (ctx, ev) => { if (ev.type === 'actionStart' && ev.action === 'E') (ctx.state as SimState).chars[0].core[0] += 1 } })
    const { problems } = ledgerRun(bad)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every(p => p.startsWith('账本闭合：'))).toBe(true)
    expect(problems.join('\n')).toContain('甲 的 core1')
    expect(fuzzScenario(bad, ['甲 X E X'], [], 5, { ledger: true }).problems.length).toBeGreaterThan(0)
  })
})
