# 规则台账

## 读法

采用的候选不是已证实的事实。旧假设依据只迁移为 unspecified 证据，不算独立检验。候选未列全的命题不承诺穷尽所有读法。

生成：`pnpm assumptions --ledger --md`（DD-04 §3）。

<!-- generated: DD-04 -->
## 命题表

| ID | 命题 | 范围 | 采用 | 其余候选 | 列全 | 结论 | 证据条数 |
|---|---|---|---|---|---|---|---:|
| def-floor | 结算伤害时，目标防御在减防、无视防御之后不取整，直接代入防御区 | shared | none | floor | 否 | unverified | 1 |
| effect-tick-timer | 异常效应的定时结算（电磁效应每 5 秒一次）从第一次附加起计时，之后再附加不重置计时 | shared | from-first | reset-on-apply | 否 | unverified | 1 |
| effect-owner | 异常效应定时结算的伤害记在最后一次附加它的角色名下，吃这个角色身上的加深与最终伤害 | shared | last | first、onField | 否 | unverified | 1 |
| forte-keep.心-照世相 | 心转相后切走，照世相与心相心生保留：再切回来仍是照世相、仍在心相心生里 | character | keep | clear | 否 | unverified | 1 |
| forte-keep.卜灵-卦象 | 卜灵切走时，已有的卦象（艮、震）与少阳 / 少阴保留：再切回来还在 | character | keep | clear | 否 | unverified | 1 |
| ult-input-locks-switch | 大招没写"第 n 帧前不能切人"时，"第 n 帧前不响应输入"期间同样不能切人 | shared | locks | free | 是 | unverified | 1 |
| invincible-locks-switch | 写了"无敌期间不能切人"等、没给帧数的切人限制的动作，到无敌结束（没有无敌帧的到动作结束）之前不能切人 | shared | locks | free | 否 | unverified | 1 |
| switch-ends-stop | 写了"第 n 帧前不能切人"、且 n 早于全局时停结束帧的大招，过了第 n 帧能切人，切人时剩余的时停随之结束 | shared | ends | blocks | 否 | unverified | 1 |
| hitstop-in-global-stop | 大招过场的全局时停期间（战斗时钟停住），新命中的攻击顿帧不拖慢角色自己与队友的动作 | shared | ignored | applies | 是 | unverified | 1 |
| echo-input-priority | 声骸起手时按优先级 5（通用块"召唤声骸 / 变身声骸"行）和当前动作比：能打断重击（4）与多数技能的后摇 | shared | generic-5 | echo-table | 否 | unverified | 1 |
| interference-frames | 谐度破坏命中挂着震谐·偏移的目标后，目标的震谐·干涉持续 8 秒（480 帧） | shared | 480 | 300 | 否 | unverified | 1 |
| track-no-consume | 爱弥斯过载后的第一次光翼共奏不移除震谐轨迹，并照样按轨迹的层数加成 | character | kept | consumed | 是 | unverified | 1 |
| summon-as-char | 阵、召唤物（卜灵五雷荡煞阵的冲击波等）附加的异常效应算"队伍中的角色附加"：会触发"附加…后"的效果，心会把溢出的电磁爆发转成霆心域 | shared | counts | not | 否 | unverified | 1 |
| input-delay | 每个决策点（切人、不是连段后续的出招）在合法的那一帧就执行，没有反应时间 | policy | 0 | 6 | 否 | unverified | 1 |
| tune-break-mode | 谐度破坏的放法：目标失谐、按钮亮着时由前台角色在下一条指令之前放（队首是连段后续时等这串打完） | policy | auto | manual、off | 是 | unverified | 1 |
| wait-settled | 玩家等前一个动作出手（该生成的判定、延奏都生成了）再出下一招：没等它出手就出下一招，还没生成的判定会丢 | policy | settled | — | 否 | unverified | 1 |
| dilation-rules | 时间膨胀按类型作用：攻击顿帧在同一单位上新的替换旧的，buff 时停与之并存，全局时停停住战斗时钟，极限闪避的减速随取消解除 | shared | table | — | 否 | unverified | 1 |
| summon-clock | 召唤类（脱手）声骸按战斗时钟走，不被队友的时停冻住 | shared | battle-clock | — | 否 | unverified | 1 |
| white-bar | 敌人白条的上限按削韧值算（prop 的 RageMax ÷ 100），瘫痪结束时回满 | shared | rage-max | — | 否 | unverified | 1 |
| data-guess | 构建时推断出来、还没确认的数据值（flag 标出的优先级变化帧、段数、动作类别…）与游戏一致（兜底项：逐个确认后在角色模块里覆盖或 accept） | data | as-inferred | — | 否 | unverified | 1 |
| burst-release | 散华的重击爆裂按住普攻半秒（30 帧）松手就能打出：按住的时间不随透视层数变，也不会因为没对上冰痕区域打成普通重击 | character | hold-30 | — | 否 | unverified | 1 |
