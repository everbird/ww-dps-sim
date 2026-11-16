// src/cli/conformance.ts —— pnpm conformance [场景.yaml …] [--no-zero-interference]：写出一致性样例（总设计 §10.1 第 8 条、§11 第 7 条）。
// 每个场景两份 JSON：<名>.input.json = 去掉钩子表的装配结果（纯数据），<名>.output.json = 事件日志、汇总与报错，
// 以及运行身份、完成状态与必有记录（DD-01 §4 T01-9：runPrepared 是换实现时要对拍的入口）。
// 换实现（Rust）时：读 input、按角色名接上自己的钩子、仿真，与 output 逐条比。不写场景就跑 scenarios/ 下全部。
// 零干扰对拍（DD-05 §6.3，缺省开）：每个场景另带全部诊断再跑一次，比较结果（去掉 diag）、终态与事件队列游标，
// 不一致就打印第一个不同的路径并以退出码 1 结束。诊断本身不写进样例文件。--no-zero-interference 关掉（只写样例）。
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { loadGameData } from '../data/load'
import { portable } from '../engine/portable'
import { prepareRun, runForInspection } from '../engine/run'
import { zeroInterference } from '../engine/zero-interference'
import { loadScenario } from './format'

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter(a => a !== '--')
  const flags = args.filter(a => a.startsWith('--'))
  const unknown = flags.filter(a => a !== '--zero-interference' && a !== '--no-zero-interference')
  if (unknown.length) { console.error(`不认识的参数：${unknown.join(' ')}\n用法：pnpm conformance [场景.yaml …] [--no-zero-interference]`); return 2 }
  const zero = !flags.includes('--no-zero-interference')
  const named = args.filter(a => !a.startsWith('--'))
  const files = named.length > 0 ? named : readdirSync('scenarios').filter(f => f.endsWith('.yaml')).sort().map(f => join('scenarios', f))
  const data = await loadGameData()
  const dir = 'out/conformance'
  mkdirSync(dir, { recursive: true })
  const interfered: string[] = []
  for (const file of files) {
    // 不传 environment：提交号、内容指纹随环境变，样例里不要（身份里其余的照写）
    const p = prepareRun(loadScenario(file), data)
    if (!p.ok) throw new Error(`${file}：场景有 ${p.issues.length} 处错误：\n${p.issues.map(i => `  - ${i.message}`).join('\n')}`)
    const r = p.run.resolved
    // 诊断全关的这一次就是样例（与 runPrepared 相同）；零干扰对拍拿它当关着的那一侧，不再多跑
    const off = runForInspection(p.run)
    const res = off.result!
    const { gitCommit: _gitCommit, contentFingerprint: _contentFingerprint, ...execution } = res.identity.execution
    const name = basename(file, extname(file))
    const input = JSON.stringify(portable(r))
    // 原有的三个键在前、顺序不变；后面是 DD-01 加的（各键在后续工作包里才有内容的，现在是空值或初值）
    const output = JSON.stringify({
      log: res.log, summary: res.summary, error: res.error ?? null,
      runId: res.runId, identity: { data: res.identity.data, execution }, completion: res.completion, interventions: res.interventions,
      strictReport: res.strictReport, damageScope: res.damageScope, ruleUsage: res.ruleUsage,
    })
    writeFileSync(join(dir, `${name}.input.json`), input + '\n')
    writeFileSync(join(dir, `${name}.output.json`), output + '\n')
    const diff = zero ? zeroInterference(p.run, { off }) : null
    if (diff) interfered.push(`${file}：${diff}`)
    const z = !zero ? '' : diff ? '，零干扰对拍不一致' : '，零干扰 ✓'
    console.log(`${file}  → ${dir}/${name}.{input,output}.json（${(input.length / 1e6).toFixed(1)} MB / ${(output.length / 1e6).toFixed(1)} MB，事件 ${res.log.length} 条${z}）`)
  }
  console.log(`\n数据 ${data.version}；钩子表里有：${Object.keys(data.hooks).join('、')}（换实现时按角色名接上自己的）`)
  if (zero) console.log(interfered.length ? `\n零干扰对拍：${interfered.length} 个场景不一致（DD-05 §6）\n${interfered.map(x => `  - ${x}`).join('\n')}` : `零干扰对拍：${files.length} 个场景都一致（诊断全关与全开的结果、终态、事件队列游标相同）`)
  return interfered.length ? 1 : 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
