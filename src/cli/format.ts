// src/cli/format.ts —— 命令行共用：读场景文件、终端对齐、数字格式
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { FLAT_STATS, type StatKey } from '../data/common'
import { ScenarioSchema, type Scenario } from '../data/scenario.schema'
import { parseOrThrow } from '../data/validate'

export const loadScenario = (file: string): Scenario => parseOrThrow(ScenarioSchema, parse(readFileSync(file, 'utf8')), file)

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
