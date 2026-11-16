// src/cli/fuzz.ts —— pnpm fuzz [场景.yaml …] [--n 60] [--ledger]：模糊测试（docs/engine-quality-plan.md P1，src/engine/fuzz.ts）。
// 不写场景就跑 scenarios/ 下全部；有问题时退出码 1。改了引擎跑一次。
// --ledger：每条变体轴带资源账本跑，另查终态闭合、相邻条目不变式、账本与日志的交叉检查（DD-06 §3.6、T06-4）
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadGameData } from '../data/load'
import { fuzzScenario } from '../engine/fuzz'
import { resolveScenario } from '../engine/resolve'
import { FAILURE_LABEL } from '../engine/search'
import { argsOf, loadScenario } from './format'

async function main(): Promise<number> {
  const { pos: args, opt } = argsOf(process.argv.slice(2), ['--n'])
  const unknown = args.filter(a => a.startsWith('--') && a !== '--ledger')
  if (unknown.length) { console.error(`不认识的参数：${unknown.join(' ')}\n用法：pnpm fuzz [场景.yaml …] [--n 60] [--ledger]`); return 2 }
  const ledger = args.includes('--ledger')
  const pos = args.filter(a => !a.startsWith('--'))
  const files = pos.length > 0 ? pos : readdirSync('scenarios').filter(f => f.endsWith('.yaml')).sort().map(f => join('scenarios', f))
  const n = Number(opt.n ?? 60)
  const data = await loadGameData()
  let bad = 0, engineErr = 0
  const t0 = Date.now()
  for (const file of files) {
    const sc = loadScenario(file)
    const t = Date.now()
    const x = fuzzScenario(resolveScenario(sc, data), sc.rotation, sc.opening, n, { ledger })
    const why = Object.entries(x.rejected).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FAILURE_LABEL[k] ?? k} ${v}`).join('、')
    const errPart = x.engineErrors ? `；引擎错误 ${x.engineErrors}` : ''
    console.log(`${file}：候选 ${x.variants}，跑 ${x.ran}，跑通 ${x.ok}${why ? `（跑不通：${why}）` : ''}；问题 ${x.problems.length}${errPart}；${((Date.now() - t) / 1000).toFixed(1)} 秒`)
    for (const p of x.problems.slice(0, 10)) console.log(`  ✗ ${p.where}：${p.what}`)
    if (x.problems.length > 10) console.log(`  …另有 ${x.problems.length - 10} 条`)
    bad += x.problems.length
    engineErr += x.engineErrors
  }
  const okText = `：日志自洽、可重复、属性加了伤害不降${ledger ? '；资源账本终态闭合、相邻条目接得上、与日志对得上' : ''}`
  console.log(`\n${files.length} 个场景${ledger ? '（带资源账本）' : ''}，问题 ${bad} 条${engineErr ? `（引擎错误 ${engineErr}）` : ''}，${((Date.now() - t0) / 1000).toFixed(1)} 秒${bad || engineErr ? '' : okText}`)
  return bad || engineErr ? 1 : 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
