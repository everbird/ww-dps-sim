// DD-02 §3.2：严格教学轴的纯编译检查。
import { parseRotationLine, type Scenario } from '../data/scenario.schema'
import type { PrepareIssue } from './run-types'
import type { ResolvedScenario } from './types'
import { introOf } from './switch'
export const STRICT_CHECKS = ['strict.replay', 'strict.tuneBreakAuto', 'strict.filler', 'strict.optional', 'strict.at', 'strict.external', 'strict.tuneBreakOff', 'strict.tuneBreakUndeclared', 'strict.noIntroAction'] as const
export function checkStrictSource(sc: Scenario): PrepareIssue[] {
  if (!sc.options.strict) return []
  const issues: PrepareIssue[] = []
  const add = (code: string, message: string) => issues.push({ stage: 'strict', code, message })
  if (sc.purpose === 'replay') add('strict.replay', '录像剖析不能走严格入口')
  if (sc.options.tuneBreak === 'auto') add('strict.tuneBreakAuto', '严格入口要写 tuneBreak: manual 或 off')
  for (const part of ['opening', 'rotation'] as const) sc[part].forEach((line, i) => {
    const items = parseRotationLine(line)
    if (!Array.isArray(items)) return
    items.forEach((it, j) => {
      const codes: string[] = []
      if (it.kind === 'act') { if (it.filler) codes.push('filler'); if (it.optional) codes.push('optional') }
      if (it.kind === 'at') codes.push('at')
      if (it.kind === 'fill' || it.kind === 'enemy' || it.kind === 'sync') codes.push('external')
      const messages: Record<string, string> = { filler: '补位不进严格入口', optional: '可选动作不进严格入口', at: '对时只用于录像剖析', external: '外部指令只用于录像剖析' }
      for (const code of codes) issues.push({ stage: 'strict', code: `strict.${code}`, message: `${part === 'opening' ? '启动' : ''}第 ${i + 1} 条第 ${j + 1} 个：${messages[code]}`,  line: i + 1, item: j + 1, ...(part === 'opening' ? { opening: true } : {}) })
    })
  })
  return issues
}
export function checkStrictResolved(r: ResolvedScenario): { issues: PrepareIssue[]; warnings: string[] } {
  const issues: PrepareIssue[] = [], warnings: string[] = []
  const written = [...r.opening.map(c => ({ c, opening: true })), ...r.commands.map(c => ({ c, opening: false }))].filter(({ c }) => c.kind === 'act' && r.team[c.slot].actions[c.action]?.kind === 'tuneBreak')
  const add = (code: string, message: string) => issues.push({ stage: 'strict', code, message })
  const atWritten = (code: string, message: string) => { for (const { c, opening } of written) issues.push({ stage: 'strict', code, message, line: c.line, item: c.item, ...(opening ? { opening: true } : {}) }) }
  if (written.length && r.tuneBreakOmitted) atWritten('tuneBreak.omittedButWritten', '声明省略谐度破坏却在轴里写了它')
  if (written.length && r.options.tuneBreak === 'off') {
    if (r.options.strict) atWritten('strict.tuneBreakOff', '关了谐度破坏又在轴里写了它')
    else warnings.push('关了谐度破坏又在轴里写了它，动作不能执行')
  }
  if (!written.length && !r.tuneBreakOmitted) {
    if (r.options.strict) add('strict.tuneBreakUndeclared', '写入谐度破坏，或用 tuneBreakOmitted 说明为什么不打')
    else if (r.options.tuneBreak !== 'auto') warnings.push('未含谐度破坏：未声明省略原因')
  }
  if (r.options.strict) for (const [opening, commands] of [[true, r.opening], [false, r.commands]] as const) for (const c of commands) {
    if (c.kind === 'switch' && c.expectIntro && !introOf(r.team[c.to]) && !r.data.hooks[r.team[c.to].def.name]?.introAction)
      issues.push({ stage: 'strict', code: 'strict.noIntroAction', message: '角色没有变奏动作', line: c.line, item: c.item, ...(opening ? { opening: true } : {}) })
  }
  return { issues, warnings }
}
