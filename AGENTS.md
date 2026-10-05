# AGENTS.md —— 给编码代理（Claude Code、Codex、Antigravity…）的约定

鸣潮逐帧期望 DPS 仿真与配装择优工具。个人项目，原则：**实用、清晰、简单**。不追求工业级的安全性与一致性。

## 先读什么

设计文档都在 `docs/`，改代码前先读相关章节，并在代码注释与提交说明里引用章节号（如"TD-04 §4.2"）：

| 文档 | 管什么 |
|---|---|
| `wuwa-dps-engine-tech-design-v0.1.9.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、里程碑与进度 |
| `wuwa-dps-td01-data-dictionary-v0.1.7.md` | xlsx 每一列的含义与抽取规则（含声骸表、声骸属性、敌人与谐度破坏表、附页2 的偏谐规则）、版本清单与定位方式、nanoka 数据、装配默认映射、角色模块与声骸的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.8.md` | 全部类型与 zod schema（类型一览，代码以仓库为准） |
| `wuwa-dps-td03-damage-formula-v0.1.3.md` | 伤害公式与乘区、golden 抽取 |
| `wuwa-dps-td04-sim-kernel-v0.1.4.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定、尾部与独立时间线、冷却与充能 |
| `wuwa-dps-td05-switch-concerto-v0.1.1.md` | 切人、变奏 / 延奏、协奏清零、切人结束技能 |
| `wuwa-dps-td06-resources-v0.2.2.md` | 角色资源：大招能量分配与门槛、协奏时机、核心资源；敌人量表：偏谐与失谐、谐破冷却与按钮、谐度破坏（自动 / 手写 / 关闭）、白条（削韧值与按比例）与破盾回能、瘫痪（偏移 / 干涉 / 响应、异常效应以后） |
| `wuwa-dps-td07-buff-system-v0.1.1.md` | buff 实例、作用对象、触发与事件队列（含治疗事件、`ownerHas`）、消耗型 / 标记型、资源型效果、原文起草 |
| `wuwa-dps-td08-character-module-v0.1.3.md` | 角色模块怎么写：钩子、写法模式、M0 三人的模块 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.5.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、可选 `?`、补位 `~`、插队、循环与启动轴 |
| `wuwa-dps-td10-output-report-v0.1.3.md` | 汇总指标与 DPS 口径、分轮与稳态、配装对比、副词条边际、命令行输出、时间轴网页 |
| `wuwa-dps-td11-debug-calibration-v0.1.md` | 对不上时怎么查：说清楚、分层、从粗到细、做实验；案例；调试工具（`pnpm trace`、网页调试表、视频时间点）与改进 |
| `wuwa-dps-td12-web-v0.1.md` | 网页（Vite + Svelte 5，本机用）：结构、四页、Worker、检查 |
| `wuwa-dps-td13-echo-optimizer-v0.1.md` | 声骸库存择优：库存写法、快速重算、搜索与完整仿真确认 |
| `calibration/` | 实测与校准记录（格式见其中 README） |
| `wuwa-dps-design-v0.2.9.md`（机制设计，已冻结） | 写总设计之前的游戏机制规格书，不再更新；与总设计、各 TD 冲突时以它们为准（勘误见总设计附录 A，开头有按章节找现在文档的对照表） |
| `m0-confirm.md` | 当前队伍（椿 · 散华 · 维里奈）的数据确认结果与待办 |

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
pnpm build:data -- --strict 椿,散华,维里奈   # 读 data/xlsx-versions.json 的 current（核对 sha256）；也可直接传 xlsx 路径；
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
pnpm optimize scenarios/m0-team.yaml --inv inventory/m0-equipped.yaml --char 椿   # 声骸库存择优（TD-13）：首位与套装件数不变，列出完整仿真最好的几套
pnpm web                                     # 网页（TD-12）：http://localhost:5317/，场景编辑与运行、对比、边际、择优；pnpm web:build 打包到 out/web（含数据，不发布）
pnpm timeline scenarios/m0-team.yaml        # 时间轴网页：结果嵌进 web/timeline.html，写到 out/<场景名>.html（浏览器直接打开）；下方有调试表
pnpm trace scenarios/m0-video.yaml          # 调试表（TD-11 §6）：某一轮的分段与逐条（--loop k、--seg），资源逐步（--res 协奏|能量|<核心资源名>，--char）；
                                             # 场景有 video 时对照视频；--md 另写 out/<场景名>.trace.md
pnpm test -u                                 # 场景汇总快照（tests/scenarios.test.ts）有变化、人工确认无误后更新快照（pnpm 10 会把 `--` 原样传给 vitest，别写成 `-- -u`）
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

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4；M1–M3 记下的 11 处已于 2026-10-03 并回总设计 v0.1.5 等；声骸与 M5 记下的 4 处已于 2026-10-04 并回总设计 v0.1.6 等，并新写 TD-10 v0.1；M4 敌人量表（TD-06 v0.2 §17）已于 2026-10-04 并回总设计 v0.1.7 等；时间轴网页、启动轴、谐度破坏的调整（不拆连段、附页2 规则、椿两种、按比例削白条）、版本清单与换成 20261003 版这 7 处已于 2026-10-04 并回总设计 v0.1.8、TD-01 v0.1.7、TD-02 v0.1.7、TD-03 v0.1.3、TD-06 v0.2.1、TD-08 v0.1.2、TD-09 v0.1.4、TD-10 v0.1.2（各文档附录的变更历史逐条列出）；补位后缀、视频轴转正、M0 代表轴换装、调试工具与 TD-11、开局核心资源、视频时间点、核心资源改名这 7 处已于 2026-10-05 并回总设计 v0.1.9、TD-02 v0.1.8、TD-06 v0.2.2、TD-08 v0.1.3、TD-09 v0.1.5、TD-10 v0.1.3（机制设计 v0.2.9 同时标为冻结）。之后的新决定记在下面：

（暂无）
