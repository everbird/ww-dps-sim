# 项目审视、洞察与 `CoconutCore` 架构对照分析（2026-11-18）

- **记录日期**：2026-11-18
- **主仓库基线**：`ww-dps-sim` `99c1020`（`main`，DD-01 ～ DD-10 已合入）
- **对照仓库基线**：`~/workspace/ro/wuwa-afyg-tool` `441852a`（`CoconutCore` / `coconut-config`）

> **本地检查范围说明**：当前工作树不包含 `node_modules` 和 `data/generated/`，因此本次未在当前目录执行 `pnpm check` / `vitest`，但执行了 `python3 -m unittest discover -s tools/build -p "test_*.py"`（**71/71 通过**）；在对照仓库 `wuwa-afyg-tool` 实测运行了 `pnpm check:core`、`pnpm check:hardcoded`、`pnpm test coconut-core`（18/18 通过）与 `pnpm test formula-registry`（8/8 通过）。

---

## 一、对当前仓库（`ww-dps-sim`）的整体看法与洞察

### 1. 这个项目最稀缺的资产：一套在工程上罕见的“可追责仿真底座”

经过 DD-01～DD-10（PR #136～#142）后，`ww-dps-sim` 已经明显超越一般 DPS 计算器的阶段，具备了工程化数值仿真的骨架：

- **清晰的纯库与单向分层边界**：`tests/layering.test.ts` 用 TypeScript AST 强制检查 4 条硬约束——核心层（`src/engine/`，36 文件 10,706 行）与分析层（`src/analysis/`，18 文件 5,213 行）禁绝 Node API 与读盘（`fs`/`path`/`crypto`/`data/load`）；分析层只能经 `src/engine/index.ts` 引入；`src/engine/` 内部**执行组（16 文件 3,707 行）禁止反向引用入口装配与汇总不变量组**；引擎禁绝模块级 `let/var` 与散落的 `Math.round`/`Math.floor`（统一收口 `src/engine/num.ts`），这是为未来移植 Rust（`src/engine/portable.ts`）做出的高价值准备。
- **确定性执行、可信身份与断点续跑**：生产入口收敛为 `prepareRun() → runPrepared()`（`src/engine/run.ts`）。`RunIdentity` 与 `runId`（纯 TS 同步 SHA-256 + 码点排序 `canonicalJson`，见 `src/engine/digest.ts`）完整冻结数据、规则、选项与严格入口状态；`src/engine/snapshot.ts` 实现了真正的 tick 边界（`init` / `afterP7`）状态与队列簿记（含 `action`/`last`/`combo` 同实例别名、S[0] `spawned` 链、`MemorySnapshotCache` 600 帧分桶）快照及恢复。
- **零干扰诊断旁路与因果闭环（DD-05 / DD-06 / DD-07）**：
  - `DiagSink`（`src/engine/diagnostics.ts`）采用**只写不读**的旁路收集器设计，通过作用域栈回填事件直接父来源 `EventMeta.directParentSeq` 与延迟实体来源，并用 `pnpm conformance` 做诊断全开 vs 全关的零干扰逐字节对拍。
  - 角色资源四处写入点全部接入只读账本（`src/engine/resources.ts` 的 `add`/`syncResource`、`switch.ts` 延奏清零、`simulate.ts` 的 `openingLedger`），`pnpm fuzz --ledger` 做终态与逐笔闭合对拍。
- **区分“现在采用”和“已被证实”的科学工作流（DD-04 / DD-08 / DD-09）**：
  - `src/engine/propositions.ts` 将规则命题与候选绑定解耦，`src/engine/rule-points.ts` 在 18 个分支埋设判定点区分“读取”与“真正决定分支”；`src/analysis/evidence.ts` 区分观测用途（`given` / `formulation` / `selection` / `independent_validation`），防止用调参素材循环自证；`src/analysis/fit.ts` 先做通道保序一对一匹配与资格签名分组，再做组内评分。
- **扎实的上游交叉核对工具链**：`tools/build/golden_perturb.py` 用随机扰动打穿“中性值 0 掩盖公式 bug”的盲区；`src/data/nanoka-check.ts` 与 `src/data/wuwalab-check.ts` 形成了 xlsx + 解包（nanoka） + 社区帧表（WuwaLAB）三方交叉比对。

---

### 2. 三个最关键的结构性张力（洞察）

1. **底座与验证工程“跑在实测证据前面太远”，现在最大的收益不在加底座能力，而在填数收口**
   - 代码规模：`src/` 23,080 行 + `web/app/src/` 1,616 行 + `web/designs/` 3,065 行 + `tools/build/` 5,119 行（不含大量文档 `docs/` 共 97 篇 32,225 行，其中 `20261111-coordinate-review/` 占 16,715 行）。
   - 现实证据状态：
     - `docs/calibration/points.yaml` 共 **68 条观测点**，其中 **41 条仍是 `null`/待测**（最早的 37 条椿 AAE / 心 AAA 面板与跳字至今全是 `game: null`，新闭环 `echo-input-priority.2026-11` 3 条等待游戏录屏），仅 **5 条**标为 `independent_validation`。
     - `docs/proposition-ledger.md` 26 条命题中，**21 条结论为 `unverified`**，3 条为 `provisional`，1 条为 `ambiguous`，**0 条为 `supported`**。
     - `scenarios/` 下 34 个场景中，只有 **1 个**启用了严格入口（`scenarios/m0-video-eq-不打谐破.yaml`）。
   - **含义**：当前瓶颈已不再是“怎么诊断/怎么防偏差”，而是尽快用已有闭环（比如先把 `C8-声骸起手优先级`、`A1/A2` 面板跳字跑通），把关键开关由 `unverified` 推进到 `supported/refuted`。

2. **“引擎可移植性”目前卡在“手写机制与领域数据混在代码里”，而不是状态机本身**
   - `src/engine/portable.ts` 虽然剥离了 `GameData.hooks`，但真正决定角色与战斗行为的复杂度分散在两处：
     - **18 个角色模块（`data/curated/characters/*.ts`，3,000+ 行）**：内含 19 处 `assume()`，以及大量与 `HookContext` 强绑定的 TypeScript 状态机逻辑（如 `心.ts` 393 行、`爱弥斯.ts` 239 行）。这意味着一旦按总设计 §10.1 往 Rust 移植，18 个角色钩子基本需要手工逐个重写。
     - **内核里的游戏硬编码（`src/engine/formula.ts`、`src/data/common.ts`）**：`ZONE_IDS`（34 个乘区）、4 套结算公式（直伤/异常/谐度/治疗）、防御与三段抗性公式直接写死在引擎中，无法像表格一样配置驱动演化。

3. **多处跨端一致性仍靠文档约定或局部手工同步**
   - **Node 与浏览器的装配入口重复且已出现潜在漂移**：`src/data/load.ts`（Node）和 `web/app/src/gamedata.ts`（浏览器）各自手写了一套装配 `buildGameData()` 的调用；其中 `load.ts` 会读取 `nanoka.json` 传入 `rarity`，而 `web/app/src/gamedata.ts` **漏传了 `rarity`**（导致浏览器中 `CharacterDef.rarity` 恒为 `null`，若网页跑降档逻辑会与 CLI 不一致）。
   - **Python 构建端与 TS Schema 的双写成本**：正如 `docs/misc/tools-build-schema-sync.md` 所指出的，`ELEMENTS`、`DILATION_TYPES`、`WEAPON_TYPES` 等常量及大量生成 JSON 键名仍分散硬编码在 `tools/build/*.py` 与 `src/data/common.ts` / `generated.schema.ts` 两端。
   - **CI 覆盖盲区与大文件维护负载**：`.github/workflows/ci.yml` 因无 `data/generated`，Vitest 76 个测试文件中实际只会跑 **24 个纯测试**（其余 52 个 `dataDescribe` 用例跳过）；此外 `src/engine/query.ts` 单文件已膨胀到 **1,803 行**，`AGENTS.md` 中的“与设计文档的差异”累积至第 61 条。

---

### 3. 给 `ww-dps-sim` 的具体可落地建议（按 ROI 排序）

1. **优先做一次“观测与文档收口”，停止扩写新底座特性（高 ROI）**
   - 先落地 `docs/experiments/C8-声骸起手优先级.md`（预测与对照已就位，最易出结论）与 `A1/A2` 面板+开场跳字，拿到第一批 `independent_validation` 观测，把 `docs/proposition-ledger.md` 推离“0 条 `supported`”的状态。
   - 把 `AGENTS.md` 中第 1～61 条实现差异定期并回对应 TD（或精简归档），减少代理每次启动的上下文负担；把当前唯一严格场景 `m0-video-eq-不打谐破.yaml` 的模式逐步推广到至少每支代表队（如景尤守、心雷卜各 1 份 `strict: true` 场景）。
2. **统一 `GameData` 的装配逻辑，消除 Node/Web 漂移（低成本立见效）**
   - 将 `src/data/load.ts` 与 `web/app/src/gamedata.ts` 中“需要哪些 `actions/*.json`、组装 `GeneratedFiles`（含可选的 `nanoka.json` rarity）并调用 `buildGameData()`”的逻辑抽成一个与运行环境无关的共用函数（只接收 `readJson(rel)` + `listActionKeys()` 回调），确保 CLI 与 Web Worker 加载出逐字段相同的 `GameData`。
3. **推进 `tools/build` 与 TS 的单源常量同步（直接落实你们已有调研）**
   - 把 `ELEMENTS`、`ELEMENT_BY_CODE`、`DILATION_TYPES`、`WEAPON_TYPES`、`BODY_TYPES`、`ECHO_BODIES` 抽为一份纯 JSON 供 Python 与 `src/data/common.ts` 共读；并在本地构建工作流或组合脚本里默认串联 `pnpm build:data && pnpm check:data`。
4. **拆分 `src/engine/query.ts`（1,803 行）**
   - 按职责拆为 `query-state.ts`（`replayTo` / `stateAt` / `statesAt` / `terminalState`）、`query-explain.ts`（`explainEvent` / `whyDidEventNotTrigger` / `wouldHypotheticalEventTrigger` / `commandCheck`）与 `query-diff.ts`（`diffRuns`），对外仍统一通过 `src/engine/index.ts` 与 `query.ts` 汇总导出，不动外部依赖结构，但能大幅改善阅读和代理局部编辑成本。
5. **增加“纯数据/无 xlsx 的端到端机制覆盖”**
   - 目前 52 个依赖 `data/generated` 的用例在 CI 中默认跳过，建议挑选典型复杂机制（如“切人+延奏+时停打断+异常结算+共鸣模态”）在 `tests/helpers/synth.ts` 下沉淀成小型合成夹具并挂进 `pnpm conformance --boundaries-only`，让 CI 即使没有 `xlsx` 也能守住核心交互逻辑。

---

## 二、与 `~/workspace/ro/wuwa-afyg-tool` 的深度对比

首先必须明确两者的**问题域差异**：
- **`ww-dps-sim` 是有状态、60fps 离散时间事件仿真 + 科学验证/录像对拍工作台**——核心难点是时序调度（切人锁/顿帧/全局时停/取消优先级）、资源守恒账本、角色状态机钩子、以及多假说证伪。
- **`wuwa-afyg-tool` 是静态拉表/时间轴分段伤害计算器 + 配装/词条贡献分析（Shapley）+ 内置 AI 工具台**——核心难点是如何把复杂的技能/Buff/条件/转模/覆盖关系压平计算，做到计算与溯源同口径、快速增量重算，并让 AI 工具安全调用。

但两者在**“怎么把核心计算库从应用里孤立出来，并防止 AI / 人类把领域知识污染进内核”**上走了两条极具参考价值的路线：

| 对比维度 | `ww-dps-sim` | `wuwa-afyg-tool` |
|---|---|---|
| **核心抽象层次** | **物理/规则固定的仿真内核**（`src/engine/` 10,706 行）：时钟、事件总线、资源与公式结构是鸣潮专属的，`ZONE_IDS` 和 4 条伤害公式硬编码在内核 | **领域无关的泛型求值内核**（`src/coconut-core/` 10 文件 892 行）：内核不认识“攻击力”“冷凝”“防御区”，一切作用/维度/乘子/公式/目标字段由调用方通过 `CoconutCoreConfig` 注入 |
| **边界与防腐蚀机制** | **AST 测试驱动架构边界**：`tests/layering.test.ts` 用 TS AST 强查纯库、目录单向依赖、执行组隔离、禁用模块级可变状态与集中取整 | **多道独立脚本硬门禁 + 棘轮**：`check-calc-core.mjs` 扫目录每个文件的 import 闭包、禁 CJK 零语料、禁 `id: '...'`、单一出口；`check-no-hardcoded-ids.mjs` 用 84 项实体清单 + 逐文件字面量棘轮（只许降、自检防清单过期）；`formula-registry.test.ts` 强断言全作用覆盖与 `FORMULA_MANIFEST` 结构快照 |
| **版本演进治理** | **数据清单 + 命题台账**：`xlsx-versions.json`（SHA-256 + `gameVersion`）+ `PROPOSITIONS` / `evidence/*.yaml` + `pnpm evidence --stale` 管机制真伪 | **类型化的版本配置链**：`src/coconut-config/versions.ts` 用 `v1_0 → v2_0 → v3_0 → v3_7`（每版 `satisfies CoconutCoreConfig`）固化游戏机制的增减历史 |
| **函数式与可维护性约束** | 偏实用：状态循环内允许原地改 `SimState`，但模块顶层禁止 `let`/`var`，随机数与取整集中 | **分层的 ESLint 强约束**：`src/lib/{calc,api,utils,consts,ai/...}` 纯逻辑层开启 `no-param-reassign`、`prefer-const`、`prefer-arrow-callback` 等，UI/Runes store 层保留可变性 |
| **计算与溯源同源性** | 天然同源：`HitInputs`、`EventMeta` 与 `ResourceLedgerEntry` 都直接来自同一次仿真执行的旁路捕获 | 正处于迁移收口：旧路径 `compute.ts`（1,833 行）+ `damage-trace.ts`（978 行）正逐步收敛到 `compile.ts → CoconutCore`；旧公式表与新注册表同过 `compute-golden` 与 `compile.test.ts` 对账 |
| **性能与加速思路** | `optimize.ts` 用 `HitRecord` 做纯数值快速重算（假定时间轴不变）+ 完整仿真确认；`snapshot.ts` 用 600 帧快照缓存加速区间查询 | `compile.ts` 前置求值压表 + `createResolveMemo` 解析记忆化 + `entryResultKeyOf` 内容去重 + `compute-cache.utils.ts` 跨轮条目缓存 |

**核心启发**：
- `ww-dps-sim` 在**运行期科学严谨性**（身份指纹、零干扰诊断、状态快照恢复、证据闭环、因果溯源）上做得比 `wuwa-afyg-tool` 深得多；
- 而 `wuwa-afyg-tool` 在**静态解耦、把领域知识驱逐出内核、以及用机械门禁防“手抄本漂移”与防 AI 写脏边界**上的设计极为精悍，非常值得借鉴。

---

## 三、对 `~/workspace/ro/wuwa-afyg-tool` 中 `docs/coconut-core.md`（`CoconutCore` / `coconut-config`）的评价与思考

### 1. 这套设计做得极好的地方

1. **“编译器压表 + 极简求值核”让内核小到几乎不会腐烂**
   - 把条件判断（链/阶/Buff依赖/敌人类型）、词条分发（属性/伤害类型加成拆进单段 `bonusDmg`）全部放到 `src/lib/calc/compile.ts`（376 行）。
   - 传给 `CoconutCore` 的 `GeneralTable` 只剩 `global_buffs`、`buffs`、`damage_entries` 三个结构，且“一切皆 Buff”（连角色白值、武器白值、敌人面板都编译进 `buffs` 并以 `role: 'stat'` 屏蔽在贡献溯源之外）。内核代码仅 **10 个文件 892 行**，无任何外部运行时依赖，能打包成单文件 ESM + `.d.ts`（`dist/calc-core`）独立分发。
2. **用机制保证“顺序与完备性”，而非靠人肉同步**
   - `scripts/check-no-hardcoded-ids.mjs` 的注释一针见血地指出过去的痛点：`compute.ts` 与 `damage-trace.ts` 曾是三份手抄本并实测发生过“防御区/免伤区顺序漂移”。
   - 新架构把乘子注册序直接定为合法链顺序（`createFormulaRegistry` 在 `init()` 时当场校验），上层 `formula-registry.test.ts` 强断言**每一个作用都要么被公式链读到、要么参与面板三维派生、要么写目标侧、要么显式登记 `DISPLAY_ONLY_ACTIONS`**，配合 `display-meta.ts` 用 `Record<CalcActionId | MultiplierId | FormulaKey, ...>` 锁死完备性——现在加减一个游戏乘区时，**漏接哪里编译器和单测会立刻指出**。
3. **四项机械门禁的组合拳非常实战**
   - `check-calc-core.mjs` 最厉害的一点是**对 `src/coconut-core/` 目录下的每一个文件都当入口查 import 闭包**（哪怕是刚新建、还没被引用到的文件），并检查零 CJK 字符、零 `id: '...'` 字面量、子路径单一出口（只能给 `coconut-config` 和 `core-config.ts` 用）。这种设计几乎杜绝了协同开发或 AI 代理“顺手引一个 `$lib/data/*.svelte.ts` 把 store 拖进内核”的事故。
4. **细腻的游戏算术抽象**
   - `effectiveCritRate` 只钳制用于暴击乘子的等效值，**保留 `panel.zones.critRate` 原值**，从而自然兼容“暴击溢出转暴伤”的引用转模（`StatRef`）。
   - `only: 'panel'` 与 `initCoeff` 让内核在不认识“处决/效应”概念的前提下，仅靠公式的 `critBase` 字符串标记就实现了“系数基类双暴 0/100 起算且不吃装备双暴”。

---

### 2. 需要警惕的边界问题与架构张力（真实代码观察）

1. **最值得注意的语义坑：`compile.ts` 的“静态折算转模”会使内核 `trace: true` 漏算转模联动**
   - 在 `src/coconut-core/compute.ts` 中，内核自身原生支持 `StatRef`（在 `panelOfDamage` 阶段按 `literal → roundPanelBase → recomputeTotals → refs → overrides` 实时读取面板算转模）。
   - 然而 `src/lib/calc/compile.ts` 为了和旧 `compute.ts` 的 `resolveEntry` 保证 100% 数值一致，在编译生成 `GeneralTable` 时就直接调用 `resolveEntry` 把带引用的 Buff 算成了静态数字字符串（`toEffect` 输出 `String(write.value)`）。
   - **隐患**：如果外部或新代码把 `compileGeneralTable` 产出的表喂给 `core.compute(table, { trace: true })` 做逐 Buff 贡献拆解，那么摘掉一个“生命 +40%”的 Buff 时，已经烘焙进表的“基于总生命转模攻击力”的 `Buff` **并不会跟着扣减**（而原生传 `StatRef` 给内核才会联动重算）。目前工具箱自己的 `substat/` 走的是 `compute.ts` 的重算链路才规避了这个问题；但随着继续向纯 `CoconutCore` 收敛，**应让 `compile.ts` 直接向 `GeneralTable` 发射原生的 `StatRef`（而不是预先折算成数字），或者拓展内核支持工具箱的离散阶梯转模（`discrete / divisor / multiplier`）**。
2. **内核 `panelOfDamage` 对 `refs` 的求值假设了单层顺序且忽略 `write: 'override'`**
   - 看 `src/coconut-core/compute.ts` 第 77 行：`if (typeof effect.value !== 'string') { if ((effect.write ?? 'add') === 'add') refs.push(...); continue }`。
   - 这里有两处隐含约束：① 若给引用转模写了 `write: 'override'` 会被**静默丢弃**；② 多条 `refs` 之间是按入表顺序依次结算并 `recomputeTotals` 的（不支持无序的多级级联转模 A→B→C，如果 C 排在 B 前面就会读到未更新的中间面板）。目前够用，但作为对外通用引擎包（`coconut-core.md`）建议在文档中写清“转模只支持 `add` 且按顺序单遍求值”，或加上 `override` 警告/处理。
3. **双轨迁移尚未完成，老引擎仍是当前运行依赖的“真源尾巴”**
   - `compile.ts` 与 `compute-facade.ts` 目前仍大量依赖 `src/lib/calc/compute.ts`（1,833 行）的 `resolveEntry`、`resolveBase`、`entryStatsOf`、`weaponStatsOf`；且 `src/routes/fast-calc/+page.svelte` 与 `src/lib/substat/shared.ts` 仍在直接调用 `compute.ts` 的 `computeAll` / `computeOneEntry`。
   - 这导致 `check-no-hardcoded-ids.mjs` 的基线里，`damage-trace.ts`（53 处）和 `compute.ts`（26 处）仍占全库大头。短期看这是平稳重构（PR 先保证零数值漂移），但长期看若不把 `resolveEntry` / `fast-calc` / `substat` 切到基于注册表的新管线，双份维护的阴影依然存在。
4. **`coconut-config` 分发包的定位边界可以再明确一点**
   - `coconut-config`（775 行）把鸣潮 1.0～3.7 的作用/乘子/公式/维度版本链独立发包了，但诸如 `PANEL_BASE_TYPES`（中文基准名映射）、`TUNE_COEFF_MAP`（敌人偏谐系数）、`EFFECT_BASE_VALUE` / `EFFECT_TABLE`（异常效应基础值与倍率表）、`display-meta.ts`（乘区中文标签与格式化）仍留在 `src/lib/calc/` 里。
   - 这对于保持内核纯洁完全合理，但建议在 `docs/coconut-core.md` 或 `coconut-config` 介绍里显式提醒外部消费方：`coconut-config` 提供的是**公式拓扑与乘区骨架**，并不包含数值常量表（偏谐系数、效应表、中文显示名）——避免使用者装了 `coconut-core + coconut-config` 后发现没有 `tuneCoeff` 或 `effectCoeff` 的数值来源。
5. **长表性能边界（若用于高频搜索）**
   - `computeGeneralTable` 对每一段 `Damage` 都会重新从头构建一次 `TargetPanel` 与 `CharacterPanel` 并重跑一次所有 `literal + refs`。在几十条伤害的拉表页完全不是瓶颈（配合 `dedupeEntries` 与 `compute-cache.utils.ts` 非常快）；但如果未来外部项目拿它做上万次装备/词条枚举搜索，就会暴露重复构面板的开销（这一点在 `ww-dps-sim` 里的解法是按固定快照面板构建轻量 `Replayer`）。

---

### 3. 给 `ww-dps-sim` 可以借鉴 vs 不应照搬的部分

- **不应照搬**：不要为了“纯洁性”把 `ww-dps-sim` 的逐帧模拟核强行改成 `GeneralTable`。静态表本质是“已展开的无时序伤害列表”，而 `ww-dps-sim` 的核心恰恰是时序怎么从规则里推演出来——两者解决的问题完全不同。
- **非常值得借鉴到 `ww-dps-sim` 的三件事**：
  1. **把公式拓扑与乘区定义从 `src/engine/formula.ts` + `src/data/common.ts` 里配置化/版本化**：参考 `coconut-config` 的 `actions` / `multipliers` / `formulas` 分离，将 `ZONE_IDS`（34 个硬编码乘区）与 4 条公式链声明为可版本化、可校验的注册表（连同 `FORMULA_MANIFEST` 式结构快照）。未来游戏 4.x 新增类似“同奏区”的新乘区时，不需要改写 `formula.ts` 的硬编码乘法序列，也更容易对照 `PROPOSITIONS` 挂接版本演进。
  2. **引入“实体名字面量棘轮”与“规则点完备性校验”**：仿照 `check-no-hardcoded-ids.mjs` 与 `formula-registry.test.ts`，在 `ww-dps-sim` 加两条低成本静态测试：
     - 限制具体角色名/中文动作名硬编码只允许出现在 `data/curated/`、`scenarios/` 与特定适配表，不允许渗透进 `src/engine/` 通用执行组（目前 `rule-points.ts` 已在这么做，把 `卜灵` 抽成 `CONCERTO_TIMING_POINTS` 映射表，这个方向非常对，可以固化成自动化门禁）。
     - 校验 `PROPOSITIONS` 中的规则路径 ↔ `RULE_POINTS` 判定点 ↔ `DEFAULT_RULES` 字段三者之间的对齐关系，避免加了新规则开关却漏登记判定点。
  3. **把“门面 + 元数据表”思路应用到 `src/data/registry.ts` / `src/report/`**：让 `CharacterDef` / `ActionDef` 与“给网页时间轴看的展示说明字段（如 `forte` 文本、部分提示字符串）”边界更清晰，进一步收窄 `ResolvedScenario` 的核心数据面，为后续 Rust 对拍减负。

---

### 总结

- **`ww-dps-sim`** 已经把最难的“运行时确定性、因果诊断、状态恢复与科学证伪工作流”建到了非常高的工程水准；接下来最值得做的不是继续把引擎层做重，而是**先把手头的实测观测（C8、A1/A2）喂进闭环让 `PROPOSITIONS` 出现首批真正 `supported` 的规则，同时把 Node/Web 装配同步、Python/TS 常量共享、大文件拆分这些低成本卫生工程收尾**。
- **`wuwa-afyg-tool` 的 `CoconutCore` + `coconut-config` 架构** 在静态伤害领域做到了极致的“纯核边界 + 机械门禁 + 配置演化”，其与 `ww-dps-sim` 恰好互补——如果后续要把 `ww-dps-sim` 的伤害公式子模块（`formula.ts` / `ZONE_IDS`）往配置驱动与跨版本演化方向继续提纯，`coconut-config` + `formula-registry.test.ts` + `check-calc-core.mjs` 是非常直接的参考样板。
