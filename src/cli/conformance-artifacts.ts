// DD-10 §6：一致性样例格式、清单与首个差异校验。诊断不进入任何样例。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, sha256Hex } from '../engine/digest'
import { portable } from '../engine/portable'
import type { PreparedRun, RunIdentity } from '../engine/run-types'
import { OUTPUT_SCHEMA_VERSION } from '../engine/run-types'
import type { SimResult } from '../engine/types'
import { WIRE_SCHEMA_VERSION } from '../engine/wire'
import { firstDifference } from '../analysis/zero-interference'
import { BOUNDARY_CASES, type BoundaryCase } from './conformance-cases'

export type CaseSource = { readonly scenario: string } | { readonly boundary: BoundaryCase }
export interface ConformanceCase {
  readonly name: string
  readonly source: CaseSource
  readonly run: PreparedRun
  readonly result: SimResult
}
export interface Manifest {
  readonly OUTPUT_SCHEMA_VERSION: string
  readonly WIRE_SCHEMA_VERSION: string
  readonly cases: readonly {
    readonly name: string
    readonly source: CaseSource
    readonly runId: string
    readonly files: Readonly<Record<string, string>> // SHA-256，含末尾换行的 UTF-8 文件
  }[]
}
function identityOf(identity: RunIdentity) {
  const { gitCommit: _git, contentFingerprint: _fingerprint, ...execution } = identity.execution
  return { data: identity.data, execution }
}
/** 用 canonicalJson 而非 JSON.stringify，保留无穷、Map、Set 的 wire 语义。 */
export function caseArtifacts(c: ConformanceCase): Record<string, string> {
  const { diag: _diag, identity, ...result } = c.result
  return {
    [`${c.name}.input.json`]: canonicalJson({ resolved: portable(c.run.resolved), effective: c.run.effective,
      runId: c.run.runId, identity: identityOf(c.run.identity) }) + '\n',
    [`${c.name}.output.json`]: canonicalJson({ ...result, identity: identityOf(identity) }) + '\n',
  }
}
export function manifestOf(cases: readonly ConformanceCase[]): Manifest {
  const names = new Set<string>()
  return {
    OUTPUT_SCHEMA_VERSION, WIRE_SCHEMA_VERSION,
    cases: cases.map(c => {
      if (!/^[^/\\]+$/.test(c.name) || names.has(c.name)) throw new Error(`样例名无效或重复：${c.name}`)
      names.add(c.name)
      return { name: c.name, source: c.source, runId: c.run.runId,
        files: Object.fromEntries(Object.entries(caseArtifacts(c)).map(([file, text]) => [file, sha256Hex(text)])) }
    }),
  }
}
export function writeConformance(dir: string, cases: readonly ConformanceCase[]): void {
  const manifest = manifestOf(cases)
  mkdirSync(dir, { recursive: true })
  for (const c of cases) for (const [file, content] of Object.entries(caseArtifacts(c))) writeFileSync(join(dir, file), content)
  writeFileSync(join(dir, 'MANIFEST.json'), canonicalJson(manifest) + '\n')
}
export function readManifest(dir: string): Manifest {
  const m = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8')) as Manifest
  if (!m || typeof m.OUTPUT_SCHEMA_VERSION !== 'string' || typeof m.WIRE_SCHEMA_VERSION !== 'string'
    || !Array.isArray(m.cases) || m.cases.length === 0) throw new Error('MANIFEST.json：版本或 cases 无效（不能为空）')
  const names = new Set<string>()
  for (const c of m.cases) {
    if (!c || typeof c.name !== 'string' || !/^[^/\\\\]+$/.test(c.name) || names.has(c.name)
      || typeof c.runId !== 'string' || !c.source || typeof c.source !== 'object'
      || !c.files || typeof c.files !== 'object' || Array.isArray(c.files)) throw new Error('MANIFEST.json：样例结构无效')
    names.add(c.name)
    if ('boundary' in c.source ? !BOUNDARY_CASES.includes(c.source.boundary)
      : !('scenario' in c.source) || typeof c.source.scenario !== 'string') throw new Error('MANIFEST.json：样例来源无效')
    const files = Object.keys(c.files).sort()
    if (files.join('|') !== [`${c.name}.input.json`, `${c.name}.output.json`].join('|')
      || Object.values(c.files).some(h => typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h))) throw new Error('MANIFEST.json：文件清单或摘要无效')
  }
  return m
}
/** 先比业务 JSON，确保篡改事件时报告 log[n].field，而不是只有摘要不同。 */
export function verifyConformance(dir: string, cases: readonly ConformanceCase[]): string | null {
  const expected = manifestOf(cases)
  for (const c of cases) {
    for (const [file, content] of Object.entries(caseArtifacts(c))) {
      let actual: string
      try { actual = readFileSync(join(dir, file), 'utf8') }
      catch { return `${file}：文件不存在或不可读` }
      let parsed: unknown
      try { parsed = JSON.parse(actual) }
      catch { return `${file}：不是有效 JSON` }
      const diff = firstDifference(JSON.parse(content), parsed, file)
      if (diff) return diff
    }
  }
  let actual: Manifest
  try { actual = readManifest(dir) }
  catch { return 'MANIFEST.json：不存在、不可读或不是有效 JSON' }
  const structure = (m: Manifest) => ({ ...m, cases: m.cases.map(c => ({ ...c, files: Object.keys(c.files).sort() })) })
  const diff = firstDifference(JSON.parse(canonicalJson(structure(expected))), structure(actual), 'MANIFEST.json')
  if (diff) return diff
  // 格式可不同，但清单上的摘要必须确实属于待验证文件。
  for (const c of expected.cases) for (const file of Object.keys(c.files)) {
    const hash = sha256Hex(readFileSync(join(dir, file), 'utf8'))
    const declared = actual.cases.find(x => x.name === c.name)?.files[file]
    if (hash !== declared) return `MANIFEST.json.cases[${c.name}].files.${file}：文件摘要不符`
  }
  return null
}
