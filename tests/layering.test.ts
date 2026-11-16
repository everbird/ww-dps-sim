// tests/layering.test.ts —— 分层检查（DD-01 §3.9；架构 §1.2）：读源码文本做静态检查，不执行被测模块。
// 规则 1 核心不反向依赖：执行核心、查询与诊断、台账不 import 分析层的文件，也不 import src/cli、src/report、web。
// 规则 2 纯库：src/engine 下所有文件不 import fs、path、child_process、crypto（含 node: 写法），也不 import src/data/load.ts。
// 防呆：src/engine 下出现了没归层的新文件就失败，提示把它归到某一层。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ENGINE = fileURLToPath(new URL('../src/engine/', import.meta.url))

/** ④ 分析与应用：架构附录 B 的 14 个，加详细设计新增的 candidates（DD-04）、observations（DD-08、DD-09） */
const ANALYSIS = [
  'analysis', 'calibration', 'cards', 'fit', 'fuzz', 'insight', 'matrix', 'optimize', 'plan', 'sample', 'scorecard', 'search', 'sensitivity', 'trace',
  'candidates', 'observations',
]
/** ① 执行核心、①D 查询与诊断、② 台账：架构 §1.1 的 18 个，加 DD-01 新增的 run、run-types、digest，DD-04 新增的 propositions（② 台账）。新文件先在这里归层 */
const CORE = [
  'kernel', 'scheduler', 'switch', 'resources', 'triggers', 'buffs', 'enemy', 'formula', 'simulate', 'context', 'num', 'rng',
  'resolve', 'portable', 'types', 'summary', 'invariants', 'assumptions',
  'run', 'run-types', 'digest', 'basis', 'propositions',
]
const NODE_ONLY = ['fs', 'path', 'child_process', 'crypto']
const CONSUMERS = ['../cli/', '../report/', '../../web/']

/** 源码里 import / export … from '…'、import '…'、import('…') 的路径 */
function importsOf(source: string): string[] {
  const out: string[] = []
  const res = [
    /(?:^|[\s;])(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of res) for (const m of source.matchAll(re)) out.push(m[1]!)
  return out
}

/** 相对路径解析到 src/engine 下的哪个文件（去掉扩展名）；不在 src/engine 下的返回 null */
function engineFile(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const abs = normalize(join(dirname(join(ENGINE, `${from}.ts`)), spec)).replace(/\.ts$/, '')
  const dir = normalize(ENGINE).replace(/[\\/]$/, '')
  return dirname(abs) === dir ? abs.slice(dir.length + 1) : null
}
const isLoad = (from: string, spec: string): boolean =>
  spec.startsWith('.') && normalize(join(ENGINE, dirname(`${from}.ts`), spec)).replace(/\.ts$/, '') === normalize(join(ENGINE, '../data/load'))

/** sources：文件名（不带扩展名）→ 源码。返回违反的地方，每条一行 */
function violations(sources: ReadonlyMap<string, string>): string[] {
  const out: string[] = []
  for (const [file, text] of sources) {
    const analysis = ANALYSIS.includes(file)
    if (!analysis && !CORE.includes(file)) out.push(`${file}.ts：没归层，把它加进 tests/layering.test.ts 的 ANALYSIS（分析层）或 CORE（执行核心、查询与诊断、台账）`)
    for (const spec of importsOf(text)) {
      const bare = spec.replace(/^node:/, '')
      if (NODE_ONLY.includes(bare) || NODE_ONLY.some(n => bare.startsWith(`${n}/`))) out.push(`${file}.ts：纯库不能 import ${spec}（规则 2）`)
      if (isLoad(file, spec)) out.push(`${file}.ts：纯库不能 import src/data/load.ts（规则 2）`)
      if (analysis) continue
      const target = engineFile(file, spec)
      if (target !== null && ANALYSIS.includes(target)) out.push(`${file}.ts：核心不能 import 分析层的 ${target}.ts（规则 1）`)
      if (CONSUMERS.some(c => spec.startsWith(c))) out.push(`${file}.ts：核心不能 import ${spec}（规则 1）`)
    }
  }
  return out
}

const sources = new Map(readdirSync(ENGINE).filter(f => f.endsWith('.ts')).sort().map(f => [f.replace(/\.ts$/, ''), readFileSync(join(ENGINE, f), 'utf8')] as const))

describe('分层检查（DD-01 §3.9）', () => {
  it('src/engine 现有的文件没有违反', () => {
    expect(violations(sources)).toEqual([])
  })

  it('取得到各种写法的 import', () => {
    expect(importsOf(`import { a,\n  b } from './x'\nimport type { T } from "../y"\nexport * from './z'\nexport { q } from './w'\nimport './side'\nconst m = await import('./dyn')`))
      .toEqual(['./x', '../y', './z', './w', './side', './dyn'])
  })

  it('核心 import 分析层、外围消费层时失败（规则 1）', () => {
    const doctored = (line: string) => violations(new Map([...sources, ['kernel', `${line}\n${sources.get('kernel')!}`]]))
    expect(doctored(`import { replayFit } from './fit'`)).toEqual(['kernel.ts：核心不能 import 分析层的 fit.ts（规则 1）'])
    expect(doctored(`import type { Basis } from './analysis'`)).toHaveLength(1)
    expect(doctored(`import { fmt } from '../cli/format'`)).toHaveLength(1)
    expect(doctored(`import { x } from '../report/timeline'`)).toHaveLength(1)
    // 分析层互相引用、引用核心都可以
    expect(violations(new Map([...sources, ['fit', `import { panelsOf } from './analysis'\n${sources.get('fit')!}`]]))).toEqual([])
  })

  it('任何一层 import Node 专有模块、读盘适配时失败（规则 2）', () => {
    const doctored = (file: string, line: string) => violations(new Map([...sources, [file, `${line}\n${sources.get(file)!}`]]))
    expect(doctored('kernel', `import { readFileSync } from 'node:fs'`)).toHaveLength(1)
    expect(doctored('fit', `import { join } from 'path'`)).toHaveLength(1)
    expect(doctored('digest', `import { createHash } from 'node:crypto'`)).toHaveLength(1)
    expect(doctored('trace', `import { execSync } from 'child_process'`)).toHaveLength(1)
    expect(doctored('sensitivity', `import { loadGameData } from '../data/load'`)).toHaveLength(1)
  })

  it('没归层的新文件失败并提示', () => {
    const v = violations(new Map([...sources, ['brand-new', 'export const x = 1\n']]))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('没归层')
  })
})
