// tests/m0-team.test.ts —— M0 三人的角色钩子（TD-08 §5、§6；结论见 m0-confirm §6）
// 依赖 data/generated（缺数据时跳过）。
import { beforeAll, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { composeStat } from '../src/engine/formula'
import { resolveScenario } from '../src/engine/resolve'
import { dataDescribe } from './helpers/kernel-harness'
import { M0, m0Run } from './helpers/m0'
import { eventsOfLog } from './helpers/synth'

let gd: GameData

dataDescribe('M0 三人的钩子', () => {
  beforeAll(async () => { gd = await loadGameData() })

  // ---------------------------------------------------------------------------
  // 散华

  test('T08-散华-1 冰在技能判定生成时出现，存在时间按 xlsx；重击居合第 29 帧引爆场上所有的冰', () => {
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E 重击居合'] })
    const ice = eventsOfLog(out.log, 'buffApply').find(e => e.buff === '散华.冰棱')!
    expect([ice.f, ice.target, ice.remaining]).toEqual([19, 'enemy', 342])
    const start = eventsOfLog(out.log, 'actionStart').find(e => e.action === '重击居合')!.f
    const boom = eventsOfLog(out.log, 'hit').find(h => h.judgment === 'E-引爆冰棱')!
    expect(boom.f).toBe(start + 29)
    expect(boom.buffs).toContain('散华.共鸣链5')                                // 冰绽暴伤 +100%
    expect(boom.gains.concerto).toBe(15)                                          // 引爆自己的协奏
    expect(eventsOfLog(out.log, 'buffExpire').find(e => e.buff === '散华.冰棱')!.reason).toBe('removed')
    // 6 链：引爆后全队攻击 +10%，之后的第二段爆裂吃得到
    expect(eventsOfLog(out.log, 'hit').find(h => h.judgment === '重击居合-2')!.buffs).toContain('散华.共鸣链6')
  })

  test('T08-散华-2 同时引爆冰棱与冰川：冰绽两段，6 链直接 2 层', () => {
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E', '散华 R', '散华 重击居合'] })
    const booms = eventsOfLog(out.log, 'hit').filter(h => h.judgment.includes('引爆'))
    expect(booms.map(h => h.judgment).sort()).toEqual(['E-引爆冰棱', '大招-引爆冰川'])
    expect(new Set(booms.map(h => h.f)).size).toBe(1)
    const c6 = eventsOfLog(out.log, 'buffApply').filter(e => e.buff === '散华.共鸣链6' && e.target === '散华')
    expect(c6.map(e => e.stacks)).toEqual([1, 2])
  })

  test('T08-散华-3 共鸣链5：没被引爆的冰在消失时直接爆炸', () => {
    const out = m0Run(gd, { initial: { onField: 1 }, rotation: ['散华 E', 'wait 400'] })
    const expire = eventsOfLog(out.log, 'buffExpire').find(e => e.buff === '散华.冰棱')!
    expect(expire.reason).toBe('timeout')
    const boom = eventsOfLog(out.log, 'hit').find(h => h.judgment === 'E-引爆冰棱')!
    expect(boom.f).toBe(expire.f + 1)                                             // 到期在 P6，下一帧结算
  })

  // ---------------------------------------------------------------------------
  // 椿

  test('T08-椿-1 盛绽：E1 进入后普攻换成盛绽版本，E2 退出；协奏满时共鸣技能是一日花', () => {
    const bad = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 E1', '椿 A1'], options: { maxWait: 150 } })
    expect(bad.error!.message).toContain('盛绽状态下 A1 换成了盛绽版本')
    const ok = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 E1', '椿 盛绽·A1', '椿 E2', '椿 A1'] })
    expect(ok.error).toBeUndefined()
    const full = m0Run(gd, { initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['椿 E1'], options: { maxWait: 60 } })
    expect(full.error!.message).toContain('协奏满时共鸣技能是一日花')
    const e3 = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 E3'], options: { maxWait: 60 } })
    expect(e3.error!.message).toContain('一日花要协奏满')
  })

  test('T08-椿-2 红椿·蕾 → 酣梦：每耗 10 点蕊得 1 层，一日花时清空并折算；含苞中倍率 + 倍率 × 5% × (10 + 层数)', () => {
    // 散华协奏满切椿：变奏给 100 蕊；A1 A2 A3 共耗 30.23 点蕊 → 3 层；协奏已满，接一日花
    const sc = { initial: { onField: 1 as const, concerto: [100, 100, 0] as [number, number, number] }, rotation: ['switch 椿', '椿 A1 A2 A3', '椿 E3', '椿 A1'] }
    const out = m0Run(gd, sc)
    const buds = eventsOfLog(out.log, 'buffApply').filter(e => e.buff === '椿.红椿·蕾')
    expect(buds.map(e => e.stacks)).toEqual([1, 2, 3])
    const e3 = eventsOfLog(out.log, 'actionStart').find(e => e.action === 'E3')!.f
    expect(eventsOfLog(out.log, 'buffExpire').find(e => e.buff === '椿.红椿·蕾')).toMatchObject({ f: e3, reason: 'removed' })
    // 含苞中的 A1：基础项 = (倍率 + formula.rate × 13) × 攻击；攻击含千古洑流.攻击（一日花是共鸣技能）一层 12%
    const a1 = gd.characters['椿']!.actions['A1']!.judgments[0]!
    const panel = resolveScenario(ScenarioSchema.parse({ team: M0, enemy: { preset: '全息6/朔雷之鳞' }, ...sc }), gd).team[0].panel
    const hit = eventsOfLog(out.log, 'hit').filter(h => h.judgment === 'A1').at(-1)!
    expect(hit.factors!.base / composeStat(panel.atk, 0.12, 0)).toBeCloseTo(a1.multiplier + a1.formula!.rate * 13, 9)
  })

  test('T08-椿-3 回能：消耗蕊时自己那份 ×2.5，含苞中自己 ×0，队友始终按 50% 照常', () => {
    const out = m0Run(gd, { initial: { onField: 0, energy: 'empty', concerto: [100, 0, 0] }, rotation: ['椿 E3', 'wait 600', '椿 A1', 'wait 400', '椿 A1'] })
    const [inBud, after] = eventsOfLog(out.log, 'hit').filter(h => h.judgment === 'A1')
    expect(inBud!.gains.energy['椿']).toBeUndefined()                             // 含苞中自己拿不到
    expect(inBud!.gains.energy['散华']).toBeCloseTo(0.93 * 0.5 * 1.5184, 9)
    expect(after!.gains.energy['椿']).toBeCloseTo(0.93 * 2.5 * 1.256, 9)         // 含苞已到期，蕊还在：×2.5
    expect(after!.gains.energy['散华']).toBeCloseTo(0.93 * 0.5 * 1.5184, 9)
  })

  test('T08-椿-4 含苞：切人清除；切走那一刻在含苞中 → 延奏打含苞 + 含苞追加，否则只打普通', () => {
    // 一日花的协奏消耗改成 0，好让椿在含苞中协奏满着切走（只为测版本选择）
    const c = gd.characters['椿']!
    const e3 = c.actions['E3']!
    const data = { ...gd, characters: { ...gd.characters, 椿: { ...c, actions: { ...c.actions, E3: { ...e3, castGains: e3.castGains.filter(g => g.resource !== 'concerto') } } } } }
    const bud = m0Run(data, { initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['椿 E3', 'switch 散华'] })
    expect(eventsOfLog(bud.log, 'buffExpire').find(e => e.buff === '椿.含苞')!.reason).toBe('switchOut')
    expect(eventsOfLog(bud.log, 'hit').filter(h => h.char === '椿' && h.action === '延奏').map(h => h.judgment))
      .toEqual(['延奏-C0含苞', '延奏-C0含苞追加'])
    const plain = m0Run(gd, { initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['switch 散华'] })
    expect(eventsOfLog(plain.log, 'hit').filter(h => h.char === '椿' && h.action === '延奏').map(h => h.judgment))
      .toEqual(['延奏-C0普通'])
  })

  // ---------------------------------------------------------------------------
  // 维里奈

  test('T08-维里奈-1 变奏：冲刺第 53 帧接撞击，撞击第 9 帧造成伤害', () => {
    const out = m0Run(gd, { initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['switch 维里奈'] })
    expect(eventsOfLog(out.log, 'actionStart').map(e => [e.f, e.action])).toEqual([[0, 'QTE'], [53, 'QTE-撞']])
    expect(eventsOfLog(out.log, 'hit').find(h => h.judgment === 'QTE-撞')!.f).toBe(63)
  })

  test('T08-维里奈-2 重击：没有光合能量是普通重击，有就是强化重击（−1 光合、+12 协奏），各自接撞击', () => {
    const plain = m0Run(gd, { initial: { onField: 2 }, rotation: ['维里奈 重击-冲'] })
    expect(eventsOfLog(plain.log, 'actionStart').map(e => e.action)).toEqual(['重击-冲', '重击-撞'])
    const wait = m0Run(gd, { initial: { onField: 2 }, rotation: ['维里奈 重击'], options: { maxWait: 30 } })
    expect(wait.error!.message).toContain('强化重击要光合能量')
    // E 给 1 层，3 链有 C2 再给 1 层 → 2 层
    const strong = m0Run(gd, { initial: { onField: 2 }, rotation: ['维里奈 E', '维里奈 重击'] })
    expect(eventsOfLog(strong.log, 'actionStart').map(e => e.action)).toEqual(['E', '重击', '重击-强化撞1'])
    const f = eventsOfLog(strong.log, 'actionStart').find(e => e.action === '重击')!.f
    expect(eventsOfLog(strong.log, 'resource').filter(e => e.f === f && e.char === '维里奈').map(e => [e.resource, e.delta]))
      .toContainEqual(['concerto', 12])
    expect(eventsOfLog(strong.log, 'hit').find(h => h.judgment === '重击-强化冲')!.gains.core[0]).toBe(-1)
  })

  test('T08-维里奈-4 治疗事件（nanoka 3.7 写了回复生命 / 有治疗量的）：星星花绽放、大招、协同攻击结算时各记一次；延奏盛放每秒一跳、共鸣链1 每 5 秒一跳，各 6 跳', () => {
    const bf = (e: { t: number }) => Math.round(e.t * 60)
    const out = m0Run(gd, { initial: { onField: 2, concerto: [0, 0, 100] }, rotation: ['维里奈 E', '维里奈 重击 R', 'switch 散华', 'wait 1900'], options: { maxWait: 2000 } })
    expect(out.error).toBeUndefined()
    const heals = eventsOfLog(out.log, 'heal')
    expect(heals.every(h => h.char === '维里奈')).toBe(true)
    expect(heals.filter(h => !['延奏-盛放', '共鸣链1'].includes(h.source)).map(h => h.source).slice(0, 3)).toEqual(['重击-强化冲', '大招-标记', '大招-协同伤害'])
    expect(heals.find(h => h.source === '大招-标记')!.f).toBe(eventsOfLog(out.log, 'hit').find(h => h.judgment === '大招-标记')!.f)
    // 计时 buff 施加那一帧算第 1 帧（TD-07），所以第一跳在延奏后第 59 帧，之后每 60 / 300 帧一跳
    const o = bf(eventsOfLog(out.log, 'outro').find(e => e.char === '维里奈')!)
    expect(heals.filter(h => h.source === '延奏-盛放').map(h => bf(h) - o)).toEqual([59, 119, 179, 239, 299, 359])
    expect(heals.filter(h => h.source === '共鸣链1').map(h => bf(h) - o)).toEqual([299, 599, 899, 1199, 1499, 1799])
  })

  test('T08-维里奈-3 光合标记 12 秒；任何人命中带标记的目标都触发协同攻击，全队共用 1 秒冷却', () => {
    const out = m0Run(gd, { initial: { onField: 2 }, rotation: ['维里奈 R', 'switch 散华', '散华 E A1 A2'] })
    const mark = eventsOfLog(out.log, 'buffApply').find(e => e.buff === '维里奈.光合标记')!
    expect(mark.remaining).toBe(720)
    const coord = eventsOfLog(out.log, 'hit').filter(h => h.judgment === '大招-协同伤害')
    expect(coord.length).toBeGreaterThanOrEqual(2)
    expect(coord[0]!.f).toBe(mark.f)                                              // 大招-标记自己的命中就触发
    const gaps = coord.slice(1).map((h, i) => Math.round(h.t * 60) - Math.round(coord[i]!.t * 60))
    expect(gaps.every(g => g >= 60)).toBe(true)
  })
})
