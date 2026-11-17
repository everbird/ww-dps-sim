// src/report/evidence.ts —— 证据闭环与台账的展示（DD-08 §4.2 的 --md、§7 的显示）：pnpm evidence --md、pnpm assumptions --ledger 共用。
// 结论一律经 concludeFromVerdicts 按决策表重算（DD-08 §4.1：闭环 YAML、总表、台账三处同一个函数），与记录里存的不同就标出来。
// 用词：passed / ambiguous 是"相容"，只有决策表第 4 行的 supported 写"证实（所测条件内）"（DD-08 §10：没有一处把相容写成证实）。
import type { Observation } from '../data/calibration.schema'
import type { CandidateVerdict, ClosureRecord, ConclusionRecord } from '../data/evidence.schema'
import { canonicalJson } from '../engine/digest'
import { concludeFromVerdicts, observationsOf } from '../analysis/evidence'
import type { Conclusion, Proposition } from '../engine/propositions'

/** 命题结论（路线图 §5.1 的七种） */
export const CONCLUSION_LABEL: Record<Conclusion, string> = {
  supported: '证实（所测条件内）', refuted: '否定', ambiguous: '分不清', provisional: '暂定',
  unverified: '未验证', conflicted: '证据冲突', outOfScope: '超出模型',
}
/** 候选级判断 */
export const VERDICT_LABEL: Record<CandidateVerdict['overall'], string> = { consistent: '相容', inconsistent: '不相容', notAssessed: '未评估' }
export const NOT_ASSESSED_LABEL: Record<NonNullable<CandidateVerdict['notAssessedReason']>, string> = {
  unimplemented: '候选未实现', engineError: '引擎错误', noCoveredObservation: '没有覆盖到的观测', allInsufficient: '全部条件不足',
}

const esc = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
const list = (xs: readonly string[] | undefined) => (xs && xs.length ? xs.join('、') : '—')

export interface ClosureSummary {
  readonly record: ClosureRecord
  /** 按决策表重算的结论；还没 judge（没有 verdicts）时为 null */
  readonly conclusion: ConclusionRecord | null
  /** 记录里存的结论与重算的相同（没 judge 的也算相同） */
  readonly consistent: boolean
}

export function summarizeClosure(record: ClosureRecord, p: Proposition | undefined, all: readonly Observation[]): ClosureSummary {
  if (!p || record.verdicts.length === 0) return { record, conclusion: null, consistent: record.conclusion === undefined }
  const conclusion = concludeFromVerdicts(record.verdicts, p.adopted, p.candidatesExhaustive, observationsOf(record, all))
  return { record, conclusion, consistent: canonicalJson(conclusion) === canonicalJson(record.conclusion) }
}

/** 一条结论的文字：标签、所指候选、决策表第几行 */
export const conclusionText = (c: ConclusionRecord): string =>
  `${CONCLUSION_LABEL[c.proposition]}（${c.about ?? '无可评估的候选'}，决策表第 ${c.rule} 行）`

/** docs/evidence/README.md 的总表（pnpm evidence --md） */
export function evidenceTable(rows: readonly ClosureSummary[]): string {
  const out = [
    '## 闭环总表', '',
    '| 闭环 | 命题 | 种类 | 结论 | 各候选 | 依据（独立 / 其他） | 采用决定 | 重跑 | 下一项可区分的观测 |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const { record: r, conclusion, consistent } of rows) {
    const verdicts = r.verdicts.map(v => `${v.candidateId} ${VERDICT_LABEL[v.overall]}${v.notAssessedReason ? `（${NOT_ASSESSED_LABEL[v.notAssessedReason]}）` : ''}`).join('；') || '还没判断'
    const pending = r.kind === 'experiment' ? (r.preRegistration ? `预测已登记（${r.preRegistration.date}），等读数` : '还没登记预测') : '还没判断'
    const c = conclusion ? `${conclusionText(conclusion)}${consistent ? '' : '；**记录里存的与重算的不同，重跑 judge**'}` : pending
    const basis = conclusion ? `${list(conclusion.basis.independent)} / ${list(conclusion.basis.other)}` : '—'
    const decision = r.decision ? `${r.decision.adoptedBefore} → ${r.decision.adopted}${r.decision.defaultChanged ? '（缺省已改）' : '（缺省不变）'}` : '待定'
    const reruns = r.reruns.length ? `${r.reruns.length} 个场景，变了 ${r.reruns.filter(x => x.changed).length} 个` : r.decision ? '没有受影响的场景' : '—'
    out.push(`| [${r.id}](${r.id}.yaml) | ${r.propositionId} | ${r.kind === 'backfill' ? '回填' : '实验'} | ${esc(c)} | ${esc(verdicts)} | ${esc(basis)} | ${esc(decision)} | ${reruns} | ${esc(r.discriminatingObservationNeeded ?? '—')} |`)
  }
  return out.join('\n')
}
