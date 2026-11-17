# TODO_RESUME

> **恢复收尾已完成**：下文是恢复前的审计基线，历史状态与数量保留供追溯，不再作为待办。
> 本轮已完成 D1～D3 文档修正、Q1 显式归层及反例、Q2 S[0] 连锁阈值与故障注入反例；未改变内核业务逻辑（仅修正 simulate.ts 文件头的过期注释）。
> 最终复验：check 0 错误 / 0 警告；Vitest 71 文件、893 通过、37 TODO；Python 71 通过；原有 out/dd10-before 的 41 样例对拍与零干扰通过；out/dd10-after 已重新导出；网页构建与 S[600] 查询导出通过。
> 证据见 `docs/20261111-coordinate-review/detailed-design/dd-10-snapshot-audit.md` §4“恢复清单收尾复验”及 `/tmp/dd10-close-*.log`。未提交、未重置、未手改 generated。原定 T10-1～T10-8 与本清单收尾项现无已知未完成项；37 项 TODO 仍不是 DD-10 待办清单。

## 1) 已完整实现且语法/逻辑无误的部分

> 这里的“无误”仅指逐文件审阅、当前类型检查和实际运行的回归覆盖内未发现问题，不代表数学上证明不存在任何缺陷。不能把日志里的“完成”当证据。
>
> 本次只生成恢复审计，不提交、不重置、不继续修改业务代码。当前代码已包含“额度中断后继续”落盘的补全，所以不要按最初中断时的旧报错回退。
>
> 审计基线：HEAD `eaba934`；工作区 `/home/everbird/.paseo/worktrees/07ao94ni/majestic-fish`。
> 生成本文件之前有 **134 个变动路径：17 个重命名（RM），11 个未跟踪文件，106 个其他修改**。RM 表示重命名已暂存、文件内容又有未暂存修改；不是两份独立实现。已核对 `git status --short`、`git diff`、`git diff --cached` 的合并视图 `git diff HEAD`，并直接读取未跟踪文件。没有修改 generated 的 git 记录。
>
> 当前重新验证：`git diff --check` 通过；`pnpm check && pnpm test && pnpm test:py` 通过；TypeScript/Svelte 0 错误、Svelte 0 警告；**71 个测试文件通过、891 项通过、37 项 TODO（合计 928）；Python 71 项通过**。37 项 TODO 不是本次 DD-10 全部尚未开始的清单，不能据此伪造恢复任务。
> 当前这轮日志：`/tmp/dd10-resume-check.log`、`/tmp/dd10-resume-test.log`、`/tmp/dd10-resume-py.log`。

### 会话来源、原目标与子任务复原

按 mtime 找到的最新文件是：
`~/.codex/sessions/2026/11/16/rollout-2026-11-16T17-28-47-01a1e567-7e73-7de2-873b-6dfe7c9d5e3b.jsonl`。

**重要来源限制**：这个最新文件是“分析层迁移”子代理会话，不是用户主会话。它最初的 user 消息是协调代理派单，标题残留为“在此 worktree 中按照 docs/20261111-coordinate-review/detailed-de…”；相邻五个会话的派单都指向 **实施 `docs/20261111-coordinate-review/detailed-design/dd-10-snapshot-split.md`**。扫描 `~/.codex/sessions/` 未找到包含该文档路径、且不属于代理转发的原始用户任务原文。因此以下目标是根据实际派单与设计文件交叉复原，**不是冒充逐字引用用户原话**。

复原目标：在当前 worktree 实施 DD-10：真正的边界快照/恢复与状态查询缓存；拆执行核心反向依赖；17 个分析文件移到 `src/analysis/` 并只经 `src/engine/index.ts`；删除生产 `simulate/prepareResolved`；迁移 CLI/Web/测试；扩展 conformance 完整产物/清单/边界样例/verify；保持原业务结果。不重新执行冒充恢复，不从装配结果逆造源场景，不手改 generated，不创建提交。

| 原分工 | 会话 ID（文件名前缀均为 rollout-2026-11-16T…） | 原派单内容 | 磁盘结论 |
|---|---|---|---|
| 快照，T10-1～3 | `01a1e567-77e1-7901-9288-a5680c92ae62`，17-28-46 | run/simulate/query/diagnostics/context、snapshot、新测试、审计表；JSON、动作别名、S[0] spawned、全诊断、真实续跑与缓存 | 主实现和测试已落盘，不再是中断时半成品 |
| 分析，T10-5～7 | `01a1e567-7e73-7de2-873b-6dfe7c9d5e3b`，17-28-47 | 迁目录/公开入口/生产消费端，删除兼容入口，与快照代理协调；保存四命令前后结果 | 17 文件均迁移，新签名消费端类型检查通过 |
| 核心，T10-4 | `01a1e567-e6a6-7d01-b325-1dcf8da50991`，17-29-14 | compile/常量/错误下沉，注入不变量，num 集中，存 conformance 基线并对照 | 拆分和接线完整，四条分层检查通过 |
| conformance，T10-8 | `01a1e567-8043-7253-895e-1df2f1fb19e4`，17-28-47 | 完整输入输出、MANIFEST、七停止路径/相位边界、verify 字段路径、C10-7/8 | 三个 CLI 文件与测试存在，6 项 CLI 测试通过 |
| 测试迁移 | `01a1e569-28be-7120-980c-10b0bf0e6a4d`，17-30-36 | tests 旧 API 迁正式入口；明确测试夹具身份；不得弱化原机制断言 | 旧 API 调用已清除；全套通过 |
| 协调代理 | 派单来源 `73784b54-7f14-4750-8997-b58ff94ade08`（本目录未找到对应主会话原文） | layering/正式文档/集成验收 | 代码检查完成；文档收尾仍有下列第二部分问题 |

子代理旧会话主要记录它们中断前的状态，并不能反映后来落盘的补全。不要再照旧日志里的“compile.ts 未落盘”“缺 simulate 导出”“panelDeltas 未实现”等报错盲目修复：这些现已不存在。

### 已验证的功能块

- 快照真实从保存状态继续：保存日志/展示/规则/诊断/调度 progress；按标识接定义，动作 instance 保持引用别名；恢复跳过 onResolve；S[maxFrames] 先做原边界尚未执行的上限检查。JSON 往返后两条真实轴、合成轴和停止路径均与从头运行的结果及终态对齐。
- 缓存由调用方持有，runId + diag 隔离，读写复制；跨 600 帧间隔从旧快照推进，不重新初始化。实际基准文件 `out/dd10-benchmark.jsonl`：M0 100 次查询 12,767.5 → 3,112.8 ms，中4 24,557.0 → 5,824.8 ms，约 4.1～4.2 倍。
- 核心拆分、分析迁移、正式入口迁移已可编译；全库 `src/web/tests` 搜索未剩 `simulate(...)` 或 `prepareResolved(...)` 调用。`simulate.ts` 文件本身仍存在，但里面是内部 execute，不代表兼容函数没删。
- `panelDeltas` 从真实场景装配后、身份计算前应用，只改 panel，不重算静态 stats/scale，保留原分析口径；角色、字段、有限数校验及身份变化已有测试。
- 已落盘的本地验收产物另核对过：`out/dd10-before/MANIFEST.json`、`out/dd10-after/MANIFEST.json`；41 个样例与改前基线一致，零干扰通过；`/tmp/dd10-fuzz.log` 是默认 30 场景 0 问题的实际输出；四个分析命令 `/tmp/dd10-analysis/{insight,matrix,scorecard,sensitivity}.{before,after}` 的差异仅目录与耗时。它们是本地被忽略/临时产物，**不是已提交的证据文件**。
- 网页构建已有成功产物 `out/web/` 与 `/tmp/dd10-web.log`；本轮重新检查了类型和 Worker 测试，不把此前构建日志当成“又重新构建一次”。
- Git 变更中无场景快照文件更新，未用更新快照方式掩盖业务变化。

### 逐文件核对（当前已完成的路径）

以下表逐一覆盖当前 134 个变动路径；其中 6 个有收尾/覆盖问题的文件移列第二部分，避免混称“全部无误”。`??` 文件是真实存在但未跟踪，提交前不能漏掉。

| Git 状态 | 当前文件（重命名来源） | 磁盘改动与核对结论 |
|---|---|---|
| ` M` | `AGENTS.md` | 增加分析目录、正式入口、四条边界与 DD-10 记录；旧条目保留历史语境。 |
| ` M` | `docs/20261111-coordinate-review/engine-foundation-architecture-draft.md` | 增加 DD-10 当前代码说明，旧基线表明确保留评审历史；不是运行实现。 |
| `RM` | `src/analysis/analysis.ts` ← `src/engine/analysis.ts` | 对比/边际改经正式准备入口，提供真实场景 preparedScenario；错误仍为 ResolveError。 |
| `RM` | `src/analysis/calibration.ts` ← `src/engine/calibration.ts` | 移目录与引擎类型公开入口引用；校准逻辑未变。 |
| `RM` | `src/analysis/candidates.ts` ← `src/engine/candidates.ts` | 移目录，所有执行/规则/类型经公开入口；候选变体仍重新准备。 |
| `RM` | `src/analysis/cards.ts` ← `src/engine/cards.ts` | 套路单量/基准执行改用正式准备，保留诊断。 |
| `RM` | `src/analysis/fit.ts` ← `src/engine/fit.ts` | 变体从源 Scenario 修改，规则覆盖进入 prepareRun，不再修改 ResolvedScenario 执行。 |
| `RM` | `src/analysis/fuzz.ts` ← `src/engine/fuzz.ts` | 变体从真实源准备；单调性增量进入 panelDeltas，ledgerRun 接 PreparedRun。 |
| `RM` | `src/analysis/insight.ts` ← `src/engine/insight.ts` | 能量二分/延迟/假设/卡帧覆盖通过正式入口；与原输出一致。 |
| `RM` | `src/analysis/matrix.ts` ← `src/engine/matrix.ts` | 各队对敌仿真改用真实源场景准备；接力逻辑未变。 |
| `RM` | `src/analysis/observations.ts` ← `src/engine/observations.ts` | 纯观测状态比较模块移目录，逻辑未变。 |
| `RM` | `src/analysis/optimize.ts` ← `src/engine/optimize.ts` | 完整仿真改走正式入口，命中 onHit 快速重算通道保留。 |
| `RM` | `src/analysis/plan.ts` ← `src/engine/plan.ts` | 候选/启动轴从真实变体场景准备，失败仍分类。 |
| `RM` | `src/analysis/sample.ts` ← `src/engine/sample.ts` | 种子逐次传 prepareRun，随机只来自原 RNG。 |
| `RM` | `src/analysis/scorecard.ts` ← `src/engine/scorecard.ts` | 内部运行/insight 改新签名，业务输出前后相同。 |
| `RM` | `src/analysis/search.ts` ← `src/engine/search.ts` | evaluate/searchRotation 改真实源输入，编译错误与候选排行保留。 |
| `RM` | `src/analysis/sensitivity.ts` ← `src/engine/sensitivity.ts` | name/sc + data 与 RunOverrides，业务矩阵前后相同。 |
| `RM` | `src/analysis/trace.ts` ← `src/engine/trace.ts` | 移目录并改公开类型/纯函数引用，出处算法未改。 |
| `RM` | `src/analysis/zero-interference.ts` ← `src/engine/zero-interference.ts` | 移目录，经公开入口执行和查询，诊断对拍逻辑保留。 |
| ` M` | `src/cli/calibrate.ts` | 校准运行走真实源场景 prepareRun/runPrepared。 |
| ` M` | `src/cli/candidates.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/cards.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/compare.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/conformance.ts` | 导出/verify CLI 与合成样例接线；41 样例及 CLI 篡改退出码验证通过。 |
| ` M` | `src/cli/fit.ts` | fitVariants 改传 Scenario + GameData。 |
| ` M` | `src/cli/fuzz.ts` | fuzzScenario 改传 Scenario + GameData，默认 30 场景模糊测试通过。 |
| ` M` | `src/cli/insight.ts` | insight 改传真实场景/数据，移除旧 strictResolve 装配中间入口。 |
| ` M` | `src/cli/marginal.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/matrix.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/optimize.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/plan.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/run-env.ts` | 工作区内容指纹范围加入 src/analysis。 |
| ` M` | `src/cli/scorecard.ts` | 分析入口 import 迁目录，新接口消费端通过类型检查和相关回归。 |
| ` M` | `src/cli/search.ts` | searchRotation 改传真实场景/数据，移除不再使用的提前装配。 |
| ` M` | `src/cli/sensitivity.ts` | 矩阵输入改为 name/sc + data，strict 并入真实场景。 |
| ` M` | `src/cli/sim.ts` | 抽样改传源场景和数据；正式运行入口保留。 |
| ` M` | `src/cli/timeline.ts` | 时间轴执行改用 prepareRun/runPrepared，保留 eventMeta 诊断。 |
| ` M` | `src/cli/trace.ts` | 调试表执行改用 prepareRun/runPrepared，按需开启资源账本。 |
| ` M` | `src/engine/assumptions.ts` | 仅修正分析文件迁移后的可调位置说明。 |
| ` M` | `src/engine/context.ts` | 修正边界簿记说明，删除兼容入口注释。 |
| ` M` | `src/engine/diagnostics.ts` | DiagSink 与 RuleCounter 的 checkpoint/restore；完整诊断前后对拍通过。 |
| ` M` | `src/engine/digest.ts` | SHA 长度位计算使用 num.floor，摘要向量测试通过。 |
| ` M` | `src/engine/enemy.ts` | 伤害检查经注入钩子，衰减 floor 集中。 |
| ` M` | `src/engine/formula.ts` | floor 集中，参数更名避免遮蔽；伤害公式回归通过。 |
| ` M` | `src/engine/invariants.ts` | checkTick 改收 ResolvedScenario；错误类引用下沉，不再依赖执行环境。 |
| ` M` | `src/engine/kernel.ts` | 提供 checkTick/checkHit 注入钩子，执行层不直接依赖检查模块。 |
| ` M` | `src/engine/num.ts` | 增加 floor，覆盖负数/负零/无穷/NaN 语义。 |
| ` M` | `src/engine/probe.ts` | 提示取整与等待常量引用下沉。 |
| ` M` | `src/engine/query.ts` | replayTo 接恢复状态；stateAt 支持 cache，跨间隔从旧快照推进。 |
| ` M` | `src/engine/resolve.ts` | 编译引用改为 compile；floor/round 集中，不改变装配结果。 |
| ` M` | `src/engine/resources.ts` | 能量提示取整改经 num.floor。 |
| ` M` | `src/engine/rng.ts` | nextInt 使用 num.floor，随机算法未改。 |
| ` M` | `src/engine/run-types.ts` | 新增 panelDeltas、下沉 BoundaryObserver；接口已被当前编译和消费端验证。 |
| ` M` | `src/engine/run.ts` | 删除 prepareResolved/runWithFailure；注入检查、透传恢复状态；面板增量校验并进入身份。 |
| ` M` | `src/engine/scheduler.ts` | 移出编译和错误类；progress 显式化；恢复时先补上限检查。 |
| ` M` | `src/engine/simulate.ts` | 仅保留内部 execute；保存恢复 ExecutionMemory、跳过初始化、还原展示/规则/诊断前缀。 |
| ` M` | `src/engine/summary.ts` | 事件读值和等待分类引用下沉；取整改走 num，业务对拍一致。 |
| ` M` | `src/engine/triggers.ts` | ScheduleError 改从共享 types 引入。 |
| ` M` | `src/engine/types.ts` | 下沉 ScheduleError/Code，类行为保留。 |
| ` M` | `src/report/candidates.ts` | 分析类型/模型引用迁到 src/analysis；展示接口保持，类型与时间轴/报告测试通过。 |
| ` M` | `src/report/diff-timeline.ts` | 分析类型/模型引用迁到 src/analysis；展示接口保持，类型与时间轴/报告测试通过。 |
| ` M` | `src/report/timeline.ts` | 分析类型/模型引用迁到 src/analysis；展示接口保持，类型与时间轴/报告测试通过。 |
| ` M` | `tests/alm.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/analysis.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/assumptions.test.ts` | 记录点扫描包括新分析目录；运行入口迁移，matrix-relay 断言保留。 |
| ` M` | `tests/calibration-clock-branch.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/calibration.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/candidates.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/cards.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/env-buffs.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/fire.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/fit.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/fuzz.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/goal.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/helpers/kernel-harness.ts` | 编译引用迁到 compile.ts。 |
| ` M` | `tests/helpers/m0.ts` | 真实 M0 输入经过正式 prepareRun/runPrepared。 |
| ` M` | `tests/helpers/old-owners.ts` | 旧归属对照帮助函数的分析类型引用迁移。 |
| ` M` | `tests/helpers/synth.ts` | 人造源场景经过正式入口，不新增 simulate 替代封装。 |
| ` M` | `tests/insight.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/invariants.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/jms.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/jys.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/m0-team.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/matrix.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/num.test.ts` | 新增 floor 语义用例。 |
| ` M` | `tests/optimize.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/phase-boundary.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/plan.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/portable.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/prepared-run.test.ts` | 源身份/增量结果/共享数据不变及非法增量拒绝；新增 2 项用例通过。 |
| ` M` | `tests/propositions.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/resonance.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/resource-ledger.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/review-fixes.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/run-coverage.test.ts` | 保留七路径断言；兼容抛错用例改为正式 engineError 语义，观察回调仍抛错。 |
| ` M` | `tests/sample.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/scenarios.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/scorecard.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/search.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/sensitivity.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/sim.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/spawn-note.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/summary-boundaries.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/summary.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/td06-enemy.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/td09.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/timeline.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/trace.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/tys.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/xin-team.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/xin-tower3.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/xin-tower4.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `tests/zero-interference.test.ts` | 迁移正式运行入口 / 测试专用夹具或分析新路径；原测试主题与机制断言保留，当前对应测试文件通过。 |
| ` M` | `web/app/src/handlers.ts` | 运行/结论/搜索改用正式入口与新分析签名；Worker 测试通过。 |
| ` M` | `web/app/src/protocol.ts` | 请求响应的分析类型引用迁目录，tsc/Svelte 通过。 |
| ` M` | `web/app/src/views/PlanView.svelte` | 计划结果类型引用迁目录。 |
| ` M` | `web/app/src/views/SearchView.svelte` | 搜索结果类型引用迁目录。 |
| ` M` | `web/designs/shared.js` | 只修改注释里的 trace 文件路径，运行逻辑未改。 |
| `??` | `docs/20261111-coordinate-review/detailed-design/dd-10-snapshot-audit.md` | 新增运行可变状态清单、恢复契约、缓存数字、拆层和验收记录；文件已存在但尚未跟踪。 |
| `??` | `src/cli/conformance-artifacts.ts` | 完整输入输出、MANIFEST、语义比较和外部文件摘要校验。 |
| `??` | `src/cli/conformance-cases.ts` | 新增七条停止路径与四组相位边界，测试逐项验证实际行为。 |
| `??` | `src/engine/compile.ts` | 从 scheduler 拆出排轴编译；静态前台/补位检查保留，取整经 num。 |
| `??` | `src/engine/event-util.ts` | 下沉 hitValue/battleFrameOf，避免执行引用汇总。 |
| `??` | `src/engine/index.ts` | 显式导出分析需要的运行、查询、诊断、纯函数；没有重新导出旧兼容 API。 |
| `??` | `src/engine/snapshot.ts` | 新增快照捕获、定义接回、实例别名、wire 往返、真实续跑与内存缓存；全诊断/真实轴测试通过。 |
| `??` | `src/engine/wait-codes.ts` | 下沉 INTENDED/INTENT_WAITS，执行与汇总共用。 |
| `??` | `tests/conformance.test.ts` | 6 项 CLI 测试：路径、相位、缩进、清单、摘要与事件篡改。 |
| `??` | `tests/helpers/prepared-fixture.ts` | 新测试专用 PreparedRun 夹具，明确 test-fixture 身份；不得推广到生产。 |

## 2) 改了一半或存在编译/接口断层的半成品文件及具体问题

**当前没有复现到编译错误、模块缺失或生产调用签名断层。** 最新 `pnpm check` 与完整测试均通过。以下是实查发现的收尾/防回退覆盖问题，不夸大为引擎已经运行错误：

| 编号 | 文件 | 已有内容 | 具体问题与下一步 |
|---|---|---|---|
| D1 | `docs/20261111-coordinate-review/detailed-design/dd-10-snapshot-split.md` | 接口、缓存、验收勾选均已更新 | 第4行仍写“还没实现”，第7行仍写“待拆的是…”；与文件后面的全部勾选及当前代码矛盾。改为实施状态/历史动工记录，注明实际验收范围。 |
| D2 | `docs/wuwa-dps-td02-types-schema-v0.1.12.md` | DD-10 补充已写新快照/增量接口 | 第522行仍描述 `fuzzScenario(r, rotation, opening, n?, opts?)`、`ledgerRun(r)` 和 `src/engine/fuzz.ts`。当前真实接口是 `src/analysis/fuzz.ts` 的 `fuzzScenario(sc, data, n?, opts?)` / `ledgerRun(p: PreparedRun)`，需要并回旧段。 |
| D3a | `docs/wuwa-dps-td04-sim-kernel-v0.1.7.md` | 新增边界快照/簿记/别名段 | 第72行笼统说“恢复后从该帧 P1 继续”，遗漏先补 `S[maxFrames]` 的上限检查。与 scheduler.runLoop 的 resumeBoundary 分支不完全一致。 |
| D3b | `docs/wuwa-dps-engine-tech-design-v0.2.4.md` | 架构/入口/错误/conformance/快照均已同步 | 第812行也无条件写“下一步从第 f 帧 P1 接续”；应加“先补上限判断，未终止才进入 P1”。 |
| Q1 | `tests/layering.test.ts` | AST 四条规则及6个测试都通过，无迁移豁免 | 原测试“新引擎文件必须先归层”被删，新规则依靠 EXECUTION/ENTRY_REPORT 名单。未列入名单的新文件会跳过执行组约束，容易让未来新增执行文件绕过规则3。这不是当前源码违规，但防回退不完整；可恢复未知文件拒绝/显式分类，并加反例。 |
| Q2 | `tests/snapshot.test.ts` | 10项通过，覆盖业务恢复/JSON/诊断/RNG/别名/S[0]/缓存 | C10-10 的 S[0] 用例有真实生成和全结果比较，但没有把初始化生成的链卡在 maxChainDepth 阈值上验证“丢失 spawned 必须改变 chainDepth 结果”。现有业务根诊断对拍有帮助，但阈值反例仍未专门覆盖。应作为补强，不要误报当前恢复已经失败。 |

另外两点非阻塞注意：

- `src/engine/query.ts` 与 `src/engine/snapshot.ts` 有直接互相 import；当前模块初始化、Node 测试与 Web 构建均可运行。DD-10 强制的是执行组不反向 import 入口/汇总，不能仅凭这个查询层循环断言违反全部设计；若后续要消除所有模块循环，再单独安排 query-types/projection 下沉，不能混进本次“已确认断层”。
- `src/engine/snapshot.ts` 的 payload 为可信本实现生成的数据；损坏 payload 可能直接抛解析错误，而不是 QueryResult。当前契约只明确 runId/diag 拒绝，未把输入安全硬化作为本次要求；不要未经确认扩成一项阻塞任务。

这些问题本次只记录，未继续修改业务或文档原件。所有新增核心/测试文件还在 `??` 状态；17 个重命名有 staged/unstaged 两层，后续保存时必须看 `git diff HEAD`，不能只看 `git diff` 就断言遗漏或已提交。

## 3) 尚未开始的剩余子任务及各自涉及的文件路径

**原拆分的 T10-1～T10-8 都已经有可运行实现；没有发现整块尚未开始的原定功能。** 当前剩余是收尾与额外防回退补强，而不是重写快照或再次搬目录：

1. [x] **文档收尾（第二部分 D1～D3）**
   涉及：
   - `docs/20261111-coordinate-review/detailed-design/dd-10-snapshot-split.md`
   - `docs/wuwa-dps-td02-types-schema-v0.1.12.md`
   - `docs/wuwa-dps-td04-sim-kernel-v0.1.7.md`
   - `docs/wuwa-dps-engine-tech-design-v0.2.4.md`
   这些文档不是“从未修改”，而是本次审计识别出的矛盾尚未开始修补；修正文案后不要重新勾选成未经验证的新功能。

2. [x] **补回新增文件归层的防线（Q1）**
   涉及：`tests/layering.test.ts`。添加未归层文件反例，确保未来执行文件不能靠未列入 EXECUTION 绕开规则3；不能加迁移豁免。

3. [x] **补 S[0] spawned 连锁深度阈值反例（Q2）**
   涉及：`tests/snapshot.test.ts`，必要时 `tests/helpers/synth.ts` / `tests/helpers/kernel-harness.ts`。构造初始化派生判定 → 第0帧结算继续引链、接近 maxChainDepth 的用例；比较正常恢复与从头执行，最好另构造丢失链元数据的负例证明用例有辨别力。没有证据需要先改 `src/engine/snapshot.ts` 或 `src/engine/simulate.ts`，不要无依据动内核。

4. [x] **保存收尾后的最终证据（不是新实现）**
   涉及：`docs/20261111-coordinate-review/detailed-design/dd-10-snapshot-audit.md`、本文件；本地产物 `out/dd10-after/`、`out/dd10-query.json`。待以上补强完成后重新运行：
   ```bash
   git diff --check
   pnpm check && pnpm test && pnpm test:py
   pnpm conformance --verify out/dd10-before
   pnpm web:build
   ```
   若 `out/dd10-before` 在新环境不存在，不可拿当前版本重新导出的产物冒充“改前基线”；应从原 HEAD/原工作目录恢复。没有变更构建/游戏数据，本任务不需人为修改 generated 或为迁目录重建 xlsx。是否提交由用户另行决定；没有“已提交”的事实。

恢复时优先打开：`TODO_RESUME.md` → `src/engine/snapshot.ts` / `src/engine/simulate.ts` → `tests/snapshot.test.ts` → `docs/20261111-coordinate-review/detailed-design/dd-10-snapshot-audit.md`。本清单的第二、三部分是余项，第一部分不要重复实现。
