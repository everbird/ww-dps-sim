// tests/wire-json.test.ts —— 对外 JSON 转换与信封测试（DD-07 §10；架构 §2.7；C07-22、C07-23）
import { describe, expect, test } from 'vitest'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { prepareRun, runPrepared } from '../src/engine/run'
import { envelope, fromWire, toWire, WIRE_LEDGER_ENTRY_SCHEMA, WIRE_METRIC_NUMBER, WIRE_SCHEMA_VERSION, type WireSchema } from '../src/engine/wire'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

const 甲: SynthChar = { name: '甲', actions: [action({ id: 'X', endFrame: 10, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })] }
const data = synthData([甲, idle('乙'), idle('丙')])
const scenario = ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
  enemy: { custom: { level: 90 } },
  rotation: ['甲 X'],
})

describe('C07-22：toWire / fromWire 往返', () => {
  test('空 Map、非空 Map、Set、Infinity 账本条目、unknown、zeroDuration、普通数值、省略字段', () => {
    interface SamplePayload {
      emptyMap: Map<string, number>
      nonEmptyMap: Map<string, number>
      tags: Set<string>
      ledger: { index: number; cap: number; after: number }
      unknownNum: number | 'unknown'
      zeroDur: number | 'zeroDuration'
      plainTextInf: string
      plainNum: number
      nullable: number | null
      optionalOmitted?: string
    }
    const schema: WireSchema = {
      kind: 'object',
      fields: {
        emptyMap: { kind: 'map' },
        nonEmptyMap: { kind: 'map' },
        tags: { kind: 'set' },
        ledger: WIRE_LEDGER_ENTRY_SCHEMA,
        unknownNum: WIRE_METRIC_NUMBER,
        zeroDur: WIRE_METRIC_NUMBER,
      },
    }
    const input: SamplePayload = {
      emptyMap: new Map(),
      nonEmptyMap: new Map([['b', 2], ['a', 1]]),
      tags: new Set(['z', 'a', 'z']),
      ledger: { index: 0, cap: Infinity, after: 100 },
      unknownNum: 'unknown',
      zeroDur: 'zeroDuration',
      plainTextInf: 'inf',
      plainNum: -0,
      nullable: null,
      optionalOmitted: undefined,
    }
    const wired = toWire(input) as Record<string, unknown>
    // 空 Map 编成 [] 而不是 {}
    expect(Array.isArray(wired.emptyMap)).toBe(true)
    expect(wired.emptyMap).toEqual([])
    expect(wired.nonEmptyMap).toEqual([['a', 1], ['b', 2]])
    expect(wired.tags).toEqual(['a', 'z'])
    expect((wired.ledger as Record<string, unknown>).cap).toBe('inf')
    expect(wired.plainNum).toBe(0)
    expect(Object.is(wired.plainNum, -0)).toBe(false)
    // 值为 undefined 的可选字段被省略，不写成 null；原本为 null 的保留
    expect('optionalOmitted' in wired).toBe(false)
    expect(wired.nullable).toBeNull()

    // 经 JSON 序列化再解析后，按 schema 解码回来
    const parsed = JSON.parse(JSON.stringify(wired))
    const decoded = fromWire<SamplePayload>(parsed, schema)
    expect(decoded.emptyMap).toBeInstanceOf(Map)
    expect(decoded.emptyMap.size).toBe(0)
    expect(decoded.nonEmptyMap).toBeInstanceOf(Map)
    expect([...decoded.nonEmptyMap.entries()]).toEqual([['a', 1], ['b', 2]])
    expect(decoded.tags).toBeInstanceOf(Set)
    expect([...decoded.tags]).toEqual(['a', 'z'])
    expect(decoded.ledger).toEqual({ index: 0, cap: Infinity, after: 100 })
    expect(decoded.unknownNum).toBe('unknown')
    expect(decoded.zeroDur).toBe('zeroDuration')
    // 没有标 allowInf 的普通文本 'inf' 不会被误解成 Infinity
    expect(decoded.plainTextInf).toBe('inf')
    expect(decoded.plainNum).toBe(0)
    expect(decoded.nullable).toBeNull()
    expect('optionalOmitted' in decoded).toBe(false)
  })

  test('负无穷、嵌套账本数组、NaN 抛错', () => {
    const schema: WireSchema = { kind: 'array', item: WIRE_LEDGER_ENTRY_SCHEMA }
    const entries = [{ index: 0, cap: Infinity }, { index: 1, cap: -Infinity }, { index: 2, cap: 125 }]
    const round = fromWire<typeof entries>(JSON.parse(JSON.stringify(toWire(entries))), schema)
    expect(round).toEqual(entries)
    expect(() => toWire({ bad: NaN })).toThrow()
  })
})

describe('C07-23：拒绝函数 / ResolvedScenario，envelope 可序列化且不含 resolved', () => {
  test('带函数的对象与 ResolvedScenario 抛错', () => {
    expect(() => toWire({ fn: () => 1 })).toThrow()
    expect(() => toWire({ nested: [1, () => 2] })).toThrow()
    const p = prepareRun(scenario, data)
    if (!p.ok) throw new Error('prepare failed')
    expect(() => toWire(p.run.resolved)).toThrow()
    expect(() => toWire(p.run.resolved.data)).toThrow()
  })

  test('envelope 不含 resolved、没有函数、JSON 往返可解析', () => {
    const p = prepareRun(scenario, data)
    if (!p.ok) throw new Error('prepare failed')
    const res = runPrepared(p.run)
    const env = envelope(p.run, res, { ok: true, count: res.log.length }, ['state.recompute'], [])
    expect(env.schemaVersion).toBe(WIRE_SCHEMA_VERSION)
    expect('resolved' in env).toBe(false)
    expect('resolved' in env.identity).toBe(false)
    const wired = toWire(env)
    const text = JSON.stringify(wired)
    const reparsed = JSON.parse(text)
    expect(reparsed.schemaVersion).toBe(WIRE_SCHEMA_VERSION)
    expect(reparsed.identity).toEqual(toWire(p.run.identity))
    expect(reparsed.capability.capabilitiesUsed).toEqual(['state.recompute'])
    expect(reparsed.capability.unsupported).toEqual([])
    expect(reparsed.data).toEqual({ count: res.log.length, ok: true })
  })
})

describe('信封的伤害口径披露（DD-02 §3.7；Antigravity 审查 H1）', () => {
  const env = (options: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const p = prepareRun(ScenarioSchema.parse({ ...scenario, options: { ...scenario.options, ...options }, ...extra }), data)
    if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
    return envelope(p.run, runPrepared(p.run), null, ['run'], ['自己的'])
  }
  test('未含谐度破坏：加一项写明原因；量表也关了（gauge off）再加 damage.disharmonyDependent；查询自己的那几项在前、不重复', () => {
    expect(env({ tuneBreak: 'off' }, { tuneBreakOmitted: { reason: 'deliberate' } }).capability.unsupported)
      .toEqual(['自己的', 'damage.tuneBreak: 未含谐度破坏（deliberate）', 'damage.disharmonyDependent'])
    expect(env({ tuneBreak: 'manual' }).capability.unsupported).toEqual(['自己的', 'damage.tuneBreak: 未含谐度破坏（undeclared）'])
  })
  test('自动谐破（缺省）：不加', () => {
    expect(env({}).capability.unsupported).toEqual(['自己的'])
  })
})
