// src/cli/matrix.ts —— pnpm matrix <场景.yaml …> [--stage 矩8] [--md 输出.md]：矩阵计分（src/engine/matrix.ts、docs/matrix.md）。
// 几支队（角色不能重复）按每种出场顺序接力打这一期的 boss，每队 120 秒，按伤害折分；列总分、每队打到哪、每只 boss 的分
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { loadGameData } from '../data/load'
import { MATRIX_RULES, matrixOrders, ratioOf, matrixBosses } from '../engine/matrix'
import { assumptionOf } from '../engine/assumptions'
import { argsOf, fmt, loadScenario } from './format'

const wan = (x: number) => `${(x / 1e4).toFixed(0)} 万`

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--stage', '--md'])
  if (pos.length === 0) {
    console.error('用法：pnpm matrix <场景.yaml …> [--stage 矩8] [--md 输出.md]')
    console.error('  几支队按每种出场顺序接力打这一期矩阵（敌人表的"矩8R1/"…），每队 120 秒，按伤害折分（docs/matrix.md）')
    return 2
  }
  const stage = opt.stage ?? '矩8'
  const data = await loadGameData()
  const teams = pos.map(f => ({ name: basename(f, '.yaml'), sc: loadScenario(f) }))
  const seen = new Map<string, string>()
  for (const t of teams) for (const m of t.sc.team) {
    if (seen.has(m.char)) throw new Error(`${m.char} 同时在 ${seen.get(m.char)} 和 ${t.name} 里：矩阵里一个角色只能出场一次（生存位两次，这里不分）`)
    seen.set(m.char, t.name)
  }
  const t0 = Date.now()
  const results = matrixOrders(teams, data, stage)
  const r = MATRIX_RULES
  const out: string[] = ['# 矩阵计分', '',
    `${stage}，${teams.length} 支队；每队 ${r.teamFrames / 60} 秒（进场 ${r.entryFrames / 60} 秒、转场 ${r.transFrames / 60} 秒），` +
    `每万点伤害得分 R1 ${r.ratios[0]} / R2 ${r.ratios[1]} / R3 起 ${r.ratios[2]}，第 5 只 ${r.lastRatios.join(' / ')}，打死第 5 只加 ${r.killBonus}。`, '']
  out.push('| 出场顺序 | 总分 | 比最好 | 总伤害 | 打到 |', '|---|---:|---:|---:|---|')
  const best = results[0]!
  for (const x of results) out.push(`| ${x.order.join(' → ')} | ${fmt(x.score)} | ${x === best ? '最好' : `−${((1 - x.score / best.score) * 100).toFixed(1)}%`} | ${wan(x.damage)} | ${x.end} |`)
  out.push('', `## 最好的顺序：${best.order.join(' → ')}`, '', '| 队 | boss | 血量 / 抗性高的 | 从（秒） | 到（秒） | 伤害 | 打死 | 分 |', '|---|---|---|---:|---:|---:|---|---:|')
  const bosses = matrixBosses(data, stage)
  for (const t of best.teams) for (const s of t.segments) {
    const b = bosses.find(x => x.label === s.label)!
    const hi = Object.entries(b.preset.res).filter(([, v]) => v > 0.2).map(([k, v]) => `${k} ${v * 100}%`).join('、') || '全 20%'
    out.push(`| ${t.name} | ${s.label} ${b.preset.name}（×${ratioOf(b)}） | ${wan(b.hp)} / ${hi} | ${((s.from + r.entryFrames) / 60).toFixed(1)} | ${((s.to + r.entryFrames) / 60).toFixed(1)} | ${wan(s.damage)} | ${s.killed ? '是' : '—'} | ${fmt(s.score)} |`)
  }
  out.push('')
  for (const t of best.teams) out.push(`- ${t.name}：${fmt(t.score)} 分，${wan(t.damage)}（转场与溢出作废 ${wan(t.lostDamage)}）`)
  out.push('', '时间是这一队的计时（含进场），按战斗秒（大招时停也停）。', '', '碰到的假设：',
    ...best.assumptions.map(id => `- ${id}：${assumptionOf(id)!.what}`),
    '', `${((Date.now() - t0) / 1000).toFixed(0)} 秒。`)
  const text = out.join('\n') + '\n'
  if (opt.md) { writeFileSync(opt.md, text); console.log(`写到 ${opt.md}`) } else console.log(text)
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
