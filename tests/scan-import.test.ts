// tests/scan-import.test.ts —— wavescan 扫描导出 → 声骸库存（src/data/scan-import.ts，TD-13 §2）。人造数据，不依赖 data/generated。
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { InventorySchema } from '../src/data/inventory.schema'
import { convertScan, inventoryPathFor, inventoryYaml, normName, ScanFileSchema, type NameTables } from '../src/data/scan-import'

const tables: NameTables = {
  echo: { 'Nightmare: Crownless': '梦魇·无冠者', Kerasaur: '角鳄', 'Reminiscence: Denia': '共鸣回响·达妮娅', 'Baby Roseshroom': '刺玫菇（稚形）' },
  set: { 'Havoc Eclipse': '沉日劫明', "Flamewing's Shadow": '焚羽猎魔之影' },
  char: { Camellya: '椿', 'Rover: Havoc': '漂泊者·湮灭' },
  overrides: { 声骸: { YoungRoseshroom: '刺玫菇（稚形）' }, 角色: { Rover: '漂泊者' } },
  echoRename: { '共鸣回响·达妮娅': '达妮娅' },
}
const echo = (o: Record<string, unknown>) => ({
  echo: 'NightmareCrownless', echoSet: 'HavocEclipse', cost: 4, rank: 5, level: 25, stat: 'CritRate',
  substats: [{ type: 'CritDMG', value: 13.8 }, { type: 'ATK_FLAT', value: 40 }, { type: 'DEF', value: 11.8 }],
  equippedBy: null, ...o,
})
const scan = (echoes: Record<string, unknown>[]) =>
  ScanFileSchema.parse({ format: 'WutheringToolsScan', version: 1, echoes: echoes.map((e, i) => ({ scanId: `scan-echo-${i + 1}`, ...echo(e) })) })

describe('扫描导出 → 库存', () => {
  test('英文名归一：去空格标点、不分大小写', () => {
    expect(normName("Flamewing's Shadow")).toBe(normName('FlamewingsShadow'))
    expect(normName('Nightmare: Crownless')).toBe('nightmarecrownless')
  })

  test('词条：百分数换小数，_FLAT 是固定值；主词条 ATK 是攻击%；装备者换中文', () => {
    const r = convertScan(scan([{ equippedBy: 'Camellya' }, { cost: 3, stat: 'ATK', substats: [{ type: 'ATK', value: 8.6 }, { type: 'HP_FLAT', value: 430 }] }]), tables)
    expect(r.pieces).toEqual([
      { id: 'scan-echo-1', owner: '椿', name: '梦魇·无冠者', set: '沉日劫明', cost: 4, main: '暴击率', subs: { 暴击伤害: 0.138, 攻击: 40, '防御%': 0.118 } },
      { id: 'scan-echo-2', name: '梦魇·无冠者', set: '沉日劫明', cost: 3, main: '攻击%', subs: { '攻击%': 0.086, 生命: 430 } },
    ])
    expect(r.skipped).toEqual([])
  })

  test('PhantomX 取 X 加「异相·」；手写的先查；nanoka 名换成声骸表名', () => {
    const r = convertScan(scan([{ echo: 'PhantomKerasaur', echoSet: 'FlamewingsShadow', cost: 3, stat: 'Havoc' }, { echo: 'YoungRoseshroom', cost: 1, stat: 'HP' }, { echo: 'ReminiscenceDenia', equippedBy: 'Rover' }]), tables)
    expect(r.pieces.map(p => [p.name, p.set, p.main, p.owner])).toEqual([
      ['异相·角鳄', '焚羽猎魔之影', '湮灭伤害加成', undefined],
      ['刺玫菇（稚形）', '沉日劫明', '生命%', undefined],
      ['达妮娅', '沉日劫明', '暴击率', '漂泊者'],
    ])
  })

  test('只收 +25 的 5 星；不认识的词条整件跳过；名字没对上的原样写并列出', () => {
    const r = convertScan(scan([
      { level: 10, substats: [{ type: 'CritRate', value: 6.3 }] }, { rank: 4 }, { stat: 'EchoDMGBonus' },
      { echo: 'Mystery', echoSet: 'NewSet', equippedBy: 'Nobody' },
    ]), tables)
    expect(r.skipped).toEqual([
      { id: 'scan-echo-1', reason: '+10' }, { id: 'scan-echo-2', reason: '4 星' }, { id: 'scan-echo-3', reason: '主词条 EchoDMGBonus 不认识' },
    ])
    expect(r.unknown).toEqual({ 声骸: ['Mystery'], 套装: ['NewSet'], 角色: ['Nobody'] })
    expect(r.pieces[0]).toMatchObject({ name: 'Mystery', set: 'NewSet', owner: 'Nobody' })
    expect(r.pieces[0]!.note).toContain('scan-names.json')
  })

  test('标准 null 字段与 lowConfidence 优雅跳过或注记', () => {
    const r = convertScan(scan([
      { level: null }, { rank: null }, { echoSet: null }, { stat: null },
      { lowConfidence: ['substats.0.value'] },
    ]), tables)
    expect(r.skipped).toEqual([
      { id: 'scan-echo-1', reason: '未识别等级' },
      { id: 'scan-echo-2', reason: '未识别星级' },
      { id: 'scan-echo-3', reason: '未识别套装' },
      { id: 'scan-echo-4', reason: '未识别主词条' },
    ])
    expect(r.pieces).toHaveLength(1)
    expect(r.pieces[0]!.note).toBe('低置信度：substats.0.value')
  })

  test('写出的 YAML 每件一行，读回来符合 InventorySchema', () => {
    const r = convertScan(scan([{ equippedBy: 'Camellya' }, { echo: 'PhantomKerasaur', cost: 3, stat: 'Havoc' }, { echo: 'Odd: Name, {x}' }]), tables)
    const text = inventoryYaml(r.pieces, ['头注'])
    expect(text.split('\n').slice(0, 3)).toEqual([
      '# 头注', 'echoes:',
      '  - { id: scan-echo-1, owner: 椿, name: 梦魇·无冠者, set: 沉日劫明, cost: 4, main: 暴击率, subs: { 暴击伤害: 0.138, 攻击: 40, 防御%: 0.118 } }',
    ])
    const inv = InventorySchema.parse(parse(text))
    expect(inv.echoes).toHaveLength(3)
    expect(inv.echoes[2]!.name).toBe('Odd: Name, {x}')
    expect(inv.echoes[0]).toMatchObject({ owner: '椿', main: '暴击率', subs: { 暴击伤害: 0.138, 攻击: 40, '防御%': 0.118 } })
  })

  test('缺省输出：一个账号一份，data/scan/<账号>-echo.json → inventory/<账号>-bag.yaml', () => {
    expect(inventoryPathFor('data/scan/everbird-echo.json')).toBe('inventory/everbird-bag.yaml')
    expect(inventoryPathFor('data\\scan\\Evariste-echo.json')).toBe('inventory/Evariste-bag.yaml')   // Windows 路径
    expect(inventoryPathFor('/tmp/导出.JSON')).toBe('inventory/导出-bag.yaml')
  })
})
