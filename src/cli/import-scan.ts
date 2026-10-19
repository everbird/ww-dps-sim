// src/cli/import-scan.ts —— pnpm import:scan <扫描.json> [--out inventory/scanned-bag.yaml] [--nanoka 3.7]
// wavescan 扫描导出（WutheringToolsScan v1）→ 声骸库存 YAML（TD-13 §2），给 pnpm optimize --inv 用。
// 英文名 → 中文名：nanoka 的 echo.json / sonata.json / character.json（缓存在 data/raw/nanoka/<版本>/，没有时联网取，
// 与 tools/build/nanoka.py 共用缓存），对不上的写进 data/curated/scan-names.json；声骸名再按 nanoka-names.json 换成声骸表 A 列名。
// 写完用 InventorySchema + resolveInventory 校验一遍（要有 data/generated，没有时跳过）。
// 退出码：0 成功；1 扫描文件有错、名字没对上或校验有问题（文件照样写出）；2 用法错误。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { InventorySchema, resolveInventory } from '../data/inventory.schema'
import { hasGenerated, loadGameData } from '../data/load'
import { convertScan, inventoryYaml, ScanFileSchema, type NameTables } from '../data/scan-import'
import { parseOrThrow } from '../data/validate'
import { argsOf } from './format'

const USAGE = '用法：pnpm import:scan <扫描.json> [--out inventory/scanned-bag.yaml] [--nanoka <版本>]'
const NANOKA = 'https://static.nanoka.cc'
const DATA = new URL('../../data/', import.meta.url)
const CACHE = new URL('raw/nanoka/', DATA)

const readJson = (u: URL) => JSON.parse(readFileSync(u, 'utf8')) as unknown
const verKey = (v: string) => v.split('.').map(x => Number(x) || 0)
const newer = (a: string, b: string) => { const x = verKey(a), y = verKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0 }

/** nanoka 版本：--nanoka > data/generated/nanoka.json 用的版本 > 缓存里最新的 > manifest 的 live */
async function nanokaVersion(requested?: string): Promise<string> {
  if (requested) return requested
  const gen = new URL('generated/nanoka.json', DATA)
  if (existsSync(gen)) { const v = (readJson(gen) as { version?: string }).version; if (v) return v }
  const have = existsSync(CACHE) ? readdirSync(CACHE, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(newer) : []
  if (have.length) return have.at(-1)!
  const res = await fetch(`${NANOKA}/manifest.json`)
  return ((await res.json()) as { ww: { live: string } }).ww.live
}

/** 缓存里有就读，没有就从 nanoka 取下来存进缓存 */
async function cached(version: string, rel: string): Promise<unknown> {
  const u = new URL(`${version}/${rel}`, CACHE)
  if (!existsSync(u)) {
    const res = await fetch(`${NANOKA}/ww/${version}/${rel}`, { headers: { 'User-Agent': 'ww-dps-sim import-scan' } })
    if (!res.ok) throw new Error(`取 nanoka ${version}/${rel} 失败：HTTP ${res.status}`)
    mkdirSync(new URL('.', u), { recursive: true })
    writeFileSync(u, await res.text())
  }
  return readJson(u)
}

/** id → { en, zh } 的表 → en → zh；同名取 id 小的（漂泊者男女两个 ID） */
const enZh = (rows: [string, { en?: string; zh?: string }][]) => {
  const out: Record<string, string> = {}
  for (const [, v] of rows.sort(([a], [b]) => Number(a) - Number(b))) if (v.en && v.zh && !(v.en in out)) out[v.en] = v.zh
  return out
}
const curatedJson = (rel: string): Record<string, unknown> => {
  const u = new URL(`curated/${rel}`, DATA)
  return existsSync(u) ? (readJson(u) as Record<string, unknown>) : {}
}
const section = (o: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).filter(([k, v]) => !k.startsWith('$') && typeof v === 'string') as [string, string][])

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--out', '--nanoka'])
  const file = pos.find(a => !a.startsWith('--'))
  const unknownArgs = pos.filter(a => a.startsWith('--'))
  if (!file || unknownArgs.length) { console.error(unknownArgs.length ? `不认识的参数：${unknownArgs.join(' ')}\n${USAGE}` : USAGE); return 2 }
  const out = opt.out ?? 'inventory/scanned-bag.yaml'
  const scan = parseOrThrow(ScanFileSchema, JSON.parse(readFileSync(file, 'utf8')), file)

  const version = await nanokaVersion(opt.nanoka)
  const echoIdx = await cached(version, 'echo.json') as Record<string, { en?: string; zh?: string }>
  const charIdx = await cached(version, 'character.json') as Record<string, { en?: string; zh?: string }>
  const sonata = await cached(version, 'sonata.json') as Record<string, { name?: { en?: string; zh?: string } }>
  const names = curatedJson('scan-names.json')
  const rename = Object.fromEntries(Object.entries(section(curatedJson('nanoka-names.json')['声骸'])).map(([xlsx, nk]) => [nk, xlsx]))
  const tables: NameTables = {
    echo: enZh(Object.entries(echoIdx)),
    char: enZh(Object.entries(charIdx)),
    set: enZh(Object.entries(sonata).map(([id, s]) => [id, s.name ?? {}])),
    overrides: { 声骸: section(names['声骸']), 套装: section(names['套装']), 角色: section(names['角色']) },
    echoRename: rename,
  }
  const r = convertScan(scan, tables)

  const skipCount = new Map<string, number>()
  for (const s of r.skipped) skipCount.set(s.reason, (skipCount.get(s.reason) ?? 0) + 1)
  const skipText = [...skipCount].map(([why, n]) => `${why} ${n} 件`).join('、')
  const src = file.replace(/\\/g, '/')
  const m = scan.meta
  writeFileSync(out, inventoryYaml(r.pieces, [
    '声骸库存（TD-13 §2）：pnpm import:scan 从 wavescan 扫描导出生成，别手改（重新扫描后重跑会整个覆盖）。',
    `来源 ${src}（WutheringToolsScan v${scan.version}${m?.scannerVersion ? `，扫描器 ${m.scannerVersion}` : ''}${m?.scannedAt ? `，扫描于 ${m.scannedAt}` : ''}），名字按 nanoka ${version} 对成中文。`,
    `只收 +25 的 5 星声骸：${r.pieces.length} 件${r.skipped.length ? `（跳过 ${skipText}）` : ''}。主词条只写名字，满级值与固定副主属性由 resolveInventory 补；`,
    'owner 是扫描时装在谁身上（pnpm optimize 缺省不拿队友身上的，--include-team 才拿）。',
  ]), 'utf8')

  const owners = new Map<string, number>()
  for (const p of r.pieces) if (p.owner) owners.set(p.owner, (owners.get(p.owner) ?? 0) + 1)
  console.log(`${src} → ${out}：${r.pieces.length} 件（nanoka ${version}）`)
  if (r.skipped.length) console.log(`跳过 ${r.skipped.length} 件：${skipText}`)
  console.log(`装在身上的 ${[...owners.values()].reduce((a, b) => a + b, 0)} 件：${[...owners].map(([o, n]) => `${o} ${n}`).join('、') || '无'}`)
  let bad = false
  for (const [kind, keys] of Object.entries(r.unknown)) {
    if (!keys.length) continue
    bad = true
    console.error(`${kind}名没对上（原样写了英文，在 data/curated/scan-names.json 的「${kind}」里补）：${keys.join('、')}`)
  }

  // 校验：读回刚写的文件，按 pnpm optimize 的方式补全
  if (!hasGenerated()) { console.log('没有 data/generated（先 pnpm build:data），跳过校验'); return bad ? 1 : 0 }
  const data = await loadGameData()
  const inv = resolveInventory(parseOrThrow(InventorySchema, parse(readFileSync(out, 'utf8')), out), data)
  if (inv.issues.length) { bad = true; console.error(`${out} 校验：\n${inv.issues.map(x => `  ${x}`).join('\n')}`) }
  else console.log(`校验通过：${inv.pieces.length} 件都能补全主词条与 cost`)
  const noSkill = [...new Set(r.pieces.filter(p => p.cost === 4 && !data.echoes[p.name.replace(/^异相·/, '')]).map(p => p.name))]
  if (noSkill.length) console.log(`提示：这些 4C 声骸不在声骸表里，当首位时没有技能数据：${noSkill.join('、')}`)
  const noSet = [...new Set(r.pieces.map(p => p.set))].filter(s => !data.echoSets[s])
  if (noSet.length) console.log(`提示：这些套装的效果还没写进 data/curated/echo-sets.ts，凑齐也不计入：${noSet.join('、')}`)
  return bad ? 1 : 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
