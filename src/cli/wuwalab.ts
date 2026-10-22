// src/cli/wuwalab.ts —— pnpm crosscheck:wuwalab [--refresh] [--md 输出.md]：拿 WuwaLAB 的动作数据核对现有场景里的角色（src/data/wuwalab-check.ts）。
// 数据缓存在 data/raw/wuwalab/<slug>.json（不进 git，同 nanoka）；--refresh 重新下载。★ = 现有场景的轴里用到的动作
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGameData } from '../data/load'
import { crosscheckWuwalab, type WlAbility } from '../data/wuwalab-check'
import { resolveScenario } from '../engine/resolve'
import type { ResolvedMember } from '../engine/types'
import { argsOf, loadScenario } from './format'

/** 角色名 → WuwaLAB 的 slug（加角色时补） */
const SLUG: Record<string, string> = { 椿: 'camellya', 散华: 'sanhua', 维里奈: 'verina', 心: 'hsin', '雷主·男': 'roverelectro', 卜灵: 'buling' }
const DIR = 'data/raw/wuwalab'

async function fetchJson(slug: string, refresh: boolean): Promise<{ abilities: WlAbility[] }> {
  const file = join(DIR, `${slug}.json`)
  if (refresh || !existsSync(file)) {
    mkdirSync(DIR, { recursive: true })
    const res = await fetch(`https://api.wuwalab.com/api/app/characters/${slug}`)
    if (!res.ok) throw new Error(`WuwaLAB ${slug}：HTTP ${res.status}`)
    writeFileSync(file, await res.text())
  }
  return JSON.parse(readFileSync(file, 'utf8')) as { abilities: WlAbility[] }
}

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--md'])
  const refresh = pos.includes('--refresh')
  const data = await loadGameData()
  // 现有场景里的角色与轴里用到的动作
  const members = new Map<string, ResolvedMember>()
  const used = new Set<string>()
  for (const f of readdirSync('scenarios').filter(f => f.endsWith('.yaml'))) {
    const r = resolveScenario(loadScenario(join('scenarios', f)), data)
    for (const m of r.team) members.set(m.def.name, m)
    for (const c of [...r.opening, ...r.commands]) if (c.kind === 'act') used.add(`${r.team[c.slot]!.def.name}|${c.action}`)
  }
  const out = ['# 与 WuwaLAB 的动作数据核对', '', `由 \`pnpm crosscheck:wuwalab --md …\` 生成；数据 ${data.version}。★ = 现有场景的轴里用到的动作。WuwaLAB 不是原包真值（有作者实测），对不上的是线索。`, '']
  let total = 0, matched = 0, clean = 0
  for (const [name, m] of members) {
    const slug = SLUG[name]
    if (!slug) { out.push(`## ${name}`, '', '没有 WuwaLAB 的 slug，跳过（在 src/cli/wuwalab.ts 的 SLUG 补）', ''); continue }
    const wl = await fetchJson(slug, refresh)
    const rows = crosscheckWuwalab(m.actions, wl.abilities)
    total += rows.length
    matched += rows.filter(r => r.action).length
    clean += rows.filter(r => r.action && r.diffs.length === 0).length
    out.push(`## ${name}（${slug}）`, '', '| WuwaLAB 动作 | 我们 | 差在哪 |', '|---|---|---|')
    const star = (r: (typeof rows)[number]) => (r.action && used.has(`${name}|${r.action}`) ? '★ ' : '')
    for (const r of [...rows].sort((a, b) => Number(!!star(b)) - Number(!!star(a)) || b.diffs.length - a.diffs.length))
      out.push(`| ${star(r)}${r.ability} | ${r.action ?? '—'}${r.alternatives ? `（另 ${r.alternatives} 个同倍率）` : ''} | ${r.diffs.join('；') || '一致'} |`)
    out.push('')
  }
  out.splice(4, 0, `${total} 个有伤害的 WuwaLAB 动作，按倍率对上 ${matched} 个，其中比的几项（命中帧 ±2、时停、切人、冷却、能量、协奏、优先级）都一致的 ${clean} 个。`, '')
  const text = out.join('\n') + '\n'
  if (opt.md) { writeFileSync(opt.md, text); console.log(`写到 ${opt.md}`) } else console.log(text)
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
