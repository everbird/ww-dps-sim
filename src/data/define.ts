// src/data/define.ts —— 手写数据模块的类型与 define* 辅助函数（TD-02 §5）
// define* 只做类型约束、原样返回；buff 在注册层装载时再用 BuffDefSchema 校验并补默认值。
import type { ActionId, ActionKind, BodyType, CharName, Frame, StatKey, WeaponType } from './common'
import type { BuffDefInput, ResourceEffectInput } from './buff.schema'
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
  charges?: number                          // 按次数充能：最多存几次（初始满），每 cooldown 帧回复 1 次
  summon?: boolean                          // 召唤类（脱手）声骸：缺省按技能说明的"召唤 / 幻形"定，这里可改
  energyCost?: number                       // 开始时要有并扣掉的大招能量；别名 R 的动作自动设，写 0 取消（TD-06 §2.3）
  endOnSwitchOut?: Frame                    // 切出时局部帧 ≥ 它就结束（TD-05 §5）；构建脚本从备注抽，这里可改
  followUp?: { after: string; action: ActionId }   // 本动作的判定 after 第一次结算后，立刻开始 action（TD-08 P10）
  judgments?: Record<string, JudgmentOverride>   // 键是判定名（组内重名带 #n）
  accept?: string[]                         // 明确接受、不再提示的 flag（动作级与该动作的判定级都算）
}

export type JudgmentOverride = Partial<Pick<JudgmentDef,
  'spawnFrame' | 'lifeFrames' | 'ticks' | 'tickInterval' | 'persistsOnCancel' | 'multiplier' | 'tags' | 'target' | 'chainRange' |
  'element' | 'relatedAttr' |               // 元素、相关属性：倍率连不上、手写 multiplier 时一并写（声骸按技能说明）
  'heals'>>                                 // 这段同时治疗（动作表没有治疗判定，触发"提供治疗时"的效果用）

export interface CharacterModule {
  weaponType: WeaponType                    // xlsx 没有，必填（TD-01 Q18）
  bodyType?: BodyType                       // 覆盖 `索引` 的分类（女-特殊 等）
  mergeBlocks?: string[]                    // 并入其他动作块（TD-01 Q2）
  coreCaps?: Partial<Record<1 | 2 | 3 | 4 | 5, number>>   // 修正核心资源上限（TD-01 Q22）
  coreNames?: Partial<Record<1 | 2 | 3 | 4 | 5, string>>  // 改核心资源槽名：主表的槽名带编号（"红椿·蕊1"）时改成游戏里的叫法，场景与 pnpm trace 按它找
  /** 技能树属性节点（回路节点）全部点亮后的合计，进静态面板（总设计 §3.3 第 2 步）。xlsx 没有这项；
   *  按 nanoka 的 skill_trees 手填，`pnpm check:data -- --flags` 会拿 nanoka 核对（与冷却同一做法） */
  treeStats?: Partial<Record<StatKey, number>>
  aliases?: Record<string, ActionId>
  buffs?: BuffDefInput[]
  resourceEffects?: ResourceEffectInput[]   // 资源型触发效果（TD-07 §9）
  hooks?: CharacterHooks
  actionOverrides?: Record<ActionId, ActionOverride>
}

export interface CharacterModuleDef extends CharacterModule { name: CharName }

export function defineCharacter(name: CharName, mod: CharacterModule): CharacterModuleDef {
  return { name, ...mod }
}

export interface EchoSetModule { name: string; pieces: Partial<Record<2 | 3 | 5, BuffDefInput[]>> }
export const defineEchoSet = (m: EchoSetModule): EchoSetModule => m

export interface WeaponModule { name: string; passives: BuffDefInput[]; resourceEffects?: ResourceEffectInput[] }
export const defineWeapon = (m: WeaponModule): WeaponModule => m

/** data/curated/echoes.ts 的一项：声骸技能的附加效果与覆盖（TD-01 §8、§13.3）。声骸技能只能从首位施放，
 *  所以这里的 buff 与资源型效果都只在该声骸装在首位时登记（持有者是装备它的角色） */
export interface EchoModule {
  name: string                              // 声骸表 A 列的名字
  cost?: 1 | 3 | 4                          // `索引` 页缺的声骸在这里补
  mainSlotBuffs?: BuffDefInput[]            // 首位加成（"在首位装配该声骸技能时…"）与技能附带的 buff（无常凶鹭的伤害提升…）
  resourceEffects?: ResourceEffectInput[]   // 技能附带的资源型效果（无常凶鹭"幻形后首次命中敌人，回复自身10点共鸣能量"…）
  actionOverrides?: Record<ActionId, ActionOverride>   // 键是声骸动作 ID（'Q·斩击'）；倍率连不上的在 judgments 里写 multiplier / element
}
export const defineEcho = (m: EchoModule): EchoModule => m

/** data/curated/aliases.ts：dmg 角色名 → { 动作表行名: dmg 行名 | '角色::行名' | null } */
export type DmgJoinMap = Record<string, Record<string, string | null>>
