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
const STATUS: Record<CalibrationResult['status'], string> = { ok: '对上了', off: '超出容差', todo: '待测', error: '取不到' }

/** 面板的比例项按百分数显示，生命 / 攻击 / 防御、跳字、时长按原样 */
function fmt(p: CalibrationPoint, x: number): string {
  if (p.kind === 'loop') return `${x.toFixed(2)} 秒`
  if (p.kind === 'panel' && !['生命', '攻击', '防御'].includes(p.item)) return `${(x * 100).toFixed(1)}%`
  return Math.round(x).toLocaleString('en-US')
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
    const game = p.game === null ? '' : fmt(p, p.game)
    const diff = x.diff === null ? '' : `${x.diff >= 0 ? '+' : ''}${(x.diff * 100).toFixed(2)}%（容差 ${((p.tolerance ?? DEFAULT_TOLERANCE[p.kind]) * 100).toFixed(1)}%）`
    return [p.id, sim, game, diff, STATUS[x.status]]
  })
  const head = ['点', '仿真（跳字：不暴击 / 暴击）', '实测', '差', '状态']
  if (md) {
    console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`)
    for (const r of rows) console.log(`| ${r.join(' | ')} |`)
  } else for (const r of rows) console.log(r.join('  '))
  const n = (s: CalibrationResult['status']) => results.filter(x => x.status === s).length
  console.log(`\n${points.length} 个点：对上了 ${n('ok')}、超出容差 ${n('off')}、待测 ${n('todo')}、取不到 ${n('error')}`)
  return n('off') + n('error') > 0 ? 1 : 0
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
