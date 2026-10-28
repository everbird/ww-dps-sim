// tests/sensitivity.test.ts —— 假设的开关（docs/engine-quality-plan.md P2）与敏感度矩阵：
// forteKeepOnSwitch、ultInputLocksSwitch、invincibleLocksSwitch 翻过来各自起作用；对照场景找得到基准。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData, Rules } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { baseOf, flipsOf, sensitivityMatrix } from '../src/engine/sensitivity'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario, SimEvent } from '../src/engine/types'
import { block, dataDescribe, run } from './helpers/kernel-harness'

let gd: GameData
const load = (f: string): ResolvedScenario =>
  resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8'))), gd)
const withRule = (r: ResolvedScenario, k: string, v: unknown): ResolvedScenario => ({ ...r, rules: { ...r.rules, [k]: v } })
const waits = (log: SimEvent[]) => log.filter((e): e is Extract<SimEvent, { type: 'wait' }> => e.type === 'wait')

describe('对照场景的基准', () => {
  test('最长的"名字-"前缀；没有就是 null', () => {
    const names = ['a', 'a-b', 'a-b-c', 'x']
    expect(baseOf('a-b-c', names)).toBe('a-b')
    expect(baseOf('a-b', names)).toBe('a')
    expect(baseOf('a', names)).toBeNull()
    expect(baseOf('ab', ['a'])).toBeNull()                      // 要有"-"
  })
  test('开关来自假设表的 adjust.path', () => {
    const ids = flipsOf().map(f => f.id)
    for (const id of ['forte-keep-on-switch', 'ult-no-switch', 'switch-no-lock']) expect(ids).toContain(id)
  })
})

dataDescribe('假设的开关', () => {
  beforeAll(async () => { gd = await loadGameData() })

  // 椿大招的全局时停（240 帧）盖过了"不响应输入"（239 帧），2026-10-22 起用卜灵：全局时停 231 帧之后还挡到 238 帧
  test('ultInputLocksSwitch = false：大招的"不响应输入"不再挡切人（心队卜灵大招后切雷主）', () => {
    const r = load('xin-team-r5.yaml')
    const on = simulate(r), off = simulate(withRule(r, 'ultInputLocksSwitch', false))
    expect(waits(on.log).some(w => w.reason.includes('不响应输入（按不能切人算）'))).toBe(true)
    expect(waits(off.log).some(w => w.reason.includes('不响应输入（按不能切人算）'))).toBe(false)
    expect(off.summary.assumptions.map(a => a.id)).not.toContain('ult-no-switch')
    // 卜灵第一次大招之后的那次切人提前（整段窗口长短会被后面的连锁变化盖过，2026-10-28 起只比这一次）
    const after = (log: typeof on.log) => {
      const ult = log.find(e => e.type === 'actionStart' && e.char === '卜灵' && e.action === '大招')!
      return log.find(e => e.type === 'switch' && e.f > ult.f)!.f
    }
    expect(after(off.log)).toBeLessThan(after(on.log))
  }, 60_000)

  test('invincibleLocksSwitch = false：雷主强化E（无敌推出来的第 123 帧锁）放完就能切；万阙垂天仍被全局时停（大招动画）挡住', () => {
    const l = block('雷主·男')
    const go = (rules: Partial<Rules>) => run([l, l, l], [{ act: 0, action: '强化E' }, { switch: 1 }], { rules })
    expect(go({}).s.log.filter(e => e.type === 'switch').map(e => e.f)).toEqual([123])
    expect(go({ invincibleLocksSwitch: false }).s.log.filter(e => e.type === 'switch').map(e => e.f)).toEqual([0])
    // 心队原轴：2026-10-22 起这类推断的锁都被全局时停盖住或用不到，关掉也一样
    const r = load('xin-team-r5.yaml')
    const on = simulate(r), off = simulate(withRule(r, 'invincibleLocksSwitch', false))
    expect(waits(off.log).some(w => w.code === 'globalStop' && w.reason.startsWith('照世·大招'))).toBe(true)
    expect(off.summary.steady!.dps).toBeCloseTo(on.summary.steady!.dps, 6)
  }, 60_000)

  test('forteKeepOnSwitch = false：卜灵切走清卦象，心切走回到应世相（按套路重排的轴因此跑不通）', () => {
    // 按套路重排：卜灵下落AAEA 后带着卦象切雷主放大招，再切回来出雷山小过
    const re = simulate(withRule(load('xin-team-r5-按套路重排.yaml'), 'forteKeepOnSwitch', false))
    const cleared = re.log.filter(e => e.type === 'resource' && e.char === '卜灵' && e.resource === 'core1' && e.delta < 0 && e.note?.includes('切走清卦象'))
    expect(cleared.length).toBeGreaterThan(0)
    expect(re.error?.code).toBe('timeout')
  }, 60_000)

  test('矩阵：对照比基准的收益，缺省与翻过来各一份', () => {
    const m = sensitivityMatrix([{ name: 'm0-video-eq', r: load('m0-video-eq.yaml') }, { name: 'm0-video-eq-维里奈Q后移', r: load('m0-video-eq-维里奈Q后移.yaml') }])
    expect(m.rows).toHaveLength(2)
    expect(m.pairs).toHaveLength(1)
    expect(m.pairs[0]).toMatchObject({ name: 'm0-video-eq-维里奈Q后移', base: 'm0-video-eq' })
    expect(m.pairs[0]!.gain!).toBeGreaterThan(0)
    expect(m.pairs[0]!.flips).toHaveLength(m.flips.length)
  }, 60_000)
})
