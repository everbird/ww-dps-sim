# AGENTS.md —— 给编码代理（Claude Code、Codex、Antigravity…）的约定

鸣潮逐帧期望 DPS 仿真与配装择优工具。个人项目，原则：**实用、清晰、简单**。不追求工业级的安全性与一致性。

## 先读什么

设计文档都在 `docs/`，改代码前先读相关章节，并在代码注释与提交说明里引用章节号（如"TD-04 §4.2"）：

| 文档 | 管什么 |
|---|---|
| `wuwa-dps-engine-tech-design-v0.1.5.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、里程碑与进度 |
| `wuwa-dps-td01-data-dictionary-v0.1.4.md` | xlsx 每一列的含义与抽取规则、nanoka 数据、装配默认映射、角色模块的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.4.md` | 全部类型与 zod schema（类型一览，代码以仓库为准） |
| `wuwa-dps-td03-damage-formula-v0.1.1.md` | 伤害公式与乘区、golden 抽取 |
| `wuwa-dps-td04-sim-kernel-v0.1.2.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定、尾部 |
| `wuwa-dps-td05-switch-concerto-v0.1.md` | 切人、变奏 / 延奏、协奏清零、切人结束技能 |
| `wuwa-dps-td06-resources-v0.1.md` | 角色资源：大招能量分配与门槛、协奏时机、核心资源（敌人量表在 v0.2） |
| `wuwa-dps-td07-buff-system-v0.1.md` | buff 实例、作用对象、触发与事件队列、消耗型 / 标记型、资源型效果、原文起草 |
| `wuwa-dps-td08-character-module-v0.1.md` | 角色模块怎么写：钩子、写法模式、M0 三人的模块 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.1.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、循环 |
| `wuwa-dps-design-v0.2.9.md`（机制设计） | 游戏机制；与总设计冲突时以总设计附录 A 为准 |
| `m0-confirm.md` | 当前队伍（椿 · 散华 · 维里奈）的数据确认结果与待办 |

确需推翻某个取舍时：先改总设计并记入附录 C，再改代码。

## 目录

```text
tools/build/        ① 数据构建（Python + openpyxl）：xlsx → data/generated/
data/raw/           xlsx（不进 git）
data/generated/     构建产物（不进 git，公开仓库不发布原作者的数据）；fixtures/ 下是 golden 夹具
data/curated/       手写数据（进 git）：dmg-join.json、characters/<角色>.ts、weapons.ts …
src/data/           ② schema、动作装配、注册层（registry.ts 纯函数；load.ts 是 Node 侧读盘）
src/engine/         ③ 仿真引擎：纯库，不许引入 DOM、fs、网络（resolve → simulate → summary；内核 kernel、调度 scheduler、切人 switch、资源 resources、触发 triggers）
src/cli/            命令行（pnpm sim）
scenarios/          场景文件（YAML）
out/                pnpm sim 写出的事件日志（不进 git）
tests/              Vitest；依赖 data/generated 的用例在缺数据时自动跳过
docs/               设计文档
```

## 命令

```bash
pnpm install
pnpm build:data -- --strict 椿,散华,维里奈   # 读 data/raw/*.xlsx；--strict 名单有未连上的伤害判定时退出码 1
                                             # 顺带抓 nanoka（缓存在 data/raw/nanoka/，--nanoka off 跳过，--nanoka 3.6 指定版本）
pnpm check:data                              # 用 zod schema 校验 data/generated/
pnpm check:data -- --flags 椿,散华,维里奈    # 另外列出这些角色装配后还没处理的 flag（TD-01 §14），以及手填冷却与 nanoka 对不上的地方
pnpm check                                   # tsc 严格模式
pnpm test                                    # Vitest
pnpm test:py                                 # 构建脚本的 Python 单元测试
pnpm golden:perturb -- --rounds 20           # golden 扰动对拍（TD-03 §10.3）：改公式、改乘区拆分、换 xlsx 后跑一次，不进 CI
pnpm sim scenarios/m0-team.yaml              # 跑一个场景：终端打印汇总（循环时有分轮与稳态），事件日志写到 out/<场景名>.json
pnpm compare 基准.yaml 对比.yaml             # 两套配装 / 两条轴比稳态 DPS，按角色、动作、buff 覆盖率拆差在哪
pnpm marginal scenarios/m0-team.yaml --char 椿      # 副词条边际：各加一档（--tier avg|max|min）重跑，按 DPS 增加排序
pnpm test -- -u                              # 场景汇总快照（tests/scenarios.test.ts）有变化、人工确认无误后更新快照
```

**每次任务结束运行 `pnpm check && pnpm test && pnpm test:py`**；动了构建脚本或数据，再跑 `pnpm build:data -- --strict 椿,散华,维里奈 && pnpm check:data`。

## 约定

- 时间一律帧（60fps），比例一律小数（12% 写 0.12）。
- 新增字段先改 schema（`src/data/generated.schema.ts` 等），再改产出方和使用方。
- `data/generated/` 只能由构建脚本写，绝不手改；表里的错误写进 `data/curated/` 修正，不改 xlsx。
- 改机制必须同时新增或修改一个用例；改公式必须跑通 golden（M1 起）。
- 推断出来的值要打 flag（TD-01 §13），让人能找到并确认。
- 中文键（角色名、动作名）原样使用，只 trim，不做模糊匹配。

## 与设计文档的差异（实现时的决定，下次改文档时并回）

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4；M1–M3 记下的 11 处已于 2026-10-03 并回总设计 v0.1.5、TD-01 v0.1.4、TD-02 v0.1.4、TD-03 v0.1.1、TD-04 v0.1.2、TD-09 v0.1.1（各文档附录的变更历史逐条列出）。之后的新决定记在下面：

1. **声骸数据接入**（2026-10-03～04，TD-01 §8、§13.3；TD-02 的 `GenEchoSchema`、`EchoModule`、`EchoDef`）：
   - `echoes.json` 每个声骸一项，**按组装配**（一组 = 一个动作）：「类型」列每个合并区是一个技能版本（无常凶鹭的点按 / 长按；鸣钟之龟每种体型一行，组上记 `body`）；版本里有「单段冷却 / 接续时限」的是多段声骸，按行名 "-" 前的前缀分段（无冠者 A1→A4），本段的 S / T 记成下一段可接的窗口 `next`（本段局部帧）。分段是按名字猜的，打 `stagesGuess`（燎照之骑的"刹车"其实是长按版，用到时再改）。组名取各行名的公共前缀（无妄者 斩击1…6 → 斩击），没有时同 TD-01 §3.5。声骸表没有命中类型列：有持续帧的行就是判定，发生帧为空 = 事件生成。COST 按 TD-01 §6 查 `索引` 页，查不到打 `costMissing`。
   - **异相只换配色、数值同本体**（2026-10-04 用户确认）：表里本体也在的 5 个异相块不单独产出（xlsx 的异相·无常凶鹭数值与本体不同，不用），场景里写"异相·X"装配时取 X。
   - **倍率**：TD-01 §8 原定"dmg 没有的从技能说明手工录入"。改为：dmg-join.json → dmg 同名行（`RateLv_5`；倍率全 0 的占位行不算）→ **nanoka 声骸数据的伤害条目**（`via: 'nanoka'`，削韧值、大招回收 × 100 都对得上且候选倍率唯一才连）。**xlsx 与 nanoka 不同时以 nanoka 为准**（2026-10-04 用户确认）：连 nanoka 的判定，能量与削韧也取 nanoka；削韧 / 能量对不上没自动连的，在 dmg-join.json 写 `"行名": "nanoka::<条目 ID>"`（已写梦魇·无冠者、梦魇·朔雷之鳞、梦魇·无常凶鹭、梦魇·云闪之鳞、迷胧幻蛾、游鳞机枢）。余下的缺口多是无伤害的功能行，进构建报告"声骸"一节并列出候选，用到再补。
   - nanoka：`nanoka.json` 新增 `echoes`（说明、冷却、伤害条目、所属套装）与 `echoSets`（件数效果说明）；构建时 nanoka 提前到声骸连倍率之前，`--nanoka off` 或没取到时沿用上次的 `nanoka.json`。名字对不上的写在 `nanoka-names.json` 的"声骸"一节（"共鸣回响·…"等 8 个）。
   - 装配：动作 ID 是 `Q·<组名>`（类别 `echo`），首位声骸并入动作表、别名 `Q` 指向第一组；鸣钟之龟按角色体型挑行（中小体型用少女行）。多段声骸的后续段 `comboFrom` 上一段、`cooldownGroup` 写自己的 ID —— `cooldownKey` 改为 `cooldownGroup` 优先于 `'echo'`，后续段不受声骸冷却限制。首位加成与技能附带的 buff / 资源型效果写在 `data/curated/echoes.ts`（`mainSlotBuffs`、新增 `resourceEffects`、`actionOverrides`；去掉了 `multipliers`），只在首位登记，顺序在武器之后、套装之前；`JudgmentOverride` 新增 `element`、`relatedAttr`、`heals`。
   - **脱手与否**（2026-10-04 用户说明）：说明里是"召唤…"的脱手释放，"幻形…"的不脱手（切人合轴时在后台打完——引擎本来就让切下的角色把动作做完）。召唤类动作 `ActionDef.summon`：判定在开始时分到独立时间线（同延奏动作，TD-05 §4.3），角色之后的动作、取消都不影响，也不挡"就绪"；角色能不能马上出下一招看中断优先级（召唤类多为 0）。召唤物按战斗时钟走，不被队友变奏的时停冻住（维里奈的爆气因此赶在自己延奏之前打出）。第一个技能版本以说明为准（`textKind`），其余版本（凯尔匹的延奏、神王的变奏）看「类型」列；对不上的打 `kindText`（角鳄、封庭械囿、金庭候），`actionOverrides` 可改 `summon`。
   - 场景：首位声骸必须在声骸表里（要放技能），写错报错；其余几件只计入词条与套装，表里没有也行（`ResolvedMember.echoes[].def` 为 null）。首位声骸不在 echoes.ts、或有要核对的数据时提示一次。`pnpm check:data -- --flags <声骸名>` 列出声骸动作的 flag、各判定的倍率来源与 nanoka 说明。
   - 未做：伪作的神王、双极…的按次数充能（打 `charges`，按普通冷却算；机制已有，见第 2 条，用到时在 echoes.ts 写）；无归的谬误、燎照之骑的长按版；召唤类声骸缺结束帧的（角…）按判定最晚的帧结束（`noEnd`）。
2. **声骸效果用到的三处引擎扩展**（2026-10-04；TD-02、TD-07 §1 / §4、TD-08 §3.2、TD-09 §3.2）：
   - **按次数充能** `ActionDef.charges`（`ActionOverride` 同名）：最多存几次、初始满，用掉一次就开始按 `cooldown` 回复，回复后还没满就接着计；次数用完才等（`CharRuntime.charges`）。梦魇·无冠者以 nanoka 为准：3 次、每 12 秒回 1 次（xlsx「冷却」列 20 秒）。TD-09 §3.2 原说"按次数充能的技能交给角色钩子"，声骸没有钩子，改为数据字段。
   - **触发条件 `where.ownerHas`**：持有者身上有这个 buff 时才触发（无常凶鹭"幻形后 15 秒内若施放延奏…"写成标记型监听 + `ownerHas`）；指向没登记的 buff 时装配报错。
   - **治疗事件**：触发事件目录（总设计 §6.8、TD-07 §4）新增 `heal`，日志新增 `heal` 事件（谁、哪个来源）。动作表没有治疗判定（m0-confirm 2.4），所以：带治疗的结算由角色模块给判定标 `heals`（`JudgmentDef.heals`），结算后记一条；不在任何判定上的治疗（持续回复的每一跳）由钩子调新增的 `ctx.heal(来源)` 记。"算治疗"的依据是 nanoka 技能描述里写了回复生命值、或倍率表里有治疗量（2026-10-04 用户确认）。维里奈：星星花绽放（强化重击、强化空中攻击）、大招草木生长、协同攻击；延奏盛放每秒一跳共 6 跳、共鸣链1 每 5 秒一跳共 6 跳（标记型 buff 计时）。隐世回光 5 件按 `heal` 触发；治疗量不建模。
   - curated：`data/curated/echoes.ts`（无妄者、无常凶鹭、无归的谬误、梦魇·无冠者）、`data/curated/echo-sets.ts`（沉日劫明、轻云出月、隐世回光），乘区按 xlsx「伤害配置」buff 库的分区核对过。M0 代表轴装上 docs/test-echos-setup.md 的声骸；**Q 放在哪按 buff 时效权衡**（2026-10-04 用户说明：不一定是上场第一个动作），代表轴里各位置都试过、取 DPS 最高的（理由写在场景文件注释里），场景快照已更新。
3. **分轮与稳态**（2026-10-04；总设计 §3.5、TD-09 §3.7 / §3.9、关闭 TD-09 Q10；TD-02 `Summary.perLoop` / `steady`）：`options.repeat ≥ 2` 时汇总给出每一轮的起点、时长、伤害、DPS、三人能量 / 协奏的首尾差（第 k 轮 = [本轮 `loop` 事件, 下一轮 `loop` 事件)，最后一轮到统计窗口终点）。**稳态取完整的轮**：第 2 轮到倒数第 2 轮——第 1 轮受开局资源影响，最后一轮没有下一轮的边界、等下一轮起手的时间算不进来，偏高（总设计 §3.5 原写"稳态以最后一轮为准"，改掉）；只有 2 轮时取第 2 轮。CLI 打印分轮表。M0 代表轴改为循环 4 轮（结尾切回维里奈），第 2、3 轮完全相同、资源首尾差为 0，稳态 DPS 26,061。
4. **M5 对比与副词条边际**（2026-10-04；总设计 §3.5"对比"、TD-01 §5.4；TD-10 还没写，口径先定在这里）：
   - `echo-stats.json`：`base` 表 AY–CK 列——主词条满级值与固定副主属性按说明文字解析（"暴击22%""攻击150"），副词条各档取显示值（BR 起每种两列，取显示值那列；表头不全可靠，按列写死）。`GameData.echoStats`。
   - `src/engine/analysis.ts`（纯函数）：比较口径有分轮取稳态、否则取整个窗口（`basisOf`）；"差在哪"按窗口内各角色、各动作的**每秒伤害**（加起来就是 DPS，两边窗口长短不同也能比）、buff 覆盖率（标记型不列）、静态面板拆。副词条边际：给角色各加一档（缺省各档平均，比例取到 0.0001、固定值取整），加在他**最后一件声骸**的副词条上，各重跑一次比稳态 DPS；轴固定，所以共鸣效率只在原来要等能量时才有收益。
   - 命令：`pnpm compare`、`pnpm marginal`（`src/cli/`，共用的格式化在 `format.ts`）。

