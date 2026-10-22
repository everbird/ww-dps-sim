# 心队的轴卡片（2026-10-22）

由 `pnpm scorecard <7 个场景> [--goal kill:2] --md …` 生成，数据 20261019 版；怎么读见 TD-10 §6.3。改了引擎或场景后重跑覆盖。

## 读法（手写）

- **打 1 倍血（全息 6 · 无常凶鹭，约 132 万）**：所有轴都是 32.9 秒，boss 在启动轴打完时就倒了，循环轴怎么排都一样。要更快，得排启动轴（`pnpm plan --opening`）。
- **打 2 倍血**：只有 C3（卜灵 Q 先放）比原轴快（57.9 秒对 59.0 秒），在帕累托前沿上；C4–C8 都慢 3～4.5 秒，它们前一两轮在攒资源。
- **3 倍血以上、或无限木桩**：C8 最好（83.6 秒，稳态 +25.7%），熟练档也是它最好。
- **养成门槛**：
  - **C4–C8 要卜灵的奇幻变奏 5 阶**：降到 1 阶就跑不通。卜灵协奏攒不满 100，切心不是变奏，心的 A4 接不上。
  - everbird 账号里卜灵是 1 阶（`xin-team.yaml`），所以这几条用现在的配置打不了，要在卜灵那段补位攒协奏，或者换武器。原轴、C2、C3 在 1 阶下能跑，掉 4%～8%。
  - 雷主 1 链 → 0 链不影响；卜灵 6 链 → 5 链掉 2%～3%。
- **好不好打**：
  - C4 之后每分钟的决策点从 60 涨到 86、切人从 6.7 涨到 14.4，打起来忙得多。
  - 但熟练档（每个决策点晚 6 帧）下，C8 反而比原轴好得更多（稳态 +29.4%）：它的切人锁和等待里有余量。
- **靠不靠得住**：C4–C8 最脆弱的都是"切人不保留共鸣回路"（翻过来跑不通，verify-guide B1、B2）；原轴、C2、C3 最敏感的是自动谐度破坏。
- C2 的稳态还在漂移，表里的 +9.3% 偏高，长期约 +5.2%（engine-quality-plan §5 P3）。

## 按稳态
7 条轴，口径：稳态（第 2–9 轮）；第一条当基准。★ = 帕累托前沿（没有别的轴零帧和"熟练"都更好）。TD-10 §6.3。

### ① 目标

| 轴 | 口径 | 比基准 | 打死 1 倍血 | 2 倍 | 3 倍 |
|---|---:|---:|---:|---:|---:|
| xin-team-r5 | 48,470 | 基准 | 32.9 | 59.0 | 92.3 |
| xin-team-r5-心共鸣效率 | 52,966 | +9.3% | 32.9 | 62.6 | 85.2 |
| xin-team-r5-卜灵Q先放 | 50,660 | +4.5% | 32.9 | 57.9 | 88.8 |
| xin-team-r5-按套路重排 | 52,901 | +9.1% | 32.9 | 63.5 | 87.7 |
| xin-team-r5-按套路重排-雷主多一次E | 56,389 | +16.3% | 32.9 | 63.5 | 86.3 |
| xin-team-r5-按套路重排-心补EQ | 59,073 | +21.9% | 32.9 | 63.5 | 87.8 |
| ★ xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | 60,950 | +25.7% | 32.9 | 62.2 | 83.6 |

打死几倍血按战斗秒（通关计时，大招时停也停），启动轴算在内。

### ② 好不好打

| 轴 | 高手（晚 3 帧） | 熟练（6） | 普通（10） | 熟练比基准 | 每轮 | 决策点 / 分 | 切人 / 分 | 抢帧 ! | 空中切人 / 轮 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| xin-team-r5 | −4.3% | −11.1% | −18.1% | 基准 | 36.0 秒 | 60 | 6.7 | 0 | 1 |
| xin-team-r5-心共鸣效率 | −4.0% | −10.9% | −17.5% | +9.6% | 30.9 秒 | 70 | 7.8 | 0 | 1 |
| xin-team-r5-卜灵Q先放 | −4.9% | −11.2% | −16.2% | +4.5% | 34.4 秒 | 63 | 7.0 | 0 | 0 |
| xin-team-r5-按套路重排 | −3.7% | −12.8% | −17.9% | +7.1% | 33.2 秒 | 70 | 12.6 | 0 | 1 |
| xin-team-r5-按套路重排-雷主多一次E | −2.5% | −7.1% | −13.6% | +21.7% | 31.2 秒 | 77 | 13.5 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ | −5.9% | −11.2% | −17.5% | +21.8% | 30.6 秒 | 82 | 13.7 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | −3.9% | −8.6% | −16.2% | +29.4% | 29.2 秒 | 86 | 14.4 | 0 | 1 |

手速档：每个决策点（切人、不是连段后续的出招）在合法之后固定晚这一档的平均帧数，比零帧掉多少（假设 hand-speed）。

### ③ 养成门槛

- **xin-team-r5**：共鸣效率 心 102.6%（现在 109.2%）；雷主·男 118.9%（现在 142.8%）；卜灵 143.3%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −2.4%；卜灵 奇幻变奏 5 阶 → 1 阶 −8.3%
- **xin-team-r5-心共鸣效率**：共鸣效率 心 102.6%（现在 141.2%）；雷主·男 125.2%（现在 142.8%）；卜灵 157.0%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −2.6%；卜灵 奇幻变奏 5 阶 → 1 阶 −4.3%
- **xin-team-r5-卜灵Q先放**：共鸣效率 心 102.6%（现在 109.2%）；雷主·男 118.9%（现在 142.8%）；卜灵 140.1%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −2.4%；卜灵 奇幻变奏 5 阶 → 1 阶 −7.8%
- **xin-team-r5-按套路重排**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 125.0%（现在 142.8%）；卜灵 139.6%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.0%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）
- **xin-team-r5-按套路重排-雷主多一次E**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%（现在 142.8%）；卜灵 137.6%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.0%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%（现在 142.8%）；卜灵 132.9%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.1%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%（现在 142.8%）；卜灵 132.7%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.1%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）

### ④ 靠不靠得住

- **xin-team-r5**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−5.5%
- **xin-team-r5-心共鸣效率**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−6.1%
- **xin-team-r5-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−5.0%
- **xin-team-r5-按套路重排**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-雷主多一次E**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通

共 307 次仿真，145 秒。

## 按打死 2 倍血
7 条轴，口径：打死 264.4 万血（敌人生命 ×2）；第一条当基准。★ = 帕累托前沿（没有别的轴零帧和"熟练"都更好）。TD-10 §6.3。

### ① 目标

| 轴 | 口径 | 比基准 | 打死 1 倍血 | 2 倍 | 3 倍 |
|---|---:|---:|---:|---:|---:|
| xin-team-r5 | 44,787 | 基准 | 32.9 | 59.0 | 92.3 |
| xin-team-r5-心共鸣效率 | 42,201 | −5.8% | 32.9 | 62.6 | 85.2 |
| ★ xin-team-r5-卜灵Q先放 | 45,637 | +1.9% | 32.9 | 57.9 | 88.8 |
| xin-team-r5-按套路重排 | 41,636 | −7.0% | 32.9 | 63.5 | 87.7 |
| xin-team-r5-按套路重排-雷主多一次E | 41,658 | −7.0% | 32.9 | 63.5 | 86.3 |
| xin-team-r5-按套路重排-心补EQ | 41,658 | −7.0% | 32.9 | 63.5 | 87.8 |
| xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | 42,507 | −5.1% | 32.9 | 62.2 | 83.6 |

打死几倍血按战斗秒（通关计时，大招时停也停），启动轴算在内。

### ② 好不好打

| 轴 | 高手（晚 3 帧） | 熟练（6） | 普通（10） | 熟练比基准 | 每轮 | 决策点 / 分 | 切人 / 分 | 抢帧 ! | 空中切人 / 轮 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| xin-team-r5 | −3.6% | −6.9% | −15.8% | 基准 | 36.0 秒 | 60 | 6.7 | 0 | 1 |
| xin-team-r5-心共鸣效率 | −3.5% | −6.8% | −11.3% | −5.7% | 30.9 秒 | 70 | 7.8 | 0 | 1 |
| xin-team-r5-卜灵Q先放 | −2.6% | −6.1% | −15.4% | +2.8% | 34.4 秒 | 63 | 7.0 | 0 | 0 |
| xin-team-r5-按套路重排 | −3.7% | −7.2% | −11.5% | −7.3% | 33.2 秒 | 70 | 12.6 | 0 | 1 |
| xin-team-r5-按套路重排-雷主多一次E | −3.9% | −7.4% | −11.8% | −7.4% | 31.2 秒 | 77 | 13.5 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ | −3.9% | −7.4% | −11.8% | −7.4% | 30.6 秒 | 82 | 13.7 | 0 | 1 |
| xin-team-r5-按套路重排-心补EQ-卜灵Q先放 | −3.7% | −7.5% | −12.0% | −5.6% | 29.2 秒 | 86 | 14.4 | 0 | 1 |

手速档：每个决策点（切人、不是连段后续的出招）在合法之后固定晚这一档的平均帧数，比零帧掉多少（假设 hand-speed）。

### ③ 养成门槛

- **xin-team-r5**：共鸣效率 心 100.1%（现在 109.2%）；雷主·男 116.3%（现在 142.8%）；卜灵 146.0%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −5.7%；卜灵 奇幻变奏 5 阶 → 1 阶 −11.0%
- **xin-team-r5-心共鸣效率**：共鸣效率 心 100.2%（现在 141.2%）；雷主·男 120.1%（现在 142.8%）；卜灵 153.6%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 ±0.0%；卜灵 奇幻变奏 5 阶 → 1 阶 −5.5%
- **xin-team-r5-卜灵Q先放**：共鸣效率 心 100.1%（现在 109.2%）；雷主·男 116.3%（现在 142.8%）；卜灵 144.0%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −4.6%；卜灵 奇幻变奏 5 阶 → 1 阶 −10.3%
- **xin-team-r5-按套路重排**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 125.0%（现在 142.8%）；卜灵 137.9%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 ±0.0%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）
- **xin-team-r5-按套路重排-雷主多一次E**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%（现在 142.8%）；卜灵 137.9%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −0.1%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%（现在 142.8%）；卜灵 137.9%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −0.1%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：共鸣效率 心 不用堆（现在 109.2%）；雷主·男 124.8%（现在 142.8%）；卜灵 132.7%（现在 225.8%）。降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 ±0.0%；卜灵 奇幻变奏 5 阶 → 1 阶 跑不通（comboBroken）

### ④ 靠不靠得住

- **xin-team-r5**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−6.5%
- **xin-team-r5-心共鸣效率**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：ult-no-switch（rules.ultInputLocksSwitch = false）+1.3%
- **xin-team-r5-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−5.6%
- **xin-team-r5-按套路重排**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-雷主多一次E**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **xin-team-r5-按套路重排-心补EQ-卜灵Q先放**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通

共 307 次仿真，138 秒。
