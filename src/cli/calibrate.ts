// src/cli/calibrate.ts —— pnpm calibrate [--md]：校准点总表（docs/calibration/points.yaml，docs/engine-quality-plan.md P4）。
// 每点列仿真值、实测值、差多少；填了实测、超出容差的退出码 1（同 tests/calibration.test.ts）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { CalibrationFileSchema, DEFAULT_TOLERANCE, type CalibrationPoint } from '../data/calibration.schema'
import { loadGameData } from '../data/load'
import { calibrate, type CalibrationResult } from '../engine/calibration'
import { resolveScenario } from '../engine/resolve'
import { simulate } from '../engine/simulate'
import { argsOf, loadScenario } from './format'

export const POINTS = 'docs/calibration/points.yaml'
const COMPARISON_LABEL: Record<CalibrationResult['comparison'], string> = {
  passed: '通过',
  ambiguous: '相容（分支未知）',
  conflicted: '冲突',
  unmatched: '找不到',
  insufficientCondition: '条件不足',
  unassessable: '待测',
}

/** 面板的比例项按百分数显示，生命 / 攻击 / 防御、跳字、时长按原样 */
function fmt(p: CalibrationPoint, x: number): string {
  if (p.kind === 'loop') return `${x.toFixed(2)} 秒`
  if (p.kind === 'panel' && !['生命', '攻击', '防御'].includes(p.item)) return `${(x * 100).toFixed(1)}%`
  return Math.round(x).toLocaleString('en-US')
}

function fmtPct(d: number): string {
  return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)}%`
}

async function main(): Promise<number> {
  const md = argsOf(process.argv.slice(2), []).pos.includes('--md')
  const { points } = CalibrationFileSchema.parse(parse(readFileSync(POINTS, 'utf8')))
  const data = await loadGameData()
  const runs = new Map<string, { r: ReturnType<typeof resolveScenario>; log: ReturnType<typeof simulate>['log'] }>()
  const results = points.map(p => {
    let run = runs.get(p.scenario)
    if (!run) {
      const r = resolveScenario(loadScenario(join('scenarios', p.scenario)), data)
      run = { r, log: simulate(r).log }
      runs.set(p.scenario, run)
    }
    return calibrate(p, run.r, run.log)
  })
  const rows = results.map(x => {
    const p = x.point
    const sim = x.sim ? x.sim.map(v => fmt(p, v)).join(' / ') : x.error!
    const game = p.gameRange
      ? `${fmt(p, p.gameRange[0])} ~ ${fmt(p, p.gameRange[1])}`
      : p.game === null
        ? ''
        : fmt(p, p.game)
    const tolStr = `容差 ${((p.tolerance ?? DEFAULT_TOLERANCE[p.kind]) * 100).toFixed(1)}%`
    let diff = ''
    if (x.branches && p.kind === 'hit' && p.branch === 'unknown' && (p.game !== null || p.gameRange)) {
      diff = `非暴 ${fmtPct(x.branches.nonCrit.diff)} / 暴 ${fmtPct(x.branches.crit.diff)}（${tolStr}）`
    } else if (x.diff !== null) {
      diff = `${fmtPct(x.diff)}（${tolStr}）`
    }
    return [p.id, sim, game, diff, COMPARISON_LABEL[x.comparison]]
  })
  const head = ['点', '仿真（跳字：不暴击 / 暴击）', '实测', '差', '状态']
  if (md) {
    console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`)
    for (const r of rows) console.log(`| ${r.join(' | ')} |`)
  } else for (const r of rows) console.log(r.join('  '))
  const count = (list: readonly CalibrationResult[], c: CalibrationResult['comparison']) =>
    list.filter(x => x.comparison === c).length
  const fmtCounts = (list: readonly CalibrationResult[]) => {
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
  const indep = results.filter(x => x.point.purpose === 'independent_validation')
  const cal = results.filter(x => x.point.purpose !== 'independent_validation')
  if (indep.length > 0) {
    console.log(`\n共 ${results.length} 个点：`)
    console.log(`  校准/参考（${cal.length}）：${fmtCounts(cal)}`)
    console.log(`  独立验证（${indep.length}）：${fmtCounts(indep)}`)
  } else {
    console.log(`\n${results.length} 个点（校准/参考）：${fmtCounts(results)}`)
  }
  return count(results, 'conflicted') + count(results, 'unmatched') > 0 ? 1 : 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
