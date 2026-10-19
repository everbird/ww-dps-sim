// src/data/scan-import.ts —— wavescan 扫描导出（WutheringToolsScan v1）→ 声骸库存（TD-13 §2）
// 纯函数：英文名 → 中文名的表由调用方给（src/cli/import-scan.ts 从 nanoka 缓存、data/curated/scan-names.json、
// data/curated/nanoka-names.json 拼起来），这里只管对应、换算与写 YAML。
// 只收 +25 的 5 星声骸：扫描文件不带主词条数值，库存里主词条只写名字，由 resolveInventory 按满级补（低等级的会被补错）。
import { z } from 'zod'
import { FLAT_STATS, type StatKey } from './common'

const ScanEchoSchema = z.object({
  scanId: z.string().optional(),
  echo: z.string().min(1),
  echoSet: z.string().nullable().optional(),
  cost: z.number().int(),
  rank: z.number().int().nullable().optional(),
  level: z.number().int().nullable().optional(),
  stat: z.string().nullable().optional(),
  substats: z.array(z.object({ type: z.string().min(1), value: z.number() })),
  equippedBy: z.string().nullable().optional(),
  locked: z.boolean().optional(),
  lowConfidence: z.array(z.string()).optional(),
})
export const ScanFileSchema = z.object({
  format: z.literal('WutheringToolsScan'),
  version: z.literal(1),
  meta: z.object({ scannerVersion: z.string().optional(), scannedAt: z.string().optional() }).optional(),
  echoes: z.array(ScanEchoSchema),
})
export type ScanFile = z.output<typeof ScanFileSchema>

/** 主词条：扫描键 → StatKey（主词条上的 ATK / HP / DEF 都是百分比） */
export const SCAN_MAIN_STATS: Readonly<Record<string, StatKey>> = {
  HP: '生命%', ATK: '攻击%', DEF: '防御%',
  CritRate: '暴击率', CritDMG: '暴击伤害', HealingBonus: '治疗效果加成', EnergyRegen: '共鸣效率',
  Glacio: '冷凝伤害加成', Fusion: '热熔伤害加成', Electro: '导电伤害加成',
  Aero: '气动伤害加成', Spectro: '衍射伤害加成', Havoc: '湮灭伤害加成',
}
/** 副词条：带 _FLAT 的是固定值，其余是百分比 */
export const SCAN_SUB_STATS: Readonly<Record<string, StatKey>> = {
  HP: '生命%', HP_FLAT: '生命', ATK: '攻击%', ATK_FLAT: '攻击', DEF: '防御%', DEF_FLAT: '防御',
  CritRate: '暴击率', CritDMG: '暴击伤害', EnergyRegen: '共鸣效率',
  BasicAttackDMGBonus: '普攻伤害加成', HeavyAttackDMGBonus: '重击伤害加成',
  ResonanceSkillDMGBonus: '共鸣技能伤害加成', ResonanceLiberationDMGBonus: '共鸣解放伤害加成',
}

/** 英文名归一：去掉空格与标点、不分大小写（"Nightmare: Crownless" 与 "NightmareCrownless" 对得上） */
export const normName = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toLowerCase()

export interface NameTables {
  /** 英文名 → 中文名（nanoka echo.json / sonata.json / character.json 的 en → zh） */
  echo: Record<string, string>
  set: Record<string, string>
  char: Record<string, string>
  /** 手写：扫描键 → 中文名，先查（data/curated/scan-names.json） */
  overrides?: { 声骸?: Record<string, string>; 套装?: Record<string, string>; 角色?: Record<string, string> }
  /** nanoka 中文名 → 声骸表 A 列名（data/curated/nanoka-names.json 的「声骸」反过来） */
  echoRename?: Record<string, string>
}

/** 库存里的一件（InventorySchema 的写法；主词条只写名字） */
export interface ScanPiece {
  id: string
  owner?: string
  name: string
  set: string
  cost: 1 | 3 | 4
  main: StatKey
  subs: Partial<Record<StatKey, number>>
  note?: string
}

export interface ScanResult {
  pieces: ScanPiece[]
  /** 没收的：id 与原因（"+10"、"4 星"、"副词条 X 不认识"…） */
  skipped: { id: string; reason: string }[]
  /** 名字没对上的（原样写了英文键），按种类列出 */
  unknown: { 声骸: string[]; 套装: string[]; 角色: string[] }
}

const MAX_LEVEL = 25
const MAX_RANK = 5
const PHANTOM = /^Phantom(?=[A-Z])/

/** 百分数（8.6）→ 小数（0.086），按四位小数取整免得浮点尾巴；固定值原样 */
const toRatio = (k: StatKey, v: number) => (FLAT_STATS.includes(k) ? v : Math.round(v * 100) / 10000)

export function convertScan(scan: ScanFile, t: NameTables): ScanResult {
  const norm = (m: Record<string, string>) => new Map(Object.entries(m).map(([k, v]) => [normName(k), v]))
  const echo = norm(t.echo), set = norm(t.set), char = norm(t.char)
  const ov = t.overrides ?? {}
  const unknown = { 声骸: new Set<string>(), 套装: new Set<string>(), 角色: new Set<string>() }

  const echoName = (key: string): string | undefined => {
    const direct = ov.声骸?.[key] ?? echo.get(normName(key))
    if (direct) return t.echoRename?.[direct] ?? direct
    if (!PHANTOM.test(key)) return undefined
    // 异相是同一个声骸换了外观：PhantomX 取 X 的名字，加「异相·」（resolveInventory 认这个前缀）
    const base = key.replace(PHANTOM, '')
    const zh = ov.声骸?.[base] ?? echo.get(normName(base))
    return zh ? `异相·${t.echoRename?.[zh] ?? zh}` : undefined
  }
  const named = (kind: '套装' | '角色', key: string, map: Map<string, string>) => {
    const zh = ov[kind]?.[key] ?? map.get(normName(key))
    if (!zh) unknown[kind].add(key)
    return zh ?? key
  }

  const pieces: ScanPiece[] = []
  const skipped: ScanResult['skipped'] = []
  scan.echoes.forEach((e, i) => {
    const id = e.scanId ?? `scan-${i + 1}`
    const skip = (reason: string) => { skipped.push({ id, reason }) }
    if (e.level === null || e.level === undefined) return skip('未识别等级')
    if (e.level !== MAX_LEVEL) return skip(`+${e.level}`)
    if (e.rank === null || e.rank === undefined) return skip('未识别星级')
    if (e.rank !== MAX_RANK) return skip(`${e.rank} 星`)
    if (e.cost !== 1 && e.cost !== 3 && e.cost !== 4) return skip(`cost ${e.cost}`)
    if (!e.echoSet) return skip('未识别套装')
    if (!e.stat) return skip('未识别主词条')
    const main = SCAN_MAIN_STATS[e.stat]
    if (!main) return skip(`主词条 ${e.stat} 不认识`)
    const subs: Partial<Record<StatKey, number>> = {}
    for (const s of e.substats) {
      const k = SCAN_SUB_STATS[s.type]
      if (!k) return skip(`副词条 ${s.type} 不认识`)
      subs[k] = (subs[k] ?? 0) + toRatio(k, s.value)
    }
    const name = echoName(e.echo)
    if (!name) unknown.声骸.add(e.echo)
    const p: ScanPiece = { id, name: name ?? e.echo, set: named('套装', e.echoSet, set), cost: e.cost, main, subs }
    if (e.equippedBy) p.owner = named('角色', e.equippedBy, char)
    const notes: string[] = []
    if (!name) notes.push(`扫描名 ${e.echo} 没对上中文名（在 data/curated/scan-names.json 的「声骸」里写）`)
    if (e.lowConfidence?.length) notes.push(`低置信度：${e.lowConfidence.join('、')}`)
    if (notes.length) p.note = notes.join('；')
    pieces.push(p)
  })
  return {
    pieces, skipped,
    unknown: { 声骸: [...unknown.声骸], 套装: [...unknown.套装], 角色: [...unknown.角色] },
  }
}

/** 缺省输出路径：一个账号一份库存（两个账号的声骸不能混用，id 也都从 scan-echo-1 起）——data/scan/<账号>-echo.json → inventory/<账号>-bag.yaml */
export function inventoryPathFor(scanFile: string): string {
  const base = scanFile.replace(/\\/g, '/').split('/').pop()!.replace(/\.json$/i, '').replace(/-echo$/i, '')
  return `inventory/${base}-bag.yaml`
}

// ---------------------------------------------------------------------------
// 写 YAML：每件一行（与 inventory/m0-equipped.yaml 同样的写法），键序 id、owner、name、set、cost、main、subs、note

/** 能不加引号就不加；带 YAML 流式记号的用双引号（JSON 字符串也是合法的 YAML） */
const scalar = (s: string) => (/^[^\s\-?:,[\]{}#&*!|>'"%@`0-9][^,[\]{}#:]*$/u.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s))
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000))
const flow = (t: Partial<Record<StatKey, number>>) => `{ ${Object.entries(t).map(([k, v]) => `${scalar(k)}: ${num(v!)}`).join(', ')} }`

export function inventoryYaml(pieces: ScanPiece[], header: string[]): string {
  const line = (p: ScanPiece) => {
    const kv = [
      `id: ${scalar(p.id)}`, ...(p.owner ? [`owner: ${scalar(p.owner)}`] : []),
      `name: ${scalar(p.name)}`, `set: ${scalar(p.set)}`, `cost: ${p.cost}`,
      `main: ${scalar(p.main)}`, `subs: ${flow(p.subs)}`, ...(p.note ? [`note: ${scalar(p.note)}`] : []),
    ]
    return `  - { ${kv.join(', ')} }`
  }
  return [...header.map(h => `# ${h}`), 'echoes:', ...pieces.map(line), ''].join('\n')
}
