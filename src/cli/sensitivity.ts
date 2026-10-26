// src/cli/sensitivity.ts —— pnpm sensitivity [场景.yaml …] [--md 输出.md]：假设敏感度矩阵（docs/engine-quality-plan.md P2，src/engine/sensitivity.ts）。
// 不写场景就跑 scenarios/ 下全部。第一张表：每个场景在每个开关翻过来后 DPS 变多少；第二张：对照场景比基准好多少，翻了哪条假设结论会变
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadGameData } from '../data/load'
import { resolveScenario } from '../engine/resolve'
import { sensitivityMatrix, type Cell } from '../engine/sensitivity'
import { argsOf, loadScenario, withOverrides, OVERRIDE_FLAGS } from './format'

const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${(Math.abs(x) * 100).toFixed(2)}%`
/** 对照的收益翻过来后算"结论变了"：正负号变了，或差了 1 个百分点以上，或有一边跑不通 */
const CHANGED = 0.01

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--md', ...OVERRIDE_FLAGS])
  // 不写场景时跑 scenarios/ 下全部，录像剖析（purpose: replay）除外：一局实战的切人时机照录像钉死，翻假设没有意义
  const all = pos.length > 0 ? pos : readdirSync('scenarios').filter(f => f.endsWith('.yaml')).sort().map(f => join('scenarios', f))
  const loaded = all.map(f => ({ f, sc: loadScenario(f) }))
  const skipped = pos.length > 0 ? [] : loaded.filter(x => x.sc.purpose === 'replay').map(x => basename(x.f, '.yaml'))
  const files = loaded.filter(x => !skipped.includes(basename(x.f, '.yaml')))
  const data = await loadGameData()
  const t0 = Date.now()
  const scen = files.map(({ f, sc }) => ({ name: basename(f, '.yaml'), r: resolveScenario(withOverrides(sc, opt), data) }))
  const m = sensitivityMatrix(scen, row => console.error(`  ${row.name}：${((Date.now() - t0) / 1000).toFixed(0)} 秒`))
  const out: string[] = []
  out.push('# 假设敏感度矩阵', '', `${files.length} 个场景 × ${m.flips.length} 个开关，${((Date.now() - t0) / 1000).toFixed(0)} 秒；比较口径同轴搜索（有分轮取稳态，否则整个窗口）。`, '')
  if (skipped.length) out.push(`没跑的录像剖析场景（purpose: replay）：${skipped.join('、')}。`, '')
  out.push('开关：', ...m.flips.map((f, i) => `- **F${i + 1}** ${f.label}`), '')
  out.push('## 各场景翻一条假设后 DPS 变多少', '')
  const vs = (c: Cell, b: Cell) => (c.error ? `跑不通（${c.error}）` : b.dps && c.dps !== null ? (Math.abs(c.dps / b.dps - 1) < 5e-5 ? '·' : pct(c.dps / b.dps - 1)) : '—')
  out.push(`| 场景 | DPS | ${m.flips.map((_, i) => `F${i + 1}`).join(' | ')} |`, `|---|---:|${m.flips.map(() => '---:').join('|')}|`)
  for (const r of m.rows) out.push(`| ${r.name} | ${r.base.dps !== null ? Math.round(r.base.dps).toLocaleString('en-US') : `跑不通（${r.base.error}）`} | ${r.flips.map(c => vs(c, r.base)).join(' | ')} |`)
  out.push('', '"·" = 不变（这个场景碰不到这条假设）。', '')
  out.push('## 对照场景比基准好多少：翻了哪条假设会变', '')
  out.push(`结论"变了"：正负号变了、差 ${CHANGED * 100} 个百分点以上，或有一边跑不通（**粗体**）。`, '')
  out.push(`| 对照 | 基准 | 缺省 | ${m.flips.map((_, i) => `F${i + 1}`).join(' | ')} |`, `|---|---|---:|${m.flips.map(() => '---:').join('|')}|`)
  const hits = new Map<number, number>()
  for (const p of m.pairs) {
    const cells = p.flips.map((g, i) => {
      if (g === null || p.gain === null) { if (p.gain !== null) hits.set(i, (hits.get(i) ?? 0) + 1); return g === null ? '**跑不通**' : pct(g) }
      if (Math.abs(g - p.gain) < 5e-5) return '·'
      const changed = Math.sign(g) !== Math.sign(p.gain) || Math.abs(g - p.gain) >= CHANGED
      if (changed) hits.set(i, (hits.get(i) ?? 0) + 1)
      return changed ? `**${pct(g)}**` : pct(g)
    })
    out.push(`| ${p.name.replace(`${p.base}-`, '…-')} | ${p.base} | ${p.gain !== null ? pct(p.gain) : '跑不通'} | ${cells.join(' | ')} |`)
  }
  out.push('', '"·" = 和缺省一样。', '')
  out.push('## 按"让几个对照的结论变了"排', '')
  for (const [i, n] of [...hits.entries()].sort((a, b) => b[1] - a[1])) out.push(`- F${i + 1} ${m.flips[i]!.label}：${n} 个`)
  if (hits.size === 0) out.push('- 没有')
  const text = out.join('\n') + '\n'
  if (opt.md) {
    // 手写的"读法"各节（从第一个"## 读法"起）原样留在末尾
    const old = existsSync(opt.md) ? readFileSync(opt.md, 'utf8') : ''
    const k = old.indexOf('\n## 读法')
    writeFileSync(opt.md, k >= 0 ? `${text}${old.slice(k)}` : text)
    console.log(`写到 ${opt.md}${k >= 0 ? '（保留了手写的读法）' : ''}`)
  } else console.log(text)
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
