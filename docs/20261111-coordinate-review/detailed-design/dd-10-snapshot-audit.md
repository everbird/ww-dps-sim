# DD-10 快照审计与验收记录

对应 DD-10 §3、§4、§5、§6、§8；本记录以实现后的代码为准。

## 1. 可变状态清单

| 位置 / 状态 | 处理 | 恢复方式 / 约束 |
|---|---|---|
| `SimState`：角色、资源、动作、判定、尾部、buff、敌人量表/效应、膨胀、调度队列、入场状态、下一个实例号、延奏链接、触发时间、假设、RNG | 保存 | `StateView` + 日志；定义以角色槽位 / 动作 ID / 判定名 / 敌人 ID 接回同一 `PreparedRun` |
| `action` / `last` / `combo` | 保存身份 | 每个角色按动作 `instance` 建对象表，共享实例恢复成同一个对象；`vars` 重新 seal |
| `queue.commands` / `opening` / `repeat` | 重建 | 来自同一装配结果，其余队列游标、等待累计、延迟均保存 |
| `bus.cursor` | 保存 | 取快照时要求等于日志长度，恢复后只处理后缀 |
| `bus.chain/current/inFlight/draining`、`Kernel.settleQueue` | 边界恒空 | 取快照逐项断言，不提前清掉来满足条件 |
| `bus.spawned` | 保存 | `S[0]` 可以非空；`f ≥ 1` 必须为空。初始化生成判定的业务链与深度不能丢 |
| `lastBattle` / 当前相位 | 保存 | 续跑不变量检查与终止路径仍使用原来的时钟 / 相位 |
| 展示 `shown` / `cdShown`、`forte` / `cooldowns` | 保存 | 去重表与已输出前缀一起保存，避免重复输出或漏输出 |
| `sim.warned`、干预、严格意图失败、提示、`continuationFrom` | 保存 | 不重新触发初始化；外部干预和诊断续跑的前缀编号接续 |
| 调度器 `progress.evalCount/headKey` | 保存 | 原闭包变量显式化；真实求值编号、命令开始提示不会重置 |
| `RuleCounter.reads/decisive/first` | 保存 | 从原计数继续，判定点索引表是静态定义 |
| `DiagSink` 的 filled、实体来源、规则明细、账本、命令求值、触发检查、伤害输入/窗口、业务根、nextScope、continuation、post | 保存 | 保存尚未 finish 的内部收集器，不以已渲染诊断替代；恢复时 `done` 清为 null |
| `DiagSink.stack` | 边界恒空 | 取快照断言，不能在事件处理中保存 |
| `Sim.book/hooks/ctxs/slotOf/keepStacks`、技能充能上限、谐破动作表、Kernel 回调、调度回调 | 重建 | 只依赖定义或已恢复的状态，不含独立演化的隐藏状态 |
| Execution 的失败 / 循环退出 / post-drain 标记 | 边界条件 | 快照只取初始化完成或 P7 后、退出处理之前；失败中途与最终收尾后不允许取快照 |
| 命中计算草稿、触发处理中间数组等调用栈局部量 | 不保存 | 合法边界不在这些调用栈内 |

`Execution.checkpoint` 保存 `ExecutionMemory`。payload 为 `{ data, schema }`，数据经 `toWire`，恢复经 `fromWire`。schema 只标记需要还原的 Infinity、Map、Set 与异构数组位置；不将普通文本 `inf` 当成数值，不带函数或定义对象。快照采用当前运行的身份，不能跨不同 `runId` 或诊断配置恢复。

`resumeFrom` 直接把状态与 memory 传给 `execute`；跳过初始化，不调用 `onResolve`，不重放已处理日志。若停在 `S[maxFrames]`，先补做原 P7 边界后的帧数上限检查，再决定是否进入 P1，不能额外多走一帧。回到更早边界被拒绝。

## 2. 缓存

`MemorySnapshotCache` 由调用方持有，没有模块级可变单例。键为 `runId` 加诊断配置摘要；按需保存目标附近的 600 帧边界，读写均复制。已有缓存而跨到下一间隔时，`snapshotFrom` 从旧快照推进，不重新初始化。`stateAt(p, f, { cache, diag })` 使用缓存；不传 cache 仍按 DD-07 重放。

同一进程各查 100 个后段边界，缓存一组包含首次冷启动；结果经 canonical JSON 全部一致。数字只是本机记录，不作为测试阈值：

| 场景 | 查询范围 | 无缓存 | 有缓存（含冷启动） | 加速 |
|---|---:|---:|---:|---:|
| `m0-video-eq.yaml` | S[9000]～S[9297]，步长 3 | 12,767.5 ms | 3,112.8 ms | 4.10× |
| `xin-tower4-video.yaml` | S[12600]～S[12897]，步长 3 | 24,557.0 ms | 5,824.8 ms | 4.22× |

脚本与原始结果（不进 git）：`out/dd10-benchmark.ts`、`out/dd10-benchmark.jsonl`。

## 3. 拆环与分析入口

- 编译移动到 `compile.ts`；`ScheduleError` 下沉到 `types.ts`，等待常量到 `wait-codes.ts`，事件读值到 `event-util.ts`。
- `run.ts` 注入 `checkTick` / `checkHit`；执行模块不引用汇总或不变量。汇总由运行入口完成。
- `num.ts` 集中 `round` / `floor`。四条分层规则检查真实源码和合成反例，包含类型 import、动态 import 和转发，无迁移豁免。
- 分析层共 17 个文件移到 `src/analysis/`，只从显式导出的 `src/engine/index.ts` 引入引擎。
- `simulate` / `prepareResolved` 函数已删除。`simulate.ts` 文件只保留内部执行体；正式调用从真实 `Scenario` 与 `GameData` 经过 `prepareRun`。
- `RunOverrides.panelDeltas` 支持按队内角色给 `energyRegen/hpFlat/atkFlat/defFlat` 有限增量，装配后应用、计算身份之前完成。与原能量二分和模糊单调检查一致，只动 panel，不重新推导静态 stats 或 scale；未知角色、字段与非有限数拒绝。resolvedDigest / runId 包含扰动结果，不逆造源场景。
- 低层手工装配测试使用 `tests/helpers/prepared-fixture.ts`，身份明确为 `test-fixture`，不是生产兼容入口。真实轴测试使用正式准备入口。

## 4. 验收

- `tests/snapshot.test.ts` 覆盖 C10-1～6、9～11：合成轴、M0 与中 4 真实轴在首尾及中间边界恢复；全部诊断；抽样 RNG；JSON 往返；配置拒绝；非空簿记拒绝；S[0] 初始化生成判定；动作实例别名；缓存跨间隔不重新初始化。七种停止路径与四组相位样例也加入恢复对拍（初始化失败没有合法 S[0]）。
- `tests/conformance.test.ts` 覆盖 C10-7/8，另查清单为空、版本、缺文件、摘要错误，以及不同 JSON 缩进但摘要正确的外部产物。
- `pnpm conformance --out out/dd10-after` 与 `pnpm conformance --verify out/dd10-before`：30 个真实场景 + 11 个边界样例，41 个全部一致；41 个零干扰检查通过。OUTPUT_SCHEMA_VERSION 与 WIRE_SCHEMA_VERSION 未改变。
- 分析迁移前后运行 `insight scenarios/m0-video-eq.yaml`、`scorecard scenarios/m0-video-eq.yaml`、`matrix scenarios/m0-video-eq.yaml scenarios/xin-team.yaml`、全场景 `sensitivity`（25 × 15）。差异只有工作目录和实际耗时，业务输出完全相同。原始输出在 `/tmp/dd10-analysis/*.before` / `*.after`。
- `pnpm fuzz` 默认配置跑完 30 个场景，0 问题、0 引擎错误：日志自洽、可重复、属性加了伤害不降。
- 类型与 Svelte 检查通过；完整 Vitest、Python 测试和网页构建通过。最终测试数量以任务结束报告为准（补充用例会增加数量）。

### 恢复清单收尾复验

按 `TODO_RESUME.md` D1～D3、Q1～Q2 完成补强：
- 正式文档清除“还没实现”的现状描述，模糊测试签名与路径并回当前实现；TD-04 与总设计明确恢复先补边界上限检查。
- 分层检查要求每个引擎文件唯一显式归层，未知文件和嵌套同名文件都拒绝；没有迁移豁免。
- C10-10 新增阈值反例：初始化 resource（深度 0）→ spawned hit（1）→ heal（2），上限 1。S[0] 经 JSON 往返恢复后，与从头执行的 chainDepth 错误、完整结果及终态一致（诊断关闭 / 全开均测）；故意清掉 spawned 后错误消失，证明用例能识别链元数据丢失。
- 本轮 `git diff --check`、`pnpm check && pnpm test && pnpm test:py` 通过：TS / Svelte 0 错误、0 警告；Vitest 71 文件、893 项通过、37 项 TODO；Python 71 项通过。
- 重新执行 `pnpm conformance --verify out/dd10-before`：原有改前基线 41 样例一致、41 样例零干扰通过；另执行 `pnpm conformance --out out/dd10-after` 刷新产物（verify 模式不会写出产物）。
- `pnpm web:build` 通过；`pnpm query scenarios/m0-video-eq.yaml state --frame 600 --out out/dd10-query.json` 重新导出状态信封。
- 本轮日志为 `/tmp/dd10-close-{check,test,py,conformance,export,web,query}.log`。缓存基准、四个分析命令对照与 fuzz 沿用上轮记录，本轮没有重新量测，不能混称为本轮验收。

上述实现与恢复收尾验收时未创建提交，也未手改 generated 数据；随后已按用户要求提交并创建 PR #136。

### PR rebase 到含 DD-08 的 main

- 基线 `origin/main = 71cb602`。保留 DD-08 的观测比较、校准薄包装和证据闭环，把新增的 `evidence.ts` 一并迁到分析层（现共 18 个文件），补齐公开入口及 CLI / 报告 / 测试引用。分层检查不加豁免，未恢复生产兼容入口。
- 复验：check 0 错误 / 0 警告；Vitest 73 文件、941 通过、41 TODO；Python 71 通过；`pnpm conformance --out out/dd10-rebased` 导出 41 样例，零干扰全部通过；网页构建通过。日志为 `/tmp/dd10-rebase-{check,test,py,conformance,web}.log`。
- 本轮未以旧 `out/dd10-before` 再作身份对拍：DD-08 已新增 `concertoTimingBy`，规则与运行身份相对原基线发生预期变化。前面的改前对拍记录仍只对应 rebase 之前的验收，不冒充本轮结果；未修改已登记的证据预测与读数。
