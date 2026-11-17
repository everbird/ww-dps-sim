// src/engine/filler.ts —— 补位 "~" 看哪一条（TD-09 §3.2）。执行组：编译期的检查（compile.ts）与运行期的调度（scheduler.ts）共用，
// 放在这里是因为执行组不能倒引编译（DD-10 §4 规则 3），两边原来各抄一份。纯函数，只读指令表。
import type { Command } from '../data/scenario.schema'

/** 补位 "~" 看的那一条：往后跳过同一角色的补位，第一条同一角色的普通动作，或紧接着的"switch <角色> 变奏"（看切出者的协奏满没满）、
 *  "at <世界秒>"（还没到就接着补）；遇到别的切人、等待或别的角色就没有 */
export function fillerTarget(list: readonly Command[], i: number): Extract<Command, { kind: 'act' | 'switch' | 'at' }> | undefined {
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
