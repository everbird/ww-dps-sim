// src/data/nanoka-check.ts —— 拿 nanoka 核对角色模块手填的冷却与技能树属性（m0-confirm §5、TD-01 §12.5）
// 只提示、不自动填：共用冷却（椿 E1 / E2）、跟随动作（散华 大招-引爆冰川）这些没法从 nanoka 推出来，由人写进角色模块。
import { STAT_KEYS, type ActionId, type StatKey } from './common'
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

/** nanoka 技能树节点名 → 属性键："攻击提升" → 攻击%，"冷凝伤害加成提升" → 冷凝伤害加成 */
export function treeStatKey(name: string): StatKey | undefined {
  const base = name.replace(/提升$/, '')
  const pct: Record<string, StatKey> = { 攻击: '攻击%', 生命: '生命%', 防御: '防御%', 暴击: '暴击率' }
  if (pct[base]) return pct[base]
  return (STAT_KEYS as readonly string[]).includes(base) ? (base as StatKey) : undefined
}

/** 角色模块的 treeStats 与 nanoka 技能树属性节点对不上的地方 */
export function checkTreeStats(have: Partial<Record<StatKey, number>>, nk: NanokaCharacter): string[] {
  const out: string[] = []
  const want: Partial<Record<StatKey, number>> = {}
  for (const [name, v] of Object.entries(nk.treeStats)) {
    const k = treeStatKey(name)
    if (!k) { out.push(`nanoka 技能树节点"${name}"认不出是哪个属性`); continue }
    want[k] = (want[k] ?? 0) + v
  }
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9
  for (const k of new Set([...Object.keys(want), ...Object.keys(have)] as StatKey[])) {
    const a = have[k] ?? 0, b = want[k] ?? 0
    if (!close(a, b)) out.push(`技能树 ${k}：角色模块 ${a}，nanoka ${b}`)
  }
  return out
}
