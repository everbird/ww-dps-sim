// src/engine/sample.ts —— 多次抽样（总设计 T4，TD-10 §6 ⑤）：同一个场景按不同种子跑 N 次（逐段抽暴击，可加操作抖动），
// 看比较口径下 DPS 的分布，并与期望值比。现在是研究工具：只抽暴击和操作延迟，操作失误（漏按、闪避失败）以后再说。
import { basisOf } from './analysis'
import { runSeeds } from './rng'
import { simulate } from './simulate'
import type { ResolvedScenario } from './types'

export interface SampleStats { mean: number; sd: number; min: number; p5: number; p50: number; p95: number; max: number }
export interface Sampling {
  label: string                             // 比较口径（同对比：有分轮取稳态）
  expected: number                          // 期望模式的 DPS
  dps: number[]                             // 每次抽样的 DPS（跑不通的不算）
  stats: SampleStats | null                 // 全部跑不通时为 null
  failed: number
  errors: string[]                          // 跑不通的原因（去重，最多 5 条）
}

export function sampleRuns(r: ResolvedScenario, opts: { runs: number; seed?: number; jitter?: number }): Sampling {
  const base = simulate(r)
  if (base.error) throw new Error(`场景运行报错，先把轴修好再抽样：${base.error.message}`)
  const b = basisOf(base)
  const dps: number[] = []
  const errors: string[] = []
  for (const seed of runSeeds(opts.seed ?? 1, opts.runs)) {
    const res = simulate(r, { sample: { seed, ...(opts.jitter ? { jitter: opts.jitter } : {}) } })
    if (res.error) errors.push(res.error.message)
    else dps.push(basisOf(res).dps)
  }
  return { label: b.label, expected: b.dps, dps, stats: dps.length ? statsOf(dps) : null, failed: errors.length, errors: [...new Set(errors)].slice(0, 5) }
}

/** 平均、样本标准差与几个分位数（就近取，排好序的第 round(q × (n − 1)) 个） */
export function statsOf(xs: readonly number[]): SampleStats {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  const mean = s.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0
  const q = (p: number) => s[Math.round(p * (n - 1))]!
  return { mean, sd, min: s[0]!, p5: q(0.05), p50: q(0.5), p95: q(0.95), max: s[n - 1]! }
}
