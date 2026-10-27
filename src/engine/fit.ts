// src/engine/fit.ts —— 录像剖析的贴合度（2026-10-27 用户说明：录像剖析的模糊探索是为了更贴合录像——切人与技能的时刻、切人类型、
// boss 血条，以后加跳字与协奏环 / 共鸣回路状态——不是搜 DPS 更高的轴）。replayFit 给一次仿真按场景的 video 打分（越小越贴合），
// fitVariants 在现有场景上生成变体（假设开关翻过来、轴里读到的动作去掉 / 挪到附近 / 对调）逐个打分、按贴合度排。
// 纯库：不读盘；命令行在 src/cli/fit.ts
import type { Scenario } from '../data/scenario.schema'
import { flipsOf } from './sensitivity'
import { adjusted } from './insight'
import { compileRotation, type CompileMember } from './scheduler'
import { lineText, neighborIter, parseLines } from './search'
import { simulate } from './simulate'
import { compareMarks, traceCommands, videoSeconds } from './trace'
import type { ResolvedScenario, SimResult } from './types'

type Video = NonNullable<Scenario['video']>

/** 贴合度的各项；score 折成"秒"：切人、录像动作的平均差（秒）+ 切人类型对不上每次 2 秒 + 录像动作在仿真里找不到每个 5 秒 + 血条均方根差每 1% 记 0.5 秒 */
export interface Fit {
  switches: { n: number; mae: number; max: number; typeMiss: number }
  events: { n: number; matched: number; mae: number }
  hp: { n: number; rmse: number; end: number } | null
  score: number
}
export const FIT_WEIGHTS = { typeMiss: 2, unmatched: 5, hpPct: 0.5 } as const

/** 录像动作在仿真里找最近的同名动作，离得超过这么多秒算没找到 */
const EVENT_WINDOW = 10

export function replayFit(r: ResolvedScenario, res: SimResult, video: Video): Fit {
  const cmds = traceCommands(res.log, r, video.loop)
  const cmp = compareMarks(cmds, video.marks)
  // 视频秒 ↔ 世界帧：按第一个锚点对齐（视图 F、pnpm trace 同样）
  const first = cmp.rows[0]
  const f0 = first ? cmds.find(c => c.line === first.line)!.f : 0
  const v0 = first ? videoSeconds(video.marks[String(first.line)]!) : 0
  const vsec = (f: number) => v0 + (f - f0) / 60
  const diffs = cmp.rows.map(x => Math.abs(x.diff))
  // 切人类型：轴里写了"变奏"的应是变奏，没写的应是普通切入（录像剖析里两种都是照协奏环读的）
  const intro = new Map(r.commands.flatMap(c => (c.kind === 'switch' ? [[c.line, !!c.expectIntro] as const] : [])))
  let typeMiss = 0
  for (const e of res.log) if (e.type === 'switch' && e.cmd && intro.has(e.cmd.line) && intro.get(e.cmd.line) !== e.intro) typeMiss++
  const switches = { n: diffs.length, mae: mean(diffs), max: diffs.length ? Math.max(...diffs) : 0, typeMiss }

  const starts = res.log.flatMap(e => (e.type === 'actionStart' ? [{ char: e.char, action: e.action, t: vsec(e.f) }] : []))
  const ev = (video.events ?? []).map(line => {
    const [t, char, act] = line.trim().split(/\s+/) as [string, string, string]
    const m = r.team.find(x => x.def.name === char)
    const id = m ? (Object.hasOwn(m.actions, act) ? act : m.aliases[act]) : undefined
    const at = videoSeconds(t)
    const near = starts.filter(s => s.char === char && s.action === id).map(s => Math.abs(s.t - at))
    const d = near.length ? Math.min(...near) : Infinity
    return d <= EVENT_WINDOW ? d : null
  })
  const hit = ev.filter((d): d is number => d !== null)
  const events = { n: ev.length, matched: hit.length, mae: mean(hit) }

  let hp: Fit['hp'] = null
  if (video.hp?.length) {
    const pts = video.hp.map(line => { const [t, left] = line.trim().split(/\s+/) as [string, string]; return [videoSeconds(t), Number(left)] as const })
    const [t0, left0] = pts[0]!
    const dmg = res.log.flatMap(e => (e.type === 'hit' && e.dmg ? [[vsec(e.f), e.dmg.expected] as const] : []))
    const simLeft = (t: number) => left0 - dmg.reduce((a, [s, d]) => (s >= t0 && s < t ? a + d : a), 0) / r.enemy.hp
    const err = pts.map(([t, v]) => simLeft(t) - v)
    hp = { n: err.length, rmse: Math.sqrt(mean(err.map(x => x * x))), end: err.at(-1)! }
  }
  const score = switches.mae + events.mae + FIT_WEIGHTS.typeMiss * typeMiss + FIT_WEIGHTS.unmatched * (events.n - events.matched)
    + (hp ? FIT_WEIGHTS.hpPct * hp.rmse * 100 : 0)
  return { switches, events, hp, score }
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export interface FitRow { desc: string; fit: Fit | null; error: string | null }
export interface FitReport { base: Fit; rows: FitRow[]; candidates: number }

/**
 * 变体：① 假设表里每个开关翻过来（敏感度矩阵同一组）；② 轴里读到的动作（不是补位的）去掉、挪到前后 near 行之内的同一角色行、与相邻的对调。
 * ② 的候选很多（长轴几千条），等距取 n 条；① 全跑。跑不通的列出原因、不排名
 */
export function fitVariants(r: ResolvedScenario, sc: Scenario, opts: { n?: number; near?: number } = {}): FitReport {
  const video = sc.video
  if (!video) throw new Error('场景没有 video：录像剖析的贴合度要拿录像比')
  const run = (rr: ResolvedScenario, desc: string): FitRow => {
    try {
      const res = simulate(rr)
      return res.error ? { desc, fit: null, error: res.error.message } : { desc, fit: replayFit(rr, res, video), error: null }
    } catch (e) { return { desc, fit: null, error: e instanceof Error ? e.message : String(e) } }
  }
  const base = run(r, '原场景')
  if (!base.fit) throw new Error(`原场景跑不通：${base.error}`)
  const rows: FitRow[] = flipsOf().map(f => run(adjusted(r, f.path, f.value), `假设 ${f.label}`))

  const members: CompileMember[] = r.team.map(m => ({ name: m.def.name, actions: m.actions, aliases: m.aliases }))
  const has = (char: string, action: string) => !!members.find(x => x.name === char && (action in x.actions || action in x.aliases))
  const lines = parseLines(sc.rotation)
  const pinned = [...new Set(lines.flatMap(l => ('items' in l ? l.items.filter(i => !i.filler).map(i => i.action) : [])))]
  const gen = () => neighborIter(lines, { move: pinned, drop: pinned, swap: true, has, near: opts.near ?? 4 })
  let candidates = 0
  for (const _ of gen()) candidates++
  const k = opts.n ?? 60
  let i = 0
  for (const ch of gen()) {
    if (!chosen(candidates, k, i++)) continue
    const compiled = compileRotation(ch.lines.map(lineText), members, r.initial.onField, r.options.repeat, [...sc.opening])
    if (!compiled.ok) { rows.push({ desc: ch.desc, fit: null, error: compiled.issues[0]!.message }); continue }
    rows.push(run({ ...r, commands: compiled.commands, opening: compiled.opening }, ch.desc))
  }
  rows.sort((a, b) => (a.fit && b.fit ? a.fit.score - b.fit.score : a.fit ? -1 : b.fit ? 1 : 0))
  return { base: base.fit, rows, candidates }
}

/** 从 len 条里等距取 k 条（同 fuzz，结果可重复） */
const chosen = (len: number, k: number, i: number) => len <= k || Math.floor(i * k / len) !== Math.floor((i - 1) * k / len)
