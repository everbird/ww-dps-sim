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
代码提交：`d4c0221d9cb23bb79b112e3d47e9e2c84169d8fa`
工作区指纹：`无`
数据版本：20261019；xlsx SHA-256：8b8c9c077aff34b1c1f7ca855945b060482e77fe76d7afd5da7ce65ba7c528f1
基准 runId：`run-7f8c8bf3b23e3902`

## 有条件结论

按最早合法帧执行；完成状态 completed，稳态第 2–3 轮，平均每轮 25.0000 战斗秒，DPS 37576.8190。
未含谐度破坏（sourceSilent；量表 off）。
同一条轴由调度器自动放谐破的参考：completed，稳态 DPS 40472.3790（相对基准 7.7057%），谐破伤害占稳态 7.1544% / 全窗口 7.2382%；各轮战斗帧 1500、1500，轮长不变。参考值不是这条轴的结论。runId：`run-f9aeec500b1b3972`。
记录到等待 72 段；按意图的等待 0 段（全运行，见下）。+6f 时刻对照：变长 3、吸收 22、变快 0、不可评估 0。门槛级的对照未做。
有效机制 / 数据候选单项 11/11、两两 54/54；断轴 0、引擎错误 0、未运行 0。三项及以上未查。
DPS same 仅指数值相同（相对差 ≤ 1e-9）；窗口变化幅度不是误差条或置信区间。下表保留全部失败结果。

## 主表：机制与数据

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| def-floor=floor | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-d8a34f3daf8a30da |
| effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-f9b71196af6817ea |
| effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-3f7378e63834631a |
| effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-25cb16c32c475592 |
| ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-e40f404b69276b05 |
| invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4b84eab89a9ba653 |
| switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-9d06850e9b622cd8 |
| hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-47bb54492f47d24d |
| echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-e52ce656692781df |
| interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-100175573cd693e3 |
| summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5ea423abdde66ae5 |
| def-floor=floor × effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-dfb40915f76df5b3 |
| def-floor=floor × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7299224483a60835 |
| def-floor=floor × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-16647ad3b306c6d7 |
| def-floor=floor × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-eda3ade1f117a731 |
| def-floor=floor × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-19ed2aa59b4334a9 |
| def-floor=floor × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-e908989c5aabdc7f |
| def-floor=floor × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-8a1650824198d92a |
| def-floor=floor × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-2b756cede1a67d45 |
| def-floor=floor × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-04d149acee266562 |
| def-floor=floor × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-9833135cb4f80852 |
| effect-tick-timer=reset-on-apply × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-1c2f99185afbf9ed |
| effect-tick-timer=reset-on-apply × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-e8b7ad6ebb45a581 |
| effect-tick-timer=reset-on-apply × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-b509cc75dc80fe9d |
| effect-tick-timer=reset-on-apply × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-32799398b9c7b5a4 |
| effect-tick-timer=reset-on-apply × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-b67b671c8dbef6c4 |
| effect-tick-timer=reset-on-apply × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-6c6816a4242bd8bd |
| effect-tick-timer=reset-on-apply × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-343d694c77b4d8e2 |
| effect-tick-timer=reset-on-apply × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-1cb5969dbdb860f2 |
| effect-tick-timer=reset-on-apply × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-aeed74c9f728f7cc |
| effect-owner=first × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-23b829113bc2f664 |
| effect-owner=first × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7d6b56b02f3d968e |
| effect-owner=first × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-fb75cc0d1a548d8c |
| effect-owner=first × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-1c9a616c35c7d743 |
| effect-owner=first × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-8b9b0a27ab2953c5 |
| effect-owner=first × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-388ad173beb5746d |
| effect-owner=first × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-bb4d8f025f57f547 |
| effect-owner=onField × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-aff433fa3ebfdf23 |
| effect-owner=onField × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-20bc38ffe58ebe23 |
| effect-owner=onField × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-80b021f22774cda8 |
| effect-owner=onField × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-6e32006a88fccdd8 |
| effect-owner=onField × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-421614a9630d8b97 |
| effect-owner=onField × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-9761da8676bb23c1 |
| effect-owner=onField × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-526d8801fbe4a033 |
| ult-input-locks-switch=free × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-ac80a584901dc82c |
| ult-input-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-f4591a7f9b76f2e9 |
| ult-input-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-b7c9c3d58998cff3 |
| ult-input-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-b8134ac1ff352da0 |
| ult-input-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7e0202719fc20a85 |
| ult-input-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0f6d98883a1e3206 |
| invincible-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-32f934b62049b70e |
| invincible-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-c43cca704ae4ca7a |
| invincible-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-08550447d7b7209c |
| invincible-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-f958502f338ec663 |
| invincible-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-e398d4f708ad3f3f |
| switch-ends-stop=blocks × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-ce285f56793df73e |
| switch-ends-stop=blocks × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-6b9921a8e31644f7 |
| switch-ends-stop=blocks × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-f902c72ca653286e |
| switch-ends-stop=blocks × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-baf199ad71c62d54 |
| hitstop-in-global-stop=applies × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.4333 | 37570.4560 | changed -0.0169% | changed | false | false | run-e69247034b6e6174 |
| hitstop-in-global-stop=applies × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-79c2bf88b7aee3a1 |
| hitstop-in-global-stop=applies × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-aeaa36de81f693ef |
| echo-input-priority=echo-table × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-9d0317bbd4a7af9c |
| echo-input-priority=echo-table × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-df7de270d5a935a7 |
| interference-frames=300 × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-92996bd10fbe05cc |

## 操作策略试验（不计主表覆盖）

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| input-delay=6 | completed | 稳态第 2–3 轮 | 25.7333 | 36659.1955 | changed -2.4420% | changed | false | false | run-0fab5782cbfd6ea2 |
| tune-break-mode=manual | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-b1951da9148ef0c6 |

## 时刻对照（+6f；门槛级对照未做）

- 变长：8.1，稳态第 2–3 轮，每轮 0.1000 秒；记录到的等待原因 cooldown；gateConfirmed=false；run-e78b07a9b8090042
- 变长：14.1，稳态第 2–3 轮，每轮 0.0083 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-d09baa087111b7a3
- 变长：14.2，稳态第 2–3 轮，每轮 0.0333 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-b3f4676811d715d4
- 吸收：2.1；run-462507d670a4abdb
- 吸收：2.2；run-6e653a9a9cea7a79
- 吸收：2.3；run-6f689df70f6b323d
- 吸收：3.1；run-50e6d129fb879114
- 吸收：4.4；run-95b978026902ed50
- 吸收：4.5；run-44af6a051d2f4bef
- 吸收：6.2；run-46dc17e55fb083d7
- 吸收：7.1；run-ebbc9b7813e09801
- 吸收：8.2；run-383872d70ddd2fac
- 吸收：8.3；run-21796ebfb6dde695
- 吸收：10.1；run-2d1875fb81dc22c2
- 吸收：10.5；run-4638a16ce2ddc274
- 吸收：10.6；run-e73810a39ce2b502
- 吸收：12.2；run-8ab1d7b186c70720
- 吸收：13.1；run-825b1385fa4bb937
- 吸收：14.3；run-9925e121bc86d9c6
- 吸收：14.4；run-1187d5e8d1c4d89b
- 吸收：14.5；run-ee24592e6ffe977f
- 吸收：15.1；run-cda517b4dbadadf5
- 吸收：15.2；run-5f2534cdb7e4f5fa
- 吸收：15.5；run-e26ec39c0f7ac957
- 吸收：15.6；run-3649c95d11f86929

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
- 不适用：forte-keep.心-照世相=clear × forte-keep.卜灵-卦象=clear × track-no-consume=consumed × buling-concerto-timing=on-cast
- 未实现：cast-gain-at-start=at-first-hit × yanhen-extend=xlsx-three-sentences × buling-concerto-timing=later-split
- 未列全：def-floor、effect-tick-timer、effect-owner、forte-keep.心-照世相、forte-keep.卜灵-卦象、invincible-locks-switch、switch-ends-stop、echo-input-priority、interference-frames、summon-as-char、input-delay、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release、cast-gain-at-start、yanhen-extend、buling-concerto-timing
- 依赖的未证实规则：hitstop-in-global-stop、echo-input-priority、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release
