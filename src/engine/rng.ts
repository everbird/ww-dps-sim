// src/engine/rng.ts —— 抽样模式的随机数（总设计 T4、§10.1 第 7 条）：引擎里随机数只从这里来，期望模式不用。
// xoshiro128**（32 位整数运算），种子用 splitmix32 展开成 4 个字；状态是 4 个 u32 组成的数组，放在 SimState 里，
// structuredClone 分支时随状态一起复制。全部是 32 位整数的乘、移位、异或，Rust 用 u32 的 wrapping_mul、rotate_left 照写就逐位相同
// （tests/rng.test.ts 有前几个输出，两边对一下就知道）。
export type RngState = [number, number, number, number]

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0

/** splitmix32：把一个 32 位种子展开成状态（murmur3 的 fmix32 作用在步长 0x9e3779b9 的序列上） */
export function seedRng(seed: number): RngState {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x9e3779b9) >>> 0
    let z = a
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  const s: RngState = [next(), next(), next(), next()]
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1                 // 全 0 的状态出不来新数
  return s
}

/** 下一个 u32（xoshiro128**），原地推进状态 */
export function nextU32(s: RngState): number {
  const out = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0
  const t = (s[1] << 9) >>> 0
  s[2] = (s[2] ^ s[0]) >>> 0
  s[3] = (s[3] ^ s[1]) >>> 0
  s[1] = (s[1] ^ s[2]) >>> 0
  s[0] = (s[0] ^ s[3]) >>> 0
  s[2] = (s[2] ^ t) >>> 0
  s[3] = rotl(s[3], 11)
  return out
}

/** [0, 1) 上的均匀小数：取高 24 位 ÷ 2^24（Rust：(x >> 8) as f64 / 16777216.0），比较"< 暴击率"时 p = 1 必中、p = 0 必不中 */
export const nextFloat = (s: RngState): number => (nextU32(s) >>> 8) / 16777216

/** [0, n] 上的均匀整数（操作抖动用） */
export const nextInt = (s: RngState, n: number): number => Math.floor(nextFloat(s) * (n + 1))

/** 多次抽样各次的种子：用总种子起一个流，依次取 n 个 u32 */
export function runSeeds(seed: number, n: number): number[] {
  const master = seedRng(seed)
  return Array.from({ length: n }, () => nextU32(master))
}
