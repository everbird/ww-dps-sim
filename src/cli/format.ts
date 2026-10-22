// src/cli/format.ts —— 命令行共用：读场景文件、终端对齐、数字格式
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { FLAT_STATS, type StatKey } from '../data/common'
import { ScenarioSchema, type Scenario } from '../data/scenario.schema'
import { parseOrThrow } from '../data/validate'
import { ASSUMPTIONS, IMPACT_NAME, assumptionOf } from '../engine/assumptions'
import type { Summary } from '../engine/types'

export const loadScenario = (file: string): Scenario => parseOrThrow(ScenarioSchema, parse(readFileSync(file, 'utf8')), file)

/** 命令行临时覆盖场景（TD-10 §7）：--goal steady | kill:倍数 | killHp:血量 | window:秒；--repeat 轮数（打死几倍血要多跑几轮时用） */
export const OVERRIDE_FLAGS = ['--goal', '--repeat']
export const OVERRIDE_USAGE = '[--goal steady|kill:2|killHp:2600000|window:60] [--repeat N]'
export function withOverrides(sc: Scenario, opt: Record<string, string>): Scenario {
  let out = sc
  if (opt.goal !== undefined) {
    const m = /^(steady|kill|killHp|window)(?::(\d+(?:\.\d+)?))?$/.exec(opt.goal)
    if (!m || (m[1] !== 'steady') !== (m[2] !== undefined)) throw new Error(`--goal 写成 steady、kill:2、killHp:2600000 或 window:60（不是"${opt.goal}"）`)
    const v = Number(m[2])
    const goal: Scenario['goal'] = m[1] === 'steady' ? 'steady' : m[1] === 'kill' ? { kill: v } : m[1] === 'killHp' ? { killHp: v } : { window: v }
    out = { ...out, goal }
  }
  if (opt.repeat !== undefined) {
    const n = Number(opt.repeat)
    if (!Number.isInteger(n) || n < 1) throw new Error(`--repeat 要正整数（不是"${opt.repeat}"）`)
    // 帧数上限跟着放大，免得多跑的轮被截掉
    out = { ...out, options: { ...out.options, repeat: n, maxFrames: Math.max(out.options.maxFrames, Math.ceil(out.options.maxFrames * n / out.options.repeat)) } }
  }
  return out
}

export const fmt = (x: number) => Math.round(x).toLocaleString('en-US')
export const signed = (x: number, f: (v: number) => string = fmt) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${f(Math.abs(x))}`
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`
export const pct2 = (x: number) => `${(x * 100).toFixed(2)}%`
export const sec = (frames: number) => `${(frames / 60).toFixed(2)} 秒（${frames} 帧）`
/** 属性值：比例写成百分数，固定值写整数 */
export const statValue = (k: StatKey, v: number) => (FLAT_STATS.includes(k) ? fmt(v) : pct(v))

/** 终端显示宽度：中日韩字符与全角符号占两列 */
export const width = (t: string) =>
  [...t].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)
export const padEnd = (t: string, n: number) => t + ' '.repeat(Math.max(0, n - width(t)))
export const padStart = (t: string, n: number) => ' '.repeat(Math.max(0, n - width(t))) + t

/** 汇总里"这次碰到的假设"（总设计 T16）：每条一行（影响、编号、怎么处理、次数、例子），最后一行列每次都适用的 */
export function assumptionLines(s: Summary): string[] {
  const out = s.assumptions.map(x => {
    const a = assumptionOf(x.id)!
    const eg = x.detail.length > 0 ? `  例：${x.detail.slice(0, 2).join('；')}${x.detail.length > 2 ? '…' : ''}` : ''
    return `  [${IMPACT_NAME[a.impact]}] ${a.id}  ${a.what}（${x.count} 次）${eg}`
  })
  const always = ASSUMPTIONS.filter(a => !a.tracked).map(a => a.id)
  out.push(`  每次都适用：${always.join('、')}（pnpm assumptions 看全部）`)
  return out
}

/** 命令行参数：取 --name 的值，剩下的是位置参数（pnpm 10 会把 `--` 原样传进来，去掉） */
export function argsOf(argv: string[], flags: string[]): { pos: string[]; opt: Record<string, string> } {
  const args = argv.filter(a => a !== '--')
  const opt: Record<string, string> = {}
  const pos: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (flags.includes(a) && i + 1 < args.length) opt[a.slice(2)] = args[++i]!
    else pos.push(a)
  }
  return { pos, opt }
}
