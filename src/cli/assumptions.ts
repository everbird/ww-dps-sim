// src/cli/assumptions.ts —— pnpm assumptions：列出假设登记表（总设计 T16）。--md 打印成 Markdown 表格（贴进文档或 issue 用）
// --ledger：规则台账（DD-04 §3、DD-08 §7）。"采用"与"结论"是两列：采用了某个候选不等于证实了它，结论缺省是"未验证"；
// 证据来自别的游戏版本的标"沿用自 <版本>，待复核"，结论不因沿用升级（路线图 §5.4）
import { ASSUMPTIONS, IMPACT_NAME } from '../engine/assumptions'

import { PROPOSITIONS, type Proposition } from '../engine/propositions'
import { CONCLUSION_LABEL } from '../report/evidence'
import { currentGameVersion } from './game-version'
import { writeGenerated } from './generated-doc'

const md = process.argv.includes('--md')
if (process.argv.includes('--ledger')) {
  const esc = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
  const current = currentGameVersion()
  /** 证据：条数（迁移来的旧依据单算）；有来自别的游戏版本的，标沿用待复核 */
  const evidenceText = (p: Proposition) => {
    const legacy = p.evidence.filter(e => e.id.startsWith('legacy:')).length
    const closures = [...new Set(p.evidence.filter(e => !e.id.startsWith('legacy:')).map(e => e.ref))]
    const old = [...new Set(p.evidence.filter(e => !e.id.startsWith('legacy:') && e.observation.gameVersion !== current).map(e => e.observation.gameVersion))]
    const parts = [`${p.evidence.length}${legacy ? `（旧依据 ${legacy}）` : ''}`]
    if (closures.length) parts.push(`闭环 ${closures.map(r => r.replace(/^docs\/evidence\//, '').replace(/\.yaml$/, '')).join('、')}`)
    if (old.length) parts.push(old.map(v => (v === '未知' ? '游戏版本不详' : `沿用自 ${v}，待复核`)).join('；'))
    return parts.join('；')
  }
  const rows = (PROPOSITIONS as readonly Proposition[]).map(p => `| ${p.id} | ${esc(p.proposition)} | ${p.scope} | ${p.adopted} | ${p.candidates.filter(c => c.id !== p.adopted).map(c => `${c.id}${c.implemented ? '' : '（未实现）'}`).join('、') || '—'} | ${p.candidatesExhaustive ? '是' : '否'} | ${CONCLUSION_LABEL[p.conclusion]} | ${esc(evidenceText(p))} |`)
  const text = [
    '## 命题表', '',
    `当前声明的游戏版本：${current ?? '没写'}（data/xlsx-versions.json）。"采用"是现在代码里用的读法；"结论"是证据到了哪一步（DD-08 §4.1 的决策表），两者分开。`, '',
    '| ID | 命题 | 范围 | 采用 | 其余候选 | 列全 | 结论 | 证据 |', '|---|---|---|---|---|---|---|---|', ...rows,
  ].join('\n')
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
