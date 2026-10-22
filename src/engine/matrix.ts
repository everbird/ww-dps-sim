// src/engine/matrix.ts —— 矩阵（终焉矩阵 · 奇点扩张）计分（docs/matrix.md）：几支队按顺序接力打一串 boss，每队限时，按伤害折分。
// 规则取 DPM-Team-Builder v4.9.2（S2-3、3.7 版）的缺省值；它的各轮血量与我们敌人表的"矩8"逐只对得上（到小数点后 4 位）。
// 做法：每支队对每只 boss 各跑一次仿真（换敌人预设，循环轴跑够一队的时限），再按队伍的战斗时钟接力——
// 第 k 只从某一帧起承受"对它那次仿真"在这一帧之后的命中，累计到剩余血量就打死，下一只在转场之后出来，转场期间的命中作废。
// 假设（matrix-relay）：轴不因换 boss 停顿；敌人身上的状态（偏谐、异常效应层数、白条）按"这只 boss 从开场就在"算，没有在换 boss 时清空。
import type { EnemyPreset, GameData } from '../data/gamedata'
import type { TrackedId } from './assumptions'
import type { Scenario } from '../data/scenario.schema'
import { resolveScenario } from './resolve'
import { simulate } from './simulate'
import { battleFrameOf, hitValue } from './summary'
import type { HitEvent } from './types'

export interface MatrixRules {
  teamFrames: number                         // 每队限时（战斗帧；大招时停也停，假设 matrix-relay）
  entryFrames: number                        // 进场：开始计时到能出手
  transFrames: number                        // 打死一只到下一只能打
  ratios: readonly [number, number, number]  // 每万点伤害得分：第 1 轮、第 2 轮、第 3 轮起
  lastRatios: readonly [number, number, number]   // 每轮第 5 只（矩阵奇藏，1.1 倍，游戏里的取整按 DPM）
  killBonus: number                          // 打死第 5 只加分
  growth: number                             // 第 4 轮起每只比第 3 轮同位置多几成（单利：第 n 只 × (1 + growth·n)）
}

/** S2-3（3.7 版）的缺省值，出自 DPM-Team-Builder v4.9.2 的环境设定 */
export const MATRIX_RULES: MatrixRules = {
  teamFrames: 120 * 60, entryFrames: 60, transFrames: 90,
  ratios: [8.34, 9.6, 10.43], lastRatios: [9.18, 10.55, 11.47], killBonus: 1000, growth: 0.05,
}

export interface MatrixBoss {
  label: string                              // R1-1 …
  round: number
  pos: number                                // 1–5
  preset: EnemyPreset                        // 第 4 轮起用第 3 轮同位置的（等级、抗性一样，血量另算）
  hp: number
}

/** 一期矩阵的 boss 顺序：敌人表"<期>R1/"…"<期>R3/"按表里的顺序，每轮 5 只；第 4 轮起按 growth 外推，共 rounds 轮 */
export function matrixBosses(data: GameData, stage: string, rules: MatrixRules = MATRIX_RULES, rounds = 6): MatrixBoss[] {
  const byRound = [1, 2, 3].map(n => Object.values(data.enemies).filter(e => e.tag === `${stage}R${n}`))
  for (const [i, list] of byRound.entries()) {
    if (list.length !== 5) throw new Error(`敌人表"${stage}R${i + 1}"有 ${list.length} 只，不是 5 只（期数写成"矩8"这样）`)
  }
  const out: MatrixBoss[] = []
  for (let round = 1; round <= rounds; round++) {
    for (let pos = 1; pos <= 5; pos++) {
      const preset = byRound[Math.min(round, 3) - 1]![pos - 1]!
      const n = (round - 4) * 5 + pos
      const hp = round <= 3 ? preset.hp : preset.hp * (1 + rules.growth * n)
      out.push({ label: `R${round}-${pos}`, round, pos, preset, hp })
    }
  }
  return out
}

/** 这一只每万点伤害得几分 */
export const ratioOf = (b: Pick<MatrixBoss, 'round' | 'pos'>, rules: MatrixRules = MATRIX_RULES): number =>
  (b.pos === 5 ? rules.lastRatios : rules.ratios)[Math.min(b.round, 3) - 1]!

/** 接力进行到哪：第几只（matrixBosses 的下标）、还剩多少血 */
export interface MatrixState { boss: number; hp: number }

export interface MatrixSegment {
  label: string; enemy: string
  from: number; to: number                   // 这一队的战斗帧（不含进场）
  damage: number; killed: boolean; score: number
}
export interface MatrixTeam {
  name: string
  start: MatrixState; end: MatrixState
  segments: MatrixSegment[]
  damage: number; score: number
  lostDamage: number                         // 转场期间作废、打死时溢出的伤害
}

/** 一条命中：这一队的战斗帧、伤害 */
export interface Tick { f: number; v: number }

/** 一队接力（纯函数）：hitsOf(敌人预设 id) 给这队对那只 boss 的命中（按帧排好）；从 start 打到限时 */
export function relay(name: string, hitsOf: (enemy: string) => readonly Tick[], bosses: readonly MatrixBoss[], start: MatrixState,
  rules: MatrixRules = MATRIX_RULES): MatrixTeam {
  const limit = rules.teamFrames - rules.entryFrames
  const segments: MatrixSegment[] = []
  let at = 0
  let st = { ...start }
  let lost = 0
  while (at < limit && st.boss < bosses.length) {
    const b = bosses[st.boss]!
    let dmg = 0
    let killedAt: number | null = null
    for (const h of hitsOf(b.preset.id)) {
      if (h.f < at) continue
      if (h.f >= limit) break
      if (dmg + h.v >= st.hp) { lost += dmg + h.v - st.hp; dmg = st.hp; killedAt = h.f; break }
      dmg += h.v
    }
    const killed = killedAt !== null
    const score = dmg / 1e4 * ratioOf(b, rules) + (killed && b.pos === 5 ? rules.killBonus : 0)
    const to = killed ? killedAt! : limit
    segments.push({ label: b.label, enemy: b.preset.id, from: at, to, damage: dmg, killed, score })
    if (!killed) { st = { boss: st.boss, hp: st.hp - dmg }; break }
    // 转场：打死后这段时间的命中作废
    const next = killedAt! + rules.transFrames
    const nb = bosses[st.boss + 1]
    if (nb) for (const h of hitsOf(nb.preset.id)) if (h.f > killedAt! && h.f < Math.min(next, limit)) lost += h.v
    st = { boss: st.boss + 1, hp: bosses[st.boss + 1]?.hp ?? 0 }
    at = next
  }
  return {
    name, start, end: st, segments, lostDamage: lost,
    damage: segments.reduce((a, s) => a + s.damage, 0), score: segments.reduce((a, s) => a + s.score, 0),
  }
}

/** 一支队对某只 boss 的命中：换敌人预设，循环轴加跑到够一队的限时 */
export function teamHits(sc: Scenario, data: GameData, enemy: string, rules: MatrixRules = MATRIX_RULES): Tick[] {
  const need = rules.teamFrames - rules.entryFrames
  const run = (repeat: number) => {
    const s: Scenario = {
      ...sc, enemy: { preset: enemy }, goal: 'steady',
      options: { ...sc.options, repeat, maxFrames: Math.max(sc.options.maxFrames, Math.ceil(sc.options.maxFrames * repeat / sc.options.repeat) * 2) },
    }
    return simulate(resolveScenario(s, data))
  }
  let res = run(sc.options.repeat)
  if (res.error) throw new Error(`${enemy}：${res.error.message}`)
  if (res.summary.windowFrames < need) {
    res = run(Math.ceil(sc.options.repeat * need / Math.max(1, res.summary.windowFrames)) + 1)
    if (res.error) throw new Error(`${enemy}：${res.error.message}`)
  }
  return res.log.filter((e): e is HitEvent => e.type === 'hit' && e.dmg !== null).map(h => ({ f: battleFrameOf(h), v: hitValue(h) }))
}

/** 碰到的假设：矩阵计分总是用接力（假设表 matrix-relay），单场仿真碰不到 */
export interface MatrixResult { stage: string; order: string[]; teams: MatrixTeam[]; score: number; damage: number; end: string; assumptions: TrackedId[] }

/** 几支队按给的顺序接力（从 R1-1 满血开始）。命中按（队、敌人）缓存，换顺序时不重跑 */
export function matrixRun(teams: readonly { name: string; sc: Scenario }[], data: GameData, stage: string,
  rules: MatrixRules = MATRIX_RULES, cache = new Map<string, Tick[]>()): MatrixResult {
  const bosses = matrixBosses(data, stage, rules)
  let st: MatrixState = { boss: 0, hp: bosses[0]!.hp }
  const out: MatrixTeam[] = []
  for (const t of teams) {
    const hitsOf = (enemy: string) => {
      const key = `${t.name}|${enemy}`
      let h = cache.get(key)
      if (!h) { h = teamHits(t.sc, data, enemy, rules); cache.set(key, h) }
      return h
    }
    const r = relay(t.name, hitsOf, bosses, st, rules)
    out.push(r)
    st = r.end
  }
  const b = bosses[st.boss]
  return {
    stage, order: teams.map(t => t.name), teams: out,
    score: out.reduce((a, t) => a + t.score, 0), damage: out.reduce((a, t) => a + t.damage, 0),
    end: b ? `${b.label} 剩 ${(st.hp / b.hp * 100).toFixed(1)}%` : '打完',
    assumptions: ['matrix-relay'],
  }
}

/** 全部出场顺序各跑一遍，按总分排（队伍数 ≤ 6） */
export function matrixOrders(teams: readonly { name: string; sc: Scenario }[], data: GameData, stage: string,
  rules: MatrixRules = MATRIX_RULES): MatrixResult[] {
  if (teams.length > 6) throw new Error('队伍太多（> 6），排列数太大')
  const perms = (xs: readonly number[]): number[][] => (xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p])))
  const cache = new Map<string, Tick[]>()
  return perms(teams.map((_, i) => i)).map(p => matrixRun(p.map(i => teams[i]!), data, stage, rules, cache)).sort((a, b) => b.score - a.score)
}
