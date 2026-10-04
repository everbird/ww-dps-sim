# AGENTS.md —— 给编码代理（Claude Code、Codex、Antigravity…）的约定

鸣潮逐帧期望 DPS 仿真与配装择优工具。个人项目，原则：**实用、清晰、简单**。不追求工业级的安全性与一致性。

## 先读什么

设计文档都在 `docs/`，改代码前先读相关章节，并在代码注释与提交说明里引用章节号（如"TD-04 §4.2"）：

| 文档 | 管什么 |
|---|---|
| `wuwa-dps-engine-tech-design-v0.1.7.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、里程碑与进度 |
| `wuwa-dps-td01-data-dictionary-v0.1.6.md` | xlsx 每一列的含义与抽取规则（含声骸表、声骸属性、敌人与谐度破坏表）、nanoka 数据、装配默认映射、角色模块与声骸的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.6.md` | 全部类型与 zod schema（类型一览，代码以仓库为准） |
| `wuwa-dps-td03-damage-formula-v0.1.2.md` | 伤害公式与乘区、golden 抽取 |
| `wuwa-dps-td04-sim-kernel-v0.1.4.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定、尾部与独立时间线、冷却与充能 |
| `wuwa-dps-td05-switch-concerto-v0.1.1.md` | 切人、变奏 / 延奏、协奏清零、切人结束技能 |
| `wuwa-dps-td06-resources-v0.2.md` | 角色资源：大招能量分配与门槛、协奏时机、核心资源；敌人量表：偏谐与失谐、谐度破坏（自动 / 手写 / 关闭）、白条与破盾回能、瘫痪（偏移 / 干涉 / 响应、异常效应以后） |
| `wuwa-dps-td07-buff-system-v0.1.1.md` | buff 实例、作用对象、触发与事件队列（含治疗事件、`ownerHas`）、消耗型 / 标记型、资源型效果、原文起草 |
| `wuwa-dps-td08-character-module-v0.1.1.md` | 角色模块怎么写：钩子、写法模式、M0 三人的模块 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.3.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、可选 `?`、插队、循环 |
| `wuwa-dps-td10-output-report-v0.1.1.md` | 汇总指标与 DPS 口径、分轮与稳态、配装对比、副词条边际、命令行输出 |
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

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4；M1–M3 记下的 11 处已于 2026-10-03 并回总设计 v0.1.5 等；声骸与 M5 记下的 4 处已于 2026-10-04 并回总设计 v0.1.6 等，并新写 TD-10 v0.1；M4 敌人量表（TD-06 v0.2 §17）已于 2026-10-04 并回总设计 v0.1.7、TD-01 v0.1.6、TD-02 v0.1.6、TD-03 v0.1.2、TD-04 v0.1.4、TD-09 v0.1.3、TD-10 v0.1.1（各文档附录的变更历史逐条列出）。之后的新决定记在下面：

1. **时间轴网页（M6 第一步，2026-10-04）**：`web/timeline.html` 是模板（自带样式与脚本，不用构建），`pnpm timeline <场景>`（`src/cli/timeline.ts`）跑完仿真把结果和画图要的元数据（队伍、能量上限、敌人量表、排轴原文、各动作的类别）嵌进去，写 `out/<场景名>.html`；`--fragment` 不带 `<!doctype>` 与 `<head>`。模板也能直接打开，再选 `pnpm sim` / `pnpm timeline` 写出的 JSON。`HitEvent` 新增可选的 `enemy`（这次结算后的偏谐值与白条，画曲线用）。下次改 TD-02 §7、TD-10 §5 时并回；写 TD-12（网页）时并入。
2. **启动轴 `opening`（2026-10-04）**：场景可以写 `opening`（语法同 `rotation`），只跑一次、记为第 0 轮（`loop` 事件、`perLoop` 里的"启动"），之后 `rotation` 循环 `repeat` 轮；稳态只看循环轴的轮（第 2 轮到倒数第 2 轮；循环轴只有 1 轮时没有稳态）。编译时前台从启动轴结束处推起，报错写"启动第 k 条"。`Command` 不变，`QueueState` 与 `ResolvedScenario` 加 `opening`。下次改 TD-09 §3.7、TD-02、TD-10 §2 时并回。
3. **自动谐度破坏不拆连段（2026-10-04）**：`options.tuneBreak: auto` 时，队首指令是连段的后续（动作有 `comboFrom`）就先不插，等这串连段打完、队首不是连段后续时再插。谐度破坏会打断当前角色的任何动作（m0-confirm §10 H1），插在连段中间时后面的连段接不上，轴报"只能接在 … 之后"（视频轴第 2 轮的"闪AAAEQ"）。下次改 TD-09 §3.2（插队）、TD-06 §13.4 时并回。
4. **偏谐通用规则按 xlsx 附页2；椿的两种谐度破坏（2026-10-04）**：构建从「附页2」"偏谐机制·通用"的说明文字（20260707 版 B227）抽出谐破冷却（按敌人 COST：1C / 3C 6 秒、4C 3 秒；红名 3 秒，敌人表里没有红名，不用）与谐度破坏按钮时长（3 秒），写进 `tune-break.json` 的 `rules`（认不出时 null 并警告，仿真按 5 秒、按钮不限时）。真空期改按敌人 COST（去掉 `rules.tuneBreakLock`，改为 `ResolvedScenario.tuneBreakTiming`）；新增按钮：前台角色对失谐目标打出偏谐值不为 0 的一段（让目标失谐的那段也算）后亮 3 秒（战斗帧），亮着才能放谐度破坏，后台的命中不点亮。椿在盛绽里放盛绽谐度破坏（`谐度破坏-时停`，别名 `盛绽·谐度破坏`），白椿放常态的，由钩子 `canStart` 判断，自动插的时候挑钩子允许的那个。m0-confirm §10 H2、H4、H5。下次改 TD-01 §11.3（附页2 不再是"不读"）、TD-02、TD-06 §13 时并回。
5. **按比例削白条（2026-10-04）**：构建读 dmg CZ 列 `Damage.Percent0`（TD-01 §4 原为"v0 不读，留给 TD-06"），÷ 10000 记在判定的 `dmg.whiteBarRatio`（只在不为 0 时写），装配进 `gauges.whiteBarRatio`；仿真每段按白条上限的这个比例削，与削韧值相加。谐度破坏各段合计 12.5%（附页2 原文同），另有卜灵"重击-震艮"2%、渊武"延奏-削白条"7.5%、釉瑚"诗中物-飞白"0.5%。m0-confirm §10 H3。下次改 TD-01 §4、§11、TD-02、TD-06 §13.2 时并回。
6. **xlsx 版本清单；构建不怕插行（2026-10-04）**：`data/xlsx-versions.json` 记各版本 xlsx 的文件名、sha256、资源版本与 `current`，构建缺省用 current（在 `data/raw/` 及子目录里按文件名找、核对哈希，`tools/build/versions.py`），换版本只改 current（总设计 T15）。20261003 版在 base 页插了一列、「伤害计算」「伤害配置」整段下移，所以构建不再写死位置：base 页的列按第 55 行表头名找（`base_cols.py`）；「伤害计算」的角色块、两张表按标记行找（A 列"其他"、"光噪效应（对目标）"、谐度破坏表头）；golden 拆乘区时「伤害配置」的行号按段名（A 列 def、dmgchg、dmgampl1-9…、面板、聚爆效应121）平移，谐度破坏 / 异常效应按 base 表头认。20260707 版的产出逐字节不变。另：角色三维的 schema 允许防御为 0（20261003 版景燃就是 0，构建警告）；T03-7b、M2-6 按 golden 夹具里计算器的配置算（不再写死秧秧·玄翎）。下次改 TD-01 §1、§5、§11 与总设计 T15 时并回。
7. **数据切到 20261003 版（2026-10-04）**：`data/xlsx-versions.json` 的 current 改为 20261003（资源版本 3.6.13），nanoka 仍按 3.7 构建。对 M0 三人只有两处变化：散华"大招-引爆冰川"协奏 0 → 15（视频轴里散华切维里奈从隔轮变奏变成每轮变奏）、谐度破坏按钮 3 → 5 秒（附页2）；M0 代表轴稳态 DPS 不变（29,368），场景快照不变。写死旧版数字的全量用例改成新版的（声骸 85、动作组 1721、例外组 23、连段 130、golden 分类 3163 / 173 / 30 / 52），场景的 `data` 改为 "20261003"。设计文档里写的 20260707 与 xlsx 行号（如椿 R1792，新版 R2014）下次并回时改；m0-confirm 开头注明了新旧行号的换算。
