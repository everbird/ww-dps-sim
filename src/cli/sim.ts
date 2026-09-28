// src/cli/sim.ts —— pnpm sim <场景.yaml> [--out <文件>]：跑一个场景，终端打印汇总，写出完整事件日志（总设计第 9 节）
// 退出码：0 成功；1 场景有错或运行期报错（日志照样写出，保留到出错为止）；2 用法错误。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { parse } from 'yaml'
import { loadGameData } from '../data/load'
import { ScenarioSchema } from '../data/scenario.schema'
import { parseOrThrow } from '../data/validate'
import { composeStat } from '../engine/formula'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { simulate } from '../engine/simulate'
import type { ResolvedScenario, SimResult } from '../engine/types'

const fmt = (x: number) => Math.round(x).toLocaleString('en-US')
/** 终端显示宽度：中日韩字符与全角符号占两列 */
const width = (t: string) => [...t].reduce((w, ch) => w + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0)
const padEnd = (t: string, n: number) => t + ' '.repeat(Math.max(0, n - width(t)))
const padStart = (t: string, n: number) => ' '.repeat(Math.max(0, n - width(t))) + t
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const sec = (frames: number) => `${(frames / 60).toFixed(2)} 秒（${frames} 帧）`

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter(a => a !== '--')
  const oi = args.indexOf('--out')
  const out = oi >= 0 ? args[oi + 1] : undefined
  const file = args.find((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1))
  if (!file) {
    console.error('用法：pnpm sim <场景.yaml> [--out <日志.json>]')
    return 2
  }
  const sc = parseOrThrow(ScenarioSchema, parse(readFileSync(file, 'utf8')), file)
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
  return res.error ? 1 : 0
}

function print(file: string, r: ResolvedScenario, res: SimResult): void {
  const s = res.summary
  console.log(`场景 ${file} · 数据 ${r.data.version}`)
  r.team.forEach((m, i) => {
    const p = m.panel
    console.log(`${i === 0 ? '队伍' : '    '}  ${m.def.name} ${m.chain} 链 · ${m.weapon.def.key} R${m.weapon.rank}` +
      `（攻击 ${composeStat(p.atk, 0, 0)}，暴击 ${pct(p.critRate)}，暴伤 ${pct(p.critDamage)}，共鸣效率 ${pct(p.energyRegen)}）`)
  })
  const e = r.enemy
  console.log(`敌人  ${e.id} · ${e.level} 级 · 防御 ${e.def} · 抗性 ${Object.entries(e.res).map(([k, v]) => `${k} ${pct(v)}`).join(' ')}`)
  console.log(`\n窗口 ${sec(s.windowFrames)}  总伤害 ${fmt(s.totalDamage)}  DPS ${fmt(s.dps)}${s.overflowDamage > 0 ? `  窗口外 ${fmt(s.overflowDamage)}` : ''}`)
  console.log('\n分角色')
  for (const [name, c] of Object.entries(s.byChar))
    if (c.damage > 0) console.log(`  ${padEnd(name, 20)}${padStart(fmt(c.damage), 12)}  ${padStart(pct(c.share), 6)}`)
  console.log('\n分动作')
  for (const a of s.byAction)
    console.log(`  ${padEnd(`${a.char} ${a.action}`, 20)}${padStart(fmt(a.damage), 12)}  ${padStart(pct(a.share), 6)}  ${a.hits} 段`)
  if (s.waits.length > 0) {
    console.log('\n等待（不是写轴要求的）')
    const many = new Set(r.commands.filter(c => c.item > 1).map(c => c.line))
    for (const w of s.waits)
      console.log(`  ${w.loop > 1 ? `第 ${w.loop} 轮` : ''}第 ${w.line} 条${many.has(w.line) ? `第 ${w.item} 个` : ''}  ${w.frames} 帧  ${w.reason}`)
  }
  if (s.warnings.length > 0) {
    console.log('\n提示')
    for (const w of s.warnings) console.log(`  - ${w.message}`)
  }
  if (res.error) console.log(`\n报错（第 ${res.error.frame} 帧）：${res.error.message}`)
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
