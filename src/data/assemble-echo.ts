// src/data/assemble-echo.ts —— 声骸表的组 → 声骸动作（TD-01 §8、§13.3）
// 每组按动作表的默认规则装配（assembleGroup），另加：类别一律 'echo'（没连上倍率的判定标签缺省"声骸技能"）、技能版本的冷却、
// 多段声骸的段间连接、脱手与否（summon）、data/curated/echoes.ts 的覆盖。动作 ID 是 'Q·<组名>'，与角色动作不会重名。
import { ECHO_BODY_BY_TYPE, type ActionId, type BodyType } from './common'
import { applyOverride, assembleGroup } from './assemble-action'
import type { ActionOverride } from './define'
import type { ActionDef, EchoDef } from './gamedata'
import type { GenEcho, GenEchoGroup } from './generated.schema'

/** 声骸动作 ID：按体型分组的（只有鸣钟之龟）带 '@<体型前缀>'，装配进角色时去掉（echoActionsFor） */
export const echoActionId = (g: Pick<GenEchoGroup, 'id' | 'body'>): ActionId => `Q·${g.id}${g.body ? `@${g.body}` : ''}`

/** 声骸的全部动作与别名 Q 指向的动作（第一组）。overrides 的键是动作 ID；写了不存在的动作直接报错 */
export function assembleEchoActions(
  e: GenEcho, overrides: Record<ActionId, ActionOverride> = {},
): { actions: Record<ActionId, ActionDef>; q: ActionId } {
  const file = { key: `声骸:${e.key}` }
  const ids = e.groups.map(echoActionId)
  for (const id of Object.keys(overrides))
    if (!ids.includes(id)) throw new Error(`声骸 ${e.key} 的 actionOverrides 写了不存在的动作"${id}"（现有：${ids.join('、')}）`)
  const actions: Record<ActionId, ActionDef> = {}
  e.groups.forEach((g, k) => {
    const id = ids[k]!
    const ov = overrides[id]
    const def = assembleGroup(file, { id, rows: g.rows }, new Set(), { kind: 'echo' }, ov?.dropRows)
    if (g.cooldown) def.cooldown = g.cooldown
    // 脱手与否（2026-10-04 用户说明）：说明里是"召唤…"的脱手释放，"幻形…"的不脱手（切人合轴时在后台打完，引擎本来如此）。
    // 第一个技能版本以说明为准，其余版本（凯尔匹的延奏、神王的变奏）看「类型」列
    if ((g.variant === 1 ? e.textKind ?? g.kind : g.kind) === '召唤') def.summon = true
    // 多段：本段的「单段冷却 ~ 接续时限」是下一段的派生窗口；后续段只能接在上一段之后，不受声骸冷却限制
    // （冷却键用自己的 ID：它没有冷却，永远不会被设上，TD-04 cooldownKey）
    if (g.next) def.cancelWindows = [{ from: g.next.from, until: g.next.until, row: g.rows[0]!.row }]
    if (g.stage !== null && g.stage > 1) {
      def.comboFrom = [ids[k - 1]!]
      def.cooldownGroup = id
    }
    actions[id] = ov ? applyOverride(def, ov) : def
  })
  return { actions, q: ids[0]! }
}

/** 按角色体型挑声骸动作：带 '@体型' 的只留匹配的一组并去掉后缀（中小体型用少女行）。没有匹配的行时用第一组，note 说明 */
export function echoActionsFor(
  e: Pick<EchoDef, 'actions' | 'q'>, body: BodyType | null,
): { actions: Record<ActionId, ActionDef>; q: ActionId; note?: string } {
  const bodied = Object.keys(e.actions).filter(id => id.includes('@'))
  if (bodied.length === 0) return { actions: e.actions, q: e.q }
  const want = body ? ECHO_BODY_BY_TYPE[body] : null
  const match = bodied.find(id => id.endsWith(`@${want}`))
  const chosen = match ?? bodied[0]!
  const bare = (id: ActionId) => id.slice(0, id.indexOf('@'))
  const actions: Record<ActionId, ActionDef> = {}
  for (const [id, a] of Object.entries(e.actions)) {
    if (!id.includes('@')) actions[id] = a
    else if (id === chosen) actions[bare(id)] = { ...a, id: bare(id) }
  }
  return {
    actions, q: e.q.includes('@') ? bare(chosen) : e.q,
    ...(match ? {} : { note: `没有${body ?? '未知'}体型的行，用了 ${chosen}` }),
  }
}
