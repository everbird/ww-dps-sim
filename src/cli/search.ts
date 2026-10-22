// src/cli/search.ts —— pnpm run search <场景.yaml> [--move Q,E] [--drop A5] [--swap] [--insert A1~] [--char 椿] [--rounds 1] [--beam 3] [--top 10] [--max-runs 500] [--save 新.yaml]
// 轴搜索（TD-10 §6.1，总设计 §3.7、M7）：在循环轴上挪动 / 去掉 / 对调 / 插入动作，按比较口径排名。比原轴好的改法是要拿实战核对的假设
import { readFileSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../data/load'
import { withRotation } from '../data/scenario-text'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { HAND_PROFILES, type HandProfile } from '../engine/sample'
import { FAILURE_LABEL, searchRotation, type Candidate } from '../engine/search'
import { argsOf, fmt, loadScenario, padStart, withOverrides, OVERRIDE_FLAGS } from './format'

const signedPct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${(Math.abs(x) * 100).toFixed(2)}%`
const list = (s: string | undefined) => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : undefined)

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--move', '--drop', '--insert', '--char', '--rounds', '--beam', '--top', '--max-runs', '--hand', '--save', ...OVERRIDE_FLAGS])
  const file = pos.find(a => !a.startsWith('--'))
  const unknown = pos.filter(a => a.startsWith('--') && a !== '--swap')
  if (!file || unknown.length > 0) {
    if (unknown.length) console.error(`不认识的参数：${unknown.join(' ')}`)
    console.error('用法：pnpm run search <场景.yaml> [--move Q,E] [--drop A5] [--swap] [--insert A1~] [--char 椿] [--rounds 1] [--beam 3] [--top 10] [--max-runs 500] [--hand 熟练] [--save 新.yaml]')
    console.error('  缺省只挪动各角色的声骸技能（Q），在同一角色的行里换位置；另外可以试：--drop 去掉这些动作，--swap 对调同一角色相邻的两个动作，')
    console.error('  --insert 插入这些（轴里的写法，可带后缀，如 A1~）；--rounds 大于 1 时在最好的几条上接着改；')
    console.error('  --hand 高手|熟练|普通：按真人操作打分——每个决策点固定晚这一档手速的平均帧数（3 / 6 / 10，假设 hand-speed），原轴也这样算')
    console.error('  --save 把最好的一条另存成场景（其余照原文，只换循环轴），可以接着 pnpm compare 原.yaml 新.yaml 看差在哪')
    return 2
  }
  const data = await loadGameData()
  const sc0 = withOverrides(loadScenario(file), opt)
  if (opt.hand !== undefined && !(opt.hand in HAND_PROFILES)) { console.error(`--hand 只能是 ${Object.keys(HAND_PROFILES).join(' / ')}`); return 2 }
  const handDelay = opt.hand ? Math.round(HAND_PROFILES[opt.hand as HandProfile].mean) : 0
  // --hand：所有候选与原轴都在 options.inputDelay 之上再晚这么多帧（同 pnpm plan --hand）
  const sc = handDelay ? { ...sc0, options: { ...sc0.options, inputDelay: sc0.options.inputDelay + handDelay } } : sc0
  if (handDelay) console.log(`按真人操作打分：手速"${opt.hand}"，每个决策点晚 ${handDelay} 帧（这一档的平均，假设 hand-speed）`)
  let r
  try { r = resolveScenario(sc, data) } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  const move = list(opt.move), drop = list(opt.drop), insert = list(opt.insert), chars = list(opt.char), swap = pos.includes('--swap')
  const rounds = Number(opt.rounds ?? 1), beam = Number(opt.beam ?? 3), top = Number(opt.top ?? 10), maxRuns = Number(opt['max-runs'] ?? 500)
  const t0 = Date.now()
  let x
  try {
    x = searchRotation(r, sc.rotation, sc.opening, {
      ...(move ? { move } : {}), ...(drop ? { drop } : {}), ...(insert ? { insert } : {}), ...(chars ? { chars } : {}), swap, rounds, beam, maxRuns,
    })
  } catch (e) { console.error(e instanceof Error ? e.message : e); return 1 }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const how = [`挪动 ${move ? move.join('、') : '声骸技能（Q）'}（同一角色的行里换位置）`, ...(drop ? [`去掉 ${drop.join('、')}`] : []),
    ...(swap ? ['对调相邻的两个动作'] : []), ...(insert ? [`插入 ${insert.join('、')}`] : [])].join('；')
  console.log(`轴搜索 ${file} · 口径：${x.basis.label}`)
  console.log(`改法：${how}${chars ? `；只改 ${chars.join('、')}` : ''}；最多 ${rounds} 轮${rounds > 1 ? `（每轮留 ${beam} 条往下改）` : ''}`)
  const loop = (c: Candidate) => (c.loopSecs !== null ? `${c.loopSecs.toFixed(2)} 秒` : '—')
  console.log(`原轴 DPS ${fmt(x.base.dps!)}（每轮 ${loop(x.base)}）${x.basis.spread > 0 ? `；稳态窗口挪一轮 DPS 变 ±${(x.basis.spread * 100).toFixed(2)}%，差得比这小的算在误差内（P3）` : ''}`)
  const failed = Object.values(x.failures).reduce((a, b) => a + b, 0)
  const why = Object.entries(x.failures).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${FAILURE_LABEL[k] ?? k} ${n}`).join('、')
  const stop = { rounds: `跑满 ${x.rounds} 轮`, noBetter: `第 ${x.rounds} 轮没有更好的，停`, maxRuns: `仿真次数到上限 ${maxRuns}，停` }[x.stoppedBy]
  console.log(`试了 ${x.tried} 种：跑通 ${x.tried - failed} 种，跑不通 ${failed} 种${failed ? `（${why}）` : ''}；仿真 ${x.runs} 次，${secs} 秒；${stop}`)

  console.log(`\n${padStart('排名', 4)}${padStart('DPS', 10)}${padStart('变化', 10)}${padStart('每轮', 11)}  改法`)
  const rank = x.results.indexOf(x.base) + 1
  const row = (c: Candidate, k: number) => {
    const isBase = c === x.base
    const change = isBase ? '原轴' : signedPct(c.dps! / x.base.dps! - 1)
    const warn = c.introMissed > x.base.introMissed ? `（写了变奏没变奏 ${c.introMissed} 处，轴可能有问题）` : ''
    console.log(`${padStart(String(k), 4)}${padStart(fmt(c.dps!), 10)}${padStart(change, 10)}${padStart(loop(c), 11)}  ${isBase ? '' : c.steps.join(' → 再 ')}${warn}`)
  }
  // 结果一样的（DPS 与每轮时长都相同，多半是同一处换个等价的位置）合成一行，排名照算
  const same = (a: Candidate, b: Candidate) => Math.abs(a.dps! - b.dps!) < 1e-6 && a.loopSecs === b.loopSecs
  let shown = 0, k = 0
  while (k < x.results.length && shown < top) {
    let j = k + 1
    while (j < x.results.length && same(x.results[j]!, x.results[k]!) && x.results[j] !== x.base && x.results[k] !== x.base) j++
    row(x.results[k]!, k + 1)
    if (j - k > 1) console.log(`${' '.repeat(37)}另有 ${j - k - 1} 种结果相同（第 ${j - k > 2 ? `${k + 2}–${j}` : k + 2} 名）`)
    shown++
    k = j
  }
  if (rank > k) { console.log('   …'); row(x.base, rank) }
  console.log(`（原轴排第 ${rank} / ${x.results.length}）`)

  const best = x.results[0]!
  if (best !== x.base) {
    console.log('\n最好的一条（循环轴，改了的行）：')
    if (best.lines.length === x.base.lines.length) {
      best.lines.forEach((l, i) => { if (l !== x.base.lines[i]) console.log(`  第 ${i + 1} 条  ${l}`) })
    } else best.lines.forEach((l, i) => console.log(`  ${padStart(String(i + 1), 2)}  ${l}`))
  }
  if (opt.save) {
    const head = `# 轴搜索（pnpm run search）从 ${file} 改来：${best === x.base ? '没有比原轴更好的，原样' : best.steps.join('；再 ')}\n`
    writeFileSync(opt.save, head + withRotation(readFileSync(file, 'utf8'), x.base.lines, best.lines))
    console.log(`\n另存 → ${opt.save}（pnpm compare ${file} ${opt.save} 看差在哪）`)
  }
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
