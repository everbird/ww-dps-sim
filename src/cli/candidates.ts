// DD-04 §5：候选报告；纯库不读盘，身份由 CLI 采集。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadGameData } from '../data/load'
import { runCandidateReport } from '../engine/candidates'
import { canonicalJson } from '../engine/digest'
import { candidateMarkdown } from '../report/candidates'
import { argsOf, loadScenario } from './format'
import { collectRunEnvironment } from './run-env'
import { writeGenerated } from './generated-doc'
async function main() {
  const { pos, opt } = argsOf(process.argv.slice(2).filter(a => a !== '--pairs'), ['--md', '--json'])
  if (pos.length !== 1) throw new Error('用法：pnpm candidates <场景.yaml> [--pairs] [--json 文件] [--md 文件]')
  const report = runCandidateReport(loadScenario(pos[0]!), await loadGameData(), { pairs: process.argv.includes('--pairs'), overrides: { environment: collectRunEnvironment(), ...(opt.strict !== undefined ? { strict: opt.strict === 'true' } : {}) } })
  const text = candidateMarkdown(report, `pnpm candidates ${process.argv.slice(2).join(' ')}`)
  if (opt.json) {
    mkdirSync(dirname(opt.json), { recursive: true })
    // DD-07 wire 的规范化规则沿用 digest（Infinity → "inf"，NaN 拒绝）。
    writeFileSync(opt.json, JSON.stringify(JSON.parse(canonicalJson(report)), null, 2) + '\n')
  }
  if (opt.md) writeGenerated(opt.md, text, '# 候选检查结论\n\n## 读法\n\n只在列明的输入、实现与候选集合内成立；不是游戏机制已证实。')
  else console.log(text)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
