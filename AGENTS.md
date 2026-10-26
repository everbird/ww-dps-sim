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
| `wuwa-dps-engine-tech-design-v0.2.4.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、好移植的写法（§10.1）、里程碑与进度 |
| `wuwa-dps-td01-data-dictionary-v0.1.11.md` | xlsx 每一列的含义与抽取规则（含声骸表、声骸属性、敌人与谐度破坏表、附页2 的偏谐规则）、版本清单与定位方式、nanoka 数据、装配默认映射、角色模块与声骸的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.12.md` | 全部类型与 zod schema（类型一览，代码以仓库为准），含出处的类型（资源出处、命中的来由） |
| `wuwa-dps-td03-damage-formula-v0.1.5.md` | 伤害公式与乘区（含异常效应伤害在仿真里怎么用）、golden 抽取 |
| `wuwa-dps-td04-sim-kernel-v0.1.7.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定（含"延迟"）、尾部与独立时间线、冷却与充能 |
| `wuwa-dps-td05-switch-concerto-v0.1.3.md` | 切人、变奏 / 延奏、协奏清零、切人结束技能、切人锁从哪来（"第nF前不能切人"、无敌两列、没写帧数的、大招出招阶段） |
| `wuwa-dps-td06-resources-v0.2.4.md` | 角色资源：大招能量分配与门槛、协奏时机、核心资源；敌人量表：偏谐与失谐、谐破冷却与按钮、谐度破坏（自动 / 手写 / 关闭）、白条（削韧值与按比例）与破盾回能、瘫痪；异常效应（§18：层数与电磁爆发、定时结算、钩子主动触发与消耗；偏移 / 干涉 / 响应以后） |
| `wuwa-dps-td07-buff-system-v0.1.2.md` | buff 实例、作用对象（含 `ownerOnField`）、触发与事件队列（含治疗事件、`ownerHas`、异常效应的敌人状态）、消耗型 / 标记型、资源型效果（按武器阶）、原文起草 |
| `wuwa-dps-td08-character-module-v0.1.7.md` | 角色模块怎么写：钩子（含只读的显示钩子 `forte`）、写法模式、M0 三人与心 · 雷主 · 卜灵的模块 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.11.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、可选 `?`、补位 `~`、插队、循环与启动轴、出场技要普通切人入场、空中入场 |
| `wuwa-dps-td10-output-report-v0.1.17.md` | 汇总指标与 DPS 口径、分轮与稳态、配装对比、副词条边际、结论（共鸣效率需求与下限、操作容错、假设敏感度）、轴搜索（在现成的轴上挪动 / 去掉 / 对调 / 插入动作）、套路卡与按套路排轴（§6.2：`pnpm cards`、`pnpm plan` 第一版与套路次数可变；卡上的模型未做）、评价轴的多个维度（§6.3：比较的目标 `goal` 稳态 / 打死几倍血 / 前 N 秒、轴卡片 `pnpm scorecard`）、命令行输出、时间轴网页（含检查器的逐帧资源、共鸣回路状态与冷却） |
| `wuwa-dps-td11-debug-calibration-v0.1.3.md` | 对不上时怎么查：说清楚、分层、从粗到细、做实验；案例；调试工具（`pnpm trace`、面板与逐下伤害 `--hits`、网页调试表、视频时间点）与改进；出处的归属规则（谁引发的算谁） |
| `wuwa-dps-td12-web-v0.2.7.md` | 网页（Vite + Svelte 5，本机用）：结构、各页（含结论页、场景页的假设、轴搜索页（局部改动 / 按套路排轴）、对比页的时间轴对照）、Worker、时间轴的视图 A–E（步进、检查器与共鸣回路、资源与伤害的出处、"轴可能有问题"；E 是播放器式的原型，敌人在顶上一条）、手机与 iPad（触摸操作、全屏）、检查 |
| `wuwa-dps-td13-echo-optimizer-v0.1.2.md` | 声骸库存择优：库存写法（一个账号一份）、快速重算、搜索与完整仿真确认 |
| `calibration/` | 实测与校准记录（格式见其中 README） |
| `wuwa-dps-design-v0.2.9.md`（机制设计，已冻结） | 写总设计之前的游戏机制规格书，不再更新；与总设计、各 TD 冲突时以它们为准（勘误见总设计附录 A，开头有按章节找现在文档的对照表） |
| `m0-confirm.md` | 当前队伍（椿 · 散华 · 维里奈）的数据确认结果与待办 |
| `m0-conclusions.md` | 当前队伍的结论：副词条先堆哪个、共鸣效率要多少、手慢几帧掉多少（注明按哪条轴、哪个数据版本算的） |
| `xin-confirm.md` | 心 · 雷主 · 卜灵 队伍的确认清单：按数据原文的轴接不上的地方、按原文推断的机制、电磁效应的结算（第二步）怎么算的与要实测的 |
| `xin-scorecard.md` | 心队 7 条轴的轴卡片（按稳态、按打死 2 倍血），末尾的表由 `pnpm scorecard` 生成，开头有手写的读法 |
| `xin-conclusions.md` | 心 · 雷主 · 卜灵 的结论：副词条先堆哪个（心先把共鸣效率堆到约 130%）、共鸣效率要多少、手慢几帧掉多少、电磁效应两处读法的敏感度（注明按哪条轴、哪个数据版本算的） |
| `jys-confirm.md` | 景燃 · 尤诺 · 守岸人（景尤守）的确认清单：文字轴怎么落成场景（按住 Z 的读法等）、按原文推断的机制（护盾、鬼护、星域…）、引擎为这队加的东西、要实测的 |
| `jys-videos.md` | 景尤守的三份攻略轴（5R18Z、5R20Z、轮椅）怎么写成场景、和视频对时间（一轮多长、哪段慢）、视频带出来的引擎问题（大招全局时停里能不能切人） |
| `jms-confirm.md` | 景燃 · 莫特斐 · 守岸人（景莫守）的确认清单：配装（莫特斐用 Evariste 账号）、莫特斐的模块（火焰闪电、怒气值、浮翼狂想的加强音与公用冷却、各链）、作者流程图怎么落成场景（出场技、补位）、要实测的 |
| `tys-confirm.md` | 桃祈 · 渊武 · 散华（全 4 星桃渊散）：照你自己的录像把整局记成场景（`tys-video.yaml`，录像剖析，视图 F 对视频用）、怎么记的与对不上的地方；渊武、桃祈的模块与推断 |
| `alm-confirm.md` | 爱弥斯 · 琳奈 · 莫宁 / 守岸人（爱琳莫、爱琳守）的确认清单：养成、偏移 / 干涉 / 响应（震谐）怎么算、三人的模块与要实测的 |
| `video-input-guide.md` | 攻略视频与文字轴：什么材料有用（连续实战 + 计时器、作者流程图、自己账号的录像）、文字轴的写法、给 Gemini 的提示词、怎么拿视频核对 |
| `team-scorecard.md` | 景尤守、爱琳莫、爱琳守、心队、M0 的代表轴卡片（`pnpm scorecard` 生成，开头有手写的读法）：稳态、打死几倍血、手速、养成门槛、最脆弱的假设 |
| `team3-candidates.md` | 第三支队伍的候选：两个账号里装满声骸、还没写模块的角色，数据要处理多少（待处理的推断值、没连上倍率的判定） |
| `endgame-fights.md` | 两队打深塔、矩阵几只 boss 各要多少战斗秒（单体近似，没算场地 buff、多波、时限），只能横向比 |
| `matrix.md` | 矩阵（终焉矩阵 · 奇点扩张）的计分规则（取自 DPM-Team-Builder，血量与敌人表"矩8"对得上）、`pnpm matrix` 怎么接力、两队的出场顺序 |
| `rotation-video.md` | WuwaLAB 的轴页怎么分析一条轴、和我们比；视图 E 的视频对照（锚点、联动、导出 video.marks）怎么用与限制；视图 F（对视频）与照录像记的轴 |
| `wuwalab-crosscheck.md` | 与 WuwaLAB 动作数据的核对（`pnpm crosscheck:wuwalab --md` 生成，开头有手写的读法：已经据此改了的、留作线索的） |
| `assumption-sensitivity.md` | 假设敏感度矩阵（`pnpm sensitivity --md` 生成，末尾有手写的读法）：每个开关翻过来各场景变多少、哪些对照的结论会变 |
| `engine-quality-plan.md` | 引擎准确性计划（2026-10-22 起，功能先冻结）：现状、教训、P1–P6（不变量检查、假设敏感度、量法、校准、数据层）与进度 |
| `verify-guide.md` | 进游戏验证手册：每项的账号、操作、看什么、交什么、答案改变什么；时间不够时先做哪几项；回答模板 |

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
pnpm build:data -- --strict 椿,散华,维里奈,卜灵,雷主·男,心,照世心,景燃,尤诺,守岸人,莫宁,琳奈,爱弥斯,机兵爱弥斯,莫特斐,桃祈,渊武 --nanoka 3.7   # 读 data/xlsx-versions.json 的 current（核对 sha256）；也可直接传 xlsx 路径；
                                             # --strict 名单有未连上的伤害判定时退出码 1
                                             # 顺带抓 nanoka（缓存在 data/raw/nanoka/，--nanoka off 跳过，--nanoka 3.6 指定版本）
pnpm check:data                              # 用 zod schema 校验 data/generated/
pnpm check:data -- --flags 椿,散华,维里奈    # 另外列出这些角色装配后还没处理的 flag（TD-01 §14），以及手填冷却与 nanoka 对不上的地方
pnpm check                                   # tsc 严格模式 + svelte-check（网页）
pnpm test                                    # Vitest
pnpm test:py                                 # 构建脚本的 Python 单元测试
pnpm golden:perturb -- --rounds 20           # golden 扰动对拍（TD-03 §10.3）：改公式、改乘区拆分、换 xlsx 后跑一次，不进 CI
pnpm sim scenarios/m0-team.yaml              # 跑一个场景：终端打印汇总（循环时有分轮与稳态），事件日志写到 out/<场景名>.json
pnpm compare 基准.yaml 对比.yaml             # 两套配装 / 两条轴比稳态 DPS（或场景 goal 写的目标），按角色、动作、buff 覆盖率拆差在哪
                                             # --goal kill:2 打死 2 倍敌人生命要多少战斗秒（启动轴算在内）、window:60 前 60 秒、steady；--repeat N 多跑几轮；--enemy 42塔中1/无冠者 换敌人（TD-10 §6.3）；
                                             # sim / run search / plan / insight / sensitivity 也认这两个
pnpm marginal scenarios/m0-team.yaml --char 椿      # 副词条边际：各加一档（--tier avg|max|min）重跑，按 DPS 增加排序
pnpm insight scenarios/m0-team.yaml          # 结论（TD-10 §6）：共鸣效率需求、操作容错（--delays 0,3,6,10,15）、假设敏感度、指令被挡住的时间、卡帧点（--tight 6：每个决策点单独晚 6 帧，分连锁 / 一轮变长 / 有余量 / 反而更好）
pnpm run search scenarios/m0-team.yaml       # 轴搜索（TD-10 §6.1；要写 run，pnpm 自带的 search 是搜 npm 包）：在循环轴上挪动首位声骸 Q（--move 别的动作、--drop 试着去掉、--swap 对调相邻两个、--insert A1~ 插入、--char 只改谁、--rounds 3 多轮），
                                             # 每种完整跑一遍、按稳态 DPS 排名；--hand 熟练 按真人操作打分；--save 新.yaml 另存最好的一条，再 pnpm compare 看差在哪。比原轴好的改法要拿实战核对
pnpm cards scenarios/m0-video-eq.yaml        # 套路卡（TD-10 §6.2）：轴里每一行当一个套路，单独量入场（接着打 / 普通 / 变奏）× 出口（切走 / 接自己）× 有没有铺垫的
                                             # 时长、资源、伤害、给的 buff，另列队里每轮的这一段对不对得上；--char 只看谁。标出要前置状态的、切走时大招才刚开始的（查切人锁）
pnpm plan scenarios/m0-video-eq.yaml --width 3   # 按套路排轴（TD-10 §6.2 ④′）：循环轴的各行当套路、次数不变，重新排先后（beam search，前缀补完一轮跑仿真打分）；
                                             # 排满的按稳态排名、标出原轴排第几；--scoring surplus 只看前缀，--save 新.yaml 另存最好的一条。比原轴好的要拿实战核对
                                             # --vary 1 套路次数可以 ±1（多一段补位、少一段攻击…，按每秒伤害比；--extra 2 一轮最多多 / 少几个套路）
                                             # 场景里另写 search.routines（轴里没有的套路，max 每轮最多几次，缺省 1）也一起排
                                             # --opening 改排启动轴（循环轴不动，按整个窗口的 DPS 比；--save 只换启动轴）
                                             # --hand 熟练 按真人操作打分（每个决策点晚这一档的平均帧数）
                                             # --gen 另外自动生成套路（各人单放 E、R、Q，原轴各行在技能 / 大招 / 声骸 / 重击之前拆两半），慢很多，先用小的 --width
pnpm sim scenarios/m0-team.yaml --sample 300 # 抽样模式（总设计 T4）：逐段抽暴击跑 300 次看 DPS 分布；--jitter 6 另加 0–6 帧操作抖动，--seed 换种子；--hand 高手|熟练|普通 按手速档另加正态分布的延迟（假设 hand-speed）
pnpm optimize scenarios/m0-team.yaml --inv inventory/m0-equipped.yaml --char 椿   # 声骸库存择优（TD-13）：首位与套装件数不变，列出完整仿真最好的几套
pnpm import:scan data/scan/<账号>-echo.json [--out …] [--nanoka <版本>] # wavescan 扫描导出（WutheringToolsScan v1）转声骸库存 YAML；一个账号一份，缺省写到 inventory/<账号>-bag.yaml
pnpm assumptions                             # 假设登记表（总设计 T16）：现在怎么处理、依据、影响、怎么改；--md 打印成表格。pnpm sim 的末尾列出这次碰到的
pnpm calibrate                               # 校准点总表（docs/calibration/points.yaml）：仿真值、实测值、差多少；填了实测、超出容差的退出码 1；--md 出表格
pnpm fuzz                                    # 模糊测试（docs/engine-quality-plan.md P1）：各场景挪动 / 去掉 / 对调任一动作生成变体轴（--n 60 每个场景跑几条），查日志自洽（checkLog）、可重复、属性加了伤害不降；有问题退出码 1。改了引擎跑一次
pnpm scorecard a.yaml b.yaml …               # 轴卡片（TD-10 §6.3）：几条轴按四个维度各一张表——① 目标与打死 1/2/3 倍血的战斗秒 ② 手速档、操作密度 ③ 共鸣效率需求、链数 / 武器降档 ④ 碰到的假设、最脆弱的开关；★ 帕累托前沿；--goal、--md
pnpm matrix m0-video-eq.yaml xin-team.yaml   # 矩阵计分（docs/matrix.md）：几支队按每种出场顺序接力打一期矩阵（--stage 矩8），每队 120 秒，按伤害 × 轮次倍率折分；--md
pnpm crosscheck:wuwalab                      # 拿 WuwaLAB（社区站）的动作数据核对现有场景里的角色（命中帧、时停与切人、冷却、能量、协奏、优先级）；缓存 data/raw/wuwalab/，--refresh 重下，--md docs/wuwalab-crosscheck.md
pnpm sensitivity                             # 假设敏感度矩阵（P2）：全部场景 × 假设表里每个开关各跑一遍，对照场景比基准的收益在哪条假设下会变；--md docs/assumption-sensitivity.md 写成文档（保留末尾手写的读法）；录像剖析（purpose: replay）不跑
pnpm conformance                             # 一致性样例（总设计 §10.1）：每个场景的装配结果（去掉钩子表）与事件日志、汇总写到 out/conformance/，换实现时对拍
pnpm web                                     # 网页（TD-12）：http://localhost:5317/，场景编辑与运行（可切换时间轴视图）、对比（含时间轴对照）、边际、择优、轴搜索；pnpm web:build 打包到 out/web（含数据，不发布）
                                             # 用域名访问时：WEB_HOSTS=<域名> pnpm web --port <端口> --host 0.0.0.0
pnpm timeline scenarios/m0-team.yaml        # 时间轴网页：结果嵌进 web/timeline.html，写到 out/<场景名>.html（浏览器直接打开）；下方有调试表
                                             # --view a|b|c|d|e|f 改用视图 A–F（TD-12 §2.1；E 是播放器式的原型，F 是对视频的原型），写到 out/<场景名>.<视图>.html
pnpm trace scenarios/m0-video.yaml          # 调试表（TD-11 §6）：某一轮的分段与逐条（--loop k、--seg），资源逐步（--res 协奏|能量|<核心资源名>，--char）；
                                             # 场景有 video 时对照视频；--hits 面板与逐下伤害（不暴击 / 暴击，对游戏跳字，docs/calibration/ 的跳字对照表就是它出的）；
                                             # --md 另写 out/<场景名>.trace.md
pnpm test -u                                 # 场景汇总快照（tests/scenarios.test.ts）有变化、人工确认无误后更新快照（pnpm 10 会把 `--` 原样传给 vitest，别写成 `-- -u`）
```

**每次任务结束运行 `pnpm check && pnpm test && pnpm test:py`**；动了构建脚本或数据，再跑 `pnpm build:data -- --strict 椿,散华,维里奈,卜灵,雷主·男,心,照世心,景燃,尤诺,守岸人,莫宁,琳奈,爱弥斯,机兵爱弥斯,莫特斐,桃祈,渊武 --nanoka 3.7 && pnpm check:data`。

## 约定

- 时间一律帧（60fps），比例一律小数（12% 写 0.12）。
- 新增字段先改 schema（`src/data/generated.schema.ts` 等），再改产出方和使用方。
- `data/generated/` 只能由构建脚本写，绝不手改；表里的错误写进 `data/curated/` 修正，不改 xlsx。
- 改机制必须同时新增或修改一个用例；改公式必须跑通 golden（M1 起）。
- 推断出来的值要打 flag（TD-01 §13），让人能找到并确认。
- 中文键（角色名、动作名）原样使用，只 trim，不做模糊匹配。
- 场景照配置写（比如声骸列表的第一个就是首位）。配置有疑问、或有另一种说法 / 打法时，不改原场景，另加一份只差这一处的对照场景（文件名带上差异，如 `xin-team-r5-绝息魄.yaml`），用 `pnpm compare 原.yaml 对照.yaml` 量差多少，确认清单与结论里注明。

## 与设计文档的差异（实现时的决定，下次改文档时并回）

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4；M1–M3 记下的 11 处已于 2026-10-03 并回总设计 v0.1.5 等；声骸与 M5 记下的 4 处已于 2026-10-04 并回总设计 v0.1.6 等，并新写 TD-10 v0.1；M4 敌人量表（TD-06 v0.2 §17）已于 2026-10-04 并回总设计 v0.1.7 等；时间轴网页、启动轴、谐度破坏的调整（不拆连段、附页2 规则、椿两种、按比例削白条）、版本清单与换成 20261003 版这 7 处已于 2026-10-04 并回总设计 v0.1.8、TD-01 v0.1.7、TD-02 v0.1.7、TD-03 v0.1.3、TD-06 v0.2.1、TD-08 v0.1.2、TD-09 v0.1.4、TD-10 v0.1.2（各文档附录的变更历史逐条列出）；补位后缀、视频轴转正、M0 代表轴换装、调试工具与 TD-11、开局核心资源、视频时间点、核心资源改名这 7 处已于 2026-10-05 并回总设计 v0.1.9、TD-02 v0.1.8、TD-06 v0.2.2、TD-08 v0.1.3、TD-09 v0.1.5、TD-10 v0.1.3（机制设计 v0.2.9 同时标为冻结）；原型期的方向（总设计 v0.2：T4、T12、T16、§10.1）带来的假设登记、好移植的写法、操作延迟与结论、抽样模式这 4 处已于 2026-10-17 并回总设计 v0.2、TD-02 v0.1.9、TD-03 v0.1.4、TD-08 v0.1.4、TD-09 v0.1.6、TD-10 v0.1.5、TD-12 v0.2.2。2026-10-18 视频轴核对时记下的 9 处（散华 ERZ、动作给的资源与出处、写了"变奏"的切人、视频轴两份、"进入即得"改叫"起手即得"、钩子记假设、地面出场技、伤害也按谁引发的算谁、引出原因）已于 2026-10-18 并回总设计 v0.2.1、TD-01 v0.1.8、TD-02 v0.1.10、TD-04 v0.1.5、TD-06 v0.2.3、TD-08 v0.1.5、TD-09 v0.1.7、TD-10 v0.1.6、TD-11 v0.1.1、TD-12 v0.2.3（m0-confirm §11 当天已同步）。2026-10-19、20 心 · 雷主 · 卜灵带来的 17 处（共鸣效率需求的下限、声骸库存一个账号一份、换成 20261019 版、异常效应的层数、带前缀并入的块、落地段与首位声骸按角色换版本、补位后面接写了"变奏"的切人、`module-guess`、协奏按武器阶数、大招的"不响应输入"也挡切人、视图 D 的检查器显示共鸣回路、散华的透视、视图 E、同元素的角色换深浅、异常效应的伤害、判定的"延迟"、异常效应两条假设的开关与"没碰到的不翻"）已于 2026-10-20 并回总设计 v0.2.2、TD-01 v0.1.9、TD-02 v0.1.11、TD-03 v0.1.5、TD-04 v0.1.6、TD-05 v0.1.2、TD-06 v0.2.4、TD-07 v0.1.2、TD-08 v0.1.6、TD-09 v0.1.8、TD-10 v0.1.7、TD-12 v0.2.4、TD-13 v0.1.2（各文档附录的变更历史逐条列出）。2026-10-20 视频轴 V7 / V9 关闭与一日花前的补位去掉、散华的重击爆裂先按住半秒、轴搜索第一版（`pnpm search`）、视图 E 的敌人改成顶上一条，这 4 处已于 2026-10-20 并回总设计 v0.2.3、TD-01 v0.1.10、TD-04 v0.1.7、TD-08 v0.1.7、TD-10 v0.1.8、TD-11 v0.1.2、TD-12 v0.2.5（m0-confirm §11–§13 当天已同步）；同日雷主首位用绝息魄的对照场景已并回 TD-08 v0.1.7 §5.4，做法写进上面的"约定"。2026-10-21 记下的 8 处（`pnpm trace --hits`、轴搜索第二版与网页"轴搜索"页、对比页的时间轴对照、四份对照场景、TD-10 §6.2 套路卡与排轴的设计、"无敌期间不能切人"的切人锁（同日把其余没写帧数的"不能切人"也做成锁，flag `noSwitchUnframed`）、套路卡 `pnpm cards`、按套路排轴 `pnpm plan` 第一版）已于 2026-10-21 并回总设计 v0.2.4、TD-01 v0.1.11、TD-02 v0.1.12、TD-05 v0.1.3、TD-09 v0.1.9、TD-10 v0.1.10、TD-11 v0.1.3、TD-12 v0.2.6（对照场景记在 m0-confirm、xin-confirm 里，没有要并回的）。之后的新决定记在下面：

1. 声骸冷却与 nanoka 核对（2026-10-21，起因是 `docs/wuthery-data-crosscheck-2026-10-21.md` 的声骸冷却差异）：generated 的冷却取 xlsx「冷却」列，原有的 `cooldownText` 只比列与说明，两处同错的（梦魇·无常凶鹭都写 20 秒，解包与 nanoka 25 秒）查不出来。构建在连倍率后另比 nanoka 说明的"技能冷却"：不同时打声骸级 flag `cooldownNanoka`、记 `nanokaCooldown`（帧，否则 null；`GenEchoSchema` 新字段），构建报告列出；`echoes.ts` 写了 Q 的 `cooldown` 视为已处理（同 `cooldownText`）。这次报出的正好是那四个，已在 `echoes.ts` 按解包与 nanoka 覆盖：梦魇·无常凶鹭 25 秒、梦魇·赫卡忒 25 秒、角鳄 15 秒、霁息兽尊 20 秒（现有场景都没装在首位，结果不变）。用例：`tools/build/test_echoes.py`。要并回的：TD-01 §8（flag 与字段）、§14；TD-02 `GenEchoSchema`。
2. 准确性 P1、P2（2026-10-22，docs/engine-quality-plan.md §5）：跑完后的日志自洽检查 `checkLog`（`src/engine/invariants.ts`，场景快照测试顺带查）与 `pnpm fuzz`；假设的三个开关 `rules.forteKeepOnSwitch` / `ultInputLocksSwitch` / `invincibleLocksSwitch`（缺省都是现在的做法；`ActionDef.switchLockFromInvincible` 标出推断出来的切人锁；钩子 ctx 多了只读的 `rules`，心、卜灵的模块按 `forteKeepOnSwitch` 在切走时清状态）；`pnpm sensitivity` 与 `docs/assumption-sensitivity.md`；假设 `switch-no-lock` 的影响改为"大"；P3：稳态的误差条 `Summary.steady.spread`（`Basis.spread`，compare / search 显示）与漂移提示 `steadyDrift`，由此 C2 更正为长期约 +5.2%。要并回的：总设计 §11（不变量、模糊测试）、TD-02（Rules 三个键、ActionDef 字段、HookContext.rules）、TD-05 §2（切人锁的开关）、TD-08（钩子的 rules 与两个模块）、TD-10 §2（误差条、steadyDrift）、§6（敏感度矩阵）。
3. 时间膨胀类型为空的行与全局时停挡切人（2026-10-22，docs/engine-quality-plan.md §5 P5）：类型格空着、各侧系数都是 0 的膨胀行，按行名推断为全局时停 / 时停，记 flag `dilationTypeGuess`（雷主·男 / 女、穗穗、秧秧·玄翎的大招；系数不是 0 的记 `dilationTypeMissing` 并跳过）；`ActionDef.globalStopUntil`（按动作局部帧登记的全局时停结束帧），调度器在它之前不让切人，等待代码 `globalStop`；`pnpm crosscheck:wuwalab`；`plan --opening` 按场景 goal 打分（`OpeningResult.label`）。要并回的：TD-01 §13（两个 flag）与 dilations 一行、TD-02（`globalStopUntil`、`WaitCode`）、TD-04 §3、TD-05 §2（全局时停挡切人）、TD-09 §3.3（等待代码）、TD-10 §6.2 ④′（`--opening` 的口径）。
4. 落地段与养成门槛（2026-10-22）：装配加 flag `landingUnshifted`（有"…下落"行、后面的行帧数从落地算，角色模块没写 `shiftRows`；`shiftRows` 视为已处理）；椿 E2 补 `shiftRows`（第 58 帧落地）与优先级（第 81 帧降到 2），M0 全部重算（m0-conclusions §0）；nanoka 构建多抽角色星级 `rarity`（`NanokaCharacterSchema`），`CharacterDef.rarity`；轴卡片的养成门槛改为"5 星 0 链 1 精"基线、共鸣效率折成副词条条数；命令行 `--enemy`。要并回的：TD-01 §12（nanoka 的 rarity）、§13（`landingUnshifted`）、TD-02（`rarity`）、TD-08 §5（椿 E2）、TD-10 §6.3（已写）。
5. 矩阵计分（2026-10-22，docs/matrix.md）：规则与缺省值取自 DPM-Team-Builder v4.9.2（每队 120 秒、进场 1 秒、转场 1.5 秒，每万点伤害 × 轮次倍率 8.34 / 9.6 / 10.43，第 5 只 1.1 倍、打死 +1000，R4 起血量单利 +5%）；`src/engine/matrix.ts`（每队对每只 boss 各跑一次仿真、按时间接力，`relay` 是纯函数）与 `pnpm matrix`；假设 `matrix-relay`（只在 pnpm matrix 里用）。要并回的：TD-10 §6.3（矩阵当作一种目标）、总设计 §13（假设）。
6. 视图 E 的视频对照（2026-10-22，原型，docs/rotation-video.md）：控制条"视频"打开右栏，读本地视频文件；锚点（视频秒 ↔ 世界帧）按场景存在浏览器 localStorage，场景有 `video.marks` 时用它们当初始锚点（时间轴模型的 video.marks 多了绝对时刻 `at`）；换算 `WW.videoMap`（`web/designs/shared.js`：逐点拉伸 / 只按第一个点）；联动时视频驱动光标、视频停着时时间轴驱动视频；能落到某一行开头的锚点导出成 `video.marks`。要并回的：TD-12 §2.1（视图 E）、TD-11 §6 P2（视频时间点）。
7. 审查与验收报告的 R1–R7（2026-10-24，docs/engine-quality-plan.md §5 末尾，用例 `tests/review-fixes.test.ts`）：套装件数按不同种类计（`setPieces`、`echoSpecies`，装配与择优共用）；维里奈强化空中A1–A3 要光合能量；散华重击居合在重击爆裂之前被取消时引爆计时作废；`WeaponDef.curated`（被动没写成机制的武器提示只算主副属性）；`EchoDef.curated` 改为"写了首位加成或技能附带的效果"；边际分析、择优的基准跑不通时报错，边际的变体跑不通单独标出（`MarginalRow.error`）；`pnpm plan` 支持没有启动轴的轴（`renderRoutines` 的 onField / close 参数）、原轴总列出名次。要并回的：TD-13 §1、§4（套装按种类计）、TD-02（`WeaponDef.curated`、`EchoDef.curated` 的含义、`MarginalRow.error`）、TD-08 维里奈与散华、TD-10 §4（边际的失败）、§6.2（没有启动轴的排轴）、TD-01 §14（武器覆盖提示）。
8. 和 nanoka 核对段数、协奏、大招能量（2026-10-24，docs/engine-quality-plan.md §5 末尾）：`nanoka.json` 的技能多了 `values`（冷却以外的 level 条目在 10 级的原文；`NanokaCharacterSchema`）；`src/data/nanoka-check.ts` 的 `checkHits` / `checkConcerto` / `checkEnergyCost`，`pnpm check:data -- --flags` 列出；判定覆盖多了 `coreOncePerAction`（改多次结算时核心资源不跟着乘）；据此改了维里奈 E 第一段与强化空中A3（各 3 下）、雷主 A3（7 下）、心照世·A1 第一段倍率（12.55%，xin-confirm Y19）。要并回的：TD-01 §12（nanoka 的 values）、§14（check:data 的核对项）、TD-02（`NanokaCharacterSchema.values`、`JudgmentOverride.coreOncePerAction`）、TD-08 维里奈、雷主、心。
9. 景燃 · 尤诺 · 守岸人（2026-10-24，docs/jys-confirm.md §4）：护盾事件（`ctx.shield`、`SimEvent` 的 `shield`、触发事件 `shield`，护盾量不建模）；`BuffDef.scale` 按持有者的面板属性换算数值（装配时定，`ResolvedMember.stats`、钩子 `ctx.stat`，假设 `stat-scaling-static`）；钩子 `introAction` 选变奏动作；`ActionOverride.absorb`（并入别组的行）、`air`（改写在空中的帧，处理 `airGuess`）；`TriggerSpec.stacks`（这种触发加几层）；三人的模块、专武、首位声骸（海之女、万囮牢）与套装（冥途夜行之灯、荣斗铸锋之冠、啸谷长风），dmg-join。要并回的：TD-02（`shield` 事件、`BuffDef.scale`、`TriggerSpec.stacks`、`ResolvedMember.stats`、`ActionOverride.absorb / air`、`CharacterHooks.introAction`、`HookContext.shield / stat`）、TD-05 §2（变奏动作的选择）、TD-07（护盾触发、按属性换算）、TD-08（三人的模块）、总设计 §13（假设）。
10. 接续写的优先级（2026-10-24，`chainedPriority`，用例 T01-16）：一组里几行各写一段优先级、后一行起始值 = 前一行末值时，按行序串起来；各行变化帧取 K 列 → 本行备注 → 本行派生帧（推断，`priorityChangeGuess`）；一行写的帧比它要的多时（凌阳 A3-1 备注"第6F、34F"），多的留给后面没写帧的行；帧数要严格递增，有"下落"行而落地段没后移时不串，否则照旧只取一行。全库 28 个动作因此变了，凌阳 A3 → A4 原来断的连段接上了（心的步红尘 / 镇红尘、景燃的重击与原来手写的覆盖相同，覆盖已去掉；其余是没写模块的角色）。要并回的：TD-01 §13.1（优先级的取法）。
11. 稳态起点自动跳过漂移的轮（2026-10-24，docs/engine-quality-plan.md §5 P3，`steadyStart`）：第 2 轮起有一轮离合并 DPS 1% 以上时，取最早一个"之后每一轮都在 ±1% 以内"的起点（至少留 4 轮、不少于一半；判的时候不算谐度破坏的伤害）；找不到照旧第 2 轮；挪了提示 `steadySkip`。心队 4 个对照场景的稳态变了（C2 比主场景 +15.6% → +13.2%）。要并回的：TD-10 §2（稳态口径）、总设计 §13（假设 steady-window 的写法）。
12. 模糊测试按连段整块的变体（2026-10-24，docs/engine-quality-plan.md §5 P1，`blockChanges`、`tests/fuzz.test.ts`）：一行里接得上的连段算一块，整块挪动、去掉、对调；单个动作的变体与整块的各抽一半。要并回的：总设计 §11（模糊测试）。
13. 校准点（2026-10-24，docs/calibration/README.md、docs/engine-quality-plan.md P4）：`docs/calibration/points.yaml` 登记能拿实测对照的数（面板一项、某一下的跳字、一轮的时长；schema `src/data/calibration.schema.ts`），`src/engine/calibration.ts` 取仿真值并比对（跳字按"不暴击 / 暴击"里接近实测的那个比），`pnpm calibrate [--md]` 出总表，`tests/calibration.test.ts` 把填了实测的点按容差检查、没填的列成待测。要并回的：TD-11 §6（调试工具）、总设计 §11（校准）。
14. 补位后面接变奏切人、buff 覆盖率（2026-10-25，docs/jys-videos.md §6）：补位后面紧接 `switch <角色> 变奏`、切出者协奏没满、补的那一下还有判定没出手时，切人等它出手（等待代码 `settled`；原来同一帧切掉，最后一下补位总是白打，用例 td09）；`buffUptime` 到期当帧又挂上的从上一段的终点接着算（原来那一帧算两次，整局不断的计时 buff 覆盖率超过 1，用例 summary）。要并回的：TD-09 §3.2（补位）、TD-10 §2（覆盖率）。
15. 写了"不能切人"、比全局时停早的动作（2026-10-25，docs/jys-videos.md §6.3，修订差异第 3 条）：守岸人大招"第178F前不能切人"、全局时停 207 帧，视频 A 逐帧量出约 180 帧就切人、计时器接着走。现在写了的切人锁比全局时停早结束时，过了锁就能切；切人时切出者登记的时停、全局时停一起结束（推断出来的锁不算）。开关 `rules.switchEndsStop`（缺省 true，false 是原来的做法），假设 `switch-ends-stop`，用例 td09；影响很小（jys-team 69,088 → 69,125，其余场景 DPS 不变）。要并回的：TD-02（Rules 的键）、TD-04 §3.3、TD-05 §2（全局时停与切人锁）、总设计 §13（假设）。
16. 偏移 / 干涉 / 响应（震谐，2026-10-25，docs/alm-confirm.md §2）：敌人的 `shift`（种类、谁挂的、剩余帧）与 `interference`、钩子 `ctx.applyShift`；谐度破坏命中挂着震谐·偏移的目标 → 震谐·干涉 8 秒（`rules.interferenceFrames`，偏移消耗、期间偏谐值不累积），队里有"震谐响应"动作的角色在独立时间线上各出一次响应（`rules.responseCooldown` 8 秒一次）；震谐响应伤害按 TD-03 §6 算（不再记 0）；`enemyState` 多了 `shiftEnd` / `interferenceEnd` / `response`；假设 `resonance-rules`，集谐没建。用例 `tests/resonance.test.ts`。要并回的：TD-06 新 §19（并改 §13、Q13）、TD-03 §6（响应的元素与没有对失谐项）、TD-02（`EnemyRuntime.shift / interference`、`ResonanceKind`、`HookContext.applyShift`、Rules 两个键、`ENEMY_STATE_CHANGES`）、总设计 §13（假设）。
17. 爱弥斯 · 琳奈 · 莫宁 / 守岸人（2026-10-25，docs/alm-confirm.md）：三人的模块（爱弥斯并入"机兵爱弥斯"块，前缀"机兵·"）、武器、套装、首位声骸，dmg-join；写了"变奏"的切人在切出者协奏没满、手上动作还有判定没出手时等它出手（原来只限补位，差异第 14 条，现在所有动作都等）；`BuffDef.scale` 与 `StaticStats` 多了 `tunabilityRate`（星构寻辉之环）；响应判定按脱手生成。要并回的：TD-08（三人的模块）、TD-09 §3.5（变奏切人等出手）、TD-02（`StaticStats.tunabilityRate`、`scale.stat`）、TD-01 §13（构建出的核心资源槽名、上限与各行对不上，见 alm-confirm Y1）。
18. 切人冷却每人单独计、脱手声骸不打断连段（2026-10-25 用户更正与确认，docs/jys-videos.md §1.1、docs/alm-confirm.md X1）：`CharRuntime.switchCd`（被切走的人 `rules.switchCooldown` 帧内不能切回来，切给别人不用等；原来是全局 `SimState.switchCd`，机制设计 5.4）；`CharRuntime.combo` 连段锚点（召唤类声骸不更新它，锚点动作结束后局部帧照走）；辛吉勒姆施放动作优先级 2 → 0。心队、M0 稳态不变（启动轴快几十帧），5R18Z +3.7%；删了前提不成立的对照场景 `jys-5r18z-切人冷却18.yaml`。要并回的：TD-09 §3.5（切人冷却）、TD-04 §6.2（连段锚点）、TD-02（`CharRuntime`）、总设计（机制设计 5.4 的勘误）。
19. 核心资源槽的核对（2026-10-25，docs/alm-confirm.md Y1）：`pnpm check:data -- --flags` 多列一项"核心资源槽"——某一槽单次加 / 扣的量比上限大（槽名或上限和动作表的列对不上）、或用到了但上限 ≥ 1000（按百分数记的），按角色模块改过的 coreNames / coreCaps 查（`src/data/core-check.ts`，用例 `tests/core-check.test.ts`）。要并回的：TD-01 §14（check:data 的核对项）、Q22。
20. 震谐的两个敏感度开关（2026-10-25，docs/assumption-sensitivity.md 读法 2026-10-25 一节）：假设 `resonance-rules` 挂上 `rules.interferenceFrames`（矩阵翻成 300 帧）；新假设 `track-no-consume` 与开关 `rules.trackNoConsume`（缺省 true，爱弥斯模块的记录点）。矩阵重跑（22 个场景 × 12 个开关）：干涉 5 秒时爱琳守 +11%，轨迹无消耗关掉爱琳莫 −4%。要并回的：TD-02（Rules 两个键）、TD-06 §19、总设计 §13（假设）。
21. 声骸起手的优先级（2026-10-25，docs/jys-videos.md §6.4）：`ActionDef.inputPriority`（起手时拿来和当前动作比的优先级），装配进角色时声骸动作取通用块"召唤声骸 / 变身声骸"行（5），声骸表各行（多为 0）当作放出来之后的；`gate` 的第三个参数、`GateResult.via` 多了 `echoInput`；开关 `rules.echoInputPriority`（缺省 true），假设 `echo-input-priority`（调度器记录）。声骸能打断重击（4）、多数技能的后摇，照样等判定出手。视频 A 守岸人变奏 → 大招一段 5.59 秒，改前 6.67、改后 5.52。多数场景稳态 +2%～+8%（M0 视频轴 EQ 版 −1.1%）；m0-conclusions、xin-conclusions 的数是改之前的。用例 T04-15、alm"声骸起手的优先级"。要并回的：TD-04 §6.1、TD-02（`ActionDef.inputPriority`、Rules 的键）、TD-01（通用块两行的用法）、总设计 §13（假设）。
22. 景燃 · 莫特斐 · 守岸人（2026-10-25，docs/jms-confirm.md）：莫特斐的模块（火焰闪电前置生成即爆炸、怒气值决定 E 是激昂变奏还是怒火赋格、浮翼狂想：登场角色普攻 / 重击命中给 1 / 2 发加强音、公用冷却 23 帧、节奏自由、1–6 链，1 / 5 链的额外加强音用 copyAs 另存成 `C1加强音` / `C5加强音`）；高天共奏之曲、赫卡忒首位、华彩乐段；dmg-join；地面出场技：景燃阳A2（"阳状态地面出场技复用"）、莫特斐 A4。调度器：切人后第一下是地面出场技、切进来的人自己在后台的动作还没走完时，切人等它走完（等待代码 `entryBusy`；原来直接报错 entrySkill"切回来时自己在后台的动作还没走完"，td09 用例跟着改）。构建的 --strict 名单加了莫特斐。用例 `tests/jms.test.ts`。要并回的：TD-08（莫特斐的模块、景燃的出场技）、TD-09 §3.3（等待代码）、§3.5（出场技的 busy 改成等）、TD-02（`WaitCode`）、TD-07（"协同攻击"目前按判定名过滤）。
23. 桃祈 · 渊武 · 散华与照录像记的轴（2026-10-25，docs/tys-confirm.md）：渊武的模块（雷柱：E 第 18 帧立柱、每秒 +6 锋芒、登场角色命中给协同（1.2 秒）、满锋芒放掀雷（连 P1 版）、万壑雷 / 大招引爆、雷厉风行换强化攻击、敛光切走留柱，2–6 链）、桃祈的模块（磐岩护壁、A4 换刚柔化势、御反之隙、后发制人单列，2–6 链）、凌冽决断之心与彻空冥雷、时和岁稔、梦魇·云闪之鳞首位加成，dmg-join；散华出场技 A2 之后接 A3（推断）。排轴新写法 `at <世界秒>`（`对时`）：等到世界帧，补位 `~` 可以看它（还没到就接着补）——原来 `at` 只有测试台能用。首位声骸不在声骸表里改成提示（只算词条与套装、没有 Q），原来报错。构建的 --strict 名单加了桃祈、渊武。`scenarios/tys-video.yaml`：照录像把整局一段段记下来，每段用 at 对到视频的时刻，video.marks 给视图 F 当锚点。用例 `tests/tys.test.ts`、td09"at <世界秒>"、echoes。要并回的：TD-08（两人的模块、散华出场技）、TD-09 §2（`at` 的写法）、§3.2（补位看 at）、TD-02（`RotationItem`）、TD-07（两个套装）、TD-11 §6 / TD-12 §2.1（照录像记轴的做法）。
24. 视图 F（对视频）与几处轴的修正（2026-10-25，docs/rotation-video.md §4）：新视图 F（`web/designs/f-video.html`，`pnpm timeline --view f`、网页"F 对视频"）：视频为主，下面整局时间轴与"此刻"（每人动作、资源、冷却，前台的 buff，最近伤害），右边分段（每次上场一行：视频时刻、谁、多久、全队伤害与占比、比视频快慢、打了什么；视频在放时高亮当前段，点一行跳过去）与锚点；视图 E 不变。景尤守 5R18Z 与尤诺快开大里景燃普通切入改成阳A2 出场技（79,244 → 79,442）；景莫守开头莫特斐写空中普攻、两段 E 写成 `E2? E1 E2?`、守岸人补位加到 3 轮，手慢时也跑得通（56,191 → 56,006）。轴卡片加了景莫守与心雷卜轮椅轴。要并回的：TD-12 §2.1（视图 F）。
25. 录像里看到的动作 `video.events`（2026-10-26，docs/rotation-video.md §4）：场景的 video 多一个 events，一条"<视频秒> <角色> <动作>"；时间轴模型带上（动作按别名换成 ID，换不了的为 null）；视图 F 在时间轴上画出来，分段里逐个和仿真比早晚，另列每段进场 → 离场的能量协奏。`tys-video.yaml` 记了 42 个。假设敏感度矩阵重跑（25 个场景）。用例 timeline。要并回的：TD-02（`video.events`）、TD-11 §6（视频时间点）、TD-12 §2.1（视图 F）。
26. 录像里敌人的血条 `video.hp` 与桃渊散逐帧重记（2026-10-26，docs/tys-confirm.md §0、§1，docs/rotation-video.md §4）：场景的 video 多一个 hp，一条"<视频秒> <剩余比例>"，第一条是血条出现的时刻；时间轴模型带上 hp 与敌人生命 `enemy.hp`；视图 F 在每秒伤害下面画"敌人生命"（录像的点、仿真从第一条起累计伤害的线）。`tys-video.yaml` 逐帧重记（切人、E、大招、声骸都对到约 0.1 秒，段里的 E / 大招 / 声骸也用 at 钉住；补了最后两段，录像 157.1 才打死）；录像前 43 秒打的是小怪，打死的战斗秒不能比，改比血条：到 100 秒差不到 2%，之后仿真少打约 18%。重记后 F5、F12、F13 翻了切人类型就和录像对不上、跑不通，第 27 条起敏感度矩阵不跑它。用例 timeline、tys。要并回的：TD-02（`video.hp`）、TD-11 §6（视频时间点）、TD-12 §2.1（视图 F）。
27. 场景的 `purpose`（2026-10-26 用户说明，docs/tys-confirm.md 开头）：rotation（缺省，轴：攻略、教学、配装对比，看 DPS、手速、假设敏感度）/ replay（录像剖析：照一局实战录像记下来，用时间轴与各种状态看懂这一局；敌人走位、出招不建模，DPS 只作参考）。`pnpm sensitivity` 扫 scenarios/ 时跳过 replay，`--md` 重写时保留末尾手写的"读法"各节；时间轴模型带上 purpose，视图 F 顶上标"录像剖析 · DPS 仅供参考"。`tys-video.yaml` 标成 replay。用例 timeline、tys。要并回的：TD-02（`purpose`）、TD-10 §6（敏感度矩阵跳过录像剖析）、TD-11 §6、TD-12 §2.1。
28. 声骸表里没有的声骸、可选的出场技（2026-10-26，docs/tys-confirm.md §3）：新的手写文件 `data/curated/extra-echoes.json`，构建时补进 echoes.json（`extra_echoes`，flag `curatedSource`，行号 `startRow` / `row` 记 0；帧取 WuwaLAB 的声骸数据，倍率经 dmg-join 连 nanoka 条目，说明取 nanoka），第一个是异构武装（散华首位，82 帧、第 50 帧命中 405% 冷凝；强袭功率与强化版没建）；`GenEchoSchema.startRow`、`GenRowSchema.row` 放宽到 ≥ 0。调度器：写成可选的出场技（`A2-地面出场技?`）这次不是地面普通切人入场时跳过（等待代码 `entry`，加进可跳过的），不报错。`tys-video.yaml` 的变奏 / 普通照录像的协奏环重记，变奏入场段的第一个普攻补位前加可选的出场技。用户确认：渊武雷柱协同每次命中都能触发（去掉 module-guess）、散华出场技后接 A3、盾反 = 后发制人。用例 td09、tys、echoes、`tools/build/test_echoes.py`。要并回的：TD-01 §8（补充声骸的来源与 flag）、TD-02（`startRow` / `row`、`WaitCode` 的 entry）、TD-09 §3.5（可选的出场技）、TD-08（渊武、散华）。
29. 录像剖析可以关掉谐度破坏（2026-10-26 用户说明，docs/tys-confirm.md §0）：`tys-video.yaml` 是 2025-11 的录像，那时游戏还没有谐度破坏，写 `options.tuneBreak: off`；关掉后切人都对上了。血条按段对照：75.7 秒以前仿真与录像差不到 1%，之后差在桃祈放大招的段；录像跳字显示桃祈大招比仿真高 18%～40%，主要是少算了深塔的环境特性。新文件 `data/curated/env-buffs.ts`（场景 buff，原来 `environment` 有字段、没有文件）：深塔 28 期左 4 的湮灭抗性 −10%、变奏后暴伤 +20% / 普攻 +40%（18 秒，给放变奏的人：target onField + trigger intro）；`tys-video.yaml` 引用。加了以后 44.08 的大招对到个位数，血条到 140 秒差不到 6%。用例 tys。要并回的：TD-07 §3（场景 buff 的文件与写法）。
30. 渊武的防御相关（2026-10-26，docs/tys-confirm.md §0）：掀雷（固有1 +50% 防御）、3 链协同（+20% 防御）改成加在倍率上（这两个判定本来按防御算），用当前防御，不再用装配时的静态防御；6 链的 32% 防御给全队、立柱当下就给（原来只给前台、立柱 1 秒后才给）；掀雷放完锋芒清空（推断，`module-guess`：录像里渊武离场时锋芒都没满，按此 105.3 桃祈大招跳字 49205 / 仿真 49192）。用例 tys。要并回的：TD-08（渊武）。
