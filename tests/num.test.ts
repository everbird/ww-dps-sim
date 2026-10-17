// tests/num.test.ts —— 取整（总设计 §10.1 第 4 条）：JS 的 Math.round 与文件头写的 Rust 写法逐位相同，换语言时照抄那个写法
import { describe, expect, test } from 'vitest'
import { round, roundTo, snap4, snap9 } from '../src/engine/num'

/** src/engine/num.ts 文件头给 Rust 的写法，用 JS 照写一遍 */
const rustRound = (x: number): number => { const f = Math.floor(x); return x - f >= 0.5 ? f + 1 : f }

describe('num', () => {
  test('正好一半往大取：2.5 → 3，−2.5 → −2，−0.5 → −0；0.49999999999999994 → 0', () => {
    expect([round(2.5), round(-2.5), round(0.49999999999999994), round(-1.5)]).toEqual([3, -2, 0, -1])
    expect(Object.is(round(-0.5), -0)).toBe(true)
  })

  test('与 Rust 写法逐位相同（边界值与 2 万个随机数）', () => {
    const xs = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 0.49999999999999994, -0.49999999999999994, 4503599627370495.5, -4503599627370495.5, 1e15 + 0.5, 123.456, -987.654]
    let seed = 1
    for (let i = 0; i < 20000; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0
      xs.push((seed / 2 ** 32 - 0.5) * 10 ** ((i % 12) - 4))
    }
    for (const x of xs) expect([x, rustRound(x) + 0]).toEqual([x, round(x) + 0])   // + 0 把 −0 与 0 当成一样（Rust 里 −0.0 == 0.0）
  })

  test('roundTo / snap4 / snap9：与原来散在各处的写法相同', () => {
    for (const x of [0.1 + 0.2, 1 / 3, -7 / 3, 12.34565, 1e-5]) {
      expect(roundTo(x, 1e6)).toBe(Math.round(x * 1e6) / 1e6)
      expect(snap4(x)).toBe(Math.round(x * 1e4) / 1e4)
      expect(snap9(x)).toBe(Math.round(x * 1e9) / 1e9)
    }
  })
})
