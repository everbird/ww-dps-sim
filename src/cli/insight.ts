// src/cli/insight.ts —— pnpm insight <场景.yaml> [--delays 0,3,6,10,15] [--tight 6]：结论（TD-10 §6）——共鸣效率需求、操作容错、假设敏感度、卡住的时间、卡帧点
import { loadGameData } from '../data/load'
import { IMPACT_NAME, assumptionOf } from '../engine/assumptions'
import { DEFAULT_DELAYS, DEFAULT_TIGHT, insight } from '../engine/insight'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { argsOf, fmt, loadScenario, padEnd, padStart, pct } from './format'

const signedPct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${(Math.abs(x) * 100).toFixed(2)}%`

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--delays', '--tight'])
  const file = pos[0]
  if (!file) {
    console.error('用法：pnpm insight <场景.yaml> [--delays 0,3,6,10,15] [--tight 6]')
    return 2
  }
  const data = await loadGameData()
  let r
  try { r = resolveScenario(loadScenario(file), data) } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  const delays = opt.delays ? opt.delays.split(',').map(Number) : DEFAULT_DELAYS
  const t0 = Date.now()
  const x = insight(r, { delays, tight: opt.tight ? Number(opt.tight) : DEFAULT_TIGHT })
  console.log(`场景 ${file} · 口径：${x.basis.label}，DPS ${fmt(x.basis.dps)}（跑了 ${x.runs} 次仿真，${((Date.now() - t0) / 1000).toFixed(1)} 秒）`)

  console.log('\n① 共鸣效率需求：轴里的大招不等能量，最低要多少（按单调二分，精确到 0.25%）')
  if (x.energy.length === 0) console.log('  轴里没有大招')
  for (const e of x.energy) {
    // 最低就是下限（面板 100% + 常驻 buff）：不堆共鸣效率也够，单独说明，免得当成"要堆到这么多"
    const atFloor = e.need !== null && e.need <= e.floor + 1e-9
    const floorNote = `下限：面板 100%${e.floor > 1 + 1e-9 ? ` + 常驻 ${pct(e.floor - 1)}` : ''}，不堆共鸣效率也够`
    const need = e.need === null ? `加到 ${pct(e.current + 2)} 还要等（大招放得太早）` : atFloor ? `${pct(e.need)}（${floorNote}）` : pct(e.need)
    const margin = e.need === null ? '' : e.current >= e.need ? `，富余 ${pct(e.current - e.need)}` : `，差 ${pct(e.need - e.current)}`
    console.log(`  ${padEnd(e.char, 8)}现在 ${pct(e.current)}，最低 ${need}${margin}${e.waitSecs > 0 ? `；现在等能量 ${e.waitSecs.toFixed(2)} 秒` : ''}`)
  }

  console.log('\n② 操作容错：切人与不是连段后续的出招，在合法之后都再晚 N 帧（人的反应时间；连段后续按预输入不加；0 = 最早合法帧，理论上限）')
  console.log(`  ${padStart('晚几帧', 6)}${padStart('DPS', 10)}${padStart('变化', 10)}${padStart('每轮', 10)}`)
  for (const t of x.tolerance)
    console.log(t.error ? `  ${padStart(String(t.delay), 6)}  跑不通：${t.error}`
      : `  ${padStart(String(t.delay), 6)}${padStart(fmt(t.dps!), 10)}${padStart(signedPct(t.change!), 10)}${padStart(`${t.loopSecs!.toFixed(2)} 秒`, 10)}`)

  console.log('\n③ 假设敏感度：把能自动翻的假设逐个翻一下（pnpm assumptions 看全部假设）')
  for (const s of x.sensitivity) {
    const a = assumptionOf(s.id)!
    console.log(s.error ? `  ${s.id}（${s.change}）跑不通：${s.error}`
      : `  ${padEnd(`${s.id}（${s.change}）`, 40)}${padStart(signedPct(s.pct!), 10)}  估计影响${IMPACT_NAME[a.impact]}：${a.what}`)
  }
  if (x.notHit.length) console.log(`  这次没碰到、翻了也一样（不跑）：${x.notHit.join('、')}`)

  console.log('\n④ 指令被挡住的时间：窗口里队首指令在等什么（前一招可能还在打，不等于空闲；写轴要求的、操作延迟、正常出招节奏不算）')
  if (x.waits.length === 0) console.log('  没有')
  for (const w of x.waits) {
    console.log(`  ${padEnd(w.label, 30)}${padStart(`${w.secs.toFixed(2)} 秒`, 10)}  占窗口 ${pct(w.share)}`)
    for (const t of w.top) console.log(`      ${t.where}  ${t.secs.toFixed(2)} 秒  ${t.reason}`)
  }

  console.log(`\n⑥ 卡帧点：循环轴的每个决策点单独每轮晚 ${x.tightFrames} 帧（其余照常）。晚了的影响拆成"每轮多几帧"与"每轮伤害变多少"：`)
  console.log(`  连锁 = 一轮多出的比晚的还多（冷却错位、多补位），或每轮伤害少了（buff 没罩住）——真要卡帧的地方，先实测能不能预输入；`)
  console.log(`  一轮变长 = 晚几帧就多几帧，按个人手速线性地掉；有余量 = 单独晚这一处无所谓（几处共用的余量，处处都晚时仍会掉，见 ②）；`)
  console.log(`  反而更好 = 原轴这里按早了，值得改轴`)
  const KIND = { better: '反而更好', cascade: '连锁', time: '一轮变长', slack: '有余量' } as const
  const row = (t: (typeof x.tight)[number]) => t.error ? `  第 ${t.line} 条第 ${t.item} 个  ${t.what}  跑不通：${t.error}`
    : `  ${padEnd(`第 ${t.line} 条第 ${t.item} 个`, 14)}${padStart(signedPct(t.pct!), 9)}  每轮 ${t.extraFrames! >= 0 ? '+' : ''}${t.extraFrames!.toFixed(0)} 帧、伤害 ${signedPct(t.dmgPct!)}  ${t.what}`
  for (const k of ['better', 'cascade', 'time', 'slack'] as const) {
    const ts = x.tight.filter(t => t.kind === k)
    if (ts.length === 0) continue
    console.log(`  ${KIND[k]}（${ts.length} 处）${k === 'slack' ? `：${ts.map(t => t.what).join('、')}` : ''}`)
    if (k === 'better') ts.reverse()
    if (k !== 'slack') for (const t of ts.slice(0, k === 'time' ? 4 : 12)) console.log(`  ${row(t)}`)
    if (k === 'time' && ts.length > 4) console.log(`      …另 ${ts.length - 4} 处，都在 ${signedPct(ts.at(-1)!.pct!)} 到 ${signedPct(ts[0]!.pct!)} 之间`)
  }
  for (const t of x.tight.filter(t => t.kind === null)) console.log(row(t))
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
