// src/cli/compare.ts —— pnpm compare <基准.yaml> <对比.yaml>：两套配装（或两条轴）比 DPS，拆开看差在哪（M5，TD-10 §3）
// 口径：有分轮时比稳态（完整的轮），否则比整个窗口；分角色、分动作按窗口内的每秒伤害（加起来就是 DPS），buff 按覆盖率。
// 退出码：0 成功；1 场景有错或运行期报错；2 用法错误。
import { basename } from 'node:path'
import { loadGameData } from '../data/load'
import { tryCompareRuns, runScenario, type Diff, type PanelView } from '../engine/analysis'
import { ResolveError } from '../engine/resolve'
import { argsOf, fmt, loadScenario, padEnd, padStart, pct, pct2, signed, width, withOverrides, OVERRIDE_FLAGS, OVERRIDE_USAGE } from './format'

const TOP = 12

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), OVERRIDE_FLAGS)
  if (pos.length !== 2) {
    console.error(`用法：pnpm compare <基准场景.yaml> <对比场景.yaml> ${OVERRIDE_USAGE}`)
    console.error('  --goal：两边都按这个目标比（缺省各按场景里写的；打死 boss 按血量 ÷ 击杀秒，TD-10 §7）')
    return 2
  }
  const [fa, fb] = pos as [string, string]
  const data = await loadGameData()
  let a, b
  try {
    a = runScenario(withOverrides(loadScenario(fa), opt), data)
    b = runScenario(withOverrides(loadScenario(fb), opt), data)
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  const cr = tryCompareRuns(a, b)
  if (!cr.ok) { console.error(cr.reason); return 1 }
  const c = cr.value
  if (c.scopeMismatch) console.log(`⚠ ${c.scopeMismatch.note}\n`)
  const [na, nb] = basename(fa) !== basename(fb) ? [basename(fa), basename(fb)] : [fa, fb]
  const w = Math.max(width(na), width(nb)) + 2
  const span = (x: { lo: number; hi: number }) => `共 ${((x.hi - x.lo) / 60).toFixed(2)} 秒`
  console.log(`基准  ${padEnd(na, w)}${c.base.label} DPS ${fmt(c.base.dps)}（${span(c.base)}）`)
  console.log(`对比  ${padEnd(nb, w)}${c.other.label} DPS ${fmt(c.other.dps)}（${span(c.other)}）` +
    `   ${signed(c.delta)}（${signed(c.pct, x => pct2(x))}）`)
  if (c.baseOverflow || c.otherOverflow) {
    const parts: string[] = []
    if (c.baseOverflow) parts.push(`基准溢出 ${fmt(c.baseOverflow.overflow)}（未封顶共 ${fmt(c.baseOverflow.rawTotal)}）`)
    if (c.otherOverflow) parts.push(`对比溢出 ${fmt(c.otherOverflow.overflow)}（未封顶共 ${fmt(c.otherOverflow.rawTotal)}）`)
    console.log(`      击杀截断按有效扣血封顶：${parts.join('、')}`)
  }
  // 误差条（docs/engine-quality-plan.md P3）：稳态窗口挪一轮 DPS 就会变这么多，差得比它小的不算"更好"
  const noise = Math.max(c.base.spread, c.other.spread)
  if (noise > 0) console.log(`      稳态窗口挪一轮 DPS 变 ±${pct2(noise)}（基准 ±${pct2(c.base.spread)}、对比 ±${pct2(c.other.spread)}）` +
    (Math.abs(c.pct) < noise ? '：这次的差在误差内，不算更好或更差（多跑几轮再比，options.repeat）' : ''))

  const panelLines = panelDiff(c.panels.base, c.panels.other)
  if (panelLines.length > 0) {
    console.log('\n面板（只列有变化的）')
    for (const l of panelLines) console.log(`  ${l}`)
  }
  table('分角色（每秒伤害）', c.byChar, fmt, 0.5)
  table(`分动作（每秒伤害，差额前 ${TOP}）`, c.byAction.slice(0, TOP), fmt, 0.5)
  printUptimeTable(c.uptime, c.uptimeBy, TOP)
  return 0
}

function parseOwnerKey(k: string): { unionKey: string; owner: string } | null {
  const arrow = k.lastIndexOf('→')
  if (arrow < 0) return null
  const left = k.slice(0, arrow)
  const target = k.slice(arrow + 1)
  const open = left.lastIndexOf(' [')
  if (open < 0 || !left.endsWith(']')) return null
  return { unionKey: `${left.slice(0, open)}→${target}`, owner: left.slice(open + 2, -1) }
}

function printUptimeTable(union: Diff[], byOwner: Diff[], top: number): void {
  const ownersOf = new Map<string, Diff[]>()
  for (const row of byOwner) {
    const p = parseOwnerKey(row.key)
    if (!p) continue
    const list = ownersOf.get(p.unionKey) ?? []
    list.push({ ...row, key: p.owner })
    ownersOf.set(p.unionKey, list)
  }
  const hasOwnerDiff = (k: string) => {
    const list = ownersOf.get(k)
    return list !== undefined && list.length > 1 && list.some(x => Math.abs(x.delta) >= 0.01)
  }
  const shown = union
    .filter(d => Math.abs(d.delta) >= 0.01 || hasOwnerDiff(d.key))
    .slice(0, top)
  if (shown.length === 0) return
  console.log(`\nbuff 覆盖率（差 ≥ 1 个百分点，前 ${top}）`)
  for (const d of shown) {
    console.log(`  ${padEnd(d.key, 26)}${padStart(pct(d.base), 10)} → ${padStart(pct(d.other), 10)}   ${signed(d.delta, x => pct(x))}`)
    const subs = ownersOf.get(d.key)
    if (subs && subs.length > 1) {
      for (const s of subs) {
        console.log(`    ${padEnd(`└ ${s.key}`, 24)}${padStart(pct(s.base), 10)} → ${padStart(pct(s.other), 10)}   ${signed(s.delta, x => pct(x))}`)
      }
    }
  }
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
