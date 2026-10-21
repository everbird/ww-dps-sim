// src/cli/plan.ts —— pnpm plan <场景.yaml> [--width 16] [--top 10] [--scoring rollout|surplus] [--save 新.yaml]
// 按套路排轴（TD-10 §6.2 ④ 第一版，⑥ 第 2 步）：把循环轴拆成套路、重新排顺序，看能不能排回原轴或更好的。比原轴好的是要拿实战核对的假设
import { readFileSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../data/load'
import { withRotation } from '../data/scenario-text'
import { planRotation } from '../engine/plan'
import { ResolveError } from '../engine/resolve'
import { argsOf, fmt, loadScenario, padStart } from './format'

const signedPct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${(Math.abs(x) * 100).toFixed(2)}%`
const FAILURE: Record<string, string> = {
  timeout: '等超时', comboBroken: '连段中断', compile: '编译不过', introMissed: '写了变奏没变奏', entrySkill: '出场技不是普通切人入场后第一个出', maxFrames: '超过帧数上限', noLoop: '没跑完一轮',
}

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--width', '--top', '--scoring', '--save'])
  const file = pos.find(a => !a.startsWith('--'))
  const scoring = opt.scoring ?? 'rollout'
  if (!file || pos.some(a => a.startsWith('--')) || (scoring !== 'rollout' && scoring !== 'surplus')) {
    console.error('用法：pnpm plan <场景.yaml> [--width 16] [--top 10] [--scoring rollout|surplus] [--save 新.yaml]')
    console.error('  把循环轴拆成套路（同一角色的一行），每个套路用的次数不变，重新排顺序（beam search）；相邻两个角色不同就插切人。')
    console.error('  --scoring rollout（缺省）：每个前缀把剩下的套路按原轴的先后接上、跑一整轮打分；surplus：只跑前缀（便宜，但攒资源的段会被筛掉）。')
    console.error('  排满的完整跑、按比较口径排名；--save 把最好的一条另存成场景（只换循环轴），再 pnpm compare 看差在哪')
    return 2
  }
  const data = await loadGameData()
  const sc = loadScenario(file)
  const t0 = Date.now()
  let x
  try {
    x = planRotation(sc, data, { width: Number(opt.width ?? 16), top: Number(opt.top ?? opt.width ?? 16), scoring })
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    console.error(e instanceof Error ? e.message : e)
    return 1
  }
  const secs = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)} 秒`)
  console.log(`按套路排轴 ${file} · 口径：${x.basisLabel} · 打分：${scoring === 'rollout' ? '补完一轮' : '前缀盈余'}`)
  console.log(`原轴 DPS ${fmt(x.ref.dps)}（每轮 ${secs(x.ref.loopSecs)}）`)
  console.log(`套路 ${x.library.length} 种、一轮 ${x.ref.routines.length} 个：`)
  x.library.forEach((l, i) => console.log(`  ${String.fromCharCode(65 + i)} ${l.line}${l.count > 1 ? ` ×${l.count}` : ''}`))
  const failed = Object.entries(x.failures).sort((a, b) => b[1] - a[1])
  console.log(`仿真 ${x.prefixRuns} 次（前缀），${((Date.now() - t0) / 1000).toFixed(1)} 秒${failed.length ? `；跑不通：${failed.map(([k, n]) => `${FAILURE[k] ?? k} ${n}`).join('、')}` : ''}`)
  const letter = (line: string) => String.fromCharCode(65 + x.library.findIndex(l => l.line === line))
  console.log(`\n排名（原轴${x.refRank !== null ? `排第 ${x.refRank}` : '没进最后一层'}）`)
  console.log(`  ${padStart('排名', 4)}${padStart('DPS', 10)}${padStart('变化', 10)}${padStart('每轮', 12)}  顺序`)
  x.leaves.forEach((l, i) => {
    console.log(`  ${padStart(String(i + 1), 4)}${padStart(fmt(l.dps), 10)}${padStart(l.isRef ? '原轴' : signedPct(l.dps / x.ref.dps - 1), 10)}${padStart(secs(l.loopSecs), 12)}  ${l.routines.map(letter).join(' ')}`)
  })
  const best = x.leaves[0]
  if (best && !best.isRef) {
    console.log('\n最好的一条：')
    for (const l of best.lines) console.log(`  - ${l}`)
  }
  if (opt.save && best) {
    const head = `# 按套路排轴（pnpm plan）从 ${file} 改来：${best.isRef ? '原轴就是最好的，原样' : `顺序 ${best.routines.map(letter).join(' ')}，稳态 ${signedPct(best.dps / x.ref.dps - 1)}`}\n`
    writeFileSync(opt.save, head + withRotation(readFileSync(file, 'utf8'), sc.rotation, best.lines, '按套路排轴改的'))
    console.log(`\n已另存 ${opt.save}；pnpm compare ${file} ${opt.save} 看差在哪`)
  }
  return 0
}

main().then(code => { process.exitCode = code })
