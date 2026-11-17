// tests/layering.test.ts —— 四条边界（DD-10 §4–§6；总设计 §10.1）。用 TypeScript AST 检查，注释不算 import / 取整。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const EXECUTION = new Set([
  'kernel', 'scheduler', 'switch', 'resources', 'triggers', 'buffs', 'enemy', 'formula',
  'simulate', 'context', 'num', 'rng', 'types', 'wait-codes', 'event-util', 'filler',   // filler：补位看哪一条，编译与调度共用（原来两边各抄一份）
])
const ENTRY_REPORT = new Set(['resolve', 'compile', 'run', 'strict', 'portable', 'summary', 'invariants', 'basis', 'resource-replay'])   // resource-replay：DD-09 §3.2，按日志重放资源（checkLog、汇总共用）
// DD-10 §4–§5：显式分类，不允许新执行文件因漏列 EXECUTION 而绕过规则 3。
const QUERY_DIAGNOSTICS = new Set(['diagnostics', 'digest', 'probe', 'query', 'run-types', 'snapshot', 'wire'])
const LEDGER = new Set(['assumptions', 'propositions', 'rule-points'])
const ENGINE_GROUPS = [EXECUTION, ENTRY_REPORT, QUERY_DIAGNOSTICS, LEDGER, new Set(['index'])]
const NODE_ONLY = new Set(['fs', 'path', 'child_process', 'crypto', 'http', 'https', 'net', 'worker_threads'])

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
function importsOf(source: ts.SourceFile): string[] {
  const result: string[] = []
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      result.push(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      result.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}
function targetOf(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  return relative(SRC, normalize(join(SRC, dirname(file), spec))).replace(/\\/g, '/').replace(/\.ts$/, '').replace(/\/index$/, '')
}

/** 无迁移豁免名单：类型 import 也受单向边界约束（DD-10 §4）。 */
function violations(sources: ReadonlyMap<string, string>): string[] {
  const result: string[] = []
  for (const [file, text] of sources) {
    const tree = parse(text)
    const engine = file.startsWith('engine/')
    const analysis = file.startsWith('analysis/')
    const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.ts$/, '')
    if (engine && (file !== `engine/${name}.ts` || ENGINE_GROUPS.filter(group => group.has(name)).length !== 1))
      result.push(`${file}: 引擎文件必须唯一显式归层（DD-10 §4）`)
    for (const spec of importsOf(tree)) {
      const target = targetOf(file, spec)
      const bare = spec.replace(/^node:/, '').split('/')[0]!
      if (NODE_ONLY.has(bare) || target === 'data/load') result.push(`${file}: 纯库不能 import ${spec}（规则 2）`)
      if (engine && target !== null && !target.startsWith('engine/') && target !== 'engine' && !target.startsWith('data/'))
        result.push(`${file}: 核心不能 import ${spec}（规则 1）`)
      if (analysis && target !== null && target !== 'engine' && !target.startsWith('analysis/') && !target.startsWith('data/'))
        result.push(`${file}: 分析层只能经 engine/index、data 或本层引入 ${spec}（规则 1）`)
      if (engine && EXECUTION.has(name) && (target === 'engine' || (target?.startsWith('engine/') && ENTRY_REPORT.has(target.slice('engine/'.length)))))
        result.push(`${file}: 执行组不能 import ${spec}（规则 3）`)
    }
    if (!engine) continue
    for (const statement of tree.statements) {
      if (ts.isVariableStatement(statement) && !(statement.declarationList.flags & ts.NodeFlags.Const))
        result.push(`${file}: 模块级可变变量（规则 4）`)
    }
    function numbers(node: ts.Node): void {
      if (name !== 'num' && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math' && ['round', 'floor'].includes(node.name.text))
        result.push(`${file}: Math.${node.name.text} 必须经 num.ts（规则 4）`)
      ts.forEachChild(node, numbers)
    }
    numbers(tree)
  }
  return result
}
function sourcesIn(dir: string): [string, string][] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap(e => {
    const name = `${dir}/${e.name}`
    return e.isDirectory() ? sourcesIn(name) : e.name.endsWith('.ts') ? [[name, readFileSync(join(SRC, name), 'utf8')] as [string, string]] : []
  })
}

describe('四层边界（DD-10 §4–§6）', () => {
  it('实际源文件满足四条规则，无执行组迁移豁免', () => {
    const dirs = readdirSync(SRC)
    const sources = new Map(['engine', 'analysis'].filter(d => dirs.includes(d)).flatMap(sourcesIn))
    expect(violations(sources)).toEqual([])
  })
  it('新增或嵌套引擎文件不能靠未归层绕过执行组约束', () => {
    for (const file of ['engine/new-execution.ts', 'engine/nested/kernel.ts'])
      expect(violations(new Map([[file, `import { x } from '../summary'`]])))
        .toContain(`${file}: 引擎文件必须唯一显式归层（DD-10 §4）`)
    expect(violations(new Map([['engine/new-execution.ts', '']]))).toHaveLength(1)
  })
  it('识别静态、类型、转发和动态 import，忽略注释', () => {
    expect(importsOf(parse(`import { a } from './a'; import type { B } from './b'; export * from './c'; import './d'; const x = import('./e'); // import './fake'`)))
      .toEqual(['./a', './b', './c', './d', './e'])
  })
  it('规则 1：引擎不依赖分析或外围，分析只经公开入口', () => {
    for (const path of ['../analysis/fit', '../report/timeline', '../cli/format', '../../web/app/x'])
      expect(violations(new Map([['engine/kernel.ts', `import { x } from '${path}'`]]))).toHaveLength(1)
    expect(violations(new Map([['analysis/fit.ts', `import { x } from '../engine/query'`]]))).toHaveLength(1)
    expect(violations(new Map([['analysis/fit.ts', `import { x } from '../engine'; import type { Y } from '../engine/index'; import { z } from '../data/gamedata'; import { q } from './trace'`]]))).toEqual([])
  })
  it('规则 2：两层都是纯库', () => {
    for (const file of ['engine/kernel.ts', 'analysis/fit.ts'])
      for (const path of ['node:fs', 'fs/promises', 'path', 'child_process', 'crypto', '../data/load'])
        expect(violations(new Map([[file, `import { x } from '${path}'`]]))).toHaveLength(1)
  })
  it('规则 3：执行组不能倒引入口、汇总与不变量，报告可引用执行组', () => {
    for (const path of ['run', 'resolve', 'compile', 'summary', 'invariants', 'index'])
      expect(violations(new Map([['engine/kernel.ts', `import type { X } from './${path}'`]]))).toHaveLength(1)
    expect(violations(new Map([['engine/summary.ts', `import type { X } from './types'`]]))).toEqual([])
  })
  it('规则 4：模块级 let/var 与散落取整失败，函数内局部状态合法', () => {
    for (const source of ['let x = 1', 'var x = 1', 'export let x = 1', 'const f = Math.round', 'const f = (n: number) => Math.floor(n)'])
      expect(violations(new Map([['engine/kernel.ts', source]]))).toHaveLength(1)
    expect(violations(new Map([['engine/kernel.ts', '// Math.round(x)\nfunction f() { let n = 0; return n }']]))).toEqual([])
    expect(violations(new Map([['engine/num.ts', 'export const round = (x: number) => Math.round(x)']]))).toEqual([])
  })
})
