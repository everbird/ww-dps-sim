// src/analysis/fit.ts —— 录像剖析的贴合度（DD-09 §4；架构 §10.3）。④ 分析层，纯库：不读盘；命令行在 src/cli/fit.ts。
// 录像剖析的模糊探索是为了更贴合录像（切人与技能的时刻、切人类型、血条、协奏环与回路条、跳字），不是搜 DPS 更高的轴（2026-10-27 用户说明）。
// 做法（DD-09 §4）：
//   1. 观测有固定的 ID 与通道（observations.ts 的 videoObservations）；
//   2. 按通道一对一、保序匹配（alignSequences）；血条、协奏环、回路条取那一刻的值；
//   3. 先资格后排序：评分集合事先定（FitScoreDef），资格签名 = 有没有定性冲突 + 评分集合里匹配上的观测 + 覆盖的通道 + 窗口完整，
//      只在签名相同的组里按 score 排；跨组不排总名次，只列覆盖与冲突的差别；
//   4. 规则候选（翻台账里的候选，经 DD-04 的分类）与改轴候选（挪、删、对调动作）分两张表；
//   5. 引擎错误在分组之前排除；不可评估的不进任何组。
// score 只用来在同一组里排序，没有概率意义。"贴合"不等于"机制对"；同步补上的状态也不等于恢复了历史（路线图 §9.3）。
import type { GameData } from '../data/gamedata'
import { expandReplayCombos, type FillCombo } from '../data/replay'
import { videoTime, type Scenario } from '../data/scenario.schema'
import {
  digestOf, prepareRun, PROPOSITIONS, runPrepared,
  type EventHandle, type ResolvedScenario, type RunCompletion, type RunOverrides, type SimEvent, type SimResult,
} from '../engine'
import { classifyCandidates, type CandidateRef } from './candidates'
import {
  alignSequences, CHANNELS, EVENT_CHANNELS, frozenSwitches, videoObservations,
  type Channel, type VideoObservation,
} from './observations'
import { lineText, neighborIter, parseLines } from './search'
import { compareMarks, hpPoints, resourceSteps, resourceTracks, traceCommands } from './trace'

export type { Channel } from './observations'
export { CHANNELS } from './observations'
type Video = NonNullable<Scenario['video']>

// ---------------------------------------------------------------------------
// 评分定义（DD-09 §4.4）

/** 评分定义：参与排名的观测（事先定）、各通道残差折成同一单位的系数、各通道的容差（最早偏差用）、匹配窗口。它的摘要是报告身份的一部分 */
export interface FitScoreDef {
  readonly scoreObservationIds: readonly string[]
  readonly weights: Readonly<Record<Channel, number>>
  readonly tolerances: Readonly<Record<Channel, number>>
  readonly windowSeconds: number
}

/** 各通道的残差折成"秒"的系数：切人、前台动作每秒 1；后台来源 0.5；跳字、血条每 1% 记 0.5（比例差 × 50）；协奏环、回路条每 1% 记 0.1。
 *  score = Σ 通道系数 × 该通道评分观测的平均绝对残差 */
export const DEFAULT_FIT_WEIGHTS: Readonly<Record<Channel, number>> = { switch: 1, action: 1, summon: 0.5, hit: 50, hp: 50, concerto: 10, core: 10 }
/** 各通道的容差：时刻（秒）、跳字（相对差，同观测 DEFAULT_TOLERANCE.hit）、比例（血条、协奏环、回路条）。
 *  跳字在标明的分支上超出容差是定性冲突；其余通道超出容差只是残差大（最早偏差会指到它） */
export const DEFAULT_FIT_TOLERANCES: Readonly<Record<Channel, number>> = { switch: 0.5, action: 0.5, summon: 1, hit: 0.002, hp: 0.03, concerto: 0.1, core: 0.1 }
/** 一条观测只在这么多秒之内找仿真事件 */
export const FIT_WINDOW_SECONDS = 10

/** 评分集合只能放评分用的观测：被用作输入的（!given，同步的依据）不能再拿来评分（DD-09 §3.2：同一项读数不能两用），
 *  只展示的（!display）也不进（§4.4 第 2 条）。显式给子集、直接传评分定义的入口都查（Codex 审查 F9） */
function checkScoreIds(obs: readonly VideoObservation[], ids: readonly string[]): void {
  const byId = new Map(obs.map(o => [o.id, o]))
  const unknown = ids.filter(id => !byId.has(id))
  if (unknown.length) throw new Error(`评分集合里有不存在的观测：${unknown.join('、')}`)
  const wrong = ids.filter(id => byId.get(id)!.purpose !== 'score')
  if (wrong.length)
    throw new Error(`评分集合只能放评分用的观测：${wrong.map(id => `${id}（!${byId.get(id)!.purpose}）`).join('、')} 不行——`
      + '!given 是同步用的输入，同一项读数不能再拿来评分；!display 只展示（DD-09 §3.2、§4.4）')
}

/** 缺省的评分定义：评分集合是全部不带 !given、!display 的观测；也可以给一个子集（只能是这些观测的 ID） */
export function scoreDefOf(obs: readonly VideoObservation[], over: Partial<FitScoreDef> = {}): FitScoreDef {
  const ids = over.scoreObservationIds ?? obs.filter(o => o.purpose === 'score').map(o => o.id)
  checkScoreIds(obs, ids)
  return {
    scoreObservationIds: [...ids],
    weights: { ...DEFAULT_FIT_WEIGHTS, ...over.weights },
    tolerances: { ...DEFAULT_FIT_TOLERANCES, ...over.tolerances },
    windowSeconds: over.windowSeconds ?? FIT_WINDOW_SECONDS,
  }
}

// ---------------------------------------------------------------------------
// 一次运行的贴合度（DD-09 §4.2–§4.4）

export type FitStatus = 'matched' | 'conflicted' | 'ambiguous' | 'unmatched' | 'uncovered'

/** 一条观测的结果。residual 按通道：切人、动作、后台来源是时刻差（仿真 − 录像，秒）；跳字是相对差（仿真 / 录像 − 1，按标明的分支，
 *  分支未知时取在容差内的那一支、都不在取较近的）；血条、协奏环、回路条是比例差（仿真 − 录像）。sim：仿真那一刻的值（时刻的通道是仿真事件的视频秒） */
export interface ObservationFit {
  readonly id: string
  readonly channel: Channel
  readonly t: number                                   // 录像里的时刻（视频秒）
  readonly scored: boolean                             // 在不在评分集合里
  readonly status: FitStatus
  readonly residual?: number
  readonly sim?: number
  readonly simEvent?: EventHandle
  readonly candidates?: readonly EventHandle[]
  readonly mayBeUnmatched?: true                       // 存在同样好的、让它落单的对齐（只是说明）
  readonly conflict?: string                           // 'switchType: 录像 intro，仿真 normal'；'hit: 暴击支 +3.1% 超出容差 0.2%'
  readonly note?: string                               // 落单、没覆盖到的原因
}

export interface Eligibility {
  readonly hasQualitativeConflict: boolean
  readonly matchedScoreIds: readonly string[]           // 评分集合里匹配上的（排序后）
  readonly channelsCovered: readonly Channel[]
  readonly windowComplete: boolean                      // 运行覆盖了到最后一条评分观测为止的时间，且状态不是失败
  readonly signature: string                            // 以上四项的摘要
}

export interface ChannelResidual { readonly n: number; readonly mae: number; readonly rmse: number; readonly mean: number }

export interface FitResult {
  readonly runId: string
  readonly fillCombo?: string
  readonly completion: RunCompletion
  readonly assessable: boolean
  readonly unassessableReason?: string
  readonly anchors: number                              // 对上的时间锚点（video.marks）个数
  readonly observations: readonly ObservationFit[]
  readonly eligibility: Eligibility
  readonly residualByChannel: Readonly<Partial<Record<Channel, ChannelResidual>>>
  readonly score: number | null                         // 只在同一签名的组里可比
  readonly earliestDeviation: { readonly observationId: string; readonly videoSeconds: number; readonly channel: Channel } | null
  /** 有条件推演（DD-09 §3.2）：第一次外部干预的视频秒；没有干预为 null */
  readonly conditionedFrom: number | null
}

export interface ReplayFitOptions {
  /** 观测列表：不给时由 video 现取（没写 video.switches 时按这次运行的装配结果冻结切人参照——变体要共用原场景冻结的那份，fitVariants 会传进来） */
  readonly observations?: readonly VideoObservation[]
  readonly scoreDef?: FitScoreDef
  readonly fillCombo?: string
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`

/** 观测写的动作名 → 仿真的动作 ID（原样、或这个角色的别名）；角色不在队里时原样返回（配不上） */
function actionIdOf(r: ResolvedScenario, char: string, name: string): string {
  const m = r.team.find(x => x.def.name === char)
  if (!m) return name
  return Object.hasOwn(m.actions, name) ? name : m.aliases[name] ?? name
}

interface SimItem { readonly seq: number; readonly f: number; readonly e: SimEvent }

/** 一次运行对录像的贴合度。r、res 是同一次运行；video 是原场景的（变体不改它） */
export function replayFit(r: ResolvedScenario, res: SimResult, video: Video, opts: ReplayFitOptions = {}): FitResult {
  const obs = opts.observations ?? videoObservations(video, video.switches?.length ? [] : frozenSwitches(r, video))
  const def = opts.scoreDef ?? scoreDefOf(obs)
  if (opts.scoreDef) checkScoreIds(obs, def.scoreObservationIds)
  const scored = new Set(def.scoreObservationIds)
  // 时间对齐：按第一个对上的锚点（视频秒 ↔ 世界帧，视图 F、pnpm trace 同样）
  const cmds = traceCommands(res.log, r, video.loop)
  const cmp = compareMarks(cmds, video.marks)
  const first = cmp.rows[0]
  const f0 = first ? cmds.find(c => c.line === first.line)!.f : 0
  const v0 = first ? videoTime(video.marks[String(first.line)]!) : 0
  const vsec = (f: number) => v0 + (f - f0) / 60
  const frameOf = (t: number) => f0 + (t - v0) * 60
  const lastFrame = res.completion.coverage.completedTicks
  const handle = (seq: number): EventHandle => ({ runId: res.runId, eventSeq: seq })
  const out = new Map<string, ObservationFit>()

  // ---- 按事件匹配的四个通道
  const items: Record<'switch' | 'action' | 'summon' | 'hit', SimItem[]> = { switch: [], action: [], summon: [], hit: [] }
  res.log.forEach((e, seq) => {
    if (e.type === 'switch') items.switch.push({ seq, f: e.f, e })
    else if (e.type === 'actionStart') { items.action.push({ seq, f: e.f, e }); items.summon.push({ seq, f: e.f, e }) }
    else if (e.type === 'judgmentSpawn' || e.type === 'outro') items.summon.push({ seq, f: e.f, e })
    else if (e.type === 'hit' && e.dmg) items.hit.push({ seq, f: e.f, e })
  })
  const keyMatch = (o: VideoObservation, e: SimEvent): boolean => {
    switch (o.channel) {
      case 'switch': return e.type === 'switch' && e.from === o.from && e.to === o.to
      case 'action': return e.type === 'actionStart' && e.char === o.char && e.action === actionIdOf(r, o.char, o.action)
      case 'summon':
        if (e.type === 'actionStart') return e.char === o.char && e.action === actionIdOf(r, o.char, o.action)
        if (e.type === 'judgmentSpawn') return e.char === o.char && e.judgment === o.action
        return e.type === 'outro' && e.char === o.char && o.action === '延奏'
      case 'hit': {
        // 判定名可写成"动作/判定"（同名判定在几个动作里都有时，如照世·E 与应世 E 的 E-2）
        if (e.type !== 'hit' || e.char !== o.char) return false
        const k = o.judgment.lastIndexOf('/')
        return k < 0 ? e.judgment === o.judgment : e.judgment === o.judgment.slice(k + 1) && e.action === actionIdOf(r, o.char, o.judgment.slice(0, k))
      }
      default: return false
    }
  }
  for (const ch of EVENT_CHANNELS as ('switch' | 'action' | 'summon' | 'hit')[]) {
    const list = obs.filter(o => o.channel === ch)
    // 评分集合与其余的分开匹配：只展示的观测不跟评分的抢事件
    for (const part of [list.filter(o => scored.has(o.id)), list.filter(o => !scored.has(o.id))]) {
      if (part.length === 0) continue
      const os = [...part].sort((a, b) => a.t - b.t)
      const evs = items[ch].filter(x => os.some(o => keyMatch(o, x.e) && Math.abs(vsec(x.f) - o.t) <= def.windowSeconds))
      const a = alignSequences(os.map(o => o.t), evs.map(x => vsec(x.f)),
        (i, j) => keyMatch(os[i]!, evs[j]!.e) && Math.abs(vsec(evs[j]!.f) - os[i]!.t) <= def.windowSeconds)
      os.forEach((o, i) => {
        const base = { id: o.id, channel: o.channel, t: o.t, scored: scored.has(o.id) }
        const j = a.pairs[i]
        if (j === null || j === undefined) {
          const beyond = frameOf(o.t) > lastFrame
          out.set(o.id, { ...base, status: beyond ? 'uncovered' : 'unmatched', note: beyond ? `运行在视频 ${vsec(lastFrame).toFixed(2)} 秒就停了` : `${def.windowSeconds} 秒内没有能一对一配上的仿真事件` })
          return
        }
        const x = evs[j]!, simT = vsec(x.f)
        const extra = {
          simEvent: handle(x.seq), sim: simT,
          ...(a.mayBeUnmatched[i] ? { mayBeUnmatched: true as const } : {}),
        }
        const alt = a.alternatives[i]
        if (alt) {
          // 跳字的残差照样按数值算（配上的那一下），时刻的通道按时刻差
          const hv = o.channel === 'hit' && x.e.type === 'hit' ? hitCheck(o, x.e.dmg!, def.tolerances.hit) : null
          const candidates = alt.map(k => handle(evs[k]!.seq))
          // 匹配身份的歧义与定性冲突分开判（DD-09 §4.2；Codex 审查 F8）：可配的每一个仿真事件都与录像定性冲突，
          // 配哪个都冲突——这是确定的冲突，不藏在 ambiguous 里；有的冲突、有的不冲突，才是分不清的 ambiguous
          const conflicts = alt.map(k => qualitativeConflict(o, evs[k]!.e, def.tolerances.hit))
          const n = conflicts.filter(c => c !== null).length
          if (n === alt.length) {
            const mine = conflicts[alt.indexOf(j)] ?? conflicts.find(c => c !== null)!
            out.set(o.id, {
              ...base, ...extra, ...(hv ? { sim: hv.sim } : {}), status: 'conflicted', residual: hv ? hv.residual : simT - o.t, candidates,
              conflict: `${mine}（${alt.length} 个可配的仿真事件都冲突）`,
            })
            return
          }
          out.set(o.id, {
            ...base, ...extra, ...(hv ? { sim: hv.sim } : {}), status: 'ambiguous', residual: hv ? hv.residual : simT - o.t, candidates,
            ...(n > 0 ? { note: `${alt.length} 个可配的仿真事件里有 ${n} 个与录像冲突、${alt.length - n} 个不冲突` } : {}),
          })
          return
        }
        if (o.channel === 'hit' && x.e.type === 'hit') {
          const h = hitCheck(o, x.e.dmg!, def.tolerances.hit)
          out.set(o.id, { ...base, ...extra, sim: h.sim, status: h.conflict ? 'conflicted' : 'matched', residual: h.residual, ...(h.conflict ? { conflict: h.conflict } : {}) })
          return
        }
        if (o.channel === 'switch' && x.e.type === 'switch' && o.type !== null && (o.type === 'intro') !== x.e.intro) {
          out.set(o.id, { ...base, ...extra, status: 'conflicted', residual: simT - o.t, conflict: `switchType: 录像 ${o.type}，仿真 ${x.e.intro ? 'intro' : 'normal'}` })
          return
        }
        out.set(o.id, { ...base, ...extra, status: 'matched', residual: simT - o.t })
      })
    }
  }

  // ---- 取那一刻的值的三个通道：血条（从这只敌人的血条出现起累计仿真伤害）；协奏环、回路条（资源用账本，没带就按日志加干预记录重放，两种逐点相同）
  const hpObs = obs.filter(o => o.channel === 'hp')
  if (hpObs.length) {
    const pts = hpPoints(video, r)
    const dmg = res.log.flatMap(e => (e.type === 'hit' && e.dmg ? [[vsec(e.f), e.dmg.expected] as const] : []))
    hpObs.forEach((o, k) => {
      const p = pts[k]!
      const base = { id: o.id, channel: o.channel, t: o.t, scored: scored.has(o.id) }
      if (frameOf(o.t) > lastFrame) { out.set(o.id, { ...base, status: 'uncovered', note: '运行在这之前就停了' }); return }
      const sim = p.left0 - dmg.reduce((acc, [s, d]) => (s >= p.seg && s < p.t ? acc + d : acc), 0) / p.hp
      out.set(o.id, { ...base, status: 'matched', sim, residual: sim - p.left })
    })
  }
  const resObs = obs.filter((o): o is Extract<VideoObservation, { channel: 'concerto' | 'core' }> => o.channel === 'concerto' || o.channel === 'core')
  if (resObs.length) {
    const ledger = res.diag?.resourceLedger
    const names = r.team.map(m => m.def.name)
    const tracks = resourceTracks(ledger ? [] : resourceSteps(res.log, { interventions: res.interventions, names }), r, ledger)
    for (const o of resObs) {
      const base = { id: o.id, channel: o.channel, t: o.t, scored: scored.has(o.id) }
      const tr = tracks.find(x => x.char === o.char)?.tracks.find(x => (o.channel === 'concerto' ? x.key === 'concerto' : x.key.startsWith('core') && x.name === o.resource))
      if (!tr) throw new Error(`${o.id}：${o.char} 不在队伍里，或没有这项资源${o.channel === 'core' ? `（${o.resource}）` : ''}`)
      const cap = tr.key === 'concerto' ? r.rules.concertoMax : tr.cap
      if (!cap) throw new Error(`${o.id}：${tr.name} 没有上限，折不成比例`)
      const f = frameOf(o.t)
      if (f > lastFrame) { out.set(o.id, { ...base, status: 'uncovered', note: '运行在这之前就停了' }); continue }
      let v = 0
      for (const [ff, vv] of tr.steps) { if (ff > f) break; v = vv }
      out.set(o.id, { ...base, status: 'matched', sim: v / cap, residual: v / cap - o.ratio })
    }
  }

  const observations = obs.map(o => out.get(o.id)!)
  return finish(res, observations, def, {
    anchors: cmp.rows.length, firstLine: first?.line ?? null, lastFrame, frameOf, vsec,
    ...(opts.fillCombo !== undefined ? { fillCombo: opts.fillCombo } : {}),
  })
}

/** 一条观测配一个仿真事件时的定性冲突（DD-09 §4.2：只有切人类型与跳字分支两种）；不冲突为 null */
function qualitativeConflict(o: VideoObservation, e: SimEvent, tol: number): string | null {
  if (o.channel === 'hit' && e.type === 'hit' && e.dmg) return hitCheck(o, e.dmg, tol).conflict ?? null
  if (o.channel === 'switch' && e.type === 'switch' && o.type !== null && (o.type === 'intro') !== e.intro)
    return `switchType: 录像 ${o.type}，仿真 ${e.intro ? 'intro' : 'normal'}`
  return null
}

/** 跳字：按标明的分支比；分支未知时两支都比，有一支在容差内算对上，都不在是冲突 */
function hitCheck(o: Extract<VideoObservation, { channel: 'hit' }>, dmg: NonNullable<Extract<SimEvent, { type: 'hit' }>['dmg']>, tol: number):
  { sim: number; residual: number; conflict?: string } {
  const rel = (sim: number) => sim / o.value - 1
  const nonCrit = { sim: dmg.nonCrit, d: rel(dmg.nonCrit), name: '不暴击支' }, crit = { sim: dmg.crit, d: rel(dmg.crit), name: '暴击支' }
  const pick = o.branch === 'crit' ? [crit] : o.branch === 'nonCrit' ? [nonCrit] : [nonCrit, crit]
  const inside = pick.filter(x => Math.abs(x.d) <= tol + 1e-12)
  if (inside.length) { const x = inside.reduce((a, b) => (Math.abs(b.d) < Math.abs(a.d) ? b : a)); return { sim: x.sim, residual: x.d } }
  const x = pick.reduce((a, b) => (Math.abs(b.d) < Math.abs(a.d) ? b : a))
  const conflict = o.branch === 'unknown'
    ? `hit: 两支都超出容差 ${pct(tol)}（不暴击 ${pct(nonCrit.d)}、暴击 ${pct(crit.d)}）`
    : `hit: ${x.name} ${pct(x.d)} 超出容差 ${pct(tol)}`
  return { sim: x.sim, residual: x.d, conflict }
}

/** 资格、分通道残差、score、最早偏差（DD-09 §4.4） */
function finish(res: SimResult, observations: readonly ObservationFit[], def: FitScoreDef, x: {
  anchors: number; firstLine: number | null; lastFrame: number; frameOf: (t: number) => number; vsec: (f: number) => number; fillCombo?: string
}): FitResult {
  const scoring = observations.filter(o => o.scored)
  const matched = scoring.filter(o => o.status === 'matched')
  const lastT = scoring.length ? Math.max(...scoring.map(o => o.t)) : null
  const status = res.completion.status
  const windowComplete = (status === 'completed' || status === 'truncated') && (lastT === null || x.frameOf(lastT) <= x.lastFrame)
  const matchedScoreIds = matched.map(o => o.id).sort()
  const channelsCovered = CHANNELS.filter(c => matched.some(o => o.channel === c))
  const hasQualitativeConflict = scoring.some(o => o.status === 'conflicted')
  const signature = digestOf({ hasQualitativeConflict, matchedScoreIds, channelsCovered, windowComplete }).slice(0, 16)
  const residualByChannel: Partial<Record<Channel, ChannelResidual>> = {}
  for (const c of CHANNELS) {
    const rs = matched.filter(o => o.channel === c).map(o => o.residual!)
    if (rs.length) residualByChannel[c] = { n: rs.length, mae: mean(rs.map(Math.abs)), rmse: Math.sqrt(mean(rs.map(v => v * v))), mean: mean(rs) }
  }
  // 不可评估：一个锚点都没对上（视频秒 ↔ 世界帧没有依据，DD-03 §8）；或评分集合里除了第一个锚点自己那次切人（残差恒为 0）就没有别的观测
  let unassessableReason: string | undefined
  if (x.anchors === 0) unassessableReason = '没有对上的时间锚点（video.marks）'
  else {
    const self = scoring.filter(o => o.channel === 'switch' && o.simEvent && (res.log[o.simEvent.eventSeq] as { cmd?: { line: number } }).cmd?.line === x.firstLine)
    if (scoring.length - self.length === 0) unassessableReason = '评分集合里除了第一个锚点自己没有别的观测'
  }
  const assessable = unassessableReason === undefined
  const score = !assessable || status === 'engineError'
    ? null
    : CHANNELS.reduce((acc, c) => acc + (residualByChannel[c] ? def.weights[c] * residualByChannel[c]!.mae : 0), 0)
  // 最早检测到的偏差：评分集合里按视频时刻，第一条冲突、落单，或残差超过该通道容差的（只是"最早检测到"，不保证此前的隐藏状态都对）
  const dev = [...scoring].sort((a, b) => a.t - b.t).find(o => o.status === 'conflicted' || o.status === 'unmatched'
    || (o.status === 'matched' && Math.abs(o.residual!) > def.tolerances[o.channel] + 1e-12))
  const first = res.interventions[0]
  return {
    runId: res.runId, ...(x.fillCombo !== undefined ? { fillCombo: x.fillCombo } : {}), completion: res.completion,
    assessable, ...(unassessableReason ? { unassessableReason } : {}), anchors: x.anchors, observations,
    eligibility: { hasQualitativeConflict, matchedScoreIds, channelsCovered, windowComplete, signature },
    residualByChannel, score,
    earliestDeviation: dev ? { observationId: dev.id, videoSeconds: dev.t, channel: dev.channel } : null,
    conditionedFrom: first ? x.vsec(first.f) : null,
  }
}

// ---------------------------------------------------------------------------
// 报告身份（DD-09 §4.4 第 8 条，DF-19）

export interface FitReportIdentity {
  readonly scoreDefDigest: string
  /** 这份报告实际用到的观测内容（读数、单位与时钟、分支、用途、参照）与时间对齐的输入（marks 锚点、对齐规则）的摘要 */
  readonly observationSetDigest: string
  readonly runIds: readonly string[]
  readonly digest: string                              // 以上三项合起来的摘要
}

/** 观测集合的摘要：video 不进执行身份（DD-01 §3.3），只改一个读数或锚点时 runId 不变，这一项会变 */
export function observationSetDigest(obs: readonly VideoObservation[], video: Video): string {
  return digestOf({ observations: obs, anchors: video.marks, loop: video.loop, align: 'firstAnchor', clock: 'videoSeconds↔worldFrames' })
}

export function reportIdentity(def: FitScoreDef, obs: readonly VideoObservation[], video: Video, runIds: readonly string[]): FitReportIdentity {
  const scoreDefDigest = digestOf(def), set = observationSetDigest(obs, video)
  return { scoreDefDigest, observationSetDigest: set, runIds: [...runIds], digest: digestOf({ scoreDefDigest, observationSetDigest: set, runIds }) }
}

/** 两份报告能不能并排比（C09-14）：评分定义或观测内容不同就不能 */
export function comparableReports(a: { identity: FitReportIdentity }, b: { identity: FitReportIdentity }): { ok: true } | { ok: false; reason: string } {
  if (a.identity.scoreDefDigest !== b.identity.scoreDefDigest) return { ok: false, reason: '两份报告的评分定义不同（评分集合、权重、容差或窗口），分数不能互相比' }
  if (a.identity.observationSetDigest !== b.identity.observationSetDigest) return { ok: false, reason: '两份报告用的观测内容或时间锚点不同，分数不能互相比' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 分组与两张表（DD-09 §4.4 第 3–7、9 条）

export interface FitRow {
  readonly desc: string
  readonly kind: 'base' | 'rule' | 'axis'
  readonly fit: FitResult | null
  readonly error?: string                              // 跑之前就失败的（编译不过、装配报错）
  readonly candidate?: CandidateRef                    // 规则候选：台账里的哪一条
}

export interface FitGroup {
  readonly signature: string
  readonly eligibility: Eligibility
  readonly rows: readonly FitRow[]                     // 按 score 从小到大
  /** 与原场景那一组比：多匹配了哪些、少匹配了哪些评分观测，这一组有哪些冲突（不排先后，只列差别） */
  readonly versusBase: { readonly moreMatched: readonly string[]; readonly lessMatched: readonly string[]; readonly conflicts: readonly string[] } | null
}

export interface FitTable {
  readonly groups: readonly FitGroup[]                 // 原场景所在的组排第一
  readonly unassessable: readonly FitRow[]
  readonly engineErrors: readonly FitRow[]             // 引擎错误：不进任何组、没有名次，保留原因
  readonly notRun: readonly FitRow[]                   // 编译不过、装配报错
}

const conflictsOf = (f: FitResult): string[] => f.observations.filter(o => o.scored && o.status === 'conflicted').map(o => `${o.id}（${o.conflict}）`)

/** 一张表：引擎错误先排除，再去掉不可评估的，其余按签名分组、组里按 score 排；base 是原场景（一起分组，好看出谁和它同组） */
export function groupRows(base: FitRow, rows: readonly FitRow[]): FitTable {
  const all = [base, ...rows]
  const engineErrors = all.filter(x => x.fit?.completion.status === 'engineError')
  const notRun = all.filter(x => x.fit === null)
  const live = all.filter(x => x.fit && x.fit.completion.status !== 'engineError')
  const unassessable = live.filter(x => !x.fit!.assessable)
  const bySig = new Map<string, FitRow[]>()
  for (const x of live.filter(x => x.fit!.assessable)) {
    const k = x.fit!.eligibility.signature
    let g = bySig.get(k)
    if (!g) bySig.set(k, (g = []))
    g.push(x)
  }
  const baseFit = base.fit && base.fit.assessable && base.fit.completion.status !== 'engineError' ? base.fit : null
  const groups = [...bySig.entries()].map(([signature, rs]): FitGroup => {
    const e = rs[0]!.fit!.eligibility
    const sorted = [...rs].sort((a, b) => a.fit!.score! - b.fit!.score! || Number(b.kind === 'base') - Number(a.kind === 'base'))
    const versusBase = baseFit ? {
      moreMatched: e.matchedScoreIds.filter(id => !baseFit.eligibility.matchedScoreIds.includes(id)),
      lessMatched: baseFit.eligibility.matchedScoreIds.filter(id => !e.matchedScoreIds.includes(id)),
      conflicts: conflictsOf(rs[0]!.fit!),
    } : null
    return { signature, eligibility: e, rows: sorted, versusBase }
  })
  const baseSig = baseFit?.eligibility.signature
  groups.sort((a, b) => Number(b.signature === baseSig) - Number(a.signature === baseSig)
    || b.eligibility.matchedScoreIds.length - a.eligibility.matchedScoreIds.length
    || Number(a.eligibility.hasQualitativeConflict) - Number(b.eligibility.hasQualitativeConflict)
    || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0))
  return { groups, unassessable, engineErrors, notRun }
}

/** 共有子集的比较（DD-09 §4.4 第 5 条，--common-subset）：只拿两边都 matched 的评分观测重算 score，并列出各自被排除的观测。
 *  只比共有子集，不是整体更贴合 */
export function commonSubset(a: FitResult, b: FitResult, def: FitScoreDef): {
  readonly ids: readonly string[]; readonly scoreA: number; readonly scoreB: number
  readonly excludedA: readonly string[]; readonly excludedB: readonly string[]; readonly note: string
} {
  const ma = new Set(a.eligibility.matchedScoreIds), mb = new Set(b.eligibility.matchedScoreIds)
  const ids = [...ma].filter(id => mb.has(id)).sort()
  const scoreOf = (f: FitResult) => {
    const os = f.observations.filter(o => ids.includes(o.id))
    return CHANNELS.reduce((acc, c) => {
      const rs = os.filter(o => o.channel === c).map(o => Math.abs(o.residual!))
      return acc + (rs.length ? def.weights[c] * mean(rs) : 0)
    }, 0)
  }
  return {
    ids, scoreA: scoreOf(a), scoreB: scoreOf(b),
    excludedA: [...ma].filter(id => !mb.has(id)).sort(), excludedB: [...mb].filter(id => !ma.has(id)).sort(),
    note: '只比共有子集，不是整体更贴合',
  }
}

// ---------------------------------------------------------------------------
// 原场景与变体（DD-09 §4.4 第 7 条）

export interface FitReport {
  readonly scenario: { readonly fillCombo: string }
  readonly identity: FitReportIdentity
  readonly scoreDef: FitScoreDef
  readonly observations: readonly VideoObservation[]
  /** 切人类型的参照：video = 录像读数；scenario = 过渡期从原场景的写法冻结的（不是录像读数） */
  readonly switchReference: 'video' | 'scenario' | 'none'
  readonly base: FitResult
  readonly ruleCandidates: FitTable
  readonly axisVariants: FitTable
  /** 没跑的规则候选：没实现、不适用、和这条轴冲突、策略类（录像里的操作是观测到的输入，不当候选翻） */
  readonly ruleNotRun: readonly { readonly ref: CandidateRef; readonly reason: string }[]
  readonly axisCandidates: number                      // 改轴的候选一共多少条（等距取 n 条跑）
}

export interface FitVariantsOptions {
  readonly n?: number                                  // 改轴候选等距取几条（缺省 60）
  readonly near?: number                               // 挪动只挪到前后几行（缺省 4）
  readonly overrides?: RunOverrides
  readonly scoreDef?: Partial<FitScoreDef>
  readonly rules?: boolean                             // 跑不跑规则候选（缺省跑）
  readonly axis?: boolean                              // 跑不跑改轴候选（缺省跑）
  readonly fillCombo?: string
}

/** 跑一份场景（每个未观测时段只剩一种填法），算它的贴合度 */
function runRow(sc: Scenario, data: GameData, overrides: RunOverrides, desc: string, kind: FitRow['kind'], fitOpts: ReplayFitOptions, video: Video, candidate?: CandidateRef): FitRow {
  const p = prepareRun(sc, data, overrides)
  if (!p.ok) return { desc, kind, fit: null, error: p.issues.map(i => i.message).join('；'), ...(candidate ? { candidate } : {}) }
  const res = runPrepared(p.run)
  if (res.completion.status === 'engineError') {
    // 引擎错误：不算观测（结果作废，架构 §2.2），只留完成状态与原因
    const fit = replayFit(p.run.resolved, res, video, fitOpts)
    return { desc, kind, fit: { ...fit, score: null }, ...(candidate ? { candidate } : {}) }
  }
  return { desc, kind, fit: replayFit(p.run.resolved, res, video, fitOpts), ...(candidate ? { candidate } : {}) }
}

/** 原场景 + 规则候选 + 改轴候选，各自分组排序（两张表互不混排）。场景要已经选定填法组合（expandReplayCombos 之后的一个） */
export function fitVariants(sc: Scenario, data: GameData, opts: FitVariantsOptions = {}): FitReport {
  const video = sc.video
  if (!video) throw new Error('场景没有 video：录像剖析的贴合度要拿录像比')
  const overrides = opts.overrides ?? {}
  const p = prepareRun(sc, data, overrides)
  if (!p.ok) throw new Error(`原场景跑不起来：${p.issues.map(i => i.message).join('；')}`)
  // 观测与切人参照在生成变体之前定下来（DD-09 §4.3）：没写 video.switches 的，从原场景的写法冻结一份，所有变体共用
  const switchReference = video.switches?.length ? 'video' : Object.keys(video.marks).length ? 'scenario' : 'none'
  const obs = videoObservations(video, video.switches?.length ? [] : frozenSwitches(p.run.resolved, video))
  const def = scoreDefOf(obs, opts.scoreDef)
  const fitOpts: ReplayFitOptions = { observations: obs, scoreDef: def, ...(opts.fillCombo !== undefined ? { fillCombo: opts.fillCombo } : {}) }
  const baseRes = runPrepared(p.run)
  const baseFit = replayFit(p.run.resolved, baseRes, video, fitOpts)
  if (baseRes.completion.status === 'engineError') throw new Error(`原场景引擎报错：${baseRes.completion.engineError?.message ?? ''}`)
  if (!baseFit.assessable) throw new Error(`原场景不可评估：${baseFit.unassessableReason}`)
  const base: FitRow = { desc: '原场景', kind: 'base', fit: baseFit }

  // 规则候选：台账里与当前采用值不同的机制候选（DD-04 的分类）；策略类、没实现的、不适用的、和轴冲突的不跑，列出原因
  const ruleRows: FitRow[] = []
  const ruleNotRun: { ref: CandidateRef; reason: string }[] = []
  if (opts.rules !== false) {
    const plan = classifyCandidates(p.run, PROPOSITIONS)
    for (const c of plan.mechanism) {
      const b = c.candidate.binding
      const ov: RunOverrides = b.kind === 'rule'
        ? { ...overrides, rules: { ...overrides.rules, [b.path!]: b.value! } }
        : { ...overrides, options: { ...overrides.options, [b.path!]: b.value } }
      ruleRows.push(runRow(sc, data, ov, `${c.propositionId} → ${c.candidateId}（${b.kind === 'rule' ? 'rules' : 'options'}.${b.path} = ${String(b.value)}）`, 'rule', fitOpts, video, { propositionId: c.propositionId, candidateId: c.candidateId }))
    }
    for (const c of plan.policy) ruleNotRun.push({ ref: { propositionId: c.propositionId, candidateId: c.candidateId }, reason: '策略类：录像里的操作是观测到的输入，不当候选翻' })
    for (const x of plan.excluded) for (const ref of x.candidates) ruleNotRun.push({ ref, reason: x.reason === '改变的是轴的输入' ? '改变的是轴的输入（另一份场景，见证据闭环），不当规则候选翻' : `和这条轴冲突：${x.reason}` })
    for (const ref of plan.unimplemented) ruleNotRun.push({ ref, reason: '没实现' })
    for (const ref of plan.notApplicable) ruleNotRun.push({ ref, reason: '不适用（队里没有这个角色）' })
  }

  // 改轴候选：轴里读到的动作（不是补位的）去掉、挪到前后 near 行之内的同一角色行、与相邻的对调；空出来的行留成空行，条号不变（marks 照旧指得对）
  const axisRows: FitRow[] = []
  let axisCandidates = 0
  if (opts.axis !== false) {
    const lines = parseLines(sc.rotation)
    const has = (char: string, action: string) => p.run.resolved.team.some(m => m.def.name === char && (Object.hasOwn(m.actions, action) || Object.hasOwn(m.aliases, action)))
    const pinned = [...new Set(lines.flatMap(l => ('items' in l ? l.items.filter(i => !i.filler).map(i => i.action) : [])))]
    const gen = () => neighborIter(lines, { move: pinned, drop: pinned, swap: true, has, near: opts.near ?? 4, keepEmpty: true })
    for (const _ of gen()) axisCandidates++
    const k = opts.n ?? 60
    let i = 0
    for (const ch of gen()) {
      if (!chosen(axisCandidates, k, i++)) continue
      axisRows.push(runRow({ ...sc, rotation: ch.lines.map(lineText) }, data, overrides, ch.desc, 'axis', fitOpts, video))
    }
  }

  const runIds = [base, ...ruleRows, ...axisRows].flatMap(x => (x.fit ? [x.fit.runId] : []))
  return {
    scenario: { fillCombo: opts.fillCombo ?? '' },
    identity: reportIdentity(def, obs, video, runIds),
    scoreDef: def, observations: obs, switchReference, base: baseFit,
    ruleCandidates: groupRows(base, ruleRows),
    axisVariants: groupRows(base, axisRows),
    ruleNotRun, axisCandidates,
  }
}

/** 各个填法组合各跑一次原场景（DD-09 §3.1：分别运行、分别报告，不当上下界）。select：只跑这些组合 */
export function fitCombos(sc: Scenario, data: GameData, select?: readonly string[], overrides: RunOverrides = {}): { name: string; fit: FitResult | null; error?: string }[] {
  const video = sc.video
  if (!video) throw new Error('场景没有 video：录像剖析的贴合度要拿录像比')
  const x = expandReplayCombos(sc, select)
  if (!x.ok) throw new Error(x.message)
  return x.combos.map(c => {
    const p = prepareRun(c.scenario, data, overrides)
    if (!p.ok) return { name: c.name, fit: null, error: p.issues.map(i => i.message).join('；') }
    return { name: c.name, fit: replayFit(p.run.resolved, runPrepared(p.run), video, { fillCombo: c.name }) }
  })
}

export type { FillCombo }

/** 从 len 条里等距取 k 条（同 fuzz，结果可重复） */
const chosen = (len: number, k: number, i: number) => len <= k || Math.floor(i * k / len) !== Math.floor((i - 1) * k / len)
