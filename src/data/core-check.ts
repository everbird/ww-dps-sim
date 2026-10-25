// src/data/core-check.ts —— 核对核心资源槽：动作表各行一次加 / 扣的量比这一槽的上限还大，槽名或上限多半和动作表的列对不上
// （2026-10-25 爱弥斯、琳奈、莫宁：主表 SpecialEnergyNMax.Desc 的槽名与动作表"核心 1/2/3"列错位，莫宁上限按百分数记成 10000；docs/alm-confirm.md Y1）。
// 只提示：哪一槽是什么由人看动作表的备注定，写进角色模块的 coreNames / coreCaps。
import type { ActionDef } from './gamedata'

export interface CoreSlot { slot: number; name: string; cap: number }

/** 每一槽：上限比单次获得 / 消耗的量小，或用到了但上限 ≥ 1000（多半按百分数记的）时，各给一行说明 */
export function checkCoreCaps(acts: Readonly<Record<string, ActionDef>>, cores: readonly CoreSlot[]): string[] {
  const out: string[] = []
  for (const c of cores) {
    let worst = 0
    let where = ''
    for (const a of Object.values(acts)) {
      for (const g of a.castGains) {
        if (g.resource === `core${c.slot}` && Math.abs(g.amount) > Math.abs(worst)) { worst = g.amount; where = `${a.id} 起手` }
      }
      for (const j of a.judgments) {
        const v = j.gains.core[c.slot - 1] ?? 0
        if (Math.abs(v) > Math.abs(worst)) { worst = v; where = `${a.id}/${j.name}` }
      }
    }
    if (Math.abs(worst) > c.cap + 1e-9)
      out.push(`槽 ${c.slot}「${c.name}」上限 ${c.cap}，${where} 一次 ${worst > 0 ? '+' : ''}${worst}：槽名或上限可能和动作表的列对不上（角色模块写 coreNames / coreCaps）`)
    else if (c.cap >= 1000 && worst !== 0)                       // 没用到的占位槽（核心能量4 / 5…）不提示
      out.push(`槽 ${c.slot}「${c.name}」上限 ${c.cap}，动作表单次最多 ${Math.abs(worst)}：上限可能是按百分数记的（角色模块写 coreCaps）`)
  }
  return out
}
