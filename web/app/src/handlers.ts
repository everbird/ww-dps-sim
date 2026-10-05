// web/app/src/handlers.ts —— Worker 里各请求的处理：装配 GameData（只做一次），跑仿真、对比、边际、择优。
// 与 worker.ts 分开，测试（tests/web.test.ts）可以直接调用
import { parse } from 'yaml'
import type { StatKey } from '../../../src/data/common'
import type { GameData } from '../../../src/data/gamedata'
import { InventorySchema, resolveInventory } from '../../../src/data/inventory.schema'
import { ScenarioSchema, type Scenario } from '../../../src/data/scenario.schema'
import { parseOrThrow } from '../../../src/data/validate'
import { basisOf, compareRuns, marginal, panelsOf, runScenario } from '../../../src/engine/analysis'
import { optimize, withEchoes } from '../../../src/engine/optimize'
import { resolveScenario } from '../../../src/engine/resolve'
import { simulate } from '../../../src/engine/simulate'
import { renderTimeline, timelineModel } from '../../../src/report/timeline'
import template from '../../timeline.html?raw'
import { loadGameData } from './gamedata'
import type { Requests, Source } from './protocol'

let data: Promise<GameData> | null = null
const gd = () => (data ??= loadGameData())

const scenarioOf = (s: Source): Scenario => {
  let raw: unknown
  try { raw = parse(s.text) } catch (e) { throw new Error(`${s.name}：YAML 写法有误：${e instanceof Error ? e.message : e}`) }
  return parseOrThrow(ScenarioSchema, raw, s.name)
}
const slotOf = (sc: Scenario, char: string) => {
  const i = sc.team.findIndex(m => m.char === char)
  if (i < 0) throw new Error(`队伍里没有 ${char}`)
  return i as 0 | 1 | 2
}
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000))
const flow = (t: Partial<Record<StatKey, number>>) => `{ ${Object.entries(t).map(([k, v]) => `${k}: ${num(v!)}`).join(', ')} }`

type Handlers = { [K in keyof Requests]: (req: Requests[K]['req']) => Promise<Requests[K]['res']> }
export const handlers: Handlers = {
  async info() {
    const d = await gd()
    return { version: d.version, characters: Object.keys(d.characters), xlsx: d.meta.xlsxFile }
  },
  async run({ scenario }) {
    const sc = scenarioOf(scenario)
    const r = resolveScenario(sc, await gd())
    const res = simulate(r)
    const b = basisOf(res)
    return {
      html: renderTimeline(template, timelineModel(scenario.name, sc, r, res)),
      dps: res.summary.dps, steady: res.summary.steady?.dps ?? null, label: b.label,
      error: res.error ? `第 ${res.error.frame} 帧：${res.error.message}` : null,
      warnings: [...r.warnings, ...res.summary.warnings.map(w => w.message)],
    }
  },
  async compare({ base, other }) {
    const d = await gd()
    const a = runScenario(scenarioOf(base), d), b = runScenario(scenarioOf(other), d)
    for (const [s, x] of [[base, a], [other, b]] as const) if (x.res.error) throw new Error(`${s.name} 运行出错（第 ${x.res.error.frame} 帧）：${x.res.error.message}`)
    return compareRuns(a, b)
  },
  async marginal({ scenario, char, tier }) {
    const sc = scenarioOf(scenario)
    const m = marginal(sc, await gd(), slotOf(sc, char), tier)
    return { label: m.base.label, dps: m.base.dps, rows: m.rows }
  },
  async optimize({ scenario, inventory, char, top, keep, set, includeTeam }) {
    const d = await gd()
    const sc = scenarioOf(scenario)
    const slot = slotOf(sc, char)
    let raw: unknown
    try { raw = parse(inventory.text) } catch (e) { throw new Error(`${inventory.name}：YAML 写法有误：${e instanceof Error ? e.message : e}`) }
    const inv = resolveInventory(parseOrThrow(InventorySchema, raw, inventory.name), d)
    if (inv.issues.length) throw new Error(`${inventory.name}：\n${inv.issues.join('\n')}`)
    const t0 = performance.now()
    const out = optimize(sc, d, inv.pieces, { slot, top, keep, includeTeam, ...(set ? { set } : {}) })
    const secs = (performance.now() - t0) / 1000
    const panels = out.builds.map(b => panelsOf(resolveScenario(withEchoes(sc, slot, b.pieces), d))[slot]!)
    const best = out.builds[0]
    const yaml = best ? best.pieces.map(p => `      - { name: ${p.name}, set: ${p.set}, main: ${flow(p.main)}, subs: ${flow(p.subs)} }   # ${p.id}`).join('\n') : ''
    return { ...out, panels, secs, yaml }
  },
}

