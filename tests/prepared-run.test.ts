// tests/prepared-run.test.ts —— 摘要、归一入口与运行身份（DD-01 §3.2、§3.3；用例 C01-1～C01-7）
import { describe, expect, test } from 'vitest'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { canonicalJson, digestOf, sha256Hex } from '../src/engine/digest'
import { resolveScenario } from '../src/engine/resolve'
import { prepareRun, resolvedDigestOf, runPrepared } from '../src/engine/run'
import type { PreparedRun, RunOverrides } from '../src/engine/run-types'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

const 甲: SynthChar = { name: '甲', actions: [action({ id: 'X', endFrame: 10, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })] }
const data = synthData([甲, idle('乙'), idle('丙')])
const scenario = (sc: Partial<ScenarioInput> = {}) => ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
  enemy: { custom: { level: 90 } }, rotation: ['甲 X'], ...sc,
})
const prepared = (sc: Partial<ScenarioInput> = {}, overrides: RunOverrides = {}): PreparedRun => {
  const p = prepareRun(scenario(sc), data, overrides)
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
  return p.run
}

describe('DD-10 面板增量的正式准备入口', () => {
  test('真实源场景身份、面板差值与旧分析口径，不修改共享数据', () => {
    const base = prepared()
    const changed = prepared({}, { panelDeltas: { 甲: { energyRegen: 0.25, atkFlat: 50, hpFlat: 500, defFlat: 50 } } })
    expect(changed.resolved.team[0].panel.energyRegen).toBe(base.resolved.team[0].panel.energyRegen + 0.25)
    expect(changed.resolved.team[0].panel.atk.flat).toBe(base.resolved.team[0].panel.atk.flat + 50)
    expect(changed.resolved.team[0].panel.hp.flat).toBe(base.resolved.team[0].panel.hp.flat + 500)
    expect(changed.resolved.team[0].panel.def.flat).toBe(base.resolved.team[0].panel.def.flat + 50)
    expect(changed.resolved.team[0].stats).toEqual(base.resolved.team[0].stats)
    expect(changed.identity.execution.scenarioDigest).toBe(base.identity.execution.scenarioDigest)
    expect(changed.identity.execution.resolvedDigest).not.toBe(base.identity.execution.resolvedDigest)
    expect(changed.runId).not.toBe(base.runId)
    expect(prepared().runId).toBe(base.runId)
  })
  test('拒绝未知角色、未知字段与非有限增量', () => {
    for (const panelDeltas of [{ 不在队伍: { atkFlat: 1 } }, { 甲: { bad: 1 } }, { 甲: { energyRegen: NaN } }, { 甲: { atkFlat: Infinity } }])
      expect(prepareRun(scenario(), data, { panelDeltas } as unknown as RunOverrides).ok).toBe(false)
  })
})

describe('摘要（DD-01 §3.3）', () => {
  test('C01-1 sha256Hex 等于标准测试向量', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
    // 两个分组的向量（FIPS 180-4 附例）与非 ASCII：按 UTF-8 编码
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    expect(sha256Hex('椿')).toBe(sha256Hex('椿'))
    expect(sha256Hex('中文')).toBe('72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21')
  })

  test('C01-2 canonicalJson：键排序、无穷、Map / Set、函数', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }))
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}')
    expect(canonicalJson({ x: Infinity, y: -Infinity })).toBe('{"x":"inf","y":"-inf"}')
    expect(canonicalJson({ m: new Map([['b', 2], ['a', 1]]), s: new Set(['z', 'y']) })).toBe('{"m":[["a",1],["b",2]],"s":["y","z"]}')
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}')            // undefined 的键去掉：写不写这个键一样
    expect(canonicalJson([undefined, -0])).toBe('[null,0]')
    expect(() => canonicalJson({ f: () => 1 })).toThrow()
    expect(() => canonicalJson({ n: NaN })).toThrow()
    expect(digestOf({ b: 1, a: 2 })).toBe(digestOf({ a: 2, b: 1 }))
  })

  test('C01-3 resolvedDigest：走缓存、不走缓存重算、运行一次之后，三次相同', () => {
    const p = prepared()
    const r = p.resolved
    const cached = resolvedDigestOf(r)
    expect(resolvedDigestOf(r, true)).toBe(cached)
    const res = runPrepared(p)
    expect(res.completion.status).toBe('completed')
    expect(resolvedDigestOf(r, true)).toBe(cached)                           // 引擎没有改写装配结果
    expect(resolvedDigestOf(r)).toBe(cached)
    // 另一次装配（对象都是新的，GameData 是同一份）内容相同，摘要相同
    expect(resolvedDigestOf(resolveScenario(scenario(), data))).toBe(cached)
    expect(p.identity.execution.resolvedDigest).toBe(cached)
  })
})

describe('归一入口与运行身份（DD-01 §3.2、§3.3）', () => {
  test('C01-4 同一场景 prepareRun 两次，runId 相同', () => {
    const a = prepared(), b = prepared()
    expect(a.runId).toMatch(/^run-[0-9a-f]{16}$/)
    expect(b.runId).toBe(a.runId)
    expect(b.identity).toEqual(a.identity)
    // 另建一份内容相同的 GameData（缓存里没有它的对象）也一样
    const again = prepareRun(scenario(), synthData([甲, idle('乙'), idle('丙')]))
    expect(again.ok && again.run.runId).toBe(a.runId)
    // 冻结：顶层、identity、effective
    expect(Object.isFrozen(a) && Object.isFrozen(a.identity.execution.rules) && Object.isFrozen(a.effective)).toBe(true)
    // 不影响执行的 video 不进摘要（DD01-Q4）
    expect(prepared({ video: { marks: { '1': 3.5 } } }).runId).toBe(a.runId)
    // 结果带同一份身份
    const res = runPrepared(a)
    expect(res.runId).toBe(a.runId)
    expect(res.identity).toBe(a.identity)
  })

  test('C01-5 影响结果的输入各有各的 runId；观察选项 diag 不改 runId（架构 §13.2 AF-28）', () => {
    const base = prepared()
    const cont = prepared({}, { continueAfterIntentUnmet: true })
    const withSub = (atk: number) => ['甲', '乙', '丙'].map((char, i) => ({
      char, weapon: { name: '测试武器' }, ...(i === 0 ? { echoes: [{ name: '人造声骸', set: '人造套装', main: {}, subs: { 攻击: atk } }] } : {}),
    }))
    const sub = prepared({ team: withSub(50) })
    const sub2 = prepared({ team: withSub(60) })
    const rule = prepared({}, { rules: { defFloor: true } })
    const ids = [base, cont, sub, sub2, rule].map(p => p.runId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(sub.identity.execution.resolvedDigest).not.toBe(sub2.identity.execution.resolvedDigest)   // 只差一条副词条：最终装配内容变
    expect(rule.identity.execution.resolvedDigest).toBe(base.identity.execution.resolvedDigest)      // 规则在身份里单列
    expect(cont.identity.execution.continueAfterIntentUnmet).toBe(true)
    // diag 是 runPrepared 的观察选项：同一份 PreparedRun，结果的 runId 不变
    const plain = runPrepared(base), diag = runPrepared(base, { diag: { eventMeta: true } })
    expect(diag.runId).toBe(plain.runId)
    expect(diag.log).toEqual(plain.log)
  })

  test('C01-6 inputTiming：有操作延迟、抖动是 delayed；只给种子是 earliest', () => {
    const delay = prepared({}, { options: { inputDelay: 6 } })
    expect(delay.identity.execution.inputTiming).toBe('delayed')
    expect(delay.identity.execution.options.inputDelay).toBe(6)
    expect(delay.resolved.options.inputDelay).toBe(6)
    const jitter = prepared({}, { sample: { seed: 1, jitter: 3 } })
    expect(jitter.identity.execution.inputTiming).toBe('delayed')
    const seed = prepared({}, { sample: { seed: 1 } })
    expect(seed.identity.execution.inputTiming).toBe('earliest')
    expect(seed.identity.execution.sample).toEqual({ seed: 1 })
    expect(seed.effective.sample).toEqual({ seed: 1 })
    expect(prepared().identity.execution.sample).toBeNull()
    expect(prepared({}, { inputDelayAt: { '1:1': 6 } }).identity.execution.inputTiming).toBe('delayed')
    expect(new Set([prepared(), delay, jitter, seed].map(p => p.runId)).size).toBe(4)
  })

  test('C01-7 覆盖优先于场景：rules.defFloor、来源字段', () => {
    const sc = { options: { rules: { defFloor: true } } }
    expect(prepared(sc).identity.execution.rules.defFloor).toBe(true)
    const p = prepared(sc, { rules: { defFloor: false } })
    expect(p.identity.execution.rules.defFloor).toBe(false)
    expect(p.resolved.rules.defFloor).toBe(false)
    const x = p.identity.execution
    expect([x.entryMode, x.strictSource, x.gitCommit, x.scenarioDigest.length, x.outputSchemaVersion]).toEqual(['standard', 'default', 'unknown', 64, '2'])
    expect(p.identity.data).toEqual({ xlsxFileDate: 'synthetic' })
    expect(p.effective).toEqual({ damageScope: { tuneBreak: { mode: 'auto' } }, strict: false, strictSource: 'default', continueAfterIntentUnmet: false, sample: null })
    // 带路径的规则覆盖只改那一项，同一层的其余项保留
    const share = prepared({}, { rules: { 'energyShare.dealer': 0.5 } }).identity.execution.rules.energyShare
    expect(share).toEqual({ ...prepared().identity.execution.rules.energyShare, dealer: 0.5 })
    // 命令行采集的环境进身份
    const env = prepared({}, { environment: { gitCommit: 'abc123', contentFingerprint: 'f'.repeat(64), xlsxSha256: '0'.repeat(64), resourceVersion: '3.7.13' } })
    expect(env.identity.execution.gitCommit).toBe('abc123')
    expect(env.identity.data).toEqual({ xlsxFileDate: 'synthetic', xlsxSha256: '0'.repeat(64), resourceVersion: '3.7.13' })
    expect(env.runId).not.toBe(prepared().runId)
    // 录像剖析走 replay 入口
    expect(prepared({ purpose: 'replay' }).identity.execution.entryMode).toBe('replay')
  })

  test('有问题时返回问题清单，不抛', () => {
    const bad = (sc: Partial<ScenarioInput>, o: RunOverrides = {}) => { const p = prepareRun(scenario(sc), data, o); return p.ok ? [] : p.issues }
    expect(bad({}, { strict: true })).toMatchObject([{ stage: 'strict', code: 'strict.tuneBreakAuto' }])
    expect(bad({}, { rules: { 没有这条: 1 } })).toMatchObject([{ stage: 'resolve' }])
    expect(bad({}, { options: { repeat: 0 } })).toMatchObject([{ stage: 'schema', code: 'schema' }])
    expect(bad({ rotation: ['甲 X', '甲 没有的动作'] })).toMatchObject([{ stage: 'compile', line: 2 }])
    expect(bad({ opening: ['甲 没有的动作'] })).toMatchObject([{ stage: 'compile', line: 1, opening: true }])
  })
})
