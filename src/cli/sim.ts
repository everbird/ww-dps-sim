// src/cli/sim.ts —— pnpm sim <场景.yaml> [--out <文件>] [--sample N [--seed S] [--jitter F]]：跑一个场景，终端打印汇总，
// 写出完整事件日志（总设计第 9 节）；--sample 另按抽样模式跑 N 次，打印 DPS 的分布（总设计 T4，TD-10 §6 ⑤）
// 退出码：0 成功；1 场景有错或运行期报错（日志照样写出，保留到出错为止）；2 用法错误。
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { loadGameData } from '../data/load'
import { panelsOf } from '../engine/analysis'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { sampleRuns } from '../engine/sample'
import { simulate } from '../engine/simulate'
import type { ResolvedScenario, SimResult } from '../engine/types'
import { argsOf, assumptionLines, fmt, loadScenario, padEnd, padStart, pct, sec } from './format'

/** "第 k 条"；启动轴写"启动第 k 条"，循环第 2 轮起加轮次，一行有几个动作时加"第 i 个" */
function cmdLabel(r: ResolvedScenario, c: { line: number; item: number; loop: number }): string {
  const many = (c.loop === 0 ? r.opening : r.commands).some(x => x.line === c.line && x.item > 1)
  const head = c.loop === 0 ? '启动' : c.loop > 1 ? `第 ${c.loop} 轮` : ''
  return `${head}第 ${c.line} 条${many ? `第 ${c.item} 个` : ''}`
}

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--out', '--sample', '--seed', '--jitter'])
  const out = opt.out
  const file = pos[0]
  const runs = opt.sample !== undefined ? Number(opt.sample) : 0
  if (!file || !Number.isInteger(runs) || runs < 0) {
    console.error('用法：pnpm sim <场景.yaml> [--out <日志.json>] [--sample N [--seed S] [--jitter F]]')
    return 2
  }
  const sc = loadScenario(file)
  const data = await loadGameData()
  let r: ResolvedScenario
  try {
    r = resolveScenario(sc, data)
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  const res = simulate(r)
  print(file, r, res)
  const target = resolve(out ?? `out/${basename(file, extname(file))}.json`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify({ scenario: file, data: data.version, summary: res.summary, error: res.error, log: res.log }, null, 1) + '\n')
  console.log(`\n事件日志 → ${target}`)
  if (runs > 0 && !res.error) printSampling(r, runs, Number(opt.seed ?? 1), Number(opt.jitter ?? 0))
  return res.error ? 1 : 0
}

function print(file: string, r: ResolvedScenario, res: SimResult): void {
  const s = res.summary
  console.log(`场景 ${file} · 数据 ${r.data.version}`)
  // 共鸣效率：静态面板 + 常驻的共鸣效率 buff（千古洑流这类写成了 buff，TD-06 §2.1）
  const panels = panelsOf(r)
  r.team.forEach((m, i) => {
    const p = panels[i]!
    console.log(`${i === 0 ? '队伍' : '    '}  ${m.def.name} ${m.chain} 链 · ${m.weapon.def.key} R${m.weapon.rank}` +
      `（攻击 ${p.atk}，暴击 ${pct(p.critRate)}，暴伤 ${pct(p.critDamage)}，共鸣效率 ${pct(p.energyRegen)}）`)
  })
  const e = r.enemy
  console.log(`敌人  ${e.id} · ${e.level} 级 · 防御 ${e.def} · 抗性 ${Object.entries(e.res).map(([k, v]) => `${k} ${pct(v)}`).join(' ')}`)
  console.log(`      偏谐值上限 ${fmt(e.tunabilityMax)} · 白条 ${e.whiteBarTough > 0 ? `${fmt(e.whiteBarTough)}（削韧值）、瘫痪 ${(e.paralysisFrames / 60).toFixed(2)} 秒` : '无'}` +
    ` · 谐度破坏 ${r.options.tuneBreak === 'auto' ? '自动' : r.options.tuneBreak === 'manual' ? '只按轴里写的' : '关闭'}`)
  console.log(`\n窗口 ${sec(s.windowFrames)}  总伤害 ${fmt(s.totalDamage)}  DPS ${fmt(s.dps)}${s.overflowDamage > 0 ? `  窗口外 ${fmt(s.overflowDamage)}` : ''}`)
  const en = s.enemy
  if (en.disharmony + en.breaks > 0)
    console.log(`敌人量表  失谐 ${en.disharmony} 次 · 谐度破坏 ${en.tuneBreaks} 次（${fmt(en.tuneBreakDamage)}，${pct(s.totalDamage > 0 ? en.tuneBreakDamage / s.totalDamage : 0)}）· 破盾 ${en.breaks} 次`)
  if (s.perLoop) {
    const st = s.steady
    console.log(`\n分轮${st ? `（稳态 = 第 ${st.from}${st.to > st.from ? `–${st.to}` : ''} 轮：DPS ${fmt(st.dps)}）` : ''}`)
    const names = r.team.map(m => m.def.name).join(' / ')
    const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`
    console.log(`  轮  ${padStart('时长', 10)}${padStart('伤害', 12)}${padStart('DPS', 10)}   能量首尾差（${names}）   协奏首尾差`)
    for (const p of s.perLoop)
      console.log(`  ${padEnd(p.loop === 0 ? '启动' : String(p.loop), 4)}${padStart(`${(p.frames / 60).toFixed(2)} 秒`, 10)}${padStart(fmt(p.damage), 12)}${padStart(fmt(p.dps), 10)}` +
        `   ${p.energyDelta.map(signed).join(' / ')}   ${p.concertoDelta.map(signed).join(' / ')}`)
  }
  console.log('\n分角色')
  for (const [name, c] of Object.entries(s.byChar))
    if (c.damage > 0) console.log(`  ${padEnd(name, 20)}${padStart(fmt(c.damage), 12)}  ${padStart(pct(c.share), 6)}`)
  console.log('\n分动作')
  for (const a of s.byAction)
    console.log(`  ${padEnd(`${a.char} ${a.action}`, 20)}${padStart(fmt(a.damage), 12)}  ${padStart(pct(a.share), 6)}  ${a.hits} 段`)
  if (s.waits.length > 0) {
    console.log('\n等待（不是写轴要求的）')
    for (const w of s.waits) console.log(`  ${cmdLabel(r, w)}  ${w.frames} 帧  ${w.reason}`)
  }
  if (s.skipped.length > 0) {
    console.log('\n跳过的指令（可选 "?" 条件不满足、补位 "~" 不需要）')
    for (const k of s.skipped) console.log(`  ${cmdLabel(r, k)}  ${k.reason}`)
  }
  if (s.warnings.length > 0) {
    console.log('\n提示')
    for (const w of s.warnings) console.log(`  - ${w.message}`)
  }
  console.log('\n这次碰到的假设（总设计 T16；影响是估计的）')
  for (const l of assumptionLines(s)) console.log(l)
  if (res.error) console.log(`\n报错（第 ${res.error.frame} 帧）：${res.error.message}`)
}

/** 抽样 N 次（总设计 T4）：逐段抽暴击，jitter > 0 时每个决策点另加 [0, jitter] 帧的操作抖动 */
function printSampling(r: ResolvedScenario, runs: number, seed: number, jitter: number): void {
  const t0 = Date.now()
  const x = sampleRuns(r, { runs, seed, jitter })
  const what = jitter > 0 ? `逐段抽暴击，操作抖动 0–${jitter} 帧` : '逐段抽暴击'
  console.log(`\n抽样 ${runs} 次（${what}；种子 ${seed}；${((Date.now() - t0) / 1000).toFixed(1)} 秒）· 口径：${x.label}，期望值 DPS ${fmt(x.expected)}`)
  if (x.stats) {
    const s = x.stats
    const d = s.mean / x.expected - 1
    console.log(`  平均 ${fmt(s.mean)}（比期望值 ${d >= 0 ? '+' : '−'}${(Math.abs(d) * 100).toFixed(2)}%），标准差 ${fmt(s.sd)}（${pct(s.sd / s.mean)}）`)
    console.log(`  最低 ${fmt(s.min)} · 5% ${fmt(s.p5)} · 中位 ${fmt(s.p50)} · 95% ${fmt(s.p95)} · 最高 ${fmt(s.max)}`)
  }
  if (x.failed > 0) console.log(`  跑不通 ${x.failed} 次：${x.errors.join('；')}`)
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
