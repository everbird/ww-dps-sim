// src/engine/digest.ts —— 规范化 JSON 与内容摘要（DD-01 §3.3；架构 §2.7、§9）
// canonicalJson：同一份内容总得到同一段文本（键排序、Map / Set 排序、无穷写成 'inf'）；DD-07 的对外 JSON 复用这套规则。
// sha256Hex：纯 TypeScript、同步。不用 node:crypto（引擎要在浏览器 Worker 里跑），不用 crypto.subtle（异步，会把 prepareRun 变成异步）。

/** 按码点比较（JS 默认按 UTF-16 码元排，代理对会排到 U+E000–U+FFFF 前面） */
function byCodePoint(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i), y = b.charCodeAt(i)
    if (x === y) continue
    const sx = x >= 0xd800 && x <= 0xdfff, sy = y >= 0xd800 && y <= 0xdfff
    return sx === sy ? x - y : sx ? 1 : -1          // 代理（码点 ≥ U+10000）排在其余 BMP 字符之后
  }
  return a.length - b.length
}

/** 规范化的 JSON 文本：对象的键按码点排序，值为 undefined 的键去掉；数组保持顺序（undefined 的元素写成 null，同 JSON.stringify）；
 *  Infinity / -Infinity 写成 "inf" / "-inf"；Map 写成按键排序的 [键, 值] 数组，Set 写成排序数组；函数、NaN、bigint、symbol 抛错 */
export function canonicalJson(x: unknown): string {
  switch (typeof x) {
    case 'string': return JSON.stringify(x)
    case 'boolean': return x ? 'true' : 'false'
    case 'number':
      if (x === Infinity) return '"inf"'
      if (x === -Infinity) return '"-inf"'
      if (Number.isNaN(x)) throw new Error('canonicalJson：NaN 写不成 JSON')
      return JSON.stringify(x)                       // -0 写成 0
    case 'undefined': return 'null'
    case 'object': break
    default: throw new Error(`canonicalJson：${typeof x} 写不成 JSON`)
  }
  if (x === null) return 'null'
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`
  if (x instanceof Map) {
    const entries = [...x].map(([k, v]) => [canonicalJson(k), canonicalJson(v)] as const).sort((a, b) => byCodePoint(a[0], b[0]))
    return `[${entries.map(([k, v]) => `[${k},${v}]`).join(',')}]`
  }
  if (x instanceof Set) return `[${[...x].map(canonicalJson).sort(byCodePoint).join(',')}]`
  const o = x as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(o).sort(byCodePoint)) {
    const v = o[k]
    if (v !== undefined) parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`)
  }
  return `{${parts.join(',')}}`
}

// ---------------------------------------------------------------------------
// SHA-256（FIPS 180-4）

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** 文本按 UTF-8 编码并补位成 64 字节的整数倍（落单的代理按 U+FFFD，同 TextEncoder） */
function padded(text: string): Uint8Array {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++ }
    else n += 3
  }
  const out = new Uint8Array((((n + 8) >> 6) + 1) << 6)
  let p = 0
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i)
    if (c < 0x80) { out[p++] = c; continue }
    if (c < 0x800) { out[p++] = 0xc0 | (c >> 6); out[p++] = 0x80 | (c & 0x3f); continue }
    if (c >= 0xd800 && c <= 0xdfff) {
      const d = text.charCodeAt(i + 1)
      if (c <= 0xdbff && (d & 0xfc00) === 0xdc00) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        i++
        out[p++] = 0xf0 | (cp >> 18); out[p++] = 0x80 | ((cp >> 12) & 0x3f); out[p++] = 0x80 | ((cp >> 6) & 0x3f); out[p++] = 0x80 | (cp & 0x3f)
        continue
      }
      c = 0xfffd
    }
    out[p++] = 0xe0 | (c >> 12); out[p++] = 0x80 | ((c >> 6) & 0x3f); out[p++] = 0x80 | (c & 0x3f)
  }
  out[p] = 0x80
  const bits = n * 8                                  // 长度（位）写在最后 8 字节，大端；n < 2^50 时两个 32 位够用
  const view = new DataView(out.buffer)
  view.setUint32(out.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(out.length - 4, bits >>> 0)
  return out
}

/** 文本（按 UTF-8）的 SHA-256，64 个小写十六进制字符 */
export function sha256Hex(text: string): string {
  const data = padded(text)
  const view = new DataView(data.buffer)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let off = 0; off < data.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] = (h[0]! + a) | 0; h[1] = (h[1]! + b) | 0; h[2] = (h[2]! + c) | 0; h[3] = (h[3]! + d) | 0
    h[4] = (h[4]! + e) | 0; h[5] = (h[5]! + f) | 0; h[6] = (h[6]! + g) | 0; h[7] = (h[7]! + hh) | 0
  }
  let out = ''
  for (let i = 0; i < 8; i++) out += h[i]!.toString(16).padStart(8, '0')
  return out
}

/** 内容摘要：规范化 JSON 的 SHA-256 */
export const digestOf = (x: unknown): string => sha256Hex(canonicalJson(x))

// ---------------------------------------------------------------------------
// 按对象缓存的摘要

// 模块级的 WeakMap 是纯函数的记忆化，不是运行状态：同一个对象的摘要只算一次（整份 GameData 有 MB 量级，敏感度矩阵一次要准备
// 几百个只差一个开关的运行）。前提是这些对象创建后不再被改写——引擎不写装配结果，这是既有约定；tests/prepared-run.test.ts 的
// C01-3 拿不走缓存的重算核对。键是对象引用，对象没人用了条目随之回收。
const cache = new WeakMap<object, string>()

/** x 的内容摘要，按对象引用缓存。strip：摘要前先去掉不算内容的部分（钩子表）；同一个对象要一直用同一个 strip。
 *  fresh = true：不读也不写缓存，重算一遍（核对缓存用） */
export function cachedDigest<T extends object>(x: T, strip?: (x: T) => unknown, fresh = false): string {
  if (!fresh) {
    const hit = cache.get(x)
    if (hit !== undefined) return hit
  }
  const d = digestOf(strip ? strip(x) : x)
  if (!fresh) cache.set(x, d)
  return d
}
