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
代码提交：`dff2000c56a1cf901b5b7a84288577cebf688186`
工作区指纹：`无`
数据版本：20261019；xlsx SHA-256：8b8c9c077aff34b1c1f7ca855945b060482e77fe76d7afd5da7ce65ba7c528f1
基准 runId：`run-d59074a51dd1d296`

## 有条件结论

按最早合法帧执行；完成状态 completed，稳态第 2–3 轮，平均每轮 25.0000 战斗秒，DPS 37576.8190。
未含谐度破坏（sourceSilent；量表 off）。
同一条轴由调度器自动放谐破的参考：completed，稳态 DPS 40472.3790（相对基准 7.7057%），谐破伤害占稳态 7.1544% / 全窗口 7.2382%；各轮战斗帧 1500、1500，轮长不变。参考值不是这条轴的结论。runId：`run-7036f200a02be0a2`。
记录到等待 72 段；按意图的等待 0 段（全运行，见下）。+6f 时刻对照：变长 3、吸收 22、变快 0、不可评估 0。门槛级的对照未做。
有效机制 / 数据候选单项 11/11、两两 54/54；断轴 0、引擎错误 0、未运行 0。三项及以上未查。
DPS same 仅指数值相同（相对差 ≤ 1e-9）；窗口变化幅度不是误差条或置信区间。下表保留全部失败结果。

## 主表：机制与数据

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| def-floor=floor | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-870795905cbc480a |
| effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0e2ad82a47354b79 |
| effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-835c31ecffd47af9 |
| effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-b67b2d68e80cc535 |
| ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0382440977262383 |
| invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-101d3b5204be3a54 |
| switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c849e15bd406cb15 |
| hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-f70e0a7ea902c02b |
| echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-eb7f6c7300540c21 |
| interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-d98e31bb5a97af8b |
| summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-2119439e4652711d |
| def-floor=floor × effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-a2af565a64e6d6ce |
| def-floor=floor × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-1cc50d9e1eb1b6bb |
| def-floor=floor × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-9a535feef7c72172 |
| def-floor=floor × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-d998676a2e716d31 |
| def-floor=floor × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-dcad38b48d43bb59 |
| def-floor=floor × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-490a9350df2f97a7 |
| def-floor=floor × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-f2bd3a885a1fe6fb |
| def-floor=floor × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-0aa708a40ff2dd57 |
| def-floor=floor × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-da0207c72d7e66be |
| def-floor=floor × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-bafb8538386c1c1f |
| effect-tick-timer=reset-on-apply × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c92cda422616548f |
| effect-tick-timer=reset-on-apply × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0e361cc5251fe588 |
| effect-tick-timer=reset-on-apply × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-38b180c4ef87d8e3 |
| effect-tick-timer=reset-on-apply × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-49d7e557a25d3dd9 |
| effect-tick-timer=reset-on-apply × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7a0c46b351aa806e |
| effect-tick-timer=reset-on-apply × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-b550243b22716850 |
| effect-tick-timer=reset-on-apply × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-ecc4ff4c1e277fc9 |
| effect-tick-timer=reset-on-apply × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-ee8fc6670f659720 |
| effect-tick-timer=reset-on-apply × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-937292ff80aee3e9 |
| effect-owner=first × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-3635db33ec20fd3c |
| effect-owner=first × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-d73b31458cf7eb6e |
| effect-owner=first × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4d85e15f9347296d |
| effect-owner=first × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-e925b752cbcc0edb |
| effect-owner=first × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-28c58842fbff47ee |
| effect-owner=first × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-feca52d2ba9899fb |
| effect-owner=first × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c47c1cbfd8c0761c |
| effect-owner=onField × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0d2347123c822113 |
| effect-owner=onField × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-63ce7bc29fd0f292 |
| effect-owner=onField × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-10d04bc769bc6f5c |
| effect-owner=onField × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-962c8dcdb2c0ee6e |
| effect-owner=onField × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-997e45ac69ba64cb |
| effect-owner=onField × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4f7e22f730f984c8 |
| effect-owner=onField × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-3bcd76804e6dc82c |
| ult-input-locks-switch=free × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-69e2acf238f2d4d1 |
| ult-input-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-6b2b6e8286c4559e |
| ult-input-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-1109e7ee18255cbe |
| ult-input-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-910280f300b0c47f |
| ult-input-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4d2ad0c189255027 |
| ult-input-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-3ef09f1fc48a9f4b |
| invincible-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-fdc8a06dc4e6d6b5 |
| invincible-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-e35e4c760fb10746 |
| invincible-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-b22728f60a4f2c67 |
| invincible-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-73007748ae9fd559 |
| invincible-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-a3183983126edbbc |
| switch-ends-stop=blocks × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-2f205c822ee051e1 |
| switch-ends-stop=blocks × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-fc89dae5ba7987c2 |
| switch-ends-stop=blocks × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-da9253511b4a89e8 |
| switch-ends-stop=blocks × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c8fbac2efd349454 |
| hitstop-in-global-stop=applies × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.4333 | 37570.4560 | changed -0.0169% | changed | false | false | run-21d7ebc5888a71f4 |
| hitstop-in-global-stop=applies × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-f806e22c88a54f42 |
| hitstop-in-global-stop=applies × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-4518bccec66b182e |
| echo-input-priority=echo-table × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-2c7205523ae6f926 |
| echo-input-priority=echo-table × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-32bd48c0708a85d0 |
| interference-frames=300 × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-bc64ee8f4342fe83 |

## 操作策略试验（不计主表覆盖）

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| input-delay=6 | completed | 稳态第 2–3 轮 | 25.7333 | 36659.1955 | changed -2.4420% | changed | false | false | run-7cd99e2af3c78506 |
| tune-break-mode=manual † | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-3a1fe1fb7b131c3d |

† 这个变体改变了谐度破坏口径（DD-03 §7.4），DPS 与基准不在同一口径上，差值里包含谐度破坏的伤害变化。

## 时刻对照（+6f；门槛级对照未做）

- 变长：8.1，稳态第 2–3 轮，每轮 0.1000 秒；记录到的等待原因 cooldown；gateConfirmed=false；run-9f51b0ea81a2ad1c
- 变长：14.1，稳态第 2–3 轮，每轮 0.0083 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-dd2885eddc4f9370
- 变长：14.2，稳态第 2–3 轮，每轮 0.0333 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-eb28cc1ae1b0e947
- 吸收：2.1；run-8b2aa3bf3d52d3bc
- 吸收：2.2；run-55e7fa1cbee02085
- 吸收：2.3；run-95aca9ca5ee39bd3
- 吸收：3.1；run-84875456ded4fab6
- 吸收：4.4；run-c4d14597ad5ff720
- 吸收：4.5；run-c9db3a9407bffe28
- 吸收：6.2；run-c62bbd4d45788a22
- 吸收：7.1；run-22676da434ea084f
- 吸收：8.2；run-a95660f7d4a8316e
- 吸收：8.3；run-9da4e30d8e4631d8
- 吸收：10.1；run-db2e929c6b27fdd0
- 吸收：10.5；run-472604f3ee6a2d52
- 吸收：10.6；run-c1e44a0bec113fcf
- 吸收：12.2；run-0b1ec9e860efd61a
- 吸收：13.1；run-b61acd3a8205b409
- 吸收：14.3；run-e44bf0c905328bba
- 吸收：14.4；run-d87cfe27608022cd
- 吸收：14.5；run-a1182b4830253728
- 吸收：15.1；run-d597893653ebc38b
- 吸收：15.2；run-0ad903b0860b80a0
- 吸收：15.5；run-1531212545952970
- 吸收：15.6；run-b17df3891a7f3bd0

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
- 不适用：forte-keep.心-照世相=clear、forte-keep.卜灵-卦象=clear、track-no-consume=consumed、buling-concerto-timing=on-cast、buling-first-echo=no-echo
- 未实现：cast-gain-at-start=at-first-hit、yanhen-extend=xlsx-three-sentences、buling-concerto-timing=later-split、buling-first-echo=xin-only-atk、buling-first-echo=target-side、zhenhuanyu-window=in-window
- 未列全：def-floor、effect-tick-timer、effect-owner、forte-keep.心-照世相、forte-keep.卜灵-卦象、invincible-locks-switch、switch-ends-stop、echo-input-priority、interference-frames、summon-as-char、input-delay、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release、cast-gain-at-start、yanhen-extend、buling-concerto-timing、buling-first-echo
- 依赖的未证实规则：hitstop-in-global-stop、echo-input-priority、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release
