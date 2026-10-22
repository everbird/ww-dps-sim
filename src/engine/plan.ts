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
  /** 每个套路用的次数可以比原轴多 / 少几次（缺省 0 = 次数不变，只换顺序；TD-10 §6.2 ④′）。次数变了的按每秒伤害比，
   *  比如多补一段补位、少一段攻击 */
  vary?: number
  extra?: number                            // vary > 0 或有另加的套路时，一轮的套路总数最多比原轴多 / 少几个（缺省 2）
  /** 另外自动生成套路（generateRoutines，TD-10 §6.2 Q6）：各人单放 E、R、Q，原轴各行在连段之外的地方拆成两半；每轮最多各用 1 次 */
  gen?: boolean
}

export interface PlanLeaf {
  routines: string[]                        // 套路的顺序
  counts: Record<string, number>            // 次数与原轴不同的套路：套路 → 差几次（+1 多用一次）；次数不变时为空
  lines: string[]                           // 写成的循环轴（切人按实际标"变奏"）
  dps: number                               // 比较口径（有分轮取稳态）
  loopSecs: number | null                   // 稳态每轮战斗秒
  introMissed: number
  isRef: boolean                            // 就是原轴的顺序
  same: number                              // 另有几种写法跑出来完全一样（DPS、每轮时长都相同：多半是补位被跳过，挪到哪都一样），只列这一条
}

export interface PlanResult {
  basisLabel: string
  ref: { dps: number; loopSecs: number | null; routines: string[] }
  leaves: PlanLeaf[]                        // 按 DPS 从高到低
  refRank: number | null                    // 原轴的顺序排第几（1 起）；没进最后一层为 null
  library: { line: string; char: CharName; count: number; added: boolean }[]   // added：场景 search.routines 另加的（原轴里 0 次）
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

/** 自动生成的套路（TD-10 §6.2 Q6，按动作表）：
 *  - 单放：队里每人的 E、R、Q（首位声骸技能）各一个；
 *  - 拆两半：原轴（refSeq）的每行在"自然的断点"切一刀——技能、大招、声骸技能、重击这类（动作类别不是普攻、不是补位）之前；
 *    切在普攻连段中间的不要（A2–A5 接不上，切完也只是零碎的 A）。两半各成一个套路（"辅助拆两半"，中间夹谁由排轴决定）。
 *  跑不通的（R 能量不够、要前置状态…）由仿真剪掉；生成的与原轴里的重复时不另加 */
export function generateRoutines(sc: Scenario, data: GameData, refSeq: readonly string[]): string[] {
  const out = new Set<string>()
  for (const m of sc.team) for (const k of ['E', 'R', 'Q']) out.add(`${m.char} ${k}`)
  for (const line of refSeq) {
    const [char, ...tokens] = line.split(' ')
    const ch = data.characters[char!]
    // 一组 = 一个动作的写法加上跟在后面的修饰（+N、!）
    const groups: string[][] = []
    for (const t of tokens) {
      if (/^(\+\d+|!)$/.test(t) && groups.length) groups.at(-1)!.push(t)
      else groups.push([t])
    }
    for (let i = 1; i < groups.length; i++) {
      const tok = groups[i]![0]!
      if (/~/.test(tok)) continue                                       // 补位
      const name = tok.replace(/[~?!]+$/, '').replace(/\+\d+$/, '')
      const def = ch?.actions[ch.aliases[name] ?? name]
      if (def && (def.kind === 'normal' || def.comboFrom?.length)) continue   // 普攻、连段后续；Q（声骸）等找不到定义的算断点
      out.add([char, ...groups.slice(0, i).flat()].join(' '))
      out.add([char, ...groups.slice(i).flat()].join(' '))
    }
  }
  return [...out].filter(l => !refSeq.includes(l))
}

/** 套路库（循环轴与启动轴共用）：原轴的各行（次数 ± vary）与场景 search.routines 另加的（原轴里 0 次，每轮 0 到 max 次，
 *  TD-10 §6.2 ① (b)）；有次数可变或另加的时，套路总数可以多 / 少 extra 个（缺省 2） */
function libraryOf(sc: Scenario, refSeq: readonly string[], vary: number, extraOpt: number | undefined, generated: readonly string[] = []) {
  const written = (sc.search?.routines ?? []).map(r => (typeof r === 'string' ? { line: clean(r), max: 1 } : { line: clean(r.line), max: r.max }))
  const added = [...written, ...generated.filter(g => !refSeq.includes(g) && !written.some(w => w.line === g)).map(line => ({ line, max: 1 }))]
  for (const { line } of added) {
    const c = charOf(line)
    if (!c) throw new Error(`search.routines 里"${line}"不是同一角色的出招行`)
    if (!sc.team.some(m => m.char === c)) throw new Error(`search.routines 里"${line}"：${c} 不在队伍里`)
    if (refSeq.includes(line)) throw new Error(`search.routines 里"${line}"轴里已经有了，要多用几次请用 --vary`)
  }
  const extra = vary > 0 || added.length > 0 ? extraOpt ?? 2 : 0
  const counts = new Map<string, number>()
  for (const r of refSeq) counts.set(r, (counts.get(r) ?? 0) + 1)
  const library = [
    ...[...counts].map(([line, count]) => ({ line, char: charOf(line)!, count, lo: Math.max(0, count - vary), hi: count + vary, added: false })),
    ...added.map(({ line, max }) => ({ line, char: charOf(line)!, count: 0, lo: 0, hi: max, added: true })),
  ]
  const usedOf = (seq: readonly string[]) => library.map(l => seq.filter(x => x === l.line).length)
  return { library, counts, extra, minLen: Math.max(2, refSeq.length - extra), maxLen: refSeq.length + extra, usedOf }
}

export function planRotation(sc: Scenario, data: GameData, opts: PlanOptions = {}): PlanResult {
  const width = opts.width ?? 24
  const perGroup = opts.perGroup ?? 3
  const scoring = opts.scoring ?? 'rollout'
  const top = Math.min(opts.top ?? width, width)
  const vary = opts.vary ?? 0
  const refSeq = routineSequence(sc.rotation)
  const { library, counts, extra, minLen, maxLen, usedOf } = libraryOf(sc, refSeq, vary, opts.extra, opts.gen ? generateRoutines(sc, data, refSeq) : [])
  /** 能当一整轮：每个套路的次数都在范围里、长度在范围里、首尾不是同一个人（下一轮开头的切人切不了） */
  const closable = (seq: readonly string[]) => seq.length >= minLen && charOf(seq[0]!) !== charOf(seq.at(-1)!)
    && usedOf(seq).every((n, i) => n >= library[i]!.lo && n <= library[i]!.hi)
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
  // 出场技只在普通切人入场后第一个出：调度器报错 entrySkill（TD-09 §3.5），同其他跑不通的一起剪掉
  const bad = (res: NonNullable<ReturnType<typeof run>>, loop?: number) => refMissed === 0 && missed(res, loop) > 0
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
  // 能当一整轮的前缀（vary = 0 时就是排满的最后一层）：分数是它自己当一轮的 DPS
  const pool = new Map<string, Node>()
  for (let depth = 0; depth < maxLen; depth++) {
    const next = new Map<string, Node>()
    for (const node of beam) {
      const used = new Map<string, number>()
      for (const r of node.seq) used.set(r, (used.get(r) ?? 0) + 1)
      for (const { line, char, hi } of library) {
        if ((used.get(line) ?? 0) >= hi) continue
        if (depth === 0 && char === openingLast) continue           // 循环轴要从切人开始：第一个套路的角色不能是启动轴最后在前台的
        const seq = [...node.seq, line]
        const key = seq.join(' | ')
        if (next.has(key)) continue
        if (depth === maxLen - 1 && char === charOf(seq[0]!)) continue   // 首尾同一个人：下一轮开头的切人切不了，也接不了别的了
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
      const k = `${charOf(n.seq[0]!)}#${n.seq.at(-1)}#${usedOf(n.seq).join(',')}`   // 用了哪些套路各几次
      const had = groups.get(k) ?? 0
      if (had >= perGroup) continue
      groups.set(k, had + 1)
      beam.push(n)
      if (beam.length >= width) break
    }
    // 原轴的前缀一定留着（超出 width 也留）：原轴总能排满、当基准；不然它可能在半路被筛掉，排出来的全比原轴差也看不出
    const refPrefix = next.get(refSeq.slice(0, depth + 1).join(' | '))
    if (depth < refSeq.length && refPrefix && !beam.includes(refPrefix)) beam.push(refPrefix)
    if (beam.length === 0) break
    // 能当一整轮的进候选。次数不变时（vary = 0、没有另加的套路）补完一轮什么都没补，分数就是它自己当一轮。次数可变时一轮的长度变了，
    // 第一轮里冷却还卡不住（缩短的轮到第 2 轮才等大招冷却、等超时），所以跑两轮、取第 2 轮
    for (const n of beam) {
      if (!closable(n.seq)) continue
      const key = n.seq.join(' | ')
      if (extra === 0 && n.tier === 1 && complete(n.seq).length === n.seq.length) { pool.set(key, n); continue }
      const rounds = extra === 0 ? 1 : 2
      prefixRuns++
      const rr = run(renderRoutines(n.seq), rounds)
      const l = rr && !rr.error && !bad(rr) ? rr.summary.perLoop?.find(p => p.loop === rounds) : undefined
      if (l) pool.set(key, { seq: n.seq, score: l.dps, tier: 1 })
    }
  }

  // 排满的：完整跑，按比较口径排名；切人按实际标"变奏"
  const refKey = refSeq.join(' | ')
  const leaves: PlanLeaf[] = []
  const best = [...pool.values()].sort((a, b) => b.tier - a.tier || b.score - a.score)
  for (const node of (extra === 0 ? beam.filter(n => pool.has(n.seq.join(' | '))) : best).slice(0, top)) {
    const plain = renderRoutines(node.seq)
    const res = run(plain, sc.options.repeat)
    if (!res) { failures['compile'] = (failures['compile'] ?? 0) + 1; continue }
    if (res.error) { failures[res.error.code] = (failures[res.error.code] ?? 0) + 1; continue }
    if (missed(res) > refMissed) { failures['introMissed'] = (failures['introMissed'] ?? 0) + 1; continue }
    const introAt = new Set(res.log.flatMap(e => (e.type === 'switch' && e.intro && e.cmd?.loop === 2 ? [e.cmd.line] : [])))
    const diff = usedOf(node.seq).map((n, i) => n - library[i]!.count)   // 另加的套路 count 为 0，用了几次就是 +几
    leaves.push({
      routines: node.seq,
      counts: Object.fromEntries(library.flatMap((l, i) => (diff[i] ? [[l.line, diff[i]!]] : []))),
      lines: plain.map((l, i) => (introAt.has(i + 1) && !l.endsWith(' 变奏') ? `${l} 变奏` : l)),
      dps: basisOf(res).dps, loopSecs: secsOf(res.summary),
      introMissed: res.summary.warnings.filter(w => w.code === 'introMissed').length,
      isRef: node.seq.join(' | ') === refKey,
      same: 0,
    })
  }
  // 跑出来完全一样的合成一条：留原轴、次数改得少的、短的
  const changes = (l: PlanLeaf) => Object.values(l.counts).reduce((n, d) => n + Math.abs(d), 0)
  leaves.sort((a, b) => b.dps - a.dps || Number(b.isRef) - Number(a.isRef) || changes(a) - changes(b) || a.routines.length - b.routines.length)
  for (let i = leaves.length - 1; i > 0; i--) {
    const [a, b] = [leaves[i - 1]!, leaves[i]!]
    if (Math.abs(a.dps - b.dps) < 1e-6 && a.loopSecs === b.loopSecs) { a.same += b.same + 1; leaves.splice(i, 1) }
  }
  const refIdx = leaves.findIndex(l => l.isRef)
  return {
    basisLabel: refBasis.label,
    ref: { dps: refBasis.dps, loopSecs: secsOf(refRes.summary), routines: refSeq },
    leaves, refRank: refIdx >= 0 ? refIdx + 1 : null, library, prefixRuns, failures,
  }
}

// ---------------------------------------------------------------------------
// 启动轴一起排（TD-10 §6.2 ④′，v0.1.13）：循环轴不动，把启动轴的各行当套路重新排（次数可变、另加的套路同循环轴）。
// 启动轴只跑一次，稳态几乎不受它影响，所以按整个窗口的 DPS 比；每个前缀把剩下的按原启动轴的先后补完，跑完整的场景打分

export interface OpeningLeaf {
  routines: string[]
  counts: Record<string, number>
  lines: string[]                           // 写成的启动轴（切人按实际标"变奏"）
  dps: number                               // 整个窗口的 DPS
  steady: number | null                     // 稳态 DPS（参考）
  openingSecs: number                       // 启动轴（第 0 轮）的战斗秒
  isRef: boolean
  same: number
}

export interface OpeningResult {
  /** 比较口径：场景 goal 不是稳态时按目标（打死几倍血…，TD-10 §6.3），否则整个窗口 */
  label: string
  ref: { dps: number; steady: number | null; openingSecs: number; routines: string[] }
  leaves: OpeningLeaf[]
  refRank: number | null
  library: { line: string; char: CharName; count: number; added: boolean }[]
  runs: number
  failures: Record<string, number>
}

/** 套路序列写成启动轴：开局在前台的角色不用切，之后角色变了就切；上一个套路以补位结尾时写"switch X 变奏" */
export function renderOpening(routines: readonly string[], onField: CharName): string[] {
  const out: string[] = []
  let cur = onField
  routines.forEach((r, i) => {
    const c = charOf(r)!
    if (c !== cur) out.push(`switch ${c}${i > 0 && endsFiller(routines[i - 1]!) ? ' 变奏' : ''}`)
    out.push(r)
    cur = c
  })
  return out
}

export function planOpening(sc: Scenario, data: GameData, opts: PlanOptions = {}): OpeningResult {
  const width = opts.width ?? 24
  const perGroup = opts.perGroup ?? 3
  const top = Math.min(opts.top ?? width, width)
  const refSeq = routineSequence(sc.opening)
  if (refSeq.length === 0) throw new Error('场景没有启动轴')
  const { library, counts, minLen, maxLen, usedOf } = libraryOf(sc, refSeq, opts.vary ?? 0, opts.extra, opts.gen ? generateRoutines(sc, data, refSeq) : [])
  const onField = sc.team[sc.initial.onField]!.char
  // 循环轴第一条若是切人，启动轴最后在前台的不能是它（切不到自己）
  const first = sc.rotation.map(clean).find(l => l)!
  const rotFirst = /^switch\s/.test(first) ? first.split(' ')[1]! : null
  const closable = (seq: readonly string[]) => seq.length >= minLen && charOf(seq.at(-1)!) !== rotFirst
    && usedOf(seq).every((n, i) => n >= library[i]!.lo && n <= library[i]!.hi)
  const complete = (seq: readonly string[]): string[] => {
    const left = new Map(counts)
    for (const r of seq) left.set(r, (left.get(r) ?? 0) - 1)
    return [...seq, ...refSeq.filter(r => { const n = left.get(r)!; if (n <= 0) return false; left.set(r, n - 1); return true })]
  }
  let runs = 0
  const failures: Record<string, number> = {}
  const fail = (k: string) => { failures[k] = (failures[k] ?? 0) + 1 }
  const evaluate = (seq: readonly string[]) => {
    runs++
    let r
    try { r = resolveScenario({ ...sc, opening: renderOpening(seq, onField) }, data) } catch { fail('compile'); return null }
    const res = simulate(r)
    if (res.error) { fail(res.error.code); return null }
    return res
  }
  const refRes = evaluate(refSeq)
  if (!refRes) throw new Error('原启动轴跑不通')
  const missed = (res: NonNullable<typeof refRes>) => res.log.filter(e => e.type === 'warning' && e.code === 'introMissed').length
  const refMissed = missed(refRes)
  const openingSecs = (res: NonNullable<typeof refRes>) => {
    const l0 = res.summary.perLoop?.find(p => p.loop === 0)
    return l0 ? l0.frames / 60 : 0
  }
  const steadyOf = (res: NonNullable<typeof refRes>) => res.summary.steady?.dps ?? null
  // 打分：场景 goal 不是稳态时按目标（打死 boss：血量 ÷ 击杀秒），否则整个窗口（启动轴几乎不影响稳态）
  const scoreOf = (res: NonNullable<typeof refRes>) => res.summary.goal?.dps ?? res.summary.dps

  type Node = { seq: string[]; score: number; res: NonNullable<typeof refRes> }
  let beam: { seq: string[] }[] = [{ seq: [] }]
  const pool = new Map<string, Node>()
  for (let depth = 0; depth < maxLen; depth++) {
    const next = new Map<string, Node>()
    for (const node of beam) {
      const used = usedOf(node.seq)
      library.forEach(({ line, hi }, i) => {
        if (used[i]! >= hi) return
        const seq = [...node.seq, line]
        const key = seq.join(' | ')
        if (next.has(key)) return
        const full = complete(seq)
        if (charOf(full.at(-1)!) === rotFirst) return                  // 补完了也接不上循环轴开头的切人
        const res = evaluate(full)
        if (!res) return
        if (missed(res) > refMissed) { fail('introMissed'); return }
        next.set(key, { seq, score: scoreOf(res), res })
        if (full.length === seq.length && closable(seq)) pool.set(key, next.get(key)!)
      })
    }
    // 去重：最后一个套路、各套路用了几次都一样的算一组，每组最多留 perGroup 个；原启动轴的前缀一定留着
    const groups = new Map<string, number>()
    const kept: Node[] = []
    for (const n of [...next.values()].sort((a, b) => b.score - a.score)) {
      const k = `${n.seq.at(-1)}#${usedOf(n.seq).join(',')}`
      const had = groups.get(k) ?? 0
      if (had >= perGroup) continue
      groups.set(k, had + 1)
      kept.push(n)
      if (kept.length >= width) break
    }
    const refPrefix = next.get(refSeq.slice(0, depth + 1).join(' | '))
    if (depth < refSeq.length && refPrefix && !kept.includes(refPrefix)) kept.push(refPrefix)
    if (kept.length === 0) break
    // 次数少于原启动轴的（补完会补上）另跑它自己
    for (const n of kept) {
      const key = n.seq.join(' | ')
      if (pool.has(key) || !closable(n.seq)) continue
      const res = evaluate(n.seq)
      if (res && missed(res) <= refMissed) pool.set(key, { seq: n.seq, score: scoreOf(res), res })
    }
    beam = kept
  }

  const refKey = refSeq.join(' | ')
  const leaves: OpeningLeaf[] = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, top).map(n => {
    const plain = renderOpening(n.seq, onField)
    const introAt = new Set(n.res.log.flatMap(e => (e.type === 'switch' && e.intro && e.cmd?.loop === 0 ? [e.cmd.line] : [])))
    const diff = usedOf(n.seq).map((c, i) => c - library[i]!.count)
    return {
      routines: n.seq,
      counts: Object.fromEntries(library.flatMap((l, i) => (diff[i] ? [[l.line, diff[i]!]] : []))),
      lines: plain.map((l, i) => (introAt.has(i + 1) && !l.endsWith(' 变奏') ? `${l} 变奏` : l)),
      dps: n.score, steady: steadyOf(n.res), openingSecs: openingSecs(n.res),
      isRef: n.seq.join(' | ') === refKey, same: 0,
    }
  })
  if (!leaves.some(l => l.isRef)) {
    leaves.push({ routines: refSeq, counts: {}, lines: renderOpening(refSeq, onField), dps: scoreOf(refRes), steady: steadyOf(refRes), openingSecs: openingSecs(refRes), isRef: true, same: 0 })
  }
  const changes = (l: OpeningLeaf) => Object.values(l.counts).reduce((a, d) => a + Math.abs(d), 0)
  leaves.sort((a, b) => b.dps - a.dps || Number(b.isRef) - Number(a.isRef) || changes(a) - changes(b) || a.routines.length - b.routines.length)
  for (let i = leaves.length - 1; i > 0; i--) {
    const [a, b] = [leaves[i - 1]!, leaves[i]!]
    if (Math.abs(a.dps - b.dps) < 1e-6 && a.openingSecs === b.openingSecs) { a.same += b.same + 1; leaves.splice(i, 1) }
  }
  const refIdx = leaves.findIndex(l => l.isRef)
  return {
    label: refRes.summary.goal?.label ?? '整个窗口',
    ref: { dps: scoreOf(refRes), steady: steadyOf(refRes), openingSecs: openingSecs(refRes), routines: refSeq },
    leaves, refRank: refIdx >= 0 ? refIdx + 1 : null,
    library: library.map(({ line, char, count, added }) => ({ line, char, count, added })), runs, failures,
  }
}
