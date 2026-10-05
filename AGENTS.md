# AGENTS.md —— 给编码代理（Claude Code、Codex、Antigravity…）的约定

鸣潮逐帧期望 DPS 仿真与配装择优工具。个人项目，原则：**实用、清晰、简单**。不追求工业级的安全性与一致性。

## 先读什么

设计文档都在 `docs/`，改代码前先读相关章节，并在代码注释与提交说明里引用章节号（如"TD-04 §4.2"）：

| 文档 | 管什么 |
|---|---|
| `wuwa-dps-engine-tech-design-v0.1.8.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、里程碑与进度 |
| `wuwa-dps-td01-data-dictionary-v0.1.7.md` | xlsx 每一列的含义与抽取规则（含声骸表、声骸属性、敌人与谐度破坏表、附页2 的偏谐规则）、版本清单与定位方式、nanoka 数据、装配默认映射、角色模块与声骸的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.7.md` | 全部类型与 zod schema（类型一览，代码以仓库为准） |
| `wuwa-dps-td03-damage-formula-v0.1.3.md` | 伤害公式与乘区、golden 抽取 |
| `wuwa-dps-td04-sim-kernel-v0.1.4.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定、尾部与独立时间线、冷却与充能 |
| `wuwa-dps-td05-switch-concerto-v0.1.1.md` | 切人、变奏 / 延奏、协奏清零、切人结束技能 |
| `wuwa-dps-td06-resources-v0.2.1.md` | 角色资源：大招能量分配与门槛、协奏时机、核心资源；敌人量表：偏谐与失谐、谐破冷却与按钮、谐度破坏（自动 / 手写 / 关闭）、白条（削韧值与按比例）与破盾回能、瘫痪（偏移 / 干涉 / 响应、异常效应以后） |
| `wuwa-dps-td07-buff-system-v0.1.1.md` | buff 实例、作用对象、触发与事件队列（含治疗事件、`ownerHas`）、消耗型 / 标记型、资源型效果、原文起草 |
| `wuwa-dps-td08-character-module-v0.1.2.md` | 角色模块怎么写：钩子、写法模式、M0 三人的模块 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.4.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、可选 `?`、插队、循环与启动轴 |
| `wuwa-dps-td10-output-report-v0.1.2.md` | 汇总指标与 DPS 口径、分轮与稳态、配装对比、副词条边际、命令行输出、时间轴网页 |
| `wuwa-dps-design-v0.2.9.md`（机制设计） | 游戏机制；与总设计冲突时以总设计附录 A 为准 |
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
scenarios/          场景文件（YAML）
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
pnpm check                                   # tsc 严格模式
pnpm test                                    # Vitest
pnpm test:py                                 # 构建脚本的 Python 单元测试
pnpm golden:perturb -- --rounds 20           # golden 扰动对拍（TD-03 §10.3）：改公式、改乘区拆分、换 xlsx 后跑一次，不进 CI
pnpm sim scenarios/m0-team.yaml              # 跑一个场景：终端打印汇总（循环时有分轮与稳态），事件日志写到 out/<场景名>.json
pnpm compare 基准.yaml 对比.yaml             # 两套配装 / 两条轴比稳态 DPS，按角色、动作、buff 覆盖率拆差在哪
pnpm marginal scenarios/m0-team.yaml --char 椿      # 副词条边际：各加一档（--tier avg|max|min）重跑，按 DPS 增加排序
pnpm timeline scenarios/m0-team.yaml        # 时间轴网页：结果嵌进 web/timeline.html，写到 out/<场景名>.html（浏览器直接打开）
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

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4；M1–M3 记下的 11 处已于 2026-10-03 并回总设计 v0.1.5 等；声骸与 M5 记下的 4 处已于 2026-10-04 并回总设计 v0.1.6 等，并新写 TD-10 v0.1；M4 敌人量表（TD-06 v0.2 §17）已于 2026-10-04 并回总设计 v0.1.7 等；时间轴网页、启动轴、谐度破坏的调整（不拆连段、附页2 规则、椿两种、按比例削白条）、版本清单与换成 20261003 版这 7 处已于 2026-10-04 并回总设计 v0.1.8、TD-01 v0.1.7、TD-02 v0.1.7、TD-03 v0.1.3、TD-06 v0.2.1、TD-08 v0.1.2、TD-09 v0.1.4、TD-10 v0.1.2（各文档附录的变更历史逐条列出）。之后的新决定记在下面：

1. **补位后缀 `~`（2026-10-04）**：动作后写 `~`（全角 `～` 也认；可以和 `!` 一起写，不能和 `?` 一起写）：只在它后面那个同一角色的普通动作因为状态条件（冷却、资源、角色钩子）放不出来时才打；等着出手的时候每 tick 再看一次，后面那个能放了就跳过（记 `skip`，code `filler`，列进 `Summary.skipped`）。编译期要求补位后面接同一角色的普通动作（中间可以隔同一角色的别的补位，不能隔切人、等待）。`RotationItem` / `Command` 加 `filler`，`WaitCode` 加 `filler`；冷却、资源、钩子三项检查抽成 `stateVerdict`。用途：视频轴一日花前"协奏不够多a一下"。下次改 TD-09 §2、§3.2 与 TD-02 时并回。
2. **视频轴转正（2026-10-04）**：草稿移到 `scenarios/m0-video.yaml`、进场景快照；一日花前写成 `A1~ A2~`：启动轴补两下，循环轴一下、两下交替。配装：椿的首位是梦魇·无冠者，词条按用户实际的（主词条暴击 22% / 攻击 150，副词条暴伤 13.8%、共鸣效率 8.4%、暴击 6.3%、防御 11.8%、防御 40），其余沿用 m0-team，满足视频给的硬性指标、不用再调；开局红椿·蕊按 0（都是 2026-10-05 用户确认）。稳态 DPS 30,458；固定打两下时 31,312（+2.8%）：这条轴每轮都是 27.15 秒、有空余，多打的 A 不占时间。下次改总设计 §12、§13 时并回。
3. **M0 代表轴换上用户实际的梦魇·无冠者（2026-10-05）**：`scenarios/m0-team.yaml` 椿的首位由异相·无妄者换成用户实际的梦魇·无冠者（词条同差异 2）；首位 Q 按这条轴"各位置都试过、取 DPS 最高"的做法挪到盛绽一轮之后、一日花之前（Q 只要 39 帧，每轮 34.30 → 31.77 秒）。稳态 DPS 29,368 → 31,023，场景快照已更新。TD-10 §2–§4 的例子（首位无妄者换无冠者的对比、椿的副词条边际）与总设计、TD-06 里 M0 代表轴的数字下次并回时重算。
