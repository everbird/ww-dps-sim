# M0 严格轴：第一份有条件结论

## 读法

这份结论回答：按此配置、当前数据与模型、最早合法帧执行，固定教学轴能否跑通，以及列明的机制单项和两两组合会怎样改变结果。不证明游戏机制正确、不证明真人能零延迟执行，也不声称这条轴最优；三项以上、未实现和未列全的读法没有覆盖。

**未含谐度破坏**：原文没给位置（用户 2026-11-14 定），量表也关闭。自动谐破参考由调度器选择时机，不是原文轴；manual 策略试验则量表仍累积但不放谐破。三个口径不能混为同一结论。

DD-04 §7 的历史参考（20261019 数据）为未含谐破 37,577、自动 40,472；本次舍入后相同，无须用代码改动解释差异。精确数字、各候选变化、时刻对照和身份全部由下面的生成区给出，重跑只替换生成区。

### 交给 DD-08 的实验线索（路线图 §10.1）

- E2/C1：烬华蔓舞的第 4 段与数据读法，关联 `data-guess` 等单候选未列全项；需要按实际动作条件登记预测与观测，不能用当前无可翻候选推断机制已证实。
- E2/C5 与 E1/B7：大招后最早切人可检验 `ult-input-locks-switch`，但要限定角色与输入条件；本轴单项不变不代表共享规则正确。
- 声骸起手优先级（`echo-input-priority`）：2026-11-26 做了 C8（iPad 肉眼），回填闭环 `echo-input-priority.backfill` 证实（所测条件内）声骸在 E 出伤前就能把 E 打断，不必等 E 结束；原闭环的 setup（等出手再按）与操作对不上，作废（`docs/experiments/C8-声骸起手优先级.md`"结果"）。主表里它与其他时序开关的组合效应照旧；本轴写的 `E Q` 是"等 E 出伤再按 Q"的打法，出伤后多快出这次没测。
- 起手即得（`cast-gain-at-start`）：2026-11-27 有了开关（`rules.castGainTiming: firstHit`），主表第一次列出它。单项与两两都不改本轴的稳态 DPS 与轮长（两两里变了的两对，数和另一项单翻相同），只有日志不同（起手即得改在第一段命中时给）。能区分它的 C9 已登记预测（`docs/experiments/C9-散华E协奏起手即得.md`）。
- `hitstop-in-global-stop`、`dilation-rules`、`summon-clock`、`wait-settled`、`white-bar`、`burst-release` 的实验尚未由该清单逐项覆盖，应由 DD-08 设计受控条件；已有文字依据不是独立检验。
- 心、卜灵保留状态（E1/B1、B2）在本队不适用，不能用于升级这份 M0 结论。所有证据升级仍须明确用途、适用条件和未排除的候选。

<!-- generated: DD-04 -->
## 生成信息

命令：`pnpm candidates scenarios/m0-video-eq-不打谐破.yaml --pairs --json out/candidates/m0.json --md docs/m0-strict-conclusion.md`
代码提交：`cee3b653b24986de0c04bcedeaf9404ca957409b`
工作区指纹：`无`
数据版本：20261019；xlsx SHA-256：8b8c9c077aff34b1c1f7ca855945b060482e77fe76d7afd5da7ce65ba7c528f1
基准 runId：`run-b0f45e11045c15ab`

## 有条件结论

按最早合法帧执行；完成状态 completed，稳态第 2–3 轮，平均每轮 25.0000 战斗秒，DPS 37576.8190。
未含谐度破坏（sourceSilent；量表 off）。
同一条轴由调度器自动放谐破的参考：completed，稳态 DPS 40472.3790（相对基准 7.7057%），谐破伤害占稳态 7.1544% / 全窗口 7.2382%；各轮战斗帧 1500、1500，轮长不变。参考值不是这条轴的结论。runId：`run-0f926186f9bf46de`。
记录到等待 72 段；按意图的等待 0 段（全运行，见下）。+6f 时刻对照：变长 3、吸收 22、变快 0、不可评估 0。门槛级的对照未做。
有效机制 / 数据候选单项 12/12、两两 65/65；断轴 0、引擎错误 0、未运行 0。三项及以上未查。
DPS same 仅指数值相同（相对差 ≤ 1e-9）；窗口变化幅度不是误差条或置信区间。下表保留全部失败结果。

## 主表：机制与数据

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| def-floor=floor | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c1620b30cc9d9814 |
| effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5196f2bfb3d0419a |
| effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-bba5bebea72628ee |
| effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5e133a36d74f842c |
| ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7a3cdb53cb9c4f2a |
| invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-ec6f28c338823f48 |
| switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5b70e70be9ee3c8d |
| hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-b07622dd54837923 |
| echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-48939858a2c01de4 |
| interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-a6b3602cea2be8e0 |
| summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-65e7d816ffaca29d |
| cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-966105d7afb7ba6d |
| def-floor=floor × effect-tick-timer=reset-on-apply | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5b7222d900087ced |
| def-floor=floor × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-6fa61d23bcfe15c0 |
| def-floor=floor × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4b80a85638ccf36f |
| def-floor=floor × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c3e8889b0f6ab329 |
| def-floor=floor × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-e00801937acd85fb |
| def-floor=floor × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-0324b20f83ea058d |
| def-floor=floor × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-6527088e0e4be5b2 |
| def-floor=floor × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-4cc07c485db5c7c0 |
| def-floor=floor × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-8033266132d58670 |
| def-floor=floor × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-e929bf48f5fe32d4 |
| def-floor=floor × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-30ae50d68e9b161e |
| effect-tick-timer=reset-on-apply × effect-owner=first | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-3c7afd5c73111f87 |
| effect-tick-timer=reset-on-apply × effect-owner=onField | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-5de45f388aa92223 |
| effect-tick-timer=reset-on-apply × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-03fae8809c8b9b95 |
| effect-tick-timer=reset-on-apply × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-cf8a87d79daa9e9f |
| effect-tick-timer=reset-on-apply × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-cd6b0ae10b0e2711 |
| effect-tick-timer=reset-on-apply × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-cc6b42971fec974e |
| effect-tick-timer=reset-on-apply × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-226d5abffe20f8f6 |
| effect-tick-timer=reset-on-apply × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-58470e5db0620761 |
| effect-tick-timer=reset-on-apply × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-73ae8ed16eb8c9d0 |
| effect-tick-timer=reset-on-apply × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-8e69af55ed724b4d |
| effect-owner=first × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-e94ecbb2493ebc5b |
| effect-owner=first × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-f9bbbd1047654094 |
| effect-owner=first × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-b3f23f3286eade03 |
| effect-owner=first × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-34906180139caa67 |
| effect-owner=first × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-971104a7443adf66 |
| effect-owner=first × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-7ffce6747ca7b3a6 |
| effect-owner=first × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-f7d51318fbcbce6e |
| effect-owner=first × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-08a55a809fc5d51c |
| effect-owner=onField × ult-input-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-df9415ade263bd3a |
| effect-owner=onField × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-26813ef7a37d740b |
| effect-owner=onField × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-ff73e82fd3e799cb |
| effect-owner=onField × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-ce73484d912aa0ea |
| effect-owner=onField × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-e54e6a328d571a8b |
| effect-owner=onField × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-4c40eb7d23893b47 |
| effect-owner=onField × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c8b6b9887a0f20fd |
| effect-owner=onField × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-477149cc5851a8f2 |
| ult-input-locks-switch=free × invincible-locks-switch=free | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-c6a0a420d1f36d5d |
| ult-input-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-8fa72228e7973760 |
| ult-input-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-293521eaa6227e2e |
| ult-input-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-f00be29345298df6 |
| ult-input-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-d934012f1dfb3220 |
| ult-input-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-9fcd92babf3a098c |
| ult-input-locks-switch=free × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-f3b66de837cdf866 |
| invincible-locks-switch=free × switch-ends-stop=blocks | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-b231d58e602714ef |
| invincible-locks-switch=free × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-af66658e7227ef15 |
| invincible-locks-switch=free × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-0b78063431dd5db3 |
| invincible-locks-switch=free × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-97579e0359e87d65 |
| invincible-locks-switch=free × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-69f781160ba6d27d |
| invincible-locks-switch=free × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-3c0f50df1a5c3900 |
| switch-ends-stop=blocks × hitstop-in-global-stop=applies | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-f5a4288b2e5ab2f7 |
| switch-ends-stop=blocks × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-aeb9dc0ef37e0b8a |
| switch-ends-stop=blocks × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-8c216aa523b9cc5d |
| switch-ends-stop=blocks × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-fc88e86dd821473f |
| switch-ends-stop=blocks × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-1cf3afc86eeec339 |
| hitstop-in-global-stop=applies × echo-input-priority=echo-table | completed | 稳态第 2–3 轮 | 25.4333 | 37570.4560 | changed -0.0169% | changed | false | false | run-5173d78af071df91 |
| hitstop-in-global-stop=applies × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-7f15ba9b92368929 |
| hitstop-in-global-stop=applies × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-9a0d2991c97e623a |
| hitstop-in-global-stop=applies × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37594.1870 | changed 0.0462% | same | false | false | run-7551b513e2cec0f8 |
| echo-input-priority=echo-table × interference-frames=300 | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-e4fbb7802a59e742 |
| echo-input-priority=echo-table × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-ced261773f055ad4 |
| echo-input-priority=echo-table × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.2333 | 37870.5295 | changed 0.7816% | changed | false | false | run-9ff4909ce01eed7b |
| interference-frames=300 × summon-as-char=not | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | true | run-463eddc54ea87496 |
| interference-frames=300 × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-9de448ef8be4ba66 |
| summon-as-char=not × cast-gain-at-start=at-first-hit | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-43cbb240af36c3a1 |

## 操作策略试验（不计主表覆盖）

| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |
|---|---|---|---:|---:|---|---|---|---|---|
| input-delay=6 | completed | 稳态第 2–3 轮 | 25.7333 | 36659.1955 | changed -2.4420% | changed | false | false | run-468f53fb41736445 |
| tune-break-mode=manual † | completed | 稳态第 2–3 轮 | 25.0000 | 37576.8190 | same 0.0000% | same | true | false | run-8852dc7308f84003 |

† 这个变体改变了谐度破坏口径（DD-03 §7.4），DPS 与基准不在同一口径上，差值里包含谐度破坏的伤害变化。

## 时刻对照（+6f；门槛级对照未做）

- 变长：8.1，稳态第 2–3 轮，每轮 0.1000 秒；记录到的等待原因 cooldown；gateConfirmed=false；run-72ce04c90bd9f7c8
- 变长：14.1，稳态第 2–3 轮，每轮 0.0083 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-ea41e02c53fa8537
- 变长：14.2，稳态第 2–3 轮，每轮 0.0333 秒；记录到的等待原因 inputLock；gateConfirmed=false；run-612b1342cd628d61
- 吸收：2.1；run-109b4299d7bb786b
- 吸收：2.2；run-ec7cbaa26065ab2c
- 吸收：2.3；run-325ba028df88a96e
- 吸收：3.1；run-42737484a16ac797
- 吸收：4.4；run-57c8901c4edf33e8
- 吸收：4.5；run-b9dc71bffc6dc48e
- 吸收：6.2；run-ebb06325b471ad2c
- 吸收：7.1；run-653864188df70247
- 吸收：8.2；run-87cfa83521eab428
- 吸收：8.3；run-3953e1e17c384fca
- 吸收：10.1；run-3570822ceacd814a
- 吸收：10.5；run-161b22be826f570f
- 吸收：10.6；run-411f6642ec07fc3b
- 吸收：12.2；run-79905c9c44fe42e3
- 吸收：13.1；run-99922933170a54aa
- 吸收：14.3；run-97114f0ab9d27fef
- 吸收：14.4；run-1ea4a4badbf995ba
- 吸收：14.5；run-3825bc17d145ced9
- 吸收：15.1；run-fa52ac7a34575cad
- 吸收：15.2；run-646fd312701e1555
- 吸收：15.5；run-64730e2a5049254b
- 吸收：15.6；run-2ab763705ad32872

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
- 未实现：yanhen-extend=xlsx-three-sentences、buling-concerto-timing=later-split、buling-first-echo=xin-only-atk、buling-first-echo=target-side、zhenhuanyu-window=in-window
- 未列全：def-floor、effect-tick-timer、effect-owner、forte-keep.心-照世相、forte-keep.卜灵-卦象、invincible-locks-switch、switch-ends-stop、echo-input-priority、interference-frames、summon-as-char、input-delay、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release、cast-gain-at-start、yanhen-extend、buling-concerto-timing、buling-first-echo
- 依赖的未证实规则：hitstop-in-global-stop、wait-settled、dilation-rules、summon-clock、white-bar、data-guess、burst-release
