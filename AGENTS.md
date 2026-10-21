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
| `wuwa-dps-engine-tech-design-v0.2.3.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、好移植的写法（§10.1）、里程碑与进度 |
| `wuwa-dps-td01-data-dictionary-v0.1.10.md` | xlsx 每一列的含义与抽取规则（含声骸表、声骸属性、敌人与谐度破坏表、附页2 的偏谐规则）、版本清单与定位方式、nanoka 数据、装配默认映射、角色模块与声骸的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.11.md` | 全部类型与 zod schema（类型一览，代码以仓库为准），含出处的类型（资源出处、命中的来由） |
| `wuwa-dps-td03-damage-formula-v0.1.5.md` | 伤害公式与乘区（含异常效应伤害在仿真里怎么用）、golden 抽取 |
| `wuwa-dps-td04-sim-kernel-v0.1.7.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定（含"延迟"）、尾部与独立时间线、冷却与充能 |
| `wuwa-dps-td05-switch-concerto-v0.1.2.md` | 切人、变奏 / 延奏、协奏清零、切人结束技能、大招出招阶段不能切人 |
| `wuwa-dps-td06-resources-v0.2.4.md` | 角色资源：大招能量分配与门槛、协奏时机、核心资源；敌人量表：偏谐与失谐、谐破冷却与按钮、谐度破坏（自动 / 手写 / 关闭）、白条（削韧值与按比例）与破盾回能、瘫痪；异常效应（§18：层数与电磁爆发、定时结算、钩子主动触发与消耗；偏移 / 干涉 / 响应以后） |
| `wuwa-dps-td07-buff-system-v0.1.2.md` | buff 实例、作用对象（含 `ownerOnField`）、触发与事件队列（含治疗事件、`ownerHas`、异常效应的敌人状态）、消耗型 / 标记型、资源型效果（按武器阶）、原文起草 |
| `wuwa-dps-td08-character-module-v0.1.7.md` | 角色模块怎么写：钩子（含只读的显示钩子 `forte`）、写法模式、M0 三人与心 · 雷主 · 卜灵的模块 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.8.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、可选 `?`、补位 `~`、插队、循环与启动轴 |
| `wuwa-dps-td10-output-report-v0.1.8.md` | 汇总指标与 DPS 口径、分轮与稳态、配装对比、副词条边际、结论（共鸣效率需求与下限、操作容错、假设敏感度）、轴搜索（第一版：在现成的轴上挪动 / 去掉动作）、命令行输出、时间轴网页（含检查器的逐帧资源、共鸣回路状态与冷却） |
| `wuwa-dps-td11-debug-calibration-v0.1.2.md` | 对不上时怎么查：说清楚、分层、从粗到细、做实验；案例；调试工具（`pnpm trace`、网页调试表、视频时间点）与改进；出处的归属规则（谁引发的算谁） |
| `wuwa-dps-td12-web-v0.2.5.md` | 网页（Vite + Svelte 5，本机用）：结构、各页（含结论页、场景页的假设）、Worker、时间轴的视图 A–E（步进、检查器与共鸣回路、资源与伤害的出处、"轴可能有问题"；E 是播放器式的原型，敌人在顶上一条）、手机与 iPad（触摸操作、全屏）、检查 |
| `wuwa-dps-td13-echo-optimizer-v0.1.2.md` | 声骸库存择优：库存写法（一个账号一份）、快速重算、搜索与完整仿真确认 |
| `calibration/` | 实测与校准记录（格式见其中 README） |
| `wuwa-dps-design-v0.2.9.md`（机制设计，已冻结） | 写总设计之前的游戏机制规格书，不再更新；与总设计、各 TD 冲突时以它们为准（勘误见总设计附录 A，开头有按章节找现在文档的对照表） |
| `m0-confirm.md` | 当前队伍（椿 · 散华 · 维里奈）的数据确认结果与待办 |
| `m0-conclusions.md` | 当前队伍的结论：副词条先堆哪个、共鸣效率要多少、手慢几帧掉多少（注明按哪条轴、哪个数据版本算的） |
| `xin-confirm.md` | 心 · 雷主 · 卜灵 队伍的确认清单：按数据原文的轴接不上的地方、按原文推断的机制、电磁效应的结算（第二步）怎么算的与要实测的 |
| `xin-conclusions.md` | 心 · 雷主 · 卜灵 的结论：副词条先堆哪个（心先把共鸣效率堆到约 130%）、共鸣效率要多少、手慢几帧掉多少、电磁效应两处读法的敏感度（注明按哪条轴、哪个数据版本算的） |
| `team3-candidates.md` | 第三支队伍的候选：两个账号里装满声骸、还没写模块的角色，数据要处理多少（待处理的推断值、没连上倍率的判定） |

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
pnpm search scenarios/m0-team.yaml           # 轴搜索（TD-10 §6.1）：在循环轴上挪动首位声骸 Q（--move 别的动作、--drop 试着去掉、--swap 对调相邻两个、--insert A1~ 插入、--char 只改谁、--rounds 3 多轮），
                                             # 每种完整跑一遍、按稳态 DPS 排名；--save 新.yaml 另存最好的一条，再 pnpm compare 看差在哪。比原轴好的改法要拿实战核对
pnpm sim scenarios/m0-team.yaml --sample 300 # 抽样模式（总设计 T4）：逐段抽暴击跑 300 次看 DPS 分布；--jitter 6 另加 0–6 帧操作抖动，--seed 换种子
pnpm optimize scenarios/m0-team.yaml --inv inventory/m0-equipped.yaml --char 椿   # 声骸库存择优（TD-13）：首位与套装件数不变，列出完整仿真最好的几套
pnpm import:scan data/scan/<账号>-echo.json [--out …] [--nanoka <版本>] # wavescan 扫描导出（WutheringToolsScan v1）转声骸库存 YAML；一个账号一份，缺省写到 inventory/<账号>-bag.yaml
pnpm assumptions                             # 假设登记表（总设计 T16）：现在怎么处理、依据、影响、怎么改；--md 打印成表格。pnpm sim 的末尾列出这次碰到的
pnpm conformance                             # 一致性样例（总设计 §10.1）：每个场景的装配结果（去掉钩子表）与事件日志、汇总写到 out/conformance/，换实现时对拍
pnpm web                                     # 网页（TD-12）：http://localhost:5317/，场景编辑与运行（可切换时间轴视图）、对比（含时间轴对照）、边际、择优、轴搜索；pnpm web:build 打包到 out/web（含数据，不发布）
                                             # 用域名访问时：WEB_HOSTS=<域名> pnpm web --port <端口> --host 0.0.0.0
pnpm timeline scenarios/m0-team.yaml        # 时间轴网页：结果嵌进 web/timeline.html，写到 out/<场景名>.html（浏览器直接打开）；下方有调试表
                                             # --view a|b|c|d|e 改用视图 A–E（TD-12 §2.1；E 是播放器式的原型），写到 out/<场景名>.<视图>.html
pnpm trace scenarios/m0-video.yaml          # 调试表（TD-11 §6）：某一轮的分段与逐条（--loop k、--seg），资源逐步（--res 协奏|能量|<核心资源名>，--char）；
                                             # 场景有 video 时对照视频；--hits 面板与逐下伤害（不暴击 / 暴击，对游戏跳字，docs/calibration/ 的跳字对照表就是它出的）；
                                             # --md 另写 out/<场景名>.trace.md
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
- 场景照配置写（比如声骸列表的第一个就是首位）。配置有疑问、或有另一种说法 / 打法时，不改原场景，另加一份只差这一处的对照场景（文件名带上差异，如 `xin-team-r5-绝息魄.yaml`），用 `pnpm compare 原.yaml 对照.yaml` 量差多少，确认清单与结论里注明。

## 与设计文档的差异（实现时的决定，下次改文档时并回）

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4；M1–M3 记下的 11 处已于 2026-10-03 并回总设计 v0.1.5 等；声骸与 M5 记下的 4 处已于 2026-10-04 并回总设计 v0.1.6 等，并新写 TD-10 v0.1；M4 敌人量表（TD-06 v0.2 §17）已于 2026-10-04 并回总设计 v0.1.7 等；时间轴网页、启动轴、谐度破坏的调整（不拆连段、附页2 规则、椿两种、按比例削白条）、版本清单与换成 20261003 版这 7 处已于 2026-10-04 并回总设计 v0.1.8、TD-01 v0.1.7、TD-02 v0.1.7、TD-03 v0.1.3、TD-06 v0.2.1、TD-08 v0.1.2、TD-09 v0.1.4、TD-10 v0.1.2（各文档附录的变更历史逐条列出）；补位后缀、视频轴转正、M0 代表轴换装、调试工具与 TD-11、开局核心资源、视频时间点、核心资源改名这 7 处已于 2026-10-05 并回总设计 v0.1.9、TD-02 v0.1.8、TD-06 v0.2.2、TD-08 v0.1.3、TD-09 v0.1.5、TD-10 v0.1.3（机制设计 v0.2.9 同时标为冻结）；原型期的方向（总设计 v0.2：T4、T12、T16、§10.1）带来的假设登记、好移植的写法、操作延迟与结论、抽样模式这 4 处已于 2026-10-17 并回总设计 v0.2、TD-02 v0.1.9、TD-03 v0.1.4、TD-08 v0.1.4、TD-09 v0.1.6、TD-10 v0.1.5、TD-12 v0.2.2。2026-10-18 视频轴核对时记下的 9 处（散华 ERZ、动作给的资源与出处、写了"变奏"的切人、视频轴两份、"进入即得"改叫"起手即得"、钩子记假设、地面出场技、伤害也按谁引发的算谁、引出原因）已于 2026-10-18 并回总设计 v0.2.1、TD-01 v0.1.8、TD-02 v0.1.10、TD-04 v0.1.5、TD-06 v0.2.3、TD-08 v0.1.5、TD-09 v0.1.7、TD-10 v0.1.6、TD-11 v0.1.1、TD-12 v0.2.3（m0-confirm §11 当天已同步）。2026-10-19、20 心 · 雷主 · 卜灵带来的 17 处（共鸣效率需求的下限、声骸库存一个账号一份、换成 20261019 版、异常效应的层数、带前缀并入的块、落地段与首位声骸按角色换版本、补位后面接写了"变奏"的切人、`module-guess`、协奏按武器阶数、大招的"不响应输入"也挡切人、视图 D 的检查器显示共鸣回路、散华的透视、视图 E、同元素的角色换深浅、异常效应的伤害、判定的"延迟"、异常效应两条假设的开关与"没碰到的不翻"）已于 2026-10-20 并回总设计 v0.2.2、TD-01 v0.1.9、TD-02 v0.1.11、TD-03 v0.1.5、TD-04 v0.1.6、TD-05 v0.1.2、TD-06 v0.2.4、TD-07 v0.1.2、TD-08 v0.1.6、TD-09 v0.1.8、TD-10 v0.1.7、TD-12 v0.2.4、TD-13 v0.1.2（各文档附录的变更历史逐条列出）。2026-10-20 视频轴 V7 / V9 关闭与一日花前的补位去掉、散华的重击爆裂先按住半秒、轴搜索第一版（`pnpm search`）、视图 E 的敌人改成顶上一条，这 4 处已于 2026-10-20 并回总设计 v0.2.3、TD-01 v0.1.10、TD-04 v0.1.7、TD-08 v0.1.7、TD-10 v0.1.8、TD-11 v0.1.2、TD-12 v0.2.5（m0-confirm §11–§13 当天已同步）；同日雷主首位用绝息魄的对照场景已并回 TD-08 v0.1.7 §5.4，做法写进上面的"约定"。之后的新决定记在下面：

1. `pnpm trace --hits`：面板与逐下伤害（2026-10-21，TD-11 §2 的前两层）。面板 = 静态面板 + 自己的常驻 buff（作用于自己或全队、不要求在前台；伤害加成按游戏面板的叫法合并，加深 / 最终伤害不列），出处后面写实际计入的数（原文常是 1 阶的数）；逐下伤害列每一下的不暴击 / 暴击 / 期望与生效的 buff（`src/engine/trace.ts` 的 `tracePanel`、`traceHits`，用例在 `tests/trace.test.ts`）。拿它出了两份跳字对照表（`docs/calibration/2026-10-21-跳字-心开场AAA.md`、`…-椿开场AAE.md`），等实测。要并回的：TD-11 §6 调试工具加 `--hits`，§2 提一句"先对面板、再对跳字"有现成的表。
2. 轴搜索第二版（2026-10-21，TD-10 §6.1 的"以后"做了三样）：`--swap` 对调同一角色相邻的两个动作（同一行相邻的，或行末与紧接着的同一角色那一行开头；两个都是补位、写法一样的不试），`--insert` 插入动作（轴里的写法，可带后缀；只插给有这个动作的角色，每行每个位置各一种；没人有这个动作时报错）；两者都是"另外试"，缺省仍只挪 Q。`--save` 用的"只换循环轴"挪到 `src/data/scenario-text.ts`（命令行与网页共用）；跑不通的原因名 `FAILURE_LABEL` 放进 `src/engine/search.ts`。网页新加"轴搜索"页：同命令行的选项，结果每条能另存成场景（存在浏览器里）、一键去对比页和原轴比。要并回的：TD-10 §6.1（候选多两种、例子）、TD-12（新页）。还没做：从零生成轴、状态分叉提速。
3. 对比页的时间轴对照（2026-10-21，原型）：两份场景按战斗秒对齐，每人上下两条（基准 / 对比），循环轴里两份不同的行描边，浅底是比较口径的窗口，下面是累计伤害差（对比 − 基准）的曲线（`src/report/diff-timeline.ts`，`web/app/src/views/DiffTimeline.svelte`；用例在 `tests/web.test.ts`）。改过的行逐行比，行数不同时从第一处不同起往后都算。要并回的：TD-12 对比页一节。
4. 对照场景三份（2026-10-21，按"约定"的做法）：`m0-video-eq-维里奈Q后移.yaml`（m0-confirm §14 D1，+0.55%）、`xin-team-r5-卜灵Q先放.yaml`（xin-confirm §6 C3，+2.25%）、`xin-team-r5-心共鸣效率.yaml`（xin-confirm §6 C2，X2，+13.30%）；第三支队伍的候选看数据齐不齐写在 `docs/team3-candidates.md`。没有要并回设计文档的，记在这里备查。
