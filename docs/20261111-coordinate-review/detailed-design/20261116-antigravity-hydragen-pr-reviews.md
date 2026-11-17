# PR #127～#137 对照详细设计检查报告（Antigravity）

- **检查范围**：PR #127（`d5d9b9e`）至 PR #137（`cfa5ce7`，当前 `HEAD`）对照 [`detailed-design/`](README.md) 下 DD-01～DD-10 与 [`README.md`](README.md) §4–§6（含补充提案 S-01～S-15）。
- **检查时间与基线**：2026-11-17；工作区代码基线 `cfa5ce7`（文件按约定命名为 `20261116-antigravity-hydragen-pr-reviews.md`）。
- **验证环境与局限**：当前 worktree 缺少 `node_modules/` 与 `data/generated/`，因此本次**未运行** `pnpm check`（`tsc` / `svelte-check`）、`pnpm test`（Vitest）、`pnpm conformance`、`pnpm fuzz`、`pnpm query` 或 `pnpm web:build`；仅实际执行了构建脚本单元测试 `python3 -m unittest discover -s tools/build -p "test_*.py"`，结果 **71 项测试通过（`Ran 71 tests in 0.034s`, `OK`）**。以下审查结论来自对源码、测试、Git 历史与设计/正式文档的静态核查。

---

## 一、核查范围：PR #127～#137 合并记录

| PR | 合并提交 | 分支 | 对应工作包 |
|---|---|---|---|
| #127 | `d5d9b9e` | `everbird/dd-01-run-contract` | DD-01（运行输入、运行身份、完成状态与分层检查） |
| #128 | `0151abe` | `everbird/dd-03-measurement-fixes` | DD-03（量尺与报告修复） |
| #129 | `5ef4e60` | `everbird/dd-04-t04-1-t04-2-propositions` | DD-04 T04-1～T04-2（规则台账基础与 `forteKeepOnSwitchBy`） |
| #130 | `81f924f` | `everbird/dd-02-strict-entry` | DD-02（严格教学轴入口） |
| #131 | `e817737` | `everbird/dd-05-event-origin-diagnostics-2` | DD-05（事件来源、诊断旁路、规则使用与零干扰） |
| #132 | `9a182b2` | `everbird/dd-04-t04-1-t04-2-ledger-candidates` | DD-04 §4–§8（候选检查与严格轴结论） |
| #133 | `ada2d6f` | `everbird/dd-06-resource-ledger` | DD-06（资源只读账本） |
| #134 | `eaba934` | `everbird/implement-dd-07-state-query` | DD-07（状态查询、试算、可解释性与命令行 JSON） |
| #135 | `71cb602` | `everbird/implement-dd-08-evidence-loop` | DD-08（证据闭环与进游戏实验） |
| #136 | `9620676` | `everbird/implement-dd-10-snapshot-split` | DD-10（边界快照恢复、执行拆环与分析层切出） |
| #137 | `cfa5ce7` | `everbird/implement-dd-09-replay-fit` | DD-09（录像输入、状态同步与贴合度） |

---

## 二、总体符合度与预期延后项

**总体评价**：DD-01～DD-10 的主体架构、核心契约与补充提案 S-01～S-15 绝大部分已按设计落地。后期 PR 之间的叠加兼容性良好——特别是 PR #136（DD-10）将 DD-08 新增的 `evidence.ts` 同步迁入 `src/analysis/` 并把 `src/analysis` 纳入 [`src/cli/run-env.ts`](../../../src/cli/run-env.ts#L10) 指纹目录，PR #137（DD-09）在 DD-10 拆层之上将 [`src/engine/resource-replay.ts`](../../../src/engine/resource-replay.ts) 显式归层到 `ENTRY_REPORT`、在 `ExecutionMemory` / `stateFromView` 中完整覆盖同步状态与干预记录，未破坏分层边界或快照恢复契约。

同时，仍存在多处**具体功能/契约遗漏与 Bug**、**过程文件误提交**、**网页端兼容回归**以及**文档同步漂移**，需进一步 review 与收尾。

### 1. 各工作包与补充提案符合度一览

| 工作包 / 提案 | 状态 | 说明 |
|---|---|---|
| **DD-01** | 主体符合 | `prepareRun` / `runPrepared` / `RunIdentity` / `RunCompletion` 已落地；`S-03`（`loopExitAt.phase` 含 `'P1'`）已在代码实现。 |
| **DD-02** | 主体符合（部分缺失 / 1 项预期延后） | 严格声明、意图失败与续跑、`StrictReport`、`DamageScope` 已落地；`!@N`（T02-8 / C02-13）按 `DD02-Q3` 预期**延后**（[dd-02-implementation.md](dd-02-implementation.md#L4)、[dd-02-strict-entry.md](dd-02-strict-entry.md#L353)）。**遗漏** DD-02 §3.7 要求的信封 `unsupported` 披露与 `basis.ts` 优先判错顺序问题。 |
| **DD-03** | 主体符合（消费侧有小缺口） | `basis.ts`、`DamageScope`、`BuffUptimeRow`、`observations.ts` 核心已落地；`scorecard.ts`、`optimize.ts`、`matrix.ts`、`CompareView.svelte` 存在若干口径/展示未接全；文档开头状态未更新。 |
| **DD-04** | 主体符合（报告/测试有缺陷） | `propositions.ts`、`candidates.ts`、`m0-strict-conclusion.md` 已落地；存在列表拼接分隔符错误、结论记录游离提交号与测试仍跑临时替代文件的问题。 |
| **DD-05 / DD-06** | 主体符合（个别点未插桩） | 来源回填、作用域、`RuleCounter`、`zero-interference.ts`、账本闭合与写入点已落地；`心.ts` 的 `summonCountsAsChar` 与 DD-08 新增的 `concertoTimingBy` 未进 `rule-points.ts`。 |
| **DD-07** | 内核符合 / CLI 有偏离与崩溃隐患 | `query.ts`、`probe.ts`、`wire.ts`、`ReadonlyHookContext` 与 C07-1～C07-31 测试齐全；但 `wouldHypotheticalEventTrigger` 存在未知角色名 `TypeError`，[`src/cli/query.ts`](../../../src/cli/query.ts) 与 DD-07 §10 契约存在多项偏离且无 CLI 测试。 |
| **DD-08** | 软件完成 / T08-8 待实测 | `observations.ts`、`evidence.ts`、`pnpm evidence` 与 3 个回填闭环已落地；**T08-8**（第一条新闭环 [`echo-input-priority.2026-11.yaml`](../../evidence/echo-input-priority.2026-11.yaml)）已完成预登记，`verdicts: []` 等进游戏实测。 |
| **DD-09** | 主体符合（衔接处与网页端有回归） | `sync`、3 种时段、`fit.ts`、视图 F 及 5 个录像场景重记已落地；[`zhenhuanyu-window.backfill.yaml`](../../evidence/zhenhuanyu-window.backfill.yaml) 按现有材料判 `unverified` 并给出训练场区分实验。存在 `sync` 无 `relatedEventSeq` 引发的观测/调试表问题，以及网页端缺失 `envBuffs` / `--fill`。 |
| **DD-10** | 核心完成（含误提交与导出范围差异） | 生产兼容外壳已彻底移除、`compile.ts` 等拆环完成、`src/analysis/` 18 个文件全部只经 [`src/engine/index.ts`](../../../src/engine/index.ts) 引入、边界快照恢复与 `MemorySnapshotCache` 已落地；但随 PR #136 误提交了根目录 `TODO_RESUME.md`，`index.ts` 与 DD-10 §5 所述全量导出不同。 |
| **S-01～S-15** | 代码侧基本兑现 / 架构正文未回写 | 15 项在代码中均已有实现或演进对应（注：**S-04** 未在 `RunOptions` 设 `checkLog` 开关，而是由 `runCore` 无条件注入 `checkTick`/`checkHit`、`checkLog` 为独立纯函数，`onHit`/`diag`/`observer` 不进 `RunIdentity` 且异常原样抛出）；但正式架构草案未按约定回写。 |

---

## 三、确认的遗漏、Bug 与契约/实现不一致

### 1. 高优先级（功能失效 / 运行期崩溃 / 核心契约缺失）

1. **缺失 DD-02 §3.7 要求的 `CapabilityDisclosure.unsupported` 谐破披露**
   - **设计要求**：[dd-02-strict-entry.md](dd-02-strict-entry.md#L269) 要求在 `damageScope.tuneBreak.mode === 'omitted'` 时，信封的 `CapabilityDisclosure.unsupported` 加 `'damage.tuneBreak: 未含谐度破坏（<reason>）'`，`gauge: 'off'` 时再加 `'damage.disharmonyDependent'`。
   - **现状**：全仓检索 `damage.tuneBreak` 与 `disharmonyDependent` 均为 **0 命中**。[`src/engine/wire.ts`](../../../src/engine/wire.ts#L38-L58) 的 `envelope()` 仅透传调用方传入的 `unsupported`，[`src/cli/query.ts`](../../../src/cli/query.ts) 也未按 `damageScope` 补充这两项披露。

2. **`wouldHypotheticalEventTrigger` 传入队伍外角色名会抛出未捕获 `TypeError`**
   - [`src/engine/query.ts`](../../../src/engine/query.ts#L880-L885) 用 `try { occs = occurrencesOf(r.sim, fullEvent, false) } catch` 假定未知角色名会在 `occurrencesOf` 内抛错并转为 `QueryError(unsupported)`。
   - 实际上 [`src/engine/triggers.ts`](../../../src/engine/triggers.ts#L205-L215) 中 `const slot = (name: string): Slot => sim.slotOf.get(name)!` 在角色名未知时返回 `undefined`：除 `actionStart` 因访问 `sim.r.team[by]` 立刻抛错外，`hit`/`heal` 等事件直接构造 `{ ..., by: undefined }` 返回；随后在 `try` 之外执行 [`src/engine/probe.ts`](../../../src/engine/probe.ts#L663-L664) 的 `charLabel(s, o.by)` 访问 `s.chars[slot].name` 时直接抛出未捕获 `TypeError`。

3. **DD-09 同步写入无 `relatedEventSeq`，导致 `balanceAround` 与 `gainSteps` 错位**
   - [`src/engine/resources.ts`](../../../src/engine/resources.ts#L129-L132) 中 `syncResource` 记的账本条目不含 `relatedEventSeq`（`kind: 'sync'`、`causeKind: 'sync'`）。
   - **观测读取受污染**：[`src/analysis/observations.ts`](../../../src/analysis/observations.ts#L254-L262) 的 `balanceAround` 用 `pos = e.relatedEventSeq ?? pos` 追踪位置，且只在 `e.relatedEventSeq === undefined && e.actualDelta === 0` 时跳过。当一条 `actualDelta !== 0` 的 `sync` 条目紧邻目标事件出现时，它会继承上一条的 `pos`（甚至可能误命中 `caused.has(pos)`），导致 `resourceAt` 的 `before`/`after` 读错。
   - **调试表排序与文案分裂**：[`src/analysis/trace.ts`](../../../src/analysis/trace.ts#L438-L445) 中 `gainSteps` 带账本时，无事件的 `change` 用 `anchor`（上一条有 `relatedEventSeq` 的序号），`sync` 用 `rec?.afterEventSeq ?? anchor` 后再 `loose.sort`；当 `sync` 位于无事件钩子条目之间时，相对顺序与所挂锚点可能错位。此外，账本分支（[L441](../../../src/analysis/trace.ts#L441)）与非账本 `syncStep`（[L300-L306](../../../src/analysis/trace.ts#L300-L306)）给出的 `label` 格式不一致。

4. **网页端缺失 `envBuffs` 与录像多填法（`--fill`）处理**
   - [`web/app/src/gamedata.ts`](../../../web/app/src/gamedata.ts#L58) 硬编码 `envBuffs: []`（CLI 侧会加载 `data/curated/env-buffs.ts`）。仓库中按 DD-09 重记的录像场景（如 [`tys-video.yaml`](../../../scenarios/tys-video.yaml#L50)、[`xin-tower3-video.yaml`](../../../scenarios/xin-tower3-video.yaml#L54)、[`xin-tower4-video.yaml`](../../../scenarios/xin-tower4-video.yaml#L48)、[`fire-tower1-video.yaml`](../../../scenarios/fire-tower1-video.yaml#L45)、[`fire-tower2-video.yaml`](../../../scenarios/fire-tower2-video.yaml#L42)）均使用 `environment:`，在网页端运行会在 `resolveScenario` 因找不到环境特性报错。
   - [`web/app/src/handlers.ts`](../../../web/app/src/handlers.ts#L53-L55) 直接调用 `prepareRun(sc, await gd())`，未像 CLI 一样支持多组 `replay.segments` 填法组合的选择或报错提示。

5. **`--strict` CLI 覆盖直接修改场景对象；`basis.ts` 优先读废弃 `res.error`**
   - [`src/cli/insight.ts`](../../../src/cli/insight.ts#L18) 和 [`src/cli/sensitivity.ts`](../../../src/cli/sensitivity.ts#L22) 直接原地改动 `sc.options.strict` / `effective.options.strict`，未通过 `RunOverrides.strict` 传递。
   - [`src/engine/basis.ts`](../../../src/engine/basis.ts#L67-L76) `completionReason` 在读取 `c.axisFailure` 之前优先返回 `@deprecated` 的 `res.error`：在 `continueAfterIntentUnmet: true` 续跑后又触发第二个调度错误（如 [`tests/strict-teaching.test.ts`](../../../tests/strict-teaching.test.ts#L111-L115) 第一条为 `introMissed`、后续又触发 `entrySkill`）时，`usableBasis` 的原因会报后者的 `entrySkill` 而非 `completion.axisFailure` 记录的 `intentUnmet`。

---

### 2. 中优先级（CLI 契约偏离 / 局部逻辑缺口 / 报告与测试瑕疵）

1. **`src/cli/query.ts` 与 DD-07 §10.1 / §10.3 对不齐且缺少测试**
   - `run` 子命令（[`src/cli/query.ts`](../../../src/cli/query.ts#L312-L322)）的 `payload` 仅输出 `{ runId, summary, eventCount, log? }`，**遗漏 DD-07 §10.3 要求的 `strictReport`**（及 `damageScope`）。
   - `capabilitiesUsed` 输出 `'replayTo'` 等函数名而非 DD-07 §10.1 约定的能力标识符（如 `'state.recompute'`，与 [`tests/wire-json.test.ts`](../../../tests/wire-json.test.ts#L109) 所测口径不一致）；`would` / `command` / `explain` / `diff` 的 `unsupported` 也未按 DD-07 §6、§10.1 披露 `'帧内时刻'`、`'间接的时序影响'` 等（[L395-L439](../../../src/cli/query.ts#L395-L439)、[L577](../../../src/cli/query.ts#L577) 多传 `[]`）。
   - `diff`（[L527-L579](../../../src/cli/query.ts#L527-L579)）对第二场景 `thirdPos` 未调用 `pickFillCombo`（也缺 `--cand-fill`），未暴露 `diffRuns` 已支持的 `--mapping` 与 `--cmd`，`commands` 目标开启了过重的 `ALL_DIAG`；且 `state`、`terminal`（[L346-L352](../../../src/cli/query.ts#L346-L352)）、`explain`、`command`、`why-not`、`would`、`diff --target events` 会先跑一次再查，重复执行 2～4 次完整仿真。
   - [L594](../../../src/cli/query.ts#L594) 超时提示仍输出过时的 `"当前未做快照缓存，每次查询均从头重跑（DD-07 §3.5）"`；全库 `tests/` 中没有任何覆盖 `src/cli/query.ts` 的自动化测试。

2. **DD-10 公开导出范围与 `stateAt` / `diffRuns` / `DiagSink` / `snapshot.ts` 边界细节**
   - [dd-10-snapshot-split.md](dd-10-snapshot-split.md#L117) 写 `src/engine/index.ts` 列出“`query.ts` 的全部导出”，实际 [`src/engine/index.ts`](../../../src/engine/index.ts#L1-L26) 刻意只导出了子集（如未导出 `replayTo`、`viewOf`、`toWire`、`fromWire`、`WIRE_SCHEMA_VERSION`）。
   - [`src/engine/query.ts`](../../../src/engine/query.ts#L396-L421) 在传入 `cache` 且无命中、查询帧恰好是 `600` 的倍数或越界帧时，会先跑一次 `snapshotAt`（正常帧多一次恢复解码，越界帧多一次回放）。
   - [`src/engine/query.ts`](../../../src/engine/query.ts#L1420) 与 [L1577](../../../src/engine/query.ts#L1577) 用 `!mapping` 判定未给显式映射，若传入空数组 `commandMapping: []` 会绕过 `ambiguous` 分支；`diffEvents`（[L1621-L1623](../../../src/engine/query.ts#L1621-L1623)）当 `target.cmd` 不在 `mapping` 中时 `filterCmdB` 会回退原编号 `target.cmd`。
   - [`src/engine/diagnostics.ts`](../../../src/engine/diagnostics.ts#L422) `fill()` 判空使用 `this.filled[i] !== undefined`，经 `toWire`/`fromWire` 后数组中的 `undefined` 空洞会转为 `null`；[`src/engine/snapshot.ts`](../../../src/engine/snapshot.ts#L115-L119) `restore()` 对结构损坏的 `snap.payload` 未包 `try/catch` 返回 `QueryResult`，会直接抛 `fromWire` 异常。

3. **DD-04 `candidates` 拼接分隔符 bug、游离提交号与代表轴测试滞后**
   - [`src/report/candidates.ts`](../../../src/report/candidates.ts#L5) 的 `names` 使用 `join(' × ')` 拼接候选，而 [L38](../../../src/report/candidates.ts#L38) 对 `notApplicable` 与 `unimplemented` 两组独立单项列表也复用了 `names`，导致生成文档 [`docs/m0-strict-conclusion.md`](../../m0-strict-conclusion.md#L347-L348) 把不同命题的候选误用 `×` 连成组合。
   - [`docs/m0-strict-conclusion.md`](../../m0-strict-conclusion.md#L23) 记录的代码提交 `0f998f44d115c6892de3ddc62c6f4074225e51a1` 不是 `HEAD`（`cfa5ce7`）的祖先，也不在仓库任何分支上。
   - [`tests/propositions.test.ts`](../../../tests/propositions.test.ts#L281-L292) 仍保留“等 DD-02 与 T04-9”注释，测的仍是 `scenarios/m0-video-eq.yaml` 配合 `tuneBreak: 'off'`，尚未换用正式的 `scenarios/m0-video-eq-不打谐破.yaml`。

4. **规则使用漏插桩（DD-05 / DD-08）**
   - [`data/curated/characters/心.ts`](../../../data/curated/characters/心.ts#L272-L273) 读取 `ctx.rules.summonCountsAsChar` 但未调用 `ctx.noteRule(...)`。
   - [`src/engine/resources.ts`](../../../src/engine/resources.ts#L178) 与 [L218](../../../src/engine/resources.ts#L218) 通过 `concertoTimingOf` 读取 DD-08 §13 新增的 `concertoTimingBy`，[`src/engine/rule-points.ts`](../../../src/engine/rule-points.ts#L15-L80) 的 16 个 `RULE_POINTS` 尚未登记该判定点。

5. **DD-03 / DD-09 量尺、分析与视图 F 的细节缺口**
   - [`src/analysis/scorecard.ts`](../../../src/analysis/scorecard.ts#L56-L60) `kills` 直接读取 `res.summary.goal`，未过 `usableBasis(res)` 闸门；
   - [`src/analysis/optimize.ts`](../../../src/analysis/optimize.ts#L53-L77) `buildReplayer` 调 `basisOf(res)` 未走 `usableBasis`，也未参考 `basis.lethal`；
   - [`src/analysis/matrix.ts`](../../../src/analysis/matrix.ts#L157-L158) 用 `resolveScenario` 取 `damageScope`，[`src/cli/matrix.ts`](../../../src/cli/matrix.ts#L33-L44) 的汇总对比表未单列谐破口径列（仅在末尾逐队明细中展示）；
   - [`web/app/src/views/CompareView.svelte`](../../../web/app/src/views/CompareView.svelte#L44-L71) 只显示 `scopeMismatch`，未展示匹配时的双方口径、`uptimeBy` 与 `baseOverflow`/`otherOverflow`；
   - [`src/analysis/insight.ts`](../../../src/analysis/insight.ts#L56-L59) `WAIT_LABEL` 缺 `entryBusy`；[`src/analysis/search.ts`](../../../src/analysis/search.ts#L202-L204) `FAILURE_LABEL` 缺 `intentUnmet` / `introMissed`；[`src/cli/sim.ts`](../../../src/cli/sim.ts#L46) `--sample` 判断 `status === 'completed'` 而非 `usableBasis(res).ok`，且 [L122](../../../src/cli/sim.ts#L122) 截断原因未打印 `pendingActions`/`inFlightJudgments`/`inFlightTails` 余量数字；
   - [`src/report/timeline.ts`](../../../src/report/timeline.ts#L110-L133) 与 [`web/designs/f-video.html`](../../../web/designs/f-video.html#L273-L280)：`conditionedFrom` 填入的是世界帧而非 [`wuwa-dps-td12-web-v0.2.7.md`](../../wuwa-dps-td12-web-v0.2.7.md#L170-L172) 所写的视频秒；`@` 后台来源在时间轴标记上未与前台动作明显区分绘制，且 `@延奏` 等非动作别名在 `events` 里易因 `action: null` 被标作缺失。

---

## 四、仓库卫生与文档同步漂移清单

### 1. 代码与仓库卫生残余
- **误提交过程文件**：根目录 [`TODO_RESUME.md`](../../../TODO_RESUME.md)（233 行）由 PR #136 提交 `dc67f1b` 随代码一起提交并留在 `HEAD`，应删除。
- **DD-10 轻微残余**：[`src/engine/compile.ts`](../../../src/engine/compile.ts#L10-L21) 与 [`src/engine/scheduler.ts`](../../../src/engine/scheduler.ts#L13-L30) 重复定义完全相同的 `fillerTarget`，`scheduler.ts:13-14` 仍留有 `INTENDED`/`ScheduleError` 等过渡转发；[`tests/layering.test.ts`](../../../tests/layering.test.ts#L11) 的 `EXECUTION` 集合仍包含并不存在的文件名 `'execution'`；`@deprecated` 字段（[`SimResult.error`](../../../src/engine/types.ts#L396-L399)、[`CalibrationResult.status`](../../../src/analysis/calibration.ts#L19-L20)）仍留存消费。

### 2. 设计文档、架构草案与正式 TD 文档漂移
- **DD 文档自身与总览**：
  - [`README.md`](README.md#L15)：实施进度尚未把 DD-10 标为已完成；§5（[L114-L118](README.md#L114-L118)）仍将 `candidates.ts`、`observations.ts` 及 `analysis.ts`～`trace.ts` 列在 `src/engine/` 下，且漏列 `snapshot.ts`、`wait-codes.ts`、`event-util.ts`、`resource-replay.ts`、`evidence.ts`、`zero-interference.ts`、`src/data/replay.ts` 等后续新增文件；
  - [`dd-03-measurement-fixes.md`](dd-03-measurement-fixes.md#L4) 开头仍写“还没实现”；
  - [`dd-02-strict-entry.md`](dd-02-strict-entry.md#L334) 验收清单第 2 项仍为 `[ ]`；
  - [`dd-07-state-query.md`](dd-07-state-query.md#L553) `T07-10` 误写为“§12 的集成清单”（实际为 `§13`）；
  - [`dd-10-snapshot-split.md`](dd-10-snapshot-split.md#L4) 第 4 行仍写“未创建提交”，§5（[L115](dd-10-snapshot-split.md#L115)）漏列 `zero-interference.ts` 与 `evidence.ts`。
- **架构草案**：
  - [`engine-foundation-architecture-draft.md`](../engine-foundation-architecture-draft.md#L1149-L1151) 未按 [`README.md`](README.md#L125) 约定在实施各包时回写 S-01～S-15（附录 C 目前只补了 DD-06 与 DD-09，正文与附录仍检索不到 `businessRoot`、`StrictReport`、`commandVerdicts`、`tuneBreakOmitted`、`subjectSeq` 等补充提案条目）。
- **正式 TD 与总设计文档**：
  - 多篇文档仍保留 DD-10 迁出前旧路径 `src/engine/*` 或旧入口 `simulate(`：[`wuwa-dps-engine-tech-design-v0.2.4.md`](../../wuwa-dps-engine-tech-design-v0.2.4.md#L20)、[`td09`](../../wuwa-dps-td09-rotation-scheduler-v0.1.11.md#L255)、[`td10`](../../wuwa-dps-td10-output-report-v0.1.17.md#L118)、[`td11`](../../wuwa-dps-td11-debug-calibration-v0.1.3.md#L200-L221)、[`td12`](../../wuwa-dps-td12-web-v0.2.7.md#L82)、[`td13`](../../wuwa-dps-td13-echo-optimizer-v0.1.2.md#L68)；其中 `td10:118` 与 `td12:82` 仍写已替换为 `walkCauses` 的旧名称 `walkOwners`；
  - [`wuwa-dps-td02-types-schema-v0.1.12.md`](../../wuwa-dps-td02-types-schema-v0.1.12.md#L500) 多处类型描述与源码不符：`goal.lethal` 写成 `{ frame, eventSeq, overflow }`（源码 [`types.ts`](../../../src/engine/types.ts#L381) 为 `{ eventSeq, rawDamage, overflow }`）；L519 账本 `LedgerCauseKind` 仍列 `'forced'`（与 L562 冲突）；L535 `ReadonlyHookContext` 漏写 `buffStacks` 且多写 `names`/`coreCaps`/`ruleNote`；L539 将映射表 `businessRoots` 误写为“数组”；
  - [`wuwa-dps-td06-resources-v0.2.4.md`](../../wuwa-dps-td06-resources-v0.2.4.md#L157) 仍残余 `（能量满）`；S-03（`loopExitAt.phase` 含 `'P1'`）在全部 `wuwa-dps-*.md` 中均未同步。

---

## 五、建议下一步优先处理的事项

1. **优先修功能与契约 Defect**：补全 DD-02 §3.7 `unsupported` 披露、修复 `wouldHypotheticalEventTrigger` 未知角色名未捕获异常、修正 `observations.ts`/`trace.ts` 对无 `relatedEventSeq` 同步条目的位置与文案处理、为 `web/app/src/gamedata.ts` 接入 `envBuffs`、调整 `basis.ts` 的 `completionReason` 先判 `c.axisFailure`。
2. **收口 `src/cli/query.ts` 与工程卫生**：给 `run` 补上 `strictReport`、对齐 `capabilitiesUsed`/`unsupported` 命名与披露、去掉冗余重跑和过时快照提示并补充 `cli/query` 自动化测试；删除误提交的 `TODO_RESUME.md` 及 `fillerTarget`/`execution` 等小残余。
3. **带数据环境完整验证与重生成**：在具备 `node_modules/` 与 `data/generated/` 的环境运行 `pnpm check`、`pnpm test`、`pnpm conformance`、`pnpm fuzz --ledger`，重生成 [`docs/m0-strict-conclusion.md`](../../m0-strict-conclusion.md)（同时修复 `src/report/candidates.ts` 的 `×` 拼接 bug 与游离提交号）并切换 [`tests/propositions.test.ts`](../../../tests/propositions.test.ts#L281-L292)，最后统一清理 DD 文档、架构草案与正式 TD 文档的漂移。
