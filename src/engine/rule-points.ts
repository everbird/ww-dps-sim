// src/engine/rule-points.ts —— 规则使用的判定点登记表（DD-05 §4.1；架构 §4.2）。② 共享规则与台账：纯数据，执行核心与分析层只读引用。
// RuleUsageReport.coverage 就是这张表：没登记的读取是"未插桩"，不是 0 次。每个判定点归到台账的一条命题（DD-04 的 PropositionId）。
// 来源：把 assume() 的调用点逐个归成三类（碰到假设 / 读规则 / 决定分支），加上现在没有 assume()、但直接读可翻规则的地方（DD-05 §4.1 的表）。
// 调用处写成一行，放在读规则的那个判断旁边：k.rule.note(点, 读到的值, 这一处是否决定了分支)；角色模块用 ctx.noteRule(点, 是否决定)。
// "决定了分支"：在当时的局部状态下换成另一个已实现的候选值，这一处会走另一条分支；不等于改变了结果（架构 §4.2）。
import type { PropositionId } from './propositions'

export interface RulePoint {
  readonly id: string                    // 'sched.switch.switchEndsStop'
  readonly propositionId: PropositionId  // DD-04 的台账
  readonly symbol: string                // 在哪：文件与符号，不写行号
  readonly decisiveWhen: string          // 一句话：什么局部状态下它决定分支
}

export const RULE_POINTS = [
  {
    id: 'sched.switch.switchEndsStop', propositionId: 'switch-ends-stop', symbol: 'scheduler.ts evaluate（切人，算 early 处）',
    decisiveWhen: '有写明的切人锁、锁比全局时停早结束、局部帧已过锁但没过时停',
  },
  {
    id: 'sched.execute.switchEndsStop', propositionId: 'switch-ends-stop', symbol: 'scheduler.ts execute（切人，清时停处）',
    decisiveWhen: '切出者还有没走完的时停窗口',
  },
  {
    id: 'sched.switch.ultInputLock', propositionId: 'ult-input-locks-switch', symbol: 'scheduler.ts evaluate（切人，算 off 处；当前动作的锁来自"不响应输入"时读）',
    decisiveWhen: '当前动作的锁来自"不响应输入"，局部帧还在锁内',
  },
  {
    id: 'sched.switch.invincibleLock', propositionId: 'invincible-locks-switch', symbol: 'scheduler.ts evaluate（切人，算 off 处；当前动作的锁来自无敌推断时读）',
    decisiveWhen: '当前动作的锁来自无敌推断，局部帧还在锁内',
  },
  {
    id: 'sched.act.echoInputPriority', propositionId: 'echo-input-priority', symbol: 'scheduler.ts evaluateAct（调 gate 处）',
    decisiveWhen: 'gate(ch, def, true) 与 gate(ch, def, false) 的结果不同（gate 是纯函数，多算一次没有副作用）',
  },
  {
    id: 'sched.input.delay', propositionId: 'input-delay', symbol: 'scheduler.ts afterInput',
    decisiveWhen: '这条指令的操作延迟大于 0',
  },
  {
    id: 'sched.interject.tuneBreak', propositionId: 'tune-break-mode', symbol: 'simulate.ts execute 的 interject（调度器插队的回调）',
    decisiveWhen: '插入了一次自动谐度破坏（返回非空）',
  },
  {
    id: 'kernel.dilation.hitstopInGlobalStop', propositionId: 'hitstop-in-global-stop', symbol: 'kernel.ts registerDilation',
    decisiveWhen: '战斗时钟正被全局时停停住，且登记的是作用在角色侧（自身、队友）的攻击顿帧',
  },
  {
    id: 'formula.defFloor', propositionId: 'def-floor', symbol: 'formula.ts computeHit、abnormalHit、computeTuneBreak（用 rules.defFloor 处）',
    decisiveWhen: '减防后的防御不是整数',
  },
  {
    id: 'enemy.effectTick.reset', propositionId: 'effect-tick-timer', symbol: 'enemy.ts applyEffect（处理计时处）',
    decisiveWhen: '效应已在计时中又被附加，重新计时会改下次结算的时刻',
  },
  {
    id: 'enemy.effectTick.owner', propositionId: 'effect-owner', symbol: 'enemy.ts effectTicks（选归属处）',
    decisiveWhen: '最后附加者、第一次附加者、当前前台三者不全相同',
  },
  {
    id: 'enemy.interferenceFrames', propositionId: 'interference-frames', symbol: 'enemy.ts interfere（进入干涉处）',
    decisiveWhen: '每次进入干涉（数值型规则：用到就算）',
  },
  {
    id: 'triggers.summonAsChar', propositionId: 'summon-as-char', symbol: 'triggers.ts occurrencesOf（enemyState 分支）',
    decisiveWhen: '事件带 summon，且记了附加者（换个读法就触发 / 不触发"附加…后"）',
  },
  {
    // 按角色覆盖的协奏时机（DD-08 §6 的 concertoTimingBy）：只有台账里有按角色命题的角色才记（CONCERTO_TIMING_POINTS），
    // 别人读的是共享的 concertoTiming（2026-10-03 实测，不在台账）
    id: 'res.concertoTiming.卜灵', propositionId: 'buling-concerto-timing', symbol: 'resources.ts castResources、settleGains（concertoTimingOf 处，施放者 / 出伤者是卜灵时）',
    decisiveWhen: '起手时：这个动作有由时间线生成、带协奏的判定（onCast 在起手时一次给全）；结算时：判定由时间线生成、带协奏（onHit 才在这时给）',
  },
  {
    // 起手即得什么时候给（规则 castGainTiming，2026-11-27 加；挪的动作在装配时定，resolve.ts deferCastGains）
    id: 'res.castGainTiming', propositionId: 'cast-gain-at-start', symbol: 'resources.ts castResources（起手时）',
    decisiveWhen: '这个动作有起手即得的正数项、时间线上也有判定（start 在起手时给；firstHit 已挪到最早生成的判定，第一次结算时给）',
  },
  {
    id: 'char.心.forteKeep', propositionId: 'forte-keep.心-照世相', symbol: 'data/curated/characters/心.ts onEvent（切出时）',
    decisiveWhen: '切出时有照世相、心相心生、统御众机这些状态可清',
  },
  {
    id: 'char.心.summonAsChar', propositionId: 'summon-as-char', symbol: 'data/curated/characters/心.ts onEvent（enemyState 的电磁效应附加处）',
    decisiveWhen: '阵、召唤物附加了电磁效应（事件带 summon、记了附加者）：换个读法固有1、霆霓、霆心域就算 / 不算',
  },
  {
    id: 'char.卜灵.forteKeep', propositionId: 'forte-keep.卜灵-卦象', symbol: 'data/curated/characters/卜灵.ts onEvent（切出时）',
    decisiveWhen: '切出时卦象、少阳 / 少阴不为空',
  },
  {
    id: 'char.爱弥斯.trackNoConsume', propositionId: 'track-no-consume', symbol: 'data/curated/characters/爱弥斯.ts onEvent（光翼共奏移除震谐轨迹处）',
    decisiveWhen: '过载后第一次光翼共奏（轨迹无消耗期间、有轨迹层数）',
  },
] as const satisfies readonly RulePoint[]

export type RulePointId = (typeof RULE_POINTS)[number]['id']
/** 角色模块能记的判定点（ctx.noteRule）：读到的值由钩子上下文按规则取（simulate.ts 的 hookContext） */
export type HookRulePointId = Extract<RulePointId, `char.${string}`>

/** 按角色覆盖的协奏时机在执行核心里的判定点：角色名 → 点。只列台账里有按角色命题的角色（buling-concerto-timing，DD-08 §13）；
 *  数据放在台账这一层，引擎的代码不写角色名 */
export const CONCERTO_TIMING_POINTS: Readonly<Partial<Record<string, RulePointId>>> = { 卜灵: 'res.concertoTiming.卜灵' }
