// src/data/define.ts —— 手写数据模块的类型与 define* 辅助函数（TD-02 §5）
// define* 只做类型约束、原样返回；buff 在注册层装载时再用 BuffDefSchema 校验并补默认值。
import type { ActionId, ActionKind, BodyType, CharName, EffectName, Element, Frame, StatKey, WeaponType } from './common'
import type { BuffDefInput, ResourceEffectInput } from './buff.schema'
import type { CancelWindow, EffectRule, JudgmentDef, PriorityStep } from './gamedata'
import type { CharacterHooks, HookVars } from '../engine/types'

/** 对单个动作的装配结果做覆盖（TD-01 §13.4）；只改装配结果，不回写生成数据。
 *  覆盖了带 flag 的字段，该 flag 即视为已处理（如改 priority 消掉 priorityChangeGuess）；名字写错直接报错，不做模糊匹配。 */
export interface ActionOverride {
  dropRows?: string[]                       // 装配前去掉的行（行名）：互斥的"情形"版本只留一个，如维里奈 A3 只留"目标3m内"
  splitRows?: string[]                      // 装配前拆出的行（行名）：各自成为一个动作，动作 ID 就是行名，如维里奈"A3-地面出场技"（同散华单列的"A2-地面出场技"组）
  /** 落地段（TD-04 §7）：行名 → 落地时的局部帧。下落攻击的"落地"几行，帧数（发生、出现、结束、派生、优先级变化、提示、膨胀发生）
   *  都是从落地起算的，装配前整体后移；这时动作结束帧取各行结束帧的最大值（卜灵空中攻击下落 38 帧落地，落地段第 10 帧结束 → 48）。
   *  先按住再松手的动作同样用它：各行的帧从松手算（散华重击居合按住半秒，各行后移 30 帧） */
  shiftRows?: Record<string, Frame>
  /** 装配前并入这些组的行（帧数照原样，都从本动作起手算），被并入的组照旧另成动作：守岸人的"E-地面"只有起手，
   *  五只黯星·蝶写在"E"组（"E（17F）脱手后自行生成"） */
  absorb?: ActionId[]
  /** 改写在空中的局部帧（null = 一直在地面）：飞行道具那几行的「位置状态」写的是"空中"，装配推成角色在空中（airGuess），如守岸人的大招领域、变奏的黯星·蝶 */
  air?: { from: Frame; until: Frame | null } | null
  copyAs?: ActionId[]                       // 另存为这些动作：同一组行（去掉 dropRows、splitRows 之后）按新 ID 再装配一次，不带本组的其余覆盖；
                                            // xlsx 没写、实测得知的，如椿的地面出场技就是 A2（新 ID 不推连段前置）
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
  'spawnFrame' | 'lifeFrames' | 'delayFrames' | 'ticks' | 'tickInterval' | 'persistsOnCancel' | 'multiplier' | 'tags' | 'target' | 'chainRange' |
  'element' | 'relatedAttr' |               // 元素、相关属性：倍率连不上、手写 multiplier 时一并写（声骸按技能说明）
  'heals' |                                 // 这段同时治疗（动作表没有治疗判定，触发"提供治疗时"的效果用）
  'coreOncePerAction' |                     // 核心资源每个动作实例只发一次：改多次结算后，施放时才给 / 扣的核心资源不跟着乘
  'applies' |                               // 每次结算为目标附加几层异常效应（"命中后赋予目标n层电磁效应"，TD-06 §18）
  'spawns'>>                                // 生成哪些事件判定（备注推得的不对时改写；null = 钩子自己生成）

export interface CharacterModule<V extends HookVars = HookVars> {
  weaponType: WeaponType                    // xlsx 没有，必填（TD-01 Q18）
  bodyType?: BodyType                       // 覆盖 `索引` 的分类（女-特殊 等）
  /** 并入其他动作块（TD-01 Q2）。写成 { block, prefix } 时并入的动作 ID 前面加 prefix：心的岁主形态"照世心"单独一块，
   *  组名与常态重名（A1、E、大招…），并入后叫"照世·A1"…；actionOverrides 也按加了前缀的 ID 写 */
  mergeBlocks?: (string | MergeBlock)[]
  coreCaps?: Partial<Record<1 | 2 | 3 | 4 | 5, number>>   // 修正核心资源上限（TD-01 Q22）
  coreNames?: Partial<Record<1 | 2 | 3 | 4 | 5, string>>  // 改核心资源槽名：主表的槽名带编号（"红椿·蕊1"）时改成游戏里的叫法，场景与 pnpm trace 按它找
  /** 技能树属性节点（回路节点）全部点亮后的合计，进静态面板（总设计 §3.3 第 2 步）。xlsx 没有这项；
   *  按 nanoka 的 skill_trees 手填，`pnpm check:data -- --flags` 会拿 nanoka 核对（与冷却同一做法） */
  treeStats?: Partial<Record<StatKey, number>>
  aliases?: Record<string, ActionId>
  buffs?: BuffDefInput[]
  resourceEffects?: ResourceEffectInput[]   // 资源型触发效果（TD-07 §9）
  /** 钩子的状态量与初值（数或布尔）：钩子里用 ctx.vars.<名字> 读写，没声明的名字编译就报错（总设计 §10.1） */
  vars?: V
  hooks?: CharacterHooks<V>
  actionOverrides?: Record<ActionId, ActionOverride>
  /** 角色在队伍里时改的异常效应规则（TD-06 §18）：心·共鸣模态·电磁的"电磁效应每次触发时不再减少层数"= { 电磁效应: { keepStacks: true } } */
  effectRules?: Partial<Record<EffectName, EffectRule>>
}

export interface MergeBlock { block: string; prefix: string }
/** mergeBlocks 的一项 → 块键 */
export const mergeBlockKey = (m: string | MergeBlock): string => (typeof m === 'string' ? m : m.block)

export interface CharacterModuleDef extends CharacterModule { name: CharName }

/** vars 直接写在模块里时，TS 会把 false、0 推成字面量类型；放宽成 boolean、number，钩子里才能改 */
type Widen<V> = { -readonly [K in keyof V]: V[K] extends boolean ? boolean : V[K] extends number ? number : never }

/** V 从 vars 推断，钩子里的 ctx.vars 按它检查：没声明的名字、类型不对，编译就报错 */
export function defineCharacter<V extends HookVars = Record<never, never>>(
  name: CharName, mod: CharacterModule<Widen<V>> & { vars?: V },
): CharacterModuleDef {
  return { name, ...mod } as CharacterModuleDef
}

export interface EchoSetModule { name: string; pieces: Partial<Record<2 | 3 | 5, BuffDefInput[]>> }
export const defineEchoSet = (m: EchoSetModule): EchoSetModule => m

export interface WeaponModule { name: string; passives: BuffDefInput[]; resourceEffects?: ResourceEffectInput[] }
export const defineWeapon = (m: WeaponModule): WeaponModule => m

/** data/curated/effects.ts 的一项：异常效应的规则（TD-06 §18），取「伤害计算」页各效应的说明；逐层倍率由构建从 dmg 的「异常伤害」行抽进 effects.json */
export interface EffectModule {
  name: EffectName
  element: Element
  source: string                            // 说明原文与出处（行号）
  maxStacks: number                         // 常规上限
  burstMax?: number                         // 到上限后还能额外叠的层数（电磁爆发）；缺省 0
  duration: Frame                           // 每次附加刷新的持续时间
  tickInterval: Frame | null                // 结算周期
  decay?: number                            // 每次结算后移除当前层数的比例（电磁效应"移除当前层数50%"= 0.5）；缺省 0
  /** 层数加到常规上限时立即结算一次、然后清掉全部层数（聚爆效应"达到上限层数时结算1次"）；值是结算冷却（帧），冷却里到上限不结算 */
  settleAtMax?: Frame
}
export const defineEffect = (m: EffectModule): EffectModule => m

/** data/curated/echoes.ts 的一项：声骸技能的附加效果与覆盖（TD-01 §8、§13.3）。声骸技能只能从首位施放，
 *  所以这里的 buff 与资源型效果都只在该声骸装在首位时登记（持有者是装备它的角色） */
export interface EchoModule {
  name: string                              // 声骸表 A 列的名字
  cost?: 1 | 3 | 4                          // `索引` 页缺的声骸在这里补
  /** 按装配的角色换技能版本：角色名 → 动作 ID（天演溯心"若装配角色为心，则声骸技能将变为…"= 'Q·心召唤'）；没写的角色用第一个版本 */
  qFor?: Record<CharName, ActionId>
  mainSlotBuffs?: BuffDefInput[]            // 首位加成（"在首位装配该声骸技能时…"）与技能附带的 buff（无常凶鹭的伤害提升…）
  resourceEffects?: ResourceEffectInput[]   // 技能附带的资源型效果（无常凶鹭"幻形后首次命中敌人，回复自身10点共鸣能量"…）
  actionOverrides?: Record<ActionId, ActionOverride>   // 键是声骸动作 ID（'Q·斩击'）；倍率连不上的在 judgments 里写 multiplier / element
}
export const defineEcho = (m: EchoModule): EchoModule => m

/** data/curated/aliases.ts：dmg 角色名 → { 动作表行名: dmg 行名 | '角色::行名' | null } */
export type DmgJoinMap = Record<string, Record<string, string | null>>
