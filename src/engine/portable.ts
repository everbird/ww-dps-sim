// src/engine/portable.ts —— 装配结果的可移植形式（总设计 §10.1、§11 第 7 条）：去掉钩子表（GameData 里唯一的代码），剩下的是纯数据，
// 能原样 JSON 往返。换实现（Rust）时这份 JSON 是输入，事件日志与汇总是要逐条对上的输出（pnpm conformance 写出样例）。
import type { GameData } from '../data/gamedata'
import type { ResolvedScenario } from './types'

/** 去掉钩子表 */
export const portable = (r: ResolvedScenario): ResolvedScenario => ({ ...r, data: { ...r.data, hooks: {} } })

/** 从 JSON 读回来的装配结果接上钩子表（按角色名） */
export const withHooks = (r: ResolvedScenario, hooks: GameData['hooks']): ResolvedScenario => ({ ...r, data: { ...r.data, hooks } })
