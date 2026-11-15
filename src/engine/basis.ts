// src/engine/basis.ts —— 比较口径（Basis）、可用性闸门（usableBasis，DD-03 §7.1）与伤害口径差异（DamageScope，DD-03 §7.4）
// 纯函数，属于核心汇总层（CORE），供 analysis / scorecard / search / plan / insight / matrix / cli / web 共用。
import type { DamageScope, RunCompletion, RunStatus } from './run-types'
import type { SimResult } from './types'

export type { DamageScope } from './run-types'

export interface Basis {
  label: string
  lo: number
  hi: number
  damage: number
  dps: number
  spread: number
  scope: DamageScope
  lethal?: { eventSeq: number; overflow: number }
}

export type BasisStatus = RunStatus

export type BasisResult =
  | { readonly ok: true; readonly basis: Basis }
  | { readonly ok: false; readonly status: RunStatus; readonly reason: string; readonly partial?: Basis }

const DEFAULT_SCOPE: DamageScope = { tuneBreak: { mode: 'omitted', reason: 'undeclared', gauge: 'accumulates' } }

/** 取出本结果的对比口径（不校验是否完整可用；调用方要做结论或比较请用 usableBasis） */
export function basisOf(res: SimResult): Basis {
  const s = res.summary
  const scope = res.damageScope ?? DEFAULT_SCOPE
  if (s.goal) {
    return {
      label: s.goal.label,
      lo: s.goal.lo,
      hi: s.goal.hi,
      damage: s.goal.damage,
      dps: s.goal.dps,
      spread: 0,
      scope,
      ...(s.goal.lethal ? { lethal: { eventSeq: s.goal.lethal.eventSeq, overflow: s.goal.lethal.overflow } } : {}),
    }
  }
  const st = s.steady
  if (st && s.perLoop) {
    const lo = s.perLoop.find(p => p.loop === st.from)!.start
    const label = `稳态（第 ${st.from}${st.to > st.from ? `–${st.to}` : ''} 轮）`
    return { label, lo, hi: lo + st.frames, damage: st.damage, dps: st.dps, spread: st.spread, scope }
  }
  return { label: '整个窗口', lo: 0, hi: s.windowFrames, damage: s.totalDamage, dps: s.dps, spread: 0, scope }
}

function completionReason(c: RunCompletion, res: SimResult): string {
  if (res.error) return `${res.error.code}：${res.error.message}`
  if (c.engineError) return `${c.engineError.code}：${c.engineError.message}`
  if (c.axisFailure) {
    const f = c.axisFailure
    const kind = f.kind === 'intentUnmet' && f.unmetIntent ? f.unmetIntent.kind : f.kind
    return `${kind}：${f.detail}`
  }
  return `运行未完成（${c.status}）`
}

function truncationRemainsText(c: RunCompletion): string {
  const t = c.truncation
  if (!t) return ''
  return t.kind === 'commandsPending'
    ? `还有 ${t.remains.pendingCommands} 条指令没执行`
    : '指令发完了，场上还有没走完的判定'
}

/** 校验本次仿真的比较口径能不能当结论用（DD-03 §7.1）：
 *  - engineError：ok: false，无 partial
 *  - axisFailed：ok: false，带 partial 供排错
 *  - completed / truncated + goal：达到则 ok: true；未达到时 completed 用估计值（ok: true），truncated 返回 ok: false 带 remains
 *  - completed / truncated + steady：稳态选中每一轮必须 r <= completed 且 roundEnds.endBattleFrame <= windowFrames
 *  - 无 steady 时：completed 允许整个窗口，truncated 返回 ok: false */
export function usableBasis(res: SimResult, _policy?: string): BasisResult {
  const c = res.completion
  const s = res.summary
  const b = basisOf(res)

  if (c.status === 'engineError') {
    return { ok: false, status: 'engineError', reason: completionReason(c, res) }
  }
  if (c.status === 'axisFailed') {
    return { ok: false, status: 'axisFailed', reason: completionReason(c, res), partial: b }
  }

  if (s.goal) {
    if (!s.goal.reached && c.status === 'truncated') {
      const rem = truncationRemainsText(c)
      return {
        ok: false,
        status: 'truncated',
        reason: `到帧数上限时目标还没达到${rem ? `：${rem}` : ''}`,
        partial: b,
      }
    }
    if (b.hi - b.lo <= 0) {
      return { ok: false, status: c.status, reason: '目标窗口时长为 0 帧，无法计算 DPS', partial: b }
    }
    return { ok: true, basis: b }
  }

  if (s.steady) {
    for (let r = s.steady.from; r <= s.steady.to; r++) {
      if (r > c.loops.completed) {
        return {
          ok: false,
          status: c.status,
          reason: `稳态第 ${r} 轮执行未完整完成（已完 ${c.loops.completed} 轮）`,
          partial: b,
        }
      }
      const endF = c.loops.roundEnds.find(x => x.loop === r)?.endBattleFrame
      if (endF === undefined || endF > s.windowFrames) {
        return {
          ok: false,
          status: c.status,
          reason: `稳态第 ${r} 轮统计被截断（真实结束帧 ${endF ?? '未记录'}，统计窗口终点 ${s.windowFrames}）`,
          partial: b,
        }
      }
    }
    if (b.hi - b.lo <= 0) {
      return { ok: false, status: c.status, reason: '稳态窗口时长为 0 帧，无法计算 DPS', partial: b }
    }
    return { ok: true, basis: b }
  }

  if (c.status === 'truncated') {
    const rem = truncationRemainsText(c)
    return {
      ok: false,
      status: 'truncated',
      reason: `整个窗口被截断${rem ? `（${rem}）` : ''}`,
      partial: b,
    }
  }
  if (b.hi - b.lo <= 0) {
    return { ok: false, status: 'completed', reason: '窗口时长为 0 帧，无法计算 DPS', partial: b }
  }
  return { ok: true, basis: b }
}

// ---------------------------------------------------------------------------
// DamageScope 工具（DD-03 §7.4）
// ---------------------------------------------------------------------------

export function sameDamageScope(a: DamageScope, b: DamageScope): boolean {
  const ta = a.tuneBreak, tb = b.tuneBreak
  if (ta.mode !== tb.mode) return false
  if (ta.mode === 'omitted' && tb.mode === 'omitted') return ta.gauge === tb.gauge
  return true
}

export function scopeDiffersIn(a: DamageScope, b: DamageScope): ('mode' | 'gauge')[] {
  const ta = a.tuneBreak, tb = b.tuneBreak
  const differs: ('mode' | 'gauge')[] = []
  if (ta.mode !== tb.mode) differs.push('mode')
  const ga = ta.mode === 'omitted' ? ta.gauge : 'active'
  const gb = tb.mode === 'omitted' ? tb.gauge : 'active'
  if (ga !== gb && (ta.mode === 'omitted' && tb.mode === 'omitted')) differs.push('gauge')
  else if (ta.mode !== tb.mode && ((ta.mode === 'omitted' && ta.gauge === 'off') || (tb.mode === 'omitted' && tb.gauge === 'off'))) {
    differs.push('gauge')
  }
  return differs
}

export function scopeShortLabel(scope: DamageScope): string {
  const tb = scope.tuneBreak
  switch (tb.mode) {
    case 'written': return '含'
    case 'auto': return '自动'
    case 'writtenPlusAuto': return '含+自动'
    case 'omitted': return tb.gauge === 'accumulates' ? '未含·量表累积' : '未含'
  }
}

export function scopeReasonLabel(reason: Extract<DamageScope['tuneBreak'], { mode: 'omitted' }>['reason']): string {
  switch (reason) {
    case 'sourceSilent': return '来源未写谐度破坏'
    case 'notInGame': return '实战不触发谐度破坏'
    case 'deliberate': return '有意不计谐度破坏'
    case 'undeclared': return '未声明谐度破坏策略'
    case 'disabledByOption': return 'options.tuneBreak=off 关闭'
  }
}

export function scopeNoteForRun(res: SimResult, customNote?: string): string | null {
  const tb = res.damageScope.tuneBreak
  if (tb.mode !== 'omitted') return null
  const gaugeText = tb.gauge === 'accumulates' ? '偏谐量表仍累积' : '偏谐量表已关闭'
  const extra = customNote ? `；${customNote}` : ''
  return `口径提示：本结果 DPS 未含谐度破坏伤害（${scopeReasonLabel(tb.reason)}；${gaugeText}${extra}）`
}

export interface ScopeMismatch {
  base: DamageScope
  other: DamageScope
  differsIn: readonly ('mode' | 'gauge')[]
  note: string
}

export function scopeMismatchOf(base: DamageScope, other: DamageScope): ScopeMismatch | undefined {
  if (sameDamageScope(base, other)) return undefined
  const differsIn = scopeDiffersIn(base, other)
  return {
    base,
    other,
    differsIn,
    note: `口径提醒：基准"${scopeShortLabel(base)}"与对比"${scopeShortLabel(other)}"谐度破坏口径不一致（${differsIn.join(' / ')}），不可直接按 DPS 混比`,
  }
}
