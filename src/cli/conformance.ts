// DD-10 §6 / T10-8；总设计 §10.1：完整输入输出、MANIFEST、合成边界与跨实现对拍。
import { readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadGameData } from '../data/load'
import { prepareRun, runForInspection } from '../engine/run'
import { zeroInterference } from '../analysis/zero-interference'
import { loadScenario } from './format'
import { BOUNDARY_CASES, boundaryRun } from './conformance-cases'
import { readManifest, verifyConformance, writeConformance, type CaseSource, type ConformanceCase } from './conformance-artifacts'

const usage = '用法：pnpm conformance [场景.yaml …] [--boundaries-only] [--out 目录] [--verify 目录] [--no-zero-interference]'
export async function conformanceMain(args = process.argv.slice(2).filter(a => a !== '--')): Promise<number> {
  const files: string[] = []
  let dir = 'out/conformance', verify: string | undefined, only = false, zero = true
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--out' || arg === '--verify') {
      const value = args[++i]
      if (!value || value.startsWith('--')) { console.error(`${arg} 缺目录\n${usage}`); return 2 }
      if (arg === '--out') dir = value
      else verify = value
    } else if (arg === '--boundaries-only') only = true
    else if (arg === '--no-zero-interference') zero = false
    else if (arg === '--zero-interference') zero = true
    else if (arg.startsWith('--')) { console.error(`不认识的参数：${arg}\n${usage}`); return 2 }
    else files.push(arg)
  }
  if (only && files.length) { console.error(`--boundaries-only 不能同时指定场景\n${usage}`); return 2 }
  const sources: { name: string; source: CaseSource }[] = verify
    ? [...readManifest(verify).cases]
    : [
      ...(only ? [] : (files.length ? files : readdirSync('scenarios').filter(f => f.endsWith('.yaml')).sort().map(f => join('scenarios', f)))
        .map(file => ({ name: basename(file, extname(file)), source: { scenario: file } }))),
      ...BOUNDARY_CASES.map(boundary => ({ name: `boundary-${boundary}`, source: { boundary } })),
    ]
  const data = sources.some(c => 'scenario' in c.source) ? await loadGameData() : null
  const cases: ConformanceCase[] = []
  const interfered: string[] = []
  for (const c of sources) {
    const source = c.source
    let run
    if ('boundary' in source) run = boundaryRun(source.boundary)
    else {
      const p = prepareRun(loadScenario(source.scenario), data!)
      if (!p.ok) throw new Error(`${source.scenario}：${p.issues.map(i => i.message).join('；')}`)
      run = p.run
    }
    const off = runForInspection(run)
    cases.push({ ...c, run, result: off.result! })
    const diff = zero ? zeroInterference(run, { off }) : null
    if (diff) interfered.push(`${c.name}：${diff}`)
  }
  if (verify) {
    const diff = verifyConformance(verify, cases)
    if (diff) { console.error(`对拍不一致：${diff}`); return 1 }
    console.log(`对拍 ✓：${cases.length} 个样例（${verify}）`)
  } else {
    writeConformance(dir, cases)
    console.log(`已写入 ${cases.length} 个样例的完整输入输出与 MANIFEST.json：${dir}`)
  }
  if (zero) console.log(interfered.length ? `零干扰不一致：\n${interfered.join('\n')}` : `零干扰 ✓：${cases.length} 个样例`)
  return interfered.length ? 1 : 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  conformanceMain().then(code => { process.exitCode = code }, e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
}
