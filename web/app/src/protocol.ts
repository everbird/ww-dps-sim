// web/app/src/protocol.ts —— 页面与 Worker 之间的消息（引擎在 Worker 里跑，页面不卡）
import type { StatKey } from '../../../src/data/common'
import type { Comparison, MarginalRow, PanelView, Tier } from '../../../src/engine/analysis'
import type { Insight } from '../../../src/engine/insight'
import type { OptimizeResult } from '../../../src/engine/optimize'
import type { OpeningResult, PlanResult } from '../../../src/engine/plan'
import type { Candidate, SearchResult } from '../../../src/engine/search'
import type { Summary } from '../../../src/engine/types'
import type { DiffTimeline } from '../../../src/report/diff-timeline'

export interface Source { name: string; text: string }   // 文件名（报错与标题用）与 YAML 原文

export interface Requests {
  info: { req: Record<string, never>; res: { version: string; characters: string[]; xlsx: string } }
  run: {
    req: { scenario: Source; view?: string }
    res: { html: string; dps: number; steady: number | null; label: string; error: string | null; alerts: string[]; warnings: string[]; assumptions: Summary['assumptions'] }
  }
  design: { req: { scenario: Source; file: string }; res: { html: string } }
  insight: { req: { scenario: Source }; res: Insight }
  compare: { req: { base: Source; other: Source }; res: Comparison & { timeline: DiffTimeline } }   // timeline：时间轴对照（原型）
  marginal: { req: { scenario: Source; char: string; tier: Tier }; res: { label: string; dps: number; rows: MarginalRow[] } }
  optimize: {
    req: { scenario: Source; inventory: Source; char: string; top: number; keep: number; set: string | null; includeTeam: boolean }
    res: OptimizeResult & { panels: PanelView[]; secs: number; yaml: string }
  }
  // 轴搜索（TD-10 §6.1）：move 为 null 时缺省挪声骸技能 Q；chars 空 = 都改；只回前 top 条（原轴另给排第几）
  search: {
    req: { scenario: Source; move: string[] | null; drop: string[]; swap: boolean; insert: string[]; chars: string[]; rounds: number; beam: number; maxRuns: number; top: number }
    res: Omit<SearchResult, 'basis' | 'results'> & { label: string; results: Candidate[]; total: number; rankOfBase: number; secs: number }
  }
  // 按套路排轴（TD-10 §6.2 ④′，同 pnpm plan）：opening = 改排启动轴（循环轴不动，按整个窗口比）；vary 次数可变；gen 自动生成套路
  plan: {
    req: { scenario: Source; opening: boolean; width: number; vary: number; gen: boolean }
    res: ({ mode: 'rotation'; result: PlanResult } | { mode: 'opening'; result: OpeningResult }) & { secs: number }
  }
}
export type Kind = keyof Requests
export type Message = { [K in Kind]: { id: number; kind: K; req: Requests[K]['req'] } }[Kind]
export type Reply = { id: number; ok: true; res: unknown } | { id: number; ok: false; error: string }
export type { StatKey }
