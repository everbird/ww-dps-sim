// src/data/define.ts —— 手写数据模块的类型与 define* 辅助函数（TD-02 §5）
// define* 只做类型约束、原样返回；buff 在注册层装载时再用 BuffDefSchema 校验并补默认值。
import type { ActionId, ActionKind, BodyType, CharName, Frame, StatKey, WeaponType } from './common'
import type { BuffDefInput } from './buff.schema'
import type { CancelWindow, JudgmentDef, PriorityStep } from './gamedata'
import type { CharacterHooks } from '../engine/types'

/** 对单个动作的装配结果做覆盖（TD-01 §13.4）；只改装配结果，不回写生成数据。
 *  覆盖了带 flag 的字段，该 flag 即视为已处理（如改 priority 消掉 priorityChangeGuess）；名字写错直接报错，不做模糊匹配。 */
export interface ActionOverride {
  dropRows?: string[]                       // 装配前去掉的行（行名）：互斥的"情形"版本只留一个，如维里奈 A3 只留"目标3m内"
  kind?: ActionKind
  endFrame?: Frame                          // 不会重算派生窗口；需要时一并覆盖 cancelWindows
  priority?: PriorityStep[]
  cancelWindows?: Omit<CancelWindow, 'row'>[]
  outroTriggerFrame?: Frame
  switchLockUntil?: Frame
  comboFrom?: ActionId[]                    // 连段前置（TD-04 §6.2）：自动推断之外的，如 E1 → E2
  cooldown?: Frame                          // 技能冷却（帧）：xlsx 只有声骸的，角色技能的冷却写在这里（TD-09 §3.2）
  cooldownGroup?: string                    // 几个动作共用一个冷却时写同一个组名（椿的 E1 / E2 → 'E'）
  judgments?: Record<string, JudgmentOverride>   // 键是判定名（组内重名带 #n）
  accept?: string[]                         // 明确接受、不再提示的 flag（动作级与该动作的判定级都算）
}

export type JudgmentOverride = Partial<Pick<JudgmentDef,
  'spawnFrame' | 'lifeFrames' | 'ticks' | 'tickInterval' | 'persistsOnCancel' | 'multiplier' | 'tags' | 'target' | 'chainRange'>>

export interface CharacterModule {
  weaponType: WeaponType                    // xlsx 没有，必填（TD-01 Q18）
  bodyType?: BodyType                       // 覆盖 `索引` 的分类（女-特殊 等）
  mergeBlocks?: string[]                    // 并入其他动作块（TD-01 Q2）
  coreCaps?: Partial<Record<1 | 2 | 3 | 4 | 5, number>>   // 修正核心资源上限（TD-01 Q22）
  /** 技能树属性节点（回路节点）全部点亮后的合计，进静态面板（总设计 §3.3 第 2 步）。xlsx 没有这项；
   *  按 nanoka 的 skill_trees 手填，`pnpm check:data -- --flags` 会拿 nanoka 核对（与冷却同一做法） */
  treeStats?: Partial<Record<StatKey, number>>
  aliases?: Record<string, ActionId>
  buffs?: BuffDefInput[]
  hooks?: CharacterHooks
  actionOverrides?: Record<ActionId, ActionOverride>
}

export interface CharacterModuleDef extends CharacterModule { name: CharName }

export function defineCharacter(name: CharName, mod: CharacterModule): CharacterModuleDef {
  return { name, ...mod }
}

export interface EchoSetModule { name: string; pieces: Partial<Record<2 | 3 | 5, BuffDefInput[]>> }
export const defineEchoSet = (m: EchoSetModule): EchoSetModule => m

export interface WeaponModule { name: string; passives: BuffDefInput[] }
export const defineWeapon = (m: WeaponModule): WeaponModule => m

export interface EchoModule {
  name: string
  cost?: 1 | 3 | 4                          // `索引` 页缺的声骸在这里补
  mainSlotBuffs?: BuffDefInput[]            // 首位装配加成
  multipliers?: Record<string, number>      // 行名 → 倍率；dmg 缺失时从技能说明录入（TD-01 Q15）
}
export const defineEcho = (m: EchoModule): EchoModule => m

/** data/curated/aliases.ts：dmg 角色名 → { 动作表行名: dmg 行名 | '角色::行名' | null } */
export type DmgJoinMap = Record<string, Record<string, string | null>>
