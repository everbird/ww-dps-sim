# `ww-dps-sim` 项目架构与机制探索笔记（2026-11-17）

- **记录日期**：2026-11-17
- **代码基线**：`main` `c636514`（PR #140 合入后，DD-01 ～ DD-10 全部落地）
- **历史对比基线**：`v0.1` 标签 `6eedc0b`（2026-11-13，架构定稿时点）

---

## 1. 项目目录结构与职责分层

```text
ww-dps-sim/
├── tools/build/      ① 离线数据抽取（Python + openpyxl）：xlsx / nanoka → JSON、golden 扰动对拍
├── data/
│   ├── raw/          原始 xlsx 与 nanoka / wuwalab 缓存（不进 git）
│   ├── generated/    构建产物 JSON 与 golden 夹具（不进 git）
│   ├── curated/      手写机制、触发器、角色状态机钩子与跨源映射（进 git）
│   └── scan/         wavescan 扫描导出的声骸背包 JSON
├── src/
│   ├── data/         ② Schema（zod）、动作/声骸装配、GameData 注册（registry.ts）与加载（load.ts）
│   ├── engine/       ③ 纯库仿真执行核心（不碰 fs / DOM / 网络；唯一出口 index.ts）
│   ├── analysis/     ④ 外围分析层（18 个模块：对比、边际、择优、搜索、排轴、校准、贴合度、证据等）
│   ├── report/       展示模型与报告生成（timeline.ts、diff-timeline.ts、candidates.ts、evidence.ts）
│   └── cli/          命令行入口（pnpm sim / query / compare / evidence / conformance / fuzz …）
├── web/
│   ├── app/          ⑤ Vite + Svelte 5 前端应用（Web Worker 内运行引擎）
│   └── designs/      时间轴 A～F 六套交互视图模板及 shared.js（与 web/timeline.html 并列）
├── scenarios/        场景配置 YAML（队伍、配装、敌人、排轴与录像）
├── inventory/        账号声骸库存 YAML
├── tests/            Vitest 测试集
├── docs/             总设计、TD-01～13、DD-01～10、确认清单、证据闭环、校准点与探索笔记
└── out/              本地仿真日志、静态时间轴 HTML、conformance 对拍产物（不进 git）
```

### `src/report/` 与 `web/` 的区别和联系
- **`src/report/` 是纯函数展示加工层**（CLI 与 Web 共用）：把 `SimResult`、`ResolvedScenario`、证据/候选结论整形成画图数据包（`TimelineModel`、`DiffTimeline`）或 Markdown 文本，并将数据内联注入 HTML 模板（`renderDesign` / `renderTimeline`）。
- **`web/` 是浏览器端 UI 与视图模板层**：`web/app/` 用 Svelte 5 渲染编辑器、运行卡片、对比/择优/搜索页面，通过 `worker.ts` → `handlers.ts` 在后台线程运行引擎；`web/designs/` 存放 A～F 六套时间轴视图模板。
- **两条复用通道**：
  1. Web App 在 Worker 里算完后调用 `src/report/timeline.ts` / `diff-timeline.ts` 直接把 HTML 或对照数据喂给 Svelte 页面；
  2. 命令行 `pnpm timeline` 调用完全同一套 `timelineModel()` + `renderDesign()` + `web/designs/*.html`，生成独立的离线 HTML 文件到 `out/`。

---

## 2. 对比 `v0.1`，引擎本身（`src/engine/`）的主要演进（DD-01 ～ DD-10）

1. **运行契约、严格入口与口径声明（DD-01 / DD-02 / DD-03）**
   - 删掉旧 `simulate()` 兼容外壳，统一收敛为 `prepareRun()`（合并覆盖 → schema 校验 → 严格检查 → 装配 → 生成 `RunIdentity` 与 `runId`）+ `runPrepared()`（内部调用 `execute()`）。
   - 显式 `RunCompletion` 区分 `completed`、`truncated`（带 `remains` 余量）、`axisFailed`、`engineError`（引擎/钩子异常不再直接外抛，记为无效结果供排错），并记录 `coverage` 与各轮真实结束战斗帧 `loops.roundEnds`。
   - 新增严格教学轴入口（`strict.ts`）：编译前/装配后校验（`checkStrictSource` / `checkStrictResolved`），运行期严格检查变奏等意图是否满足（`intentUnmet`），支持 `continueAfterIntentUnmet` 降级试跑并产出 `StrictReport`。
   - 新增伤害口径 `DamageScope`（区分 `written` / `auto` / `writtenPlusAuto` / `omitted` 及偏谐量表 `gauge` 状态）。

2. **纯库边界与分层拆分（DD-10）**
   - 建立 `src/engine/index.ts` 作为唯一公开入口（刻意不导出交出可变 `SimState` 的 `replayTo`）。
   - 将原 `src/engine/` 下的 18 个分析模块全部迁至 `src/analysis/`。
   - 静态编译（`compile.ts`）从运行调度（`scheduler.ts`）拆出，提炼 `wait-codes.ts`、`event-util.ts`、`filler.ts`、`resource-replay.ts` 等共用纯模块。

3. **Tick 边界快照与断点续跑（DD-10）**
   - 新增 `snapshot.ts`：在合法边界（`init` / `afterP7`）截取 `Snapshot`（含 `StateView`、`log` 与 `ExecutionMemory`），经 `wire.ts` 编解码恢复 `Infinity` / `Map` / `Set` 与动作共享实例引用，并支持 `MemorySnapshotCache`（每 600 帧一个缓存桶）与 `resumeFrom` 续跑。

4. **零干扰诊断旁路、事件出处、判定点与资源账本（DD-04 / DD-05 / DD-06）**
   - 新增只写不读的收集器 `DiagSink`（`diagnostics.ts`），全关时不实例化；通过作用域栈回填事件因果 `EventMeta`（`directParentSeq` / `subjectSeq` / `origin` / `scope`）与延迟实体来源 `EntityOrigin`，替代了以前靠邻近日志猜出处的做法。
   - `forteKeepOnSwitch` 细化为按角色拆分的 `forteKeepOnSwitchBy`；在引擎和角色钩子里埋设 18 个规则判定点（`rule-points.ts`），常驻输出 `RuleUsageReport`。
   - 新增资源只读账本（`ResourceLedgerEntry`），提供 `checkLedgerClosure` 与 `crossCheckLedger`。

5. **状态查询、只读试算与标准化 Wire 信封（DD-07）**
   - 新增 `query.ts` 与 `probe.ts`：支持 `stateAt` / `statesAt` / `terminalState`、`openProbe` 只读试算（深冻结无日志投影 `freezeStateProjection`、禁止写入抛出 `UnsupportedWrite`）、`commandCheck` / `rawActionCheck`（含 `CommandVerdict`）、`whyDidEventNotTrigger` / `wouldHypotheticalEventTrigger`、`explainEvent`（还原 `HitInputs`、`ActiveBuffContribution`、`businessRoot`）、`diffRuns`（跨运行对照与指令映射）。
   - 新增 `wire.ts`：为 `pnpm query` 统一包装 `QueryEnvelope<T>`（含 `identity`、`completion`、`capability`）。

6. **量尺修复、比较口径与录像剖析支撑（DD-03 / DD-09）**
   - `basis.ts` 统一 `basisOf`、`usableBasis`、`usableSteady`（结合真实 `roundEnds` 与统计窗口终点拦截残缺轮次）及 `scopeMismatchOf`。
   - `summary.ts` 新增按提供者与实例拆分的 `buffUptimeBy`、`kill.eventSeq` / `kill.overflow`、`goal.lethal`（`OUTPUT_SCHEMA_VERSION = '2'`）。
   - 引入常驻外部干预记录 `InterventionRecord`（`sync` / `enemyDisharmony` / `enemySwap`，删去旧 `'fill'` 能量满写法），支持编译插入未观测时段填法（`inserts`），并由 `resource-replay.ts` 按 `afterEventSeq` 锚点统一重放同步。

---

## 3. 端到端 Dataflow（以 `scenarios/m0-team.yaml` 为例）

1. **数据源**：`data/raw/*.xlsx`（动作帧/判定/倍率/武器/敌人）+ `nanoka`（声骸倍率/冷却/星级）+ `data/curated/`（角色状态机钩子如 `椿.ts`、武器/声骸/套装 `BuffDef`、手动连线表 `dmg-join.json`）。
2. **离线构建与校验**：`pnpm build:data` 运行 `tools/build/build_data.py` 输出 `data/generated/*.json` 与 `actions/*.json`；`pnpm check:data` 使用 `src/data/generated.schema.ts`（Zod `strictObject`）校验结构。
3. **装配为 `GameData`**：Node 侧通过 `src/data/load.ts`、Web 侧通过 `web/app/src/gamedata.ts`（Vite `import.meta.glob`）加载原料，共同调用 `buildGameData()`（`src/data/registry.ts`）合并生成只读 `GameData`。
4. **场景归一准备 `prepareRun()`**：解析场景 YAML 并校验 `ScenarioSchema`，经 `resolveScenario()` 合成三人静态面板、武器/声骸/套装被动与初始状态，调 `compileRotation()` 将排轴文本编成 `Command[]`，最终产出带 `runId` 的冻结 `PreparedRun`。
5. **逐帧仿真 `runPrepared()`**：`execute()` 初始化 `SimState` 与 `openingLedger` 后逐 tick 推进：计算时间膨胀率 → `scheduler.ts` 检查门控/延迟/插队谐破后起手动作 → 判定帧生成与 `computeHit()` 计算乘区 → `settleGains()` 记入日志与资源账本 → `drain()` 触发被动与角色 `onEvent` 钩子 → 定时器结算。结束后 `summarize()` **仅从事件日志与干预记录**汇总总伤、稳态 DPS、分动作/分角色伤害、buff 覆盖率、资源曲线、等待与假设清单，得到 `SimResult`。
6. **下游消费与展示**：
   - **Web 运行页**：`handlers.run` 校验 `usableBasis()`，调用 `timelineModel()` 生成展示模型并内联进 `web/timeline.html` 或 `web/designs/a~f.html`，返回给 `RunView.svelte` 渲染卡片与时间轴（Worker 缓存最近结果，切换 A–F 视图不重跑）。
   - **高级分析页**：`CompareView`、`MarginalView`、`InsightView`、`OptimizeView`、`SearchView`、`PlanView` 通过 `src/analysis/*` 批量驱动 `prepareRun` / `runPrepared` 并展示结果表。
   - **命令行**：`src/cli/*` 复用相同核心输出终端汇总、`out/*.json` / `out/*.html`、Markdown 报告或 Wire JSON。

---

## 4. `data/curated/` 的定位与实验结论的归宿

### `data/curated/` 承接的四类信息
1. **自然语言文本结构化**：把武器、声骸、套装、异常效应、环境 buff 说明翻译为引擎可执行的 `BuffDef` / `ResourceEffect`（`weapons.ts`、`echo-sets.ts`、`echoes.ts`、`effects.ts`、`env-buffs.ts`）。
2. **动态状态机钩子与缺省补全**：角色特殊资源转换、形态切换条件、动作替换与帧/标签覆盖（`characters/*.ts` 中的 `hooks`、`vars`、`actionOverrides`、`treeStats`、`weaponType`、`coreNames`）。
3. **跨数据源胶水映射**：`dmg-join.json`（动作判定 ↔ `dmg` 行倍率或显式 `null`）、`nanoka-names.json`、`scan-names.json`。
4. **原始表缺失实体**：如 `extra-echoes.json` 补录的新声骸。

### 实测与校准结论沉淀到哪里？
- **特定角色、装备或动作数据修正** → 进 `data/curated/`（如钩子状态、触发条件、`actionOverrides`）；
- **跨角色通用的可切换规则或按角色例外参数** → 进 `src/data/gamedata.ts` 的 `DEFAULT_RULES`（如 `switchCooldown`、`hitstopInGlobalStop`、`switchEndsStop`、`forteKeepOnSwitchBy`、`concertoTimingBy`）；
- **无法用参数开关表达的通用底层机制** → 进 `src/engine/` 内核代码（如空中入场、召唤物时钟、白条瘫痪规则）。

---

## 5. 质量保障：台账、判定点、证据闭环与数值对拍

- **规则台账（[src/engine/propositions.ts](file:///home/everbird/workspace/ggww/ww-dps-sim/src/engine/propositions.ts)）**
  - 把待确认机制写成可单独证伪的命题，严格分离 `adopted`（当前采用候选）与 `conclusion`（证据结论等级）；每个候选标明 `binding`（`rule`/`option`/`curated`/`hook`/`scenario`/`unimplemented`）供自动翻转对照；证据条目区分用途（`formulation` / `selection` / `independent_validation` 等），防止循环论证。
- **规则判定点（[src/engine/rule-points.ts](file:///home/everbird/workspace/ggww/ww-dps-sim/src/engine/rule-points.ts)）**
  - 在引擎与角色代码的关键分支登记 18 个 `RULE_POINTS`，通过 `k.rule.note` / `ctx.noteRule` 记录读取次数与**在当前局部状态下是否真正决定了分支（`decisive`）**；`RuleUsageReport.coverage` 明确声明已埋点范围，区分“0 次决定”与“未插桩”。
- **证据闭环（[src/analysis/evidence.ts](file:///home/everbird/workspace/ggww/ww-dps-sim/src/analysis/evidence.ts)）**
  - 驱动 DD-08 闭环流程：`predictClosure`（跑各候选预测并检查 `distinguishability` 区分度）→ `registerClosure`（进游戏前冻结运行身份与预测摘要）→ `judgeClosure`（拿冻结预测对照实测 `points.yaml` 并经 `concludeFromVerdicts` 定论）→ `rerunClosure`（决定采用后同代码重跑受影响场景）→ `evidenceFromClosure` & `evidenceViolations`（输出并校验回填进 `propositions.ts` 的证据，要求 `supported` 必含独立检验）。
- **数值对拍**
  - `pnpm golden:perturb`（[tools/build/golden_perturb.py](file:///home/everbird/workspace/ggww/ww-dps-sim/tools/build/golden_perturb.py)）：随机扰动目标防御、抗性与配置表乘区非零格，用 Excel 公式解析器算出期望值，与按乘区拆分重算的值逐格比对，防止“中性值 0 掩盖公式 Bug”。
  - `pnpm conformance`：做诊断全开 vs 全关的**零干扰对拍**，并输出标准基线用于未来跨语言（如 Rust）重写逐字段对拍。
  - `pnpm fuzz --ledger`：将运行期实时资源余额与从 `ResourceLedgerEntry` 逐笔累加的重放余额做闭合对拍。

---

## 6. 本地 Web 部署与工具链笔记

- **本地 Web 运行方式**：由于 `data/generated/` 不进 Git 且不对外发布，网页直接通过 `pnpm web --port 8014 --strictPort --host 0.0.0.0`（配合 `WEB_HOSTS` 环境变量与本机 Caddy HTTPS 反代）启动 Vite 开发服务器提供访问；修改代码或拉取 `main` 后需校验 `pnpm check:data`、`pnpm check` 并重启服务进程。
- **`tools/build` 与 TS Schema 同步评估与改进建议**：详见同目录 [tools-build-schema-sync.md](file:///home/everbird/workspace/ggww/ww-dps-sim/docs/misc/tools-build-schema-sync.md)（PR #141）。
