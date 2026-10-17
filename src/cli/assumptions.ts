// src/cli/assumptions.ts —— pnpm assumptions：列出假设登记表（总设计 T16）。--md 打印成 Markdown 表格（贴进文档或 issue 用）
import { ASSUMPTIONS, IMPACT_NAME } from '../engine/assumptions'

const md = process.argv.includes('--md')
if (md) {
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
