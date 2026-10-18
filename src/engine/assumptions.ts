// src/engine/assumptions.ts —— 假设登记表（总设计 T16）：原型期先按一个说得过去的做法写进代码、不深究的地方，都登记在这里，
// 写清现在怎么处理、依据、估计影响、出处、怎么改。tracked 的在仿真里碰到时用 assume() 记一笔（角色模块里用 ctx.assume），汇总里列"这次碰到的"
// （Summary.assumptions）；不 tracked 的每次仿真都适用。adjust.path / values 给敏感度分析逐个试（TD-10 §6）。
// 纯数据：Rust 那边照抄这张表，assume() 的调用点一一对应（总设计 §10.1）。
import type { SimState } from './types'

/** 估计对 DPS 的影响：none 不影响（口径或不建模的东西）、tiny < 0.1%、small < 1%、medium 1–5%、large > 5%、unknown 没量过 */
export type Impact = 'none' | 'tiny' | 'small' | 'medium' | 'large' | 'unknown'
export const IMPACT_NAME: Record<Impact, string> = { none: '无', tiny: '极小', small: '小', medium: '中', large: '大', unknown: '未知' }

/** 敏感度分析能自动翻的开关（场景里的写法相同：options.rules.defFloor、options.inputDelay…） */
export type AdjustPath = 'rules.defFloor' | 'options.inputDelay' | 'options.tuneBreak'

export interface Assumption {
  readonly id: string
  readonly topic: string
  readonly what: string                     // 现在怎么处理
  readonly why: string                      // 依据、为什么先这样
  readonly impact: Impact
  readonly ref: string                      // 文档出处
  /** true：碰到才记，结果里列"这次碰到的"；false：每次仿真都适用 */
  readonly tracked: boolean
  readonly adjust?: { readonly how: string; readonly path?: AdjustPath; readonly values?: readonly (number | boolean | string)[] }
}

export const ASSUMPTIONS = [
  {
    id: 'crit-expected', topic: '公式', tracked: false, impact: 'none', ref: '总设计 T4',
    what: '暴击按期望值：每段算非暴击、暴击两支，按暴击率加权',
    why: '没有"暴击时触发"的效果时这就是精确值；有了以后只是近似，用抽样模式量一下偏差',
    adjust: { how: '抽样模式：pnpm sim <场景> --sample N（--jitter F 另加操作抖动），看 DPS 的分布与期望值差多少' },
  },
  {
    id: 'def-no-floor', topic: '公式', tracked: true, impact: 'tiny', ref: 'TD-03 Q1',
    what: '减防、无视防御之后的目标防御不取整',
    why: 'xlsx 多数数组公式不取整，物理与谐度破坏的公式先取整；两种算法差 1 点伤害或相对差 ≤ 0.05%',
    adjust: { how: '场景里 options.rules.defFloor: true 改成先取整', path: 'rules.defFloor', values: [true] },
  },
  {
    id: 'later-damage', topic: '公式', tracked: true, impact: 'unknown', ref: 'TD-03 §5、§6，总设计 §13',
    what: '异常效应、震谐响应、骇破响应的伤害还没算，记 0',
    why: '公式已定，触发时机要等加了用得到的角色再做（TD-06）；现在的队伍不出这几类伤害',
  },
  {
    id: 'single-target', topic: '范围', tracked: false, impact: 'none', ref: '总设计 T5',
    what: '单目标；伤害在判定结算的那一刻算，不模拟弹道、距离、站位',
    why: '配装择优主要打单体 boss',
  },
  {
    id: 'earliest-frame', topic: '调度', tracked: false, impact: 'large', ref: '总设计 T6、TD-09 §3',
    what: '每条指令在最早合法的那一帧执行，没有反应时间',
    why: '算的是理论上限，人手做不到帧帧精确；M0 代表轴每个决策点晚 6 帧 DPS 约 −9.5%，见"操作容错"（pnpm insight，TD-10 §6）',
    adjust: { how: '场景里 options.inputDelay: N（帧）：切人与不是连段后续的出招，在合法之后再晚 N 帧', path: 'options.inputDelay', values: [6] },
  },
  {
    id: 'no-input-buffer', topic: '调度', tracked: false, impact: 'unknown', ref: '总设计 §13、TD-11 §5.6',
    what: '预输入（输入缓存）不建模：窗口一开才执行',
    why: 'xlsx 只有同名跳转标签，没有结构化数据；视频轴每轮比视频标称长约 2 秒，这是候选原因之一',
  },
  {
    id: 'wait-settled', topic: '调度', tracked: true, impact: 'small', ref: '总设计 §13、TD-09 Q2',
    what: '默认等前一个动作"出手"（该生成的判定、延奏都生成了）再出下一招',
    why: '现在打断会丢判定；玩家实际可能取消得更早（椿 A4 → A5 默认比强制慢 96 帧）',
    adjust: { how: '轴里在动作后面写 !（强制，抢帧）' },
  },
  {
    id: 'switch-no-lock', topic: '切人', tracked: false, impact: 'unknown', ref: '总设计 §13、TD-05 Q6',
    what: '备注里"第 n 帧前切人不消失 / 不离场"与没写帧数的"不能切人"，按"切人不打断、没有锁"处理',
    why: '数据没给结构化的帧数；做到相关角色时逐个确认',
  },
  {
    id: 'dilation-rules', topic: '时间', tracked: true, impact: 'small', ref: 'TD-04 §3.3、Q1–Q6',
    what: '时间膨胀的作用范围按 rules.dilation：攻击顿帧同一单位新的替换旧的、时停并存、全局时停停战斗时钟、极限闪避减速随取消解除',
    why: 'xlsx 附页1 的说明加推断，没逐条录屏数帧',
    adjust: { how: '场景里 options.rules.dilation 逐类改' },
  },
  {
    id: 'summon-clock', topic: '时间', tracked: true, impact: 'small', ref: '总设计 §13',
    what: '召唤类（脱手）声骸按战斗时钟走，不被队友的时停冻住',
    why: '与延奏动作的独立时间线同样处理，没实测',
  },
  {
    id: 'buff-live', topic: 'buff', tracked: false, impact: 'small', ref: '总设计 T14',
    what: 'buff 在结算那一刻读取，不按施放时快照',
    why: '符合绝大多数情况；个别要快照的机制交给角色钩子',
  },
  {
    id: 'heal-amount', topic: '资源', tracked: false, impact: 'none', ref: '总设计 §13',
    what: '治疗量不建模，只记"提供了一次治疗"（触发"提供治疗时"的效果）',
    why: 'DPS 不看治疗量；有按治疗量加成的效果时再建模',
  },
  {
    id: 'white-bar', topic: '敌人', tracked: true, impact: 'small', ref: 'TD-06 Q9、Q11',
    what: '白条上限按削韧值取 prop RageMax ÷ 100，瘫痪结束时回满',
    why: '"按削韧值削"用户确认过，上限与回满是推断',
  },
  {
    id: 'tune-break-auto', topic: '敌人', tracked: true, impact: 'medium', ref: 'TD-06 §13.4、Q12',
    what: '目标失谐就由前台角色放谐度破坏（按钮亮着时；队首是连段后续时等这串打完）',
    why: '缺省打法；有响应干涉的队伍会留到合适时机（manual，轴里写"谐度破坏?"）',
    adjust: { how: '场景里 options.tuneBreak: manual（只放轴里写的）或 off（不放）', path: 'options.tuneBreak', values: ['off'] },
  },
  {
    id: 'tunability-base', topic: '敌人', tracked: true, impact: 'small', ref: 'TD-01 Q17',
    what: '角色的偏谐效率、谐破增幅的基础值是推定的',
    why: 'xlsx 没有明确的列',
  },
  {
    id: 'data-guess', topic: '数据', tracked: true, impact: 'unknown', ref: 'TD-01 §13',
    what: '数据里推断出来、还没确认的值照推断用（优先级变化帧、段数、动作类别…）',
    why: '构建时打了 flag；列出的是这次用到的动作，确认后在角色模块里覆盖或 accept',
    adjust: { how: 'pnpm check:data -- --flags <角色> 列出全部；角色模块的 actionOverrides 里覆盖或 accept' },
  },
  {
    id: 'steady-window', topic: '口径', tracked: false, impact: 'none', ref: 'TD-10 §2',
    what: '稳态 DPS 取完整的轮：第 2 轮到倒数第 2 轮（只有 2 轮时取第 2 轮）',
    why: '第 1 轮受开局资源影响；最后一轮没有下一轮起手的边界，偏高',
  },
] as const satisfies readonly Assumption[]

export type AssumptionId = (typeof ASSUMPTIONS)[number]['id']
/** 能在仿真里记的（tracked） */
export type TrackedId = Extract<(typeof ASSUMPTIONS)[number], { tracked: true }>['id']

export const assumptionOf = (id: string): Assumption | undefined => ASSUMPTIONS.find(a => a.id === id)

/** 每条最多留几个例子 */
const MAX_DETAIL = 6

/** 仿真里碰到一条假设：记次数、第一次的战斗帧，并留几个不同的例子（detail，如"椿·盛绽·A2-1D：priorityChangeGuess"） */
export function assume(s: SimState, id: TrackedId, detail?: string): void {
  const a = (s.assumed[id] ??= { n: 0, at: s.battleFrames, detail: [] })
  a.n += 1
  if (detail !== undefined && a.detail.length < MAX_DETAIL && !a.detail.includes(detail)) a.detail.push(detail)
}
