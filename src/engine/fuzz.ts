// src/engine/fuzz.ts —— 模糊测试（docs/engine-quality-plan.md P1）：拿轴搜索的改法（挪动、去掉、对调）生成变体轴，
// 每条跑完查日志自洽（invariants.ts checkLog）；原轴另查两条变形关系：同样的输入两次结果相同、各项属性加一点伤害不降（时间轴不变）。
// 跑不通（连段中断、等超时…）是轴的问题，不算；抛异常、invariant 报错、日志不自洽才是引擎的问题
import { checkLog } from './invariants'
import { neighborIter, parseLines, lineText, type Change, type Line } from './search'
import { compileRotation, type CompileMember } from './scheduler'
import { simulate } from './simulate'
import type { HitEvent, ResolvedScenario, SimResult } from './types'

export interface FuzzProblem { where: string; what: string }
export interface FuzzReport {
  variants: number                    // 生成的变体（去重前）
  ran: number                         // 实际跑的
  ok: number                          // 跑通的
  rejected: Record<string, number>    // 跑不通的原因（编译不过、连段中断…）
  problems: FuzzProblem[]
}

/** n：最多跑几条变体（从全部候选里等距取，结果可重复） */
export function fuzzScenario(r: ResolvedScenario, rotation: readonly string[], opening: readonly string[], n = 60): FuzzReport {
  const problems: FuzzProblem[] = []
  const members: CompileMember[] = r.team.map(m => ({ name: m.def.name, actions: m.actions, aliases: m.aliases }))
  const has = (char: string, action: string) => !!members.find(x => x.name === char && (action in x.actions || action in x.aliases))
  const run = (rr: ResolvedScenario, where: string): SimResult | null => {
    try { return simulate(rr) } catch (e) {
      problems.push({ where, what: `抛异常：${e instanceof Error ? e.message : String(e)}` })
      return null
    }
  }
  const audit = (rr: ResolvedScenario, res: SimResult, where: string) => {
    if (res.error?.code === 'invariant') problems.push({ where, what: res.error.message })
    if (res.error) return
    for (const what of checkLog(rr, res)) problems.push({ where, what })
  }

  // 原轴：自洽、可重复、属性加一点伤害不降
  const base = run(r, '原轴')
  if (base) {
    audit(r, base, '原轴')
    const again = run(r, '原轴（第二次）')
    if (again && JSON.stringify(again.log) !== JSON.stringify(base.log)) problems.push({ where: '原轴', what: '同样的输入跑两次，事件日志不同（有隐藏状态或依赖了顺序不定的东西）' })
    if (!base.error) problems.push(...monotonic(r, base, run))
  }

  // 变体：挪动任一动作、去掉任一动作、对调相邻两个；另按连段整块挪动、去掉、对调（2026-10-24：单个挪多半把连段拆断，跑不通）
  const lines = parseLines(rotation)
  const acts = [...new Set(lines.flatMap(l => ('items' in l ? l.items.map(i => i.action) : [])))]
  // 单个动作的变体按需生成（长轴的候选上百万条，全摊开会把内存用完）：先数一遍，再只取等距选中的那几条
  const singleOpts = { move: acts, drop: acts, swap: true, has }
  let nSingle = 0
  for (const _ of neighborIter(lines, singleOpts)) nSingle++
  const block = blockChanges(lines, members)
  const seen = new Set<string>()
  // 两类各取一半（等距取，结果可重复）；块变体不够一半时余下的给单个的
  const chosen = (len: number, k: number, i: number) => len <= k || Math.floor(i * k / len) !== Math.floor((i - 1) * k / len)
  const even = <T>(xs: readonly T[], k: number) => xs.filter((_, i) => chosen(xs.length, k, i))
  const nb = Math.min(block.length, Math.floor(n / 2))
  const single: Change[] = []
  let i = 0
  for (const ch of neighborIter(lines, singleOpts)) if (chosen(nSingle, n - nb, i++)) single.push(ch)
  const picked = [...single, ...even(block, nb)]
  const rejected: Record<string, number> = {}
  let ran = 0, ok = 0
  for (const ch of picked) {
    const text = ch.lines.map(lineText)
    const key = text.join('\n')
    if (seen.has(key)) continue
    seen.add(key)
    const compiled = compileRotation(text, members, r.initial.onField, r.options.repeat, [...opening])
    if (!compiled.ok) { rejected.compile = (rejected.compile ?? 0) + 1; continue }
    const rr = { ...r, commands: compiled.commands, opening: compiled.opening }
    ran++
    const res = run(rr, ch.desc)
    if (!res) continue
    audit(rr, res, ch.desc)
    if (res.error) { if (res.error.code !== 'invariant') rejected[res.error.code] = (rejected[res.error.code] ?? 0) + 1; continue }
    ok++
  }
  return { variants: nSingle + block.length, ran, ok, rejected, problems }
}

/** 一行里的连段块：后一个动作的连段前置（comboFrom）含前一个的就接成一块（A1 A2 A3 A4），其余各自一块 */
function blocks(items: readonly { action: string }[], m: CompileMember | undefined): [number, number][] {
  const out: [number, number][] = []
  items.forEach((it, i) => {
    const id = m?.aliases[it.action] ?? it.action
    const prev = i > 0 ? (m?.aliases[items[i - 1]!.action] ?? items[i - 1]!.action) : undefined
    const linked = prev !== undefined && !!m?.actions[id]?.comboFrom?.includes(prev)
    if (linked) out.at(-1)![1] = i + 1
    else out.push([i, i + 1])
  })
  return out
}

/** 按连段整块的变体：同一行里把一块挪到别的块之间、去掉一块、与相邻块对调；只改至少有两块、且有一块是连段（两个动作以上）的行 */
export function blockChanges(lines: readonly Line[], members: readonly CompileMember[]): Change[] {
  const out: Change[] = []
  lines.forEach((line, li) => {
    if (!('char' in line)) return
    const bs = blocks(line.items, members.find(m => m.name === line.char))
    if (bs.length < 2 || !bs.some(([a, b]) => b - a > 1)) return
    const seg = (k: number) => line.items.slice(bs[k]![0], bs[k]![1])
    const name = (k: number) => seg(k).map(i => i.action).join(' ')
    const put = (order: number[], desc: string) => {
      const items = order.flatMap(seg)
      out.push({ lines: lines.map((l, j) => (j === li ? { char: line.char, items } : l)), desc: `${line.char}（第 ${li + 1} 条）${desc}` })
    }
    const idx = bs.map((_, k) => k)
    for (let k = 0; k < bs.length; k++) {
      if (bs.length > 1) put(idx.filter(x => x !== k), `去掉连段「${name(k)}」`)
      if (k + 1 < bs.length) put(idx.map(x => (x === k ? k + 1 : x === k + 1 ? k : x)), `对调「${name(k)}」与「${name(k + 1)}」`)
      for (let t = 0; t <= bs.length; t++) {
        if (t === k || t === k + 1) continue
        const rest = idx.filter(x => x !== k)
        const at = t > k ? t - 1 : t
        put([...rest.slice(0, at), k, ...rest.slice(at)], `「${name(k)}」整块挪到第 ${t + 1} 块的位置`)
      }
    }
  })
  return out
}

/** 变形关系：生命、攻击、防御各加一点（固定值），出招与结算的时刻应完全不变，每一下的伤害不降 */
function monotonic(r: ResolvedScenario, base: SimResult, run: (rr: ResolvedScenario, where: string) => SimResult | null): FuzzProblem[] {
  const where = '原轴 · 属性各加一点'
  const bump = (p: { base: number; pct: number; flat: number }, d: number) => ({ ...p, flat: p.flat + d })
  const team = r.team.map(m => ({ ...m, panel: { ...m.panel, hp: bump(m.panel.hp, 500), atk: bump(m.panel.atk, 50), def: bump(m.panel.def, 50) } })) as unknown as ResolvedScenario['team']
  const res = run({ ...r, team }, where)
  if (!res) return []
  if (res.error) return [{ where, what: `原轴跑得通，加了属性反而报错：${res.error.message}` }]
  const timing = (x: SimResult) => x.log.filter(e => e.type === 'actionStart' || e.type === 'switch').map(e => `${e.f}:${e.type === 'actionStart' ? `${e.char}${e.action}` : 'switch'}`).join(',')
  if (timing(res) !== timing(base)) return [{ where, what: '出招与切人的时刻变了（伤害数值不该影响时间轴）' }]
  const hits = (x: SimResult) => x.log.filter((e): e is HitEvent => e.type === 'hit')
  const a = hits(base), b = hits(res)
  if (a.length !== b.length) return [{ where, what: `结算次数 ${a.length} → ${b.length}` }]
  const out: FuzzProblem[] = []
  for (let i = 0; i < a.length && out.length < 5; i++) {
    const x = a[i]!.dmg?.expected ?? 0, y = b[i]!.dmg?.expected ?? 0
    if (y < x - 1e-6) out.push({ where, what: `第 ${a[i]!.f} 帧 ${a[i]!.char} ${a[i]!.judgment}：期望伤害 ${x.toFixed(1)} → ${y.toFixed(1)}` })
  }
  return out
}
