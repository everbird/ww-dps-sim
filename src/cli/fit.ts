// src/cli/fit.ts —— pnpm fit：录像剖析的贴合度（src/engine/fit.ts，DD-09 §4）。
//   pnpm fit 场景.yaml [--n 60] [--near 4] [--top 15] [--fill <组合名>] [--json 报告.json] [--common-subset] [--no-rules] [--no-axis]
//   pnpm fit --compare a.json b.json      两份报告并排（评分定义或观测内容不同的拒绝，C09-14）
// 原场景、规则候选（翻台账里的候选）、改轴候选（轴里读到的动作去掉 / 挪到附近 / 对调）逐个按"和录像差多少"打分——不是比 DPS。
// 先资格后排序：只在资格签名相同的组里按 score 排，跨组只列覆盖与冲突的差别。比原场景更贴合的改法是线索：要回录像里核对，不要直接改场景。
// 有几个填法组合（未观测时段的几种填法）时，各组合分别跑、分别报告（不当上下界）；改轴与规则候选要先用 --fill 选定一个组合。
import { readFileSync, writeFileSync } from 'node:fs'
import { fillCombos, narrowReplay } from '../data/replay'
import { loadGameData } from '../data/load'
import {
  comparableReports, commonSubset, fitCombos, fitVariants,
  type FitReport, type FitResult, type FitRow, type FitTable,
} from '../analysis/fit'
import type { Channel } from '../analysis/observations'
import { argsOf, loadScenario } from './format'
import { collectRunEnvironment } from './run-env'

const USAGE = 'pnpm fit 场景.yaml [--n 60] [--near 4] [--top 15] [--fill <组合名>] [--json 报告.json] [--common-subset] [--no-rules] [--no-axis]；或 pnpm fit --compare a.json b.json'

const CH: Record<Channel, string> = { switch: '切人', action: '前台动作', summon: '后台来源', hit: '跳字', hp: '血条', concerto: '协奏环', core: '回路条' }
const unit = (c: Channel, v: number) => (c === 'switch' || c === 'action' || c === 'summon' ? `${v.toFixed(2)} 秒` : `${(v * 100).toFixed(c === 'hit' ? 2 : 1)}%`)

/** 一次运行的一行摘要：各通道的匹配情况与残差 */
function fitLine(f: FitResult): string {
  const parts: string[] = []
  const chs = [...new Set(f.observations.filter(o => o.scored).map(o => o.channel))]
  for (const c of chs) {
    const os = f.observations.filter(o => o.scored && o.channel === c)
    const n = (s: string) => os.filter(o => o.status === s).length
    const r = f.residualByChannel[c]
    const odd = [['冲突', n('conflicted')], ['歧义', n('ambiguous')], ['落单', n('unmatched')], ['没覆盖', n('uncovered')]].filter(([, k]) => k).map(([s, k]) => `${s} ${k}`)
    parts.push(`${CH[c]} ${n('matched')}/${os.length}${odd.length ? `（${odd.join('、')}）` : ''}${r ? ` 平均差 ${unit(c, r.mae)}` : ''}`)
  }
  return parts.join('；')
}

function describeBase(f: FitResult, rep?: FitReport): string[] {
  const e = f.eligibility
  const out = [
    `  完成状态 ${f.completion.status}${f.fillCombo ? ` · 填法组合 ${f.fillCombo}` : ''}；锚点对上 ${f.anchors} 个`,
    `  ${fitLine(f)}`,
    `  资格签名 ${e.signature}：${e.hasQualitativeConflict ? '有定性冲突' : '没有定性冲突'}、评分观测匹配上 ${e.matchedScoreIds.length} 条、覆盖 ${e.channelsCovered.map(c => CH[c]).join('、') || '无'}、窗口${e.windowComplete ? '完整' : '不完整'}`,
    `  score ${f.score === null ? '—（不可评估）' : f.score.toFixed(3)}（只在同一签名的组里可比，没有概率意义）`,
  ]
  if (f.earliestDeviation) {
    const o = f.observations.find(x => x.id === f.earliestDeviation!.observationId)!
    out.push(`  最早检测到的偏差：视频 ${o.t.toFixed(2)} 秒 ${o.id}（${CH[o.channel]}，${o.status}${o.conflict ? `，${o.conflict}` : o.residual !== undefined ? `，差 ${unit(o.channel, o.residual)}` : ''}）——只是最早检测到的，不保证此前的隐藏状态都对`)
  }
  const conflicts = f.observations.filter(o => o.scored && o.status === 'conflicted')
  if (conflicts.length) out.push(`  定性冲突 ${conflicts.length} 条：${conflicts.slice(0, 6).map(o => `${o.id} ${o.conflict}`).join('；')}${conflicts.length > 6 ? '…' : ''}`)
  if (f.conditionedFrom !== null)
    out.push(`  有条件推演：从视频 ${f.conditionedFrom.toFixed(2)} 秒（第一次外部干预）起。同步补上的是读数那一刻的值，恢复不了隐藏的历史（什么时候到的满、内置冷却的时刻、因为没满而没触发的效果）；差额不等于机制缺口`)
  if (rep?.switchReference === 'scenario') out.push('  切人类型的参照来自原场景的写法（变奏 / 普通），不是录像读数：场景还没写 video.switches')
  return out
}

function printTable(title: string, t: FitTable, top: number, def: FitReport['scoreDef'], base: FitResult, commonSub: boolean): void {
  console.log(`\n${title}：${t.groups.reduce((n, g) => n + g.rows.filter(x => x.kind !== 'base').length, 0)} 条分进 ${t.groups.length} 组；不可评估 ${t.unassessable.length}、引擎错误 ${t.engineErrors.filter(x => x.kind !== 'base').length}、没跑起来 ${t.notRun.length}`)
  t.groups.forEach((g, gi) => {
    const isBase = g.rows.some(x => x.kind === 'base')
    const e = g.eligibility
    const head = isBase ? '与原场景同一组（可以按 score 比）' : `第 ${gi + 1} 组（与原场景不可比，只列差别）`
    console.log(`  ${head}：签名 ${g.signature}，${e.hasQualitativeConflict ? '有冲突' : '无冲突'}、匹配 ${e.matchedScoreIds.length}、窗口${e.windowComplete ? '完整' : '不完整'}`)
    if (!isBase && g.versusBase) {
      const v = g.versusBase
      if (v.moreMatched.length) console.log(`    比原场景多匹配：${v.moreMatched.slice(0, 8).join('、')}${v.moreMatched.length > 8 ? '…' : ''}`)
      if (v.lessMatched.length) console.log(`    比原场景少匹配：${v.lessMatched.slice(0, 8).join('、')}${v.lessMatched.length > 8 ? '…' : ''}`)
      if (v.conflicts.length) console.log(`    冲突：${v.conflicts.slice(0, 4).join('；')}${v.conflicts.length > 4 ? '…' : ''}`)
    }
    const rows = g.rows.filter(x => x.kind !== 'base').slice(0, top)
    for (const x of rows) {
      const f = x.fit!
      const d = isBase && base.score !== null ? `（${f.score! - base.score >= 0 ? '+' : ''}${(f.score! - base.score).toFixed(3)}）` : ''
      console.log(`    ${f.score!.toFixed(3)}${d} ${x.desc}`)
      if (commonSub && !isBase) {
        const c = commonSubset(base, f, def)
        console.log(`      共有子集 ${c.ids.length} 条：原场景 ${c.scoreA.toFixed(3)}、这一条 ${c.scoreB.toFixed(3)}；原场景另有 ${c.excludedA.length} 条、这一条另有 ${c.excludedB.length} 条没算（${c.note}）`)
      }
    }
    if (g.rows.filter(x => x.kind !== 'base').length > rows.length) console.log(`    …另 ${g.rows.length - 1 - rows.length} 条`)
  })
  const errs = t.engineErrors.filter(x => x.kind !== 'base')
  if (errs.length) console.log(`  引擎错误（不进任何组、没有名次）：${errs.map(x => `${x.desc}：${x.fit!.completion.engineError?.message ?? ''}`).join('；')}`)
  if (t.notRun.length) console.log(`  没跑起来：${t.notRun.slice(0, 5).map((x: FitRow) => `${x.desc}：${x.error}`).join('；')}${t.notRun.length > 5 ? '…' : ''}`)
}

async function compare(a: string, b: string): Promise<number> {
  const A = JSON.parse(readFileSync(a, 'utf8')) as FitReport, B = JSON.parse(readFileSync(b, 'utf8')) as FitReport
  const c = comparableReports(A, B)
  if (!c.ok) { console.error(`不能并排比较：${c.reason}`); return 1 }
  console.log(`两份报告的评分定义与观测内容相同（${A.identity.scoreDefDigest.slice(0, 12)} / ${A.identity.observationSetDigest.slice(0, 12)}）`)
  console.log(`${a}：`); for (const l of describeBase(A.base, A)) console.log(l)
  console.log(`${b}：`); for (const l of describeBase(B.base, B)) console.log(l)
  if (A.base.eligibility.signature !== B.base.eligibility.signature) console.log('两份报告的原场景资格签名不同：不按 score 排先后')
  return 0
}

async function main(): Promise<number> {
  const raw = process.argv.slice(2)
  const flag = (f: string) => raw.includes(f)
  const argv = raw.filter(a => !['--common-subset', '--no-rules', '--no-axis'].includes(a))
  if (argv[0] === '--compare') {
    if (argv.length !== 3) { console.error(USAGE); return 2 }
    return compare(argv[1]!, argv[2]!)
  }
  const { pos, opt } = argsOf(argv, ['--n', '--near', '--top', '--fill', '--json'])
  if (pos.length !== 1) { console.error(USAGE); return 2 }
  const sc = loadScenario(pos[0]!)
  const data = await loadGameData()
  const environment = collectRunEnvironment()
  const combos = fillCombos(sc)
  if (combos.length > 1 && opt.fill === undefined) {
    console.log(`${pos[0]}：${combos.length} 个填法组合，各跑一次原场景、分别报告（不当上下界：真实情况可以落在它们之外）`)
    for (const c of fitCombos(sc, data, undefined, { environment })) {
      console.log(`组合 ${c.name}：`)
      if (!c.fit) { console.log(`  跑不起来：${c.error}`); continue }
      for (const l of describeBase(c.fit)) console.log(l)
    }
    console.log('\n要看规则候选与改轴候选，用 --fill <组合名> 选定一个组合')
    return 0
  }
  const picked = combos.length === 1 ? narrowReplay(sc, combos[0]!.picks) : (() => {
    const c = combos.find(x => x.name === opt.fill)
    if (!c) throw new Error(`没有填法组合"${opt.fill}"（有：${combos.map(x => x.name).join('、')}）`)
    return narrowReplay(sc, c.picks)
  })()
  const t = Date.now()
  const rep = fitVariants(picked, data, {
    n: Number(opt.n ?? 60), near: Number(opt.near ?? 4), overrides: { environment },
    rules: !flag('--no-rules'), axis: !flag('--no-axis'), fillCombo: combos.length === 1 ? combos[0]!.name : opt.fill!,
  })
  console.log(`${pos[0]}：原场景${rep.scenario.fillCombo ? `（填法组合 ${rep.scenario.fillCombo}）` : ''}`)
  for (const l of describeBase(rep.base, rep)) console.log(l)
  console.log(`  报告身份 ${rep.identity.digest.slice(0, 16)}（评分定义 ${rep.identity.scoreDefDigest.slice(0, 12)}、观测内容 ${rep.identity.observationSetDigest.slice(0, 12)}、${rep.identity.runIds.length} 次运行）；评分定义或观测内容不同的报告不能互相比`)
  const top = Number(opt.top ?? 15)
  printTable('规则候选（翻台账里的候选）', rep.ruleCandidates, top, rep.scoreDef, rep.base, flag('--common-subset'))
  if (rep.ruleNotRun.length) console.log(`  没跑的规则候选 ${rep.ruleNotRun.length} 条：${rep.ruleNotRun.slice(0, 6).map(x => `${x.ref.propositionId}/${x.ref.candidateId}（${x.reason}）`).join('；')}${rep.ruleNotRun.length > 6 ? '…' : ''}`)
  printTable(`改轴候选（${rep.axisCandidates} 条里等距取 ${opt.n ?? 60} 条）`, rep.axisVariants, top, rep.scoreDef, rep.base, flag('--common-subset'))
  console.log(`\n${((Date.now() - t) / 1000).toFixed(1)} 秒。分数只在同一组里排先后；"更贴合"是线索，不等于机制对——要回录像里核对`)
  if (opt.json) { writeFileSync(opt.json, JSON.stringify(rep, null, 1)); console.log(`报告写到 ${opt.json}`) }
  return 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
