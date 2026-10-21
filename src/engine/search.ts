// src/engine/search.ts —— 轴搜索（TD-10 §6.1，总设计 §3.7、M7；第一版 2026-10-20，第二版 2026-10-21）：从一条现成的轴出发做局部搜索。
//   候选 = 在循环轴（rotation）上改一处：把一个动作挪到同一角色别的位置（move），去掉一个动作（drop），
//   对调同一角色相邻的两个动作（swap，第二版），或插入一个动作（insert，第二版）；启动轴不动。
//   每个候选只重新编译轴（compileRotation）、完整跑一遍仿真，按比较口径打分（basisOf：有分轮取稳态，否则整个窗口）。
//   多轮时每轮从当前最好的 beam 条再各改一处（beam search），这一轮没有比最好的更好的就停。
//   跑不通的（编译不过、运行报错：连段中断、等超时…）记下原因丢掉。
//   用途是检验与启发：比原轴好的改法是"游戏里也该更好"的假设，要拿实战核对。纯函数，输入装配结果与轴的原文。
import { parseRotationLine, type RotationItem } from '../data/scenario.schema'
import { basisOf, type Basis } from './analysis'
import { compileRotation, type CompileMember } from './scheduler'
import { simulate } from './simulate'
import type { ResolvedScenario } from './types'

type Act = Extract<RotationItem, { kind: 'act' }>
/** 轴的一行：同一角色的出招（可以改），或切人、等待（原样保留） */
export type Line = { char: string; items: Act[] } | { text: string }
const isChar = (l: Line): l is { char: string; items: Act[] } => 'char' in l

export interface SearchOptions {
  move?: readonly string[]                  // 挪动哪些动作（轴里写的名字，不带后缀）；缺省：声骸技能（Q、Q·…）
  drop?: readonly string[]                  // 试着去掉哪些动作；缺省不试
  swap?: boolean                            // 也试着对调同一角色相邻的两个动作（两个都是补位的、写法一样的不试）；缺省不试
  insert?: readonly string[]                // 也试着插入这些（轴里的写法，可带后缀，如 "A1~"）：有这个动作的角色，每行每个位置各一种；缺省不试
  chars?: readonly string[]                 // 只改这些角色的行；缺省都改
  rounds?: number                           // 几轮：1 = 只看在原轴上改一处
  beam?: number                             // 每轮留几条往下改
  maxRuns?: number                          // 最多跑几次仿真（含原轴）
}

export interface Candidate {
  lines: string[]                           // 循环轴的原文（改过的；注释去掉了）
  steps: string[]                           // 相对原轴的改动，一步一条
  dps: number | null
  loopSecs: number | null                   // 稳态每轮多少战斗秒；没有分轮时 null
  introMissed: number                       // 写了"变奏"的切人没变奏（轴可能有问题）的次数
  error: { code: string; message: string } | null
}

export interface SearchResult {
  basis: Basis
  base: Candidate
  results: Candidate[]                      // 跑通的，按 DPS 从高到低（含原轴）
  tried: number                             // 试了几种改法（去重后）
  failures: Record<string, number>          // 跑不通的按原因计数：compile（编译不过）、comboBroken、timeout、maxFrames…
  runs: number                              // 一共跑了几次仿真
  rounds: number                            // 实际跑了几轮
  stoppedBy: 'rounds' | 'noBetter' | 'maxRuns'
}

/** 解析循环轴：同一角色的出招行拆成条目，切人、等待、空行原样保留 */
export function parseLines(rotation: readonly string[]): Line[] {
  return rotation.map(text => {
    const p = parseRotationLine(text)
    if ('error' in p) throw new Error(`轴写错了："${text}"：${p.error}`)
    if (p.length > 0 && p.every((it): it is Act => it.kind === 'act')) return { char: p[0]!.char, items: p }
    return { text }
  })
}

const itemText = (it: Act): string =>
  `${it.action}${it.force ? '!' : ''}${it.optional ? '?' : ''}${it.filler ? '~' : ''}${it.delay ? ` +${it.delay}` : ''}`
/** 拼回原文；切人、等待的行去掉注释 */
export const lineText = (l: Line): string => (isChar(l) ? `${l.char} ${l.items.map(itemText).join(' ')}` : l.text.replace(/(^|\s)#.*$/, '').trim())
/** 去重用的键：指令序列。同一角色相邻的几行怎么断行不影响执行（Q 放在一行末尾与下一行开头是同一条轴） */
export const rotationKey = (lines: readonly Line[]): string =>
  lines.map(l => (isChar(l) ? l.items.map(it => `${l.char} ${itemText(it)}`).join('|') : lineText(l))).filter(Boolean).join('|')

const isEcho = (action: string): boolean => action === 'Q' || action.startsWith('Q·')

export interface Change { lines: Line[]; desc: string }

/** 插入的写法 → 条目（角色先随便填，用时换成要插的角色）；写错了报错 */
export function insertItem(token: string): Act {
  const p = parseRotationLine(`某 ${token}`)
  if ('error' in p) throw new Error(`插入的"${token}"写错了：${p.error}`)
  const it = p[0]
  if (p.length !== 1 || it?.kind !== 'act') throw new Error(`插入的"${token}"要写一个动作（可带后缀 ! ? ~ +N）`)
  return it
}

const where = (before: string | undefined, after: string | undefined) =>
  before && after ? `${before} 之后、${after} 之前` : before ? `${before} 之后，末尾` : after ? `开头，${after} 之前` : '只有它'

/** 在 lines 上改一处的全部候选（不去重，不跑仿真）。has(角色, 动作)：这个角色有没有这个动作（插入时只插给有的角色；缺省都算有） */
export function neighbors(
  lines: readonly Line[],
  opts: Pick<SearchOptions, 'move' | 'drop' | 'swap' | 'insert' | 'chars'> & { has?: (char: string, action: string) => boolean } = {},
): Change[] {
  const movable = (a: string) => (opts.move ? opts.move.includes(a) : isEcho(a))
  const droppable = (a: string) => opts.drop?.includes(a) ?? false
  const out: Change[] = []
  lines.forEach((line, li) => {
    if (!isChar(line) || (opts.chars && !opts.chars.includes(line.char))) return
    line.items.forEach((it, ii) => {
      const who = `${line.char} ${it.action}`
      if (movable(it.action)) {
        lines.forEach((target, lj) => {
          if (!isChar(target) || target.char !== line.char) return
          const rest = lj === li ? line.items.filter((_, k) => k !== ii) : target.items
          for (let p = 0; p <= rest.length; p++) {
            if (lj === li && p === ii) continue                       // 原位
            out.push({
              lines: edit(lines, li, ii, { line: lj, at: p }),
              desc: `${who}：第 ${li + 1} 条第 ${ii + 1} 个 → 第 ${lj + 1} 条第 ${p + 1} 个（${where(rest[p - 1]?.action, rest[p]?.action)}）`,
            })
          }
        })
      }
      if (droppable(it.action)) out.push({ lines: edit(lines, li, ii, null), desc: `去掉 ${who}（第 ${li + 1} 条第 ${ii + 1} 个）` })
      // 对调：与同一行的下一个，行末的与紧接着的同一角色那一行的第一个（两行连着，执行起来就是相邻的两个）
      if (opts.swap) {
        const lj = ii + 1 < line.items.length ? li : li + 1
        const jj = lj === li ? ii + 1 : 0
        const next = lines[lj]
        if (next && isChar(next) && next.char === line.char) {
          const b = next.items[jj]!
          if (!(it.filler && b.filler) && itemText(it) !== itemText(b)) {
            const swapped: Line[] = lines.map(l => (isChar(l) ? { char: l.char, items: [...l.items] } : l))
            ;(swapped[li] as { items: Act[] }).items[ii] = b
            ;(swapped[lj] as { items: Act[] }).items[jj] = it
            const at = lj === li ? `第 ${li + 1} 条第 ${ii + 1}、${ii + 2} 个` : `第 ${li + 1} 条末尾与第 ${lj + 1} 条开头`
            out.push({ lines: swapped, desc: `${line.char}：对调 ${it.action} 与 ${b.action}（${at}）` })
          }
        }
      }
    })
  })
  // 插入：每个插入的写法，插进有这个动作的角色的每一行、每个位置
  for (const token of opts.insert ?? []) {
    const proto = insertItem(token)
    lines.forEach((line, li) => {
      if (!isChar(line) || (opts.chars && !opts.chars.includes(line.char)) || (opts.has && !opts.has(line.char, proto.action))) return
      for (let p = 0; p <= line.items.length; p++) {
        const next: Line[] = lines.map(l => (isChar(l) ? { char: l.char, items: [...l.items] } : l))
        ;(next[li] as { items: Act[] }).items.splice(p, 0, { ...proto, char: line.char })
        out.push({
          lines: next,
          desc: `插入 ${line.char} ${token}：第 ${li + 1} 条第 ${p + 1} 个（${where(line.items[p - 1]?.action, line.items[p]?.action)}）`,
        })
      }
    })
  }
  return out
}

/** 拿掉第 li 行的第 ii 个条目，放到 to（null = 不放回）；行空了就去掉这一行 */
function edit(lines: readonly Line[], li: number, ii: number, to: { line: number; at: number } | null): Line[] {
  const next: Line[] = lines.map(l => (isChar(l) ? { char: l.char, items: [...l.items] } : l))
  const from = next[li] as { char: string; items: Act[] }
  const [it] = from.items.splice(ii, 1)
  if (to) (next[to.line] as { char: string; items: Act[] }).items.splice(to.at, 0, it!)
  return next.filter(l => !isChar(l) || l.items.length > 0)
}

/** 跑一条轴：只重新编译循环轴，启动轴与其余装配结果照用。basis 是这次的比较口径（跑不通时 null） */
function evaluate(
  r: ResolvedScenario, members: CompileMember[], opening: readonly string[], lines: Line[], steps: string[],
): { c: Candidate; basis: Basis | null } {
  const text = lines.map(lineText)
  const blank = { lines: text, steps, dps: null, loopSecs: null, introMissed: 0 }
  const compiled = compileRotation(text, members, r.initial.onField, r.options.repeat, [...opening])
  if (!compiled.ok) return { c: { ...blank, error: { code: 'compile', message: compiled.issues[0]!.message } }, basis: null }
  const res = simulate({ ...r, commands: compiled.commands, opening: compiled.opening })
  if (res.error) return { c: { ...blank, error: { code: res.error.code, message: res.error.message } }, basis: null }
  const st = res.summary.steady, basis = basisOf(res)
  return {
    c: {
      ...blank, dps: basis.dps, loopSecs: st ? st.frames / 60 / (st.to - st.from + 1) : null,
      introMissed: res.summary.warnings.filter(w => w.code === 'introMissed').length, error: null,
    },
    basis,
  }
}

const byDps = (a: Candidate, b: Candidate) => b.dps! - a.dps!

/** 跑不通的原因（SearchResult.failures 的键）怎么说；命令行与网页共用 */
export const FAILURE_LABEL: Readonly<Record<string, string>> = {
  compile: '编译不过', comboBroken: '连段中断', timeout: '等超时', maxFrames: '超过帧数上限', notOnField: '不在前台', switchSelf: '切到自己', entrySkill: '出场技不是从地面普通切人入场后第一个出', airEntry: '空中 / 地面入场对不上',
}

export function searchRotation(
  r: ResolvedScenario, rotation: readonly string[], opening: readonly string[], opts: SearchOptions = {},
): SearchResult {
  const members: CompileMember[] = r.team.map(m => ({ name: m.def.name, actions: m.actions, aliases: m.aliases }))
  const has = (char: string, action: string) => {
    const m = members.find(x => x.name === char)
    return !!m && (action in m.actions || action in m.aliases)
  }
  for (const token of opts.insert ?? []) {
    const a = insertItem(token).action
    if (!members.some(m => has(m.name, a))) throw new Error(`插入的"${token}"：队伍里没有人有动作 ${a}`)
  }
  const rounds = opts.rounds ?? 1, width = opts.beam ?? 3, maxRuns = opts.maxRuns ?? 500
  let runs = 0
  const lines0 = parseLines(rotation)
  const first = evaluate(r, members, opening, lines0, [])
  const base = first.c
  runs++
  if (base.error || !first.basis) throw new Error(`原轴跑不通，先把轴修好再搜：${base.error?.message}`)
  const seen = new Set<string>([rotationKey(lines0)])
  const ok: Candidate[] = [base]
  const failures: Record<string, number> = {}
  let beam: { c: Candidate; lines: Line[] }[] = [{ c: base, lines: lines0 }]
  let tried = 0, done = 0
  let stoppedBy: SearchResult['stoppedBy'] = 'rounds'
  outer: for (let k = 1; k <= rounds; k++) {
    const fresh: { c: Candidate; lines: Line[] }[] = []
    for (const parent of beam) {
      for (const ch of neighbors(parent.lines, { ...opts, has })) {
        const key = rotationKey(ch.lines)
        if (seen.has(key)) continue
        seen.add(key)
        if (runs >= maxRuns) { stoppedBy = 'maxRuns'; done = k; break outer }
        tried++
        const { c } = evaluate(r, members, opening, ch.lines, [...parent.c.steps, ch.desc])
        runs++
        if (c.error) { failures[c.error.code] = (failures[c.error.code] ?? 0) + 1; continue }
        ok.push(c)
        fresh.push({ c, lines: ch.lines })
      }
    }
    done = k
    const best = beam[0]!.c.dps!
    const next = [...beam, ...fresh].sort((a, b) => byDps(a.c, b.c)).slice(0, width)
    if (!(next[0]!.c.dps! > best + 1e-6)) { stoppedBy = 'noBetter'; break }
    beam = next
  }
  return { basis: first.basis, base, results: ok.sort(byDps), tried, failures, runs, rounds: done, stoppedBy }
}
