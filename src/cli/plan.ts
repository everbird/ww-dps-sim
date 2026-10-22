// src/cli/plan.ts —— pnpm plan <场景.yaml> [--opening] [--gen] [--width 16] [--top 10] [--scoring rollout|surplus] [--vary 1 [--extra 2]] [--save 新.yaml]
// 按套路排轴（TD-10 §6.2 ④ 第一版，⑥ 第 2 步）：把循环轴拆成套路、重新排顺序，看能不能排回原轴或更好的。比原轴好的是要拿实战核对的假设
import { readFileSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../data/load'
import { withOpening, withRotation } from '../data/scenario-text'
import { planOpening, planRotation } from '../engine/plan'
import { ResolveError } from '../engine/resolve'
import { argsOf, fmt, loadScenario, padStart } from './format'

/** 套路的代号：A–Z，再 a–z，再 27、28…（自动生成的套路会超过 26 个） */
const tag = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : i < 52 ? String.fromCharCode(97 + i - 26) : String(i + 1))
const signedPct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${(Math.abs(x) * 100).toFixed(2)}%`
const FAILURE: Record<string, string> = {
  timeout: '等超时', comboBroken: '连段中断', compile: '编译不过', introMissed: '写了变奏没变奏', entrySkill: '出场技不是从地面普通切人入场后第一个出', airEntry: '空中 / 地面入场对不上', maxFrames: '超过帧数上限', noLoop: '没跑完一轮',
}

async function main(): Promise<number> {
  const { pos: pos0, opt } = argsOf(process.argv.slice(2), ['--width', '--top', '--scoring', '--vary', '--extra', '--save'])
  const opening = pos0.includes('--opening')
  const gen = pos0.includes('--gen')
  const pos = pos0.filter(a => a !== '--opening' && a !== '--gen')
  const file = pos.find(a => !a.startsWith('--'))
  const scoring = opt.scoring ?? 'rollout'
  const vary = Number(opt.vary ?? 0)
  const extra = opt.extra !== undefined ? Number(opt.extra) : undefined
  if (!file || pos.some(a => a.startsWith('--')) || (scoring !== 'rollout' && scoring !== 'surplus') || !(vary >= 0) || (extra !== undefined && !(extra >= 0))) {
    console.error('用法：pnpm plan <场景.yaml> [--opening] [--gen] [--width 16] [--top 10] [--scoring rollout|surplus] [--vary 1 [--extra 2]] [--save 新.yaml]')
    console.error('  把循环轴拆成套路（同一角色的一行），每个套路用的次数不变，重新排顺序（beam search）；相邻两个角色不同就插切人。')
    console.error('  --scoring rollout（缺省）：每个前缀把剩下的套路按原轴的先后接上、跑一整轮打分；surplus：只跑前缀（便宜，但攒资源的段会被筛掉）。')
    console.error('  --vary N：每个套路用的次数可以比原轴多 / 少 N 次（多补一段补位、少一段攻击…），按每秒伤害比；--extra M：一轮的套路总数最多多 / 少 M 个（缺省 2）。')
    console.error('  排满的完整跑、按比较口径排名；--save 把最好的一条另存成场景（只换循环轴），再 pnpm compare 看差在哪')
    console.error('  --gen：另外自动生成套路（各人单放 E、R、Q，原轴各行在技能 / 大招 / 声骸 / 重击之前拆成两半），每轮最多各用 1 次；套路多了会慢很多，先用小的 --width。')
    console.error('  --opening：改排启动轴（循环轴不动），每个前缀补完后跑完整的场景，按整个窗口的 DPS 比（启动轴几乎不影响稳态）；--save 只换启动轴')
    return 2
  }
  const data = await loadGameData()
  const sc = loadScenario(file)
  if (opening) return mainOpening(file, sc, data, { width: Number(opt.width ?? 16), top: Number(opt.top ?? opt.width ?? 16), vary, gen, ...(extra !== undefined ? { extra } : {}) }, opt.save)
  const t0 = Date.now()
  let x
  try {
    x = planRotation(sc, data, { width: Number(opt.width ?? 16), top: Number(opt.top ?? opt.width ?? 16), scoring, vary, gen, ...(extra !== undefined ? { extra } : {}) })
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    console.error(e instanceof Error ? e.message : e)
    return 1
  }
  const secs = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)} 秒`)
  console.log(`按套路排轴 ${file} · 口径：${x.basisLabel} · 打分：${scoring === 'rollout' ? '补完一轮' : '前缀盈余'}${vary ? ` · 次数可以 ±${vary}` : ''}${gen ? ' · 自动生成套路' : ''}`)
  console.log(`原轴 DPS ${fmt(x.ref.dps)}（每轮 ${secs(x.ref.loopSecs)}）`)
  console.log(`套路 ${x.library.length} 种（另加 ${x.library.filter(l => l.added).length}）、原轴一轮 ${x.ref.routines.length} 个：`)
  x.library.forEach((l, i) => console.log(`  ${tag(i)} ${l.line}${l.count > 1 ? ` ×${l.count}` : ''}${l.added ? '（另加）' : ''}`))
  const failed = Object.entries(x.failures).sort((a, b) => b[1] - a[1])
  console.log(`仿真 ${x.prefixRuns} 次（前缀），${((Date.now() - t0) / 1000).toFixed(1)} 秒${failed.length ? `；跑不通：${failed.map(([k, n]) => `${FAILURE[k] ?? k} ${n}`).join('、')}` : ''}`)
  const letter = (line: string) => tag(x.library.findIndex(l => l.line === line))
  console.log(`\n排名（原轴${x.refRank !== null ? `排第 ${x.refRank}` : '没进最后一层'}）`)
  console.log(`  ${padStart('排名', 4)}${padStart('DPS', 10)}${padStart('变化', 10)}${padStart('每轮', 12)}  顺序`)
  const countText = (c: Record<string, number>) => Object.entries(c).map(([line, d]) => `${d > 0 ? '+' : '−'}${Math.abs(d) > 1 ? Math.abs(d) : ''}${letter(line)}`).join(' ')
  x.leaves.forEach((l, i) => {
    const changed = countText(l.counts)
    console.log(`  ${padStart(String(i + 1), 4)}${padStart(fmt(l.dps), 10)}${padStart(l.isRef ? '原轴' : signedPct(l.dps / x.ref.dps - 1), 10)}${padStart(secs(l.loopSecs), 12)}  ${l.routines.map(letter).join(' ')}${changed ? `（次数 ${changed}）` : ''}${l.same ? `；另 ${l.same} 种写法结果一样` : ''}`)
  })
  const best = x.leaves[0]
  if (best && !best.isRef) {
    console.log('\n最好的一条：')
    for (const l of best.lines) console.log(`  - ${l}`)
  }
  if (opt.save && best) {
    const changed = countText(best.counts)
    const head = `# 按套路排轴（pnpm plan）从 ${file} 改来：${best.isRef ? '原轴就是最好的，原样' : `顺序 ${best.routines.map(letter).join(' ')}${changed ? `（次数 ${changed}）` : ''}，稳态 ${signedPct(best.dps / x.ref.dps - 1)}`}\n`
    writeFileSync(opt.save, head + withRotation(readFileSync(file, 'utf8'), sc.rotation, best.lines, '按套路排轴改的'))
    console.log(`\n已另存 ${opt.save}；pnpm compare ${file} ${opt.save} 看差在哪`)
  }
  return 0
}

/** --opening：按套路排启动轴（TD-10 §6.2 ④′） */
function mainOpening(file: string, sc: ReturnType<typeof loadScenario>, data: Awaited<ReturnType<typeof loadGameData>>, o: Parameters<typeof planOpening>[2], save?: string): number {
  const t0 = Date.now()
  let x
  try { x = planOpening(sc, data, o) } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    return 1
  }
  const letter = (line: string) => tag(x.library.findIndex(l => l.line === line))
  const countText = (c: Record<string, number>) => Object.entries(c).map(([line, d]) => `${d > 0 ? '+' : '−'}${Math.abs(d) > 1 ? Math.abs(d) : ''}${letter(line)}`).join(' ')
  const opt = (v: number | null) => (v === null ? '—' : fmt(v))
  console.log(`按套路排启动轴 ${file} · 口径：整个窗口 · 循环轴不动${o?.vary ? ` · 次数可以 ±${o.vary}` : ''}`)
  console.log(`原启动轴：整个窗口 DPS ${fmt(x.ref.dps)}，稳态 ${opt(x.ref.steady)}，启动轴 ${x.ref.openingSecs.toFixed(2)} 秒`)
  console.log(`套路 ${x.library.length} 种（另加 ${x.library.filter(l => l.added).length}）、原启动轴 ${x.ref.routines.length} 个：`)
  x.library.forEach((l, i) => console.log(`  ${tag(i)} ${l.line}${l.count > 1 ? ` ×${l.count}` : ''}${l.added ? '（另加）' : ''}`))
  const failed = Object.entries(x.failures).sort((a, b) => b[1] - a[1])
  console.log(`仿真 ${x.runs} 次，${((Date.now() - t0) / 1000).toFixed(1)} 秒${failed.length ? `；跑不通：${failed.map(([k, n]) => `${FAILURE[k] ?? k} ${n}`).join('、')}` : ''}`)
  console.log(`\n排名（原启动轴${x.refRank !== null ? `排第 ${x.refRank}` : '没排上'}）`)
  console.log(`  ${padStart('排名', 4)}${padStart('窗口 DPS', 10)}${padStart('变化', 10)}${padStart('稳态', 10)}${padStart('启动轴', 10)}  顺序`)
  x.leaves.forEach((l, i) => {
    const changed = countText(l.counts)
    console.log(`  ${padStart(String(i + 1), 4)}${padStart(fmt(l.dps), 10)}${padStart(l.isRef ? '原轴' : signedPct(l.dps / x.ref.dps - 1), 10)}${padStart(opt(l.steady), 10)}${padStart(`${l.openingSecs.toFixed(2)} 秒`, 10)}  ${l.routines.map(letter).join(' ')}${changed ? `（次数 ${changed}）` : ''}${l.same ? `；另 ${l.same} 种写法结果一样` : ''}`)
  })
  const best = x.leaves[0]
  if (best && !best.isRef) {
    console.log('\n最好的启动轴：')
    for (const l of best.lines) console.log(`  - ${l}`)
  }
  if (save && best) {
    const changed = countText(best.counts)
    const head = `# 按套路排启动轴（pnpm plan --opening）从 ${file} 改来：${best.isRef ? '原启动轴就是最好的，原样' : `顺序 ${best.routines.map(letter).join(' ')}${changed ? `（次数 ${changed}）` : ''}，整个窗口 ${signedPct(best.dps / x.ref.dps - 1)}`}\n`
    writeFileSync(save, head + withOpening(readFileSync(file, 'utf8'), sc.opening, best.lines))
    console.log(`\n已另存 ${save}；pnpm compare ${file} ${save} 看差在哪（启动轴改了，看整个窗口）`)
  }
  return 0
}

main().then(code => { process.exitCode = code })
