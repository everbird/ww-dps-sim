// src/analysis/calibration.ts —— 校准点的仿真值与比对（docs/engine-quality-plan.md P4、DD-03 §3–4；点的写法见 src/data/calibration.schema.ts）
// DD-08 §3.2 起是 observations.ts 的薄包装：取值（readObservation）与比较（compareValue）都在那边，这里只把结果换成旧的 CalibrationResult
// （面板、跳字、时长三种；新种类用 compareObservations）。纯函数：给装配结果与事件日志。
import { type CalibrationPoint } from '../data/calibration.schema'
import { compareOne, readObservation, type BranchResidual, type ComparisonStatus } from './observations'
import type { ResolvedScenario, SimEvent } from '../engine'

export type { BranchResidual } from './observations'

export interface CalibrationResult {
  point: CalibrationPoint
  sim: number[] | null                      // null：取不到仿真值（见 error），或是切人类型这种类别（见 category）
  category?: string                         // 切人类型的仿真值（intro / normal）
  error?: string
  matched: number | null                    // 拿来比的那个仿真值（跳字取分支或接近实测的）；没测时 null
  diff: number | null                       // 相对差（区间内为 0，否则按较近端点或点值算）；interval 是帧差
  branches?: { nonCrit: BranchResidual; crit: BranchResidual }  // 仅 hit 有
  comparison: ComparisonStatus
  /** @deprecated 请改读 comparison；保留仅供旧测试与摘要过渡 */
  status: 'ok' | 'off' | 'todo' | 'error'
}

/** 点的仿真值：面板 / 时长一个数；跳字两个（不暴击、暴击）。找不到（名字写错、轮次不够）返回说明。新种类请用 observations.ts 的 readObservation */
export function simValue(p: CalibrationPoint, r: ResolvedScenario, log: readonly SimEvent[]): number[] | string {
  const x = readObservation(p, { resolved: r, log })
  if (!x.ok) return x.reason
  return typeof x.value === 'number' ? [x.value] : typeof x.value === 'string' ? `切人类型是类别（${x.value}），没有数值` : [x.value[0], x.value[1]]
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

/** 一个点对一次运行（DD-03 §4、DD-08 §3.2）：比较交给 observations.ts，这里换成旧字段 */
export function calibrate(p: CalibrationPoint, r: ResolvedScenario, log: readonly SimEvent[]): CalibrationResult {
  const c = compareOne(p, { resolved: r, log })
  const status = statusOf(c.status)
  if (c.sim === null) return { point: p, sim: null, ...(c.reason ? { error: c.reason } : {}), matched: null, diff: null, comparison: c.status, status }
  if (typeof c.sim === 'string') return { point: p, sim: null, category: c.sim, matched: null, diff: c.residual, comparison: c.status, status }
  const sim = [...c.sim]
  if (c.status === 'unassessable' || c.status === 'insufficientCondition') return { point: p, sim, matched: null, diff: null, comparison: c.status, status }
  if (c.branches) {
    const picked = p.kind === 'hit' && (p.branch === 'nonCrit' || p.branch === 'crit') ? c.branches[p.branch] : null
    return { point: p, sim, matched: picked?.sim ?? null, diff: picked?.diff ?? null, branches: c.branches, comparison: c.status, status }
  }
  return { point: p, sim, matched: c.residual === null ? null : sim[0]!, diff: c.residual, comparison: c.status, status }
}
