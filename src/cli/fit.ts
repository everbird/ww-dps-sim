// src/cli/fit.ts —— pnpm fit 场景.yaml [--n 60] [--near 4] [--top 15]：录像剖析的贴合度（src/engine/fit.ts）。
// 原场景与各变体（假设开关翻过来、轴里读到的动作去掉 / 挪到附近 / 对调）逐个按"和录像差多少"打分排名——不是比 DPS。
// 比原场景更贴合的改法是线索：要回录像里核对（这一下到底按没按、是不是另一种状态），不要直接改场景
import { loadGameData } from '../data/load'
import { fitVariants, FIT_WEIGHTS, type Fit } from '../engine/fit'
import { resolveScenario } from '../engine/resolve'
import { argsOf, loadScenario } from './format'

const fmt = (f: Fit) => [
  `切人 平均差 ${f.switches.mae.toFixed(2)} 秒、最多 ${f.switches.max.toFixed(2)}、类型不对 ${f.switches.typeMiss}`,
  `录像动作 ${f.events.matched}/${f.events.n} 找到、平均差 ${f.events.mae.toFixed(2)} 秒`,
  f.hp ? `血条 均方根差 ${(f.hp.rmse * 100).toFixed(1)}%、最后一点差 ${(f.hp.end * 100).toFixed(1)}%` : '没有血条',
  f.concerto ? `协奏环 均方根差 ${(f.concerto.rmse * 100).toFixed(1)}%、仿真平均${f.concerto.mean >= 0 ? '高' : '低'} ${(Math.abs(f.concerto.mean) * 100).toFixed(1)}%` : '没有协奏环',
  ...(f.core ? [`回路条资源 均方根差 ${(f.core.rmse * 100).toFixed(1)}%、仿真平均${f.core.mean >= 0 ? '高' : '低'} ${(Math.abs(f.core.mean) * 100).toFixed(1)}%`] : []),
].join('；')

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--n', '--near', '--top'])
  if (pos.length !== 1) { console.error('用法：pnpm fit 场景.yaml [--n 60] [--near 4] [--top 15]'); return 2 }
  const sc = loadScenario(pos[0]!)
  const r = resolveScenario(sc, await loadGameData())
  const t = Date.now()
  const x = fitVariants(r, sc, { n: Number(opt.n ?? 60), near: Number(opt.near ?? 4) })
  const ran = x.rows.filter(row => row.fit)
  console.log(`${pos[0]}：贴合度 ${x.base.score.toFixed(2)}（越小越贴合；切人与录像动作的平均差 + 类型不对每次 ${FIT_WEIGHTS.typeMiss} 秒 + 没找到每个 ${FIT_WEIGHTS.unmatched} 秒 + 血条每 1% 记 ${FIT_WEIGHTS.hpPct} 秒 + 协奏环、回路条资源每 1% 各记 ${FIT_WEIGHTS.concertoPct}、${FIT_WEIGHTS.corePct} 秒）`)
  console.log(`  ${fmt(x.base)}`)
  console.log(`变体：轴的改法候选 ${x.candidates} 条（等距取 ${opt.n ?? 60}）+ 假设开关；跑通 ${ran.length}、跑不通 ${x.rows.length - ran.length}；${((Date.now() - t) / 1000).toFixed(1)} 秒\n`)
  const top = Number(opt.top ?? 15)
  const better = ran.filter(row => row.fit!.score < x.base.score - 1e-9)
  console.log(better.length ? `比原场景更贴合的 ${better.length} 条（前 ${Math.min(top, better.length)}）：` : '没有比原场景更贴合的变体。')
  for (const row of better.slice(0, top)) console.log(`  ${row.fit!.score.toFixed(2)}（${(row.fit!.score - x.base.score).toFixed(2)}）${row.desc}\n      ${fmt(row.fit!)}`)
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
