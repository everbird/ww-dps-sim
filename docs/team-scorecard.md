# 五支队伍的轴卡片（2026-10-25，声骸起手优先级改了之后重生成）

景尤守、爱琳莫、爱琳守、心队、M0 各取代表轴，用 `pnpm scorecard … --md` 生成（表在下面，TD-10 §6.3）。数据 20261019，配装都是你的账号；切人冷却按每人单独计（AGENTS.md 差异第 18 条）；声骸起手能打断重击、技能的后摇（差异第 21 条，docs/jys-videos.md §6.4）。

## 读法

- **稳态**：爱琳莫最高（89,055），比 5R18Z 高 12%。爱琳守和心队都在 6.9 万上下；M0 是 4.0 万。
  - 声骸那条改了之后，景尤守、爱琳守、心队、M0 代表轴各涨 6%～8%，爱琳莫只涨 1.8%（它的声骸本来就不怎么等），所以爱琳莫领先的幅度从 17% 缩到 12%。
- **打死几倍血**：
  - 1 倍血景尤守最快（19.9 秒）：景燃的爆发集中在前面。爱琳莫第 23.6 秒，要等第一次干涉和两次光翼共奏。
  - 3 倍血爱琳莫反超（50.0 秒对 52.3 秒）。
  - 打单只短血量的 boss 景尤守更合适，血量厚的爱琳莫更合适。
- **"尤诺快开大"不再比 5R18Z 好**：稳态 −0.1%（误差内），原来 +2.6% 的收益正是省了变奏后等声骸的那段。熟练手速下仍好 2.1%（抢帧少一处，容错大一点）。
- **好不好打**：
  - 各轴在"熟练"手速（每个决策点晚 6 帧）下都掉 10–12%，差别不大。
  - M0 视频轴例外：一轮卡在维里奈大招的 25 秒冷却上，晚 3 帧反而 +0.5%、晚 6 帧只掉 2.4%。
  - 轮椅轴（每分钟 69 个决策点、6.5 次切人）和爱琳守（66）最省手；心队最密（97）。
- **养成**：
  - 降到"5 星 0 链 1 精"影响都在 3% 以内（爱琳莫、爱琳守主要是停驻之烟 5 → 1 精，−2.2%）。
  - 共鸣效率：守岸人、莫宁都要堆约 5–7 条副词条，靠主词条才够；爱弥斯、景燃 1 条上下。
- **靠不靠得住**（只看有开关的假设）：
  - 景尤守（5R18Z、轮椅）最敏感的变成了声骸起手优先级本身（关掉 −5.7% / −6.8%）。这条有视频 A 一段对上（守岸人那段 5.52 秒对 5.59 秒），其余队伍没量过。
  - 爱琳守最敏感的是干涉时长（`resonance-rules`，8 → 5 秒 +11.0%）：没有莫宁的谐振场，干涉锁得越久，谐度破坏越赶不上每轮一次。
  - 爱琳莫最敏感的是"过载后第一次强化 E 不消耗轨迹"（`track-no-consume`，关掉 −4.0%）。
  - 两支爱弥斯队写的是手动谐度破坏（`tuneBreak: manual`），表里不翻"谐度破坏自动放"；全关掉的话爱琳莫 −33%、爱琳守跑不通（docs/assumption-sensitivity.md）。

## ① 目标

| 轴 | 口径 | 比基准 | 打死 1 倍血 | 2 倍 | 3 倍 |
|---|---:|---:|---:|---:|---:|
| jys-5r18z | 79,244 | 基准 | 19.9 | 38.8 | 52.3 |
| jys-5r18z-尤诺快开大 | 79,203 | −0.1% | 19.9 | 39.0 | 54.3 |
| jys-轮椅 | 77,123 | −2.7% | 20.8 | 41.2 | 54.9 |
| ★ alm-爱琳莫 | 89,055 | +12.4% | 23.6 | 43.3 | 50.0 |
| alm-爱琳守 | 68,607 | −13.4% | 25.6 | 47.4 | 72.6 |
| xin-team-r5-按套路重排-心补EQ | 69,240 | −12.6% | 26.8 | 51.2 | 71.8 |
| m0-video-eq | 40,490 | −48.9% | 46.1 | 92.2 | 137.4（估） |

打死几倍血按战斗秒（通关计时，大招时停也停），启动轴算在内。

## ② 好不好打

| 轴 | 高手（晚 3 帧） | 熟练（6） | 普通（10） | 熟练比基准 | 每轮 | 决策点 / 分 | 切人 / 分 | 抢帧 ! | 空中切人 / 轮 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| jys-5r18z | −5.6% | −11.8% | −18.3% | 基准 | 25.3 秒 | 83 | 14.2 | 0 | 0 |
| jys-5r18z-尤诺快开大 | −3.3% | −9.9% | −16.6% | +2.1% | 25.1 秒 | 84 | 14.3 | 1 | 0 |
| jys-轮椅 | −4.8% | −10.1% | −17.3% | −0.8% | 27.7 秒 | 69 | 6.5 | 0 | 0 |
| alm-爱琳莫 | −5.0% | −9.6% | −15.9% | +15.1% | 25.0 秒 | 72 | 12.0 | 0 | 0 |
| alm-爱琳守 | −6.1% | −10.9% | −16.8% | −12.6% | 26.2 秒 | 66 | 16.0 | 0 | 0 |
| xin-team-r5-按套路重排-心补EQ | −5.3% | −9.5% | −16.3% | −10.4% | 25.9 秒 | 97 | 16.2 | 0 | 1 |
| m0-video-eq | +0.5% | −2.4% | −8.1% | −43.5% | 25.0 秒 | 77 | 16.8 | 0 | 0 |

手速档：每个决策点（切人、不是连段后续的出招）在合法之后固定晚这一档的平均帧数，比零帧掉多少（假设 hand-speed）。

## ③ 养成门槛

"5 星 0 链 1 精"：5 星角色降到 0 链、5 星武器降到精炼 1，4 星不动。共鸣效率的"约几条副词条"按副词条各档平均（9.6% 一条），是不靠主词条要额外堆的量。

- **jys-5r18z**：5 星 0 链 1 精 −1.6%（守岸人 1 链 → 0 链）。共鸣效率 景燃 110.4%，约 1.1 条副词条（现在 131.6%）；尤诺 115.5%，约 1.6 条副词条（现在 112.4%）；守岸人 164.6%，约 6.7 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 264.6%）。单项降档：守岸人 1 链 → 0 链 −1.6%
- **jys-5r18z-尤诺快开大**：5 星 0 链 1 精 −1.7%（守岸人 1 链 → 0 链）。共鸣效率 景燃 110.4%，约 1.1 条副词条（现在 131.6%）；尤诺 114.7%，约 1.5 条副词条（现在 112.4%）；守岸人 164.6%，约 6.7 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 264.6%）。单项降档：守岸人 1 链 → 0 链 −1.7%
- **jys-轮椅**：5 星 0 链 1 精 −0.7%（守岸人 1 链 → 0 链）。共鸣效率 景燃 109.4%，约 1.0 条副词条（现在 131.6%）；尤诺 118.5%，约 1.9 条副词条（现在 112.4%）；守岸人 162.7%，约 6.5 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 264.6%）。单项降档：守岸人 1 链 → 0 链 −0.7%
- **alm-爱琳莫**：5 星 0 链 1 精 −2.2%（停驻之烟 精炼 5 → 1）。共鸣效率 爱弥斯 108.6%，约 0.9 条副词条（现在 126.8%）；琳奈 不用堆（现在 134.0%）；莫宁 168.3%，约 5.0 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 271.8%）。单项降档：琳奈 停驻之烟 精炼 5 → 1 −2.2%；莫宁 异响空灵 精炼 5 → 1 ±0.0%
- **alm-爱琳守**：5 星 0 链 1 精 −2.6%（停驻之烟 精炼 5 → 1、守岸人 1 链 → 0 链）。共鸣效率 爱弥斯 107.5%，约 0.8 条副词条（现在 126.8%）；琳奈 不用堆（现在 134.0%）；守岸人 159.3%，约 6.2 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 264.6%）。单项降档：琳奈 停驻之烟 精炼 5 → 1 −2.1%；守岸人 1 链 → 0 链 −0.6%
- **xin-team-r5-按套路重排-心补EQ**：5 星 0 链 1 精 ±0.0%（雷主·男 1 链 → 0 链）。共鸣效率 心 不用堆（现在 109.2%）；雷主·男 129.2%，约 1.7 条副词条（现在 142.8%）；卜灵 132.7%，约 3.4 条副词条（现在 225.8%）。单项降档：雷主·男 1 链 → 0 链 ±0.0%；卜灵 6 链 → 5 链 −3.1%；卜灵 奇幻变奏 精炼 5 → 1 跑不通（comboBroken）
- **m0-video-eq**：5 星 0 链 1 精 跑不通（comboBroken）（千古洑流 精炼 5 → 1、维里奈 3 链 → 0 链）。共鸣效率 椿 不用堆（现在 153.2%）；散华 不用堆（现在 170.2%）；维里奈 179.7%，约 8.3 条副词条（一件声骸最多一条，超过 5 条要靠共鸣效率主词条）（现在 265.8%）。单项降档：椿 千古洑流 精炼 5 → 1 −3.1%；散华 6 链 → 5 链 −5.9%；散华 行进序曲 精炼 5 → 1 ±0.0%；维里奈 3 链 → 2 链 ±0.0%；维里奈 奇幻变奏 精炼 5 → 1 ±0.0%

## ④ 靠不靠得住

- **jys-5r18z**：碰到的假设 def-no-floor、wait-settled、switch-ends-stop、echo-input-priority、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess、stat-scaling-static；翻过来变得最多：echo-input-priority（rules.echoInputPriority = false）−5.7%
- **jys-5r18z-尤诺快开大**：碰到的假设 def-no-floor、wait-settled、switch-ends-stop、echo-input-priority、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess、stat-scaling-static；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−3.7%
- **jys-轮椅**：碰到的假设 def-no-floor、wait-settled、switch-ends-stop、echo-input-priority、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess、stat-scaling-static；翻过来变得最多：echo-input-priority（rules.echoInputPriority = false）−6.8%
- **alm-爱琳莫**：碰到的假设 def-no-floor、wait-settled、resonance-rules、track-no-consume、switch-ends-stop、echo-input-priority、dilation-rules、summon-clock、white-bar、tunability-base、module-guess、stat-scaling-static；翻过来变得最多：track-no-consume（rules.trackNoConsume = false）−4.0%
- **alm-爱琳守**：碰到的假设 def-no-floor、wait-settled、resonance-rules、track-no-consume、switch-ends-stop、echo-input-priority、dilation-rules、summon-clock、white-bar、tunability-base、data-guess、module-guess、stat-scaling-static；翻过来变得最多：resonance-rules（rules.interferenceFrames = 300）+11.0%
- **xin-team-r5-按套路重排-心补EQ**：碰到的假设 effect-tick、effect-owner、wait-settled、ult-no-switch、switch-ends-stop、echo-input-priority、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、module-guess；翻过来变得最多：forte-keep-on-switch（rules.forteKeepOnSwitch = false）跑不通
- **m0-video-eq**：碰到的假设 wait-settled、echo-input-priority、dilation-rules、summon-clock、white-bar、tune-break-auto、tunability-base、data-guess、burst-release；翻过来变得最多：tune-break-auto（options.tuneBreak = off）−7.2%

共 313 次仿真，105 秒。
