// src/engine/calibration.ts —— 校准点的仿真值与比对（docs/engine-quality-plan.md P4、DD-03 §3–4；点的写法见 src/data/calibration.schema.ts）
// 纯函数：给装配结果与事件日志，取出点对应的仿真值；区分战斗/世界时钟、区间目标与跳字分支
import { DEFAULT_TOLERANCE, type CalibrationPoint } from '../data/calibration.schema'
import type { ComparisonStatus } from './observations'
import { loopSpan, tracePanel, traceHits } from './trace'
import type { ResolvedScenario, SimEvent } from './types'

export interface BranchResidual {
  sim: number
  diff: number
  within: boolean
}

export interface CalibrationResult {
  point: CalibrationPoint
  sim: number[] | null                      // null：取不到仿真值（见 error）
  error?: string
  matched: number | null                    // 拿来比的那个仿真值（跳字取分支或接近实测的）；没测时 null
  diff: number | null                       // 相对差（区间内为 0，否则按较近端点或点值算）
  branches?: { nonCrit: BranchResidual; crit: BranchResidual }  // 仅 hit 有
  comparison: ComparisonStatus
  /** @deprecated 请改读 comparison；保留仅供旧测试与摘要过渡 */
  status: 'ok' | 'off' | 'todo' | 'error'
}

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
      if (!span) return `没有第 ${p.loop} 轮`
      // DD-03 §3：显式区分战斗时钟（受全局时停影响）与世界时钟（60fps 墙钟帧/60）
      return [p.clock === 'world' ? (span.endF - span.f) / 60 : span.endT - span.t]
    }
  }
}

function relDiff(sim: number, target: number): number {
  return target !== 0 ? sim / target - 1 : sim - target
}

function residualOf(sim: number, p: CalibrationPoint, tol: number): BranchResidual {
  if (p.game !== null) {
    const diff = relDiff(sim, p.game)
    return { sim, diff, within: Math.abs(diff) <= tol }
  }
  const [lo, hi] = p.gameRange!
  if (sim >= lo && sim <= hi) return { sim, diff: 0, within: true }
  const diff = sim < lo ? relDiff(sim, lo) : relDiff(sim, hi)
  return { sim, diff, within: Math.abs(diff) <= tol }
}

function statusOf(c: ComparisonStatus): CalibrationResult['status'] {
  switch (c) {
    case 'passed':
    case 'ambiguous':
      return 'ok'
    case 'conflicted':
    case 'insufficientCondition':
      return 'off'
    case 'unassessable':
      return 'todo'
    case 'unmatched':
      return 'error'
  }
}

export function calibrate(p: CalibrationPoint, r: ResolvedScenario, log: readonly SimEvent[]): CalibrationResult {
  const sim = simValue(p, r, log)
  if (typeof sim === 'string') {
    return { point: p, sim: null, error: sim, matched: null, diff: null, comparison: 'unmatched', status: 'error' }
  }
  if (p.game === null && !p.gameRange) {
    return { point: p, sim, matched: null, diff: null, comparison: 'unassessable', status: 'todo' }
  }
  const tol = p.tolerance ?? DEFAULT_TOLERANCE[p.kind]
  if (p.kind === 'hit') {
    const nonCrit = residualOf(sim[0]!, p, tol)
    const crit = residualOf(sim[1]!, p, tol)
    const branches = { nonCrit, crit }
    if (p.branch === 'nonCrit' || p.branch === 'crit') {
      const picked = branches[p.branch]
      const comparison: ComparisonStatus = picked.within ? 'passed' : 'conflicted'
      return { point: p, sim, matched: picked.sim, diff: picked.diff, branches, comparison, status: statusOf(comparison) }
    }
    const comparison: ComparisonStatus = nonCrit.within || crit.within ? 'ambiguous' : 'conflicted'
    return { point: p, sim, matched: null, diff: null, branches, comparison, status: statusOf(comparison) }
  }
  const single = residualOf(sim[0]!, p, tol)
  const comparison: ComparisonStatus = single.within ? 'passed' : 'conflicted'
  return { point: p, sim, matched: single.sim, diff: single.diff, comparison, status: statusOf(comparison) }
}
