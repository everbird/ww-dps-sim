# 项目审查与洞察：现状、建议，与椰果 CoconutCore 的对比（2026-11-18）

- **日期**：2026-11-18 审查，2026-11-20 整理成本文
- **作者**：Claude（Opus 5.5，经 pi），根据一次会话里的审查整理
- **基线**：本仓库 `main` `99c1020`（PR #142 合入后，DD-01～DD-10 全部落地；到 2026-11-20 main 还在这个提交）；装配数据 `20261019`
- **对比对象**：椰果工具箱（d4rkOfficial/wuwa-afyg-tool）`main` `441852a`（2026-11-17）。CoconutCore 是 2026-11-16、17 从工具箱里抽出来的（`core-v0.1.0`），重点看它的 `docs/coconut-core.md` 与 `src/coconut-core/`
- **范围**：这份只是审查意见，没有改代码。2026-11-08 的三方总体评审（`docs/20261111-coordinate-review/`）讨论的是底座该往哪走；这份是在底座落地之后看现状。

---

## 0. 结论

- **底座已经扎实，现在的瓶颈在游戏内证据。** 类型检查和测试全部通过，录像剖析里切人时刻差在 0.2 秒以内，跳字差在 0.05% 以内。但规则台账 26 条命题里**证实的是 0 条**（22 条未验证），68 个观测点有 42 个还空着。记证据、判证据的工具已经跑在证据前面了。路线图写的下一步也是"游戏侧的证据"，这一步该做了（§2.1）。
- **工程上有两个风险。**
  - CI 没有数据，约 430 条依赖数据的用例在 CI 里全部跳过，其中包括场景回归（§2.2）。
  - 文档的维护成本在吃掉代理的上下文和你的时间（§2.3）。
- **CoconutCore 和本项目是互补的。** 它算"这一段吃了哪些 buff、伤害多少"，本项目算"哪一帧吃哪些 buff"。它要调用方给的 `activated_buffs`，正是本项目每一下命中已经算出来的东西。它有几处写法值得借，但不建议拿它替换 `formula.ts`（§4.3）。
- 我直接调用它的内核，复现了几个公开 API 层面的问题（§4.2，脚本见附录 B）：
  - `hits` 的文档和实现对不上；
  - 拼错乘子的输入名不报错，暴击区会变成 0.5；
  - 不可覆盖的面板百分比写 `override` 后，这部分攻击加成丢失；
  - 好几种输入会被静默忽略。

---

## 1. 怎么核实的

| 项 | 结果 |
|---|---|
| `pnpm check` | 通过（31 秒） |
| `pnpm test`（带数据） | 76 个文件，1013 条通过、41 条 todo；在 2 核机器上墙钟 6 分 8 秒 |
| `pnpm test`（不带数据，也就是 CI 的情况） | 61 个文件通过、15 个文件整个跳过，586 条用例，54 秒 |
| `pnpm test:py` | 71 条通过，0.8 秒 |
| 规模 | `src` 约 2.3 万行（`src/engine` 1.07 万行、36 个文件），测试 1.4 万行，`docs` 97 篇 3.4 MB（其中 `20261111-coordinate-review` 占 1.7 MB） |
| 台账、观测 | `docs/proposition-ledger.md` 26 条命题：未验证 22、暂定 3、分不清 1；`docs/calibration/points.yaml` 68 个观测点，42 个 `game: null` |
| 椰果 | `src/coconut-core` 约 900 行，`src/coconut-config` 约 780 行；用本仓库的 tsx 直接 import 它的内核跑探针（附录 B） |

带数据的测试是临时软链主工作区的 `data/generated`、`node_modules` 跑的，跑完已删除。

---

## 2. 本项目：洞察与建议（按优先级）

### 2.1 下一步该做游戏内实验

- `docs/verify-guide.md` 里 A、B、C 三组约 22 项实验，按标注的时长加起来约 1 小时游戏时间。
  - A1、A2（读两张面板，加开场几下跳字，各约 5 分钟）10-21 就写好了，到现在还是空的。
  - 这两项能一次验证"装配 → 静态面板 → 公式"整条链路，是成本最低、信息量最大的。
- 建议安排一次集中实验：
  - 先做 A1、A2；
  - 再按 `pnpm sensitivity` 的结果，挑能改变结论的 B、C 项；
  - 最后做已经登记了预测的 C8（`docs/evidence/echo-input-priority.2026-11.yaml`）。
- 如果真正缺的是进游戏的时间，就把力气花在**降低读数成本**上：跳字、协奏环、技能栏冷却现在都是逐帧手读，半自动化以后，每小时能拿到的证据会比再加一个分析命令多得多。
- 椰果有一种"棘轮"做法：基线只许降、不许升。可以拿来管还没证实的东西，比如 `check:data --flags` 里没处理的条数、"未验证而且敏感度大"的命题数，都只许降，新增的要显式登记。

### 2.2 CI 的盲区和测试回路

- CI 不带 xlsx 和构建产物，15 个依赖数据的测试文件（包括场景回归快照 `tests/scenarios.test.ts`）在 CI 里整个跳过，约 430 条用例。
  - 所以 **CI 是绿的，不代表任何场景的结果没变**。
  - 现在只靠"每次任务结束本地跑全量"这条约定，几个代理同时提 PR 时最容易在这里漏掉。
- 本地全量 6 分钟，其中最慢的 15 个文件占了 79% 的时间（附录 A）；`portable` 和 `scenarios` 两个文件各自把 30 个场景完整跑了一遍。
- 建议：
  - 全量测试放到 VPS 上的 self-hosted runner 跑。数据本来就在那台机器上；只用 `push` 触发，fork 的推送触发不了。这样 PR 上直接能看到全量结果。
  - 本地日常跑一个 `test:fast`：不依赖数据的部分约 54 秒，再加上和这次改动相关的场景。
  - 另一个办法是把 conformance 的摘要（只有哈希，不含数据）提交进仓库，PR 的 diff 就能直接看出改动了哪些场景的输出。

### 2.3 文档：从按时间记的实验笔记，改成"讲现状的参考手册 + 决策记录"

- AGENTS.md 有 100 KB，大约 3 万 token，每个会话一开始都要读进去。
  - 其中 73 KB 是 61 条"与设计文档的差异"，有 56 条写着"要并回的"。
  - 也就是说，TD 文档落后代码大约 50 条决定。
- 手写的结论文档在过期：
  - `m0-conclusions.md` 开头叠着"本文旧数字不覆盖那份结论""这里的数没重算""下面各节的数是修之前的"几层说明；
  - AGENTS.md 第 21、37、43、49 条都写着"结论文档里的数是改之前的"。
- 评审过程稿 `20261111-coordinate-review` 有 1.7 MB，占了 docs 的一半，代理搜 docs 时会被大量过程稿干扰。
- 建议：
  - **AGENTS.md 压到 10 KB 以内**，只留原型期原则、目录、命令、完成检查、约定和文档地图（一篇一行）。61 条变更记录原样挪到 `docs/decisions/`（或 CHANGELOG），每条标上有没有并回。
  - 并回的欠账可以不硬还：像机制设计那样，把多数 TD 冻结，以代码、测试、生成的文档和决策记录为准。只继续维护讲语义的几份：总设计 §4、TD-03、TD-04。
  - **结论文档改成命令生成**（scorecard、sensitivity 已经有 `--md`），每一节标上 runId 和数据版本。所有生成的文档都加一个 `--check` 模式，并入 `pnpm check`。椰果的 `tools.md`、`components.md` 就是这样防止过期的。
  - 借椰果 AGENTS.md 的一条规矩：**文档和注释只写现状，不写"原来……""不再……"**。现在很多文档和注释按时间叙述，"原来 X、现在 Y"这种写法很容易让代理照着旧做法去写代码。历史交给 git 和决策记录。
  - 过程稿归档到 `docs/archive/`，再加一个 `.ignore` 文件，让 rg 搜索时跳过这个目录。
  - 把散在 61 条里的经验整理成一页"加一个角色 / 一支队"的检查清单，包括 `shiftRows`、优先级、`spawnFromNote`、dmg-join、`--strict` 名单、`check:data --flags`、对照场景、conformance。椰果的 `docs/adding-calculation-feature.md` 可以当样板。
  - README 还写着 M1、M2"待接入"，顺手改掉。

### 2.4 引擎体量、Rust 移植、角色逻辑进了引擎

- 总设计 T12 估计"引擎约 3 千行"，现在已经是 1.07 万行。
  - 其中查询、诊断、台账（`query`、`probe`、`diagnostics`、`wire`、`snapshot`、`propositions`、`assumptions`、`rule-points`）约 4.6 千行，而且诊断插桩已经织进了执行核心。
  - 单次仿真是毫秒级，轴搜索跑几百次也就是秒级，T12 写的重审条件还远没到。
  - 建议明确写下"暂不移植 Rust"。成本低的写法约束继续保留（`num.ts`、显式写输出顺序），但不要再让"以后好移植"去驱动设计。真要移植时只移执行核心，查询和诊断留在 TS 里读日志和快照。
- 角色相关的逻辑已经写进了引擎：
  - `simulate.ts` 里有 `char.心.forteKeep`、`char.心.summonAsChar`、`char.爱弥斯.trackNoConsume`；
  - `rule-points.ts` 里有 `CONCERTO_TIMING_POINTS = { 卜灵: … }`。
  - 现在每加一条角色相关的命题都要改引擎。可以改成角色模块在 `defineCharacter` 里声明自己的规则判定点，装配时再登记。

### 2.5 `formula.ts` 的重复和缺的两个乘区

- `hurt` 和 `abnormalHit` 整段重复了同一串乘区计算（防御、抗性、减免、特殊、加深、最终），`computeTuneBreak` 又抄了一部分。
  - 可以抽一个计算公共因子的函数。
  - 每个公式里仍然显式写出乘法顺序，这样和 xlsx 依然能逐位一致（TD-03 §1）。
- 3.0 的集谐区和 3.7 的同奏区本项目还没有（AGENTS.md 第 16 条"集谐没建"，心的同奏模态也没写）。
  - 椰果已经实现了：集谐区 `1 + 0.0012 × 谐破增幅 × 干涉层数`，同奏区 `1 + 0.03 × 层数`，排在谐度区之后、最终伤害之前。
  - 哪天要做，可以拿这两条当候选读法，走证据闭环去验证。

### 2.6 一个只有仿真能算出来的分析：buff 的静态价值和动态价值

- 现在能看 buff 覆盖率，但看不到"这个 buff 值多少伤害"。可以分两种算：
  - **静态价值**：对窗口里每一下命中，去掉这个 buff 重算伤害公式，求差值。
    - DD-07 的 `hitInputs` 已经有每一下命中的 buff 和取值，几百下乘二十几个 buff，毫秒级就能算完。
    - 这就是椰果"逐 Buff 贡献"（`trace: true`）的算法。想要各 buff 贡献能直接相加，可以用 Shapley，或者按乘区取对数分摊。
  - **动态价值**：去掉这个 buff，整局重新仿真。
- **两者之差，就是这个 buff 通过时间轴带来的价值**：回能、协奏、冷却、叠层、切人时机。拉表工具原理上算不出这个，正好是本项目和它们的区别所在。

---

## 3. 和椰果的对比

| | ww-dps-sim | 椰果工具箱 |
|---|---|---|
| 定位 | 个人研究：机制、轴、配装的结论 | 社区产品：拉表、排轴、配装对比、工坊分享、AI 助手、库街区同步 |
| 时间与资源 | 逐帧推进，三种时钟；能量、协奏、冷却、切人锁全程模拟 | 没有帧，也没有能量；DPS 的分母来自手放的参考线 |
| buff 是否生效 | 由仿真推出来（触发、层数、持续、前台） | 用户逐段勾选；条件系统（链阶、伤害名正则、面板比较、依赖的不动点）写在应用层 |
| 公式 | 照 xlsx 数组公式逐位写；加深、最终按类别号分区，类间相乘；暴击和不暴击各自 ceil 后加权 | 可注册的乘子链；加深、易伤、终伤、特殊几个区由用户归类；期望值最后整体 round |
| 验证 | xlsx golden、扰动对拍、conformance、模糊测试、零干扰、录像跳字 | 自身快照、两条计算路径对账 |
| 工程闸门 | tsc + svelte-check、vitest、分层测试 | prettier、eslint（函数式规则）、9 个静态闸门、棘轮、生成文档带 `--check` |
| 文档 | 97 篇，3.4 MB，按时间记 | 10 篇，约 3800 行，只写现状 |

两边的长处正好互补。椰果在用静态规则去近似时间效应，它的 `docs/buff-engine.md` 自己写着："真正的按上限截断需要引擎侧 clamp，数据模型目前没有，请按上限数量配置产层源"。这正是仿真本来就能处理的。反过来，椰果的产品化程度和工程闸门值得本项目学。

---

## 4. CoconutCore 与 coconut-core.md

### 4.1 做得好的

- 边界干净：只有 `new CoconutCore().init(config).compute(table)`，零依赖，内核约 900 行，单独发包，作者放弃了版权。
- `init` 时当场校验公式链：乘子必须已登记，顺序必须和注册顺序一致。
- 版本链 `v1_0 → v2_0 → v3_0 → v3_7` 把每一版加了哪个乘区写成了受类型检查的代码，比写在文档里可靠。
- 展示用的名字不进内核，结果里只有 id 和数值；`trace: true` 自带逐 buff 贡献。
- 文档短，结构清楚（版本链 → 安装 → 配置 → 输入 → 输出 → 口径），还配了一份"照着报错一步步填"的新增特性清单。

### 4.2 实测到的问题

复现脚本和输出见附录 B。

1. **`hits` 的文档和实现不一致。**
   - 文档说"倍率串描述单段"，但内核并不把主倍率乘以段数：`hits: 3` 和 `hits: 1` 算出来都是 1250，只有额外倍率被放大了。
   - 工具箱自己传进去的其实是各段倍率的合计（`calculation.store.svelte.ts` 的 `ratioValue: ratioSum * (hit.hits ?? 1)`）。
   - 第三方照着文档传单段倍率，会少算到 1/3。
2. **拼错的名字不报错。**
   - 我把乘子输入里的 `critDmg` 写成 `critDamage`，`init` 照常通过，暴击区从 1.25 变成 0.50，伤害直接减半。
   - `applyTo` 拼错、`activated_buffs` 引用不存在的 id、`refStat` 不存在，也都是静默地当 0 或直接跳过。
   - 建议 `init` 检查每个输入都能对应到已登记的作用、目标字段或常量，再提供一个严格模式。
3. **对不可覆盖的面板百分比写 `override` 时，这部分加成会丢。**
   - 这种情况会退化成相加，但发生在重算面板合计之后。结果是 `zones.atkPct = 20`，`total.atk` 仍然是 1000，这 20% 攻击在伤害里没有算进去。
   - 工具箱界面不会产出这种输入，但作为公开内核，第三方会踩到。
4. **取整方式和 xlsx 不同。**
   - 面板合计：椰果是 `base + round(flat + base × pct%)`，xlsx 是 `floor(base × (1 + pct)) + flat`。
   - 伤害：椰果对期望值整体 round，xlsx 是暴击、不暴击两支各自 ceil。
   - 通常只差末位或万分之几，但对不上逐位的跳字。
   - 易伤的处理也不一样：本项目把"受到伤害提高"当作负的减伤（`TargetDamageReduce`），和敌人减伤相加；椰果单独设一个易伤区相乘。两者同时出现时结果会分叉。本项目的敌人表目前没有自带减伤，遇到这种敌人时值得登记成命题。
5. **小问题：**
   - `StatRef.Upperlimit` 里的大写 U，以及 `damage_entries`、`activated_buffs` 这类蛇形命名混在驼峰 API 里。现在还是 0.1.0，改起来最便宜。
   - 配置包的安装地址是 `releases/latest/download/…-0.0.1.tgz`，版本号一升就会 404。
   - 贡献是用取整后的 `expected` 求差，小 buff 的贡献会被量化成 0；逐个摘除的贡献加起来也不等于总增量。文档都没提。
6. **"适合所有战斗二游"说得太满了。**
   - 内核里有 `critBase === 'coefficient'`、`only: 'panel'` 这种鸣潮特有的语义。
   - 乘子是 JS 闭包，所以配置是代码而不是数据，不能序列化，也不能跨语言用。
   - 文档还缺两样东西：一个带具体数字的完整例子（顺便可以当文档测试）；以及"哪些输入会被静默忽略"的说明。

### 4.3 对本项目意味着什么

- **不建议用 CoconutCore 替换 `formula.ts`。** `formula.ts` 已经是更小、更贴 xlsx 的纯内核；替换以后会失去和 xlsx 的逐位一致，也会失去按类别号分区的加深，以后移植时还要多处理一层闭包。
- 值得借的写法：
  - "公式 = 基值配方 + 有序乘子链"，正好对应 §2.5 的重复问题；
  - 初始化时把能静态检查的都检查掉（zod 和严格入口已经在做）；
  - 版本链，等哪天要复核旧版本的证据时再用。
- 导出成椰果工程的收益主要在社区：它的工程格式（buff 树、v1～v8 迁移）比 `GeneralTable` 复杂得多。如果想试，最便宜的一步是导出 `GeneralTable`，用它的内核和配置再算一遍，当作独立实现来对拍。这对椰果帮助更大；本项目已经有 xlsx golden，帮助有限。
- 真正能借力的是数据层：
  - 椰果工坊里按实体（角色、武器、声骸、套装）整理的 buff 集——每条落哪个区、数值多少、链阶条件——可以像 `pnpm crosscheck:wuwalab` 那样做一次核对，差异只当线索。数据形状和许可我都还没核实。
  - 椰果用库街区的 `akiBox/getRoleDetail` 直接拉角色装配，导入"当前装配"时可以少一层 OCR 误差（背包还是得扫描）。
- 机制设计 v0.2.9 §7B 里说"高抗档 `1/(1+5r)` 椰果所无"，这一条已经过时了：CoconutCore 的抗性区现在是 `1 / ((r + 0.2) × 5)`，与之相同。别处引用时注意。
- §4.2 的 1～3 条都能稳定复现。CoconutCore 11-16、17 才抽出来，还在 0.x，如果要给作者提 issue，现在改的成本最低。

---

## 5. 如果只做三件事

1. 用一个下午做 verify-guide 的 A1、A2，再加上敏感度最高的几项实验。
2. 全量测试放到 self-hosted runner 上跑（或者提交 conformance 摘要），本地日常改用 `test:fast`。
3. 给 AGENTS.md 瘦身；结论文档改成命令生成，并加上 `--check`。

## 6. 没细看的

网页 UI、Python 构建脚本、各角色模块的机制细节。

---

## 附录 A：测试耗时（带数据，2 核，按文件）

| 文件 | 耗时 | 用例 |
|---|---:|---:|
| `portable.test.ts` | 37.0 秒 | 32 |
| `snapshot.test.ts` | 33.6 秒 | 12 |
| `plan.test.ts` | 27.9 秒 | 8 |
| `candidates.test.ts` | 19.4 秒 | 15 |
| `insight.test.ts` | 15.7 秒 | 9 |
| `sample.test.ts` | 15.5 秒 | 9 |
| `web.test.ts` | 12.7 秒 | 10 |
| `query-cli.test.ts` | 12.6 秒 | 4 |
| `scenarios.test.ts` | 12.4 秒 | 30 |
| `summary-boundaries.test.ts` | 10.8 秒 | 14 |
| `scorecard.test.ts` | 10.5 秒 | 5 |
| `sensitivity.test.ts` | 9.4 秒 | 6 |
| `zero-interference.test.ts` | 8.6 秒 | 21 |
| `cards.test.ts` | 6.4 秒 | 6 |
| `goal.test.ts` | 6.1 秒 | 6 |

各文件耗时合计 302 秒，以上 15 个占 79%；其余 61 个文件合计 63 秒。

## 附录 B：CoconutCore 的复现脚本与输出

CoconutCore 零依赖，用本仓库的 tsx 就能直接跑椰果仓库里的源码：

```bash
AFYG=<椰果仓库路径> node_modules/.bin/tsx probe.mts
```

```ts
// probe.mts —— CoconutCore 行为探针
const AFYG = process.env.AFYG ?? `${process.env.HOME}/workspace/ro/wuwa-afyg-tool`
const { CoconutCore } = await import(`${AFYG}/src/coconut-core/index.ts`)
const { defineFormula } = await import(`${AFYG}/src/coconut-core/formulas.ts`)

const actions = [
  { id: 'atkBase', side: 'character', combine: 'sum', panel: { base: 'atk' }, overridable: false, init: 0 },
  { id: 'atkFlat', side: 'character', combine: 'sum', panel: { flat: 'atk', total: 'atk' }, overridable: true, init: 0 },
  { id: 'atkPct', side: 'character', combine: 'sum', panel: { pct: 'atk' }, overridable: false, init: 0 },
  { id: 'critRate', side: 'character', combine: 'sum', overridable: true, init: 5 },
  { id: 'critDmg', side: 'character', combine: 'sum', overridable: true, init: 150 },
]
const critOf = (rate: number, dmg: number) => 1 + (Math.min(Math.max(rate, 0), 100) / 100) * (dmg / 100 - 1)
const crit = defineFormula({ id: 'crit', inputs: ['critRate', 'critDmg'] }, (r: any) => critOf(r.critRate, r.critDmg))
// 故意拼错一个输入名：critDamage（没有登记这个作用）
const critTypo = defineFormula({ id: 'critTypo', inputs: ['critRate', 'critDamage'] }, (r: any) => critOf(r.critRate, r.critDamage))

const mk = (mult: any) => new CoconutCore().init({
  actions, refSources: [], multipliers: [mult],
  formulas: [{ id: 'direct', base: { kind: 'panelStat' }, chain: [mult], critBase: 'panel' }],
})
// 白值攻击 1000、暴击率 5 + 45 = 50%、暴伤 150%
const base = { id: 'base', role: 'stat', effects: [{ applyTo: 'atkBase', value: '1000' }, { applyTo: 'critRate', value: '45' }] }
const table = (extra: any[], dmg: any = {}) => ({
  global_buffs: ['base'], buffs: [base, ...extra],
  damage_entries: [{ source: 's', damages: [{ value: '100%', activated_buffs: extra.map(b => b.id), element: 'x', formula: 'direct', ...dmg }] }],
})
const show = (label: string, r: any) =>
  console.log(label.padEnd(40), 'total.atk =', r.damages[0].panel.total.atk, ' zones.atkPct =', r.damages[0].panel.zones.atkPct, ' expected =', r.damages[0].expected)

const core = mk(crit)
show('① 没有 buff', core.compute(table([])))
show('② atkPct +20（add）', core.compute(table([{ id: 'b', effects: [{ applyTo: 'atkPct', value: '20' }] }])))
show('③ atkPct +20（override，不可覆盖）', core.compute(table([{ id: 'b', effects: [{ applyTo: 'atkPct', value: '20', write: 'override' }] }])))
show('④ applyTo 拼错（atkPtc）', core.compute(table([{ id: 'b', effects: [{ applyTo: 'atkPtc', value: '20' }] }])))
show('⑤ activated_buffs 引用不存在的 id', core.compute({ ...table([]), damage_entries: [{ source: 's', damages: [{ value: '100%', activated_buffs: ['nope'], element: 'x', formula: 'direct' }] }] }))
console.log('⑥ 乘子输入拼错：暴击区 crit =', core.compute(table([])).damages[0].multipliers[0].value.toFixed(4),
  ' critTypo =', mk(critTypo).compute(table([])).damages[0].multipliers[0].value.toFixed(4), '（init 没有报错）')
console.log('⑦ value 100%：hits 3 →', core.compute(table([], { hits: 3 })).damages[0].expected, ' hits 1 →', core.compute(table([])).damages[0].expected)
```

输出（椰果 `441852a`）：

```text
① 没有 buff                                total.atk = 1000  zones.atkPct = 0  expected = 1250
② atkPct +20（add）                        total.atk = 1200  zones.atkPct = 20  expected = 1500
③ atkPct +20（override，不可覆盖）              total.atk = 1000  zones.atkPct = 20  expected = 1250
④ applyTo 拼错（atkPtc）                     total.atk = 1000  zones.atkPct = 0  expected = 1250
⑤ activated_buffs 引用不存在的 id              total.atk = 1000  zones.atkPct = 0  expected = 1250
⑥ 乘子输入拼错：暴击区 crit = 1.2500  critTypo = 0.5000 （init 没有报错）
⑦ value 100%：hits 3 → 1250  hits 1 → 1250
```

读法：

- ② 是对照组，正常加 20% 攻击后 `total.atk = 1200`。
- ③ 的 `zones.atkPct` 已经是 20，但 `total.atk` 没变，伤害与 ① 相同（§4.2 第 3 条）。
- ④、⑤ 静默忽略（第 2 条）。
- ⑥ 拼错的输入读成 0，暴击区 `1 + 0.5 × (0 − 1) = 0.5`（第 2 条）。
- ⑦ 段数不放大主倍率（第 1 条）。
