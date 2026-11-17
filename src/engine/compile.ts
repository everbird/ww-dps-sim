// DD-10 §4①、TD-09 §4：静态编译与运行期调度分开。
import type { ActionId, ResourceKind, Slot } from '../data/common'
import type { ActionDef, CoreResourceDef } from '../data/gamedata'
import type { ReplayInsert } from '../data/replay'
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

/** core：角色的核心资源槽（同步按名字找槽、按比例要有上限，DD-09 §3.2）；不给时同步只认能量与协奏 */
export interface CompileMember { name: string; actions: Record<ActionId, ActionDef>; aliases: Record<string, ActionId>; core?: readonly CoreResourceDef[] }
export interface CompileIssue { line: number; item?: number; message: string; opening?: true }
/** 装配结果的队伍 → 编译要的成员表（含核心资源槽：同步按名字找槽） */
export const compileMembers = (r: { team: readonly { def: { name: string; coreResources: CoreResourceDef[] }; actions: Record<ActionId, ActionDef>; aliases: Record<string, ActionId> }[] }): CompileMember[] =>
  r.team.map(m => ({ name: m.def.name, actions: m.actions, aliases: m.aliases, core: m.def.coreResources }))
export type CompileResult = { ok: true; commands: Command[]; opening: Command[] } | { ok: false; issues: CompileIssue[] }

/** rotation（与可选的启动轴 opening）的每一行 → 指令；line 从 1 起（= 场景里第几条），item 是行内第几个动作。
 *  启动轴只跑一次，前台从 onField 推到它结束时，循环轴从那里开始（§3.7）。
 *  inserts：录像剖析未观测时段的填法（DD-09 §3.1，src/data/replay.ts 的 replayInserts），编成第 firstLine 条起的指令，插在闭合的 at 之前 */
export function compileRotation(
  lines: string[], team: CompileMember[], onField: Slot, repeat = 1, openingLines: string[] = [], inserts: readonly ReplayInsert[] = [],
): CompileResult {
  const open = compileLines(openingLines, team)
  const rot = compileLines(lines, team)
  let rotCommands = rot.commands
  let switchFailed = rot.switchFailed
  const insertIssues: CompileIssue[] = []
  for (const ins of inserts) {
    const x = compileLines([...ins.lines], team, ins.firstLine)
    insertIssues.push(...x.issues)
    switchFailed ||= x.switchFailed
    const at = ins.beforeLine === null ? -1 : rotCommands.findIndex(c => c.line === ins.beforeLine)
    const cut = at < 0 ? rotCommands.length : at
    rotCommands = [...rotCommands.slice(0, cut), ...x.commands, ...rotCommands.slice(cut)]
  }
  const issues = [...open.issues.map(i => ({ ...i, opening: true as const })), ...rot.issues, ...insertIssues]
  issues.push(...fillerIssues(open.commands, team).map(i => ({ ...i, opening: true as const })), ...fillerIssues(rotCommands, team))
  if (rot.issues.length === 0 && rotCommands.length === 0) issues.push({ line: 0, message: '排轴里没有指令' })
  // 有错的那一项已跳过，其余照查；切人写错时前台推不下去，不再查前台，免得连带报一串
  if (!open.switchFailed && !switchFailed) {
    issues.push(...checkOnField(open.commands, team, onField, 1).map(i => ({ ...i, opening: true as const })))
    issues.push(...checkOnField(rotCommands, team, endOnField(open.commands, onField), repeat))
  }
  issues.sort((a, b) => Number(!a.opening) - Number(!b.opening) || a.line - b.line || (a.item ?? 0) - (b.item ?? 0))
  return issues.length > 0 ? { ok: false, issues } : { ok: true, commands: rotCommands, opening: open.commands }
}

/** 指令跑完时谁在前台 */
const endOnField = (commands: Command[], onField: Slot): Slot =>
  commands.reduce<Slot>((cur, c) => (c.kind === 'switch' ? c.to : cur), onField)

/** 同步写的资源名 → ResourceKind：能量 / energy、协奏 / concerto，其余按角色的核心资源名（DD-09 §3.2）；写错了返回问题说明 */
function syncResourceKind(m: CompileMember, name: string, unit: 'value' | 'ratio'): { res: ResourceKind } | { problem: string } {
  if (name === '能量' || name === 'energy') return { res: 'energy' }
  if (name === '协奏' || name === 'concerto') return { res: 'concerto' }
  const c = m.core?.find(x => x.name === name)
  if (!c) return { problem: `${m.name} 没有资源"${name}"（能写：能量、协奏${m.core?.length ? `、${m.core.map(x => x.name).join('、')}` : ''}）` }
  if (unit === 'ratio' && !Number.isFinite(c.cap)) return { problem: `${m.name} 的"${name}"没有上限，不能写比例（写 =值）` }
  return { res: `core${c.slot}` as ResourceKind }
}

function compileLines(lines: string[], team: CompileMember[], firstLine = 1): { commands: Command[]; issues: CompileIssue[]; switchFailed: boolean } {
  const issues: CompileIssue[] = []
  const commands: Command[] = []
  const slotOf = new Map(team.map((m, i) => [m.name, i as Slot]))
  let switchFailed = false
  lines.forEach((text, i) => {
    const line = firstLine + i
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
      if (it.kind === 'sync') {
        const x = syncResourceKind(team[slot]!, it.resource, it.unit)
        if ('problem' in x) { issues.push({ line, item, message: x.problem }); return }
        commands.push({ kind: 'sync', line, item, slot, resource: x.res, value: it.value, unit: it.unit })
        return
      }
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
  return { commands, issues, switchFailed }
}

/** 补位 "~" 后面（隔着同一角色的别的补位）要接同一角色的普通动作：它看的就是那一个（§3.2）。在插入填法之后的整条轴上查 */
function fillerIssues(commands: Command[], team: CompileMember[]): CompileIssue[] {
  const issues: CompileIssue[] = []
  commands.forEach((c, i) => {
    if (c.kind === 'act' && c.filler && !fillerTarget(commands, i))
      issues.push({ line: c.line, item: c.item, message: `${team[c.slot]!.name} ${c.action}~：补位后面要接同一角色的动作或"switch <角色> 变奏"（中间不能有别的切人、等待）` })
  })
  return issues
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
