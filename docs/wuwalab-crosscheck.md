# 与 WuwaLAB 的动作数据核对

由 `pnpm crosscheck:wuwalab --md …` 生成；数据 20261019。★ = 现有场景的轴里用到的动作。WuwaLAB 不是原包真值（有作者实测），对不上的是线索。

143 个有伤害的 WuwaLAB 动作，按倍率对上 111 个，其中比的几项（命中帧 ±2、时停、切人、冷却、能量、协奏、优先级）都一致的 48 个。
## 读法（2026-10-22 手写，重跑时保留这一节）

WuwaLAB（api.wuwalab.com）是社区站。数据里有原包导出的部分，也有作者实测的部分，**不是原包真值**；它的优先级时间线、帧数的写法和 xlsx 很像，多数一致的地方可能同源。所以这里对不上的是线索，要回 xlsx 或进游戏查，不直接改数据。

两边的帧数口径不同：
- **WuwaLAB 的帧是实际经过的帧**，含每次命中的顿帧，所以越往后的那一下差得越多（椿 E2：0、+1、+3、+6）。
- **我们的帧是动作的局部帧**，顿帧由内核另加。
- 比对时要么用仿真跑出来的世界帧，要么允许几帧的累积差。
- WuwaLAB 的 `total_frames` 大致对应我们的派生帧（下一招最早能接的时刻），不是结束帧，两边的"结束"不直接比。

**据此改了的**
1. **雷主大招的全局时停**：xlsx 有"大招-全局时停"这一行（224 帧），类型格空着，装配时丢了。已按行名推断补上（flag `dilationTypeGuess`）。心队的数全部重算，见 xin-confirm §6。
2. **大招动画期间不能切人**：WuwaLAB 的大招都是 no_swap 0、只记 time_stop。现在调度器另外挡住全局时停期间的切人。
3. **椿 E2 的落地段**：xlsx 里最后一下从落地算，原来没后移，E2 第 35 帧就结束、第 4 下被丢了。现在按第 58 帧落地后移，仿真里 5 下在世界帧 14 / 25 / 33 / 64 / 73、共 99 帧；WuwaLAB 是 14 / 24 / 32 / 63 / 71、96 帧。M0 的数全部重算，见 m0-conclusions §0。
4. 装配加了 flag `landingUnshifted`：有"下落"行、后面却没写落地偏移的都标出来。六个角色还有 13 处，轴里用到的只有心应世 E。

**还没改、留作线索的**
- **心应世 E**（C6、C8 万阙垂天之后用到）：同样是落地段没后移，但两边对不上——xlsx 的"E-下落"在第 84 帧，WuwaLAB 第 69 帧就有落地那一下、总帧 95。可能是版本不同或实测口径不同，要进游戏量。
- **协奏**有几处对不上（有的可能是"起手即得"算在哪个动作上的差别，要逐个看）：
  - 照世·增幅强化重击：WuwaLAB 20 / 我们 0；
  - 照世·强化E：33 / 13；
  - 卜灵雷山小过：0 / 15；
  - 维里奈强化空中A1、A2：4.5 / 16.5；
  - 雷主强化E（长按）：−42 / 18。
- 空中动作的命中帧差一个固定值（椿、散华、维里奈、心的空中攻击），同样是落地段（`landingUnshifted`），轴里没用到。

## 对这个项目有什么用

1. **帧数的第二来源**：这是目前最有用的一点。解包里没有逐帧数据，帧数原来只有 xlsx 一个来源。WuwaLAB 给了第二个来源（有的是实测），两边一致的地方可以放心，不一致的地方就是要查的。这一轮靠它查出两处真错误：雷主大招的时停、椿 E2 的落地段。分别让心队稳态低估约 12%、M0 视频轴高估约 4%。
2. **给推断的值找旁证**：它的 no_swap、time_stop 让我们看清"大招切人锁"其实是动画时停。一条原来以为影响大、要进游戏测的假设，就这样关掉了，你也少测三项。
3. **让验证更省你的时间**：先拿它把大部分动作对一遍，只把对不上、又在轴里用到的几项交给你进游戏量（现在是 C7 椿 E2、心应世 E），而不是逐个动作都去测。
4. **加新角色时省事**：第三支队伍写模块时，先跑 `pnpm crosscheck:wuwalab`，落地段、时停、冷却这类容易漏的地方会直接冒出来（要先在 `src/cli/wuwalab.ts` 的 SLUG 里补上角色）。
5. **局限**：
   - 它不是原包真值，有实测误差；
   - 帧数口径含顿帧；
   - buff、触发条件、共鸣回路这类机制它只有文字说明，帮不上；
   - 倍率我们和解包已经对过（2681/2681），它在倍率上没有额外价值；
   - 是第三方网站，接口可能变，所以数据缓存在本地（`data/raw/wuwalab/`），也不当作构建的必需输入。



## 椿（camellya）

| WuwaLAB 动作 | 我们 | 差在哪 |
|---|---|---|
| ★ Basic: Burgeoning 4 (Hold) | A4 | 命中帧（WuwaLAB − 我们）0 / 0 / 1 / 2 / 3 / 4 / 3 / 4 / 5 / 5 / 5 / 6 / 6 / 6 / 6 / 6 / 7 / 7 / 7 / 7；优先级 WuwaLAB 0:2 51:1 / 我们 0:2 |
| ★ Skill 1: Crimson Blossom | E1 | 命中帧（WuwaLAB − 我们）0 / 3；优先级 WuwaLAB 0:4 84:2 / 我们 0:4 75:2 |
| ★ Skill 2: Floral Ravage | E2 | 命中帧（WuwaLAB − 我们）0 / 1 / 3 / 6 / 8；优先级 WuwaLAB 0:4 95:2 / 我们 0:4 81:2 |
| ★ Forte: Perennial | E3 | 协奏 WuwaLAB -50 / 我们 -70；优先级 WuwaLAB 0:8 2:5 84:2 / 我们 0:8 60:5 78:2 |
| ★ Basic: Burgeoning 3 | A3 | 命中帧（WuwaLAB − 我们）0 / 3 / 4 |
| ★ Basic: Burgeoning 5 | A5（另 1 个同倍率） | 命中帧（WuwaLAB − 我们）1 / 3 / 6 / 6 |
| ★ Basic: Blazing Waltz (Hold) | 盛绽·A3循环聚怪 | 优先级 WuwaLAB 0:2 0:1 / 我们 0:2 |
| ★ Basic: Vining Waltz 4 | 盛绽·A4 | 命中帧（WuwaLAB − 我们）0 / 3 / 2 |
| ★ Forte: Ephemeral | E3 | 优先级 WuwaLAB 0:8 2:5 84:2 / 我们 0:8 60:5 78:2 |
| ★ Basic: Burgeoning 1 | A1 | 一致 |
| ★ Basic: Burgeoning 2 | A2（另 1 个同倍率） | 一致 |
| ★ Basic: Vining Waltz 1 | 盛绽·A1 | 一致 |
| ★ Basic: Vining Waltz 2 | 盛绽·A2 | 一致 |
| ★ Basic: Vining Waltz 3 | 盛绽·A3 | 一致 |
| ★ Liberation: Fervor Efflorescent | 大招 | 一致 |
| Basic: Burgeoning (Mid-Air) | 空中普攻 | 命中帧（WuwaLAB − 我们）24 / 9；优先级 WuwaLAB 0:6 47:5 62:2 / 我们 0:6 7:5 23:2 |
| Basic: Vining Waltz 2 (Dodge Counter) | 盛绽·A2-1D | 命中帧（WuwaLAB − 我们）0 / 3；优先级 WuwaLAB 0:2 40:1 / 我们 0:2 32:1 |
| Basic: Vining Ronde (Jump) | 盛绽·跳跃 | 命中帧（WuwaLAB − 我们）0 / 3 / 7；优先级 WuwaLAB 0:7 2:5 67:2 / 我们 0:7 55:2 |
| Intro: Everblooming | QTE | 优先级 WuwaLAB 0:11 77:1 / 我们 0:11 71:1 |
| Outro: Twining | — | 倍率 3.292 没对上 |
| Outro: Twining (Forte) | — | 倍率 3.292,4.590 没对上 |
| Basic: Burgeoning 3 (Dodge Counter) | A3-1D | 命中帧（WuwaLAB − 我们）0 / 3 / 4 |
| Basic: Burgeoning 4 | — | 倍率 0.247,0.247,0.247,0.247,0.247 没对上 |
| Heavy: Pruning | 重击（另 1 个同倍率） | 命中帧（WuwaLAB − 我们）0 / 1 / 3 |
| Tune Break Skill | 谐度破坏（另 1 个同倍率） | 命中帧（WuwaLAB − 我们）0 / 3 / 6 / 9 / 0 |

## 散华（sanhua）

| WuwaLAB 动作 | 我们 | 差在哪 |
|---|---|---|
| ★ Heavy: Detonate | 重击居合 | 命中帧（WuwaLAB − 我们）-5 / -4；切人 WuwaLAB no_swap 0、时停 0 / 我们锁到 30 |
| ★ Basic: Frigid Light 5 | A5 | 优先级 WuwaLAB 0:2 6:4 41:2 / 我们 0:2 6:4 33:2 |
| ★ Skill: Eternal Frost | E | 优先级 WuwaLAB 0:4 59:2 / 我们 0:4 60:2 |
| ★ Liberation: Glacial Gaze | 大招 | 优先级 WuwaLAB 0:10 93:0 / 我们 0:10 98:2 |
| ★ Basic: Frigid Light 1 | A1 | 一致 |
| ★ Basic: Frigid Light 2 | A2（另 1 个同倍率） | 一致 |
| ★ Basic: Frigid Light 3 | A3 | 一致 |
| ★ Basic: Frigid Light 4 | A4 | 一致 |
| Glacier | QTE | 命中帧（WuwaLAB − 我们）20；切人 WuwaLAB no_swap 0、时停 0 / 我们锁到 70；各击能量 WuwaLAB 7 / 我们 10；协奏 WuwaLAB 15 / 我们 10；优先级 WuwaLAB 0:0 / 我们 0:11 42:8 |
| Basic: Frigid Light (Mid-Air) | 空中普攻 | 命中帧（WuwaLAB − 我们）31；优先级 WuwaLAB 0:6 44:2 / 我们 0:6 13:2 |
| Intro: Freezing Thorns | QTE | 优先级 WuwaLAB 0:11 0:8 / 我们 0:11 42:8 |
| Basic: Frigid Light 2 (Dodge Counter) | 闪避反击 | 优先级 WuwaLAB 0:8 25:2 / 我们 0:8 23:2 |
| Ice Prism | — | 倍率 0.795 没对上 |
| Ice Thorn | — | 倍率 0.597 没对上 |
| Tune Break Skill | 谐度破坏 | 命中帧（WuwaLAB − 我们）0 / 3 / 6 / 9 / 0 |
| Heavy: Frigid Light | 重击 | 一致 |

## 维里奈（verina）

| WuwaLAB 动作 | 我们 | 差在哪 |
|---|---|---|
| ★ Basic: Cultivation 3 | A3（另 1 个同倍率） | 命中帧（WuwaLAB − 我们）4 / 3 |
| ★ Basic: Starflower Blooms 1 (Mid-Air) | 强化空中A1 | 协奏 WuwaLAB 4.53 / 我们 16.53 |
| ★ Basic: Starflower Blooms 2 (Mid-Air) | 强化空中A2 | 协奏 WuwaLAB 4.28 / 我们 16.28 |
| ★ Basic: Cultivation 1 | A1 | 一致 |
| ★ Basic: Cultivation 2 | A2 | 一致 |
| ★ Basic: Cultivation 4 | A4 | 一致 |
| ★ Basic: Cultivation 5 | A5 | 一致 |
| ★ Liberation: Arboreal Flourish | 大招 | 一致 |
| Intro: Verdant Growth | 重击-撞（另 1 个同倍率） | 命中帧（WuwaLAB − 我们）53；切人 WuwaLAB no_swap 83、时停 0 / 我们锁到 —；协奏 WuwaLAB 18 / 我们 8；优先级 WuwaLAB 0:11 52:4 76:1 / 我们 0:3 41:1 |
| Heavy: Cultivation (Mid-Air) | 空中重击 | 命中帧（WuwaLAB − 我们）23；优先级 WuwaLAB 0:6 29:3 / 我们 0:6 5:3 |
| Heavy: Starflower Blooms | 重击-强化撞1 | 命中帧（WuwaLAB − 我们）0 / 7；优先级 WuwaLAB 0:5 30:1 / 我们 0:3 34:1 |
| Basic: Cultivation 3 (Dodge Counter) | A3-闪避反击 | 优先级 WuwaLAB 0:8 18:2 / 我们 0:8 19:2 |
| Basic: Cultivation 3 (Mid-Air) | 空中A3 | 命中帧（WuwaLAB − 我们）-1 / -2 / -3 |
| Basic: Starflower Blooms 3 (Mid-Air) | — | 倍率 0.305,0.305,0.305 没对上 |
| Heavy: Cultivation | 重击-撞（另 1 个同倍率） | 优先级 WuwaLAB 0:5 24:1 / 我们 0:3 41:1 |
| Skill: Botany Experiment | — | 倍率 0.358,0.358,0.358,0.716 没对上 |
| Photosynthesis Mark | — | 倍率 0.100 没对上 |
| Photosynthesis Mark - S3 | — | 倍率 0.100 没对上 |
| Joyous Harvest - S6 | — | 倍率 0.100 没对上 |
| Basic: Cultivation 1 (Mid-Air) | 空中A1 | 一致 |
| Basic: Cultivation 2 (Mid-Air) | 空中A2 | 一致 |
| Tune Break Skill | 谐度破坏 | 一致 |

## 心（hsin）

| WuwaLAB 动作 | 我们 | 差在哪 |
|---|---|---|
| ★ Skill: Answering Form | E | 命中帧（WuwaLAB − 我们）12 / 12 / 21 / 17 / 11 / 5；优先级 WuwaLAB 0:4 45:6 95:2 / 我们 0:6 1:5 26:2 |
| ★ Forte: Answering Form - Realm Protector | 增幅强化重击 | 命中帧（WuwaLAB − 我们）0 / 1 / 1 / 0 / 0 / 0 / -1 / 4；优先级 WuwaLAB 0:11 122:2 / 我们 0:5 1:11 114:2 |
| ★ Forte: Illumining Form - Pillars Aligned | 照世·强化E | 切人 WuwaLAB no_swap 0、时停 30 / 我们锁到 153；协奏 WuwaLAB 33.17 / 我们 13.17 |
| ★ Basic: Answering Form 2 | A2 | 命中帧（WuwaLAB − 我们）0 / 0 / 7 / 7 |
| ★ Basic: Answering Form 4 | A4 | 命中帧（WuwaLAB − 我们）0 / 5 / 9 |
| ★ Basic: Illumining Form - Pillars Aligned 4 | 照世·强化A4 | 优先级 WuwaLAB 0:2 82:0 / 我们 0:2 |
| ★ Forte: Illumining Form - Stilling All Horizons | 照世·增幅强化重击 | 协奏 WuwaLAB 20 / 我们 0 |
| ★ Basic: Answering Form 1 | A1 | 一致 |
| ★ Basic: Answering Form 3 | A3 | 一致 |
| ★ Basic: Illumining Form 2 | 照世·A2 | 一致 |
| ★ Basic: Illumining Form 3 | 照世·A3 | 一致 |
| ★ Skill: Illumining Form | 照世·E | 一致 |
| ★ Basic: Illumining Form - Pillars Aligned 1 | 照世·强化A1 | 一致 |
| ★ Basic: Illumining Form - Pillars Aligned 2 | 照世·强化A2 | 一致 |
| ★ Basic: Illumining Form - Pillars Aligned 3 | 照世·强化A3 | 一致 |
| ★ Liberation: Pillars Across Heaven | 照世·大招 | 一致 |
| Intro: Answering Form - Unison | 重击（另 1 个同倍率） | 切人 WuwaLAB no_swap 44、时停 0 / 我们锁到 —；各击能量 WuwaLAB 7.5 / 我们 1.86；协奏 WuwaLAB 13 / 我们 3；优先级 WuwaLAB 0:11 44:2 / 我们 0:2 |
| Intro: Illumining Form - Electro Flare | 照世·QTE | 命中帧（WuwaLAB − 我们）-12 / -12 / -12 / -12 / -12 / -12 / -13 / -13 / -12 / -13；切人 WuwaLAB no_swap 91、时停 0 / 我们锁到 105；优先级 WuwaLAB 0:11 98:2 / 我们 0:11 104:2 |
| Basic: Illumining Form (Mid-Air) | 照世·空中攻击 | 命中帧（WuwaLAB − 我们）29 / 29；冷却 WuwaLAB 90 / 我们 —；优先级 WuwaLAB 0:6 29:5 53:2 / 我们 0:6 1:5 |
| Outro: Herself a Thousand Lanterns | 照世·延奏-伤害 | 命中帧（WuwaLAB − 我们）-4 / -5；协奏 WuwaLAB -100 / 我们 0 |
| Basic: Answering Form (Mid-Air) | 空中重击派生（另 1 个同倍率） | 命中帧（WuwaLAB − 我们）38；优先级 WuwaLAB 0:6 38:5 58:2 / 我们 0:6 1:5 20:2 |
| Forte: Answering Form - Realm Wanderer | 强化重击 | 命中帧（WuwaLAB − 我们）0 / 1 / 1 / 0 / 0 / 0 / -1 / 4；优先级 WuwaLAB 0:11 122:2 / 我们 0:5 1:11 114:2 |
| Intro: Illumining Form - Manifold Unison | 照世·QTE-响应同奏（另 1 个同倍率） | 切人 WuwaLAB no_swap 151、时停 30 / 我们锁到 45 |
| Outro: Herself a Thousand Lanterns (Unison) | 照世·延奏-伤害 | 命中帧（WuwaLAB − 我们）-4 / -5 |
| Basic: Answering Form 2 (Dodge Counter) | A2-1D | 命中帧（WuwaLAB − 我们）0 / 0 / 3 / 3 |
| Basic: Illumining Form 1 | — | 倍率 0.126,0.126,0.377 没对上 |
| Basic: Illumining Form 2 (Dodge Counter) | 照世·重击-前置D | 优先级 WuwaLAB 0:2 33:2 / 我们 0:2 |
| Basic: Illumining Form - Modular Heartlock | — | 倍率 0.209,0.209 没对上 |
| Basic: Illumining Form (Upward Cut) | 照世·上挑 | 优先级 WuwaLAB 0:6 38:2 / 我们 0:6 36:2 |
| Basic: Illumining Form - Pillars Aligned 2 (Dodge Counter) | 照世·强化A2-闪避反击 | 优先级 WuwaLAB 0:2 26:2 / 我们 0:2 |
| Forte: Illumining Form - Beholding All Horizons | 照世·强化重击 | 协奏 WuwaLAB 20 / 我们 0 |
| Intro: Answering Form - Electro Flare | QTE | 一致 |
| Intro: Answering Form - Manifold Unison | QTE-响应同奏（另 1 个同倍率） | 一致 |
| Intro: Illumining Form - Unison | 照世·QTE-同奏模态 | 一致 |
| Heavy: Answering Form | 重击（另 1 个同倍率） | 一致 |
| Heavy: Illumining Form | 照世·重击 | 一致 |
| Liberation: Soaring Pillar | 协同 | 一致 |
| Tune Break Skill | 谐度破坏（另 1 个同倍率） | 一致 |

## 雷主·男（roverelectro）

| WuwaLAB 动作 | 我们 | 差在哪 |
|---|---|---|
| ★ Basic: Deterrence 4 | A4 | 命中帧（WuwaLAB − 我们）0 / 3 |
| ★ Skill 2: Overshock (Hold) | 强化E | 协奏 WuwaLAB -41.67 / 我们 18.33 |
| ★ Basic: Deterrence 1 | A1 | 一致 |
| ★ Basic: Deterrence 2 | A2 | 一致 |
| ★ Skill 1: Thunderclap | E | 一致 |
| ★ Skill 2: Overshock | 强化E | 一致 |
| ★ Liberation: Ultimate Tactics | 大招 | 一致 |
| Basic: Deterrence (Mid-Air) | 空中攻击 | 命中帧（WuwaLAB − 我们）34；优先级 WuwaLAB 0:6 45:2 / 我们 0:6 1:5 |
| Basic: Deterrence 2 (Dodge Counter) | A2-1D | 优先级 WuwaLAB 0:8 / 我们 0:8 1:2 |
| Basic: Deterrence 3 | — | 倍率 0.133,0.133,0.133,0.133,0.133,0.133,0.133 没对上 |
| Basic: Repel | A4-E派生下落 | 命中帧（WuwaLAB − 我们）28 / 31 |
| Skill Spectro: Thrum of All Sounds Hunt | — | 倍率 0.398,0.991 没对上 |
| Skill Spectro: Thrum of All Sounds 1 | — | 倍率 0.398,0.398,0.398,0.491,0.491,0.654 没对上 |
| Skill Spectro: Thrum of All Sounds 2 | — | 倍率 0.398,0.398,1.021,1.531 没对上 |
| Skill Havoc: Thrum of All Sounds 1 | — | 倍率 0.150,0.150,0.150,0.398,0.398,0.398,0.398,1.048 没对上 |
| Skill Havoc: Thrum of All Sounds 2 | — | 倍率 0.138,0.138,0.138,0.138,0.398,0.398,0.398,0.398,0.398,0.830 没对上 |
| Skill Havoc: Thrum of All Sounds 3 | — | 倍率 0.208,0.208,0.208,0.208,0.398,0.398,0.398,0.398,0.398,0.398,0.625,0.625 没对上 |
| Skill Havoc: Thrum of All Sounds 1 (Mid-Air) | — | 倍率 0.398,0.506 没对上 |
| Skill Havoc: Thrum of All Sounds 2 (Mid-Air) | — | 倍率 0.398,0.638 没对上 |
| Skill Havoc: Thrum of All Sounds 3 (Mid-Air) | — | 倍率 0.398,0.398,0.398,0.915,0.915,0.943 没对上 |
| Skill Aero: Thrum of All Sounds (Hold) | — | 倍率 0.398,1.581 没对上 |
| Skill Aero: Thrum of All Sounds 1 (Mid-Air) | — | 倍率 0.398,0.846 没对上 |
| Skill Aero: Thrum of All Sounds 2 (Mid-Air) | — | 倍率 0.398,0.974 没对上 |
| Skill Aero: Thrum of All Sounds (Mid-Air) | — | 倍率 0.398,2.825 没对上 |
| Skill: Thrum of All Sounds - Silencing Blade | — | 倍率 0.398,0.398,0.398,0.398,0.398,0.398,0.471,0.471,0.471,0.471,0.471,2.353 没对上 |
| Tune Break Skill | 谐度破坏 | 命中帧（WuwaLAB − 我们）0 / -2 / -3 / -5 / 0 |
| Intro: Thunderous Fury | QTE | 一致 |
| Basic: Riposte Strike | 重击 | 一致 |

## 卜灵（buling）

| WuwaLAB 动作 | 我们 | 差在哪 |
|---|---|---|
| ★ Heavy: Thunder Over Mountain | 重击-震艮前置 | 协奏 WuwaLAB 0 / 我们 15；优先级 WuwaLAB 0:3 70:2 / 我们 0:3 60:2 |
| ★ Skill: In Shadow Thunder Stirs | E | 优先级 WuwaLAB 0:4 47:2 / 我们 0:4 38:2 |
| ★ Basic: Hexagram Calls, Lightning Falls 2 | A2 | 一致 |
| ★ Basic: Hexagram Calls, Lightning Falls (Mid-Air) | 空中攻击 | 一致 |
| Heavy: Mountain Over Thunder | 重击 | 协奏 WuwaLAB 0 / 我们 15；优先级 WuwaLAB 0:3 70:2 / 我们 0:3 60:2 |
| Basic: Hexagram Calls, Lightning Falls 3 | — | 倍率 0.235,0.235 没对上 |
| Basic: Hexagram Calls, Lightning Falls 3 (Dodge Counter) | — | 倍率 0.235,0.235 没对上 |
| Liberation: Flashing Thunder Spell | — | 倍率 3.579 没对上 |
| Liberation: Flashing Thunder Spell - Harmony | — | 倍率 5.368 没对上 |
| Five Thunders Spell Array | — | 倍率 0.199,0.199,0.199,0.199,0.199,0.199,0.199,0.199,0.199,0.199,0.199,0.199 没对上 |
| Intro: Summon and Smite | QTE | 一致 |
| Basic: Hexagram Calls, Lightning Falls 1 | A1 | 一致 |
| Basic: Hexagram Calls, Lightning Falls 4 | A4（另 1 个同倍率） | 一致 |
| Tune Break Skill | 谐度破坏 | 一致 |

