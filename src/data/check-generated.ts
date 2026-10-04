// src/data/check-generated.ts —— 用 TD-02 的 zod schema 校验 data/generated/ 下的构建产物（TD-01 §12.4 的阻断项之一）
// 用法：pnpm check:data   （先 pnpm build:data）
//       pnpm check:data -- --flags 椿,散华,维里奈   另外按默认规则 + 角色模块覆盖装配这些角色，列出还没处理的 flag（TD-01 §14）
//                                                  与手填冷却和 nanoka 对不上的地方（m0-confirm §5）；
//                                                  名字是声骸时列声骸动作的 flag 与 nanoka 的说明（TD-01 §8）
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { z } from 'zod'
import { assembleBlock } from './assemble-action'
import type { CharacterModuleDef, EchoModule } from './define'
import type { ActionDef } from './gamedata'
import {
  GenActionFileSchema, GenCharactersSchema, GenEchoSchema, GenEnemySchema, GenMetaSchema, GenWeaponSchema, GoldenDamageSchema,
  GoldenZonesSchema, NanokaFileSchema, type GenEcho, type NanokaFile,
} from './generated.schema'
import { checkCooldowns, checkTreeStats } from './nanoka-check'
import { buildEcho } from './registry'

const root = new URL('../../data/generated/', import.meta.url)
if (!existsSync(new URL('meta.json', root))) {
  console.error('没有 data/generated/meta.json：先运行 pnpm build:data')
  process.exit(2)
}

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, root), 'utf8'))
let failed = 0
function check(schema: z.ZodType, rel: string): void {
  const r = schema.safeParse(read(rel))
  if (r.success) return
  failed++
  console.error(`✗ ${rel}\n${z.prettifyError(r.error)}`)
}

check(GenMetaSchema, 'meta.json')
check(GenCharactersSchema, 'characters.json')
check(z.record(z.string(), z.string()), 'formula-ref.json')
check(z.array(GenWeaponSchema), 'weapons.json')
const hasEchoes = existsSync(new URL('echoes.json', root))
if (hasEchoes) check(z.array(GenEchoSchema), 'echoes.json')
check(z.array(GenEnemySchema), 'enemies.json')
const actions = readdirSync(new URL('actions/', root)).filter(f => f.endsWith('.json'))
for (const f of actions) check(GenActionFileSchema, `actions/${f}`)
const hasNanoka = existsSync(new URL('nanoka.json', root))
if (hasNanoka) check(NanokaFileSchema, 'nanoka.json')
const hasGolden = existsSync(new URL('fixtures/golden-zones.json', root))
if (hasGolden) {
  check(GoldenDamageSchema, 'fixtures/golden-damage.json')
  check(GoldenZonesSchema, 'fixtures/golden-zones.json')
}

if (failed > 0) {
  console.error(`${failed} 个文件未通过 schema 校验`)
  process.exit(1)
}
console.log(`schema 校验通过：meta、characters、formula-ref、weapons${hasEchoes ? '、echoes' : ''}、enemies${hasNanoka ? '、nanoka' : ''}${hasGolden ? '、golden 两个夹具' : ''} 与 ${actions.length} 个动作文件`)
const nanoka: NanokaFile | undefined = hasNanoka ? NanokaFileSchema.parse(read('nanoka.json')) : undefined

const fi = process.argv.indexOf('--flags')
if (fi >= 0) {
  const names = (process.argv[fi + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  for (const name of names) await listFlags(name)
}

/** 装配后还挂着的 flag：覆盖过的字段、accept 过的 flag 不再列出（TD-01 §13.4）。M0–M3 只提示，不阻断 */
async function listFlags(name: string): Promise<void> {
  if (!existsSync(new URL(`actions/${name}.json`, root))) {
    const echo = hasEchoes ? z.array(GenEchoSchema).parse(read('echoes.json')).find(e => e.key === name) : undefined
    if (echo) return listEchoFlags(echo)
    console.error(`没有 ${name} 的动作文件，也不是声骸`)
    process.exitCode = 1
    return
  }
  const modUrl = new URL(`../../data/curated/characters/${name}.ts`, import.meta.url)
  const mod = existsSync(modUrl) ? ((await import(modUrl.href)) as { default: CharacterModuleDef }).default : undefined
  const assembled = assembleBlock(GenActionFileSchema.parse(read(`actions/${name}.json`)), mod?.actionOverrides)
  const acts = Object.values(assembled)
  const { lines, nAct, nJudg } = flagLines(acts)
  console.log(`\n${name}：${acts.length} 个动作；未处理的 flag 动作级 ${nAct}、判定级 ${nJudg}${mod ? '' : '（没有角色模块）'}`)
  for (const l of lines) console.log(l)
  const nk = nanoka?.characters[name]
  const cds = nk ? [...checkCooldowns(assembled, mod?.aliases ?? {}, nk), ...checkTreeStats(mod?.treeStats ?? {}, nk)] : []
  if (!nk) console.log(`  （nanoka.json 里没有${name}，冷却与技能树没核对）`)
  else if (cds.length > 0) console.log(`  冷却 / 技能树与 nanoka ${nanoka!.version} 对不上：\n${cds.map(c => `    ${c}`).join('\n')}`)
}

function flagLines(acts: ActionDef[]): { lines: string[]; nAct: number; nJudg: number } {
  const lines: string[] = []
  let nAct = 0, nJudg = 0
  for (const a of acts) {
    const jf = a.judgments.flatMap(j => j.flags.map(f => `${j.name}:${f}`))
    if (a.flags.length === 0 && jf.length === 0) continue
    nAct += a.flags.length
    nJudg += jf.length
    lines.push(`  ${a.id}  ${[...a.flags, ...jf].join('  ')}`)
  }
  return { lines, nAct, nJudg }
}

/** 声骸：动作与判定的 flag、声骸级 flag、各判定的倍率来源，附 nanoka 的说明与伤害条目（写 echoes.ts / dmg-join.json 时对照） */
async function listEchoFlags(e: GenEcho): Promise<void> {
  const url = new URL('../../data/curated/echoes.ts', import.meta.url)
  const mods = existsSync(url) ? ((await import(url.href)) as { default: EchoModule[] }).default : []
  const mod = mods.find(m => m.name === e.key)
  const def = buildEcho(e, mod)
  const acts = Object.values(def.actions)
  const { lines, nAct, nJudg } = flagLines(acts)
  console.log(`\n声骸 ${e.key}：${acts.length} 个动作；声骸级 flag ${def.flags.join('、') || '无'}；未处理的 flag 动作级 ${nAct}、判定级 ${nJudg}`
    + `${mod ? '' : '（不在 data/curated/echoes.ts）'}`)
  for (const l of lines) console.log(l)
  for (const a of acts) {
    for (const j of a.judgments) {
      const src = e.groups.flatMap(g => g.rows).find(r => r.row === j.row)?.dmg
      console.log(`  ${a.id} / ${j.name}：倍率 ${j.multiplier}（${src ? `${src.via} ${src.skillName}` : '没连上'}）、${j.element}、${j.relatedAttr}、${j.tags.join('/')}`)
    }
  }
  const nk = nanoka?.echoes[e.key]
  if (!nk) { console.log('  （nanoka.json 里没有这个声骸）'); return }
  console.log(`  nanoka ${nanoka!.version}「${nk.name}」${nk.cooldown !== null ? `冷却 ${nk.cooldown} 秒；` : ''}套装：${nk.sets.join('、') || '无'}`)
  console.log(`  说明：${nk.desc.replace(/\n/g, ' / ')}`)
  for (const d of nk.damage)
    console.log(`  条目 ${d.id}：5 级 ${(d.rateLv[4] ?? d.rateLv.at(-1) ?? 0) / 100}%、元素 ${d.element}、${d.relatedProperty}、类型 ${d.type}、削韧 ${d.toughLv / 100}、能量 ${d.energy / 100}`)
}
