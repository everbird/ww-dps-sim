// src/cli/scorecard.ts —— pnpm scorecard <场景.yaml …> [--goal …] [--repeat N] [--md 输出.md]：轴卡片（TD-10 §6.3，src/engine/scorecard.ts）。
// 几条轴放一起，按四个维度各列一张表；不合成一个分数，标出帕累托前沿（零帧与"熟练"都比不过别人的不标）
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { loadGameData } from '../data/load'
import { scorecards, type Scorecard } from '../engine/scorecard'
import { argsOf, fmt, loadScenario, OVERRIDE_FLAGS, OVERRIDE_USAGE, withOverrides } from './format'

const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${(Math.abs(x) * 100).toFixed(1)}%`)
const p0 = (x: number) => `${(x * 100).toFixed(1)}%`

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--md', ...OVERRIDE_FLAGS])
  if (pos.length === 0) {
    console.error(`用法：pnpm scorecard <场景.yaml …> ${OVERRIDE_USAGE} [--md 输出.md]`)
    console.error('  每条轴：① 目标（场景 goal 或 --goal 的比较口径，另列打死 1 / 2 / 3 倍血的战斗秒）② 手速档与操作密度 ③ 共鸣效率需求、链数 / 武器降档 ④ 碰到的假设、翻哪条变得最多')
    return 2
  }
  const data = await loadGameData()
  const t0 = Date.now()
  const items = pos.map(f => ({ name: basename(f, '.yaml'), sc: withOverrides(loadScenario(f), opt) }))
  const cards = scorecards(items, data, c => console.error(`  ${c.name}：${c.runs} 次仿真，${((Date.now() - t0) / 1000).toFixed(0)} 秒`))
  const out: string[] = []
  const ref = cards[0]!
  out.push('# 轴卡片', '', `${cards.length} 条轴，口径：${ref.goal.label}；第一条当基准。★ = 帕累托前沿（没有别的轴零帧和"熟练"都更好）。TD-10 §6.3。`, '')
  out.push('## ① 目标', '', '| 轴 | 口径 | 比基准 | 打死 1 倍血 | 2 倍 | 3 倍 |', '|---|---:|---:|---:|---:|---:|')
  const secs = (k: Scorecard['kills'][number]) => (k.secs === null ? '—' : `${k.secs.toFixed(1)}${k.estimated ? '（估）' : ''}`)
  for (const c of cards) out.push(`| ${c.pareto ? '★ ' : ''}${c.name} | ${fmt(c.goal.dps)} | ${c === ref ? '基准' : pct(c.goal.dps / ref.goal.dps - 1)} | ${c.kills.map(secs).join(' | ')} |`)
  out.push('', '打死几倍血按战斗秒（通关计时，大招时停也停），启动轴算在内。', '')
  out.push('## ② 好不好打', '', '| 轴 | 高手（晚 3 帧） | 熟练（6） | 普通（10） | 熟练比基准 | 每轮 | 决策点 / 分 | 切人 / 分 | 抢帧 ! | 空中切人 / 轮 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  const refSkilled = ref.hands.find(h => h.tier === '熟练')?.dps ?? null
  for (const c of cards) {
    const sk = c.hands.find(h => h.tier === '熟练')?.dps ?? null
    const d = c.density
    out.push(`| ${c.name} | ${c.hands.map(h => pct(h.pct)).join(' | ')} | ${c === ref ? '基准' : sk !== null && refSkilled ? pct(sk / refSkilled - 1) : '—'} | ${d.loopSecs !== null ? `${d.loopSecs.toFixed(1)} 秒` : '—'} | ${d.perMin !== null ? d.perMin.toFixed(0) : '—'} | ${d.switchesPerMin !== null ? d.switchesPerMin.toFixed(1) : '—'} | ${d.forced} | ${d.airborne !== null ? d.airborne.toFixed(0) : '—'} |`)
  }
  out.push('', '手速档：每个决策点（切人、不是连段后续的出招）在合法之后固定晚这一档的平均帧数，比零帧掉多少（假设 hand-speed）。', '')
  out.push('## ③ 养成门槛', '')
  for (const c of cards) {
    const need = c.energy.map(e => `${e.char} ${e.need === null ? '再多也要等' : e.need <= e.floor + 1e-9 ? '不用堆' : p0(e.need)}（现在 ${p0(e.current)}）`).join('；')
    const down = c.downgrades.map(d => `${d.char} ${d.what} ${d.error ? `跑不通（${d.error}）` : pct(d.pct)}`).join('；')
    out.push(`- **${c.name}**：共鸣效率 ${need || '—'}。降档：${down || '没有可降的'}`)
  }
  out.push('', '## ④ 靠不靠得住', '')
  for (const c of cards) {
    const f = c.fragile
    out.push(`- **${c.name}**：碰到的假设 ${c.assumptions.join('、') || '无'}；翻过来变得最多：${f ? `${f.id}（${f.change}）${f.error ? '跑不通' : pct(f.pct)}` : '—'}`)
  }
  out.push('', `共 ${cards.reduce((x, c) => x + c.runs, 0)} 次仿真，${((Date.now() - t0) / 1000).toFixed(0)} 秒。`)
  const text = out.join('\n') + '\n'
  if (opt.md) { writeFileSync(opt.md, text); console.log(`写到 ${opt.md}`) } else console.log(text)
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
