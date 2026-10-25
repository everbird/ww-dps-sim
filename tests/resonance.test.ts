// tests/resonance.test.ts —— 偏移 / 干涉 / 响应（TD-06 §19，2026-10-25 爱弥斯 · 琳奈 · 莫宁）：钩子挂偏移、谐度破坏命中挂着震谐·偏移的目标
// → 震谐·干涉（偏移消耗、偏谐值不累积）、队里有"震谐响应"动作的角色在后台也各出一次响应（8 秒一次）、响应按谐度破坏的公式算。
// 人造角色，不依赖生成数据
import { describe, expect, test } from 'vitest'
import type { TuneBreakTable } from '../src/data/gamedata'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { SimResult } from '../src/engine/types'
import { action, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, type SynthChar } from './helpers/synth'

const TABLE: TuneBreakTable = {
  variants: [], baseByLevel: Array.from({ length: 100 }, (_, i) => (i === 89 ? 10000 : 0)), costFactor: { 1: 1, 3: 1, 4: 1 },
  rules: { lockFrames: { 1: 360, 3: 360, 4: 180 }, buttonFrames: 600 },
}
const response = (name: string, element: '热熔' | '衍射', multiplier: number) => action({
  id: '震谐响应', kind: 'other', endFrame: 1,
  judgments: [judgment({ name, spawnFrame: 0, multiplier, element, tags: ['震谐响应'] })],
})

// 甲：X 第 10 帧命中（偏谐值 50）；S 起手挂 25 秒震谐·偏移（钩子）；谐度破坏第 20 帧一段（倍率 16）；甲、乙有响应，丙没有
const 甲: SynthChar = {
  name: '甲',
  actions: [
    action({ id: 'X', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gauges: { toughness: 0, tunability: 50 } })] }),
    action({ id: 'S', endFrame: 30 }),
    action({
      id: '谐度破坏', kind: 'tuneBreak', endFrame: 40, priority: [{ fromFrame: 0, value: 11 }],
      judgments: [judgment({ name: '谐度破坏-1', spawnFrame: 20, multiplier: 16, tags: ['谐度破坏'] })],
    }),
    response('甲响应', '热熔', 6),
  ],
  hooks: { onEvent: (ctx, ev) => { if (ev.type === 'actionStart' && ev.action === 'S') ctx.applyShift('震谐', 1500, '甲 S') } },
}
const 乙: SynthChar = { name: '乙', actions: [response('乙响应', '衍射', 18)] }

function run(sc: Partial<ScenarioInput>): SimResult {
  const data = synthData([甲, 乙, idle('丙')])
  data.tuneBreak = TABLE
  data.characters['甲']!.tunabilityRate = 1
  return simulate(resolveScenario(ScenarioSchema.parse({
    team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
    enemy: { custom: { level: 90, tunabilityMax: 100, whiteBar: 0, paralysisSec: 1 } }, ...sc,
  }), data))
}
const states = (r: SimResult) => eventsOfLog(r.log, 'enemyState').map(e => (e.by ? `${e.change}:${e.by}` : e.change))

describe('TD-06 §19 偏移 / 干涉 / 响应', () => {
  test('挂着震谐·偏移时谐度破坏 → 震谐·干涉，偏移消耗掉；甲、乙各响应一次（乙在后台），丙没有响应动作', () => {
    const r = run({ rotation: ['甲 S', '甲 X', '甲 X', '甲 X'] })
    expect(r.error).toBeUndefined()
    expect(states(r)).toEqual(['shift:甲', 'disharmony', 'harmonyBreak', 'interference:甲', 'response:甲', 'response:乙'])
    const hits = eventsOfLog(r.log, 'hit').filter(h => h.judgment.endsWith('响应'))
    expect(hits.map(h => `${h.char} ${h.judgment}`)).toEqual(['甲 甲响应', '乙 乙响应'])
    // 响应按谐度破坏的公式：10000 × 倍率 × 防御系数 × 行上元素的抗性（自定义敌人缺省 10%），没有"目标未失谐"这一项，不暴击
    const def = 1520 / (1520 + 1512)
    expect(hits[0]!.dmg!.expected).toBe(Math.ceil(10000 * 6 * def * 0.9))
    expect(hits[1]!.dmg!.expected).toBe(Math.ceil(10000 * 18 * def * 0.9))
    expect(hits[1]!.dmg!.crit).toBe(hits[1]!.dmg!.nonCrit)
    expect(r.summary.assumptions.map(a => a.id)).toContain('resonance-rules')
  })

  test('干涉期间（8 秒）偏谐值不累积；到时 interferenceEnd', () => {
    const r = run({ rotation: ['甲 S', '甲 X', '甲 X', '甲 X', 'wait 600', '甲 X'] })
    const ev = eventsOfLog(r.log, 'enemyState')
    const at = (c: string) => ev.find(e => e.change === c)!.t
    expect(at('interferenceEnd') - at('interference')).toBeCloseTo(8, 1)
    // 谐度破坏后第 1 下 X 在干涉期间：偏谐值仍是 0
    const hb = r.log.indexOf(ev.find(e => e.change === 'harmonyBreak')!)
    const next = eventsOfLog(r.log, 'hit').find(h => r.log.indexOf(h) > hb && h.judgment === 'x')!
    expect(next.enemy!.tunability).toBe(0)
  })

  test('没挂偏移：谐度破坏只造成伤害，没有干涉与响应', () => {
    const r = run({ rotation: ['甲 X', '甲 X', '甲 X'] })
    expect(states(r)).toEqual(['disharmony', 'harmonyBreak'])
    expect(eventsOfLog(r.log, 'hit').some(h => h.judgment.endsWith('响应'))).toBe(false)
  })

  test('偏移到时就掉（shiftEnd），之后的谐度破坏不触发干涉', () => {
    const r = run({ rotation: ['甲 S', 'wait 1600', '甲 X', '甲 X', '甲 X'] })
    expect(states(r)).toEqual(['shift:甲', 'shiftEnd', 'disharmony', 'harmonyBreak'])
  })

  test('同一角色 8 秒内只响应一次（responseCooldown）', () => {
    // 干涉缩到 1 秒、响应冷却拉长到 40 秒：等过谐破冷却（6 秒）再来一次，第二次谐度破坏落在响应冷却里 → 只有干涉、没有响应
    const r = run({
      rotation: ['甲 S', '甲 X', '甲 X', '甲 X', 'wait 400', '甲 S', '甲 X', '甲 X', '甲 X'],
      options: { rules: { interferenceFrames: 60, responseCooldown: 2400 } },
    })
    expect(states(r).filter(x => x.startsWith('interference:') || x.startsWith('response:')))
      .toEqual(['interference:甲', 'response:甲', 'response:乙', 'interference:甲'])
  })
})
