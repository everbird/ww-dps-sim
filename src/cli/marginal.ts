// src/cli/marginal.ts —— pnpm marginal <场景.yaml> [--char 椿] [--tier avg|max|min]：副词条边际（M5，TD-10 §4）
// 给角色各加一档副词条（加在他最后一件声骸上），各重跑一次，比稳态（或整个窗口）的 DPS。档位来自 echo-stats.json。
// 退出码：0 成功；1 场景有错；2 用法错误。
import type { Slot } from '../data/common'
import { loadGameData } from '../data/load'
import { marginal, type Tier } from '../engine/analysis'
import { ResolveError } from '../engine/resolve'
import { argsOf, fmt, loadScenario, padEnd, padStart, pct2, signed, statValue } from './format'

const TIERS: Record<Tier, string> = { avg: '各档平均', max: '最高档', min: '最低档' }

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--char', '--tier'])
  const tier = (opt.tier ?? 'avg') as Tier
  if (pos.length !== 1 || !(tier in TIERS)) {
    console.error('用法：pnpm marginal <场景.yaml> [--char 角色] [--tier avg|max|min]')
    return 2
  }
  const sc = loadScenario(pos[0]!)
  const slots = sc.team.map((m, i) => [m.char, i as Slot] as const).filter(([c]) => !opt.char || c === opt.char)
  if (slots.length === 0) { console.error(`队伍里没有 ${opt.char}`); return 2 }
  const data = await loadGameData()
  for (const [char, slot] of slots) {
    if (sc.team[slot]!.echoes.length === 0) { console.log(`\n${char}：没装声骸，跳过`); continue }
    let m
    try { m = marginal(sc, data, slot, tier) } catch (e) {
      if (e instanceof ResolveError) { console.error(e.message); return 1 }
      throw e
    }
    console.log(`\n${char} · 副词条各加一档（${TIERS[tier]}，加在最后一件声骸上） · 基准 ${m.base.label} DPS ${fmt(m.base.dps)}`)
    console.log(`  ${padEnd('副词条', 18)}${padStart('一档', 8)}${padStart('DPS', 10)}${padStart('增加', 10)}${padStart('比例', 9)}`)
    for (const r of m.rows)
      console.log(`  ${padEnd(r.stat, 18)}${padStart(`+${statValue(r.stat, r.value)}`, 8)}${padStart(fmt(r.dps), 10)}` +
        `${padStart(signed(r.delta), 10)}${padStart(signed(r.pct, x => pct2(x)), 9)}`)
  }
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
