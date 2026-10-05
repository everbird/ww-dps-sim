// web/app/src/protocol.ts —— 页面与 Worker 之间的消息（引擎在 Worker 里跑，页面不卡）
import type { StatKey } from '../../../src/data/common'
import type { Comparison, MarginalRow, PanelView, Tier } from '../../../src/engine/analysis'
import type { OptimizeResult } from '../../../src/engine/optimize'

export interface Source { name: string; text: string }   // 文件名（报错与标题用）与 YAML 原文

export interface Requests {
  info: { req: Record<string, never>; res: { version: string; characters: string[]; xlsx: string } }
  run: { req: { scenario: Source }; res: { html: string; dps: number; steady: number | null; label: string; error: string | null; warnings: string[] } }
  compare: { req: { base: Source; other: Source }; res: Comparison }
  marginal: { req: { scenario: Source; char: string; tier: Tier }; res: { label: string; dps: number; rows: MarginalRow[] } }
  optimize: {
    req: { scenario: Source; inventory: Source; char: string; top: number; keep: number; set: string | null; includeTeam: boolean }
    res: OptimizeResult & { panels: PanelView[]; secs: number; yaml: string }
  }
}
export type Kind = keyof Requests
export type Message = { [K in Kind]: { id: number; kind: K; req: Requests[K]['req'] } }[Kind]
export type Reply = { id: number; ok: true; res: unknown } | { id: number; ok: false; error: string }
export type { StatKey }
