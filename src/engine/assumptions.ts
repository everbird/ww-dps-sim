// src/engine/assumptions.ts —— 假设登记表（总设计 T16）：原型期先按一个说得过去的做法写进代码、不深究的地方，都登记在这里，
// 写清现在怎么处理、依据、估计影响、出处、怎么改。tracked 的在仿真里碰到时用 assume() 记一笔（角色模块里用 ctx.assume），汇总里列"这次碰到的"
// （Summary.assumptions）；不 tracked 的每次仿真都适用。adjust.path / values 给敏感度分析逐个试（TD-10 §6）。
// 纯数据：Rust 那边照抄这张表，assume() 的调用点一一对应（总设计 §10.1）。
import type { SimState } from './types'

/** 估计对 DPS 的影响：none 不影响（口径或不建模的东西）、tiny < 0.1%、small < 1%、medium 1–5%、large > 5%、unknown 没量过 */
export type Impact = 'none' | 'tiny' | 'small' | 'medium' | 'large' | 'unknown'
export const IMPACT_NAME: Record<Impact, string> = { none: '无', tiny: '极小', small: '小', medium: '中', large: '大', unknown: '未知' }

/** 敏感度分析能自动翻的开关（场景里的写法相同：options.rules.defFloor、options.inputDelay…） */
export type AdjustPath = 'rules.defFloor' | 'rules.effectTickReset' | 'rules.effectOwner' | 'rules.forteKeepOnSwitch' | 'rules.ultInputLocksSwitch'
  | 'rules.invincibleLocksSwitch' | 'rules.switchEndsStop' | 'rules.echoInputPriority' | 'rules.interferenceFrames' | 'rules.trackNoConsume' | 'rules.summonCountsAsChar' | 'options.inputDelay' | 'options.tuneBreak'

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
    what: '骇破响应，以及动作表里标了"异常效应"的直接判定，伤害还没算，记 0（异常效应的定时结算与钩子主动触发的已经算了，TD-06 §18；震谐响应 2026-10-25 起按 TD-03 §6 算，TD-06 §19）',
    why: '公式已定，触发时机要等加了用得到的角色再做（TD-06）；现在的队伍不出这几类伤害',
  },
  {
    id: 'effect-tick', topic: '异常效应', tracked: true, impact: 'unknown', ref: 'TD-06 §18，docs/xin-confirm.md §4',
    what: '定时结算（电磁效应 5 秒一次）从第一次附加起按战斗帧计时，之后再附加不重置；按当时的层数倍率出一段伤害，'
      + '之后移除 ⌊层数 × 50%⌋ 层（5 层剩 3 层）；到期那一刻赶上结算的先结算再消失',
    why: '原文只写"每5秒结算1次对应层数倍率异常伤害、移除当前层数50%的异常层数"，没说计时从哪一刻起、单数层怎么取整；'
      + '心·共鸣模态·电磁下不减层，心 · 雷主 · 卜灵不受取整影响',
    adjust: { how: '场景里 options.rules.effectTickReset: true 改成每次附加都重新计时；取整在 src/engine/enemy.ts 的 effectTicks', path: 'rules.effectTickReset', values: [true] },
  },
  {
    id: 'effect-owner', topic: '异常效应', tracked: true, impact: 'unknown', ref: 'TD-06 §18、TD-03 §5',
    what: '定时结算的伤害记在最后一次附加的人名下，吃他身上与目标身上、过滤对得上的加深与最终伤害（元素对得上的"导电伤害加深"也算），'
      + '不吃伤害加成、不暴击、出伤者的减防不算',
    why: '原文没说异常伤害算谁的、吃谁身上的 buff；各人身上的加深不同时（心的延奏只给心以外的人），记在谁名下会改变结算的伤害',
    adjust: { how: '场景里 options.rules.effectOwner: first（第一次附加的人）或 onField（结算时在前台的人）', path: 'rules.effectOwner', values: ['first', 'onField'] },
  },
  {
    id: 'effect-burst', topic: '异常效应', tracked: true, impact: 'unknown', ref: 'TD-06 §18',
    what: '电磁爆发（额外层）：结算时另加"电磁爆发层数对应的倍率"，与常规层数的倍率相加；结算后清零',
    why: '原文"下次结算电磁效应伤害时，额外附加当前电磁爆发层数倍率"，没说怎么叠、结算后留不留；'
      + '心在队伍里时添加的电磁爆发当场被消耗成霆心域，碰不到',
  },
  {
    id: 'effect-settle-clear', topic: '异常效应', tracked: true, impact: 'unknown', ref: 'TD-06 §18、docs/tower-20261026.md',
    what: '聚爆效应加到上限时按上限层数的倍率结算一次（记在加到上限的人名下），然后清掉全部层数，结算冷却 0.2 秒',
    why: '原文"达到上限层数时结算1次对应层数异常倍率"没说结算后层数怎样；达妮娅 6 链"本次引爆…且不移除聚爆效应层数"反推平常会移除。'
      + '2026-10-27 中 2 录像证实会清：boss 血条下的图标 8 层 → 白QTE 加到 10 层引爆 18054 → 图标消失、之后从 2 层重新叠（docs/tower-20261026.md 中 2 跳字对照）',
  },
  {
    id: 'single-target', topic: '范围', tracked: false, impact: 'none', ref: '总设计 T5',
    what: '单目标；伤害在判定结算的那一刻算，不模拟弹道、距离、站位',
    why: '配装择优主要打单体 boss',
  },
  {
    id: 'earliest-frame', topic: '调度', tracked: false, impact: 'large', ref: '总设计 T6、TD-09 §3',
    what: '每条指令在最早合法的那一帧执行，没有反应时间',
    why: '算的是理论上限，真人操作做不到帧帧精确；每个决策点晚 6 帧，M0 代表轴 DPS 约 −7.4%、视频轴（EQ 版）约 −7.2%，见"操作容错"（pnpm insight，TD-10 §6；docs/m0-conclusions.md）',
    adjust: { how: '场景里 options.inputDelay: N（帧）：切人与不是连段后续的出招，在合法之后再晚 N 帧', path: 'options.inputDelay', values: [6] },
  },
  {
    id: 'no-input-buffer', topic: '调度', tracked: false, impact: 'unknown', ref: '总设计 §13、TD-11 §5.6',
    what: '预输入（输入缓存）不建模：窗口一开才执行',
    why: 'xlsx 只有同名跳转标签，没有结构化数据；视频轴曾经每轮比视频长约 2 秒，已查明是转写错了（EZR 应为 ERZ），与预输入无关',
  },
  {
    id: 'wait-settled', topic: '调度', tracked: true, impact: 'small', ref: '总设计 §13、TD-09 Q2',
    what: '默认等前一个动作"出手"（该生成的判定、延奏都生成了）再出下一招',
    why: '现在打断会丢判定；玩家实际可能取消得更早（椿 A4 → A5 默认比强制慢 96 帧）',
    adjust: { how: '轴里在动作后面写 !（强制，抢帧）' },
  },
  {
    id: 'switch-no-lock', topic: '切人', tracked: false, impact: 'small', ref: '总设计 §13、TD-05 Q6',
    what: '没写帧数的"不能切人"：动作自己的（"无敌期间不能切人"，以及"不响应输入，不能切人""大招状态期间不能切人""第120F不能切人"…）锁到无敌结束（无敌启动帧 + 无敌持续帧），'
      + '没有无敌帧的到动作结束（2026-10-21；谐度破坏仍按整个动作；推断的记 flag noSwitchUnframed：布兰特、菲比、弗洛洛、芙露德莉斯、奥古斯塔大招，绯雪重击，洛瑟菈断舍离前置）。'
      + '跨几个动作的状态（奥古斯塔"大招状态期间"、丽贝卡"机枪期间"）只锁这一个动作；"第 n 帧前切人不消失 / 不离场"按"切人不打断"；大招什么都没写的（折枝、釉瑚、洛可可…）不锁',
    why: '数据没给结构化的帧数；无敌帧不一定等于切人锁（散华大招无敌 125 帧，"第91F前不能切人"）。做到相关角色时逐个确认，跨动作的状态要在角色模块里写。'
      + '2026-10-22 先因敏感度矩阵改成"大"，同日查明那几个大招（万阙垂天、转相、雷主大招）的锁其实是全局时停（大招动画，WuwaLAB 也只记 time_stop），'
      + '全局时停另由调度器挡切人（ActionDef.globalStopUntil）之后，关掉这类锁对现有的轴没有影响，改回"小"',
    adjust: { how: '场景里 options.rules.invincibleLocksSwitch: false：这类推断出来的锁（ActionDef.switchLockFromInvincible）都不锁；做到相关角色时逐个确认', path: 'rules.invincibleLocksSwitch', values: [false] },
  },
  {
    id: 'entry-skill', topic: '切人', tracked: false, impact: 'small', ref: 'm0-confirm §11 V10、§14 D2，TD-09 §3.5',
    what: '出场技（动作 ID 以"出场技"结尾："A2-地面出场技""A3-地面出场技"…）只能从地面普通切人入场后第一个出，否则调度器报错 entrySkill：'
      + '变奏入场；入场后先出了别的招（含自动插的谐度破坏）；开场就在前台；切回来时自己在后台的动作还没走完；切出的角色在空中（切进来的出现在它的位置，也在空中）。反过来，有出场技的角色地面普通切人入场后第一下写 A1 也报错（按 A 就是出场技）。'
      + '在不在空中按 xlsx「位置状态」「状态转换时间」（ActionDef.air）：动作结束时在空中的算一直在空中（不模拟下落）；"…落地"段的帧从落地算，落地时刻按动作结束',
    why: '出场技只在普通切人入场后按 A 才有（用户确认）；在空中切人、切进来的也在空中（用户 2026-10-21 确认）；后台动作要走完是用户的印象（m0-confirm §14 D2，未实测）；'
      + '"第一个出""开场不算入场"与不模拟下落是推断',
    adjust: { how: '改调度器的检查（src/engine/scheduler.ts 的 evaluateAct、switch 时的 SimState.entry）与装配的 airOf（src/data/assemble-action.ts）' },
  },
  {
    id: 'hand-speed', topic: '调度', tracked: false, impact: 'large', ref: 'TD-10 §6 ⑤、⑥',
    what: '抽样模式的手速档（pnpm sim --sample N --hand）：每个决策点在合法之后再晚 max(0, round(正态(平均, 标准差))) 帧；高手 3 / 1.5、熟练 6 / 3、普通 10 / 5。'
      + '能预输入的其实是 0，现在不分；连段后续不加（同 earliest-frame）',
    why: '用户 2026-10-21 要的：先假设一个分布，以后单独测（与暴击、数据、机制正交）。按节奏背熟的轴是踩着节奏按，不是看到才反应（看到才按约 12–15 帧）；数是估的，没出处',
    adjust: { how: '改 src/engine/sample.ts 的 HAND_PROFILES；以后用录像量（TD-11 §6.3 视频时间点：合法帧到实际按下的间隔）' },
  },
  {
    id: 'air-entry', topic: '切人', tracked: false, impact: 'small', ref: 'TD-09 §3.5，docs/xin-confirm.md §6 C4',
    what: '切进来的第一下是一开始就在空中的攻击（卜灵"空中攻击"）时，切出者要在空中（切进来的出现在它的位置）：切出者这个动作稍后会离地（雷主 E 第 26 帧）就等，'
      + '不会的报错 airEntry。没处理的：切出者在空中、切进来第一下写地面 A（M0 视频轴"维R跳AAA → 椿AAAAA"，仿真在强化空中A3 第 0 帧就切）；'
      + '不在切人那一刻的空中动作（C3 卜灵先放 Q 再空中攻击）；动作结束时在空中的不模拟下落',
    why: '用户 2026-10-21：雷主 E 跳起时切卜灵，卜灵在空中打 A 攒蓝符、落地再 A 攒黄符；在空中切人，切进来的也在空中（用户确认）。离地帧取 xlsx「位置状态」',
    adjust: { how: '改调度器 switch 的检查（src/engine/scheduler.ts）；没处理的几种要先问清游戏里怎么打' },
  },
  {
    id: 'forte-keep-on-switch', topic: '切人', tracked: false, impact: 'medium', ref: 'docs/xin-confirm.md §6 C4',
    what: '切人不清共鸣回路的状态：心转相后切走，照世相、心相心生保留；卜灵的卦象（艮、震）切走再切回来还在。心 · 雷主 · 卜灵按套路重排（+11.18%）靠这一条',
    why: '用户 2026-10-21 的印象（未实测）；模块本来就没在切出时清这些状态',
    adjust: { how: '场景里 options.rules.forteKeepOnSwitch: false：心切走回到应世相、退出心相心生，卜灵切走清卦象（data/curated/characters/心.ts、卜灵.ts 的 onEvent）；实测后定缺省', path: 'rules.forteKeepOnSwitch', values: [false] },
  },
  {
    id: 'ult-no-switch', topic: '切人', tracked: true, impact: 'small', ref: 'TD-05 §2、TD-04 §6.3，docs/xin-confirm.md Y2',
    what: '大招没写"第 n 帧前不能切人"时，"第 n 帧前不响应输入"也挡切人（椿第 239 帧、卜灵第 238 帧…）；写了"不能切人"的照写的。'
      + '全局时停（大招动画）本来就挡切人，盖住了的不算（椿 240 帧盖过 239）；现在只有卜灵（全局时停 231 帧之后再挡 7 帧）还碰得到',
    why: '大招出招阶段不能切人是实战体感（2026-10-19），待实机验证；xlsx 有的大招两种都写、帧数不同（仇远 200 / 230、凌阳 210 / 180）',
    adjust: { how: '场景里 options.rules.ultInputLocksSwitch: false 改成不挡；实机验证后改装配规则（src/data/assemble-action.ts）；单个大招在角色模块里写 switchLockUntil 覆盖', path: 'rules.ultInputLocksSwitch', values: [false] },
  },
  {
    id: 'resonance-rules', topic: '敌人', tracked: true, impact: 'unknown', ref: 'TD-06 §19，docs/alm-confirm.md',
    what: '偏移 / 干涉 / 响应：对挂着震谐·偏移的目标谐度破坏命中 → 震谐·干涉 8 秒（偏移消耗掉，期间偏谐值不累积）；'
      + '队里有"震谐响应"动作的角色（在后台也算）各出一次响应，同一角色对同一目标 8 秒一次；响应伤害按谐度破坏的公式（TD-03 §6）、行上的元素。集谐没建',
    why: '游戏内说明（三人的谐度破坏技能"响应【震谐·干涉】：…同一目标每8秒仅可受到1次"）、xlsx 响应行备注；8 秒与偏移被消耗取自第三方攻略（docs/m4-verify-answers-genmini.md R1），没实测',
    adjust: { how: '场景里 options.rules.interferenceFrames / responseCooldown 改时长（敏感度矩阵翻成 300 帧：干涉 5 秒，同普通谐破冷却）', path: 'rules.interferenceFrames', values: [300] },
  },
  {
    id: 'track-no-consume', topic: '角色', tracked: true, impact: 'large', ref: 'docs/alm-confirm.md Y5',
    what: '爱弥斯过载后的"轨迹无消耗"：下一次光翼共奏不移除震谐轨迹、照样按层数加成（所以循环里两次光翼共奏都吃满轨迹）',
    why: 'xlsx 特殊能量行"状态期间，施放强化E不会移除目标持有的震谐轨迹"；"照样按层数加成"是推断（原文只说不移除），与攻略"2 个强化技能都吃满处决倍率"一致，没实测',
    adjust: { how: '场景里 options.rules.trackNoConsume: false：过载后第一次光翼共奏也拿不到轨迹加成（第二次照常吃满）', path: 'rules.trackNoConsume', values: [false] },
  },
  {
    id: 'switch-ends-stop', topic: '切人', tracked: true, impact: 'small', ref: 'TD-05 §2、TD-04 §3.3，docs/jys-videos.md §6.3',
    what: '写了"第 n 帧前不能切人"、比全局时停早结束的动作（守岸人大招：178 帧能切、全局时停 207 帧），过了那一帧就能切；'
      + '切人时切出者这个动作剩下的时停、全局时停一起结束，切进来的人不被冻住、战斗时钟接着走',
    why: 'xlsx"第178F前不能切人"；视频 A（BV1uXYT6dEiQ）逐帧量：大招开始后约 180 帧（±4）界面回来、尤诺已在场、计时器接着走，比全局时停结束早约 27 帧。'
      + '只量了守岸人这一个；其余动作两者相差 0–3 帧（谐度破坏、椿 / 维里奈的大招）',
    adjust: { how: '场景里 options.rules.switchEndsStop: false：全局时停整段挡切人（2026-10-22 的做法）', path: 'rules.switchEndsStop', values: [false] },
  },
  {
    id: 'echo-input-priority', topic: '动作', tracked: true, impact: 'large', ref: 'TD-04 §6.1，docs/jys-videos.md §6.4',
    what: '声骸起手时按角色通用块"召唤声骸 / 变身声骸"行的优先级（5）和当前动作比，能打断重击（4）、多数技能后摇；声骸表各行写的（多为 0）当作放出来之后的。'
      + '照样要等当前动作的判定都出手（wait-settled）',
    why: 'xlsx 各体型通用块有"召唤声骸""变身声骸"两行、优先级 5；机制设计 §5.3"声骸技能 Q 打断技能后摇"。视频 A（BV1uXYT6dEiQ）守岸人变奏 → 大招一段 5.59 秒，'
      + '原来的做法（演绎整段优先级 4、声骸等它结束）仿真 6.67 秒，改后 5.52 秒。只对了这一段',
    adjust: { how: '场景里 options.rules.echoInputPriority: false：按声骸表的优先级，等当前动作结束或进同级派生窗口（2026-10-25 之前的做法）', path: 'rules.echoInputPriority', values: [false] },
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
    id: 'forced-disharmony', topic: '敌人', tracked: true, impact: 'small', ref: 'docs/tower-20261026.md 中 3、TD-09 §2',
    what: '录像剖析的轴里写"敌人 失谐"时，仿真的那一个敌人此刻直接失谐（偏谐值满、谐度破坏按钮亮 5 秒），接着手写的谐度破坏照录像的时刻放；它清空偏谐值、起谐破冷却，伤害也算在这一个敌人上',
    why: '多敌人的段里谐度破坏打的是仿真没建的小怪（中 3 视频 28.6、95.7 秒，boss 98 秒才出来），仿真只建 boss 一只、偏谐值不会在那一刻满；照录像的时刻放才能让后面的段对得上',
    adjust: { how: '轴里去掉"敌人 失谐"与那次谐度破坏' },
  },
  {
    id: 'forced-energy', topic: '资源', tracked: true, impact: 'small', ref: 'docs/tower-20261026.md 中 3、TD-09 §2',
    what: '录像剖析的轴里写"能量满 <角色>"时，这个人的大招能量此刻补满（差多少补多少），之后的大招照录像的时刻放',
    why: '中 3 第三轮心的万阙垂天：录像里镇寰宇过场一结束（视频 107.4）按钮就亮了，仿真那时还差约 6 点（109.4 才满）；差在打小怪的多敌人段（仿真只建 boss 一只）。第四轮打 boss，录像 158.25 秒能量圈约 95%、仿真 97%，对得上',
    adjust: { how: '轴里去掉"能量满"' },
  },
  {
    id: 'summon-as-char', topic: '异常效应', tracked: true, impact: 'medium', ref: 'docs/tower-20261026.md 中 4 第 8 条',
    what: '阵、召唤物打出的判定（JudgmentDef.summon，现在只有卜灵五雷荡煞阵的冲击波与生成时那一下）附加的异常效应，算"队伍中的角色附加"：触发"附加…后"的效果，心把它溢出的电磁爆发转成霆心域；伤害、属性照样记在持有者名下',
    why: '原文"队伍中的角色为目标添加【电磁爆发】后…心获得霆心域"没说阵算不算角色。中 4 录像两次踏月归心（62476、32596）只有仿真（霆心域 21、12 层）的一半左右，去掉冲击波给的那部分（11、6 层）离录像最近；中 3 那一次（169499）介于两种之间。翻过来心队稳态约 −6%（xin-team −5.6%、r5 −6.2%、轮椅 −5.9%）',
    adjust: { how: '场景里 options.rules.summonCountsAsChar: false：阵附加的都不算角色附加（不触发、心不转霆心域，电磁爆发留在目标上）', path: 'rules.summonCountsAsChar', values: [false] },
  },
  {
    id: 'enemy-swap', topic: '敌人', tracked: true, impact: 'small', ref: 'docs/tower-20261026.md 中 4、TD-09 §2',
    what: '录像剖析的轴里写"敌人 换 <预设>"时，此刻换成一只新敌人：白条、偏谐值、异常效应、响应冷却从头来，挂在敌人身上的 buff（常驻的除外，如深塔的受伤递增）去掉；在路上的判定打新敌人，上一只打死后溢出的伤害照记',
    why: '中 4 两只 boss 先后出来（异构武装打死后无冠者出来），两只的等级、防御、导电抗性相同，只有生命、白条不同；录像里第二只的电磁效应、受伤递增都从 0 起',
    adjust: { how: '轴里去掉"敌人 换"（一直打第一只）' },
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
    id: 'module-guess', topic: '角色', tracked: true, impact: 'unknown', ref: 'TD-08 §3、docs/xin-confirm.md',
    what: '角色模块里按原文推断、还没实测的时序与条件（卜灵五雷荡煞阵的冲击波从什么时候起、心的协同攻击怎么计时…）',
    why: 'xlsx 与 nanoka 只有文字说明，没有帧数；先按最直接的读法写',
    adjust: { how: '实测或查证后改角色模块；逐条见各队伍的确认清单' },
  },
  {
    id: 'burst-release', topic: '角色', tracked: true, impact: 'unknown', ref: 'TD-08 散华、TD-06 Q6、docs/m0-confirm.md §13',
    what: '散华重击爆裂（重击居合）按住普攻半秒（30 帧）再松手，每次都在冰痕区域里：按住的时间不分透视层数，也不会因为没对上而打成普通重击；' +
      '重击居合各行的帧从松手算（xlsx「蓄力」那一行就是按住的这一段），松手前不能切人',
    why: '指针的速度、冰痕区域的位置与宽度（随透视 0–2 层变大）xlsx 与 nanoka 都没有数，按半秒简化（2026-10-20 用户定）；透视每层 5 秒按各自计时（只影响显示）',
    adjust: { how: '改 data/curated/characters/散华.ts 的 HOLD（帧）；要按透视层数分长短，得先实测指针与区域（m0-confirm §13 P1、P2）' },
  },
  {
    id: 'matrix-relay', topic: '口径', tracked: true, impact: 'unknown', ref: 'docs/matrix.md',
    what: '矩阵计分（pnpm matrix）：每队对每只 boss 各跑一次仿真再按时间接力——轴不因换 boss 停顿，转场 1.5 秒里的命中作废；' +
      '敌人身上的状态（偏谐、异常效应层数、白条）按"这只 boss 从开场就在"算，换 boss 时没清空；限时按战斗秒（大招时停也停）；' +
      '每轮 5 只按敌人表的顺序出场，第 4 轮起血量按第 3 轮外推（每只 +5%，单利）',
    why: '规则与缺省值取自 DPM-Team-Builder v4.9.2（S2-3、3.7 版），血量与敌人表"矩8"对得上；出场顺序、计时停不停、换 boss 时状态清不清没实测。' +
      '只在 pnpm matrix 里用，单场仿真碰不到',
    adjust: { how: '改 src/engine/matrix.ts 的 MATRIX_RULES；换 boss 清状态要把接力做进仿真内核（敌人序列）' },
  },
  {
    id: 'stat-scaling-static', topic: '角色', tracked: true, impact: 'unknown', ref: 'TD-07、docs/jys-confirm.md',
    what: '按面板属性换算的效果（守岸人星域按共鸣效率给暴击 / 暴伤，景燃按生命上限给攻击、热熔伤害加成、命火的倍率）按装配时的属性定数：' +
      '静态面板加常驻 buff，战斗中触发的 buff（如生命%、共鸣效率的临时提升）不计入，也不随之变化',
    why: '这几个角色的属性在战斗中基本不变（触发型的生命 / 共鸣效率加成很少）；按命中时实时换算要改 buff 系统，原型期先不做',
    adjust: { how: '改 src/engine/resolve.ts 的 staticStats（加上某个触发 buff 的满层值）或在钩子的 modifyHit 里实时算' },
  },
  {
    id: 'env-final-class', topic: '公式', tracked: false, impact: 'small', ref: 'data/curated/env-buffs.ts、docs/tower-20261026.md 中 4',
    what: '深塔环境特性里没写类别的"伤害最终提升"按 0 类最终伤害（FinalDamage0）：同一场景里几条之间相加，与别的类别相乘',
    why: '面板原文不写类别；不带类别的"全伤害加深"按 0 类（TD-03 §2），照此类推。录像证实了 41 期中 3 / 中 4 的三条：心镇红尘第 3、4 轮相对第 1 轮的跳字涨幅，按变奏 15% + 电磁 55% + 受伤递增每层 5% 相加（底数 1.70）折算正好是整数层（中 4 7 层、12 层，中 3 4 层、11 层），分开相乘或底数不是 1.70 都折不出整数',
    adjust: { how: '改 env-buffs.ts 里那几条的 zone（如 FinalDamage1、FinalDamage2…）后重跑' },
  },
  {
    id: 'steady-window', topic: '口径', tracked: false, impact: 'none', ref: 'TD-10 §2',
    what: '稳态 DPS 取完整的轮：第 2 轮到倒数第 2 轮（只有 2 轮时取第 2 轮）；第 2 轮起还在漂移时，从之后各轮都在 ±1% 以内的那一轮起（steadySkip）',
    why: '第 1 轮受开局资源影响；开局多出来的资源有时要好几轮才用完（心队 C2 到第 5 轮）；最后一轮没有下一轮起手的边界，偏高',
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
