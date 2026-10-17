// web/app/src/peek.ts —— 不跑仿真、只从 YAML 原文里读几样东西（下拉框的候选用）；写到一半解析不了时退回粗读
import { parse } from 'yaml'

/** 场景里的队伍（编辑器里改了队伍也能跟上）：按 YAML 解析 team[].char，行内写法也认；写到一半解析不了时退回粗读 "- char: X" */
export function teamOf(text: string): string[] {
  try {
    const team = (parse(text) as { team?: { char?: unknown }[] } | null)?.team
    if (Array.isArray(team)) return team.map(m => (m && typeof m.char === 'string' ? m.char.trim() : '')).filter(Boolean)
  } catch { /* 写到一半：用下面的粗读 */ }
  return [...text.matchAll(/^\s*-\s*(?:\{\s*)?char:\s*([^\s,}]+)/gm)].map(m => m[1]!)
}

/** 库存里出现过的套装（择优页"5 件套"的候选） */
export function setsOf(text: string): string[] {
  try {
    const list = (parse(text) as { echoes?: { set?: unknown }[] } | null)?.echoes
    if (Array.isArray(list)) return [...new Set(list.map(e => (e && typeof e.set === 'string' ? e.set.trim() : '')).filter(Boolean))]
  } catch { /* 写到一半 */ }
  return [...new Set([...text.matchAll(/set:\s*([^\s,}]+)/g)].map(m => m[1]!))]
}
