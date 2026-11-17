// web/app/src/handlers.ts —— Worker 里各请求的处理：装配 GameData（只做一次），跑仿真、对比、边际、择优、轴搜索。
// 与 worker.ts 分开，测试（tests/web.test.ts）可以直接调用
import { parse } from 'yaml'
import type { StatKey } from '../../../src/data/common'
import type { GameData } from '../../../src/data/gamedata'
import { InventorySchema, resolveInventory } from '../../../src/data/inventory.schema'
import { ScenarioSchema, type Scenario } from '../../../src/data/scenario.schema'
import { parseOrThrow } from '../../../src/data/validate'
import { basisOf, marginal, panelsOf, runScenario, tryCompareRuns, usableBasis } from '../../../src/analysis/analysis'
import { scopeNoteForRun } from '../../../src/engine/basis'
import { insight } from '../../../src/analysis/insight'
import { optimize, withEchoes } from '../../../src/analysis/optimize'
import { resolveScenario } from '../../../src/engine/resolve'
import { planOpening, planRotation } from '../../../src/analysis/plan'
import { searchRotation } from '../../../src/analysis/search'
import { prepareRun, runPrepared } from '../../../src/engine/run'
import type { ResolvedScenario, SimResult } from '../../../src/engine/types'
import { diffTimeline } from '../../../src/report/diff-timeline'
import { renderDesign, renderTimeline, timelineModel, type TimelineModel } from '../../../src/report/timeline'
import shared from '../../designs/shared.js?raw'
import template from '../../timeline.html?raw'
import { loadGameData } from './gamedata'
import type { Requests, Source } from './protocol'

const DESIGN_FILES = import.meta.glob<string>('../../designs/*.html', { query: '?raw', import: 'default', eager: true })
function designTemplate(file: string): string {
  const tpl = DESIGN_FILES[`../../designs/${file}`]
  if (!tpl) throw new Error(`没有设计模板 ${file}`)
  return tpl
}

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

/** 最近一次仿真（按场景名 + 原文）：切换视图、"视图说明"页换视图时不再重跑 */
let last: { key: string; r: ResolvedScenario; res: SimResult; model: TimelineModel } | null = null
async function simulated(s: Source) {
  const key = `${s.name}\n${s.text}`
  if (last?.key === key) return last
  const sc = scenarioOf(s)
  const p = prepareRun(sc, await gd())
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
  const r = p.run.resolved
  const res = runPrepared(p.run, { diag: { eventMeta: true } })         // 时间轴的出处按记录下来的事件来源（DD-05 §3.4）
  last = { key, r, res, model: timelineModel(s.name, sc, r, res) }
  return last
}
const renderView = (view: string | undefined, model: TimelineModel) =>
  view && view !== 'classic' ? renderDesign(designTemplate(view), shared, model) : renderTimeline(template, model)

type Handlers = { [K in keyof Requests]: (req: Requests[K]['req']) => Promise<Requests[K]['res']> }
export const handlers: Handlers = {
  async info() {
    const d = await gd()
    return { version: d.version, characters: Object.keys(d.characters), xlsx: d.meta.xlsxFile }
  },
  async run({ scenario, view }) {
    const { r, res, model } = await simulated(scenario)
    const b = basisOf(res)
    const u = usableBasis(res)
    const c = res.completion
    const truncationNote = c.truncation
      ? (c.truncation.kind === 'commandsPending'
          ? `到帧数上限被截断：还有 ${c.truncation.remains.pendingCommands} 条指令没执行`
          : '到帧数上限被截断：指令发完了，场上还有没走完的判定')
      : null
    const failMsg = c.engineError?.message ?? c.axisFailure?.detail
    const failFrame = res.error?.frame
    return {
      // view：缺省是原版时间轴（含调试表）；写 web/designs 里的文件名就用那个视图
      html: renderView(view, model),
      dps: res.summary.dps, steady: res.summary.steady?.dps ?? null, label: b.label,
      completionStatus: c.status,
      truncationNote,
      usable: u.ok,
      basisReason: u.ok ? null : u.reason,
      scopeNote: scopeNoteForRun(res, r.tuneBreakOmitted?.note),
      error: failMsg ? (failFrame !== undefined ? `第 ${failFrame} 帧：${failMsg}` : failMsg) : null,
      // 轴可能有问题：写了"变奏"的切人没变奏（TD-12 §2），单独列出、不折叠；其余是"提示"
      alerts: res.summary.warnings.filter(w => w.code === 'introMissed').map(w => w.message),
      warnings: [...r.warnings, ...res.summary.warnings.filter(w => w.code !== 'introMissed').map(w => w.message)],
      assumptions: res.summary.assumptions,                     // 这次碰到的假设（总设计 T16）
    }
  },
  async design({ scenario, file }) {
    designTemplate(file)
    return { html: renderView(file, (await simulated(scenario)).model) }
  },
  async compare({ base, other }) {
    const d = await gd()
    const sa = scenarioOf(base), sb = scenarioOf(other)
    const a = runScenario(sa, d), b = runScenario(sb, d)
    const cr = tryCompareRuns(a, b)
    if (!cr.ok) throw new Error(cr.reason)
    const timeline = diffTimeline({ res: a.res, basis: cr.value.base, rotation: sa.rotation }, { res: b.res, basis: cr.value.other, rotation: sb.rotation })
    return { ...cr.value, timeline }
  },
  async insight({ scenario }) {
    return insight(scenarioOf(scenario), await gd())   // 结论（TD-10 §6）：约 25 次仿真，加卡帧点（每个决策点一次）再多二三十次
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
  async search({ scenario, move, drop, swap, insert, chars, rounds, beam, maxRuns, top }) {
    const sc = scenarioOf(scenario)
    const t0 = performance.now()
    const x = searchRotation(sc, await gd(), {
      ...(move ? { move } : {}), drop, swap, insert, ...(chars.length ? { chars } : {}), rounds, beam, maxRuns,
    })
    const { basis, results, ...rest } = x
    return { ...rest, label: basis.label, results: results.slice(0, top), total: results.length, rankOfBase: results.indexOf(x.base) + 1, secs: (performance.now() - t0) / 1000 }
  },
  async plan({ scenario, opening, width, vary, gen }) {
    const sc = scenarioOf(scenario)
    const d = await gd()
    const t0 = performance.now()
    const o = { width, top: width, vary, gen }
    const secs = () => (performance.now() - t0) / 1000
    if (opening) { const result = planOpening(sc, d, o); return { mode: 'opening' as const, result, secs: secs() } }
    const result = planRotation(sc, d, o)
    return { mode: 'rotation' as const, result, secs: secs() }
  },
}

