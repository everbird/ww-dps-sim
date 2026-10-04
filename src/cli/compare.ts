// src/cli/compare.ts —— pnpm compare <基准.yaml> <对比.yaml>：两套配装（或两条轴）比 DPS，拆开看差在哪（M5，AGENTS.md 差异 4）
// 口径：有分轮时比稳态（完整的轮），否则比整个窗口；分角色、分动作按窗口内的每秒伤害（加起来就是 DPS），buff 按覆盖率。
// 退出码：0 成功；1 场景有错或运行期报错；2 用法错误。
import { basename } from 'node:path'
import { loadGameData } from '../data/load'
import { compareRuns, runScenario, type Diff, type PanelView } from '../engine/analysis'
import { ResolveError } from '../engine/resolve'
import { argsOf, fmt, loadScenario, padEnd, padStart, pct, pct2, signed, width } from './format'

const TOP = 12

async function main(): Promise<number> {
  const { pos } = argsOf(process.argv.slice(2), [])
  if (pos.length !== 2) {
    console.error('用法：pnpm compare <基准场景.yaml> <对比场景.yaml>')
    return 2
  }
  const [fa, fb] = pos as [string, string]
  const data = await loadGameData()
  let a, b
  try {
    a = runScenario(loadScenario(fa), data)
    b = runScenario(loadScenario(fb), data)
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  for (const [f, x] of [[fa, a], [fb, b]] as const)
    if (x.res.error) { console.error(`${f} 运行出错（第 ${x.res.error.frame} 帧）：${x.res.error.message}`); return 1 }
  const c = compareRuns(a, b)
  const [na, nb] = basename(fa) !== basename(fb) ? [basename(fa), basename(fb)] : [fa, fb]
  const w = Math.max(width(na), width(nb)) + 2
  const span = (x: { lo: number; hi: number }) => `共 ${((x.hi - x.lo) / 60).toFixed(2)} 秒`
  console.log(`基准  ${padEnd(na, w)}${c.base.label} DPS ${fmt(c.base.dps)}（${span(c.base)}）`)
  console.log(`对比  ${padEnd(nb, w)}${c.other.label} DPS ${fmt(c.other.dps)}（${span(c.other)}）` +
    `   ${signed(c.delta)}（${signed(c.pct, x => pct2(x))}）`)

  const panelLines = panelDiff(c.panels.base, c.panels.other)
  if (panelLines.length > 0) {
    console.log('\n面板（只列有变化的）')
    for (const l of panelLines) console.log(`  ${l}`)
  }
  table('分角色（每秒伤害）', c.byChar, fmt, 0.5)
  table(`分动作（每秒伤害，差额前 ${TOP}）`, c.byAction.slice(0, TOP), fmt, 0.5)
  table(`buff 覆盖率（差 ≥ 1 个百分点，前 ${TOP}）`, c.uptime.filter(d => Math.abs(d.delta) >= 0.01).slice(0, TOP), pct, 0)
  return 0
}

function table(title: string, rows: Diff[], f: (x: number) => string, eps: number): void {
  const shown = rows.filter(d => Math.abs(d.delta) > eps)
  if (shown.length === 0) return
  console.log(`\n${title}`)
  for (const d of shown)
    console.log(`  ${padEnd(d.key, 26)}${padStart(f(d.base), 10)} → ${padStart(f(d.other), 10)}   ${signed(d.delta, x => f(x))}`)
}

function panelDiff(a: PanelView[], b: PanelView[]): string[] {
  const out: string[] = []
  a.forEach((p, i) => {
    const q = b[i]!
    const parts: string[] = []
    if (p.name !== q.name) parts.push(`换成 ${q.name}`)
    if (p.atk !== q.atk) parts.push(`攻击 ${p.atk} → ${q.atk}`)
    for (const [k, label] of [['critRate', '暴击'], ['critDamage', '暴伤'], ['energyRegen', '共鸣效率']] as const)
      if (Math.abs(p[k] - q[k]) > 1e-9) parts.push(`${label} ${pct(p[k])} → ${pct(q[k])}`)
    if (parts.length > 0) out.push(`${padEnd(p.name, 8)}${parts.join('   ')}`)
  })
  return out
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
