// tests/sensitivity.test.ts —— 假设的开关（docs/engine-quality-plan.md P2）与敏感度矩阵：
// forteKeepOnSwitch、ultInputLocksSwitch、invincibleLocksSwitch 翻过来各自起作用；对照场景找得到基准。依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { baseOf, flipsOf, sensitivityMatrix } from '../src/engine/sensitivity'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario, SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

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

  test('ultInputLocksSwitch = false：大招的"不响应输入"不再挡切人（M0 代表轴椿大招后切维里奈）', () => {
    const r = load('m0-team.yaml')
    const on = simulate(r), off = simulate(withRule(r, 'ultInputLocksSwitch', false))
    expect(waits(on.log).some(w => w.reason.includes('不响应输入（按不能切人算）'))).toBe(true)
    expect(waits(off.log).some(w => w.reason.includes('不响应输入（按不能切人算）'))).toBe(false)
    expect(off.summary.assumptions.map(a => a.id)).not.toContain('ult-no-switch')
    expect(off.summary.windowFrames).toBeLessThan(on.summary.windowFrames)
  })

  test('invincibleLocksSwitch = false：万阙垂天（无敌推出来的第 303 帧锁）放完就能切', () => {
    const r = load('xin-team-r5.yaml')
    const on = simulate(r), off = simulate(withRule(r, 'invincibleLocksSwitch', false))
    const locked = (x: typeof on) => waits(x.log).filter(w => w.code === 'switchLock' && w.reason.startsWith('照世·大招'))
    expect(locked(on).length).toBeGreaterThan(0)
    expect(locked(off)).toEqual([])
    expect(off.error).toBeUndefined()
  })

  test('forteKeepOnSwitch = false：卜灵切走清卦象，心切走回到应世相（按套路重排的轴因此跑不通）', () => {
    // 按套路重排：卜灵下落AAEA 后带着卦象切雷主放大招，再切回来出雷山小过
    const re = simulate(withRule(load('xin-team-r5-按套路重排.yaml'), 'forteKeepOnSwitch', false))
    const cleared = re.log.filter(e => e.type === 'resource' && e.char === '卜灵' && e.resource === 'core1' && e.delta < 0 && e.note?.includes('切走清卦象'))
    expect(cleared.length).toBeGreaterThan(0)
    expect(re.error?.code).toBe('timeout')
  })

  test('矩阵：对照比基准的收益，缺省与翻过来各一份', () => {
    const m = sensitivityMatrix([{ name: 'm0-video-eq', r: load('m0-video-eq.yaml') }, { name: 'm0-video-eq-维里奈Q后移', r: load('m0-video-eq-维里奈Q后移.yaml') }])
    expect(m.rows).toHaveLength(2)
    expect(m.pairs).toHaveLength(1)
    expect(m.pairs[0]).toMatchObject({ name: 'm0-video-eq-维里奈Q后移', base: 'm0-video-eq' })
    expect(m.pairs[0]!.gain!).toBeGreaterThan(0)
    expect(m.pairs[0]!.flips).toHaveLength(m.flips.length)
  })
})
