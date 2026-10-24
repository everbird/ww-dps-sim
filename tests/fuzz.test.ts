// tests/fuzz.test.ts —— 模糊测试的变体生成（src/engine/fuzz.ts，docs/engine-quality-plan.md P1）：按连段整块挪动、去掉、对调
import { describe, expect, test } from 'vitest'
import { blockChanges } from '../src/engine/fuzz'
import { lineText, parseLines } from '../src/engine/search'
import { action } from './helpers/kernel-harness'

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
