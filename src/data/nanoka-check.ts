// src/data/nanoka-check.ts —— 拿 nanoka 的技能冷却核对角色模块手填的冷却（m0-confirm §5；AGENTS.md 差异 4）
// 只提示、不自动填：共用冷却（椿 E1 / E2）、跟随动作（散华 大招-引爆冰川）这些没法从 nanoka 推出来，由人写进角色模块。
import type { ActionId } from './common'
import type { ActionDef } from './gamedata'
import type { NanokaCharacter } from './generated.schema'

/** nanoka 技能类型 → 排轴别名：这个别名指向的动作应当有该技能的"冷却时间" */
const TYPE_ALIAS: Record<string, string> = { 共鸣技能: 'E', 共鸣解放: 'R' }

const sec = (f: number): string => `${f / 60} 秒（${f} 帧）`

export function checkCooldowns(
  acts: Record<ActionId, ActionDef>, aliases: Record<string, ActionId>, nk: NanokaCharacter,
): string[] {
  const out: string[] = []
  for (const s of nk.skills) {
    const alias = TYPE_ALIAS[s.type]
    const cd = s.cooldowns.find(c => c.name === '冷却时间')
    const id = alias && aliases[alias]
    if (!cd || !id || !acts[id]) continue
    const have = acts[id].cooldown
    if (have === undefined) out.push(`${id}（${alias}）没有冷却；nanoka ${s.type}「${s.name}」冷却时间 ${sec(cd.frames)}`)
    else if (have !== cd.frames) out.push(`${id}（${alias}）冷却 ${sec(have)}，nanoka ${s.type}「${s.name}」是 ${sec(cd.frames)}`)
  }
  const known = new Set(nk.skills.flatMap(s => s.cooldowns.map(c => c.frames)))
  for (const a of Object.values(acts)) {
    if (a.kind === 'echo' || a.cooldown === undefined || known.has(a.cooldown)) continue
    const list = nk.skills.flatMap(s => s.cooldowns.map(c => `${s.type}·${c.name} ${c.seconds} 秒`)).join('、') || '无'
    out.push(`${a.id} 冷却 ${sec(a.cooldown)}，nanoka 里没有这个数（有：${list}）`)
  }
  return out
}
