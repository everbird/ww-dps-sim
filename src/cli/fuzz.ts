// src/cli/fuzz.ts —— pnpm fuzz [场景.yaml …] [--n 60]：模糊测试（docs/engine-quality-plan.md P1，src/engine/fuzz.ts）。
// 不写场景就跑 scenarios/ 下全部；有问题时退出码 1。改了引擎跑一次
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadGameData } from '../data/load'
import { fuzzScenario } from '../engine/fuzz'
import { resolveScenario } from '../engine/resolve'
import { FAILURE_LABEL } from '../engine/search'
import { argsOf, loadScenario } from './format'

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--n'])
  const files = pos.length > 0 ? pos : readdirSync('scenarios').filter(f => f.endsWith('.yaml')).sort().map(f => join('scenarios', f))
  const n = Number(opt.n ?? 60)
  const data = await loadGameData()
  let bad = 0
  const t0 = Date.now()
  for (const file of files) {
    const sc = loadScenario(file)
    const t = Date.now()
    const x = fuzzScenario(resolveScenario(sc, data), sc.rotation, sc.opening, n)
    const why = Object.entries(x.rejected).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FAILURE_LABEL[k] ?? k} ${v}`).join('、')
    console.log(`${file}：候选 ${x.variants}，跑 ${x.ran}，跑通 ${x.ok}${why ? `（跑不通：${why}）` : ''}；问题 ${x.problems.length}；${((Date.now() - t) / 1000).toFixed(1)} 秒`)
    for (const p of x.problems.slice(0, 10)) console.log(`  ✗ ${p.where}：${p.what}`)
    if (x.problems.length > 10) console.log(`  …另有 ${x.problems.length - 10} 条`)
    bad += x.problems.length
  }
  console.log(`\n${files.length} 个场景，问题 ${bad} 条，${((Date.now() - t0) / 1000).toFixed(1)} 秒${bad ? '' : '：日志自洽、可重复、属性加了伤害不降'}`)
  return bad ? 1 : 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
