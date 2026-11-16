// src/data/evidence.schema.ts —— 闭环记录（DD-08 §4.1）：一条闭环一个文件 docs/evidence/<闭环 ID>.yaml，
// "候选 → 条件化预测 → 观测及误差范围 → 判断 → 采用决定 → 受影响场景重跑"（路线图 §9.1 第 4 条）。
// 字段分三块，各由一方写：人写的（问题、setup、候选的条件、判据、观测 ID、范围、采用决定、备注）；
// pnpm evidence predict / register 写的（runs、predictions、preRegistration）；judge 写的（verdicts、conclusion）；rerun 写的（reruns）。
// 三个子命令都只写自己负责的字段，重复运行结果不变（DD-08 §4.2）。
import { z } from 'zod'

export const RUN_STATUSES = ['completed', 'truncated', 'axisFailed', 'engineError'] as const
export const COMPARISON_STATUSES = ['passed', 'conflicted', 'unmatched', 'ambiguous', 'insufficientCondition', 'unassessable'] as const
export const EVIDENCE_PURPOSES = ['given', 'formulation', 'selection', 'independent_validation', 'unspecified'] as const
export const CONCLUSIONS = ['supported', 'refuted', 'ambiguous', 'provisional', 'unverified', 'conflicted', 'outOfScope'] as const
export const NOT_ASSESSED_REASONS = ['unimplemented', 'engineError', 'noCoveredObservation', 'allInsufficient'] as const

const Text = z.string().min(1)
/** 预测值：数、[不暴击, 暴击]、类别，取不到为 null（DD-08 §4.1；与 observations.ts 的 Predicted 相同） */
export const PredictedSchema = z.union([z.number(), z.tuple([z.number(), z.number()]), z.string(), z.null()])

const RunRefSchema = z.strictObject({
  setupId: Text,
  runId: Text,
  status: z.enum(RUN_STATUSES),
  detail: z.string().optional(),                       // 不是 completed 时：轴在哪条意图上失败、截断在哪、引擎错误的消息
})

const PredictionSchema = z.strictObject({
  observationId: Text,
  predicted: PredictedSchema,
  /** 观测在不在这个候选运行的覆盖范围里（DF-16）：运行提前停了、事件还没发生 = false；跑完了还取不到 = true（多半是选择器写错） */
  covered: z.boolean().default(true),
  reason: z.string().optional(),                       // predicted 为 null 时：为什么取不到
  alternatives: z.array(z.number()).optional(),        // 同一帧有几条分不清的事件时，另几条的值（只有数）
  manual: z.literal(true).optional(),                  // 手算的（候选没实现时登记用，DD-08 §5.4 B10）；不参与判断
})

const PerObservationSchema = z.strictObject({
  observationId: Text,
  status: z.enum(COMPARISON_STATUSES),
  residual: z.number().nullable(),
  purpose: z.enum(EVIDENCE_PURPOSES),
  covered: z.boolean(),
})

export const VerdictSchema = z.strictObject({
  candidateId: Text,
  perObservation: z.array(PerObservationSchema),
  overall: z.enum(['consistent', 'inconsistent', 'notAssessed']),
  notAssessedReason: z.enum(NOT_ASSESSED_REASONS).optional(),
  runStatuses: z.array(z.enum(RUN_STATUSES)),
  intentFailures: z.array(z.string()).optional(),
})

const BasisListSchema = z.strictObject({ independent: z.array(Text), other: z.array(Text) })

export const ConclusionRecordSchema = z.strictObject({
  proposition: z.enum(CONCLUSIONS),
  about: Text.nullable(),
  basis: z.strictObject({
    independent: z.array(Text),
    other: z.array(Text),
    excludedBy: z.record(z.string(), BasisListSchema).optional(),
  }),
  rule: z.number().int().min(1).max(9),
  suggests: z.array(Text).optional(),
})

const ReRunSideSchema = z.strictObject({
  runId: Text,
  status: z.enum(RUN_STATUSES),
  dps: z.number().nullable(),
  steadyLoopBattleFrames: z.array(z.number()).nullable(),
})

export const ClosureRecordSchema = z.strictObject({
  id: Text,                                            // 'echo-input-priority.2026-11'
  propositionId: Text,
  question: Text,                                      // 一句话：这次要区分什么
  kind: z.enum(['backfill', 'experiment']),            // 回填已有材料，还是新做实验
  /** 实验才有：预测是在观测之前登记的（DD-08 §4.2、§5.2；DF-17） */
  preRegistration: z.strictObject({
    commit: Text,                                      // 登记时代码的提交号（预测运行的身份里的 gitCommit）
    date: Text,
    identities: z.array(Text),                         // 每个预测运行的完整 RunIdentity 存放在哪（随记录保存的身份文件，相对仓库根）
    observationsDigest: Text,                          // 参与判断的观测定义的摘要：选择器、单位、时钟、分支、用途、容差、requires；不含实测读数
    predictionsDigest: Text,                           // 全部预测值的摘要
  }).optional(),
  setups: z.array(z.strictObject({ id: Text, scenario: Text, note: z.string().optional() })).min(1),
  candidates: z.array(z.strictObject({
    candidateId: Text,
    conditions: Text,                                  // 这个候选写全的条件：触发点、时钟、时长、目标、适用范围
    runs: z.array(RunRefSchema).default([]),
    predictions: z.array(PredictionSchema).default([]),
  })).min(1),
  criteria: Text,                                      // 判据：容差、怎样算支持 / 冲突 / 分不清。在观测之前写
  observationIds: z.array(Text).min(1),                // docs/calibration/points.yaml 里的观测
  verdicts: z.array(VerdictSchema).default([]),
  /** 结论说的是哪个候选、证据强度到哪、命中决策表的哪一行（DF-16）。由 judge 按决策表算 */
  conclusion: ConclusionRecordSchema.optional(),
  scopeTested: Text,                                   // 结论成立的条件：版本、角色、配装、敌人
  discriminatingObservationNeeded: z.string().min(1).optional(),   // 分不清时：下一项能区分的观测
  /** 人做的采用决定，与结论分开存 */
  decision: z.strictObject({ adoptedBefore: Text, adopted: Text, defaultChanged: z.boolean(), note: Text }).optional(),
  reruns: z.array(z.strictObject({
    scenario: Text,
    before: ReRunSideSchema,
    after: ReRunSideSchema,
    changed: z.boolean(),
  })).default([]),
  notes: z.string().optional(),
}).superRefine((r, ctx) => {
  const dup = (xs: readonly string[]) => xs.filter((x, i) => xs.indexOf(x) !== i)
  for (const [path, xs] of [['setups', r.setups.map(s => s.id)], ['candidates', r.candidates.map(c => c.candidateId)], ['observationIds', r.observationIds]] as const) {
    for (const d of dup(xs)) ctx.addIssue({ code: 'custom', path: [path], message: `${path} 里 ${d} 重复` })
  }
  const setups = new Set(r.setups.map(s => s.id)), obs = new Set(r.observationIds)
  r.candidates.forEach((c, i) => {
    c.runs.forEach((x, j) => { if (!setups.has(x.setupId)) ctx.addIssue({ code: 'custom', path: ['candidates', i, 'runs', j, 'setupId'], message: `没有 setup ${x.setupId}` }) })
    c.predictions.forEach((x, j) => { if (!obs.has(x.observationId)) ctx.addIssue({ code: 'custom', path: ['candidates', i, 'predictions', j, 'observationId'], message: `${x.observationId} 不在 observationIds 里` }) })
  })
  // 第 3 行（ambiguous）必须写出下一项能区分的观测（DD-08 §4.1、C08-16）
  if (r.conclusion?.proposition === 'ambiguous' && !r.discriminatingObservationNeeded)
    ctx.addIssue({ code: 'custom', path: ['discriminatingObservationNeeded'], message: '结论是 ambiguous（分不清）：要写出下一项能区分的观测' })
  // 只有 unverified 的 basis 可以为空（DD-08 §4.1，DF-16 第三轮）
  if (r.conclusion && r.conclusion.proposition !== 'unverified' && r.conclusion.basis.independent.length + r.conclusion.basis.other.length === 0)
    ctx.addIssue({ code: 'custom', path: ['conclusion', 'basis'], message: `结论 ${r.conclusion.proposition} 的 basis 不能为空` })
  if (r.decision?.defaultChanged === true && r.decision.adopted === r.decision.adoptedBefore)
    ctx.addIssue({ code: 'custom', path: ['decision', 'defaultChanged'], message: '采用的候选没变，defaultChanged 不应为 true' })
})
export type ClosureRecord = z.output<typeof ClosureRecordSchema>
export type ClosureRecordInput = z.input<typeof ClosureRecordSchema>
export type CandidateVerdict = z.output<typeof VerdictSchema>
export type ConclusionRecord = z.output<typeof ConclusionRecordSchema>
export type ClosurePrediction = z.output<typeof PredictionSchema>
export type ClosureRunRef = z.output<typeof RunRefSchema>
