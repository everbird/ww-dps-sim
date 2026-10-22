# 心队的轴卡片（2026-10-22，雷主大招补上全局时停后重算）

由 `pnpm scorecard <7 个场景> [--goal kill:2] --md …` 生成，数据 20261019 版；怎么读见 TD-10 §6.3。改了引擎或场景后重跑覆盖。

## 读法（手写）

- **打 1 倍血（全息 6 · 无常凶鹭，约 132 万）**：所有轴都是 29.1 秒，boss 在启动轴打完时就倒了。按"打死 1 倍血"排启动轴（`plan --opening --goal kill:1`）的结果见 engine-quality-plan §5 P5。
- **打 2 倍血**：C3（卜灵 Q 先放）和原轴差不多（51.3 对 51.4 秒），在帕累托前沿上；C2、C4–C8 慢 2.5～3.7 秒，它们前一两轮在攒资源。
- **3 倍血以上、或无限木桩**：C8 最好（稳态 +21.6%，3 倍血 74.0 秒），熟练档下比原轴好得更多（+24.3%）。C2 3 倍血也是 74.0 秒，但它的稳态还在漂移（长期 +12.3%）。
- **养成门槛**：
  - **C4–C8 要卜灵的奇幻变奏精炼 5 阶**：降到精炼 1 阶就跑不通。卜灵协奏攒不满 100，切心不是变奏，心的 A4 接不上。
  - everbird 账号里卜灵的奇幻变奏是精炼 1 阶（`xin-team.yaml`；卜灵本人 6 链）；在精炼 1 阶上排轴（次数不变、±1），原轴仍是第 1。
  - 原轴、C2、C3 在精炼 1 阶下能跑，掉 7%～8%。雷主 1 链 → 0 链不影响；卜灵 6 链 → 5 链掉 2.5%～4%。
- **好不好打**：C4 之后每分钟的决策点从 67 涨到 94、切人从 7.4 涨到 15.6，打起来忙得多。
- **靠不靠得住**：C4–C8 最脆弱的都是"切人不保留共鸣回路"（翻过来跑不通，verify-guide B1、B2）；原轴、C2、C3 最敏感的是自动谐度破坏。

## 按稳态
7 条轴，口径：稳态（第 2–9 轮）；第一条当基准。★ = 帕累托前沿（没有别的轴零帧和"熟练"都更好）。TD-10 §6.3。

### ① 目标

| 轴 | 口径 | 比基准 | 打死 1 倍血 | 2 倍 | 3 倍 |
|---|---:|---:|---:|---:|---:|
| xin-team-r5 | 54,322 | 基准 | 29.1 | 51.4 | 78.0 |
| xin-team-r5-心共鸣效率 | 62,402 | +14.9% | 29.1 | 55.1 | 74.0 |
| xin-team-r5-卜灵Q先放 | 56,972 | +4.9% | 29.1 | 51.3 | 74.2 |
| xin-team-r5-按套路重排 | 58,733 | +8.1% | 29.1 | 54.1 | 78.8 |
| xin-team-r5-按套路重排-雷主多一次E | 65,337 | +20.3% | 29.1 | 54.0 | 78.3 |
| xin-team-r5-按套路重排-心补EQ | 65,197 | +20.0% | 29.1 | 54.0 | 75.1 |
| ★ xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | 66,057 | +21.6% | 29.1 | 53.9 | 74.0 |

打死几倍血按战斗秒（通关计时，大招时停也停），启动轴算在内。

### ② 好不好打

| 轴 | 高手（晚 3 帧） | 熟练（6） | 普通（10） | 熟练比基准 | 每轮 | 决策点 / 分 | 切人 / 分 | 抢帧 ! | 空中切人 / 轮 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| xin-team-r5 | −4.3% | −10.1% | −17.1% | 基准 | 32.3 秒 | 67 | 7.4 | 0 | 1 |
| xin-team-r5-心共鸣效率 | −4.3% | −12.2% | −18.6% | +12.2% | 27.3 秒 | 79 | 8.8 | 0 | 1 |
| xin-team-r5-卜灵Q先放 | −4.6% | −10.2% | −15.5% | +4.7% | 30.7 秒 | 70 | 7.8 | 0 | 0 |
| xin-team-r5-按套路重排 | −5.3% | −11.9% | −18.0% | +5.9% | 30.2 秒 | 77 | 13.9 | 0 | 1 |
| xin-team-r5-按套路重排-雷主多一次E | −5.8% | −11.9% | −18.0% | +17.9% | 27.6 秒 | 87 | 15.2 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ | −4.8% | −10.2% | −17.3% | +19.9% | 27.7 秒 | 91 | 15.2 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | −4.4% | −8.1% | −14.0% | +24.3% | 26.9 秒 | 94 | 15.6 | 0 | 1 |

手速档：每个决策点（切人、不是连段后续的出招）在合法之后固定晚这一档的平均帧数，比零帧掉多少（假设 hand-speed）。

### ③ 养成门槛

"5 星 0 链 1 精"：5 星角色降到 0 链、5 星武器降到精炼 1，4 星不动。共鸣效率的"约几条副词条"按副词条各档平均（9.6% 一条），是不靠主词条要额外堆的量。

- **xin-team-r5**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 102.9%，约 0.3 条副词条（现在 109.2%）；雷主·男 118.9%，约 0.6 条副词条（现在 142.8%）；卜灵 142.3%，约 4.4 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −2.5%；卜灵 奇幻变奏 精炼 5 → 1 −7.9%
- **xin-team-r5-心共鸣效率**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 102.9%，约 0.3 条副词条（现在 141.2%）；雷主·男 125.2%，约 1.3 条副词条（现在 142.8%）；卜灵 155.8%，约 5.8 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −4.0%；卜灵 奇幻变奏 精炼 5 → 1 −7.7%
- **xin-team-r5-卜灵Q先放**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 102.6%，约 0.3 条副词条（现在 109.2%）；雷主·男 118.9%，约 0.6 条副词条（现在 142.8%）；卜灵 143.0%，约 4.5 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −2.4%；卜灵 奇幻变奏 精炼 5 → 1 −7.3%
- **xin-team-r5-按套路重排**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 125.0%，约 1.3 条副词条（现在 142.8%）；卜灵 139.1%，约 4.1 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.0%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）
- **xin-team-r5-按套路重排-雷主多一次E**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%，约 1.2 条副词条（现在 142.8%）；卜灵 136.9%，约 3.8 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.1%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%，约 1.2 条副词条（现在 142.8%）；卜灵 133.7%，约 3.5 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.1%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%，约 1.2 条副词条（现在 142.8%）；卜灵 133.4%，约 3.5 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.1%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）

### ④ 靠不靠得住

- **xin-team-r5**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−4.6%
- **xin-team-r5-心共鸣效率**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：ult-no-switch（rules.ultInputLocksSwitch = false）−6.1%
- **xin-team-r5-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−4.6%
- **xin-team-r5-按套路重排**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-雷主多一次E**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通

共 314 次仿真，327 秒。


## 按打死 2 倍血
7 条轴，口径：打死 264.4 万血（敌人生命 ×2）；第一条当基准。★ = 帕累托前沿（没有别的轴零帧和"熟练"都更好）。TD-10 §6.3。

### ① 目标

| 轴 | 口径 | 比基准 | 打死 1 倍血 | 2 倍 | 3 倍 |
|---|---:|---:|---:|---:|---:|
| xin-team-r5 | 51,471 | 基准 | 29.1 | 51.4 | 78.0 |
| xin-team-r5-心共鸣效率 | 47,955 | −6.8% | 29.1 | 55.1 | 74.0 |
| ★ xin-team-r5-卜灵Q先放 | 51,555 | +0.2% | 29.1 | 51.3 | 74.2 |
| xin-team-r5-按套路重排 | 48,871 | −5.1% | 29.1 | 54.1 | 78.8 |
| xin-team-r5-按套路重排-雷主多一次E | 48,946 | −4.9% | 29.1 | 54.0 | 78.3 |
| xin-team-r5-按套路重排-心补EQ | 48,946 | −4.9% | 29.1 | 54.0 | 75.1 |
| xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | 49,037 | −4.7% | 29.1 | 53.9 | 74.0 |

打死几倍血按战斗秒（通关计时，大招时停也停），启动轴算在内。

### ② 好不好打

| 轴 | 高手（晚 3 帧） | 熟练（6） | 普通（10） | 熟练比基准 | 每轮 | 决策点 / 分 | 切人 / 分 | 抢帧 ! | 空中切人 / 轮 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| xin-team-r5 | −4.1% | −7.9% | −13.6% | 基准 | 32.3 秒 | 67 | 7.4 | 0 | 1 |
| xin-team-r5-心共鸣效率 | −3.8% | −6.9% | −12.4% | −5.9% | 27.3 秒 | 79 | 8.8 | 0 | 1 |
| xin-team-r5-卜灵Q先放 | −1.5% | −5.1% | −11.9% | +3.2% | 30.7 秒 | 70 | 7.8 | 0 | 0 |
| xin-team-r5-按套路重排 | −2.3% | −5.3% | −15.9% | −2.4% | 30.2 秒 | 77 | 13.9 | 0 | 1 |
| xin-team-r5-按套路重排-雷主多一次E | −2.6% | −5.6% | −15.2% | −2.6% | 27.6 秒 | 87 | 15.2 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ | −2.6% | −5.6% | −15.2% | −2.6% | 27.7 秒 | 91 | 15.2 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | −2.6% | −5.1% | −13.2% | −1.9% | 26.9 秒 | 94 | 15.6 | 0 | 1 |

手速档：每个决策点（切人、不是连段后续的出招）在合法之后固定晚这一档的平均帧数，比零帧掉多少（假设 hand-speed）。

### ③ 养成门槛

"5 星 0 链 1 精"：5 星角色降到 0 链、5 星武器降到精炼 1，4 星不动。共鸣效率的"约几条副词条"按副词条各档平均（9.6% 一条），是不靠主词条要额外堆的量。

- **xin-team-r5**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 100.1%，约 0.0 条副词条（现在 109.2%）；雷主·男 116.3%，约 0.4 条副词条（现在 142.8%）；卜灵 145.0%，约 4.7 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −2.9%；卜灵 奇幻变奏 精炼 5 → 1 −12.7%
- **xin-team-r5-心共鸣效率**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 100.2%，约 0.0 条副词条（现在 141.2%）；雷主·男 120.1%，约 0.8 条副词条（现在 142.8%）；卜灵 149.4%，约 5.1 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −0.1%；卜灵 奇幻变奏 精炼 5 → 1 −6.3%
- **xin-team-r5-卜灵Q先放**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 100.1%，约 0.0 条副词条（现在 109.2%）；雷主·男 116.3%，约 0.4 条副词条（现在 142.8%）；卜灵 143.0%，约 4.5 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −2.7%；卜灵 奇幻变奏 精炼 5 → 1 −12.8%
- **xin-team-r5-按套路重排**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 125.0%，约 1.3 条副词条（现在 142.8%）；卜灵 139.1%，约 4.1 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −6.0%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）
- **xin-team-r5-按套路重排-雷主多一次E**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%，约 1.2 条副词条（现在 142.8%）；卜灵 136.9%，约 3.8 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −4.3%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%，约 1.2 条副词条（现在 142.8%）；卜灵 136.9%，约 3.8 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −4.3%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%，约 1.2 条副词条（现在 142.8%）；卜灵 131.5%，约 3.3 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −1.8%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）

### ④ 靠不靠得住

- **xin-team-r5**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−7.7%
- **xin-team-r5-心共鸣效率**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−1.0%
- **xin-team-r5-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−7.7%
- **xin-team-r5-按套路重排**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-雷主多一次E**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通

共 314 次仿真，201 秒。

