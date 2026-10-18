// tests/assumptions.test.ts —— 假设登记表（总设计 T16）：表本身、记录点、开关 rules.defFloor（TD-03 Q1）
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import type { BuffDefInput } from '../src/data/buff.schema'
import { DEFAULT_RULES, type GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { ASSUMPTIONS } from '../src/engine/assumptions'
import { defFactor } from '../src/engine/formula'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthRun, type SynthChar } from './helpers/synth'

// 记录点：引擎里的 assume()，角色模块里的 ctx.assume()
const codeOf = (dir: URL, skip = '') => readdirSync(dir).filter(f => f.endsWith('.ts') && f !== skip).map(f => readFileSync(new URL(f, dir), 'utf8'))
const engineCode = [...codeOf(new URL('../src/engine/', import.meta.url), 'assumptions.ts'), ...codeOf(new URL('../data/curated/characters/', import.meta.url))].join('\n')

describe('假设登记表', () => {
  test('编号不重复；碰到才记的在引擎或角色模块里有记录点，每次都适用的没有', () => {
    const ids = ASSUMPTIONS.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ASSUMPTIONS) expect([a.id, engineCode.includes(`'${a.id}'`)]).toEqual([a.id, a.tracked])
  })

  test('敏感度分析能翻的开关，指向存在的规则或场景选项', () => {
    const options = Object.keys(ScenarioSchema.shape.options.unwrap().shape)
    for (const a of ASSUMPTIONS) {
      const path = 'adjust' in a && 'path' in a.adjust ? a.adjust.path : undefined
      if (!path) continue
      const [where, key] = path.split('.') as [string, string]
      expect([path, where === 'rules' ? key in DEFAULT_RULES : options.includes(key)]).toEqual([path, true])
    }
  })
})

describe('钩子里记假设：ctx.assume（AGENTS.md 差异 6）', () => {
  test('角色模块的钩子碰到时记一笔：汇总里列出次数，同样的说明只记一次', () => {
    const X = action({ id: 'X', kind: 'skill', endFrame: 40, judgments: [judgment({ name: 'a', spawnFrame: 10, multiplier: 100 })] })
    const 甲: SynthChar = {
      name: '甲', actions: [X],
      hooks: { onEvent(ctx, ev) { if (ev.type === 'hit' && ev.char === '甲') ctx.assume('data-guess', '甲 钩子里推断的机制') } },
    }
    const r = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X X'] })
    expect(r.summary.assumptions.find(a => a.id === 'data-guess')).toMatchObject({ count: 2, detail: ['甲 钩子里推断的机制'] })
  })
})

describe('rules.defFloor：减防后的目标防御先取整（TD-03 Q1）', () => {
  test('defFactor：1593 × (1 − 0.18) = 1306.26，取整后按 1306 算', () => {
    const den = 800 + 90 * 8
    expect(defFactor(1593, -0.18, 0, 90, 2, true)).toBe(1 / (1306 / den + 1))
    expect(defFactor(1593, -0.18, 0, 90, 2, false)).toBeCloseTo(1 / (1306.26 / den + 1), 12)
    expect(defFactor(1593, 0, 0, 90, 2, true)).toBe(defFactor(1593, 0, 0, 90))   // 没有减防：防御本来就是整数
    // 同 xlsx：先对减防后的防御取整，再乘无视防御（不是乘完再取整）
    expect(defFactor(1593, -0.18, 0.1, 90, 2, true)).toBe(1 / (1306 * (1 - 0.1) / den + 1))
  })

  const X = action({ id: 'X', kind: 'skill', endFrame: 40, judgments: [judgment({ name: 'a', spawnFrame: 10, multiplier: 100 })] })
  const shred: BuffDefInput = { id: '甲.减防', source: 't', zone: 'TargetDefRate', value: -0.18, target: 'self', duration: 'inf', trigger: 'always' }
  const run = (withShred: boolean, rules?: Record<string, unknown>) => {
    const 甲: SynthChar = { name: '甲', actions: [X], ...(withShred ? { buffs: [shred] } : {}) }
    return synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X'], ...(rules ? { options: { rules } } : {}) })
  }

  test('有减防时才记 def-no-floor；改成先取整后防御更低、伤害更高', () => {
    expect(run(false).summary.assumptions.map(a => a.id)).not.toContain('def-no-floor')
    const plain = run(true)
    expect(plain.summary.assumptions.find(a => a.id === 'def-no-floor')).toMatchObject({ count: 1, detail: ['甲 a'] })
    const floored = run(true, { defFloor: true })
    const dmg = (r: typeof plain) => eventsOfLog(r.log, 'hit')[0]!.dmg!.expected
    expect(dmg(floored)).toBeGreaterThan(dmg(plain))
    expect(dmg(floored) / dmg(plain) - 1).toBeLessThan(0.001)               // 影响极小（< 0.1%）
  })
})

dataDescribe('M0 场景碰到的假设', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })

  test('代表轴：按表的顺序列出，有例子；M0 没有减防，不碰 def-no-floor', () => {
    const sc = ScenarioSchema.parse({
      team: [
        { char: '椿', chain: 0, weapon: { name: '千古洑流', rank: 5 } },
        { char: '散华', chain: 6, weapon: { name: '行进序曲', rank: 5 } },
        { char: '维里奈', chain: 3, weapon: { name: '奇幻变奏', rank: 5 } },
      ],
      enemy: { preset: '全息6/朔雷之鳞' },
      rotation: ['椿 E1 A1 A2 A3 A4 A5', 'switch 散华', '散华 E', 'switch 维里奈', '维里奈 E', 'switch 椿', '椿 A1 A2 A3'],
    })
    const s = simulate(resolveScenario(sc, gd)).summary
    const ids = s.assumptions.map(a => a.id)
    expect(ids).toEqual(ASSUMPTIONS.map(a => a.id).filter(id => ids.includes(id)))   // 表的顺序
    expect(ids).toContain('dilation-rules')
    expect(ids).not.toContain('def-no-floor')
    for (const a of s.assumptions) expect(a.count).toBeGreaterThan(0)
  })
})
