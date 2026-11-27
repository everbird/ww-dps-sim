# 规则台账

## 读法

采用的候选不是已证实的事实。旧假设依据只迁移为 unspecified 证据，不算独立检验。候选未列全的命题不承诺穷尽所有读法。

"采用"与"结论"是两列（DD-08 §7）：结论是证据到了哪一步，按 DD-08 §4.1 的决策表从证据闭环（`docs/evidence/`）算出来，没有闭环的是"未验证"。"证实（所测条件内）"要求每个竞争候选都被同一条独立检验的观测排除；只有相容或选模材料的是"暂定"；证据来自别的游戏版本的标"沿用自 <版本>，待复核"，结论不因沿用升级。

生成：`pnpm assumptions --ledger --md`（DD-04 §3、DD-08 §7）。

<!-- generated: DD-04 -->
## 命题表

当前声明的游戏版本：3.7（data/xlsx-versions.json）。"采用"是现在代码里用的读法；"结论"是证据到了哪一步（DD-08 §4.1 的决策表），两者分开。

| ID | 命题 | 范围 | 采用 | 其余候选 | 列全 | 结论 | 证据 |
|---|---|---|---|---|---|---|---|
| def-floor | 结算伤害时，目标防御在减防、无视防御之后不取整，直接代入防御区 | shared | none | floor | 否 | 未验证 | 1（旧依据 1） |
| effect-tick-timer | 异常效应的定时结算（电磁效应每 5 秒一次）从第一次附加起计时，之后再附加不重置计时 | shared | from-first | reset-on-apply | 否 | 未验证 | 1（旧依据 1） |
| effect-owner | 异常效应定时结算的伤害记在最后一次附加它的角色名下，吃这个角色身上的加深与最终伤害 | shared | last | first、onField | 否 | 未验证 | 1（旧依据 1） |
| forte-keep.心-照世相 | 心转相后切走，照世相与心相心生保留：再切回来仍是照世相、仍在心相心生里 | character | keep | clear | 否 | 未验证 | 1（旧依据 1） |
| forte-keep.卜灵-卦象 | 卜灵切走时，已有的卦象（艮、震）与少阳 / 少阴保留：再切回来还在 | character | keep | clear | 否 | 未验证 | 1（旧依据 1） |
| ult-input-locks-switch | 大招没写"第 n 帧前不能切人"时，"第 n 帧前不响应输入"期间同样不能切人 | shared | locks | free | 是 | 未验证 | 1（旧依据 1） |
| invincible-locks-switch | 写了"无敌期间不能切人"等、没给帧数的切人限制的动作，到无敌结束（没有无敌帧的到动作结束）之前不能切人 | shared | locks | free | 否 | 未验证 | 1（旧依据 1） |
| switch-ends-stop | 写了"第 n 帧前不能切人"、且 n 早于全局时停结束帧的大招，过了第 n 帧能切人，切人时剩余的时停随之结束 | shared | ends | blocks | 否 | 未验证 | 1（旧依据 1） |
| hitstop-in-global-stop | 大招过场的全局时停期间（战斗时钟停住），新命中的攻击顿帧不拖慢角色自己与队友的动作 | shared | ignored | applies | 是 | 未验证 | 1（旧依据 1） |
| echo-input-priority | 声骸起手时按优先级 5（通用块"召唤声骸 / 变身声骸"行）和当前动作比：能打断重击（4）与多数技能的后摇 | shared | generic-5 | echo-table | 否 | 证实（所测条件内） | 4（旧依据 1）；闭环 echo-input-priority.backfill |
| interference-frames | 谐度破坏命中挂着震谐·偏移的目标后，目标的震谐·干涉持续 8 秒（480 帧） | shared | 480 | 300 | 否 | 未验证 | 1（旧依据 1） |
| track-no-consume | 爱弥斯过载后的第一次光翼共奏不移除震谐轨迹，并照样按轨迹的层数加成 | character | kept | consumed | 是 | 未验证 | 1（旧依据 1） |
| summon-as-char | 阵、召唤物（卜灵五雷荡煞阵的冲击波等）附加的异常效应算"队伍中的角色附加"：会触发"附加…后"的效果，心会把溢出的电磁爆发转成霆心域 | shared | counts | not | 否 | 未验证 | 1（旧依据 1） |
| input-delay | 每个决策点（切人、不是连段后续的出招）在合法的那一帧就执行，没有反应时间 | policy | 0 | 6 | 否 | 未验证 | 1（旧依据 1） |
| tune-break-mode | 谐度破坏的放法：目标失谐、按钮亮着时由前台角色在下一条指令之前放（队首是连段后续时等这串打完） | policy | auto | manual、off | 是 | 未验证 | 1（旧依据 1） |
| wait-settled | 玩家等前一个动作出手（该生成的判定、延奏都生成了）再出下一招：没等它出手就出下一招，还没生成的判定会丢 | policy | settled | — | 否 | 未验证 | 1（旧依据 1） |
| dilation-rules | 时间膨胀按类型作用：攻击顿帧在同一单位上新的替换旧的，buff 时停与之并存，全局时停停住战斗时钟，极限闪避的减速随取消解除 | shared | table | — | 否 | 未验证 | 1（旧依据 1） |
| summon-clock | 召唤类（脱手）声骸按战斗时钟走，不被队友的时停冻住 | shared | battle-clock | — | 否 | 未验证 | 1（旧依据 1） |
| white-bar | 敌人白条的上限按削韧值算（prop 的 RageMax ÷ 100），瘫痪结束时回满 | shared | rage-max | — | 否 | 未验证 | 1（旧依据 1） |
| data-guess | 构建时推断出来、还没确认的数据值（flag 标出的优先级变化帧、段数、动作类别…）与游戏一致（兜底项：逐个确认后在角色模块里覆盖或 accept） | data | as-inferred | — | 否 | 未验证 | 1（旧依据 1） |
| burst-release | 散华的重击爆裂按住普攻半秒（30 帧）松手就能打出：按住的时间不随透视层数变，也不会因为没对上冰痕区域打成普通重击 | character | hold-30 | — | 否 | 未验证 | 1（旧依据 1） |
| cast-gain-at-start | 资源公式的末项（起手即得）在动作开始那一帧就给，不等命中：散华 E 的协奏 15（角色-女"协奏回收"公式的 +15）就是这一项 | data | at-start | at-first-hit | 否 | 分不清 | 1；闭环 sanhua-e.backfill；游戏版本不详 |
| yanhen-extend | 焰痕的被动：变奏 / 大招后共鸣解放伤害 +24% 6 秒，造成重击伤害时延长 4 秒、最多 1 次，延长成功时才给全队热熔 +24% 30 秒 | data | nanoka-text | xlsx-three-sentences（未实现） | 否 | 暂定 | 1；闭环 yanhen.backfill |
| buling-concerto-timing | 卜灵的协奏按数据的时刻到账：普攻、重击逐段命中给，E、大招、变奏的起手即得在动作开始时给（总量是 nanoka 的 E 23、重击 15、大招 20、变奏 10） | character | as-data | on-cast、later-split（未实现） | 否 | 分不清 | 2；闭环 buling-concerto-timing.backfill |
| buling-first-echo | 深塔 41 期中 3、中 4 两局里，卜灵第一段上场（中 3 还有第四段）放了声骸（无归的谬误：全队攻击 +10%，20 秒），心第 1 轮应世相的各下都吃到：路线图 §7 案例里录像对仿真的共同乘数 m ≈ 1.044 由此而来 | conditioning | echo-cast | no-echo、xin-only-atk（未实现）、target-side（未实现） | 否 | 暂定 | 3；闭环 buling-first-echo.backfill |
| zhenhuanyu-window | 深塔 41 期中 4 第 1 轮，心的镇寰宇（照世·增幅强化重击）命中时，心变奏入场挂上的两条 15 秒 buff（镜影流电之瞬 5 件的延奏加成、绝息魄首位的导电加成）还在（路线图 §7 案例里 B-1 的窗口要求） | conditioning | expired-as-sim | in-window（未实现） | 是 | 未验证 | 0 |
