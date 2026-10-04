// tests/helpers/synth.ts —— 人造角色的 GameData 与场景：TD-05 / TD-06 / TD-07 / TD-08 里"人造角色甲乙丙"的用例用它，不依赖生成数据
// 动作用 kernel-harness 的 action() / judgment() 构造；别名 R 的 energyCost 不会自动设（那是注册层的事），要的话直接写在动作上。
import { BuffDefSchema, ResourceEffectSchema, type BuffDefInput, type ResourceEffectInput } from '../../src/data/buff.schema'
import type { CoreResourceDef } from '../../src/data/gamedata'
import { DEFAULT_RULES, type ActionDef, type CharacterDef, type GameData } from '../../src/data/gamedata'
import { ScenarioSchema, type ScenarioInput } from '../../src/data/scenario.schema'
import { resolveScenario } from '../../src/engine/resolve'
import { simulate } from '../../src/engine/simulate'
import type { CharacterHooks, SimEvent, SimResult } from '../../src/engine/types'

export interface SynthChar {
  name: string
  actions: ActionDef[]
  aliases?: Record<string, string>
  buffs?: BuffDefInput[]
  effects?: ResourceEffectInput[]
  hooks?: CharacterHooks
  energyCost?: number                       // 缺省 100
  core?: CoreResourceDef[]
}

export function synthData(chars: SynthChar[]): GameData {
  const characters: Record<string, CharacterDef> = {}
  for (const c of chars) {
    characters[c.name] = {
      name: c.name, element: '物理', weaponType: '迅刀', bodyType: null, commonBlock: null,
      base: { hp: 10000, atk: 1000, def: 1000 }, energyCost: c.energyCost ?? 100, coreResources: c.core ?? [],
      tunabilityRate: 0, harmonyBreakBoost: 0, treeStats: {},
      actions: Object.fromEntries(c.actions.map(a => [a.id, a])), aliases: c.aliases ?? {},
      buffs: (c.buffs ?? []).map(b => BuffDefSchema.parse(b)),
      resourceEffects: (c.effects ?? []).map(e => ResourceEffectSchema.parse(e)),
      ...(c.hooks ? { hooks: c.hooks } : {}), flags: [],
    }
  }
  return {
    version: 'synthetic',
    meta: {
      xlsxFile: 'synthetic', xlsxSha256: '0'.repeat(64), resourceVersion: null, builtAt: '',
      settings: { framerate: 60, halfFrameThreshold: 0.5, coop: false, limitDodgeBulletTimeCanceling: false, weakPointHitting: false },
      counts: {},
    },
    characters, commonActions: {},
    weapons: {
      测试武器: {
        key: '测试武器', rarity: 5, type: '迅刀', main: { stat: '攻击', value: 0 }, sub: { stat: '暴击率', value: 0 },
        effects: [], passives: [], resourceEffects: [],
      },
    },
    echoes: {}, echoSets: {}, echoStats: null, enemies: {}, effects: {}, abnormalBaseByLevel: [],
    tuneBreak: { variants: [], baseByLevel: [], costFactor: { 1: 0, 3: 0, 4: 0 } },
    envBuffs: {}, rules: DEFAULT_RULES,
  }
}

/** 三个人造角色跑一个场景（敌人：90 级自定义）；sc 覆盖场景的其余字段 */
export function synthRun(chars: [SynthChar, SynthChar, SynthChar], sc: Partial<ScenarioInput>): SimResult {
  return simulate(resolveScenario(ScenarioSchema.parse({
    team: chars.map(c => ({ char: c.name, weapon: { name: '测试武器' } })),
    enemy: { custom: { level: 90 } }, ...sc,
  }), synthData(chars)))
}

/** 没有动作的陪跑角色 */
export const idle = (name: string): SynthChar => ({ name, actions: [] })

/** 取某类事件（按 type 收窄） */
export const eventsOfLog = <T extends SimEvent['type']>(log: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
  log.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)
