# AGENTS.md —— 给编码代理（Claude Code、Codex、Antigravity…）的约定

鸣潮逐帧期望 DPS 仿真与配装择优工具。个人项目，原则：**实用、清晰、简单**。不追求工业级的安全性与一致性。

## 先读什么

设计文档都在 `docs/`，改代码前先读相关章节，并在代码注释与提交说明里引用章节号（如"TD-04 §4.2"）：

| 文档 | 管什么 |
|---|---|
| `wuwa-dps-engine-tech-design-v0.1.4.md`（总设计） | 架构、数据流、**第 4 节关键取舍（不得推翻）**、里程碑 |
| `wuwa-dps-td01-data-dictionary-v0.1.3.md` | xlsx 每一列的含义与抽取规则、装配默认映射、角色模块的覆盖字段 |
| `wuwa-dps-td02-types-schema-v0.1.3.md` | 全部类型与 zod schema |
| `wuwa-dps-td03-damage-formula-v0.1.md` | 伤害公式与乘区 |
| `wuwa-dps-td04-sim-kernel-v0.1.1.md` | 仿真内核：tick 相位、帧约定、时钟与膨胀、动作与判定 |
| `wuwa-dps-td09-rotation-scheduler-v0.1.md` | 排轴语法、编译、调度：最早合法帧、等待与报错、强制、循环 |
| `wuwa-dps-design-v0.2.9.md`（机制设计） | 游戏机制；与总设计冲突时以总设计附录 A 为准 |
| `m0-confirm.md` | 当前队伍（椿 · 散华 · 维里奈）的数据确认结果与待办 |

确需推翻某个取舍时：先改总设计并记入附录 C，再改代码。

## 目录

```text
tools/build/        ① 数据构建（Python + openpyxl）：xlsx → data/generated/
data/raw/           xlsx（不进 git）
data/generated/     构建产物（不进 git，公开仓库不发布原作者的数据）；fixtures/ 下是 golden 夹具
data/curated/       手写数据（进 git）：dmg-join.json、characters/<角色>.ts …
src/data/           ② schema 与装配（TypeScript）
src/engine/         ③ 仿真引擎：纯库，不许引入 DOM、fs、网络
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

M0 时记下的 5 处已并回 TD-01 v0.1.3 与总设计 v0.1.4。之后的：

1. **延奏触发不随变奏被取消而作废**（2026-09-27 用户确认：延奏是下场角色发出的）。变奏被打断时，没走到的 `outro` 事件转为尾部照常发生，也不挡"就绪"。改动了 TD-04 §4.2 的取消规则与 §6.4 的就绪条件、TD-09 §3.4 的表格与 Q1（关闭），以及总设计不变量 4 / 5 的表述。下次改 TD-04 / TD-05 时并回。
2. **共用冷却 `cooldownGroup`**：`ActionDef` 与 `ActionOverride` 新增，椿 E1 / E2 共用 4 秒冷却（一日花 E3 单独 25 秒）。并回 TD-01 §13.4、TD-02、TD-09 §3.2。
3. **M0 队伍的技能冷却已填**（椿 E1 / E2 共用 4 秒、E3 一日花 25 秒，散华 E 10 秒，维里奈 E 12 秒；大招按 nanoka 3.7：椿 25 秒、散华 16 秒、维里奈 25 秒）。TD-09 §2.5 示意轴的第 2 轮因此会等冷却，文中的时间表需要重算；T09-10 已按新结果改。
4. **nanoka 数据**：`static.nanoka.cc` 的 JSON 作为角色技能冷却、技能文本的来源（见 `docs/m0-confirm.md` 第 5 节）。已实现：`tools/build/nanoka.py` 在构建时抓取并缓存到 `data/raw/nanoka/`，产出 `data/generated/nanoka.json`（schema `NanokaFileSchema`），`src/data/nanoka-check.ts` 核对手填冷却（只提示，不自动填）。并回 TD-01（新增一节）、TD-02 与总设计第 7 节。
5. **golden 抽取（M1）放在 `tools/build/`，用 Python**：TD-03 §10.3 说原型脚本移植到 `scripts/golden/`；构建已按 T12 的退路改用 Python，所以一起放进构建：`xlformula.py`（公式解析与求值）、`golden.py`（TD-01 §11.1 标准答案 + TD-03 §10 逐格乘区，随 `pnpm build:data` 写出 `data/generated/fixtures/golden-damage.json`、`golden-zones.json`，构建报告有"golden"一节）、`golden_perturb.py`（扰动对拍）。与 TD-03 的出入：
   - 计数为伤害 2939、治疗 48（TD-03 §1.2 记 2940 / 47），总数 3190 不变：鉴心"护盾回复生命值"（伤害计算 J558）有治疗加成因子、dmg 里 CalculateType 为 1，按治疗算。T03-9 的计数断言已改。
   - 物理、谐度破坏与响应"减防后先取整"的写法（TD-03 §3.2、Q1），拆分时把 `FLOOR(…)` 整体记为目标防御（`defRate` 记 0），夹具逐位复现 xlsx；TD-03 公式不取整这一差异照旧（Q1）。
   - 「聚爆效应121」（伤害配置 B2622，爱弥斯"聚爆轨迹强化E"）其实是乘在聚爆效应伤害上的独立因子（伤害计算 Q1040–Q1055），TD-03 §9.4 记成了"不参与伤害公式"。夹具里并入 0 类加深，构建报告有提示；它该落哪个乘区留给 TD-06。
   - 扰动对拍比 TD-03 的范围大：改写全部被引用的「伤害配置」R1791 起的数值格（含角色专属格）与目标防御、七项抗性，共 2340 格；R1792–R1815、R2139–R2142 预先算好的因子格按公式现算。20 轮 63800 次比较，全等 63772；其余 28 次都是"防御分母 ≤ 0"（TD-03 §1.3，xlsx 算出负系数，TD-03 取上限 2）。
