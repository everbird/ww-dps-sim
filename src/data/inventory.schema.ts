// src/data/inventory.schema.ts —— 声骸库存（TD-13 §2）：配装择优从这里挑。写法与场景里的 echoes 一样，
// 主词条可以只写名字（满级值与固定副主属性从 echo-stats.json 补），cost 声骸表里有就不用写。
import { z } from 'zod'
import { STAT_KEYS, type StatKey } from './common'
import type { GameData } from './gamedata'
import { StatValuesSchema } from './scenario.schema'

const InvPieceSchema = z.strictObject({
  id: z.string().min(1).optional(),                       // 缺省按顺序编号 #1、#2…
  name: z.string().min(1),                                // 声骸名（声骸表 A 列；异相·X 取 X）
  set: z.string().min(1),
  cost: z.union([z.literal(1), z.literal(3), z.literal(4)]).optional(),
  main: z.union([z.enum(STAT_KEYS), StatValuesSchema]),   // "暴击率"，或写全 { 暴击率: 0.22, 攻击: 150 }
  subs: StatValuesSchema.default({}),
  owner: z.string().min(1).optional(),                    // 现在装在谁身上（缺省没装）
  note: z.string().optional(),
})

export const InventorySchema = z.strictObject({
  echoes: z.array(InvPieceSchema).min(1),
})
export type InventoryInput = z.input<typeof InventorySchema>
export type Inventory = z.output<typeof InventorySchema>

/** 补全后的一件：主词条写全（含固定副主属性），cost 确定 */
export interface InvPiece {
  id: string
  name: string
  set: string
  cost: 1 | 3 | 4
  main: Partial<Record<StatKey, number>>
  subs: Partial<Record<StatKey, number>>
  owner?: string
}

/** 补全主词条与 cost；错误一次报全（"第 3 件 …"） */
export function resolveInventory(inv: Inventory, data: GameData): { pieces: InvPiece[]; issues: string[] } {
  const issues: string[] = []
  const pieces: InvPiece[] = []
  const stats = data.echoStats
  const seen = new Set<string>()
  inv.echoes.forEach((e, i) => {
    const id = e.id ?? `#${i + 1}`
    const where = `第 ${i + 1} 件（${id} ${e.name}）`
    if (seen.has(id)) issues.push(`${where}：id 重复`)
    seen.add(id)
    const def = data.echoes[e.name] ?? (e.name.startsWith('异相·') ? data.echoes[e.name.slice(3)] : undefined)
    let cost = e.cost ?? def?.cost ?? undefined
    if (e.cost !== undefined && def?.cost && e.cost !== def.cost) issues.push(`${where}：cost 写的 ${e.cost}，声骸表是 ${def.cost}`)
    let main: Partial<Record<StatKey, number>>
    if (typeof e.main === 'string') {
      if (!stats) { issues.push(`${where}：主词条只写了名字，要有 echo-stats.json 才能补满级值（先 pnpm build:data）`); return }
      const opts = stats.mains.filter(x => x.stat === e.main && (cost === undefined || x.cost === cost))
      if (cost === undefined && new Set(opts.map(x => x.cost)).size === 1) cost = opts[0]!.cost
      const m = opts.find(x => x.cost === cost)
      if (cost === undefined) { issues.push(`${where}：不知道 cost（声骸表里没有这个声骸），写上 cost`); return }
      if (!m) { issues.push(`${where}：${cost}C 声骸没有主词条"${e.main}"`); return }
      main = { [m.stat]: m.value }
      for (const f of stats.fixedSubs.filter(x => x.cost === cost)) main[f.stat] = (main[f.stat] ?? 0) + f.value
    } else {
      main = e.main as Partial<Record<StatKey, number>>
      // 主词条写全时，cost 也可以从固定副主属性看出来（4C 攻击 150、3C 攻击 100、1C 生命 2280）
      if (cost === undefined && stats) {
        const fits = [...new Set(stats.fixedSubs.map(f => f.cost))]
          .filter(c => stats.fixedSubs.filter(f => f.cost === c).every(f => main[f.stat] === f.value))
        if (fits.length === 1) cost = fits[0]
      }
    }
    if (cost === undefined) { issues.push(`${where}：不知道 cost（声骸表里没有这个声骸），写上 cost`); return }
    pieces.push({ id, name: e.name, set: e.set, cost, main, subs: e.subs as Partial<Record<StatKey, number>>, ...(e.owner ? { owner: e.owner } : {}) })
  })
  return { pieces, issues }
}
