# AGENTS.md —— 给编码代理（Claude Code、Codex、Antigravity…）的约定

鸣潮逐帧期望 DPS 仿真与配装择优工具。个人项目，原则：**实用、清晰、简单**。不追求工业级的安全性与一致性。

**现在是原型期**（总设计 §0.1 第 7、8 条）：
- 重心在数据与机制，以及能从结果推出的结论；网页能当原型展示即可，不在外观细节上花大力气。
- 影响小的不确定处不深究，但要登记进假设表 `src/engine/assumptions.ts`（总设计 T16）：写清现在怎么处理、依据、影响、能不能调。
- 引擎缺省按期望值算；抽样（蒙特卡洛）只在显式给种子时用，随机数只来自 `src/engine/rng.ts`（T4）。
- 引擎以后可能换成 Rust：按总设计 §10.1 的写法写（数据与钩子分开、钩子状态在 `vars` 里声明、取整用 `num.ts`、输出顺序显式），改了引擎跑一遍 `pnpm conformance`。

## 先读什么

设计文档都在 `docs/`，改代码前先读相关章节，并在代码注释与提交说明里引用章节号（如"TD-04 §4.2"）：

| 文档 | 管什么 |
|---|---|
| `wuwa-dps-engine-tech-design-v0.2.1.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、好移植的写法（§10.1）、里程碑与进度 |
| `wuwa-dps-td01-data-dictionary-v0.1.8.md` | xlsx 每一列的含义与抽取规则（含声骸表、声骸属性、敌人与谐度破坏表、附页2 的偏谐规则）、版本清单与定位方式、nanoka 数据、装配默认映射、角色模块与声骸的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.10.md` | 全部类型与 zod schema（类型一览，代码以仓库为准），含出处的类型（资源出处、命中的来由） |
| `wuwa-dps-td03-damage-formula-v0.1.4.md` | 伤害公式与乘区、golden 抽取 |
| `wuwa-dps-td04-sim-kernel-v0.1.5.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定、尾部与独立时间线、冷却与充能 |
| `wuwa-dps-td05-switch-concerto-v0.1.1.md` | 切人、变奏 / 延奏、协奏清零、切人结束技能 |
| `wuwa-dps-td06-resources-v0.2.3.md` | 角色资源：大招能量分配与门槛、协奏时机、核心资源；敌人量表：偏谐与失谐、谐破冷却与按钮、谐度破坏（自动 / 手写 / 关闭）、白条（削韧值与按比例）与破盾回能、瘫痪（偏移 / 干涉 / 响应、异常效应以后） |
| `wuwa-dps-td07-buff-system-v0.1.1.md` | buff 实例、作用对象、触发与事件队列（含治疗事件、`ownerHas`）、消耗型 / 标记型、资源型效果、原文起草 |
| `wuwa-dps-td08-character-module-v0.1.5.md` | 角色模块怎么写：钩子、写法模式、M0 三人的模块 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.7.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、可选 `?`、补位 `~`、插队、循环与启动轴 |
| `wuwa-dps-td10-output-report-v0.1.6.md` | 汇总指标与 DPS 口径、分轮与稳态、配装对比、副词条边际、结论（共鸣效率需求、操作容错、假设敏感度）、命令行输出、时间轴网页 |
| `wuwa-dps-td11-debug-calibration-v0.1.1.md` | 对不上时怎么查：说清楚、分层、从粗到细、做实验；案例；调试工具（`pnpm trace`、网页调试表、视频时间点）与改进；出处的归属规则（谁引发的算谁） |
| `wuwa-dps-td12-web-v0.2.3.md` | 网页（Vite + Svelte 5，本机用）：结构、各页（含结论页、场景页的假设）、Worker、时间轴的视图 A–D（步进、检查器、资源与伤害的出处、"轴可能有问题"）、手机与 iPad（触摸操作、全屏）、检查 |
| `wuwa-dps-td13-echo-optimizer-v0.1.1.md` | 声骸库存择优：库存写法、快速重算、搜索与完整仿真确认 |
| `calibration/` | 实测与校准记录（格式见其中 README） |
| `wuwa-dps-design-v0.2.9.md`（机制设计，已冻结） | 写总设计之前的游戏机制规格书，不再更新；与总设计、各 TD 冲突时以它们为准（勘误见总设计附录 A，开头有按章节找现在文档的对照表） |
| `m0-confirm.md` | 当前队伍（椿 · 散华 · 维里奈）的数据确认结果与待办 |
| `m0-conclusions.md` | 当前队伍的结论：副词条先堆哪个、共鸣效率要多少、手慢几帧掉多少（注明按哪条轴、哪个数据版本算的） |
| `xin-confirm.md` | 心 · 雷主 · 卜灵 队伍的确认清单：按数据原文的轴接不上的地方、按原文推断的机制、电磁效应结算（第二步）要定的 |

确需推翻某个取舍时：先改总设计并记入附录 C，再改代码。

## 目录

```text
tools/build/        ① 数据构建（Python + openpyxl）：xlsx → data/generated/
data/raw/           xlsx（不进 git；可以同时放几个版本，子目录如 archive/ 也行）
data/xlsx-versions.json  xlsx 版本清单（进 git）：各版本的文件名、sha256、资源版本，current 是构建缺省用的那份
data/generated/     构建产物（不进 git，公开仓库不发布原作者的数据）；fixtures/ 下是 golden 夹具
data/curated/       手写数据（进 git）：dmg-join.json、characters/<角色>.ts、weapons.ts …
src/data/           ② schema、动作装配、注册层（registry.ts 纯函数；load.ts 是 Node 侧读盘）
src/engine/         ③ 仿真引擎：纯库，不许引入 DOM、fs、网络（resolve → simulate → summary；内核 kernel、调度 scheduler、切人 switch、资源 resources、触发 triggers）
src/cli/            命令行（pnpm sim）
src/report/         CLI 与网页共用的展示模型（时间轴页面）
web/                timeline.html（时间轴页面模板）；app/ 是网页（Vite + Svelte 5，TD-12）
scenarios/          场景文件（YAML）
inventory/          声骸库存（YAML，TD-13 §2）
out/                pnpm sim 写出的事件日志（不进 git）
tests/              Vitest；依赖 data/generated 的用例在缺数据时自动跳过
docs/               设计文档
```

## 命令

```bash
pnpm install
pnpm build:data -- --strict 椿,散华,维里奈,卜灵,雷主·男,心,照世心 --nanoka 3.7   # 读 data/xlsx-versions.json 的 current（核对 sha256）；也可直接传 xlsx 路径；
                                             # --strict 名单有未连上的伤害判定时退出码 1
                                             # 顺带抓 nanoka（缓存在 data/raw/nanoka/，--nanoka off 跳过，--nanoka 3.6 指定版本）
pnpm check:data                              # 用 zod schema 校验 data/generated/
pnpm check:data -- --flags 椿,散华,维里奈    # 另外列出这些角色装配后还没处理的 flag（TD-01 §14），以及手填冷却与 nanoka 对不上的地方
pnpm check                                   # tsc 严格模式 + svelte-check（网页）
pnpm test                                    # Vitest
pnpm test:py                                 # 构建脚本的 Python 单元测试
pnpm golden:perturb -- --rounds 20           # golden 扰动对拍（TD-03 §10.3）：改公式、改乘区拆分、换 xlsx 后跑一次，不进 CI
pnpm sim scenarios/m0-team.yaml              # 跑一个场景：终端打印汇总（循环时有分轮与稳态），事件日志写到 out/<场景名>.json
pnpm compare 基准.yaml 对比.yaml             # 两套配装 / 两条轴比稳态 DPS，按角色、动作、buff 覆盖率拆差在哪
pnpm marginal scenarios/m0-team.yaml --char 椿      # 副词条边际：各加一档（--tier avg|max|min）重跑，按 DPS 增加排序
pnpm insight scenarios/m0-team.yaml          # 结论（TD-10 §6）：共鸣效率需求、操作容错（--delays 0,3,6,10,15）、假设敏感度、指令被挡住的时间
pnpm sim scenarios/m0-team.yaml --sample 300 # 抽样模式（总设计 T4）：逐段抽暴击跑 300 次看 DPS 分布；--jitter 6 另加 0–6 帧操作抖动，--seed 换种子
pnpm optimize scenarios/m0-team.yaml --inv inventory/m0-equipped.yaml --char 椿   # 声骸库存择优（TD-13）：首位与套装件数不变，列出完整仿真最好的几套
pnpm import:scan data/scan/<账号>-echo.json [--out …] [--nanoka <版本>] # wavescan 扫描导出（WutheringToolsScan v1）转声骸库存 YAML；一个账号一份，缺省写到 inventory/<账号>-bag.yaml
pnpm assumptions                             # 假设登记表（总设计 T16）：现在怎么处理、依据、影响、怎么改；--md 打印成表格。pnpm sim 的末尾列出这次碰到的
pnpm conformance                             # 一致性样例（总设计 §10.1）：每个场景的装配结果（去掉钩子表）与事件日志、汇总写到 out/conformance/，换实现时对拍
pnpm web                                     # 网页（TD-12）：http://localhost:5317/，场景编辑与运行（可切换时间轴视图）、对比、边际、择优；pnpm web:build 打包到 out/web（含数据，不发布）
                                             # 用域名访问时：WEB_HOSTS=<域名> pnpm web --port <端口> --host 0.0.0.0
pnpm timeline scenarios/m0-team.yaml        # 时间轴网页：结果嵌进 web/timeline.html，写到 out/<场景名>.html（浏览器直接打开）；下方有调试表
                                             # --view a|b|c|d 改用视图 A–D（TD-12 §2.1），写到 out/<场景名>.<视图>.html
pnpm trace scenarios/m0-video.yaml          # 调试表（TD-11 §6）：某一轮的分段与逐条（--loop k、--seg），资源逐步（--res 协奏|能量|<核心资源名>，--char）；
                                             # 场景有 video 时对照视频；--md 另写 out/<场景名>.trace.md
pnpm test -u                                 # 场景汇总快照（tests/scenarios.test.ts）有变化、人工确认无误后更新快照（pnpm 10 会把 `--` 原样传给 vitest，别写成 `-- -u`）
```

**每次任务结束运行 `pnpm check && pnpm test && pnpm test:py`**；动了构建脚本或数据，再跑 `pnpm build:data -- --strict 椿,散华,维里奈,卜灵,雷主·男,心,照世心 --nanoka 3.7 && pnpm check:data`。

## 约定

- 时间一律帧（60fps），比例一律小数（12% 写 0.12）。
- 新增字段先改 schema（`src/data/generated.schema.ts` 等），再改产出方和使用方。
- `data/generated/` 只能由构建脚本写，绝不手改；表里的错误写进 `data/curated/` 修正，不改 xlsx。
- 改机制必须同时新增或修改一个用例；改公式必须跑通 golden（M1 起）。
- 推断出来的值要打 flag（TD-01 §13），让人能找到并确认。
- 中文键（角色名、动作名）原样使用，只 trim，不做模糊匹配。

## 与设计文档的差异（实现时的决定，下次改文档时并回）

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4；M1–M3 记下的 11 处已于 2026-10-03 并回总设计 v0.1.5 等；声骸与 M5 记下的 4 处已于 2026-10-04 并回总设计 v0.1.6 等，并新写 TD-10 v0.1；M4 敌人量表（TD-06 v0.2 §17）已于 2026-10-04 并回总设计 v0.1.7 等；时间轴网页、启动轴、谐度破坏的调整（不拆连段、附页2 规则、椿两种、按比例削白条）、版本清单与换成 20261003 版这 7 处已于 2026-10-04 并回总设计 v0.1.8、TD-01 v0.1.7、TD-02 v0.1.7、TD-03 v0.1.3、TD-06 v0.2.1、TD-08 v0.1.2、TD-09 v0.1.4、TD-10 v0.1.2（各文档附录的变更历史逐条列出）；补位后缀、视频轴转正、M0 代表轴换装、调试工具与 TD-11、开局核心资源、视频时间点、核心资源改名这 7 处已于 2026-10-05 并回总设计 v0.1.9、TD-02 v0.1.8、TD-06 v0.2.2、TD-08 v0.1.3、TD-09 v0.1.5、TD-10 v0.1.3（机制设计 v0.2.9 同时标为冻结）；原型期的方向（总设计 v0.2：T4、T12、T16、§10.1）带来的假设登记、好移植的写法、操作延迟与结论、抽样模式这 4 处已于 2026-10-17 并回总设计 v0.2、TD-02 v0.1.9、TD-03 v0.1.4、TD-08 v0.1.4、TD-09 v0.1.6、TD-10 v0.1.5、TD-12 v0.2.2。2026-10-18 视频轴核对时记下的 9 处（散华 ERZ、动作给的资源与出处、写了"变奏"的切人、视频轴两份、"进入即得"改叫"起手即得"、钩子记假设、地面出场技、伤害也按谁引发的算谁、引出原因）已于 2026-10-18 并回总设计 v0.2.1、TD-01 v0.1.8、TD-02 v0.1.10、TD-04 v0.1.5、TD-06 v0.2.3、TD-08 v0.1.5、TD-09 v0.1.7、TD-10 v0.1.6、TD-11 v0.1.1、TD-12 v0.2.3（m0-confirm §11 当天已同步）。之后的新决定记在下面：

1. 结论的共鸣效率需求多报下限（2026-10-19，TD-10 §6 ①）：`EnergyNeed.floor` = 面板 100% + 常驻共鸣效率 buff，是能压到的最低；最低等于它时命令行写"下限：…，不堆共鸣效率也够"，网页标"（下限）"。TD-10 §6 ① 里 M0 代表轴的"椿 125.6%、散华 110.0%"就是下限（千古洑流常驻 25.6%、轻云出月 2 件 10%），不是要堆到这么多。
2. 声骸库存一个账号一份（2026-10-19，TD-13 §1）：`pnpm import:scan` 的缺省输出从固定的 `inventory/scanned-bag.yaml` 改成按扫描文件名，`data/scan/<账号>-echo.json` → `inventory/<账号>-bag.yaml`（`inventoryPathFor`）；原来的 `scanned-bag.yaml` 改名 `everbird-bag.yaml`，新增 `Evariste-bag.yaml`（M0 队伍所在的账号）。两个账号的声骸不能混用，id 也都从 scan-echo-1 起，不合并。
3. 换成 20261019 版 xlsx（2026-10-19，总设计 T15，TD-01 §3.1、§5.2）：资源版本 3.7.13，新增心（锁暝只有一行占位）。动作表在"持续帧"后插了"延迟"、"顿帧-敌"后插了"多判间隔/次"，构建改为按第 1 行表头名找列（`tools/build/actions.py` 的 `ActionCols`，同 base 页的 `base_cols.py`）；"延迟"存成行字段 `delayFrames`（判定生成后到生效前等的帧数；只有心的两块有值，装配与仿真还没用上），"多判间隔/次"（"nF / m次"）等同备注"持续帧内每nF进行一次判定，最多m次"，并进 hints。心的动作分两块：常态"应世心"改用角色名"心"（`BLOCK_RENAME`，dmg 仍按块名"应世心"连），岁主形态"照世心"单独一块、由角色模块并入；索引页把两块登记在"女-大"。M0 三人的数据与 20261003 版相同，各场景结果不变；全量用例的计数换成新版（75 块、1771 组、连段 133）。
4. 异常效应的层数（2026-10-19，TD-06 §18 新增，TD-07 §4.1，TD-02）：判定新增 `applies: { effect, stacks }`（"命中后赋予目标n层电磁效应"，角色模块的 `actionOverrides.judgments` 按原文标），钩子新增 `ctx.applyEffect(effect, stacks, note?)`；规则写在新文件 `data/curated/effects.ts`（`EffectModule` → `GameData.effects`，`EffectDef` 加 `source`、`burstMax`，逐层倍率先空着）。附加时层数加到常规上限，超出的进额外层（电磁爆发，`EffectRuntime.burst`），每次附加把全部层数的持续时间刷新为 15 秒，P6 计时到了整个消失。记敌人状态事件 `effectApplied`（新增字段 `by`、`effect`、`added`、`stacks`、`burstAdded`、`burst`；到顶加 0 层也记，雷主延奏写的是"尝试赋予"）与 `effectEnd`（`ENEMY_STATE_CHANGES` 加 `effectEnd`）；触发的 `where.enemyState`、`where.effect` 从此生效，发出者是 `by`（没记 `by` 的破盾、失谐等仍不触发）。伤害结算还没接（假设 `later-damage`，附加层数时也记一笔），是心 · 雷主 · 卜灵的第二步（docs/xin-confirm.md §4）。没写规则的效应提示一次、不计层数。
5. 带前缀并入的块（2026-10-19，TD-01 Q2，TD-02 §5）：`mergeBlocks` 的一项可以写 `{ block, prefix }`，并入的动作 ID 前面加 prefix（心的岁主形态"照世心"单独一块，组名与常态重名，并入后叫"照世·A1"…）；它的 `actionOverrides` 按带前缀的 ID 写，连段前置、接续动作、另存为里指块内动作的也写带前缀的（装配前去掉、装配后加回），连段前置只能指同一块。装配抽成 `registry.ts` 的 `assembleCharacterActions`，`pnpm check:data -- --flags` 也用它。
6. 落地段与首位声骸按角色换版本（2026-10-19，TD-01 §13.3、§13.4，TD-04 §7）：`ActionOverride.shiftRows`（行名 → 落地的局部帧）：下落攻击"落地"几行的帧数从落地起算，装配前整体后移（发生、出现、结束、派生、优先级变化、提示、膨胀发生），这时动作结束帧取各行的最大值、`multiEnd` 视为已处理（卜灵空中攻击 38、雷主 A4 46）。`EchoModule.qFor`（角色名 → 动作 ID，`EchoDef.qFor`）：首位声骸的别名 Q 按装配的角色换（天演溯心装在心身上是"Q·心召唤"）。
7. 补位后面可以接"switch <角色> 变奏"（2026-10-19，TD-09 §3.2、§4.2）：补位 `~` 看的那一条可以是紧接着的写了"变奏"的切人，切出者协奏满了就不补（skip 原因"协奏满了，变奏不用补 X"）；编译期的要求相应放宽。用途：心 · 雷主 · 卜灵的轴里雷主"A打满…"之后切心要变奏，大招前能量已满的那几轮协奏不够，补几下普攻（docs/xin-confirm.md X3）。
8. 假设表新增 `module-guess`（2026-10-19，总设计 T16）：角色模块里按原文推断、还没实测的时序与条件（卜灵五雷荡煞阵的冲击波从什么时候起、心的协同攻击怎么计时…），钩子里 `ctx.assume('module-guess', …)` 记一笔；逐条见各队伍的确认清单（docs/xin-confirm.md §2）。
9. 行进序曲 / 奇幻变奏的协奏按阶（2026-10-19，TD-07 §9 与附表，用例 TD-05 T05-1、TD-06 T06-7、TD-07 T07-3）：xlsx 武器表只有 1 阶的文本"回复8点协奏能量"（没有各阶数值），之前当成各阶相同；nanoka 3.7（武器 21020024、21050024）是 8 / 10 / 12 / 14 / 16，`data/curated/weapons.ts` 改成按阶的数组。M0 场景都是 5 阶：视频轴 AQ 版那两处"写了变奏的切人没变奏"（散华协奏 92、19）就是少算的 8 点，改正后每次都变奏，稳态 40,888 → 41,164（m0-confirm §11 V7、V9 已更正）；EQ 版、代表轴、散华单人不变。用例里的 +8 改成 +16（T05-1 的边界 77 → 69，T06-7 的初始 90 → 80），视频轴的用例另验证按 1 阶算时仍报那两处。心 · 雷主 · 卜灵的 X1 也是它：卜灵 5 阶回 16 点，协奏够了（docs/xin-confirm.md）。
10. 大招的"不响应输入"也挡切人（2026-10-19，TD-05 §2、TD-04 §6.3，假设 `ult-no-switch`）：大招（类别 liberation）没写"第nF前不能切人"时，按"第nF前不响应输入"挡切人，`ActionDef.switchLockFromInput` 标出来，挡住时记假设、等待原因写"…不响应输入（按不能切人算）"；写了"不能切人"的照写的（仇远 200 早于不响应输入 230，凌阳、珂莱塔、琳奈、相里要、露帕也写了），变奏另有"不能切人"，不套。依据是用户的实战体感（大招出招阶段不能切人），待实机验证（docs/xin-confirm.md Y2）；卜灵模块里手写的切人锁 238 去掉。M0 代表轴：椿大招后切维里奈要等到大招第 239 帧（全局时停里，战斗时间只多 2 帧），这期间目标失谐、谐度破坏改由椿放（整个动作不能切人），每轮 1906 → 1947 帧，稳态 31,023 → 30,242（−2.5%），操作容错 6 帧 −9.5% → −7.4%（TD-10 §6 的例子）；视频轴两版不变。
11. 视图 D 的检查器显示共鸣回路（2026-10-19，TD-12 §2.1，TD-08 §2、TD-02；总设计 T8、§6.9 已补记）：每人的能量、协奏原来是两行进度条，改成一排小格子（名字、值，底边细条是满了多少，满了描边），后面接共鸣回路的核心资源（只列这次有变化的槽：心的应世心 / 照世心、雷主的电涌、卜灵的卦象…）；值从资源曲线的采样（30 帧一次，逐帧步进时最多晚 30 帧）改成逐帧精确：时间轴模型新增 `resources`（`resourceTracks`：每人每种资源的 [世界帧, 值]，按 `gainSteps` 重放）。核心资源说不清的状态由新的只读显示钩子 `forte(ctx) → string` 给一行，每个 tick 结束调用、变了才记进 `SimResult.forte`（不进日志，一致性样例不比），检查器按" · "拆成小标签：卜灵（卦象的排列，空位 ○；少阳 / 少阴 / 阴阳相生；开阵时雷法第几阶、冲击波几次）、心（应世相 / 照世相、心相心生、统御众机、了尘愿 / 承天则能不能用、电磁+1、敕令、霆霓、额外能量、活字心锁）、椿（白椿 / 红椿、含苞与酣梦层数、红椿·蕾）；散华、维里奈、雷主只看核心资源。
12. 散华的透视与重击爆裂（2026-10-19，TD-06 Q6、TD-08 散华一节，docs/m0-confirm.md §13）：核心资源槽 1 改叫"透视"、上限 2（基础页叫"指针"、上限 70；xlsx 核心回收1 加减的其实是透视层数：A5 / E / 变奏 +1、大招 +2、重击居合 −2，nanoka"最多 2 层、每层 5 秒"）。每层 5 秒由钩子扣：两个计时标记 `散华.透视·一` / `散华.透视·二` 各管一层，满 2 层再得时刷新先得的那层（用例 T08-散华-5；T06-3 大招开始时多两条计时）。状态说明（`forte`）列出场上的冰。重击爆裂按"每次都在冰痕区域里松手、按下即松开"算，登记成假设 `burst-release`（每次重击居合记一次，M0 场景快照多这一行，DPS 不变）；指针的速度、冰痕区域的位置与宽度没有数据，待实测（m0-confirm §13 P1–P5）。
