// tests/td01.test.ts —— TD-01 §13 装配的 TS 侧用例：共鸣链版本、角色模块覆盖、M0 队伍的确认结果
// 单元格级解析（T01-1、T01-2、T01-11、T01-12）在 tools/build/test_parse.py。
// T01-13、T01-14 用人造数据，总能跑；T01-15 依赖 data/generated（没有时跳过）。
import { describe, expect, test } from 'vitest'
import { assembleBlock, forChain } from '../src/data/assemble-action'
import type { GenActionFile, GenGroup, GenRow } from '../src/data/generated.schema'
import 椿 from '../data/curated/characters/椿'
import 散华 from '../data/curated/characters/散华'
import 维里奈 from '../data/curated/characters/维里奈'
import { character, dataDescribe, run } from './helpers/kernel-harness'

const row = (n: number, name: string, o: Partial<GenRow> = {}): GenRow => ({
  row: n, name, kind: 'hit', eventSpawned: false, spawnFrame: 10, birthFrame: null, lifeFrames: 1, delayFrames: null,
  hitstop: { self: null, enemy: null }, deriveFrame: null, deriveDuration: null, endFrame: null, invincible: null,
  priority: null, priorityChange: null, parry: null, persists: true, followHitstop: null, toughness: null, tunability: null,
  gains: { energy: null, concerto: null, core: [null, null, null] }, position: null, positionChange: null, dilation: null,
  hitTarget: '目标', note: null, noteMerged: false, hints: {}, nameTags: {}, flags: [], ...o,
})
const group = (id: string, rows: GenRow[]): GenGroup => ({ id, rawId: id, idNum: null, idSuffix: '', rows })
const file = (groups: GenGroup[]): GenActionFile => ({ key: '甲', sheet: '角色-女', sheetName: '甲', startRow: 1, ignoredRows: 0, groups })
const names = (a: { judgments: { name: string }[] }) => a.judgments.map(j => j.name)

describe('T01-13 共鸣链版本：行名去掉 C\\d 相同的判定互为版本，链数取"标记 ≤ 链数"里最大的', () => {
  const f = file([
    group('大招', [
      row(1, '大招-C0伤害', { nameTags: { chain: 0 }, endFrame: 264 }),
      row(2, '大招-C3伤害', { nameTags: { chain: 3 }, endFrame: 264 }),
      row(3, '大招-C5伤害', { nameTags: { chain: 5 }, endFrame: 264 }),
    ]),
    group('E3', [
      row(4, 'E3-一日花', { endFrame: 87 }),
      row(5, 'E3-C2一日花', { nameTags: { chain: 2 } }),
      row(6, 'E3-C6永生花', { nameTags: { chain: 6 } }),
    ]),
    group('重击', [row(7, '重击-1'), row(8, '重击-C6额外伤害', { nameTags: { chain: 6 }, endFrame: 120, deriveFrame: 100 })]),
  ])
  const b = assembleBlock(f)

  test('范围', () => {
    expect(b['大招']!.judgments.map(j => j.chainRange)).toEqual([{ min: 0, max: 2 }, { min: 3, max: 4 }, { min: 5, max: 6 }])
    expect(b['E3']!.judgments.map(j => j.chainRange)).toEqual([{ min: 0, max: 1 }, { min: 2, max: 6 }, { min: 6, max: 6 }])
    expect(b['E3']!.judgments.map(j => j.flags)).toEqual([[], [], ['chainAdditive']])   // 没有别的版本：从 6 链起额外出现，要人确认
  })
  test('按链数挑判定', () => {
    expect([0, 2, 3, 5, 6].map(c => names(forChain(b, c)['大招']!)))
      .toEqual([['大招-C0伤害'], ['大招-C0伤害'], ['大招-C3伤害'], ['大招-C5伤害'], ['大招-C5伤害']])
    expect([0, 2, 6].map(c => names(forChain(b, c)['E3']!))).toEqual([['E3-一日花'], ['E3-C2一日花'], ['E3-C2一日花', 'E3-C6永生花']])
  })
  test('时间字段不受链数影响：结束帧写在 C6 行上，0 链照样取到', () => {
    const a = forChain(b, 0)['重击']!
    expect([a.endFrame, a.cancelWindows[0]!.from, names(a)]).toEqual([120, 100, ['重击-1']])
  })
  test('没有链版本的动作原样返回', () => {
    expect(forChain(b, 0)['重击'] === b['重击']).toBe(false)
    const g = assembleBlock(file([group('A1', [row(9, 'A1', { endFrame: 30 })])]))
    expect(forChain(g, 3)['A1'] === g['A1']).toBe(true)
  })
})

describe('T01-14 角色模块覆盖（TD-01 §13.4）', () => {
  const f = file([
    group('A3', [
      row(1, 'A3-无目标/3m外', { spawnFrame: 20, endFrame: 64, deriveFrame: 37, deriveDuration: 30, priority: [2] }),
      row(2, 'A3-目标3m内', { spawnFrame: 16, endFrame: 61, deriveFrame: 30, deriveDuration: 30, priority: [2] }),
    ]),
    group('QTE', [row(3, 'QTE', { spawnFrame: 55, endFrame: 63, deriveFrame: 61, priority: [11, 8] })]),
  ])

  test('默认：两行都在，多个结束帧、优先级变化帧靠猜', () => {
    const b = assembleBlock(f)
    expect(names(b['A3']!)).toEqual(['A3-目标3m内', 'A3-无目标/3m外'])
    expect([b['A3']!.endFrame, b['A3']!.flags.includes('multiEnd')]).toEqual([64, true])   // 取第一个有结束帧的行
    expect(b['QTE']!.priority).toEqual([{ fromFrame: 0, value: 11 }, { fromFrame: 61, value: 8 }])
    expect(b['QTE']!.flags).toContain('priorityChangeGuess')
  })
  test('dropRows 在装配前去掉行；覆盖的字段对应的 flag 视为已处理', () => {
    const b = assembleBlock(f, {
      A3: { dropRows: ['A3-无目标/3m外'] },
      QTE: { priority: [{ fromFrame: 0, value: 11 }, { fromFrame: 42, value: 8 }], judgments: { QTE: { persistsOnCancel: false } } },
    })
    expect(names(b['A3']!)).toEqual(['A3-目标3m内'])
    expect(b['A3']!.cancelWindows.map(w => [w.from, w.until])).toEqual([[30, 60]])
    expect([b['A3']!.endFrame, b['A3']!.flags]).toEqual([61, []])
    expect(b['QTE']!.priority[1]).toEqual({ fromFrame: 42, value: 8 })
    expect(b['QTE']!.flags).toEqual([])
    expect(b['QTE']!.judgments[0]!.persistsOnCancel).toBe(false)
  })
  test('splitRows：拆出的行自成一个动作（动作 ID 是行名），原组里没有它；拆出的动作也能写覆盖', () => {
    const g = file([
      group('A3', [
        row(1, 'A3-目标3m内', { spawnFrame: 16, endFrame: 61, deriveFrame: 30, deriveDuration: 30, priority: [2] }),
        row(2, 'A3-地面出场技', { spawnFrame: 22, endFrame: 61, deriveFrame: 30, deriveDuration: 30, priority: [2] }),
      ]),
      group('A4', [row(3, 'A4', { spawnFrame: 10, endFrame: 48, deriveFrame: 40, deriveDuration: 50, priority: [2] })]),
    ])
    const b = assembleBlock(g, { A3: { splitRows: ['A3-地面出场技'] }, A4: { comboFrom: ['A3', 'A3-地面出场技'] } })
    expect(Object.keys(b)).toEqual(['A3', 'A3-地面出场技', 'A4'])
    expect(names(b['A3']!)).toEqual(['A3-目标3m内'])
    const e = b['A3-地面出场技']!
    expect([e.entrySkill, b['A3']!.entrySkill]).toEqual([true, undefined])   // 动作 ID 以"出场技"结尾的标出（TD-09 §3.5）
    expect(e.judgments.map(j => [j.name, j.spawnFrame])).toEqual([['A3-地面出场技', 22]])
    expect([e.kind, e.endFrame, e.cancelWindows.map(w => [w.from, w.until]), e.comboFrom, e.source.rows]).toEqual(['normal', 61, [[30, 60]], undefined, [2]])
    expect(b['A4']!.comboFrom).toEqual(['A3', 'A3-地面出场技'])
    expect(assembleBlock(g, { A3: { splitRows: ['A3-地面出场技'] }, 'A3-地面出场技': { endFrame: 50 } })['A3-地面出场技']!.endFrame).toBe(50)
    expect(() => assembleBlock(g, { A3: { splitRows: ['A3-出场技'] } })).toThrow('splitRows 写了不存在的行"A3-出场技"')
    expect(() => assembleBlock(g, { A4: { splitRows: ['A4'] } })).toThrow('"A4"与已有的动作重名')
  })
  test('copyAs：整组按新 ID 再装配一次（不推连段前置、不带本组的其余覆盖），原组不变', () => {
    const g = file([
      group('A1', [row(1, 'A1', { spawnFrame: 9, endFrame: 34, deriveFrame: 18, deriveDuration: 30, priority: [2] })]),
      group('A2', [
        row(2, 'A2-1', { spawnFrame: 8, priority: [2] }),
        row(3, 'A2-2', { spawnFrame: 20, endFrame: 44, deriveFrame: 30, deriveDuration: 30, priority: [2] }),
        row(4, 'A2-无目标', { spawnFrame: 22, endFrame: 44, priority: [2] }),
      ]),
    ])
    const b = assembleBlock(g, { A2: { dropRows: ['A2-无目标'], copyAs: ['A2-地面出场技'], cooldown: 60 } })
    expect(Object.keys(b)).toEqual(['A1', 'A2', 'A2-地面出场技'])
    const [a2, e] = [b['A2']!, b['A2-地面出场技']!]
    expect([a2.comboFrom, a2.cooldown, names(a2)]).toEqual([['A1'], 60, ['A2-1', 'A2-2']])
    expect([e.comboFrom, e.cooldown, names(e), e.endFrame, e.cancelWindows.map(w => [w.from, w.until])]).toEqual([undefined, undefined, ['A2-1', 'A2-2'], 44, [[30, 60]]])
    expect(() => assembleBlock(g, { A2: { copyAs: ['A1'] } })).toThrow('copyAs："A1"与已有的动作重名')
  })
  test('accept：明确接受的 flag 不再提示', () => {
    expect(assembleBlock(f, { A3: { accept: ['multiEnd'] } })['A3']!.flags).toEqual([])
  })
  test('写错名字直接报错，不做模糊匹配', () => {
    expect(() => assembleBlock(f, { A4: {} })).toThrow('不存在的动作"A4"')
    expect(() => assembleBlock(f, { A3: { dropRows: ['A3-目标3米内'] } })).toThrow('不存在的行"A3-目标3米内"')
    expect(() => assembleBlock(f, { QTE: { judgments: { 'QTE-1': { ticks: 2 } } } })).toThrow('不存在的判定"QTE-1"')
  })
})

dataDescribe('T01-15 M0 队伍的确认结果（m0-confirm 第 2 节：椿 0 链、散华 6 链、维里奈 3 链）', () => {
  const chun = character(椿, 0)
  const sanhua = character(散华, 6)
  const verina = character(维里奈, 3)

  test('维里奈 A3 只留"目标3m内"：一个判定（每 5 帧一次、最多 2 次），派生窗口 [30, 60)', () => {
    const a = verina['A3']!
    expect(a.judgments.map(j => [j.name, j.spawnFrame, j.ticks])).toEqual([['A3-目标3m内', 16, 2]])
    expect(a.cancelWindows.map(w => [w.from, w.until])).toEqual([[30, 60]])
    expect(a.flags).not.toContain('multiEnd')
  })
  test('维里奈"A3-地面出场技"拆成单独的动作：第 22 帧出伤害，其余同 A3；之后接 A4、A5（m0-confirm §11 V10）', () => {
    const e = verina['A3-地面出场技']!
    expect(e.judgments.map(j => [j.name, j.spawnFrame, j.ticks, j.multiplier])).toEqual([['A3-地面出场技', 22, 2, verina['A3']!.judgments[0]!.multiplier]])
    expect([e.kind, e.endFrame, e.cancelWindows.map(w => [w.from, w.until]), e.comboFrom, e.flags]).toEqual(['normal', 61, [[30, 60]], undefined, []])
    expect(verina['A4']!.comboFrom).toEqual(['A3', 'A3-地面出场技'])
    // 在空中的局部帧（「位置状态」「状态转换时间」，TD-09 §3.5）：强化空中A3 整段在空中、结束时还在空中；地面的没有
    expect([verina['强化空中A3']!.air, verina['A3-地面出场技']!.air]).toEqual([{ from: 0, until: null }, undefined])
    expect(chun['E2']!.air).toEqual({ from: 12, until: chun['E2']!.endFrame })   // 地转空 [12]，落地段的帧从落地算，按动作结束
    // 出场技要普通切人入场（TD-09 §3.5）：先从乙切进来，同一帧就能出
    const d = run([verina, verina, verina], [{ switch: 1 }, { act: 1, action: 'A3-地面出场技' }, { act: 1, action: 'A4' }, { act: 1, action: 'A5' }], { names: ['乙', '维里奈', '丙'] })
    // 派生窗口：出场技第 30 帧、A4 第 40 帧；命中顿帧（每次约 4 帧）让动作帧走慢：出场技结算 2 次 → A4 在 38，A4 结算 1 次 → A5 在 38 + 40 + 4
    expect(d.s.log.filter(e => e.type === 'actionStart').map(e => [e.action, e.f])).toEqual([['A3-地面出场技', 0], ['A4', 38], ['A5', 82]])
  })
  test('椿的地面出场技就是 A2（用户实测，xlsx 没写）：两段同 A2，不用接在谁后面（m0-confirm §11 V10）', () => {
    const [a2, e] = [chun['A2']!, chun['A2-地面出场技']!]
    expect(e.judgments.map(j => [j.name, j.spawnFrame, j.multiplier])).toEqual(a2.judgments.map(j => [j.name, j.spawnFrame, j.multiplier]))
    expect([e.kind, e.endFrame, e.cancelWindows.map(w => [w.from, w.until]), e.comboFrom, e.source.rows]).toEqual(['normal', 44, [[30, 60]], undefined, a2.source.rows])
    expect(a2.comboFrom).toEqual(['A1'])
  })
  test('维里奈 3 链：6 链的协同判定不出现', () => {
    expect(names(verina['C6']!)).toEqual([])
    expect(names(character(维里奈, 6)['C6']!)).toEqual(['C6-协同减速', 'C6-协同伤害'])
  })
  test('椿 0 链：大招、变奏、延奏、一日花都取 C0 版本', () => {
    expect(names(chun['大招']!)).toEqual(['大招-C0伤害'])
    expect(names(chun['QTE']!)).toEqual(['QTE-C0伤害'])
    expect(names(chun['E3']!)).toEqual(['E3-一日花'])
    expect(names(chun['延奏']!)).toEqual(['延奏-C0普通', '延奏-C0含苞', '延奏-C0含苞追加'])
  })
  test('散华 6 链：引爆触发器在', () => {
    expect(names(sanhua['C6-引爆触发器']!)).toEqual(['C6-引爆触发器'])
  })
  test('散华 QTE 的优先级：第 42 帧起降到 8（< 大招的 10）', () => {
    expect(sanhua['QTE']!.priority).toEqual([{ fromFrame: 0, value: 11 }, { fromFrame: 42, value: 8 }])
    expect(sanhua['QTE']!.flags).not.toContain('priorityChangeGuess')
  })
  test('散华 QTE 接大招：默认等 QTE 伤害（第 55 帧生成）出来，第 56 帧开大；强制则第 42 帧开大，QTE 伤害丢掉', () => {
    const team = [sanhua, sanhua, sanhua]
    const d = run(team, [{ act: 0, action: 'QTE' }, { act: 0, action: '大招' }], { names: ['散华', '乙', '丙'] })
    const start = (r: typeof d) => r.s.log.filter(e => e.type === 'actionStart' && e.action === '大招').map(e => e.f)
    expect(start(d)).toEqual([56])
    expect(d.hits.map(h => h.judgment)).toContain('QTE')
    const forced = run(team, [{ act: 0, action: 'QTE' }, { act: 0, action: '大招', force: true }], { names: ['散华', '乙', '丙'] })
    expect(start(forced)).toEqual([42])
    expect(forced.hits.map(h => h.judgment)).not.toContain('QTE')
    // 覆盖之前（变化帧回退到派生帧 61）：默认也要等到 61
    const before = run([character({ ...散华, actionOverrides: {} }, 6), sanhua, sanhua], [{ act: 0, action: 'QTE' }, { act: 0, action: '大招' }], { names: ['散华', '乙', '丙'] })
    expect(start(before)).toEqual([61])
  })
})

describe('T01-16 接续写的优先级（2026-10-24）：后一行起始值 = 前一行末值的几行串起来', () => {
  const pri = (rows: GenRow[]) => assembleBlock(file([group('重击', rows)]))['重击']!.priority.map(p => `${p.fromFrame}:${p.value}`)
  test('景燃重击：7 → 5（第 1 帧）、5 → 0（第 78 帧）', () => {
    expect(pri([
      row(1, '重击-1', { priority: [7, 5], priorityChange: [1], endFrame: 170 }),
      row(2, '重击-2', { priority: [5] }),
      row(3, '重击-4', { priority: [5, 0], priorityChange: [78] }),
    ])).toEqual(['0:7', '1:5', '78:0'])
  })
  test('串不上照旧取一行：互斥版本（值不接续）、帧不递增、没后移的落地段', () => {
    expect(pri([row(1, 'C0-1', { priority: [10, 0], priorityChange: [239], endFrame: 280 }), row(2, 'C3-1', { priority: [10, 0], priorityChange: [239] })]))
      .toEqual(['0:10', '239:0'])
    expect(pri([row(1, 'a', { priority: [4, 6], priorityChange: [42], endFrame: 80 }), row(2, 'b', { priority: [6, 2], priorityChange: [26] })]))
      .toEqual(['0:4', '42:6'])
    expect(pri([
      row(1, '空中攻击-下落', { priority: [3, 9], priorityChange: [2], spawnFrame: 2, endFrame: 40 }),
      row(2, '空中攻击-落地', { priority: [9, 2], priorityChange: [10], spawnFrame: 4 }),
    ])).toEqual(['0:3', '2:9'])
  })
})

describe('T01-17 覆盖 absorb（并入别组的行）与 air（改写在空中的帧）', () => {
  const f = file([
    group('E-地面', [row(1, 'E-地面', { kind: 'gain', spawnFrame: 17, endFrame: 78, position: '地面' })]),
    group('E', [row(2, 'E-蝶1', { spawnFrame: 55, position: '空中' }), row(3, 'E-蝶2', { spawnFrame: 58, position: '空中' })]),
  ])
  test('E-地面并进 E 组的两行，帧照原样；air: null 改回在地面', () => {
    const plain = assembleBlock(f, { 'E-地面': { absorb: ['E'] } })['E-地面']!
    expect(names(plain)).toEqual(['E-蝶1', 'E-蝶2'])
    expect(plain.judgments.map(j => j.spawnFrame)).toEqual([55, 58])
    expect(assembleBlock(f, { 'E-地面': { absorb: ['E'], air: null } })['E-地面']!.air).toBeUndefined()
    expect(() => assembleBlock(f, { 'E-地面': { absorb: ['没有'] } })).toThrow(/absorb 写了不存在的组/)
  })
})
