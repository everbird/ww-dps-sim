// tests/echoes.test.ts —— 声骸（TD-01 §8、§13.3；AGENTS.md 差异 1、2）：声骸动作的装配、按体型挑行、首位声骸并入动作表（别名 Q）、
// 声骸冷却与按次数充能、多段声骸、触发条件 ownerHas / heals、M0 三人的首位声骸与套装（docs/test-echos-setup.md）。
// 装配规则与引擎机制用人造数据，总能跑；其余依赖 data/generated（没有时跳过）。
import { beforeAll, describe, expect, test } from 'vitest'
import { assembleEchoActions, echoActionsFor } from '../src/data/assemble-echo'
import type { BuffDefInput } from '../src/data/buff.schema'
import type { GameData } from '../src/data/gamedata'
import type { GenEcho, GenEchoGroup, GenRow } from '../src/data/generated.schema'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { composeStat } from '../src/engine/formula'
import { ResolveError, resolveScenario } from '../src/engine/resolve'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { M0, m0Run } from './helpers/m0'
import { eventsOfLog, idle, synthRun } from './helpers/synth'

const row = (n: number, name: string, o: Partial<GenRow> = {}): GenRow => ({
  row: n, name, kind: 'hit', eventSpawned: false, spawnFrame: 10, birthFrame: null, lifeFrames: 6,
  hitstop: { self: null, enemy: null }, deriveFrame: null, deriveDuration: null, endFrame: null,
  priority: [0], priorityChange: null, parry: null, persists: true, followHitstop: null, toughness: 10, tunability: null,
  gains: { energy: { total: 1 }, concerto: null, core: [null, null, null] }, position: null, positionChange: null, dilation: null,
  hitTarget: null, note: null, noteMerged: false, hints: {}, nameTags: {}, flags: [], ...o,
})
const group = (id: string, rows: GenRow[], o: Partial<GenEchoGroup> = {}): GenEchoGroup => ({
  id, variant: 1, stage: null, body: null, kind: '变身', cooldown: null, next: null, rows, ...o,
})
const echo = (key: string, groups: GenEcho['groups'], o: Partial<GenEcho> = {}): GenEcho => ({
  key, startRow: 1, cost: 4, description: null, descCooldown: null, textKind: null, ignoredRows: 0, groups, flags: [], ...o,
})
const bf = (e: { t: number }) => Math.round(e.t * 60)       // 事件的战斗帧

describe('声骸动作的装配（人造数据）', () => {
  test('多段：冷却只在第一段；后续段接在上一段的窗口里，冷却键用自己的 ID；类别 echo、标签缺省声骸技能', () => {
    const e = echo('甲', [
      group('A1', [row(1, 'A1', { endFrame: 73 })], { stage: 1, cooldown: 1200, next: { from: 30, until: 75 } }),
      group('A2', [row(2, 'A2', { endFrame: 90, priority: [1] })], { stage: 2 }),
    ])
    const { actions, q } = assembleEchoActions(e)
    expect(q).toBe('Q·A1')
    const [a1, a2] = [actions['Q·A1']!, actions['Q·A2']!]
    expect([a1.kind, a1.owner, a1.cooldown, a1.cooldownGroup, a1.cancelWindows]).toEqual(['echo', '声骸:甲', 1200, undefined, [{ from: 30, until: 75, row: 1 }]])
    expect([a2.cooldown, a2.cooldownGroup, a2.comboFrom]).toEqual([undefined, 'Q·A2', ['Q·A1']])
    expect(a1.judgments[0]!.tags).toEqual(['声骸技能'])                   // 没连上倍率：按类别推标签
    expect(a1.flags).not.toContain('kindGuess')
  })

  test('按体型挑行：中小体型用少女行，去掉 @ 后缀；女-特殊没有对应行时用第一组并说明', () => {
    const e = echo('龟', [
      group('召唤', [row(1, '成女-召唤', { spawnFrame: 22, endFrame: 33 })], { body: '成女', cooldown: 1200 }),
      group('召唤', [row(2, '少女-召唤', { spawnFrame: 22, endFrame: 33 })], { body: '少女', variant: 2, cooldown: 1200 }),
      group('召唤', [row(3, '萝莉-召唤', { spawnFrame: 18, endFrame: 33 })], { body: '萝莉', variant: 3, cooldown: 1200 }),
    ])
    const def = assembleEchoActions(e)
    expect(Object.keys(def.actions)).toEqual(['Q·召唤@成女', 'Q·召唤@少女', 'Q·召唤@萝莉'])
    const mid = echoActionsFor(def, '女-中小')
    expect([Object.keys(mid.actions), mid.q, mid.actions['Q·召唤']!.id, mid.actions['Q·召唤']!.judgments[0]!.name, mid.note])
      .toEqual([['Q·召唤'], 'Q·召唤', 'Q·召唤', '少女-召唤', undefined])
    expect(echoActionsFor(def, '女-小').actions['Q·召唤']!.judgments[0]!.spawnFrame).toBe(18)
    expect(echoActionsFor(def, '女-特殊').note).toContain('用了 Q·召唤@成女')
  })

  test('脱手与否：第一个技能版本以说明的"召唤 / 幻形"为准，其余版本看「类型」列；echoes.ts 可改', () => {
    const groups = [group('砸', [row(1, '砸')], { kind: '变身' }), group('延奏', [row(2, '延奏')], { kind: '召唤', variant: 2 })]
    const byText = assembleEchoActions(echo('甲', groups, { textKind: '召唤' })).actions
    expect([byText['Q·砸']!.summon, byText['Q·延奏']!.summon]).toEqual([true, true])
    const byCol = assembleEchoActions(echo('甲', groups)).actions                      // 说明里两个词都没有：看「类型」列
    expect([byCol['Q·砸']!.summon, byCol['Q·延奏']!.summon]).toEqual([undefined, true])
    expect(assembleEchoActions(echo('甲', groups), { 'Q·延奏': { summon: false } }).actions['Q·延奏']!.summon).toBe(false)
  })

  test('echoes.ts 的覆盖：按动作 ID；写了不存在的动作直接报错；连 nanoka 的判定能量与削韧取 nanoka', () => {
    const nk = {
      via: 'nanoka' as const, charaId: '甲', skillName: 'nanoka::1', dmgCalc: null, skillId: 1, skillType: null, calcType: 0 as const,
      element: 6, damageType: 5, subType: null, relatedProperty: 7, multiplier: 2.646, rates: Array<number>(20).fill(0), energy: 367,
      toughLv: 14700, weaknessLvl: 0, hardnessLv: 10000, formulaType: 0,
    }
    const gains = { energy: { total: 4.37 }, concerto: null, core: [null, null, null] as [null, null, null] }
    const e = echo('甲', [group('斩击', [row(1, '斩击', { endFrame: 39, toughness: 175, gains, dmg: nk })], { cooldown: 1200 })])
    const plain = assembleEchoActions(e).actions['Q·斩击']!.judgments[0]!
    expect([plain.multiplier, plain.element, plain.gains.energy, plain.gauges.toughness]).toEqual([2.646, '湮灭', 3.67, 147])
    const { actions } = assembleEchoActions(e, { 'Q·斩击': { cooldown: 720, charges: 3, judgments: { 斩击: { multiplier: 3, element: '衍射' } } } })
    const a = actions['Q·斩击']!
    expect([a.cooldown, a.charges, a.judgments[0]!.multiplier, a.judgments[0]!.element]).toEqual([720, 3, 3, '衍射'])
    expect(() => assembleEchoActions(e, { 斩击: { cooldown: 720 } })).toThrow('不存在的动作"斩击"')
  })
})

describe('引擎：脱手、按次数充能、触发条件 ownerHas、治疗事件（人造数据）', () => {
  test('脱手（召唤）：召唤物的判定走独立时间线，角色马上接下一招也照常出手；不脱手（幻形）的要等判定出手，或被打断时丢掉', () => {
    const Q = (summon: boolean) => action({
      id: 'Q', kind: 'echo', endFrame: 60, priority: [{ fromFrame: 0, value: 0 }], ...(summon ? { summon } : {}),
      judgments: [judgment({ name: 'q1', spawnFrame: 10 }), judgment({ name: 'q2', spawnFrame: 50, persistsOnCancel: false })],
    })
    const A = action({ id: 'A', endFrame: 20, judgments: [judgment({ name: 'a', spawnFrame: 5 })] })
    const run = (summon: boolean, rotation: string[]) => synthRun([{ name: '甲', actions: [Q(summon), A] }, idle('乙'), idle('丙')], { rotation })
    const det = run(true, ['甲 Q A'])
    expect(eventsOfLog(det.log, 'actionStart').map(e => [e.action, e.f])).toEqual([['Q', 0], ['A', 1]])
    expect(eventsOfLog(det.log, 'hit').map(h => [h.judgment, h.f])).toEqual([['a', 6], ['q1', 10], ['q2', 50]])
    const bound = run(false, ['甲 Q A'])                                            // 默认调度：等 q2 出手再接，不丢判定
    expect(eventsOfLog(bound.log, 'wait').map(w => w.code)).toContain('settled')
    expect(eventsOfLog(bound.log, 'actionStart').find(e => e.action === 'A')!.f).toBeGreaterThan(50)
    const forced = run(false, ['甲 Q A!'])                                          // 强制接（第 1 帧）：q1、q2 都还没出现，作废
    expect(eventsOfLog(forced.log, 'hit').map(h => h.judgment)).toEqual(['a'])
  })

  test('按次数充能：存满 2 次，用掉一次就开始回复，每 600 帧回 1 次；次数用完才等', () => {
    const 甲 = { name: '甲', actions: [action({ id: 'X', kind: 'echo', endFrame: 10, cooldown: 600, charges: 2, judgments: [judgment({ name: 'x', spawnFrame: 5 })] })] }
    const out = synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 X X X X'], options: { maxWait: 1300 } })
    expect(out.error).toBeUndefined()
    // 第 0、10 帧连放两次；第 3 次等第 1 次回复（第 600 帧）；回复后接着计下一次，第 4 次在第 1200 帧
    expect(eventsOfLog(out.log, 'actionStart').map(bf)).toEqual([0, 10, 600, 1200])
    expect(eventsOfLog(out.log, 'wait').find(w => w.code === 'cooldown')!.reason).toContain('2 次都用掉了')
  })

  test('ownerHas：持有者身上有那个 buff 时才触发；heals：只认标了 heals 的结算', () => {
    const 甲 = {
      name: '甲',
      actions: [
        action({ id: 'Q', endFrame: 10 }),
        action({ id: 'Y', endFrame: 10, judgments: [judgment({ name: 'y', spawnFrame: 5, heals: true })] }),
        action({ id: 'Z', endFrame: 10, judgments: [judgment({ name: 'z', spawnFrame: 5 })] }),
      ],
      buffs: [
        { id: '甲.监听', source: 't', target: 'self', duration: 60, trigger: { on: 'actionStart', where: { actions: ['Q'] } } },
        { id: '甲.条件', source: 't', zone: 'atkPct', value: 0.1, target: 'self', duration: 600, trigger: { on: 'actionStart', where: { actions: ['Z'], ownerHas: '甲.监听' } } },
        { id: '甲.治疗时', source: 't', zone: 'atkPct', value: 0.1, target: 'team', duration: 600, trigger: { on: 'heal' } },
      ] satisfies BuffDefInput[],
    }
    const applied = (rotation: string[]) =>
      eventsOfLog(synthRun([甲, idle('乙'), idle('丙')], { rotation }).log, 'buffApply').map(e => `${e.buff}→${e.target}`)
    expect(applied(['甲 Z'])).toEqual([])                                            // 没有监听
    expect(applied(['甲 Q Z'])).toEqual(['甲.监听→甲', '甲.条件→甲'])
    expect(applied(['甲 Q', 'wait 70', '甲 Z'])).not.toContain('甲.条件→甲')           // 监听已到期
    expect(applied(['甲 Y'])).toEqual(['甲.治疗时→甲', '甲.治疗时→乙', '甲.治疗时→丙'])
  })

  test('ownerHas 指向没有登记的 buff：装配时报错', () => {
    const 甲 = {
      name: '甲', actions: [action({ id: 'Z', endFrame: 10 })],
      buffs: [{ id: '甲.条件', source: 't', zone: 'atkPct', value: 0.1, target: 'self', duration: 600, trigger: { on: 'actionStart', where: { ownerHas: '甲.没有' } } }] satisfies BuffDefInput[],
    }
    expect(() => synthRun([甲, idle('乙'), idle('丙')], { rotation: ['甲 Z'] })).toThrow('ownerHas 写的 buff "甲.没有"')
  })
})

let gd: GameData
/** M0 队伍，第 slot 位装上声骸（第一个是首位）；set 缺省"测试"（不成套） */
const withEchoes = (slot: number, names: string[], set = '测试'): ScenarioInput['team'] => {
  const team = structuredClone(M0)
  team[slot] = { ...team[slot]!, echoes: names.map(name => ({ name, set, main: {}, subs: {} })) }
  return team
}
const resolveTeam = (team: ScenarioInput['team'], onField = 0, rotation = ['wait 1']) =>
  resolveScenario(ScenarioSchema.parse({ team, enemy: { preset: '全息6/朔雷之鳞' }, initial: { onField }, rotation }), gd)

dataDescribe('首位声骸（M0 队伍）', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('声骸表进 GameData（异相不单独产出）；倍率取 5 级，dmg 里没有的从 nanoka 连上，能量与削韧也按 nanoka', () => {
    expect(Object.keys(gd.echoes)).toHaveLength(78)
    expect(gd.echoes['异相·无常凶鹭']).toBeUndefined()
    const e = gd.echoes['梦魇·无冠者']!
    const a = e.actions['Q·斩击']!
    expect([a.cooldown, a.charges, e.flags]).toEqual([720, 3, []])              // 以 nanoka 为准，echoes.ts 已处理 cooldownText / charges
    const j = a.judgments[0]!
    expect([j.multiplier, j.element, j.relatedAttr, j.tags, j.gains.energy, j.gauges.toughness]).toEqual([2.646, '湮灭', 'atk', ['声骸技能'], 3.67, 147])
    expect(gd.echoes['芬莱克']!.actions[gd.echoes['芬莱克']!.q]!.judgments[0]!.multiplier).toBe(2.736)   // dmg RateLv_5 = 27360
    expect(gd.echoes['无妄者']!.q).toBe('Q·斩击')                               // 组名取公共前缀（斩击1…6）
  })

  test('异相取本体；非首位的声骸不在表里也行（只计入词条与套装）；首位不在表里报错；没装声骸时没有 Q', () => {
    const r = resolveTeam(withEchoes(0, ['异相·无妄者', '遁地鼠', '刺玫菇（稚形）']))
    expect([r.team[0].aliases.Q, r.team[0].echoes.map(e => e.def?.key ?? null)]).toEqual(['Q·斩击', ['无妄者', null, null]])
    let err: unknown
    try { resolveTeam(withEchoes(0, ['无冠'])) } catch (e) { err = e }
    expect((err as ResolveError).issues).toEqual(['队伍第 1 位 椿：首位声骸"无冠"不在声骸表里，放不了技能（名字照声骸表 A 列写，如"梦魇·无冠者"）'])
    expect(() => resolveTeam(M0, 0, ['椿 Q'])).toThrow(ResolveError)
  })

  test('鸣钟之龟装在维里奈首位：按体型用萝莉行，基于防御的冷凝伤害；声骸冷却 20 秒按战斗帧走；不在 echoes.ts 的提示一次', () => {
    const team = withEchoes(2, ['鸣钟之龟'])
    const out = m0Run(gd, { team, initial: { onField: 2, energy: 'empty' }, rotation: ['维里奈 Q', '维里奈 Q'], options: { maxWait: 1300 } })
    expect(out.error).toBeUndefined()
    const starts = eventsOfLog(out.log, 'actionStart').filter(e => e.action === 'Q·召唤')
    expect(starts.map(bf)).toEqual([0, 1200])
    expect(eventsOfLog(out.log, 'wait').map(w => w.code)).toContain('cooldown')
    const hit = eventsOfLog(out.log, 'hit').find(h => h.action === 'Q·召唤')!
    expect([hit.f - starts[0]!.f, hit.judgment, hit.element, hit.tags]).toEqual([18, '萝莉-召唤', '冷凝', ['声骸技能']])
    expect(hit.gains.energy['维里奈']).toBeCloseTo(4.55 * 1.5184, 9)          // 出伤者 1 × 自身效率
    const panel = resolveTeam(team, 2).team[2].panel
    expect(hit.factors!.base).toBeCloseTo(1.4592 * composeStat(panel.def, 0, 0), 6)
    expect(out.summary.byAction.find(a => a.action === 'Q·召唤')).toMatchObject({ char: '维里奈', hits: 2 })
    expect(out.summary.warnings.map(w => w.message)).toContain('维里奈：首位声骸 鸣钟之龟 没写进 data/curated/echoes.ts，首位加成与技能附带的效果不计入，只算技能伤害')
  })

  test('多段声骸（无冠者）：后续段只能接在上一段之后、窗口内，不受声骸冷却限制；第二轮要等冷却', () => {
    const team = withEchoes(1, ['无冠者'])
    const out = m0Run(gd, { team, initial: { onField: 1 }, rotation: ['散华 Q Q·A2 Q·A3 Q·A4', '散华 Q'], options: { maxWait: 1300 } })
    expect(out.error).toBeUndefined()
    const starts = eventsOfLog(out.log, 'actionStart').filter(e => e.char === '散华')
    expect(starts.map(e => e.action)).toEqual(['Q·A1', 'Q·A2', 'Q·A3', 'Q·A4', 'Q·A1'])
    expect(bf(starts[4]!)).toBe(1200)
    expect(eventsOfLog(out.log, 'hit').filter(h => h.char === '散华').map(h => h.judgment))
      .toEqual(['A1', 'A2', 'A3-1', 'A3-2', 'A4-1', 'A4-2', 'A4-3', 'A1'])
    expect(m0Run(gd, { team, initial: { onField: 1 }, rotation: ['散华 Q·A2'] }).error).toMatchObject({ code: 'comboBroken' })
  })

  test('召唤类（脱手）：角放出来后角色马上接普攻，召唤物照常打完；幻形类（不脱手）放出来立刻切人，后台照常打完（合轴）', () => {
    expect([gd.echoes['角']!.actions['Q·召唤']!.summon, gd.echoes['无常凶鹭']!.actions['Q·砸地']!.summon]).toEqual([true, undefined])
    const out = m0Run(gd, { team: withEchoes(1, ['角']), initial: { onField: 1 }, rotation: ['散华 Q A1'] })
    const a1 = eventsOfLog(out.log, 'actionStart').find(e => e.action === 'A1')!
    expect(a1.f).toBe(1)
    const hits = eventsOfLog(out.log, 'hit').filter(h => h.action === 'Q·召唤')
    expect(hits.map(h => h.judgment)).toEqual(expect.arrayContaining(['召唤-升空', '召唤-雷击5', '召唤-斩击2']))
    expect(hits.at(-1)!.f).toBeGreaterThanOrEqual(153)
    const merged = m0Run(gd, { team: withEchoes(1, ['无常凶鹭']), initial: { onField: 1 }, rotation: ['散华 Q', 'switch 椿'] })
    const sw = eventsOfLog(merged.log, 'switch')[0]!
    expect(eventsOfLog(merged.log, 'hit').find(h => h.action === 'Q·砸地')!.f).toBeGreaterThan(sw.f)
  })

  test('无妄者（椿）：6 段，命中后接斩击6，第 123 帧才收手', () => {
    const out = m0Run(gd, { team: withEchoes(0, ['异相·无妄者']), initial: { onField: 0 }, rotation: ['椿 Q'] })
    expect(eventsOfLog(out.log, 'hit').filter(h => h.action === 'Q·斩击').map(h => h.judgment))
      .toEqual(['斩击1', '斩击2', '斩击3', '斩击4', '斩击5', '斩击6'])
    expect(eventsOfLog(out.log, 'actionEnd').find(e => e.action === 'Q·斩击')!.f).toBeGreaterThanOrEqual(123)
  })

  test('梦魇·无冠者：3 次充能、每 12 秒回 1 次（以 nanoka 为准）；首位加成只在首位；命中后该声骸技能伤害 +20%（2 秒）', () => {
    const out = m0Run(gd, { team: withEchoes(1, ['梦魇·无冠者', '鸣钟之龟']), initial: { onField: 1 }, rotation: ['散华 Q Q Q Q'], options: { maxWait: 800 } })
    expect(out.error).toBeUndefined()
    const starts = eventsOfLog(out.log, 'actionStart').filter(e => e.action === 'Q·斩击').map(bf)
    expect(starts[3]).toBe(720)                                                // 第 4 次等第 1 次回复
    expect(starts[2]! < 720).toBe(true)
    const hits = eventsOfLog(out.log, 'hit').filter(h => h.action === 'Q·斩击')
    expect(hits[0]!.buffs).toEqual(expect.arrayContaining(['梦魇·无冠者.首位湮灭']))
    expect(hits[0]!.buffs).not.toContain('梦魇·无冠者.命中后')                    // 命中的那一段自己不吃
    expect(hits[1]!.buffs).toContain('梦魇·无冠者.命中后')
    const second = m0Run(gd, { team: withEchoes(1, ['鸣钟之龟', '梦魇·无冠者']), initial: { onField: 1 }, rotation: ['散华 Q'] })
    expect(eventsOfLog(second.log, 'hit').find(h => h.action === 'Q·召唤')!.buffs).not.toContain('梦魇·无冠者.首位湮灭')
  })

  test('无常凶鹭：首次命中回 10 点能量（长按喷火也只回一次）；15 秒内放延奏，下一位变奏登场的角色伤害 +12%', () => {
    const team = withEchoes(1, ['无常凶鹭'])
    const hold = m0Run(gd, { team, initial: { onField: 1, energy: 'empty' }, rotation: ['散华 Q·喷火'] })
    expect(eventsOfLog(hold.log, 'hit').filter(h => h.action === 'Q·喷火').length).toBeGreaterThan(1)
    expect(eventsOfLog(hold.log, 'resource').filter(e => e.cause === '无常凶鹭.回能').map(e => e.delta)).toEqual([10])
    const sc = { team, initial: { onField: 1 as const, concerto: [0, 100, 0] as [number, number, number] } }
    const amp = m0Run(gd, { ...sc, rotation: ['散华 Q', 'switch 椿', '椿 A1'] })
    expect(eventsOfLog(amp.log, 'buffApply').find(e => e.buff === '无常凶鹭.伤害提升')).toMatchObject({ target: '椿', remaining: 900 })
    expect(eventsOfLog(amp.log, 'hit').find(h => h.char === '椿' && h.action === 'A1')!.buffs).toContain('无常凶鹭.伤害提升')
    const late = m0Run(gd, { ...sc, rotation: ['散华 Q', 'wait 1000', 'switch 椿'] })
    expect(eventsOfLog(late.log, 'buffApply').map(e => e.buff)).not.toContain('无常凶鹭.伤害提升')
  })

  test('无归的谬误（维里奈）：点按只打爆气（基于生命）；施放时全队攻击 +10%、自身共鸣效率 +10%，20 秒', () => {
    const out = m0Run(gd, { team: withEchoes(2, ['异相·无归的谬误']), initial: { onField: 2 }, rotation: ['维里奈 Q'] })
    expect(eventsOfLog(out.log, 'hit').filter(h => h.action === 'Q·爆气').map(h => h.judgment)).toEqual(['爆气'])
    expect(gd.echoes['无归的谬误']!.actions['Q·爆气']!.judgments.map(j => [j.relatedAttr, j.multiplier])).toEqual([['hp', 0.1585]])
    expect(eventsOfLog(out.log, 'buffApply').filter(e => e.f === 0 && e.buff.startsWith('无归的谬误')).map(e => [e.buff, e.target, e.remaining]))
      .toEqual([['无归的谬误.攻击', '椿', 1200], ['无归的谬误.攻击', '散华', 1200], ['无归的谬误.攻击', '维里奈', 1200], ['无归的谬误.共鸣效率', '维里奈', 1200]])
  })
})

dataDescribe('M0 三人的套装（docs/test-echos-setup.md）', () => {
  beforeAll(async () => { gd ??= await loadGameData() })
  const five = (slot: number, set: string) => withEchoes(slot, ['异相·无妄者', '暗鬃狼', '刺玫菇', '遁地鼠', '火鬃狼'], set)

  test('沉日劫明：2 件湮灭 +10% 常驻；5 件施放普攻 / 重击类动作时湮灭 +7.5%，最多 4 层，15 秒', () => {
    const out = m0Run(gd, { team: five(0, '沉日劫明'), initial: { onField: 0 }, rotation: ['椿 A1 A2 A3 A4 A5'] })
    expect(eventsOfLog(out.log, 'buffApply').filter(e => e.buff === '沉日劫明.5').map(e => [e.stacks, e.remaining]))
      .toEqual([[1, 900], [2, 900], [3, 900], [4, 900], [4, 900]])
    expect(eventsOfLog(out.log, 'hit').find(h => h.action === 'A5')!.buffs).toEqual(expect.arrayContaining(['沉日劫明.2', '沉日劫明.5×4']))
    const two = m0Run(gd, { team: withEchoes(0, ['异相·无妄者', '暗鬃狼'], '沉日劫明'), initial: { onField: 0 }, rotation: ['椿 A1'] })
    const applied = eventsOfLog(two.log, 'buffApply').map(e => e.buff)
    expect([applied.includes('沉日劫明.2'), applied.includes('沉日劫明.5')]).toEqual([true, false])
  })

  test('轻云出月：5 件，放延奏后下一位变奏登场的角色攻击 +22.5%，15 秒', () => {
    const out = m0Run(gd, { team: five(1, '轻云出月'), initial: { onField: 1, concerto: [0, 100, 0] }, rotation: ['switch 椿'] })
    const outro = eventsOfLog(out.log, 'outro')[0]!
    expect(eventsOfLog(out.log, 'buffApply').find(e => e.buff === '轻云出月.5')).toMatchObject({ target: '椿', remaining: 900, f: outro.f })
  })

  test('隐世回光：5 件，维里奈带治疗的结算（大招、协同攻击、星星花绽放）给全队攻击 +15%，30 秒', () => {
    const out = m0Run(gd, { team: five(2, '隐世回光'), initial: { onField: 2 }, rotation: ['维里奈 R'] })
    // 大招-标记的命中同一帧还引出一次协同攻击（也带治疗），所以这一帧施加两遍
    const mark = eventsOfLog(out.log, 'hit').find(h => h.judgment === '大招-标记')!
    const applied = eventsOfLog(out.log, 'buffApply').filter(e => e.buff === '隐世回光.5' && e.f === mark.f)
    expect([...new Set(applied.map(e => `${e.target} ${e.remaining}`))]).toEqual(['椿 1800', '散华 1800', '维里奈 1800'])
    const none = m0Run(gd, { team: five(2, '隐世回光'), initial: { onField: 2 }, rotation: ['维里奈 A1'] })   // 普攻不治疗
    expect(eventsOfLog(none.log, 'buffApply').map(e => e.buff)).not.toContain('隐世回光.5')
    // 延奏后的持续回复每一跳都算：盛放 6 跳（每秒）、共鸣链1 每 5 秒一跳，buff 跟着刷新
    const hot = m0Run(gd, { team: five(2, '隐世回光'), initial: { onField: 2, concerto: [0, 0, 100] }, rotation: ['switch 散华', 'wait 700'] })
    const ticks = eventsOfLog(hot.log, 'heal').map(h => h.f)
    expect(ticks.length).toBeGreaterThanOrEqual(8)                            // 盛放 6 跳 + 共鸣链1 第 300、600 帧两跳
    expect(eventsOfLog(hot.log, 'buffApply').filter(e => e.buff === '隐世回光.5' && e.target === '散华').map(e => e.f)).toEqual(ticks)
  })
})
