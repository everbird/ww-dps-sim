// DD-10 §6 / T10-8：给异构实现的合成输入；与 C01-8/10/11/13–16、C05-1–4 对应。
// 钩子由稳定的 boundary 名称标识，换实现时按下列语义实现，不序列化代码。
import { BuffDefSchema } from '../data/buff.schema'
import { DEFAULT_RULES, type ActionDef, type CharacterDef, type GameData, type JudgmentDef } from '../data/gamedata'
import { ScenarioSchema, type ScenarioInput } from '../data/scenario.schema'
import { prepareRun } from '../engine/run'
import type { PreparedRun } from '../engine/run-types'
import type { CharacterHooks } from '../engine/types'

const hit = (o: Partial<JudgmentDef> = {}): JudgmentDef => ({
  name: 'x', row: 0, spawnFrame: 5, birthFrame: null, lifeFrames: 1, ticks: 1, tickInterval: null,
  persistsOnCancel: true, followHitstop: false, target: 'enemy', calc: 'damage', multiplier: 1,
  relatedAttr: 'atk', element: '物理', tags: [], gains: { energy: 0, concerto: 0, core: [0, 0, 0] },
  gauges: { toughness: 0, tunability: 0 }, hitstop: null, flags: [], ...o,
})
const act = (id: string, o: Partial<ActionDef> = {}): ActionDef => ({
  id, owner: '甲', kind: 'skill', endFrame: 10, cancelWindows: [], priority: [{ fromFrame: 0, value: 2 }],
  inputLocks: [], judgments: [], dilations: [], castGains: [], source: { file: 'synthetic', rows: [] }, flags: [], ...o,
})
export const BOUNDARY_CASES = [
  'stop-idle', 'stop-in-flight', 'stop-commands-pending', 'stop-post-drain-failed',
  'stop-axis-failed', 'stop-chain-depth', 'stop-init-incomplete',
  'phase-cooldown', 'phase-hit-expire', 'phase-multiple-expire', 'phase-interleaved',
] as const
export type BoundaryCase = typeof BOUNDARY_CASES[number]

export function boundaryRun(name: BoundaryCase): PreparedRun {
  let actions = [act('X', { judgments: [hit()] })]
  let hooks: CharacterHooks = {}
  let buffs: CharacterDef['buffs'] = []
  let sc: Partial<ScenarioInput> = { rotation: ['甲 X'] }
  const buff = (id: string, duration: number, action: string) => BuffDefSchema.parse({
    id, source: 'synthetic', zone: 'atkPct', value: 0.5, target: 'self', duration,
    trigger: { on: 'actionStart', where: { actions: [action] } },
  })
  switch (name) {
    case 'stop-in-flight':
      actions = [act('X', { judgments: [hit({ spawnFrame: 2, lifeFrames: 500, ticks: 50, tickInterval: 10 })] })]
      sc = { rotation: ['甲 X'], options: { maxFrames: 100 } }; break
    case 'stop-commands-pending':
      actions = [act('X', { cooldown: 500 })]
      sc = { rotation: ['甲 X X'], options: { maxFrames: 100, maxWait: 1000 } }; break
    case 'stop-post-drain-failed':
      hooks = { onEvent(_ctx, ev) { if (ev.type === 'actionEnd') throw new Error('boom') } }; break
    case 'stop-axis-failed':
      actions.push(act('Y', { comboFrom: ['Z'] }), act('Z'))
      sc = { rotation: ['甲 X', '甲 Y'] }; break
    case 'stop-chain-depth':
      hooks = { onEvent(ctx, ev) { if (ev.type === 'actionStart' || ev.type === 'resource') ctx.addResource('core1', 1) } }; break
    case 'stop-init-incomplete':
      hooks = { onResolve() { throw new Error('init boom') } }; break
    case 'phase-cooldown':
      actions = [act('E', { endFrame: 30, cooldown: 60 })]
      sc = { rotation: ['甲 E E'] }; break
    case 'phase-hit-expire':
      actions = [act('X', { endFrame: 40, judgments: [hit({ name: 'a', spawnFrame: 29 }), hit({ name: 'b', spawnFrame: 30 })] })]
      buffs = [buff('甲.攻击', 30, 'X')]; break
    case 'phase-multiple-expire':
      actions = [act('P'), act('Q')]
      buffs = [buff('甲.buff甲', 30, 'P'), buff('甲.buff乙', 20, 'Q')]
      hooks = { onEvent(ctx, ev) {
        if (ev.type !== 'buffExpire') return
        if (ev.buff === '甲.buff甲') ctx.addResource('core1', 1, ctx.self, 'buff甲 到期')
        if (ev.buff === '甲.buff乙') ctx.addResource('concerto', 1, ctx.self, 'buff乙 到期')
      } }
      sc = { rotation: ['甲 P', '甲 Q', 'wait 30'] }; break
    case 'phase-interleaved':
      actions = [act('X', { endFrame: 20, judgments: [hit({ spawnFrame: 3, gains: { energy: 500, concerto: 0, core: [0, 0, 0] } })] })]
      hooks = { onEvent(ctx, ev) {
        if (ev.type === 'hit') ctx.addResource('core1', 1, ctx.self, 'X1')
        if (ev.type === 'resourceFull' && ev.char === '甲') ctx.addResource('core2', 1, ctx.self, 'X2')
      } }
      sc = { rotation: ['甲 X'], initial: { energy: 'empty' } }; break
    case 'stop-idle': break
    default: throw new Error(`未知边界样例：${String(name)}`)
  }
  const characters = Object.fromEntries(['甲', '乙', '丙'].map((n): [string, CharacterDef] => [n, {
    name: n, element: '物理', weaponType: '迅刀', bodyType: null, commonBlock: null,
    base: { hp: 10000, atk: 1000, def: 1000 }, energyCost: 100,
    coreResources: n === '甲' ? [{ slot: 1, name: '核一', cap: 1e9 }, { slot: 2, name: '核二', cap: 10 }] : [],
    tunabilityRate: 0, harmonyBreakBoost: 0, rarity: null, treeStats: {},
    actions: n === '甲' ? Object.fromEntries(actions.map(a => [a.id, a])) : {}, aliases: {},
    buffs: n === '甲' ? buffs : [], resourceEffects: [], vars: {}, flags: [],
  }]))
  const data: GameData = {
    version: 'synthetic', meta: { xlsxFile: 'synthetic', xlsxSha256: '0'.repeat(64), resourceVersion: null, builtAt: '',
      settings: { framerate: 60, halfFrameThreshold: 0.5, coop: false, limitDodgeBulletTimeCanceling: false, weakPointHitting: false }, counts: {} },
    characters, commonActions: {}, weapons: { 测试武器: {
      key: '测试武器', rarity: 5, type: '迅刀', main: { stat: '攻击', value: 0 }, sub: { stat: '暴击率', value: 0 },
      effects: [], passives: [], resourceEffects: [], curated: true,
    } }, echoes: {}, echoSets: {}, echoStats: null, enemies: {}, effects: {}, abnormalBaseByLevel: [],
    tuneBreak: { variants: [], baseByLevel: [], costFactor: { 1: 0, 3: 0, 4: 0 }, rules: null },
    envBuffs: {}, rules: DEFAULT_RULES, hooks: { 甲: hooks },
  }
  const p = prepareRun(ScenarioSchema.parse({ team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
    enemy: { custom: { level: 90 } }, ...sc }), data)
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
  return p.run
}
