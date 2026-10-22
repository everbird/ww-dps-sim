// src/engine/scorecard.ts —— 轴卡片（TD-10 §6.3）：一条轴在四个维度上各是多少，几条轴放一起比，不合成一个分数。
//   ① 目标：按场景 goal 的比较口径（缺省稳态），另列打死 1 / 2 / 3 倍敌人生命要多少战斗秒
//   ② 好不好打：每个决策点晚高手 / 熟练 / 普通的平均帧数（3 / 6 / 10，同 plan --hand）各掉多少；每分钟几个决策点、抢帧 !、等切出者跳起的空中切人
//   ③ 养成门槛：各人共鸣效率最少要多少（insight ①）；链数降一档、武器降到 1 阶各掉多少（跑不通也列）
//   ④ 靠不靠得住：这次碰到的假设；假设表里每个开关翻过来，变得最多的那条（insight ③，不含操作延迟——那是 ②）
// 帕累托：零帧与"熟练"两个口径都比不过别人的轴，标出"哪条也比不过它"的那些
import type { GameData } from '../data/gamedata'
import type { Scenario } from '../data/scenario.schema'
import { basisOf } from './analysis'
import { HAND_PROFILES, type HandProfile } from './sample'
import { insight, type EnergyNeed } from './insight'
import { resolveScenario } from './resolve'
import { simulate } from './simulate'
import type { SimResult } from './types'

export interface Downgrade { char: string; what: string; pct: number | null; error: string | null }
export interface Scorecard {
  name: string
  goal: { label: string; dps: number }
  /** 打死 1 / 2 / 3 倍敌人生命的战斗秒；estimated = 日志里没打到、按稳态估的 */
  kills: { scale: number; secs: number | null; estimated: boolean }[]
  /** 按手速档（每个决策点固定晚这一档的平均帧数）：比较口径的值与比零帧的变化 */
  hands: { tier: HandProfile; delay: number; dps: number | null; pct: number | null }[]
  density: { perMin: number | null; switchesPerMin: number | null; forced: number; airborne: number | null; loopSecs: number | null }
  energy: EnergyNeed[]
  downgrades: Downgrade[]
  assumptions: string[]
  /** 假设表里的开关翻过来变得最多的那条（不含 options.inputDelay） */
  fragile: { id: string; change: string; pct: number | null; error: string | null } | null
  /** 在这一组里没有别的轴"零帧和熟练都更好"（帕累托前沿） */
  pareto: boolean
  runs: number
}

const pctOf = (x: number, base: number) => (base > 0 ? x / base - 1 : null)

/** 一张卡（不含 pareto，组里算） */
export function scorecard(name: string, sc: Scenario, data: GameData): Omit<Scorecard, 'pareto'> {
  let runs = 0
  const run = (s: Scenario): SimResult => { runs++; return simulate(resolveScenario(s, data)) }
  const r = resolveScenario(sc, data)
  const delays = (Object.entries(HAND_PROFILES) as [HandProfile, { mean: number }][]).map(([tier, p]) => ({ tier, delay: Math.round(p.mean) }))
  const ins = insight(r, { delays: [r.options.inputDelay, ...delays.map(d => r.options.inputDelay + d.delay)], tight: 0 })
  runs += ins.runs
  const base = ins.basis

  const kills = [1, 2, 3].map(scale => {
    const res = run({ ...sc, goal: { kill: scale } })
    const g = res.summary.goal
    return { scale, secs: g ? g.hi / 60 : null, estimated: g ? !g.reached : false }
  })
  const hands = delays.map(({ tier, delay }) => {
    const row = ins.tolerance.find(t => t.delay === r.options.inputDelay + delay)
    return { tier, delay, dps: row?.dps ?? null, pct: row?.change ?? null }
  })

  // 操作密度：循环轴每轮的决策点（切人、不是连段后续的出招；同卡帧点），按稳态每轮时长折成每分钟
  const baseRes = simulate(r); runs++
  const st = baseRes.summary.steady
  const loopSecs = st ? st.frames / 60 / (st.to - st.from + 1) : null
  const decisions = r.commands.filter(c => c.kind === 'switch' || (c.kind === 'act' && !r.team[c.slot]!.actions[c.action]?.comboFrom?.length))
  const switches = r.commands.filter(c => c.kind === 'switch').length
  const forced = r.commands.filter(c => c.kind === 'act' && c.force).length
  const airborneWaits = st ? baseRes.log.filter(e => e.type === 'wait' && e.code === 'airborne' && e.cmd.loop >= st.from && e.cmd.loop <= st.to).length / (st.to - st.from + 1) : null
  const density = {
    perMin: loopSecs ? decisions.length / loopSecs * 60 : null,
    switchesPerMin: loopSecs ? switches / loopSecs * 60 : null,
    forced, airborne: airborneWaits, loopSecs,
  }

  // 养成门槛：链数降一档、武器降到 1 阶（各一份，只改这一处）
  const downgrades: Downgrade[] = []
  sc.team.forEach((m, i) => {
    const tryOne = (what: string, member: typeof m) => {
      const team = sc.team.map((x, j) => (j === i ? member : x)) as Scenario['team']
      try {
        const res = run({ ...sc, team })
        downgrades.push(res.error
          ? { char: m.char, what, pct: null, error: res.error.code }
          : { char: m.char, what, pct: pctOf(basisOf(res).dps, base.dps), error: null })
      } catch (e) { downgrades.push({ char: m.char, what, pct: null, error: e instanceof Error ? e.message.split('\n')[0]! : String(e) }) }
    }
    if (m.chain > 0) tryOne(`${m.chain} 链 → ${m.chain - 1} 链`, { ...m, chain: m.chain - 1 })
    if (m.weapon.rank > 1) tryOne(`${m.weapon.name} ${m.weapon.rank} 阶 → 1 阶`, { ...m, weapon: { ...m.weapon, rank: 1 } })
  })

  const flips = ins.sensitivity.filter(s => !s.change.startsWith('options.inputDelay'))   // 操作延迟归 ②
  const fragile = flips.length === 0 ? null : flips.reduce((a, b) => {
    const score = (x: typeof a) => (x.error ? Infinity : Math.abs(x.pct ?? 0))
    return score(b) > score(a) ? b : a
  })
  return {
    name, goal: { label: base.label, dps: base.dps }, kills, hands, density, energy: ins.energy, downgrades,
    assumptions: baseRes.summary.assumptions.map(a => a.id),
    fragile: fragile ? { id: fragile.id, change: fragile.change, pct: fragile.pct, error: fragile.error } : null,
    runs,
  }
}

/** 一组卡：标出帕累托前沿（零帧与"熟练"两个口径，越大越好） */
export function scorecards(items: readonly { name: string; sc: Scenario }[], data: GameData, onCard?: (c: Omit<Scorecard, 'pareto'>) => void): Scorecard[] {
  const cards = items.map(({ name, sc }) => { const c = scorecard(name, sc, data); onCard?.(c); return c })
  const skilled = (c: Omit<Scorecard, 'pareto'>) => c.hands.find(h => h.tier === '熟练')?.dps ?? -Infinity
  return cards.map(c => ({
    ...c,
    pareto: !cards.some(o => o !== c && o.goal.dps >= c.goal.dps && skilled(o) >= skilled(c) && (o.goal.dps > c.goal.dps || skilled(o) > skilled(c))),
  }))
}
