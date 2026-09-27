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
data/generated/     构建产物（不进 git，公开仓库不发布原作者的数据）
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
pnpm check:data                              # 用 zod schema 校验 data/generated/
pnpm check:data -- --flags 椿,散华,维里奈    # 另外列出这些角色装配后还没处理的 flag（TD-01 §14）
pnpm check                                   # tsc 严格模式
pnpm test                                    # Vitest
pnpm test:py                                 # 构建脚本的 Python 单元测试
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

目前没有。M0 时记下的 5 处（构建脚本用 Python、`dmg-join.json`、构建时打 `noDmg`、资源列的查表公式、`positionChange`）已并回 TD-01 v0.1.3 与总设计 v0.1.4。以后实现时再有偏离设计文档的决定，先记在这里。
