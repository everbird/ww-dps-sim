// tests/jys.test.ts —— 景燃 · 尤诺 · 守岸人（2026-10-24，docs/jys-confirm.md）：引擎新加的护盾事件、按属性换算的 buff、
// 变奏动作随状态换（introAction）、并入别组的行（absorb）、触发时加几层（TriggerSpec.stacks），以及三人模块的主要机制。
// 依赖 data/generated（缺数据时跳过）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario, scaledValue } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { SimEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

describe('按属性换算（BuffDef.scale）', () => {
  const stats = { hp: 39881, atk: 1000, def: 0, energyRegen: 2.6464 }
  test('取整的按整千算，有上限；不取整的按比例', () => {
    expect(scaledValue({ stat: 'hp', per: 1000, floor: true, cap: 0.75 }, 0.015, stats)).toBeCloseTo(0.585, 9)   // 39 层
    expect(scaledValue({ stat: 'hp', per: 1000, floor: true, cap: 1800 }, 36, stats)).toBe(1404)
    expect(scaledValue({ stat: 'hp', per: 1000, floor: true, cap: 1800 }, 36, { ...stats, hp: 60000 })).toBe(1800)
    expect(scaledValue({ stat: 'energyRegen', per: 0.002, offset: 0.1 }, 0.0001, { ...stats, energyRegen: 1.9 })).toBeCloseTo(0.1, 9)
    expect(scaledValue({ stat: 'energyRegen', per: 0.002, offset: 0.1, cap: 0.125 }, 0.0001, stats)).toBe(0.125)
  })
})

dataDescribe('景尤守', () => {
  let gd: GameData
  let log: SimEvent[]
  const sc = () => ScenarioSchema.parse(parse(readFileSync(new URL('../scenarios/jys-team.yaml', import.meta.url), 'utf8')))
  beforeAll(async () => {
    gd = await loadGameData()
    const out = simulate(resolveScenario(sc(), gd))
    expect(out.error).toBeUndefined()
    log = out.log
  }, 60_000)
  const loops = () => log.flatMap(e => (e.type === 'loop' ? [e.f] : []))
  /** 第 2 轮里的事件 */
  const loop2 = () => { const l = loops(); return log.filter(e => e.f >= l[1]! && e.f < l[2]!) }

  test('装配：生命上限换算的攻击 / 热熔加成；守岸人星域按共鸣效率到上限；E-地面并进了五只黯星·蝶、人在地面', () => {
    const r = resolveScenario(sc(), gd)
    const v = (id: string) => r.buffs.find(b => b.def.id === id)!.value
    const hp = r.team[0].stats.hp
    expect(v('景燃.阳变阴合')).toBe(Math.min(1800, 36 * Math.floor(hp / 1000)))
    expect(v('景燃.幽而复明')).toBeCloseTo(Math.min(0.75, 0.015 * Math.floor(hp / 1000)), 9)
    expect(v('守岸人.深潜星域')).toBe(0.125)
    expect(v('守岸人.解限星域')).toBe(0.25)
    const e = r.team[2].actions['E-地面']!
    expect(e.judgments.filter(j => j.name.startsWith('E-黯星·蝶')).length).toBe(5)
    expect(e.air).toBeUndefined()
  })

  test('星域：尤诺变奏 → 深潜，景燃变奏 → 解限，守岸人变奏是洞悉（强化QTE）', () => {
    const ev = loop2()
    const intros = ev.flatMap(e => (e.type === 'intro' ? [`${e.char} ${e.action}`] : []))
    expect(intros).toEqual(['尤诺 QTE', '景燃 QTE', '守岸人 强化QTE'])
    const applied = ev.flatMap(e => (e.type === 'buffApply' && e.target === '景燃' && /星域$/.test(e.buff) ? [e.buff] : []))
    expect(applied).toEqual(['守岸人.深潜星域', '守岸人.解限星域'])
  })

  test('护盾：尤诺每个动作给自己护盾；景燃变奏时鬼护满 50 转成 50 层祸兮福兮；满月领域里景燃的祝颂叠到 10 层', () => {
    const ev = loop2()
    expect(ev.some(e => e.type === 'shield' && e.char === '尤诺' && e.source === '固有技能·盈昇')).toBe(true)
    expect(ev.find(e => e.type === 'buffApply' && e.buff === '景燃.祸兮福兮')).toMatchObject({ stacks: 50 })
    const blessing = ev.flatMap(e => (e.type === 'buffApply' && e.buff === '尤诺.苍白死光的祝颂' && e.target === '景燃' ? [e.stacks] : []))
    expect(Math.max(...blessing)).toBe(10)
    // 万物持存的注释：施放变奏时无视防御直接满 5 层（TriggerSpec.stacks）
    expect(ev.find(e => e.type === 'buffApply' && e.buff === '万物持存的注释.无视防御')).toMatchObject({ stacks: 5 })
  })

  test('景燃：一次荧惑里 4 下重击、各召一次魑魅魍魉，命火 100 用完；两个 E 一阳一阴', () => {
    const ev = loop2()
    const heavies = ev.flatMap(e => (e.type === 'actionStart' && e.char === '景燃' && /重击$/.test(e.action) ? [e.action] : []))
    expect(heavies).toEqual(['阳重击', '阴重击', '阳重击', '阴重击'])
    expect(ev.filter(e => e.type === 'judgmentSpawn' && e.judgment === '魑魅魍魉').length).toBe(4)
    const fire = ev.flatMap(e => (e.type === 'resource' && e.char === '景燃' && e.resource === 'core2' ? [e.delta] : []))
    expect(fire).toEqual([100, -25, -25, -25, -25])
    expect(ev.flatMap(e => (e.type === 'actionStart' && /E1$/.test(e.action) ? [e.action] : []))).toEqual(['阳E1', '阴E1'])
  })

  test('尤诺：至臻的完满前协奏满、灵性用完；箭矢命中生成爆炸', () => {
    const ev = loop2()
    const spirit = ev.filter(e => e.type === 'resource' && e.char === '尤诺' && e.resource === 'core1')
    expect(spirit.at(-1)).toMatchObject({ value: 0 })
    expect(ev.some(e => e.type === 'actionStart' && e.action === '至臻完满')).toBe(true)
    expect(ev.filter(e => e.type === 'hit' && e.judgment === '强化弓A2-爆炸').length).toBe(3)   // 三支箭各一次
  })
})
