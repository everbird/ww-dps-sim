// src/cli/timeline.ts —— pnpm timeline <场景.yaml> [--out <文件.html>] [--fragment]：跑一个场景，把结果嵌进 web/timeline.html，
// 写成能直接用浏览器打开的时间轴网页（M6 第一步，TD-10 §5）。--fragment 不加 <!doctype> 与 <head>，给要再包一层的地方用。
// 退出码：0 成功；1 场景有错或运行期报错（网页照样写出，日志保留到出错为止）；2 用法错误。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { loadGameData } from '../data/load'
import type { Scenario } from '../data/scenario.schema'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { simulate } from '../engine/simulate'
import type { ResolvedScenario, SimResult } from '../engine/types'
import { argsOf, fmt, loadScenario, pct } from './format'

const TEMPLATE = new URL('../../web/timeline.html', import.meta.url)
const DATA_TAG = '<script id="timeline-data" type="application/json">null</script>'

/** 网页要的数据：仿真结果，加上画图用的队伍、敌人、排轴原文与各动作的类别（事件日志里没有的） */
export function timelineModel(file: string, sc: Scenario, r: ResolvedScenario, res: SimResult) {
  const e = r.enemy
  return {
    title: basename(file, extname(file)),
    scenario: file,
    data: r.data.version,
    team: r.team.map(m => ({
      name: m.def.name, element: m.def.element, energyCap: m.def.energyCost, chain: m.chain, weapon: m.weapon.def.key, rank: m.weapon.rank,
    })),
    enemy: {
      id: e.id, level: e.level, tunabilityMax: e.tunabilityMax, whiteBarTough: e.whiteBarTough, paralysisSec: e.paralysisFrames / 60,
    },
    concertoMax: r.rules.concertoMax,
    rotation: sc.rotation,
    opening: sc.opening,
    options: { repeat: r.options.repeat, tuneBreak: r.options.tuneBreak },
    kinds: Object.fromEntries(r.team.map(m => [m.def.name, Object.fromEntries(Object.values(m.actions).map(a => [a.id, a.kind]))])),
    summary: res.summary,
    ...(res.error ? { error: res.error } : {}),
    log: res.log.filter(ev => ev.type !== 'judgmentSpawn'),            // 网页不用，省体积
  }
}

/** 把模型嵌进模板：替换数据占位与标题；"<" 转义成 <，免得数据里的 "</script>" 提前结束脚本 */
export function renderTimeline(template: string, model: ReturnType<typeof timelineModel>, fragment = false): string {
  if (!template.includes(DATA_TAG)) throw new Error('web/timeline.html 里找不到数据占位')
  const json = JSON.stringify(model).replace(/</g, '\\u003c')
  const names = model.team.map(t => t.name).join('·')
  const body = template
    .replace(/<title>[^<]*<\/title>/, `<title>${names} 时间轴</title>`)
    .replace(DATA_TAG, () => `<script id="timeline-data" type="application/json">${json}</script>`)
  if (fragment) return body
  // 独立的网页：模板里 <div class="wrap"> 之前是标题、字体与样式，放进 <head>
  const cut = body.indexOf('<div class="wrap">')
  if (cut < 0) throw new Error('web/timeline.html 里找不到 <div class="wrap">')
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + body.slice(0, cut) + '</head>\n<body>\n' + body.slice(cut) + '</body>\n</html>\n'
}

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--out'])
  const fragment = pos.includes('--fragment')
  const file = pos.find(a => !a.startsWith('--'))
  if (!file) {
    console.error('用法：pnpm timeline <场景.yaml> [--out <网页.html>] [--fragment]')
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
  const html = renderTimeline(readFileSync(TEMPLATE, 'utf8'), timelineModel(file, sc, r, res), fragment)
  const target = resolve(opt.out ?? `out/${basename(file, extname(file))}.html`)
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
