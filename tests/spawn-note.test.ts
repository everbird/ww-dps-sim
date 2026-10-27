// tests/spawn-note.test.ts —— 备注"命中后立即生成X""持续帧结束后自行生成X"推出的 spawns（AGENTS 差异第 37 条）：
// 装配从备注推出要生成的事件判定（flag spawnFromNote），引擎在来源判定第一次结算后 / 自然到期时生成；模块写 spawns: null 的由钩子自己生成。
// 依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario, SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

const load = (gd: GameData, f: string): ResolvedScenario =>
  resolveScenario(ScenarioSchema.parse(parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')) as ScenarioInput), gd)
const judg = (r: ResolvedScenario, who: string, action: string, name: string) =>
  r.team.find(m => m.def.name === who)!.actions[action]!.judgments.find(j => j.name === name)!

dataDescribe('备注推出的事件判定生成', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })

  test('装配：露帕破敌投枪命中生成 E3-伤害，嘉贝莉娜迫近的跳到期生成爆炸；尤诺的箭矢、卜灵的开阵前置由钩子生成（spawns: null）', () => {
    const fire = load(gd, 'fire-tower1-video.yaml')
    const lupa = judg(fire, '露帕', 'E3', 'E3-投枪')
    expect(lupa.spawns).toEqual({ on: 'hit', judgments: ['E3-伤害'] })
    expect(lupa.flags).toContain('spawnFromNote')
    expect(judg(fire, '嘉贝莉娜', 'E1', 'E1-跳').spawns).toEqual({ on: 'end', judgments: ['E1-爆炸'] })
    const jys = load(gd, 'jys-team.yaml')
    expect(judg(jys, '尤诺', '弓A1', '弓A1-箭矢').spawns).toBeNull()
    const xin = load(gd, 'xin-team-r5.yaml')
    expect(judg(xin, '卜灵', '大招', '大招-开阵前置').spawns).toBeNull()
  })

  test('引擎：每次破敌、迫近都生成一次；到期生成的在来源判定持续帧走完那一刻生成', () => {
    const r = load(gd, 'fire-tower1-video.yaml')
    const log = simulate(r).log
    const of = <T extends SimEvent['type']>(t: T) => log.filter((e): e is Extract<SimEvent, { type: T }> => e.type === t)
    const starts = (who: string, a: string) => of('actionStart').filter(e => e.char === who && e.action === a)
    const spawns = (who: string, j: string) => of('judgmentSpawn').filter(e => e.char === who && e.judgment === j)
    expect(spawns('露帕', 'E3-伤害').length).toBe(starts('露帕', 'E3').length)
    expect(spawns('嘉贝莉娜', 'E1-爆炸').length).toBe(starts('嘉贝莉娜', 'E1').length)
    const jump = spawns('嘉贝莉娜', 'E1-跳')[0]!, boom = spawns('嘉贝莉娜', 'E1-爆炸')[0]!
    expect(boom.f - jump.f).toBe(judg(r, '嘉贝莉娜', 'E1', 'E1-跳').lifeFrames - 1)   // 生成的那一帧算第 1 帧，走完最后一帧的 tick 末尾消失、生成爆炸
  })

  test('声骸也生成：梦魇·云闪之鳞的标枪爆炸（405%）每次扔标枪一次', () => {
    const log = simulate(load(gd, 'tys-video.yaml')).log
    const throws = log.filter(e => e.type === 'actionStart' && e.char === '渊武' && e.action === 'Q·扔标枪').length
    expect(throws).toBeGreaterThan(0)
    expect(log.filter(e => e.type === 'hit' && e.char === '渊武' && e.judgment === '标枪爆炸').length).toBe(throws)
  })
})
