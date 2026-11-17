// tests/propositions.test.ts —— DD-04 T04-1、T04-2 的用例：拆开关（forteKeepOnSwitchBy 与 forteKept，C04-1、C04-2）、
// 规则路径的多段设值（mergeRulePaths，C04-3）、台账自检（C04-4）。人造角色，不依赖生成数据；最后一组（代表轴碰到的假设）依赖 data/generated。
// C04-4b 与 C04-5 起的候选检查（当前生效值、分类、路径冲突…）属于 T04-4 之后，放 tests/candidates.test.ts。
// DD-08 §4.3：证据入台账的用途约束（C08-11）、台账与闭环记录（docs/evidence/）三处一致（结论按同一张决策表算）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { CalibrationFileSchema } from '../src/data/calibration.schema'
import { DEFAULT_RULES, forteKept, PER_CHAR_RULES, type GameData, type Rules } from '../src/data/gamedata'
import { parseClosure } from '../src/cli/evidence-file'
import { evidenceFromClosure, evidenceViolations, judgeClosure } from '../src/analysis/evidence'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { ASSUMPTIONS } from '../src/engine/assumptions'
import { PROPOSITIONS, propositionOf, type Binding, type Proposition, type PropositionId } from '../src/engine/propositions'
import { mergeRulePaths, prepareRun, runPrepared } from '../src/engine/run'
import type { RunOverrides } from '../src/engine/run-types'
import { flipsOf } from '../src/analysis/sensitivity'
import type { SimResult } from '../src/engine/types'
import { action, dataDescribe } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

// ---------------------------------------------------------------------------
// 拆开关（DD-04 §4.1）与多段路径（§4.2）

/** 切走时按 forteKept 清状态的人造角色（同心、卜灵的钩子）：起手 X 得 1 点"状态"（核心资源槽 1），切走时 forteKept 为 false 就清掉 */
const forteChar = (name: string): SynthChar => ({
  name, core: [{ slot: 1, name: '状态', cap: 10 }], actions: [action({ id: 'X', endFrame: 10 })],
  hooks: {
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      if (ev.type === 'actionStart' && ev.char === me) ctx.addResource('core1', 1)
      if (ev.type === 'switch' && ev.from === me && !forteKept(ctx.rules, me)) {
        const n = ctx.state.chars[ctx.self].core[0]!
        if (n > 0) ctx.addResource('core1', -n, ctx.self, '切走清状态')
      }
    },
  },
})
const data = synthData([forteChar('甲'), forteChar('乙'), idle('丙')])
/** 甲 X 后切乙，乙 X 后切丙：甲、乙各切走一次 */
const scenario = (sc: Partial<ScenarioInput> = {}) => ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
  enemy: { custom: { level: 90 } }, rotation: ['甲 X', 'switch 乙', '乙 X', 'switch 丙'], ...sc,
})
function run(sc: Partial<ScenarioInput> = {}, overrides: RunOverrides = {}) {
  const p = prepareRun(scenario(sc), data, overrides)
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
  return { p: p.run, res: runPrepared(p.run) }
}
/** 切走时被清了状态的人，按日志顺序 */
const cleared = (res: SimResult) => res.log.flatMap(e => (e.type === 'resource' && e.note === '切走清状态' ? [e.char] : []))

describe('拆开关：forteKeepOnSwitchBy（DD-04 §4.1；架构 §8.3）', () => {
  test('缺省都保留；forteKept 先看按角色的表，没写的用共享的 forteKeepOnSwitch', () => {
    expect(DEFAULT_RULES.forteKeepOnSwitchBy).toEqual({})
    expect(forteKept(DEFAULT_RULES, '心')).toBe(true)
    expect(forteKept({ ...DEFAULT_RULES, forteKeepOnSwitch: false }, '心')).toBe(false)          // 只写旧的：表里没有键，按共享的（DF-05）
    expect(forteKept({ ...DEFAULT_RULES, forteKeepOnSwitch: false, forteKeepOnSwitchBy: { 心: true } }, '心')).toBe(true)
    expect(forteKept({ ...DEFAULT_RULES, forteKeepOnSwitchBy: { 心: false } }, '卜灵')).toBe(true)
    const { res } = run()
    expect(res.completion.status).toBe('completed')
    expect(res.log.filter(e => e.type === 'switch')).toHaveLength(2)
    expect(cleared(res)).toEqual([])
  })

  test('C04-1 覆盖 forteKeepOnSwitchBy.甲: false：甲清、乙不清；共享的 forteKeepOnSwitch 仍是 true', () => {
    const { p, res } = run({}, { rules: { 'forteKeepOnSwitchBy.甲': false } })
    expect(res.completion.status).toBe('completed')
    expect(cleared(res)).toEqual(['甲'])
    expect(p.resolved.rules.forteKeepOnSwitch).toBe(true)
    expect(p.resolved.rules.forteKeepOnSwitchBy).toEqual({ 甲: false })
    expect(p.identity.execution.rules.forteKeepOnSwitchBy).toEqual({ 甲: false })                 // 有效值进运行身份
    expect(p.runId).not.toBe(run().p.runId)
    // 场景里直接写按角色的表：同一份有效场景，同一个 runId
    expect(run({ options: { rules: { forteKeepOnSwitchBy: { 甲: false } } } }).p.runId).toBe(p.runId)
  })

  test('C04-2 只翻乙；两个都翻；只写旧的 forteKeepOnSwitch: false', () => {
    expect(cleared(run({}, { rules: { 'forteKeepOnSwitchBy.乙': false } }).res)).toEqual(['乙'])
    const both = run({}, { rules: { 'forteKeepOnSwitchBy.甲': false, 'forteKeepOnSwitchBy.乙': false } })
    expect(cleared(both.res)).toEqual(['甲', '乙'])
    const { forteKeepOnSwitchBy, ...rest } = both.p.resolved.rules
    const { forteKeepOnSwitchBy: _none, ...defaults } = DEFAULT_RULES
    expect(forteKeepOnSwitchBy).toEqual({ 甲: false, 乙: false })
    expect(rest).toEqual(defaults)                                                              // Rules 其余键不变
    const old = run({ options: { rules: { forteKeepOnSwitch: false } } })
    expect(cleared(old.res)).toEqual(['甲', '乙'])
    expect(old.p.resolved.rules.forteKeepOnSwitchBy).toEqual({})
  })

  test('装配逐项校验：表里的角色名要在数据里（原样比）、值要是布尔、整张表要是对象', () => {
    const issues = (rules: Record<string, unknown>) => {
      const r = prepareRun(scenario({ options: { rules } }), data)
      return r.ok ? [] : r.issues.map(i => [i.stage, i.message])
    }
    expect(issues({ forteKeepOnSwitchBy: { 丁: false } })).toEqual([['resolve', 'options.rules.forteKeepOnSwitchBy.丁：没有这个角色']])
    expect(issues({ forteKeepOnSwitchBy: { 甲: 'no' } })).toEqual([['resolve', 'options.rules.forteKeepOnSwitchBy.甲：应为 boolean']])
    expect(issues({ forteKeepOnSwitchBy: false })).toEqual([['resolve', 'options.rules.forteKeepOnSwitchBy：应为 object']])
    expect(issues({ forteKeepOnSwitchBy: null })).toEqual([['resolve', 'options.rules.forteKeepOnSwitchBy：应为 object']])
    expect(issues({ forteKeepOnSwitch: { 甲: false } })).toEqual([['resolve', 'options.rules.forteKeepOnSwitch：应为 boolean']])   // 漏写 By
    expect(issues({ toString: 1 })).toMatchObject([['resolve', expect.stringContaining('options.rules.toString：没有这条规则')]])
    // 覆盖的多段路径同样经装配校验
    const bad = prepareRun(scenario(), data, { rules: { 'forteKeepOnSwitchBy.丁': false } })
    expect(bad.ok ? [] : bad.issues.map(i => i.message)).toEqual(['options.rules.forteKeepOnSwitchBy.丁：没有这个角色'])
  })
})

describe('mergeRulePaths：规则路径的多段设值（DD-04 §4.2）', () => {
  test('C04-3 首段不是 Rules 的键时返回问题；与已有的 forteKeepOnSwitchBy: { 乙: false } 合并后两个键都在', () => {
    expect(mergeRulePaths(undefined, { 没有这条: 1 })).toMatchObject({ ok: false, issues: [expect.stringContaining('rules.没有这条：没有这条规则')] })
    expect(mergeRulePaths(undefined, { 'toString.x': 1 }).ok).toBe(false)                    // 原型链上的名字不是 Rules 的键
    expect(mergeRulePaths(undefined, { 'forteKeepOnSwitchBy.': false }).ok).toBe(false)       // 空段
    const base = { forteKeepOnSwitchBy: { 乙: false }, defFloor: true }
    expect(mergeRulePaths(base, { 'forteKeepOnSwitchBy.甲': false })).toEqual({ ok: true, rules: { forteKeepOnSwitchBy: { 乙: false, 甲: false }, defFloor: true } })
    expect(base).toEqual({ forteKeepOnSwitchBy: { 乙: false }, defFloor: true })              // 父对象逐层浅拷贝，调用方的对象不变
    // 经 prepareRun：场景里写了乙，覆盖再加甲，装配后两个都在、两个都清
    const { p, res } = run({ options: { rules: { forteKeepOnSwitchBy: { 乙: false } } } }, { rules: { 'forteKeepOnSwitchBy.甲': false } })
    expect(p.resolved.rules.forteKeepOnSwitchBy).toEqual({ 乙: false, 甲: false })
    expect(cleared(res)).toEqual(['甲', '乙'])
  })
})

// ---------------------------------------------------------------------------
// 台账自检（DD-04 §3）

const ALL: readonly Proposition[] = PROPOSITIONS
/** 场景选项的缺省值（schema 的 default） */
const OPTION_DEFAULTS = ScenarioSchema.shape.options.unwrap().parse({}) as Record<string, unknown>
/** 按路径读 Rules 里的值；按角色覆盖的表（forteKeepOnSwitchBy.<角色>、concertoTimingBy.<角色>）表里没有键时按共享的那条（DF-05、DD-08 §6） */
function ruleValue(rules: Readonly<Rules>, path: string): unknown {
  const [head, ...rest] = path.split('.')
  if (head === 'forteKeepOnSwitchBy' && rest.length === 1) return forteKept(rules, rest[0]!)
  if (rest.length === 1 && Object.hasOwn(PER_CHAR_RULES, head!)) {
    const by = rules[head as keyof typeof PER_CHAR_RULES] as Readonly<Record<string, unknown>>
    return Object.hasOwn(by, rest[0]!) ? by[rest[0]!] : rules[PER_CHAR_RULES[head as keyof typeof PER_CHAR_RULES]]
  }
  return path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], rules)
}
/** 按角色覆盖的表的路径（forteKeepOnSwitchBy.心、concertoTimingBy.卜灵）：角色就是 appliesToChars */
const perCharPath = (path: string): boolean => Object.hasOwn(PER_CHAR_RULES, path.split('.')[0]!) && path.split('.').length === 2
const defaultOf = (b: Binding): unknown => (b.kind === 'rule' ? ruleValue(DEFAULT_RULES, b.path!) : b.kind === 'option' ? OPTION_DEFAULTS[b.path!] : undefined)

describe('台账（DD-04 §3.1、§3.2）', () => {
  test('C04-4 ID 唯一；每条恰有一个候选是 adopted，rule / option 绑定的取值等于缺省值；rule 路径的首段是 Rules 的键；assumptionId 都在假设表里', () => {
    const ids = ALL.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of ALL) {
      expect([p.id, new Set(p.candidates.map(c => c.id)).size]).toEqual([p.id, p.candidates.length])
      const adopted = p.candidates.filter(c => c.id === p.adopted)
      expect([p.id, adopted.length]).toEqual([p.id, 1])
      const a = adopted[0]!
      expect([p.id, a.implemented]).toEqual([p.id, true])                                      // 采用的就是现在的代码
      if (a.binding.kind === 'rule' || a.binding.kind === 'option') expect([p.id, a.binding.value]).toEqual([p.id, defaultOf(a.binding)])
      for (const c of p.candidates) {
        const b = c.binding, at = `${p.id}/${c.id}`
        if (b.kind === 'rule' || b.kind === 'option') {
          expect([at, b.path !== undefined && b.value !== undefined, c.implemented]).toEqual([at, true, true])
          expect([at, b.kind === 'rule' ? Object.hasOwn(DEFAULT_RULES, b.path!.split('.')[0]!) : Object.hasOwn(OPTION_DEFAULTS, b.path!)]).toEqual([at, true])
        }
        // curated、hook 现在不能自动翻：只有当前采用的那个（照现在的代码跑），别的读法记 unimplemented（DD-04 §3.1）
        if (b.kind === 'curated' || b.kind === 'hook') expect([at, c.id === p.adopted, b.path !== undefined]).toEqual([at, true, true])
        if (b.kind === 'unimplemented') expect([at, c.implemented]).toEqual([at, false])
        // scenario：另一份场景（轴的输入不同的候选，DD-09 §5），文件要在 scenarios/ 下、能跑
        if (b.kind === 'scenario') expect([at, b.path !== undefined && existsSync(new URL(`../scenarios/${b.path}`, import.meta.url)), c.implemented, c.changes]).toEqual([at, true, true, 'input'])
      }
      if (p.assumptionId !== undefined) expect([p.id, ASSUMPTIONS.some(x => x.id === p.assumptionId)]).toEqual([p.id, true])
      if (p.scope === 'character') expect([p.id, (p.appliesToChars ?? []).length > 0]).toEqual([p.id, true])
      expect(propositionOf(p.id)).toBe(p)
    }
    expect(propositionOf('没有这条')).toBeUndefined()
  })

  test('C04-4 flipsOf() 的 15 个取值都在台账里：绑定相同的候选、假设 ID 对得上；共享的 forteKeepOnSwitch 落到两条按角色命题的 clear 上', () => {
    const flips = flipsOf()
    expect(flips).toHaveLength(15)
    for (const f of flips) {
      const [where, ...rest] = f.path.split('.')
      const kind = where === 'rules' ? 'rule' : 'option', path = rest.join('.')
      const same = ALL.flatMap(p => p.candidates.filter(c => c.binding.kind === kind && c.binding.path === path && c.binding.value === f.value).map(c => ({ p, c })))
      if (f.path === 'rules.forteKeepOnSwitch') {
        // AdjustPath 保留"两个一起翻"（DD-04 §4.1）；台账按角色拆成两条，翻旧开关时两条的当前生效候选经 forteKept 都是 clear（DF-05）
        expect(same).toEqual([])
        const rules: Rules = { ...DEFAULT_RULES, forteKeepOnSwitch: f.value as boolean }
        const split = ALL.filter(p => p.assumptionId === f.id)
        expect(split.map(p => p.id)).toEqual(['forte-keep.心-照世相', 'forte-keep.卜灵-卦象'])
        for (const p of split) {
          const now = p.candidates.filter(c => c.binding.kind === 'rule' && ruleValue(rules, c.binding.path!) === c.binding.value)
          expect([p.id, now.map(c => c.id)]).toEqual([p.id, ['clear']])
        }
        continue
      }
      expect([f.label, same.length]).toEqual([f.label, 1])
      expect([f.label, same[0]!.p.assumptionId, same[0]!.c.id === same[0]!.p.adopted]).toEqual([f.label, f.id, false])   // 翻的是另一个读法
    }
  })

  test('rule / option 绑定都能经 prepareRun 的覆盖落到装配结果上；forteKeepOnSwitchBy 的角色就是 appliesToChars', () => {
    const chars = [...new Set(ALL.flatMap(p => p.appliesToChars ?? []))]
    const gd = synthData([forteChar('甲'), forteChar('乙'), idle('丙'), ...chars.map(idle)])
    for (const p of ALL) for (const c of p.candidates) {
      const b = c.binding, at = `${p.id}/${c.id}`
      if (b.kind !== 'rule' && b.kind !== 'option') continue
      const o: RunOverrides = b.kind === 'rule' ? { rules: { [b.path!]: b.value! } } : { options: { [b.path!]: b.value } as RunOverrides['options'] }
      const r = prepareRun(scenario(), gd, o)
      expect([at, r.ok ? 'ok' : r.issues.map(i => i.message).join('；')]).toEqual([at, 'ok'])
      if (!r.ok) continue
      const got = b.kind === 'rule' ? ruleValue(r.run.resolved.rules, b.path!) : (r.run.resolved.options as unknown as Record<string, unknown>)[b.path!]
      expect([at, got]).toEqual([at, b.value])
      if (b.kind === 'rule' && perCharPath(b.path!)) expect([at, p.appliesToChars]).toEqual([at, [b.path!.split('.')[1]]])
    }
  })

  test('DD-05 §4.1 判定点表用到的 15 个命题 ID 都在台账里（PropositionId 是 DD-05 规则使用记录的键）', () => {
    const DD05: readonly PropositionId[] = [
      'switch-ends-stop', 'ult-input-locks-switch', 'invincible-locks-switch', 'echo-input-priority', 'input-delay', 'tune-break-mode',
      'hitstop-in-global-stop', 'def-floor', 'effect-tick-timer', 'effect-owner', 'interference-frames', 'summon-as-char',
      'forte-keep.心-照世相', 'forte-keep.卜灵-卦象', 'track-no-consume',
    ]
    for (const id of DD05) expect(propositionOf(id)?.id).toBe(id)
  })

  test('证据：有假设的命题各一条迁移来的依据（假设表 why 原文，用途未标注、三种关系都空）；证据 ID 全台账唯一，关系只指本命题的候选；只有迁移依据的结论是 unverified', () => {
    const evidenceIds = ALL.flatMap(p => p.evidence.map(e => e.id))
    expect(new Set(evidenceIds).size).toBe(evidenceIds.length)
    for (const p of ALL) {
      const legacy = p.evidence.filter(e => e.id.startsWith('legacy:'))
      const cands = new Set(p.candidates.map(c => c.id))
      for (const e of p.evidence) for (const id of [...e.supports, ...e.refutes, ...e.consistentWith]) expect([p.id, e.id, cands.has(id)]).toEqual([p.id, e.id, true])
      if (legacy.length === p.evidence.length) expect([p.id, p.conclusion]).toEqual([p.id, 'unverified'])   // DD-08 §4.1 决策表第 1 行
      if (p.assumptionId === undefined) { expect([p.id, legacy]).toEqual([p.id, []]); continue }   // DD-08 回填的命题：假设表里没有，证据只有闭环判出来的
      const a = ASSUMPTIONS.find(x => x.id === p.assumptionId)!
      expect([p.id, legacy]).toEqual([p.id, [{
        id: `legacy:${p.id}`, supports: [], refutes: [], consistentWith: [], purpose: 'unspecified',
        observation: { gameVersion: '未知', condition: `假设表 ${a.id} 的依据原文，没拆成逐条观测` }, summary: a.why, ref: a.ref,
      }]])
      expect([p.id, p.impact.dps]).toEqual([p.id, a.impact])                                    // 沿用假设表的 DPS 影响等级
    }
  })

  test('C08-11 台账里 supported 的命题只有 selection 证据：用途约束报错；真实台账没有违反的（DD-08 §4.3）', () => {
    const base = ALL.find(p => p.id === 'echo-input-priority')!
    const sel = { ...base.evidence[0]!, id: 'syn:sel', supports: [base.adopted], refutes: ['echo-table'], consistentWith: [], purpose: 'selection' as const }
    expect(evidenceViolations({ ...base, conclusion: 'supported', evidence: [sel] })).toHaveLength(1)
    expect(evidenceViolations({ ...base, conclusion: 'provisional', evidence: [sel] })).toEqual([])
    expect(evidenceViolations({ ...base, conclusion: 'supported', evidence: [sel, { ...sel, id: 'syn:ind', purpose: 'independent_validation' }] })).toEqual([])
    // 独立观测只是"相容"（consistentWith），不是 supports：仍然不能 supported
    expect(evidenceViolations({ ...base, conclusion: 'supported', evidence: [{ ...sel, purpose: 'independent_validation', supports: [], consistentWith: [base.adopted] }] })).toHaveLength(1)
    // 三种关系不混：同一个候选不能同时在两种关系里
    expect(evidenceViolations({ ...base, evidence: [{ ...sel, refutes: [base.adopted] }] })).toHaveLength(1)
    for (const p of ALL) expect([p.id, evidenceViolations(p)]).toEqual([p.id, []])
  })

  test('台账与闭环记录一致（DD-08 §4.1、§4.3）：判过的闭环，重判得到同样的判断与结论；台账这条命题的结论、来自它的证据条目与闭环算出的相同', () => {
    const points = CalibrationFileSchema.parse(parse(readFileSync(new URL('../docs/calibration/points.yaml', import.meta.url), 'utf8'))).points
    const dir = new URL('../docs/evidence/', import.meta.url)
    const files = readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()
    expect(files.length).toBeGreaterThanOrEqual(4)                                              // 三个回填 + 第一条新闭环（DD-08 §6、§5.5）
    for (const f of files) {
      const { record } = parseClosure(readFileSync(new URL(f, dir), 'utf8'), f)
      const p = ALL.find(x => x.id === record.propositionId)
      expect([f, p?.id]).toEqual([f, record.propositionId])
      const fromClosure = p!.evidence.filter(e => e.ref === `docs/evidence/${f}`)
      if (!record.conclusion) { expect([f, fromClosure]).toEqual([f, []]); continue }      // 还没判断的（实验等读数）不入账
      const j = judgeClosure(record, p!, points)
      expect([f, j.verdicts, j.conclusion]).toEqual([f, record.verdicts, record.conclusion])
      expect([f, p!.conclusion]).toEqual([f, j.conclusion.proposition])
      expect([f, fromClosure]).toEqual([f, evidenceFromClosure(record, j, p!, points)])
    }
  })
})

dataDescribe('台账与真实数据', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })

  test('appliesToChars 的角色名都在数据里', () => {
    for (const p of ALL) for (const c of p.appliesToChars ?? []) expect([p.id, c, gd.characters[c] !== undefined]).toEqual([p.id, c, true])
  })

  // 代表轴 m0-video-eq-不打谐破.yaml 要等 DD-02 的严格入口与 T04-9；在那之前用原场景关掉谐度破坏（同它的谐破口径）。T04-9 后换成正式的场景
  test('代表轴碰到的假设都有命题（DD-04 §3.2 第二类）：m0-video-eq.yaml 覆盖 tuneBreak: off', () => {
    const sc = ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/m0-video-eq.yaml', import.meta.url), 'utf8')))
    const p = prepareRun(sc, gd, { options: { tuneBreak: 'off' } })
    if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
    const res = runPrepared(p.run)
    expect(res.completion.status).toBe('completed')
    const covered = new Set<string>(ALL.flatMap(x => (x.assumptionId ? [x.assumptionId] : [])))
    const hit = res.summary.assumptions.map(a => a.id)
    expect(hit.length).toBeGreaterThan(0)
    expect(hit.filter(id => !covered.has(id))).toEqual([])
  }, 60_000)
})
