// DD-04 §3.3、§5.5：只替换生成区，保留文件开头手写的读法；不加入生成时间。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
export const GENERATED = '<!-- generated: DD-04 -->'
export function writeGenerated(path: string, body: string, header: string): void {
  const old = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const at = old.indexOf(GENERATED)
  const prefix = at >= 0 ? old.slice(0, at) : old || header + '\n\n'
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${prefix}${GENERATED}\n${body.trim()}\n`)
}
