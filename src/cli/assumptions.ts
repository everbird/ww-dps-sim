// src/cli/assumptions.ts —— pnpm assumptions：列出假设登记表（总设计 T16）。--md 打印成 Markdown 表格（贴进文档或 issue 用）
import { ASSUMPTIONS, IMPACT_NAME } from '../engine/assumptions'

import { PROPOSITIONS, type Proposition } from '../engine/propositions'
import { writeGenerated } from './generated-doc'

const md = process.argv.includes('--md')
if (process.argv.includes('--ledger')) {
  const esc = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
  const rows = (PROPOSITIONS as readonly Proposition[]).map(p => `| ${p.id} | ${esc(p.proposition)} | ${p.scope} | ${p.adopted} | ${p.candidates.filter(c => c.id !== p.adopted).map(c => `${c.id}${c.implemented ? '' : '（未实现）'}`).join('、') || '—'} | ${p.candidatesExhaustive ? '是' : '否'} | ${p.conclusion} | ${p.evidence.length} |`)
  const text = ['## 命题表', '', '| ID | 命题 | 范围 | 采用 | 其余候选 | 列全 | 结论 | 证据条数 |', '|---|---|---|---|---|---|---|---:|', ...rows].join('\n')
  if (md) writeGenerated('docs/proposition-ledger.md', text, '# 规则台账\n\n## 读法\n\n采用的候选不是已证实的事实。旧假设依据只迁移为 unspecified 证据，不算独立检验。候选未列全的命题不承诺穷尽所有读法。\n\n生成：`pnpm assumptions --ledger --md`（DD-04 §3）。')
  else console.log(text)
} else if (md) {
  console.log('| 编号 | 方面 | 现在怎么处理 | 依据 | 影响 | 碰到才记 | 怎么改 | 出处 |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const a of ASSUMPTIONS)
    console.log(`| \`${a.id}\` | ${a.topic} | ${a.what} | ${a.why} | ${IMPACT_NAME[a.impact]} | ${a.tracked ? '是' : '否（每次都适用）'} | ${'adjust' in a ? a.adjust.how : '—'} | ${a.ref} |`)
} else {
  console.log(`假设登记表（总设计 T16）：${ASSUMPTIONS.length} 条。影响是估计的：极小 < 0.1%、小 < 1%、中 1–5%、大 > 5%\n`)
  for (const a of ASSUMPTIONS) {
    console.log(`${a.id}  [${a.topic} · 影响${IMPACT_NAME[a.impact]}${a.tracked ? '' : ' · 每次都适用'}]  ${a.ref}`)
    console.log(`  现在：${a.what}`)
    console.log(`  依据：${a.why}`)
    if ('adjust' in a) console.log(`  怎么改：${a.adjust.how}`)
    console.log('')
  }
}
