// src/cli/optimize.ts —— pnpm optimize <场景.yaml> --inv <库存.yaml> --char <角色> [--top 5] [--keep 8] [--set <套装>] [--include-team]
// 声骸库存择优（TD-13）：给一个角色从库存里挑 5 件（首位声骸不变、队友与轴不动），列出完整仿真 DPS 最高的几套，
// 最后给出第一套的 echoes 写法，可以直接贴回场景。
// 退出码：0 成功；1 场景 / 库存有错；2 用法错误。
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { Slot, StatKey } from '../data/common'
import { InventorySchema, resolveInventory, type InvPiece } from '../data/inventory.schema'
import { loadGameData } from '../data/load'
import { parseOrThrow } from '../data/validate'
import { panelsOf } from '../engine/analysis'
import { optimize, withEchoes } from '../engine/optimize'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { argsOf, fmt, loadScenario, pct, pct2, signed, statValue } from './format'

const USAGE = '用法：pnpm optimize <场景.yaml> --inv <库存.yaml> --char <角色> [--top 5] [--keep 8] [--set <套装>] [--include-team]'

const stats = (t: Partial<Record<StatKey, number>>) => Object.entries(t).map(([k, v]) => `${k} ${statValue(k as StatKey, v!)}`).join('、')
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000))
const flow = (t: Partial<Record<StatKey, number>>) => `{ ${Object.entries(t).map(([k, v]) => `${k}: ${num(v!)}`).join(', ')} }`

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--inv', '--char', '--top', '--keep', '--set'])
  const file = pos.find(a => !a.startsWith('--'))
  const unknown = pos.filter(a => a.startsWith('--') && a !== '--include-team')
  if (!file || !opt.inv || !opt.char || unknown.length) { console.error(unknown.length ? `不认识的参数：${unknown.join(' ')}\n${USAGE}` : USAGE); return 2 }
  const sc = loadScenario(file)
  const slot = sc.team.findIndex(m => m.char === opt.char)
  if (slot < 0) { console.error(`队伍里没有 ${opt.char}`); return 2 }
  const data = await loadGameData()
  const inv = resolveInventory(parseOrThrow(InventorySchema, parse(readFileSync(opt.inv, 'utf8')), opt.inv), data)
  if (inv.issues.length) { console.error(`${opt.inv}：\n${inv.issues.map(x => `  ${x}`).join('\n')}`); return 1 }
  const t0 = performance.now()
  let out
  try {
    out = optimize(sc, data, inv.pieces, {
      slot: slot as Slot, includeTeam: pos.includes('--include-team'),
      ...(opt.top ? { top: Number(opt.top) } : {}), ...(opt.keep ? { keep: Number(opt.keep) } : {}), ...(opt.set ? { set: opt.set } : {}),
    })
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1)
  const plan = Object.entries(out.plan).map(([s, n]) => `${s} ≥ ${n} 件`).join('、') || '不限'
  console.log(`${out.char} · 从 ${opt.inv} 挑声骸（首位 ${out.main}，套装 ${plan}，可用 ${out.pool} 件）`)
  console.log(`现在  ${out.current.label} DPS ${fmt(out.current.dps)}`)
  console.log(`快速重算 ${fmt(out.evaluated)} 套，完整仿真 ${out.verified} 套（${secs} 秒）`)
  for (const n of out.notes) console.log(`提示：${n}`)
  const showPiece = (p: InvPiece, i: number) => {
    const from = p.owner && p.owner !== out.char ? `（现在在 ${p.owner} 身上）` : ''
    return `  ${i + 1}. ${p.id}  ${p.name} ${p.cost}C ${p.set}${from}\n     主 ${stats(p.main)}；副 ${stats(p.subs) || '无'}`
  }
  out.builds.forEach((b, i) => {
    const r = resolveScenario(withEchoes(sc, slot as Slot, b.pieces), data)
    const pv = panelsOf(r)[slot]!
    console.log(`\n第 ${i + 1} 套  DPS ${fmt(b.dps!)}  ${signed(b.dps! - out.current.dps)}（${signed((b.dps! - out.current.dps) / out.current.dps, pct2)}）` +
      `  估计 ${fmt(b.est)}   攻击 ${fmt(pv.atk)}  暴击 ${pct(pv.critRate)}  暴伤 ${pct(pv.critDamage)}  共鸣效率 ${pct(pv.energyRegen)}`)
    b.pieces.forEach((p, j) => console.log(showPiece(p, j)))
  })
  const best = out.builds[0]
  if (best) {
    console.log(`\n第 1 套写进场景（${out.char} 的 echoes）：`)
    for (const p of best.pieces) console.log(`      - { name: ${p.name}, set: ${p.set}, main: ${flow(p.main)}, subs: ${flow(p.subs)} }   # ${p.id}`)
  } else console.log('\n没有找到满足条件的组合（cost ≤ 12、套装件数、首位声骸）')
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
