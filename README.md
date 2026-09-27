# ww-dps-sim

鸣潮（Wuthering Waves）逐帧期望 DPS 仿真与配装择优工具。个人兴趣项目，原则：实用、清晰、简单。

按帧推进三人队伍的动作，按游戏的伤害公式计算每一段判定的期望伤害，用来比较声骸、武器、输出轴的优劣。

## 状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 骨架 | 构建脚本读 xlsx，抽出第一支队伍（椿 · 散华 · 维里奈）的动作与倍率 | 完成，`docs/m0-confirm.md` 已确认 |
| M1 公式 | 乘区收集 + `computeHit`，golden 对拍 | 公式与用例已有（TD-03），待接入构建产物 |
| M2 单人仿真 | 时钟、动作、判定、调度器 | 内核（TD-04）与调度器（TD-09）已有，待接伤害、常驻 buff 与场景文件 |

## 使用

需要 Node 22+、pnpm、Python 3 与 `openpyxl`（`pip install openpyxl`）。

```bash
pnpm install
# 把数据 xlsx 放进 data/raw/（不随仓库发布）
pnpm build:data -- --strict 椿,散华,维里奈
pnpm check:data && pnpm check && pnpm test && pnpm test:py
pnpm check:data -- --flags 椿,散华,维里奈   # 列出装配时靠推断补上、还没人确认的地方
```

没有 xlsx 时 `pnpm test` 照样能跑，依赖数据的用例会标为跳过。

## 数据

数据来自社区整理的《鸣潮动作数据汇总》xlsx。原表与由它抽出的数据都不放进本仓库（`data/raw/`、`data/generated/` 已忽略）；仓库里只有抽取规则、手写修正和引擎代码。

## 文档

设计与规格在 `docs/`，编码约定在 `AGENTS.md`。
