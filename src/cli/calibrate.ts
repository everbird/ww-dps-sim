// src/cli/calibrate.ts —— pnpm calibrate [--md]：观测（校准点）总表（docs/calibration/points.yaml，docs/engine-quality-plan.md P4、DD-08 §3）。
// 每条列仿真值、实测值、差多少；填了实测、冲突或找不到的退出码 1（同 tests/calibration.test.ts）。
// DD-08 §3.2：按场景各跑一次（prepareRun → runPrepared，带运行身份），比较交给 compareObservations；末尾列每个场景的 runId。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { CalibrationFileSchema, toleranceOf, type CalibrationPoint } from '../data/calibration.schema'
import { loadGameData } from '../data/load'
import { compareObservations, type ObservationComparison } from '../analysis/observations'
import { prepareRun, runPrepared } from '../engine/run'
import { argsOf, loadScenario } from './format'
import { collectRunEnvironment } from './run-env'

export const POINTS = 'docs/calibration/points.yaml'
const COMPARISON_LABEL: Record<ObservationComparison['status'], string> = {
  passed: '通过',
  ambiguous: '相容（分支未知）',
  conflicted: '冲突',
  unmatched: '找不到',
  insufficientCondition: '条件不足',
  unassessable: '待测',
}
const SWITCH_LABEL: Record<string, string> = { intro: '变奏', normal: '普通' }

/** 面板的比例项按百分数显示，生命 / 攻击 / 防御、跳字、时长按原样；间隔按观测的单位；资源按值或比例 */
function fmt(p: CalibrationPoint, x: number): string {
  if (p.kind === 'loop') return `${x.toFixed(2)} 秒`
  if (p.kind === 'panel' && !['生命', '攻击', '防御'].includes(p.item)) return `${(x * 100).toFixed(1)}%`
  if (p.kind === 'interval') return p.unit === 'seconds' ? `${x.toFixed(3)} 秒` : `${Math.round(x * 100) / 100} 帧`
  if (p.kind === 'resourceAt') return p.as === 'ratio' ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100) / 100}`
  return Math.round(x).toLocaleString('en-US')
}

function fmtPct(d: number): string {
  return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)}%`
}

function gameText(p: CalibrationPoint): string {
  if (p.kind === 'switchType') return p.expect === null ? '' : SWITCH_LABEL[p.expect]!
  return p.gameRange ? `${fmt(p, p.gameRange[0])} ~ ${fmt(p, p.gameRange[1])}` : p.game === null ? '' : fmt(p, p.game)
}

function diffText(p: CalibrationPoint, x: ObservationComparison): string {
  const measured = p.kind === 'switchType' ? p.expect !== null : p.game !== null || p.gameRange !== undefined
  if (p.kind === 'interval') {
    const tol = `容差 ±${toleranceOf(p)} 帧`
    return x.residual !== null ? `${x.residual >= 0 ? '+' : ''}${x.residual} 帧（${tol}）` : x.status === 'ambiguous' ? `${x.reason}（${tol}）` : ''
  }
  if (p.kind === 'switchType') return x.residual === null ? '' : x.residual === 0 ? '相同' : '不同'
  const tolStr = `容差 ${(toleranceOf(p) * 100).toFixed(1)}%`
  if (x.branches && p.kind === 'hit' && p.branch === 'unknown' && measured) {
    return `非暴 ${fmtPct(x.branches.nonCrit.diff)} / 暴 ${fmtPct(x.branches.crit.diff)}（${tolStr}）`
  }
  if (x.residual !== null && x.status !== 'unassessable' && x.status !== 'insufficientCondition') return `${fmtPct(x.residual)}（${tolStr}）`
  if (x.status === 'ambiguous' && x.reason) return `${x.reason}（${tolStr}）`
  return ''
}

async function main(): Promise<number> {
  const md = argsOf(process.argv.slice(2), []).pos.includes('--md')
  const { points } = CalibrationFileSchema.parse(parse(readFileSync(POINTS, 'utf8')))
  const data = await loadGameData()
  const environment = collectRunEnvironment()
  // 按场景各跑一次（DD-08 §3.2）：同一场景的观测一起比
  const byScenario = new Map<string, CalibrationPoint[]>()
  for (const p of points) byScenario.set(p.scenario, [...(byScenario.get(p.scenario) ?? []), p])
  const results = new Map<string, ObservationComparison>()
  const runs: string[] = []
  for (const [scenario, list] of byScenario) {
    const prep = prepareRun(loadScenario(join('scenarios', scenario)), data, { environment })
    if (!prep.ok) throw new Error(`${scenario}：${prep.issues.map(i => i.message).join('；')}`)
    const res = runPrepared(prep.run)
    for (const c of compareObservations(prep.run, res, list).data) results.set(c.observationId, c)
    runs.push(`${scenario} ${res.runId}（${res.completion.status}）`)
  }
  const ordered = points.map(p => ({ p, x: results.get(p.id)! }))
  const rows = ordered.map(({ p, x }) => {
    const sim = x.sim === null ? x.reason! : typeof x.sim === 'string' ? SWITCH_LABEL[x.sim] ?? x.sim : x.sim.map(v => fmt(p, v)).join(' / ')
    return [p.id, sim, gameText(p), diffText(p, x), COMPARISON_LABEL[x.status]]
  })
  const head = ['点', '仿真（跳字：不暴击 / 暴击）', '实测', '差', '状态']
  if (md) {
    console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`)
    for (const r of rows) console.log(`| ${r.join(' | ')} |`)
  } else for (const r of rows) console.log(r.join('  '))
  type Row = (typeof ordered)[number]
  const count = (list: readonly Row[], c: ObservationComparison['status']) => list.filter(({ x }) => x.status === c).length
  const fmtCounts = (list: readonly Row[]) => {
    const parts = [
      `通过 ${count(list, 'passed')}`,
      `相容（分支未知） ${count(list, 'ambiguous')}`,
      `冲突 ${count(list, 'conflicted')}`,
      `找不到 ${count(list, 'unmatched')}`,
      `待测 ${count(list, 'unassessable')}`,
    ]
    const insuff = count(list, 'insufficientCondition')
    if (insuff > 0) parts.push(`条件不足 ${insuff}`)
    return parts.join('、')
  }
  const indep = ordered.filter(({ p }) => p.purpose === 'independent_validation')
  const cal = ordered.filter(({ p }) => p.purpose !== 'independent_validation')
  if (indep.length > 0) {
    console.log(`\n共 ${ordered.length} 个点：`)
    console.log(`  校准/参考（${cal.length}）：${fmtCounts(cal)}`)
    console.log(`  独立验证（${indep.length}）：${fmtCounts(indep)}`)
  } else {
    console.log(`\n${ordered.length} 个点（校准/参考）：${fmtCounts(ordered)}`)
  }
  // 仿真列带身份（DD-08 §6、docs/calibration/README.md）：每个场景这次跑的 runId 与完成状态
  console.log(`\n运行（提交 ${environment.gitCommit.slice(0, 12)}${environment.contentFingerprint ? '，工作区有改动' : ''}）：`)
  for (const r of runs) console.log(`  ${r}`)
  return count(ordered, 'conflicted') + count(ordered, 'unmatched') > 0 ? 1 : 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
