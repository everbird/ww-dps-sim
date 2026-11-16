# M0 严格轴：第一份有条件结论

## 读法

这份结论回答：按此配置、当前数据与模型、最早合法帧执行，固定教学轴能否跑通，以及列明的机制单项和两两组合会怎样改变结果。不证明游戏机制正确、不证明真人能零延迟执行，也不声称这条轴最优；三项以上、未实现和未列全的读法没有覆盖。

**未含谐度破坏**：原文没给位置（用户 2026-11-14 定），量表也关闭。自动谐破参考由调度器选择时机，不是原文轴；manual 策略试验则量表仍累积但不放谐破。三个口径不能混为同一结论。

DD-04 §7 的历史参考（20261019 数据）为未含谐破 37,577、自动 40,472；本次舍入后相同，无须用代码改动解释差异。精确数字、各候选变化、时刻对照和身份全部由下面的生成区给出，重跑只替换生成区。

### 交给 DD-08 的实验线索（路线图 §10.1）

- E2/C1：烬华蔓舞的第 4 段与数据读法，关联 `data-guess` 等单候选未列全项；需要按实际动作条件登记预测与观测，不能用当前无可翻候选推断机制已证实。
- E2/C5 与 E1/B7：大招后最早切人可检验 `ult-input-locks-switch`，但要限定角色与输入条件；本轴单项不变不代表共享规则正确。
- 声骸起手优先级：路线图列为待设计实验，直接对应 `echo-input-priority`；当前主表显示它影响本轴且与其他时序开关有组合效应，值得做可区分条件。
- `hitstop-in-global-stop`、`dilation-rules`、`summon-clock`、`wait-settled`、`white-bar`、`burst-release` 的实验尚未由该清单逐项覆盖，应由 DD-08 设计受控条件；已有文字依据不是独立检验。
- 心、卜灵保留状态（E1/B1、B2）在本队不适用，不能用于升级这份 M0 结论。所有证据升级仍须明确用途、适用条件和未排除的候选。

<!-- generated: DD-04 -->
## 生成信息

命令：`pnpm candidates scenarios/m0-video-eq-不打谐破.yaml --pairs --json out/candidates/m0.json --md docs/m0-strict-conclusion.md`
代码提交：`e81773793d8ad5d592346d59a7ebd013e5888eb6`
工作区指纹：`1493165fa8a8c660f5e0be79925a2a8820fbd37952c1de12d3995e3cb33e3083`
数据版本：20261019；xlsx SHA-256：8b8c9c077aff34b1c1f7ca855945b060482e77fe76d7afd5da7ce65ba7c528f1
基准 runId：`run-3eb9b33e10d08755`

## 有条件结论

按最早合法帧执行；完成状态 completed，稳态第 2–3 轮，平均每轮 25.0000 战斗秒，DPS 37576.8190。
未含谐度破坏（sourceSilent；量表 off）。
同一条轴由调度器自动放谐破的参考：completed，稳态 DPS 40472.3790（相对基准 7.7057%），谐破伤害占稳态 7.1544% / 全窗口 7.2382%；各轮战斗帧 1500、1500，轮长不变。参考值不是这条轴的结论。runId：`run-a884503e67816b45`。
记录到等待 72 段；按意图的等待 0 段（全运行，见下）。+6f 时刻对照：变长 3、吸收 22、变快 0、不可评估 0。门槛级的对照未做。
有效机制 / 数据候选单项 11/11、两两 54/54；断轴 0、引擎错误 0、未运行 0。三项及以上未查。
DPS same 仅指数值相同（相对差 ≤ 1e-9）；窗口变化幅度不是误差条或置信区间。下表保留全部失败结果。

## 主表：机制与数据

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| def-floor=floor | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7bdf4b98af643735 |
| effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-536fb104832194c0 |
| effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-61937f676da1d75c |
| effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0578fc26609380b1 |
| ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-240c7a5cd2d0872c |
| invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5c0aa149e851c667 |
| switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5100fec946c40192 |
| hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-a7d95c168afb5cdc |
| echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-f506b47a2db0f0a2 |
| interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-d8791e79cb67578d |
| summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-8966b0185556827d |
| def-floor=floor × effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-1bd3e40d4f7b672a |
| def-floor=floor × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-8ee8a79f693309db |
| def-floor=floor × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-ae0093cc83a67ad4 |
| def-floor=floor × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-ed59d6a2b7523bd2 |
| def-floor=floor × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-3cd35a387a7be195 |
| def-floor=floor × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5469fc00dec520d9 |
| def-floor=floor × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-998845338eff265a |
| def-floor=floor × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-aa265beafadecbf6 |
| def-floor=floor × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-6eb6d81413be184b |
| def-floor=floor × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-082075217cdb34e5 |
| effect-tick-timer=reset-on-apply × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-b0f839e0e65df11e |
| effect-tick-timer=reset-on-apply × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c56e06f73236be18 |
| effect-tick-timer=reset-on-apply × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-9335af8b3678d124 |
| effect-tick-timer=reset-on-apply × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-d99f761c3fac06f7 |
| effect-tick-timer=reset-on-apply × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7dbd8ec8c4bf862f |
| effect-tick-timer=reset-on-apply × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-82ce9ad3cd348f39 |
| effect-tick-timer=reset-on-apply × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-126776d12876cee1 |
| effect-tick-timer=reset-on-apply × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-2a8549ccf7694e32 |
| effect-tick-timer=reset-on-apply × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-85c06c931b8dcaac |
| effect-owner=first × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-b9c0c91d363d7ebd |
| effect-owner=first × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-8cf8141e7cb6da4b |
| effect-owner=first × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0aa743382e058da9 |
| effect-owner=first × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-1d59f885e964e523 |
| effect-owner=first × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-9b8dd72ffac8f3c5 |
| effect-owner=first × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-072f7145bc9ae805 |
| effect-owner=first × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-a2d07e6c3521482b |
| effect-owner=onField × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-a06ee88eb90a8a85 |
| effect-owner=onField × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-f33dabf97121aabe |
| effect-owner=onField × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4f4556fbf8bd4686 |
| effect-owner=onField × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-3a557c04a507284b |
| effect-owner=onField × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-f83f7ed63723600f |
| effect-owner=onField × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c9d12eca6556e93e |
| effect-owner=onField × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c7a9388e4746c7e6 |
| ult-input-locks-switch=free × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-8f9e56d86a02ea80 |
| ult-input-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4132a97505ffd7fd |
| ult-input-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-06fe2a875c4668c8 |
| ult-input-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-57c8c0b2eb4e99bc |
| ult-input-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-89466381e44d12f9 |
| ult-input-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7b40e566f9410aa6 |
| invincible-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7d2e804e2ae2b2ef |
| invincible-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-a799d774fe12a389 |
| invincible-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-62b3d3bd4ba8fea3 |
| invincible-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-77bc41723a70a2ef |
| invincible-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-1bfb9c4a277786b7 |
| switch-ends-stop=blocks × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-da4347e211d4b085 |
| switch-ends-stop=blocks × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-bb883e0952df3381 |
| switch-ends-stop=blocks × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-ced309a663aadbac |
| switch-ends-stop=blocks × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7756932cb17eeb92 |
| hitstop-in-global-stop=applies × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.4333 | 37570.4560 | changed -0.0169% | changed | false | false | run-223823002efeb4ee |
| hitstop-in-global-stop=applies × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-0db9c25d8f6ca642 |
| hitstop-in-global-stop=applies × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-d5ba4357ef184942 |
| echo-input-priority=echo-table × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-fb1fd4aa21cd7008 |
| echo-input-priority=echo-table × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-c987f445c5402106 |
| interference-frames=300 × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-6f85b6f1f7e67ba1 |

## 操作策略试验（不计主表覆盖）

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| input-delay=6 | completed | 稳态第 2–3 轮 | 25.7333 | 36659.1955 | changed -2.4420% | changed | false | false | run-4c3fbdd33787c8a0 |
| tune-break-mode=manual | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-554846a8036325e9 |

## 时刻对照（+6f；门槛级对照未做）

- 变长：8.1，稳态第 2–3 轮，每轮 0.1000 秒；记录到的等待原因 cooldown；gateConfirmed=false；run-8b4a2c2ccde15061
- 变长：14.1，稳态第 2–3 轮，每轮 0.0083 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-f00e974c104b13ec
- 变长：14.2，稳态第 2–3 轮，每轮 0.0333 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-3f6dd8942d57e0ec
- 吸收：2.1；run-e1ff278e011f656e
- 吸收：2.2；run-2da195daeec1b61d
- 吸收：2.3；run-de588dc9aec36d95
- 吸收：3.1；run-dd9d7420f208f48a
- 吸收：4.4；run-b33b9b34fb72690f
- 吸收：4.5；run-b5bc82ddaba682bc
- 吸收：6.2；run-111f9da3ec7b9ac7
- 吸收：7.1；run-c8cb4fdefea1c86a
- 吸收：8.2；run-9ab2ed2f727739d4
- 吸收：8.3；run-b97651221b6cfd48
- 吸收：10.1；run-738c3b0e5b96ac52
- 吸收：10.5；run-84b6359af639865f
- 吸收：10.6；run-f383a032e20402a0
- 吸收：12.2；run-97bec584eecc0350
- 吸收：13.1；run-b8c2d80d75c2c144
- 吸收：14.3；run-64b2270c2b9fe270
- 吸收：14.4；run-75486e1acfcbc6ec
- 吸收：14.5；run-7c26a4c1986ee534
- 吸收：15.1；run-8bad94f510abbbd2
- 吸收：15.2；run-ddbd731214999b77
- 吸收：15.5；run-9f9b7c1a84aa0a97
- 吸收：15.6；run-6445cdd9b00032a6

## 记录到的等待（稳态；不是门槛级结论）

- 第 2 轮 2.1：priority，63 战斗帧，intent=false；优先级 4 低于 QTE 当前的 11
- 第 2 轮 2.2：settled，20 战斗帧，intent=false；等 E 出手（现在打断会丢判定或延奏）
- 第 2 轮 2.3：priority，8 战斗帧，intent=false；优先级 3 低于 大招 当前的 10
- 第 2 轮 3.1：switchLock，30 战斗帧，intent=false；重击居合 第 30 帧前不能切人
- 第 2 轮 4.2：combo，38 战斗帧，intent=false；等 A3-地面出场技 的派生窗口
- 第 2 轮 4.3：combo，44 战斗帧，intent=false；等 A4 的派生窗口
- 第 2 轮 4.4：settled，12 战斗帧，intent=false；等 A5 出手（现在打断会丢判定或延奏）
- 第 2 轮 4.5：settled，28 战斗帧，intent=false；等 E 出手（现在打断会丢判定或延奏）
- 第 2 轮 6.2：settled，22 战斗帧，intent=false；等 A2-地面出场技 出手（现在打断会丢判定或延奏）
- 第 2 轮 7.1：switchCd，38 战斗帧，intent=false；维里奈 的切人冷却还剩 38 帧
- 第 2 轮 8.1：cooldown，104 战斗帧，intent=false；大招 冷却还剩 104 帧
- 第 2 轮 8.2：priority，44 战斗帧，intent=false；优先级 8 低于 大招 当前的 10
- 第 2 轮 8.3：priority，1 战斗帧，intent=false；优先级 2 低于 跳跃 当前的 8
- 第 2 轮 8.4：combo，21 战斗帧，intent=false；等 强化空中A1 的派生窗口
- 第 2 轮 8.5：combo，18 战斗帧，intent=false；等 强化空中A2 的派生窗口
- 第 2 轮 10.1：inputLock，78 战斗帧，intent=false；QTE 第 71 帧前不响应输入
- 第 2 轮 10.2：combo，38 战斗帧，intent=false；等 盛绽·A1 的派生窗口
- 第 2 轮 10.3：combo，37 战斗帧，intent=false；等 盛绽·A2 的派生窗口
- 第 2 轮 10.4：combo，72 战斗帧，intent=false；等 盛绽·A3 的派生窗口
- 第 2 轮 10.5：derive，83 战斗帧，intent=false；等 盛绽·A4 的派生窗口
- 第 2 轮 10.6：settled，21 战斗帧，intent=false；等 盛绽·A1 出手（现在打断会丢判定或延奏）
- 第 2 轮 12.2：settled，20 战斗帧，intent=false；等 E 出手（现在打断会丢判定或延奏）
- 第 2 轮 13.1：switchCd，40 战斗帧，intent=false；椿 的切人冷却还剩 40 帧
- 第 2 轮 14.1：inputLock，78 战斗帧，intent=false；QTE 第 71 帧前不响应输入
- 第 2 轮 14.2：inputLock，2 战斗帧，intent=false；大招 第 239 帧前不响应输入
- 第 2 轮 14.3：priority，83 战斗帧，intent=false；优先级 4 低于 E3 当前的 8
- 第 2 轮 14.3：cooldown，17 战斗帧，intent=false；E1（与同组共用冷却 E） 冷却还剩 17 帧
- 第 2 轮 14.4：priority，85 战斗帧，intent=false；优先级 2 低于 E1 当前的 4
- 第 2 轮 14.4：derive，1 战斗帧，intent=false；等 E1 的派生窗口
- 第 2 轮 14.5：settled，110 战斗帧，intent=false；等 盛绽·A3循环聚怪 出手（现在打断会丢判定或延奏）
- 第 2 轮 15.1：settled，12 战斗帧，intent=false；等 Q·斩击 出手（现在打断会丢判定或延奏）
- 第 2 轮 15.2：priority，24 战斗帧，intent=false；优先级 2 低于 盛绽·闪避 当前的 6
- 第 2 轮 15.3：combo，38 战斗帧，intent=false；等 盛绽·A1 的派生窗口
- 第 2 轮 15.4：combo，37 战斗帧，intent=false；等 盛绽·A2 的派生窗口
- 第 2 轮 15.5：settled，59 战斗帧，intent=false；等 盛绽·A3 出手（现在打断会丢判定或延奏）
- 第 2 轮 15.6：settled，74 战斗帧，intent=false；等 E2 出手（现在打断会丢判定或延奏）
- 第 3 轮 2.1：priority，63 战斗帧，intent=false；优先级 4 低于 QTE 当前的 11
- 第 3 轮 2.2：settled，20 战斗帧，intent=false；等 E 出手（现在打断会丢判定或延奏）
- 第 3 轮 2.3：priority，8 战斗帧，intent=false；优先级 3 低于 大招 当前的 10
- 第 3 轮 3.1：switchLock，30 战斗帧，intent=false；重击居合 第 30 帧前不能切人
- 第 3 轮 4.2：combo，38 战斗帧，intent=false；等 A3-地面出场技 的派生窗口
- 第 3 轮 4.3：combo，44 战斗帧，intent=false；等 A4 的派生窗口
- 第 3 轮 4.4：settled，12 战斗帧，intent=false；等 A5 出手（现在打断会丢判定或延奏）
- 第 3 轮 4.5：settled，28 战斗帧，intent=false；等 E 出手（现在打断会丢判定或延奏）
- 第 3 轮 6.2：settled，22 战斗帧，intent=false；等 A2-地面出场技 出手（现在打断会丢判定或延奏）
- 第 3 轮 7.1：switchCd，38 战斗帧，intent=false；维里奈 的切人冷却还剩 38 帧
- 第 3 轮 8.1：cooldown，104 战斗帧，intent=false；大招 冷却还剩 104 帧
- 第 3 轮 8.2：priority，44 战斗帧，intent=false；优先级 8 低于 大招 当前的 10
- 第 3 轮 8.3：priority，1 战斗帧，intent=false；优先级 2 低于 跳跃 当前的 8
- 第 3 轮 8.4：combo，21 战斗帧，intent=false；等 强化空中A1 的派生窗口
- 第 3 轮 8.5：combo，18 战斗帧，intent=false；等 强化空中A2 的派生窗口
- 第 3 轮 10.1：inputLock，78 战斗帧，intent=false；QTE 第 71 帧前不响应输入
- 第 3 轮 10.2：combo，38 战斗帧，intent=false；等 盛绽·A1 的派生窗口
- 第 3 轮 10.3：combo，37 战斗帧，intent=false；等 盛绽·A2 的派生窗口
- 第 3 轮 10.4：combo，72 战斗帧，intent=false；等 盛绽·A3 的派生窗口
- 第 3 轮 10.5：derive，83 战斗帧，intent=false；等 盛绽·A4 的派生窗口
- 第 3 轮 10.6：settled，21 战斗帧，intent=false；等 盛绽·A1 出手（现在打断会丢判定或延奏）
- 第 3 轮 12.2：settled，20 战斗帧，intent=false；等 E 出手（现在打断会丢判定或延奏）
- 第 3 轮 13.1：switchCd，40 战斗帧，intent=false；椿 的切人冷却还剩 40 帧
- 第 3 轮 14.1：inputLock，78 战斗帧，intent=false；QTE 第 71 帧前不响应输入
- 第 3 轮 14.2：inputLock，2 战斗帧，intent=false；大招 第 239 帧前不响应输入
- 第 3 轮 14.3：priority，83 战斗帧，intent=false；优先级 4 低于 E3 当前的 8
- 第 3 轮 14.3：cooldown，17 战斗帧，intent=false；E1（与同组共用冷却 E） 冷却还剩 17 帧
- 第 3 轮 14.4：priority，85 战斗帧，intent=false；优先级 2 低于 E1 当前的 4
- 第 3 轮 14.4：derive，1 战斗帧，intent=false；等 E1 的派生窗口
- 第 3 轮 14.5：settled，110 战斗帧，intent=false；等 盛绽·A3循环聚怪 出手（现在打断会丢判定或延奏）
- 第 3 轮 15.1：settled，12 战斗帧，intent=false；等 Q·斩击 出手（现在打断会丢判定或延奏）
- 第 3 轮 15.2：priority，24 战斗帧，intent=false；优先级 2 低于 盛绽·闪避 当前的 6
- 第 3 轮 15.3：combo，38 战斗帧，intent=false；等 盛绽·A1 的派生窗口
- 第 3 轮 15.4：combo，37 战斗帧，intent=false；等 盛绽·A2 的派生窗口
- 第 3 轮 15.5：settled，59 战斗帧，intent=false；等 盛绽·A3 出手（现在打断会丢判定或延奏）
- 第 3 轮 15.6：settled，74 战斗帧，intent=false；等 E2 出手（现在打断会丢判定或延奏）

## 按意图的等待、提示与完成状态

```json
{
  "completion": {
    "status": "completed",
    "coverage": {
      "initCompleted": true,
      "completedTicks": 9546,
      "loggedEventEndExclusive": 2896,
      "loopExitAt": {
        "reason": "idle",
        "worldFrame": 9546,
        "phase": "P2"
      },
      "finalization": {
        "kind": "postDrain",
        "completed": true
      },
      "terminal": {
        "kind": "afterPostDrain",
        "prefix": {
          "eventEndExclusive": 2896,
          "handledEndExclusive": 2896,
          "interventionEndExclusive": 0
        }
      }
    },
    "loops": {
      "planned": 4,
      "started": 4,
      "completed": 4,
      "openingCompleted": true,
      "roundEnds": [
        {
          "loop": 0,
          "endBattleFrame": 1316
        },
        {
          "loop": 1,
          "endBattleFrame": 2816
        },
        {
          "loop": 2,
          "endBattleFrame": 4316
        },
        {
          "loop": 3,
          "endBattleFrame": 5816
        },
        {
          "loop": 4,
          "endBattleFrame": 7366
        }
      ]
    },
    "goal": {
      "kind": "steady",
      "reached": true
    },
    "conditioning": {
      "basis": "unconditioned",
      "firstInterventionIndex": null
    }
  },
  "strictReport": {
    "entry": "strict",
    "earliestLegalBaseline": true,
    "compileChecks": [
      {
        "code": "strict.replay",
        "passed": true
      },
      {
        "code": "strict.tuneBreakAuto",
        "passed": true
      },
      {
        "code": "strict.filler",
        "passed": true
      },
      {
        "code": "strict.optional",
        "passed": true
      },
      {
        "code": "strict.at",
        "passed": true
      },
      {
        "code": "strict.external",
        "passed": true
      },
      {
        "code": "strict.tuneBreakOff",
        "passed": true
      },
      {
        "code": "strict.tuneBreakUndeclared",
        "passed": true
      },
      {
        "code": "strict.noIntroAction",
        "passed": true
      }
    ],
    "intentWaits": [],
    "unmetIntents": [],
    "hints": []
  },
  "warnings": [
    {
      "code": "resolve",
      "message": "椿 有 3 处装配时推断的值（pnpm check:data -- --flags 椿 查看）"
    },
    {
      "code": "resolve",
      "message": "散华 有 4 处装配时推断的值（pnpm check:data -- --flags 散华 查看）"
    },
    {
      "code": "resolve",
      "message": "维里奈 有 3 处装配时推断的值（pnpm check:data -- --flags 维里奈 查看）"
    }
  ]
}
```

## 排除与未覆盖

- 排除 tune-break-mode=auto：strictEntry
- 不适用：forte-keep.心-照世相=clear × forte-keep.卜灵-卦象=clear × track-no-consume=consumed
- 未实现：无
- 未列全：def-floor、effect-tick-timer、effect-owner、forte-keep.心-照世相、forte-keep.卜灵-卦象、invincible-locks-switch、switch-ends-stop、echo-input-priority、interference-frames、summon-as-char、input-delay、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release
- 依赖的未证实规则：hitstop-in-global-stop、echo-input-priority、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release
