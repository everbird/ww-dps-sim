// src/engine/wire.ts —— 对外输出的信封、能力说明与 JSON 转换（DD-07 §10；架构 §2.7）。①D 查询与诊断。
// 内部照常用 Map、Set、Infinity；只在对外输出边界按 canonicalJson 的同一套规则转换成 JSON，
// 并提供按 schema 解码的 fromWire（无标签格式：空 [] 是数组 / Map / Set、'inf' 是文本还是无穷由各自类型的 schema 区分）。
import { byCodePoint, canonicalJson } from './digest'
import type { PreparedRun, RuleUsageReport, RunCompletion, RunIdentity } from './run-types'
import type { SimResult } from './types'

export const WIRE_SCHEMA_VERSION = '1'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

/** 能力说明（架构 §2.7）：这次查询用到了什么、碰到了哪些假设、读到了哪些规则、有没有外部干预、哪些部分还没建模 */
export interface CapabilityDisclosure {
  readonly capabilitiesUsed: readonly string[]
  readonly assumptionsEncountered: readonly { readonly id: string; readonly count: number }[]
  readonly ruleUsage: RuleUsageReport
  readonly conditioning: RunCompletion['conditioning']
  readonly observationSummary?: {
    readonly passed: number
    readonly conflicted: number
    readonly unmatchedOrAmbiguous: number
    readonly insufficientOrUnassessable: number
  }
  readonly unsupported: readonly string[]
}

/** 对外查询与比较结果的统一信封（架构 §2.7；DD-07 §10.1） */
export interface QueryEnvelope<T> {
  readonly schemaVersion: string
  readonly identity: RunIdentity
  readonly completion: RunCompletion
  readonly capability: CapabilityDisclosure
  readonly data: T
}

/** 构造信封：只放 identity，不放 resolved（DD-07 §10.2） */
export function envelope<T>(
  p: PreparedRun,
  res: SimResult,
  data: T,
  used: readonly string[],
  unsupported: readonly string[],
): QueryEnvelope<T> {
  return {
    schemaVersion: WIRE_SCHEMA_VERSION,
    identity: p.identity,
    completion: res.completion,
    capability: {
      capabilitiesUsed: [...used],
      assumptionsEncountered: res.summary.assumptions.map(a => ({ id: a.id, count: a.count })),
      ruleUsage: res.ruleUsage,
      conditioning: res.completion.conditioning,
      unsupported: [...unsupported],
    },
    data,
  }
}

function isResolvedScenario(o: Record<string, unknown>): boolean {
  return 'data' in o && typeof o.data === 'object' && o.data !== null && 'hooks' in o.data && 'team' in o && Array.isArray(o.team) && 'tuneBreakTiming' in o
}

function isGameData(o: Record<string, unknown>): boolean {
  return 'hooks' in o && typeof o.hooks === 'object' && o.hooks !== null && 'characters' in o && 'weapons' in o
}

/** DD-01 canonicalJson 的对象版（DD-07 §10.2；架构 §2.7）：
 *  - 对象键按码点排序，值为 undefined 的键省略（不适用 = 省略字段，不写 null）；
 *  - Infinity / -Infinity 写成 'inf' / '-inf'，NaN 抛错，-0 写成 0；
 *  - Map 写成按键排序的 [键, 值][]（空的是 []），Set 写成排序数组；
 *  - 遇到函数、bigint、symbol、ResolvedScenario、GameData 抛错 */
export function toWire(x: unknown): JsonValue {
  switch (typeof x) {
    case 'string':
    case 'boolean':
      return x
    case 'number':
      if (x === Infinity) return 'inf'
      if (x === -Infinity) return '-inf'
      if (Number.isNaN(x)) throw new Error('toWire：NaN 写不成 JSON')
      return Object.is(x, -0) ? 0 : x
    case 'undefined':
      return null
    case 'object':
      break
    default:
      throw new Error(`toWire：${typeof x} 写不成 JSON`)
  }
  if (x === null) return null
  if (Array.isArray(x)) return x.map(item => toWire(item))
  if (x instanceof Map) {
    return [...x]
      .map(([k, v]) => ({ sortKey: canonicalJson(k), pair: [toWire(k), toWire(v)] as JsonValue[] }))
      .sort((a, b) => byCodePoint(a.sortKey, b.sortKey))
      .map(e => e.pair)
  }
  if (x instanceof Set) {
    return [...x]
      .map(v => ({ sortKey: canonicalJson(v), val: toWire(v) }))
      .sort((a, b) => byCodePoint(a.sortKey, b.sortKey))
      .map(e => e.val)
  }
  const o = x as Record<string, unknown>
  if (isResolvedScenario(o)) throw new Error('toWire：不输出整个 ResolvedScenario')
  if (isGameData(o)) throw new Error('toWire：不输出 GameData（含角色钩子）')
  const out: Record<string, JsonValue> = {}
  for (const k of Object.keys(o).sort(byCodePoint)) {
    const v = o[k]
    if (v !== undefined) out[k] = toWire(v)
  }
  return out
}

// ---------------------------------------------------------------------------
// 按 schema 解码（DD-07 §10.2）：区分数组 / Map / Set 与文本 'inf' / 无穷

export type WireSchema =
  | { readonly kind: 'any' }
  | { readonly kind: 'number'; readonly allowInf?: boolean; readonly allowUnknown?: boolean; readonly allowZeroDuration?: boolean }
  | { readonly kind: 'map'; readonly key?: WireSchema; readonly value?: WireSchema }
  | { readonly kind: 'set'; readonly item?: WireSchema }
  | { readonly kind: 'array'; readonly item: WireSchema }
  | { readonly kind: 'tuple'; readonly items: readonly WireSchema[] }
  | { readonly kind: 'record'; readonly value: WireSchema }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, WireSchema>>; readonly allowExtra?: boolean }
  | { readonly kind: 'union'; readonly select: (raw: JsonValue) => WireSchema | null }

/** 按 schema 从 JSON 值解码回内部类型；未提供 schema 时原样返回 */
export function fromWire<T = unknown>(raw: JsonValue, schema?: WireSchema): T {
  if (!schema || schema.kind === 'any') return raw as T
  if (raw === null) return null as T
  switch (schema.kind) {
    case 'number': {
      if (typeof raw === 'number') return raw as T
      if (raw === 'inf' && schema.allowInf) return Infinity as T
      if (raw === '-inf' && schema.allowInf) return -Infinity as T
      if (raw === 'unknown' && schema.allowUnknown) return 'unknown' as T
      if (raw === 'zeroDuration' && schema.allowZeroDuration) return 'zeroDuration' as T
      throw new Error(`fromWire：期望数值字段，收到 ${JSON.stringify(raw)}`)
    }
    case 'map': {
      if (!Array.isArray(raw)) throw new Error(`fromWire：期望 Map 的条目数组，收到 ${typeof raw}`)
      const m = new Map<unknown, unknown>()
      for (const entry of raw) {
        if (!Array.isArray(entry) || entry.length !== 2) throw new Error('fromWire：Map 条目必须是二元组 [key, value]')
        m.set(fromWire(entry[0]!, schema.key), fromWire(entry[1]!, schema.value))
      }
      return m as T
    }
    case 'set': {
      if (!Array.isArray(raw)) throw new Error(`fromWire：期望 Set 的数组，收到 ${typeof raw}`)
      return new Set(raw.map(item => fromWire(item, schema.item))) as T
    }
    case 'array': {
      if (!Array.isArray(raw)) throw new Error(`fromWire：期望数组，收到 ${typeof raw}`)
      return raw.map(item => fromWire(item, schema.item)) as T
    }
    case 'tuple': {
      if (!Array.isArray(raw)) throw new Error(`fromWire：期望元组，收到 ${typeof raw}`)
      return schema.items.map((sub, i) => fromWire(raw[i]!, sub)) as T
    }
    case 'record': {
      if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`fromWire：期望 record 对象，收到 ${typeof raw}`)
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(raw)) out[k] = fromWire(v, schema.value)
      return out as T
    }
    case 'object': {
      if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`fromWire：期望对象，收到 ${typeof raw}`)
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(raw)) {
        const sub = schema.fields[k]
        if (sub) out[k] = fromWire(v, sub)
        else if (schema.allowExtra !== false) out[k] = v
        else throw new Error(`fromWire：未知字段 ${k}`)
      }
      return out as T
    }
    case 'union': {
      const sub = schema.select(raw)
      return sub ? fromWire(raw, sub) : (raw as T)
    }
  }
}

/** 常用解码 schema：账本条目（cap 允许 Infinity）、数值标记字段 */
export const WIRE_INF_NUMBER: WireSchema = { kind: 'number', allowInf: true }
export const WIRE_METRIC_NUMBER: WireSchema = { kind: 'number', allowInf: true, allowUnknown: true, allowZeroDuration: true }
export const WIRE_LEDGER_ENTRY_SCHEMA: WireSchema = {
  kind: 'object',
  fields: {
    cap: WIRE_INF_NUMBER,
  },
}
export const WIRE_BUFF_APPLY_SCHEMA: WireSchema = {
  kind: 'object',
  fields: {
    remaining: WIRE_INF_NUMBER,
  },
}
