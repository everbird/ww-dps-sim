// web/app/src/docs.svelte.ts —— 可编辑的 YAML：仓库里的场景（scenarios/*.yaml）与库存（inventory/*.yaml），加上在网页里另存的副本。
// 改动存在本浏览器（localStorage），不写回仓库；要留下来就"下载"后放回仓库。
const SCENARIOS = import.meta.glob<string>('../../../scenarios/*.yaml', { query: '?raw', import: 'default', eager: true })
const INVENTORIES = import.meta.glob<string>('../../../inventory/*.yaml', { query: '?raw', import: 'default', eager: true })

export type DocKind = 'scenario' | 'inventory'
export interface Doc { kind: DocKind; name: string; original: string | null; text: string }   // original 为 null：网页里另存的副本

const KEY = 'wwdps.docs.v1'
const fileName = (p: string) => p.replace(/^.*\//, '')

function load(): Doc[] {
  const repo: Doc[] = [
    ...Object.entries(SCENARIOS).map(([p, t]) => ({ kind: 'scenario' as const, name: fileName(p), original: t, text: t })),
    ...Object.entries(INVENTORIES).map(([p, t]) => ({ kind: 'inventory' as const, name: fileName(p), original: t, text: t })),
  ]
  let saved: { kind: DocKind; name: string; text: string; copy: boolean }[] = []
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { saved = [] }
  for (const s of saved) {
    const d = repo.find(x => x.kind === s.kind && x.name === s.name)
    if (d) d.text = s.text
    else if (s.copy) repo.push({ kind: s.kind, name: s.name, original: null, text: s.text })
  }
  return repo
}

export const docs: Doc[] = $state(load())

/** 存改动：只存改过的与副本 */
export function persist(): void {
  const out = docs.filter(d => d.original === null || d.text !== d.original)
    .map(d => ({ kind: d.kind, name: d.name, text: d.text, copy: d.original === null }))
  try { localStorage.setItem(KEY, JSON.stringify(out)) } catch { /* 存不了就算了：只是本次会话有效 */ }
}

export const ofKind = (kind: DocKind) => docs.filter(d => d.kind === kind)
export const find = (kind: DocKind, name: string) => docs.find(d => d.kind === kind && d.name === name)

/** 另存一份副本，返回新名字 */
export function copyOf(d: Doc): string {
  const stem = d.name.replace(/\.yaml$/, '')
  let n = 2
  while (find(d.kind, `${stem}-${n}.yaml`)) n++
  const name = `${stem}-${n}.yaml`
  docs.push({ kind: d.kind, name, original: null, text: d.text })
  persist()
  return name
}

export function remove(d: Doc): void {
  const i = docs.indexOf(d)
  if (i >= 0 && d.original === null) docs.splice(i, 1)
  persist()
}

/** 场景里的队伍（编辑器里改了队伍也能跟上）：粗读 "- char: X" */
export const teamOf = (text: string): string[] => [...text.matchAll(/^\s*-\s*char:\s*(\S+)/gm)].map(m => m[1]!)
