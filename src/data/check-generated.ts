// src/data/check-generated.ts —— 用 TD-02 的 zod schema 校验 data/generated/ 下的构建产物（TD-01 §12.4 的阻断项之一）
// 用法：pnpm check:data   （先 pnpm build:data）
//       pnpm check:data -- --flags 椿,散华,维里奈   另外按默认规则 + 角色模块覆盖装配这些角色，列出还没处理的 flag（TD-01 §14）
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { z } from 'zod'
import { assembleBlock } from './assemble-action'
import type { CharacterModuleDef } from './define'
import { GenActionFileSchema, GenCharactersSchema, GenMetaSchema } from './generated.schema'

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
const actions = readdirSync(new URL('actions/', root)).filter(f => f.endsWith('.json'))
for (const f of actions) check(GenActionFileSchema, `actions/${f}`)

if (failed > 0) {
  console.error(`${failed} 个文件未通过 schema 校验`)
  process.exit(1)
}
console.log(`schema 校验通过：meta、characters、formula-ref 与 ${actions.length} 个动作文件`)

const fi = process.argv.indexOf('--flags')
if (fi >= 0) {
  const names = (process.argv[fi + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  for (const name of names) await listFlags(name)
}

/** 装配后还挂着的 flag：覆盖过的字段、accept 过的 flag 不再列出（TD-01 §13.4）。M0–M3 只提示，不阻断 */
async function listFlags(name: string): Promise<void> {
  if (!existsSync(new URL(`actions/${name}.json`, root))) { console.error(`没有 ${name} 的动作文件`); process.exitCode = 1; return }
  const modUrl = new URL(`../../data/curated/characters/${name}.ts`, import.meta.url)
  const mod = existsSync(modUrl) ? ((await import(modUrl.href)) as { default: CharacterModuleDef }).default : undefined
  const acts = Object.values(assembleBlock(GenActionFileSchema.parse(read(`actions/${name}.json`)), mod?.actionOverrides))
  const lines: string[] = []
  let nAct = 0, nJudg = 0
  for (const a of acts) {
    const jf = a.judgments.flatMap(j => j.flags.map(f => `${j.name}:${f}`))
    if (a.flags.length === 0 && jf.length === 0) continue
    nAct += a.flags.length
    nJudg += jf.length
    lines.push(`  ${a.id}  ${[...a.flags, ...jf].join('  ')}`)
  }
  console.log(`\n${name}：${acts.length} 个动作；未处理的 flag 动作级 ${nAct}、判定级 ${nJudg}${mod ? '' : '（没有角色模块）'}`)
  for (const l of lines) console.log(l)
}
