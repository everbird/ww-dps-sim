// src/engine/plan.ts —— 按套路排轴（TD-10 §6.2 ④ 的第一版，⑥ 第 2 步"排回原轴"）：把循环轴拆成套路（同一角色的一行），
//   打乱后重新排顺序，看能不能排回原轴或更好的。每个套路用的次数与原轴一样（多重集合的排列）；相邻两个套路角色不同就插 switch，
//   循环轴开头切到第一个套路的角色。
//   第一版不在卡上排：每个前缀直接跑仿真（启动轴 + 前缀当一轮），按"盈余 = 这一轮的伤害 − 原轴稳态 DPS × 这一轮的时长"留前 width 个
//   （beam search）；排满的完整跑 repeat 轮，按比较口径（TD-10 §3）排名。卡上的抽象模型（§6.2 ④）以后用来提速。
//   用途是检验：排不回原轴，说明启发分或套路的拆法有问题；排出更好的，是要拿实战核对的假设。纯函数，输入场景与数据。
import type { CharName } from '../data/common'
import type { GameData } from '../data/gamedata'
import { parseRotationLine, type Scenario } from '../data/scenario.schema'
import { basisOf } from './analysis'
import { resolveScenario } from './resolve'
import { simulate } from './simulate'

export interface PlanOptions {
  width?: number                            // beam 宽度：每层留几个前缀
  perGroup?: number                         // 同组（剩下的套路、最后一个套路、第一个角色都一样）最多留几个
  /** 前缀怎么打分：rollout（缺省）= 把剩下的套路按原轴里的先后接上、跑完整一轮的 DPS；surplus = 只跑前缀，
   *  "这一轮的伤害 − 原轴稳态 DPS × 时长"。surplus 便宜但短视：攒资源的段（心队雷主的三段补位）会在半路被筛掉（TD-10 §6.2 Q5） */
  scoring?: 'rollout' | 'surplus'
  top?: number                              // 排满的留几个完整跑（≤ width）
}

export interface PlanLeaf {
  routines: string[]                        // 套路的顺序
  lines: string[]                           // 写成的循环轴（切人按实际标"变奏"）
  dps: number                               // 比较口径（有分轮取稳态）
  loopSecs: number | null                   // 稳态每轮战斗秒
  introMissed: number
  isRef: boolean                            // 就是原轴的顺序
}

export interface PlanResult {
  basisLabel: string
  ref: { dps: number; loopSecs: number | null; routines: string[] }
  leaves: PlanLeaf[]                        // 按 DPS 从高到低
  refRank: number | null                    // 原轴的顺序排第几（1 起）；没进最后一层为 null
  library: { line: string; char: CharName; count: number }[]
  prefixRuns: number
  failures: Record<string, number>          // 前缀跑不通的按原因计数（timeout 等超时、comboBroken…）
}

const clean = (line: string) => line.trim().replace(/\s+/g, ' ')
function charOf(line: string): CharName | null {
  const p = parseRotationLine(line)
  if ('error' in p || p.length === 0 || !p.every(it => it.kind === 'act')) return null
  return p[0]!.kind === 'act' ? p[0]!.char : null
}

const endsFiller = (r: string) => /~\S*$/.test(r.split(' ').at(-1) ?? '')

/** 套路序列写成循环轴：开头切到第一个套路的角色，之后角色变了就切。上一个套路以补位（~）结尾时写"switch X 变奏"
 *  （补位后面只能接同一角色的动作或写了"变奏"的切人，TD-09 §3.2）；循环轴开头的切人看最后一个套路 */
export function renderRoutines(routines: readonly string[]): string[] {
  const out: string[] = []
  let cur: CharName | null = null
  routines.forEach((r, i) => {
    const c = charOf(r)!
    const prev = i === 0 ? routines.at(-1)! : routines[i - 1]!
    if (c !== cur) out.push(`switch ${c}${endsFiller(prev) ? ' 变奏' : ''}`)
    out.push(r)
    cur = c
  })
  return out
}

/** 原轴里的套路（循环轴里同一角色的出招行），按出现顺序；不是这种写法的行（wait、at…）报错：第一版只排纯套路的轴 */
export function routineSequence(rotation: readonly string[]): string[] {
  const seq: string[] = []
  for (const raw of rotation) {
    const line = clean(raw)
    if (!line) continue
    if (/^switch\s/.test(line)) continue
    if (!charOf(line)) throw new Error(`循环轴里"${line}"不是同一角色的出招行，第一版只排由套路与切人组成的轴`)
    seq.push(line)
  }
  return seq
}

export function planRotation(sc: Scenario, data: GameData, opts: PlanOptions = {}): PlanResult {
  const width = opts.width ?? 24
  const perGroup = opts.perGroup ?? 3
  const scoring = opts.scoring ?? 'rollout'
  const top = Math.min(opts.top ?? width, width)
  const refSeq = routineSequence(sc.rotation)
  const counts = new Map<string, number>()
  for (const r of refSeq) counts.set(r, (counts.get(r) ?? 0) + 1)
  const library = [...counts].map(([line, count]) => ({ line, char: charOf(line)!, count }))
  const openingLast = [...sc.opening].reverse().map(l => charOf(clean(l))).find(c => c !== null)
    ?? sc.team[sc.initial.onField]!.char

  const run = (rotation: string[], repeat: number) => {
    const variant: Scenario = { ...sc, rotation, options: { ...sc.options, repeat } }
    let r
    try { r = resolveScenario(variant, data) } catch { return null }                 // 编译不过
    return simulate(r)
  }
  const refRes = run(sc.rotation, sc.options.repeat)
  if (!refRes || refRes.error) throw new Error('原轴跑不通')
  // 写了"变奏"却没变奏（轴可能有问题，TD-09 §3.5）：比原轴多的不要。补位结尾的套路后面只能写"switch X 变奏"，
  // 放错位置（协奏攒不满）就会这样
  const missed = (res: NonNullable<ReturnType<typeof run>>, loop?: number) =>
    res.log.filter(e => e.type === 'warning' && e.code === 'introMissed' && (loop === undefined || e.cmd?.loop === loop)).length
  const refMissed = missed(refRes)
  // 出场技（"A2-地面出场技""A3-地面出场技"…）只在普通切人入场后按 A 才有（m0-confirm §11 V10）；变奏入场后接出场技的不要。
  // 调度器现在不查这一条（以后挪进去，TD-10 §6.2 ⑦），轴搜索也会碰到
  const entryMismatch = (res: NonNullable<ReturnType<typeof run>>, loop?: number) => {
    const lastSwitch = new Map<string, boolean>()                 // 角色 → 最近一次切入是不是变奏
    let n = 0
    for (const e of res.log) {
      if (e.type === 'switch') lastSwitch.set(e.to, e.intro)
      else if (e.type === 'actionStart' && e.action.includes('出场技') && lastSwitch.get(e.char) === true && (loop === undefined || e.cmd?.loop === loop)) n++
    }
    return n
  }
  const refMismatch = entryMismatch(refRes)
  const bad = (res: NonNullable<ReturnType<typeof run>>, loop?: number) =>
    (refMissed === 0 && missed(res, loop) > 0) || (refMismatch === 0 && entryMismatch(res, loop) > 0)
  const refBasis = basisOf(refRes)
  const secsOf = (s: typeof refRes.summary) => (s.steady ? s.steady.frames / (s.steady.to - s.steady.from + 1) / 60 : null)

  // beam search：每层给每个前缀接一个还没用完的套路
  type Node = { seq: string[]; score: number; tier: number }   // tier 1：补完一轮跑通（score 是那一轮的 DPS）；0：只有前缀的盈余
  let beam: Node[] = [{ seq: [], score: 0, tier: 0 }]
  const loop1 = (res: NonNullable<ReturnType<typeof run>>) => res.summary.perLoop?.find(p => p.loop === 1)
  /** 剩下的套路按原轴里的先后接上 */
  const complete = (seq: readonly string[]): string[] => {
    const left = new Map(counts)
    for (const r of seq) left.set(r, left.get(r)! - 1)
    return [...seq, ...refSeq.filter(r => { const n = left.get(r)!; if (n <= 0) return false; left.set(r, n - 1); return true })]
  }
  let prefixRuns = 0
  const failures: Record<string, number> = {}
  for (let depth = 0; depth < refSeq.length; depth++) {
    const next = new Map<string, Node>()
    for (const node of beam) {
      const used = new Map<string, number>()
      for (const r of node.seq) used.set(r, (used.get(r) ?? 0) + 1)
      for (const { line, char, count } of library) {
        if ((used.get(line) ?? 0) >= count) continue
        if (depth === 0 && char === openingLast) continue           // 循环轴要从切人开始：第一个套路的角色不能是启动轴最后在前台的
        const seq = [...node.seq, line]
        const key = seq.join(' | ')
        if (next.has(key)) continue
        if (depth === refSeq.length - 1 && char === charOf(seq[0]!)) continue   // 首尾同一个人：下一轮开头的切人切不了
        prefixRuns++
        // 前缀以补位结尾：补位后面要接写了"变奏"的切人才编译得过（TD-09 §3.2），补一个切到别人的（排满时切回开头的角色）
        const last = charOf(line)!
        const to = charOf(seq[0]!) !== last ? charOf(seq[0]!)! : sc.team.find(m => m.char !== last)!.char
        const res = run([...renderRoutines(seq), ...(endsFiller(line) ? [`switch ${to} 变奏`] : [])], 1)
        if (!res) { failures['compile'] = (failures['compile'] ?? 0) + 1; continue }
        if (res.error) { failures[res.error.code] = (failures[res.error.code] ?? 0) + 1; continue }
        const loop = loop1(res)
        if (!loop) { failures['noLoop'] = (failures['noLoop'] ?? 0) + 1; continue }
        if (refMissed === 0 && missed(res, 1) > 0) { failures['introMissed'] = (failures['introMissed'] ?? 0) + 1; continue }
        if (refMismatch === 0 && entryMismatch(res, 1) > 0) { failures['entryMismatch'] = (failures['entryMismatch'] ?? 0) + 1; continue }
        let cand: Node = { seq, score: loop.damage - refBasis.dps * (loop.frames / 60), tier: 0 }
        const full = complete(seq)
        if (scoring === 'rollout' && charOf(full.at(-1)!) !== charOf(full[0]!)) {
          prefixRuns++
          const rr = run(renderRoutines(full), 1)
          const l = rr && !rr.error && !bad(rr, 1) ? loop1(rr) : undefined
          if (l) cand = { seq, score: l.dps, tier: 1 }
        }
        next.set(key, cand)
      }
    }
    // 同组只留最好的一个（查询优化器"按子计划 + 要紧的性质"去重，TD-10 §6.2 ④）：剩下哪些套路、最后一个套路、第一个角色都一样的前缀，
    // 往后能接的完全一样，只是已经打出的盈余不同；不去重的话 beam 会被同一组的不同排法占满，最后接不回循环开头
    const groups = new Map<string, number>()
    beam = []
    for (const n of [...next.values()].sort((a, b) => b.tier - a.tier || b.score - a.score)) {
      const rest = library.flatMap(({ line, count }) => Array(count - n.seq.filter(x => x === line).length).fill(line)).join(' | ')
      const k = `${charOf(n.seq[0]!)}#${n.seq.at(-1)}#${rest}`
      const had = groups.get(k) ?? 0
      if (had >= perGroup) continue
      groups.set(k, had + 1)
      beam.push(n)
      if (beam.length >= width) break
    }
    if (beam.length === 0) break
  }

  // 排满的：完整跑，按比较口径排名；切人按实际标"变奏"
  const refKey = refSeq.join(' | ')
  const leaves: PlanLeaf[] = []
  for (const node of beam.filter(n => n.seq.length === refSeq.length).slice(0, top)) {
    const plain = renderRoutines(node.seq)
    const res = run(plain, sc.options.repeat)
    if (!res) { failures['compile'] = (failures['compile'] ?? 0) + 1; continue }
    if (res.error) { failures[res.error.code] = (failures[res.error.code] ?? 0) + 1; continue }
    if (missed(res) > refMissed) { failures['introMissed'] = (failures['introMissed'] ?? 0) + 1; continue }
    if (entryMismatch(res) > refMismatch) { failures['entryMismatch'] = (failures['entryMismatch'] ?? 0) + 1; continue }
    const introAt = new Set(res.log.flatMap(e => (e.type === 'switch' && e.intro && e.cmd?.loop === 2 ? [e.cmd.line] : [])))
    leaves.push({
      routines: node.seq,
      lines: plain.map((l, i) => (introAt.has(i + 1) && !l.endsWith(' 变奏') ? `${l} 变奏` : l)),
      dps: basisOf(res).dps, loopSecs: secsOf(res.summary),
      introMissed: res.summary.warnings.filter(w => w.code === 'introMissed').length,
      isRef: node.seq.join(' | ') === refKey,
    })
  }
  leaves.sort((a, b) => b.dps - a.dps)
  const refIdx = leaves.findIndex(l => l.isRef)
  return {
    basisLabel: refBasis.label,
    ref: { dps: refBasis.dps, loopSecs: secsOf(refRes.summary), routines: refSeq },
    leaves, refRank: refIdx >= 0 ? refIdx + 1 : null, library, prefixRuns, failures,
  }
}
