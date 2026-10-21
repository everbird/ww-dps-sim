// src/data/scenario-text.ts —— 改场景原文（YAML）里的循环轴，其余照原文。轴搜索另存成场景用（TD-10 §6.1），命令行与网页共用
import { parseDocument } from 'yaml'

/** 换掉场景原文里的循环轴（base 是原来的各行、lines 是新的各行，都不带注释）：块状写法的 rotation 只换它下面的条目行，
 *  没改的行（连注释）原样保留，改了的行注明"轴搜索改的"；不是块状写法时用 yaml 的 Document 改（注释保留，长的行内写法不折行） */
export function withRotation(text: string, base: readonly string[], lines: readonly string[]): string {
  const rows = text.split('\n')
  const at = rows.findIndex(l => /^rotation:\s*(#.*)?$/.test(l))
  if (at < 0) {
    const doc = parseDocument(text)
    doc.set('rotation', doc.createNode([...lines]))
    return doc.toString({ lineWidth: 0 })
  }
  let end = at + 1
  while (end < rows.length && (rows[end]!.startsWith(' ') || rows[end]!.trim() === '')) end++
  const items = rows.slice(at + 1, end).filter(l => /^\s+- /.test(l))
  const same = lines.length === base.length
  const body = lines.map((l, i) => (same && l === base[i] && items[i] !== undefined ? items[i]! : `  - ${l}   # 轴搜索改的`))
  return [...rows.slice(0, at + 1), ...body, ...rows.slice(end)].join('\n')
}
