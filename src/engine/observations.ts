// src/engine/observations.ts —— 校准点与外部观测的对比状态（DD-03 §4.2，DD-08 往里扩）
export type ComparisonStatus =
  | 'passed'
  | 'conflicted'
  | 'unmatched'
  | 'ambiguous'
  | 'insufficientCondition'
  | 'unassessable'
