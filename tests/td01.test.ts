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
  row: n, name, kind: 'hit', eventSpawned: false, spawnFrame: 10, birthFrame: null, lifeFrames: 1,
  hitstop: { self: null, enemy: null }, deriveFrame: null, deriveDuration: null, endFrame: null,
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
