// src/cli/cards.ts —— pnpm cards <场景.yaml> [--char 椿]：套路卡速查表（TD-10 §6.2 ②、⑥ 第 1 步）。
// 每个套路（同一角色的一行轴）在几种上下文里单独量一遍，另列原场景里每轮的这一段；对不上、切走得太早的标出来
import { loadGameData } from '../data/load'
import { ENTRY_LABEL, EXIT_LABEL, measureCards, type Card, type CardFlag, type CardMeasure } from '../engine/cards'
import { ResolveError } from '../engine/resolve'
import { argsOf, fmt, loadScenario, padEnd, padStart } from './format'

const FLAG_TEXT: Record<CardFlag, string> = {
  switchAtStart: '切走时大招才打了不到 10 帧：数据可能漏了切人锁，回头查 xlsx 的备注与无敌两列（TD-10 §6.2 ⑦）',
  needsSetup: '不铺垫跑不通：要前置状态（见下面的原因），排轴时只能接在铺垫那样的套路后面',
  teamMismatch: '队里有一轮与同入场方式的单独量差 ≥ 0.1 秒：多半在等冷却或切人冷却（看"等待"），或者状态不同',
}
const WAIT_TEXT: Record<string, string> = {
  cooldown: '冷却', switchCd: '切人冷却', switchLock: '切人锁', globalStop: '大招动画', airborne: '等跳起', inputLock: '输入锁', resource: '资源', hook: '角色条件',
  combo: '连段', priority: '优先级', derive: '派生', started: '出手', settled: '就绪', delay: '延迟', input: '操作',
}

function measureText(m: CardMeasure, char: string): string[] {
  const waits = Object.entries(m.waits).filter(([, v]) => v! >= 0.05).sort((a, b) => b[1]! - a[1]!)
    .map(([k, v]) => `${WAIT_TEXT[k] ?? k} ${v!.toFixed(2)}`).join('、')
  const who = (t: string) => (t === char ? '己' : t === 'enemy' ? '敌' : t)
  const buffs = m.buffs.map(b => `${b.id.startsWith(`${char}.`) ? b.id.slice(char.length + 1) : b.id}→${who(b.target)} ${b.secs.toFixed(0)}s`).join('、')
  const eff = m.effects.added || m.effects.burst ? `异常 +${m.effects.added}${m.effects.burst ? `、爆发 +${m.effects.burst}` : ''}` : ''
  const full = m.full.length ? `（${m.full.map(f => (f === 'concerto' ? '协奏' : '能量')).join('、')}满了，之后少算）` : ''
  return [
    `${padStart(m.secs.toFixed(2), 6)} 秒  协奏 ${padStart(m.concerto.toFixed(1), 5)}  能量 ${padStart(m.energy.toFixed(1), 5)}（给队友 ${m.energyTeam.toFixed(1)}）`
      + `  伤害 ${padStart(fmt(m.damage), 8)}  ${m.actions} 个动作${m.skipped ? `、跳过补位 ${m.skipped}` : ''}${full}`,
    ...(waits ? [`等待：${waits}`] : []),
    ...(buffs ? [`给的 buff：${buffs}`] : []),
    ...(eff ? [eff] : []),
    ...(m.exit ? [`切走时 ${m.exit.action} 打到第 ${m.exit.frame} 帧`] : []),
    ...(m.exitWait >= 0.05 ? [`下一招另等了 ${m.exitWait.toFixed(2)} 秒（冷却、资源等，没算进时长）`] : []),
  ]
}

function printCard(c: Card): void {
  console.log(`\n## ${c.line}`)
  console.log(`  铺垫：${c.setup ?? '—'}；接自己：${c.next ?? '—'}`)
  for (const x of c.rows) {
    const ctx = padEnd(`${x.setup ? '铺垫后' : '单独'} · ${ENTRY_LABEL[x.entry]} → ${EXIT_LABEL[x.exit]}`, 26)
    if (!x.m) { console.log(`  ${ctx} 跑不通：${x.error}`); continue }
    const [head, ...rest] = measureText(x.m, c.char)
    console.log(`  ${ctx}${head}${x.energyGiven ? '（开局给了大招能量，自己的能量少算）' : ''}`)
    for (const l of rest) console.log(`  ${' '.repeat(26)}  ${l}`)
  }
  for (const t of c.team) {
    const ctx = padEnd(`队里 · ${t.loop === 0 ? '启动' : `第 ${t.loop} 轮`} · ${ENTRY_LABEL[t.entry]}`, 26)
    const [head, ...rest] = measureText(t.m, c.char)
    console.log(`  ${ctx}${head}${t.match !== null ? `  与单独量差 ${t.match.toFixed(2)} 秒` : ''}`)
    for (const l of rest) console.log(`  ${' '.repeat(26)}  ${l}`)
  }
  for (const f of c.flags) console.log(`  ⚠ ${FLAG_TEXT[f]}`)
}

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--char'])
  const file = pos.find(a => !a.startsWith('--'))
  if (!file || pos.some(a => a.startsWith('--'))) {
    console.error('用法：pnpm cards <场景.yaml> [--char 椿,散华]')
    console.error('  把轴里每一行（同一角色的出招）当一个套路，单独量它在几种上下文里的时长、资源、伤害、给的 buff：')
    console.error('  入场（接着打 / 普通切入 / 变奏切入）× 有没有铺垫（同一角色的上一个套路）× 出口（切走 / 接自己的下一招）；')
    console.error('  另列原场景里每轮的这一段与"同入场方式的单独量"差多少（TD-10 §6.2）')
    return 2
  }
  const data = await loadGameData()
  const sc = loadScenario(file)
  const chars = opt.char ? opt.char.split(',').map(s => s.trim()).filter(Boolean) : undefined
  const t0 = Date.now()
  let out
  try { out = measureCards(sc, data, chars ? { chars } : {}) } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  console.log(`套路卡 ${file} · ${out.cards.length} 个套路，仿真 ${out.runs} 次，${((Date.now() - t0) / 1000).toFixed(1)} 秒`)
  console.log('时长 = 这段第一条指令开始到下一条指令能开始（战斗秒；下一条自己在等冷却、资源的不算）；协奏、能量是实际到账（满了不再加）；伤害、资源含切走后在后台打完的')
  const byChar = new Map<string, Card[]>()
  for (const c of out.cards) byChar.set(c.char, [...(byChar.get(c.char) ?? []), c])
  for (const [char, cs] of byChar) {
    console.log(`\n# ${char}`)
    cs.forEach(printCard)
  }
  const flagged = out.cards.filter(c => c.flags.length)
  if (flagged.length) {
    console.log('\n要看一眼的：')
    for (const c of flagged) console.log(`  ${c.line}：${c.flags.map(f => FLAG_TEXT[f].split('：')[0]).join('；')}`)
  }
  return 0
}

main().then(code => { process.exitCode = code })
