// src/cli/conformance.ts —— pnpm conformance [场景.yaml …]：写出一致性样例（总设计 §10.1 第 8 条、§11 第 7 条）。
// 每个场景两份 JSON：<名>.input.json = 去掉钩子表的装配结果（纯数据），<名>.output.json = 事件日志、汇总与报错。
// 换实现（Rust）时：读 input、按角色名接上自己的钩子、仿真，与 output 逐条比。不写场景就跑 scenarios/ 下全部。
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { loadGameData } from '../data/load'
import { portable } from '../engine/portable'
import { resolveScenario } from '../engine/resolve'
import { simulate } from '../engine/simulate'
import { loadScenario } from './format'

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter(a => a !== '--')
  const files = args.length > 0 ? args : readdirSync('scenarios').filter(f => f.endsWith('.yaml')).sort().map(f => join('scenarios', f))
  const data = await loadGameData()
  const dir = 'out/conformance'
  mkdirSync(dir, { recursive: true })
  for (const file of files) {
    const r = resolveScenario(loadScenario(file), data)
    const res = simulate(r)
    const name = basename(file, extname(file))
    const input = JSON.stringify(portable(r))
    const output = JSON.stringify({ log: res.log, summary: res.summary, error: res.error ?? null })
    writeFileSync(join(dir, `${name}.input.json`), input + '\n')
    writeFileSync(join(dir, `${name}.output.json`), output + '\n')
    console.log(`${file}  → ${dir}/${name}.{input,output}.json（${(input.length / 1e6).toFixed(1)} MB / ${(output.length / 1e6).toFixed(1)} MB，事件 ${res.log.length} 条）`)
  }
  console.log(`\n数据 ${data.version}；钩子表里有：${Object.keys(data.hooks).join('、')}（换实现时按角色名接上自己的）`)
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
