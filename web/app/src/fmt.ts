// web/app/src/fmt.ts —— 数字格式（同 src/cli/format.ts，那边读文件、不能进浏览器）
export const fmt = (x: number) => Math.round(x).toLocaleString('en-US')
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`
export const pct2 = (x: number) => `${(x * 100).toFixed(2)}%`
export const signed = (x: number, f: (v: number) => string = fmt) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${f(Math.abs(x))}`
const FLAT = new Set(['生命', '攻击', '防御'])
export const statValue = (k: string, v: number) => (FLAT.has(k) ? fmt(v) : pct(v))
export const stats = (t: Partial<Record<string, number>>) => Object.entries(t).map(([k, v]) => `${k} ${statValue(k, v!)}`).join('、')
