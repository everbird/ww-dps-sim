// src/engine/calibration.ts —— 校准点的仿真值与比对（docs/engine-quality-plan.md P4；点的写法见 src/data/calibration.schema.ts）
// 纯函数：给装配结果与事件日志，取出点对应的仿真值；跳字按"不暴击 / 暴击"里接近实测的那个比
import { DEFAULT_TOLERANCE, type CalibrationPoint } from '../data/calibration.schema'
import { loopSpan, tracePanel, traceHits } from './trace'
import type { ResolvedScenario, SimEvent } from './types'

/** 点的仿真值：面板 / 时长一个数；跳字两个（不暴击、暴击）。找不到（名字写错、轮次不够）返回说明 */
export function simValue(p: CalibrationPoint, r: ResolvedScenario, log: readonly SimEvent[]): number[] | string {
  switch (p.kind) {
    case 'panel': {
      const row = tracePanel(r, p.char).find(x => x.item === p.item)
      return row ? [row.value] : `${p.char} 的面板里没有"${p.item}"（pnpm trace <场景> 的面板表）`
    }
    case 'hit': {
      const rows = traceHits(log, p.loop, p.char).filter(x => x.judgment === p.judgment)
      const row = rows[p.nth - 1]
      return row ? [row.nonCrit, row.crit] : `第 ${p.loop} 轮 ${p.char} 的"${p.judgment}"只有 ${rows.length} 下`
    }
    case 'loop': {
      const span = loopSpan(log, p.loop)
      return span ? [span.endT - span.t] : `没有第 ${p.loop} 轮`
    }
  }
}

export interface CalibrationResult {
  point: CalibrationPoint
  sim: number[] | null                      // null：取不到仿真值（见 error）
  error?: string
  matched: number | null                    // 拿来比的那个仿真值（跳字取接近实测的）；没测时 null
  diff: number | null                       // 相对差（仿真 / 实测 − 1）
  status: 'ok' | 'off' | 'todo' | 'error'   // 对上了 / 超出容差 / 还没测 / 取不到
}

export function calibrate(p: CalibrationPoint, r: ResolvedScenario, log: readonly SimEvent[]): CalibrationResult {
  const sim = simValue(p, r, log)
  if (typeof sim === 'string') return { point: p, sim: null, error: sim, matched: null, diff: null, status: 'error' }
  if (p.game === null) return { point: p, sim, matched: null, diff: null, status: 'todo' }
  const game = p.game
  const matched = sim.reduce((best, x) => (Math.abs(x - game) < Math.abs(best - game) ? x : best))
  const diff = game !== 0 ? matched / game - 1 : matched - game
  const tol = p.tolerance ?? DEFAULT_TOLERANCE[p.kind]
  return { point: p, sim, matched, diff, status: Math.abs(diff) <= tol ? 'ok' : 'off' }
}
