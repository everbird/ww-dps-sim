// DD-10 §4①、TD-09 §4：静态编译与运行期调度分开。
import type { ActionId, Slot } from '../data/common'
import type { ActionDef } from '../data/gamedata'
import { parseRotationLine, type Command } from '../data/scenario.schema'
import { round } from './num'

/** 补位 "~" 看的那一条：往后跳过同一角色的补位，第一条同一角色的普通动作，或紧接着的"switch <角色> 变奏"（看切出者的协奏满没满）、
 *  "at <世界秒>"（还没到就接着补）；遇到别的切人、等待或别的角色就没有 */
function fillerTarget(list: Command[], i: number): Extract<Command, { kind: 'act' | 'switch' | 'at' }> | undefined {
  const c = list[i]
  if (c?.kind !== 'act') return undefined
  for (let j = i + 1; j < list.length; j++) {
    const n = list[j]!
    if (n.kind === 'switch' && n.expectIntro) return n
    if (n.kind === 'at') return n
    if (n.kind !== 'act' || n.slot !== c.slot) return undefined
    if (!n.filler) return n
  }
  return undefined
}

export interface CompileMember { name: string; actions: Record<ActionId, ActionDef>; aliases: Record<string, ActionId> }
export interface CompileIssue { line: number; item?: number; message: string; opening?: true }
export type CompileResult = { ok: true; commands: Command[]; opening: Command[] } | { ok: false; issues: CompileIssue[] }

/** rotation（与可选的启动轴 opening）的每一行 → 指令；line 从 1 起（= 场景里第几条），item 是行内第几个动作。
 *  启动轴只跑一次，前台从 onField 推到它结束时，循环轴从那里开始（§3.7） */
export function compileRotation(lines: string[], team: CompileMember[], onField: Slot, repeat = 1, openingLines: string[] = []): CompileResult {
  const open = compileLines(openingLines, team)
  const rot = compileLines(lines, team)
  const issues = [...open.issues.map(i => ({ ...i, opening: true as const })), ...rot.issues]
  if (rot.issues.length === 0 && rot.commands.length === 0) issues.push({ line: 0, message: '排轴里没有指令' })
  // 有错的那一项已跳过，其余照查；切人写错时前台推不下去，不再查前台，免得连带报一串
  if (!open.switchFailed && !rot.switchFailed) {
    issues.push(...checkOnField(open.commands, team, onField, 1).map(i => ({ ...i, opening: true as const })))
    issues.push(...checkOnField(rot.commands, team, endOnField(open.commands, onField), repeat))
  }
  issues.sort((a, b) => Number(!a.opening) - Number(!b.opening) || a.line - b.line || (a.item ?? 0) - (b.item ?? 0))
  return issues.length > 0 ? { ok: false, issues } : { ok: true, commands: rot.commands, opening: open.commands }
}

/** 指令跑完时谁在前台 */
const endOnField = (commands: Command[], onField: Slot): Slot =>
  commands.reduce<Slot>((cur, c) => (c.kind === 'switch' ? c.to : cur), onField)

function compileLines(lines: string[], team: CompileMember[]): { commands: Command[]; issues: CompileIssue[]; switchFailed: boolean } {
  const issues: CompileIssue[] = []
  const commands: Command[] = []
  const slotOf = new Map(team.map((m, i) => [m.name, i as Slot]))
  let switchFailed = false
  lines.forEach((text, i) => {
    const line = i + 1
    const items = parseRotationLine(text)
    if ('error' in items) { issues.push({ line, message: items.error }); return }
    items.forEach((it, j) => {
      const item = j + 1
      if (it.kind === 'wait') { commands.push({ kind: 'wait', line, item, frames: it.frames }); return }
      if (it.kind === 'at') { commands.push({ kind: 'at', line, item, frame: round(it.seconds * 60) }); return }
      if (it.kind === 'enemy') { commands.push({ line, item, ...it }); return }
      const slot = slotOf.get(it.char)
      if (slot === undefined) {
        issues.push({ line, item, message: `${it.char} 不在队伍里（队伍：${team.map(m => m.name).join('、')}）` })
        if (it.kind === 'switch') switchFailed = true
        return
      }
      if (it.kind === 'switch') { commands.push({ kind: 'switch', line, item, to: slot, ...(it.expectIntro ? { expectIntro: true } : {}) }); return }
      if (it.kind === 'fill') { commands.push({ kind: 'fill', line, item, slot, resource: it.resource }); return }
      const m = team[slot]!
      const id = Object.hasOwn(m.actions, it.action) ? it.action : Object.hasOwn(m.aliases, it.action) ? m.aliases[it.action] : undefined
      const def = id !== undefined && Object.hasOwn(m.actions, id) ? m.actions[id] : undefined
      if (id === undefined || !def) {
        issues.push({ line, item, message: `${m.name} 没有动作"${it.action}"（别名：${Object.keys(m.aliases).join('、') || '无'}）` })
        return
      }
      if (def.kind === 'intro' || def.kind === 'outro') {
        issues.push({ line, item, message: `${m.name} ${id} 是${def.kind === 'intro' ? '变奏' : '延奏'}，由切人自动触发（协奏满时），不能单独写` })
        return
      }
      commands.push({
        kind: 'act', line, item, slot, action: id, delay: it.delay, force: it.force,
        ...(it.optional ? { optional: true } : {}), ...(it.filler ? { filler: true } : {}),
      })
    })
  })
  // 补位 "~" 后面（隔着同一角色的别的补位）要接同一角色的普通动作：它看的就是那一个（§3.2）
  commands.forEach((c, i) => {
    if (c.kind === 'act' && c.filler && !fillerTarget(commands, i))
      issues.push({ line: c.line, item: c.item, message: `${team[c.slot]!.name} ${c.action}~：补位后面要接同一角色的动作或"switch <角色> 变奏"（中间不能有别的切人、等待）` })
  })
  return { commands, issues, switchFailed }
}

/** 前台只由 switch 改变，"出招的人在不在前台"编译期就能查（§4.2）。循环时第 2 轮从第 1 轮结束时的前台开始，再查一遍，只报第一处 */
function checkOnField(commands: Command[], team: CompileMember[], onField: Slot, repeat: number): CompileIssue[] {
  const out: CompileIssue[] = []
  let cur = onField
  for (let pass = 1; pass <= Math.min(repeat, 2) && out.length === 0; pass++) {
    const where = pass === 2 ? '循环第 2 轮：' : ''
    for (const c of commands) {
      if (pass === 2 && out.length > 0) break
      if (c.kind === 'switch') {
        if (c.to === cur) out.push({ line: c.line, item: c.item, message: `${where}switch ${team[c.to]!.name}：${team[c.to]!.name} 已经在前台` })
        cur = c.to
      } else if (c.kind === 'act' && c.slot !== cur) {
        const hint = pass === 2 ? `；循环的轴，末尾要让前台回到 ${team[onField]!.name}` : `；先写 switch ${team[c.slot]!.name}`
        out.push({ line: c.line, item: c.item, message: `${where}${team[c.slot]!.name} 不在前台（前台是 ${team[cur]!.name}）${hint}` })
      }
    }
  }
  return out
}
