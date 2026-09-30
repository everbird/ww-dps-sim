// tests/helpers/m0.ts —— M0 队伍（椿 · 散华 · 维里奈）的场景与日志速记：TD-05 / TD-06 / TD-07 的用例共用（依赖 data/generated）
import type { GameData } from '../../src/data/gamedata'
import { ScenarioSchema, type ScenarioInput } from '../../src/data/scenario.schema'
import { resolveScenario } from '../../src/engine/resolve'
import { simulate } from '../../src/engine/simulate'
import type { SimEvent, SimResult } from '../../src/engine/types'

/** docs/m0-confirm.md 第 4 节的配置：椿 0 链千古洑流 R5、散华 6 链行进序曲 R5、维里奈 3 链奇幻变奏 R5 */
export const M0: ScenarioInput['team'] = [
  { char: '椿', chain: 0, weapon: { name: '千古洑流', rank: 5 } },
  { char: '散华', chain: 6, weapon: { name: '行进序曲', rank: 5 } },
  { char: '维里奈', chain: 3, weapon: { name: '奇幻变奏', rank: 5 } },
]

export function m0Run(gd: GameData, sc: Partial<ScenarioInput>): SimResult {
  return simulate(resolveScenario(ScenarioSchema.parse({ team: M0, enemy: { preset: '全息6/朔雷之鳞' }, rotation: [], ...sc }), gd))
}

/** 一条事件的速记，断言事件顺序用 */
export function brief(e: SimEvent): string {
  switch (e.type) {
    case 'switch': return `switch ${e.from}→${e.to}${e.intro ? ' 变奏' : ''}`
    case 'actionStart': return `start ${e.char} ${e.action}`
    case 'actionEnd': return `end ${e.char} ${e.action}`
    case 'actionCancel': return `cancel ${e.char} ${e.action} by ${e.by}`
    case 'resource': return `${e.char} ${e.resource} ${e.delta > 0 ? '+' : ''}${e.delta} ${e.cause}`
    case 'resourceFull': return `${e.char} ${e.resource} 满`
    case 'intro': return `intro ${e.char}`
    case 'outro': return `outro ${e.char}→${e.to}`
    case 'buffApply': return `+${e.buff}→${e.target}×${e.stacks} ${e.remaining}`
    case 'buffExpire': return `-${e.buff}→${e.target} ${e.reason}`
    case 'hit': return `hit ${e.char} ${e.judgment}`
    case 'warning': return `warning ${e.code}`
    default: return e.type
  }
}

/** 第 f 帧的事件速记（不含判定生成、开场的常驻 buff） */
export const at = (log: readonly SimEvent[], f: number): string[] =>
  log.filter(e => e.f === f && e.type !== 'judgmentSpawn' && !(e.type === 'buffApply' && e.remaining === 'inf')).map(brief)

/** 最后一个资源采样（仿真结束时三人的能量与协奏） */
export const finalResources = (r: SimResult) => r.summary.resourceTimeline.at(-1)!
