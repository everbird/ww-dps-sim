// src/cli/evidence-file.ts —— 闭环记录文件的读写（DD-08 §4.1、§4.2）：docs/evidence/<闭环 ID>.yaml。
// 只改命令负责的那几个字段（predict：各候选的 runs、predictions；register：preRegistration；judge：verdicts、conclusion；rerun：reruns），
// 其余人写的字段与注释原样保留（yaml 的 Document 接口）。同样的内容写出同样的文本：重复运行结果不变（C08-12）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseDocument, type Document } from 'yaml'
import { ClosureRecordSchema, type ClosureRecord } from '../data/evidence.schema'
import type { RunIdentity } from '../engine/run-types'
import { toWire } from '../engine/wire'

export const EVIDENCE_DIR = 'docs/evidence'
/** 一条闭环登记的预测运行、重跑的运行，身份存这里：一个文件一张"runId → 身份"的表 */
export const RUNS_DIR = `${EVIDENCE_DIR}/runs`

export interface ClosureFile { readonly path: string; readonly doc: Document; readonly record: ClosureRecord }

export function parseClosure(text: string, path = '<闭环>'): { doc: Document; record: ClosureRecord } {
  const doc = parseDocument(text)
  if (doc.errors.length) throw new Error(`${path}：${doc.errors.map(e => e.message).join('；')}`)
  const r = ClosureRecordSchema.safeParse(doc.toJS())
  if (!r.success) throw new Error(`${path}：${r.error.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；')}`)
  return { doc, record: r.data }
}

export function readClosure(path: string): ClosureFile {
  return { path, ...parseClosure(readFileSync(path, 'utf8'), path) }
}

/** 命令负责的字段 */
export type OwnedFields = Partial<Pick<ClosureRecord, 'candidates' | 'preRegistration' | 'verdicts' | 'conclusion' | 'reruns'>>

/** 把命令算出的字段写回文档，返回新文本（不落盘，测试用）。candidates 只写各候选的 runs 与 predictions，候选的条件等人写的不动 */
export function closureText(doc: Document, fields: OwnedFields): string {
  const d = doc.clone()
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown   // 去掉 undefined 的键，免得写出 null
  if (fields.candidates) {
    fields.candidates.forEach((c, i) => {
      if (d.getIn(['candidates', i, 'candidateId']) !== c.candidateId) throw new Error(`第 ${i + 1} 个候选的 ID 对不上：${c.candidateId}`)
      d.setIn(['candidates', i, 'runs'], d.createNode(plain(c.runs)))
      d.setIn(['candidates', i, 'predictions'], d.createNode(plain(c.predictions)))
    })
  }
  for (const k of ['preRegistration', 'verdicts', 'conclusion', 'reruns'] as const) {
    if (fields[k] !== undefined) d.set(k, d.createNode(plain(fields[k])))
  }
  const text = d.toString({ lineWidth: 0 })
  parseClosure(text)                                     // 写出去的要能读回来、过 schema
  return text
}

export function writeClosure(f: ClosureFile, fields: OwnedFields): ClosureFile {
  const text = closureText(f.doc, fields)
  writeFileSync(f.path, text)
  return readClosure(f.path)
}

/** 身份文件：runId → 身份（wire 规范化，键排序）。整个文件按这次的运行重写（predict、register、rerun 各管自己的文件） */
export function writeIdentities(path: string, identities: ReadonlyMap<string, RunIdentity>): void {
  const all: Record<string, unknown> = {}
  for (const [id, x] of identities) all[id] = toWire(x)
  const sorted = Object.fromEntries(Object.keys(all).sort().map(k => [k, all[k]]))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n')
}

/** 读身份文件里的若干条：引用写成 "<文件>#<runId>" */
export function readIdentities(refs: readonly string[]): Map<string, RunIdentity> {
  const out = new Map<string, RunIdentity>()
  const files = new Map<string, Record<string, RunIdentity>>()
  for (const ref of refs) {
    const [file, id] = ref.split('#') as [string, string | undefined]
    if (!id) continue
    if (!files.has(file)) files.set(file, existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, RunIdentity>) : {})
    const x = files.get(file)![id]
    if (x) out.set(id, x)
  }
  return out
}
