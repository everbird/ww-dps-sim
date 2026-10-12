// src/cli/timeline.ts —— pnpm timeline <场景.yaml> [--view a|b|c|d] [--out <文件.html>] [--fragment]：跑一个场景，把结果嵌进
// web/timeline.html（原版，含调试表），写成能直接用浏览器打开的时间轴网页（M6 第一步，TD-10 §5）。--fragment 不加 <!doctype> 与 <head>，
// 给要再包一层的地方用（只对原版）。--view 改用视图 A–D 的模板（web/designs/，TD-12 §2.1），缺省写到 out/<场景名>.<视图>.html。
// 退出码：0 成功；1 场景有错或运行期报错（网页照样写出，日志保留到出错为止）；2 用法错误。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { loadGameData } from '../data/load'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { simulate } from '../engine/simulate'
import type { ResolvedScenario } from '../engine/types'
import { renderDesign, renderTimeline, TIMELINE_VIEWS, timelineModel } from '../report/timeline'
import { argsOf, fmt, loadScenario, pct } from './format'

const TEMPLATE = new URL('../../web/timeline.html', import.meta.url)
const DESIGNS = new URL('../../web/designs/', import.meta.url)
const USAGE = `用法：pnpm timeline <场景.yaml> [--view ${Object.keys(TIMELINE_VIEWS).join('|')}] [--out <网页.html>] [--fragment]`

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--out', '--view'])
  const fragment = pos.includes('--fragment')
  const file = pos.find(a => !a.startsWith('--'))
  const view = opt.view
  if (!file || (view !== undefined && !(view in TIMELINE_VIEWS)) || (view !== undefined && fragment)) {
    console.error(view !== undefined && fragment ? '--fragment 只对原版，不能和 --view 一起写' : view !== undefined && !(view in TIMELINE_VIEWS) ? `没有视图 ${view}\n${USAGE}` : USAGE)
    return 2
  }
  const sc = loadScenario(file)
  const data = await loadGameData()
  let r: ResolvedScenario
  try {
    r = resolveScenario(sc, data)
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  const res = simulate(r)
  const model = timelineModel(file, sc, r, res)
  const html = view === undefined
    ? renderTimeline(readFileSync(TEMPLATE, 'utf8'), model, fragment)
    : renderDesign(readFileSync(new URL(TIMELINE_VIEWS[view]!, DESIGNS), 'utf8'), readFileSync(new URL('shared.js', DESIGNS), 'utf8'), model)
  const target = resolve(opt.out ?? `out/${basename(file, extname(file))}${view === undefined ? '' : `.${view}`}.html`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, html)
  const s = res.summary
  console.log(`${file}：DPS ${fmt(s.dps)}${s.steady ? `（稳态 ${fmt(s.steady.dps)}）` : ''}，谐度破坏 ${s.enemy.tuneBreaks} 次（${pct(s.totalDamage ? s.enemy.tuneBreakDamage / s.totalDamage : 0)}）`)
  console.log(`时间轴 → ${target}（${(html.length / 1024).toFixed(0)} KB）`)
  if (res.error) console.log(`报错（第 ${res.error.frame} 帧）：${res.error.message}`)
  return res.error ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().then(code => process.exit(code), e => { console.error(e); process.exit(1) })
}
