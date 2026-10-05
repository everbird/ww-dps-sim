// src/cli/trace.ts —— pnpm trace <场景.yaml> [--loop k] [--seg] [--res <资源>] [--char <角色>] [--md] [--out <文件.md>]
// 调试用的表（TD-11 §3）：缺省打印第 k 轮的分段与逐条；--seg 只打印分段；--res 协奏 / 能量 / <核心资源名> 打印资源逐步表
// （--char 只看一个角色）。--md 另写一份 Markdown（缺省 out/<场景名>.trace.md），方便贴出来讨论。
// 轮次缺省取稳态的第一轮（没有稳态时取最后一轮）；启动轴是第 0 轮。仿真报错时照样打印到出错为止。
// 退出码：0 成功；1 场景有错或运行期报错；2 用法错误。
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { loadGameData } from '../data/load'
import { ResolveError, resolveScenario } from '../engine/resolve'
import { simulate } from '../engine/simulate'
import { compareMarks, loopSpan, loopsOf, resourceSel, traceCommands, traceLedger, traceSegments, type LoopSpan, type MarkCmp } from '../engine/trace'
import type { ResolvedScenario, SimResult } from '../engine/types'
import { argsOf, loadScenario, padEnd, padStart, width } from './format'

const USAGE = '用法：pnpm trace <场景.yaml> [--loop k] [--seg] [--res 协奏|能量|<核心资源名>] [--char <角色>] [--md] [--out <文件.md>]'

/** 一张表：表头、行；right[i] 为真的列右对齐（数字） */
export interface Table { title: string; head: string[]; rows: string[][]; right?: boolean[] }

const s2 = (frames: number) => (frames / 60).toFixed(2)
const t2 = (sec: number) => sec.toFixed(2)
const num = (x: number) => (Math.round(x * 100) / 100).toString()
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${num(Math.abs(x))}`
const signed2 = (x: number) => (Math.abs(x) < 0.005 ? '±0.00' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`)

export interface TraceOpts { seg?: boolean; res?: string; char?: string; marks?: Record<string, string | number> }

/** 要打印的表与说明（对照视频的小结、对不上的时间点）；参数有错时返回错误说明 */
export function tables(r: ResolvedScenario, res: SimResult, loop: number, opts: TraceOpts): { tables: Table[]; notes: string[] } | string {
  const log = res.log
  const span = loopSpan(log, loop) as LoopSpan
  const out: Table[] = []
  const notes: string[] = []
  if (opts.res) {
    const sel = resourceSel(r, opts.res)
    if (typeof sel === 'string') return sel
    if (opts.char && !r.team.some(m => m.def.name === opts.char)) return `--char ${opts.char}：不在队伍里`
    const rows = traceLedger(log, r, loop, sel, opts.char)
    const shown = rows[0] ? Object.keys(rows[0].values) : []
    if (rows.length === 0) notes.push(`${sel.label}这一轮没有变化`)
    out.push({
      title: `${sel.label}逐步`,
      head: ['世界秒', '战斗秒', '事件', '来源', ...shown],
      rows: rows.map(x => [s2(x.f - span.f), t2(x.t - span.t), x.label, x.source,
        ...shown.map(n => (x.deltas[n] !== undefined ? `${signed(x.deltas[n]!)} → ${num(x.values[n]!)}` : num(x.values[n]!)))]),
      right: [true, true, false, false, ...shown.map(() => true)],
    })
    return { tables: out, notes }
  }
  const cmds = traceCommands(log, r, loop)
  // 对照视频：有时间点的行多三列（视频、累计差、本段差）
  const cmp = opts.marks ? compareMarks(cmds, opts.marks) : null
  const byLine = new Map<number, MarkCmp>((cmp?.rows ?? []).map(x => [x.line, x]))
  const vHead = cmp ? ['视频', '累计差', '本段差'] : []
  const vCells = (line: number | null, first: boolean): string[] => {
    if (!cmp) return []
    const m = line !== null && first ? byLine.get(line) : undefined
    return m ? [t2(m.video), signed2(m.diff), signed2(m.step)] : ['', '', '']
  }
  if (cmp) {
    const last = cmp.rows.at(-1)
    if (last && cmp.rows.length > 1)
      notes.push(`对照视频：第 ${cmp.rows[0]!.line} 条到第 ${last.line} 条，视频 ${t2(last.video)} 秒，仿真 ${t2(last.sim)} 秒（世界秒），仿真${last.diff >= 0 ? '慢' : '快'} ${t2(Math.abs(last.diff))} 秒`)
    if (cmp.missing.length) notes.push(`视频时间点里第 ${cmp.missing.join('、')} 条在这一轮没有出现，没有对照`)
  }
  const segs = traceSegments(log, r, loop)
  out.push({
    title: '分段（每次上场多久）',
    head: ['段', '上场', '开始（世界秒）', '世界秒', '战斗秒', '第几条', ...vHead],
    rows: segs.map((x, i) => [String(i + 1), `${x.char}${x.intro ? '（变奏）' : ''}`, s2(x.f - span.f), s2(x.frames), t2(x.battle),
      x.line === null ? '' : String(x.line), ...vCells(x.line, true)]),
    right: [true, false, true, true, true, true, true, true, true],
  })
  if (opts.seg) return { tables: out, notes }
  out.push({
    title: '逐条（每条指令的开始、到下一条多久、之前在等什么）',
    head: ['条', '指令', '开始（世界秒）', '开始（战斗秒）', '到下一条', ...vHead, '之前在等（帧）'],
    rows: cmds.map((x, i) => [x.line === null ? '' : `${x.line}.${x.item}`, x.label, s2(x.f - span.f), t2(x.t - span.t), s2(x.frames),
      ...vCells(x.line, cmds.findIndex(c => c.line === x.line) === i), x.waits.map(w => `${w.reason} ${w.frames}`).join('；')]),
    right: [false, false, true, true, true, ...vHead.map(() => true), false],
  })
  return { tables: out, notes }
}

export function asText(t: Table): string {
  const w = t.head.map((h, i) => Math.max(width(h), ...t.rows.map(r => width(r[i] ?? ''))))
  const line = (cells: string[]) => cells.map((c, i) => (t.right?.[i] ? padStart(c, w[i]!) : padEnd(c, w[i]!))).join('  ').trimEnd()
  return [`\n${t.title}`, `  ${line(t.head)}`, ...t.rows.map(r => `  ${line(r)}`)].join('\n')
}

export function asMarkdown(t: Table): string {
  const esc = (c: string) => c.replace(/\|/g, '\\|')
  return [`\n### ${t.title}\n`, `| ${t.head.map(esc).join(' | ')} |`, `|${t.head.map((_, i) => (t.right?.[i] ? '---:' : '---')).join('|')}|`,
    ...t.rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n')
}

async function main(): Promise<number> {
  const { pos, opt } = argsOf(process.argv.slice(2), ['--loop', '--res', '--char', '--out'])
  const file = pos.find(a => !a.startsWith('--'))
  const unknown = pos.filter(a => a.startsWith('--') && a !== '--seg' && a !== '--md')
  if (!file || unknown.length > 0) { console.error(unknown.length ? `不认识的参数：${unknown.join(' ')}\n${USAGE}` : USAGE); return 2 }
  const sc = loadScenario(file)
  let r: ResolvedScenario
  try {
    r = resolveScenario(sc, await loadGameData())
  } catch (e) {
    if (e instanceof ResolveError) { console.error(e.message); return 1 }
    throw e
  }
  const res = simulate(r)
  const loops = loopsOf(res.log)
  const loop = opt.loop !== undefined ? Number(opt.loop) : res.summary.steady?.from ?? loops.at(-1) ?? 1
  if (!loops.includes(loop)) { console.error(`没有第 ${opt.loop} 轮（有：${loops.map(k => (k === 0 ? '0（启动）' : k)).join('、')}）`); return 2 }
  const video = sc.video && sc.video.loop === loop ? sc.video.marks : undefined
  const t = tables(r, res, loop, {
    seg: pos.includes('--seg'), ...(opt.res ? { res: opt.res } : {}), ...(opt.char ? { char: opt.char } : {}), ...(video ? { marks: video } : {}),
  })
  if (typeof t === 'string') { console.error(t); return 2 }
  const span = loopSpan(res.log, loop)!
  const head = `场景 ${file} · ${loop === 0 ? '启动轴' : `第 ${loop} 轮`}：世界 ${s2(span.endF - span.f)} 秒，战斗 ${t2(span.endT - span.t)} 秒（时刻从本轮开始算）`
  console.log(head)
  for (const n of t.notes) console.log(n)
  for (const x of t.tables) console.log(asText(x))
  if (res.error) console.log(`\n仿真报错（第 ${res.error.frame} 帧）：${res.error.message}`)
  if (pos.includes('--md')) {
    const target = resolve(opt.out ?? `out/${basename(file, extname(file))}.trace.md`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `# ${basename(file)} 调试表\n\n${head}\n${t.notes.map(n => `\n${n}`).join('')}\n${t.tables.map(asMarkdown).join('\n')}\n${res.error ? `\n仿真报错（第 ${res.error.frame} 帧）：${res.error.message}\n` : ''}`)
    console.log(`\nMarkdown → ${target}`)
  }
  return res.error ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
