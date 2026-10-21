// src/data/scenario-text.ts —— 改场景原文（YAML）里的循环轴或启动轴，其余照原文。轴搜索、按套路排轴另存成场景用（TD-10 §6.1、§6.2），命令行与网页共用
import { parseDocument } from 'yaml'

/** 换掉场景原文里的循环轴（base 是原来的各行、lines 是新的各行，都不带注释）：块状写法的 rotation 只换它下面的条目行，
 *  没改的行（连注释）原样保留，改了的行注明 note（缺省"轴搜索改的"）；不是块状写法时用 yaml 的 Document 改（注释保留，长的行内写法不折行） */
export function withRotation(text: string, base: readonly string[], lines: readonly string[], note = '轴搜索改的'): string {
  return withList(text, 'rotation', base, lines, note)
}

/** 同 withRotation，换的是启动轴 opening（按套路排启动轴，TD-10 §6.2 ④′） */
export function withOpening(text: string, base: readonly string[], lines: readonly string[], note = '按套路排轴改的'): string {
  return withList(text, 'opening', base, lines, note)
}

function withList(text: string, key: 'rotation' | 'opening', base: readonly string[], lines: readonly string[], note: string): string {
  const rows = text.split('\n')
  const at = rows.findIndex(l => new RegExp(`^${key}:\\s*(#.*)?$`).test(l))
  if (at < 0) {
    const doc = parseDocument(text)
    doc.set(key, doc.createNode([...lines]))
    return doc.toString({ lineWidth: 0 })
  }
  let end = at + 1
  while (end < rows.length && (rows[end]!.startsWith(' ') || rows[end]!.trim() === '')) end++
  const items = rows.slice(at + 1, end).filter(l => /^\s+- /.test(l))
  const same = lines.length === base.length
  const body = lines.map((l, i) => (same && l === base[i] && items[i] !== undefined ? items[i]! : `  - ${l}   # ${note}`))
  return [...rows.slice(0, at + 1), ...body, ...rows.slice(end)].join('\n')
}
