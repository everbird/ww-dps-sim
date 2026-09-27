// src/data/check-generated.ts —— 用 TD-02 的 zod schema 校验 data/generated/ 下的构建产物（TD-01 §12.4 的阻断项之一）
// 用法：pnpm check:data   （先 pnpm build:data）
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { z } from 'zod'
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
