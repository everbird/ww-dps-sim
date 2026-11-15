# DD-01 运行输入、运行身份、完成状态与分层检查

**版本**：v0.3，2026-11-14，Claude。v0.2 按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10：DF-01、DF-02、DF-10 与两条非阻塞意见）；v0.3 按 Codex 第二轮复核加 `loops.roundEnds`（意见文件 §13：DF-25）。
**状态**：Final（2026-11-15）。本文 v0.3 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。还没实现。
**阶段**：一。**前置**：无。**被依赖**：DD-02～DD-07 全部。

## 1. 范围与依据

做：
- **一份归一后的运行输入** `PreparedRun` 与唯一的归一入口 `prepareRun`（架构 §2.1）。
- **运行身份** `RunIdentity` 与 `runId`（架构 §9）。
- **新的运行入口** `runPrepared`，以及它产出的完成状态 `RunCompletion`、`RunCoverage`（架构 §2.2–§2.4）。
- **旧入口 `simulate` 保留为兼容外壳**，现有调用方不用一次改完。
- **分层检查** `tests/layering.test.ts`（架构 §1.2）。

不做：
- 严格入口的编译期检查与意图失败（DD-02）。本文只留好 `strict`、`continueAfterIntentUnmet` 的位置与 `intentUnmet` 的归类。
- 截断状态传到汇总、对比、搜索（DD-03 §7）。本文只产出数据。
- 诊断记录（DD-05、DD-06）。本文只留 `diag` 的入口参数。
- 外部干预记录的内容（DD-09）。本文只让 `interventions` 字段存在，现有三种录像指令各记一条。

## 2. 现状（基线 `6eedc0b`）

| 事实 | 位置 |
|---|---|
| 运行入口是 `simulate(r: ResolvedScenario, opts: SimOptions)`，返回 `{ log, summary, forte, cooldowns, error? }` | `simulate.ts` 的 `simulate` |
| `try` 块里依次是：挂常驻 buff → 三人 `onResolve` → `drain` → `runLoop` → `drain` | 同上 |
| `catch` 只接 `ScheduleError`，别的异常原样抛出 | 同上 |
| `ScheduleError` 的 9 个错误码：`comboBroken`、`timeout`、`maxFrames`、`notOnField`、`switchSelf`、`chainDepth`、`invariant`、`entrySkill`、`airEntry` | `scheduler.ts` 的 `ScheduleErrorCode` |
| 调度器里的报错都经 `fail()`，它先调 `closeSeg()` 关掉正在累计的等待段（写一条 `wait`，等待代码是 `settled` 时再记一次假设） | `scheduler.ts` 的 `fail`、`closeSeg` |
| `chainDepth` 在 `drain` 里直接 `new ScheduleError`，不经 `fail` | `triggers.ts` 的 `drain` |
| `drain` 先 `bus.cursor++` 再调 `handle` | 同上 |
| 帧数上限：队列里还有指令时 `throw fail('maxFrames')`；指令已空时记一条 `warning`（`code: 'maxFrames'`）后正常返回 | `scheduler.ts` 的 `runLoop` |
| `tick` 返回 false 的位置在 P2 的 `schedule` 之后；此前 `computeRates`、`endDueActions` 已执行 | `kernel.ts` 的 `tick` |
| 世界帧只在 P7 加 1 | 同上 |
| 装配入口 `resolveScenario(sc, data)`；规则覆盖写在场景的 `options.rules`，装配时逐项校验 | `resolve.ts`、`scenario.schema.ts` |
| 分析层翻开关用 `adjusted(r, path, v)`，直接改装配结果里的 `rules` 或 `options`，路径只拆两段 | `insight.ts` 的 `adjusted` |
| `portable(r)` 去掉钩子表，剩下的能 JSON 往返；m0 场景这份 JSON 是 MB 量级（含整份 `GameData`） | `portable.ts`、`src/cli/conformance.ts` 的输出 |
| `src/engine/` 里直接调 `simulate` 的分析层文件：`analysis`、`sensitivity`、`fit`、`search`、`plan`、`cards`、`insight`、`optimize`、`matrix`、`sample`、`fuzz`、`scorecard` | `grep "simulate("` |

## 3. 设计

### 3.1 文件

| 文件 | 内容 |
|---|---|
| `src/engine/run-types.ts`（新） | 本文全部新类型：`RunOverrides`、`RunEnvironment`、`PreparedRun`、`PrepareResult`、`RunIdentity`、`RunStatus`、`AxisFailureKind`、`UnmetIntentDetail`、`StatePrefix`、`RunCoverage`、`RunCompletion`、`InterventionRecord`、`RunOptions`。只有类型，不 import 运行代码 |
| `src/engine/digest.ts`（新） | `canonicalJson(x)`、`sha256Hex(text)`、`digestOf(x)` 与分块缓存 |
| `src/engine/run.ts`（新） | `prepareRun`、`prepareResolved`、`runPrepared`、`buildCompletion` |
| `src/engine/simulate.ts`（改） | 运行体挪进 `run.ts` 调用的内部函数 `execute`；`simulate` 变成兼容外壳 |
| `src/engine/scheduler.ts`（改） | `runLoop` 返回退出原因；`ScheduleError` 加 `viaFail` |
| `src/engine/kernel.ts`（改） | `Kernel` 加 `at`，`tick` 在每个相位开头写它 |
| `src/engine/triggers.ts`、`context.ts`（改） | `EventBus` 加 `inFlight` |
| `src/engine/types.ts`（改） | `SimResult` 加必有字段 |
| `src/cli/run-env.ts`（新） | 采集 `RunEnvironment`：提交号、内容指纹、xlsx 哈希 |

### 3.2 归一入口

```ts
/** 命令行与调用方能覆盖的东西。没给的项不覆盖 */
export interface RunOverrides {
  readonly strict?: boolean                              // --strict / --no-strict
  readonly continueAfterIntentUnmet?: boolean            // 缺省 false
  readonly options?: Partial<Pick<Scenario['options'], 'repeat' | 'maxFrames' | 'maxWait' | 'endAt' | 'tuneBreak' | 'inputDelay'>>
  /** 规则覆盖：键是 Rules 下的路径（'defFloor'、'forteKeepOnSwitchBy.心'），不带 'rules.' 前缀 */
  readonly rules?: Readonly<Record<string, number | boolean | string>>
  readonly inputDelayAt?: Readonly<Record<string, Frame>>   // 卡帧点分析用，场景里写不出来
  readonly goal?: Scenario['goal']
  readonly enemy?: Scenario['enemy']
  readonly sample?: SimOptions['sample']
  readonly environment?: RunEnvironment
}

/** 由命令行采集、纯库拿不到的身份信息。测试里不给，各项记 'unknown' */
export interface RunEnvironment {
  readonly gitCommit: string
  readonly contentFingerprint?: string
  readonly xlsxSha256?: string
  readonly resourceVersion?: string
}

export type PrepareResult =
  | { readonly ok: true; readonly run: PreparedRun; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly issues: readonly PrepareIssue[] }

export interface PrepareIssue {
  readonly stage: 'schema' | 'strict' | 'resolve' | 'compile'
  readonly line?: number; readonly item?: number; readonly opening?: true
  readonly code: string                                  // 'strict.filler'、'strict.tuneBreakOff'…（DD-02 §3.2）；其余阶段用 'schema'、'resolve'、'compile'
  readonly message: string
}

export function prepareRun(scenario: Scenario, data: GameData, overrides?: RunOverrides): PrepareResult
```

`prepareRun` 按固定顺序做五步，前一步有问题就停：

1. **合并**。把 `overrides` 并进场景，得到"有效场景"：
   - `options` 逐项覆盖；
   - `rules` 并进 `options.rules`。带点的路径（`forteKeepOnSwitchBy.心`）展开成嵌套对象再合并，不整体替换父对象（DD-04 §4.2 实现多段设值）；
   - `strict` 写进 `options.strict`（字段由 DD-02 加）；
   - 优先级：`overrides` 给了的 > 场景写了的 > schema 缺省。
2. **校验**。有效场景过一遍 `ScenarioSchema`，保证覆盖项也合法。
3. **严格入口检查**。有效场景 `options.strict === true` 时调 `checkStrictSource`（DD-02 §3.2 的源码级检查）。DD-02 做完之前这一步是空的。
4. **装配**。调 `resolveScenario(effectiveScenario, data)`。它抛的装配错误转成 `stage: 'resolve' | 'compile'` 的问题列表。装配后再调 `checkStrictResolved`（DD-02 §3.2 里要看动作种类的检查）。
5. **算身份**。按 §3.3 生成 `RunIdentity` 与 `runId`，冻结并返回。

约束：
- **`prepareRun` 是纯函数**：同样的输入得到同样的 `runId`。它不读盘、不读时钟。
- **`PreparedRun` 冻结**：`Object.freeze` 顶层与 `effective`、`identity`。`resolved` 不深冻结（太大），靠类型 `readonly` 与"引擎不写 `r`"的既有约定。
- **`inputDelayAt`** 在装配后写进 `resolved.options.inputDelayAt`，并进身份的 `options`。

给还拿着 `ResolvedScenario` 的旧调用方一个过渡入口：

```ts
/** 过渡用：已经装配好的结果直接包成 PreparedRun。场景内容没法知道，scenarioDigest 记 'unknown' */
export function prepareResolved(r: ResolvedScenario, opts?: { sample?: SimOptions['sample']; environment?: RunEnvironment }): PreparedRun
```

`prepareResolved` 产出的运行：`entryMode` 按 `r.purpose` 与 `r.options.strict` 推，`strictSource: 'default'`。为此 `ResolvedScenario` 加 `purpose: 'rotation' | 'replay'`，装配时从场景抄过来（缺省 `rotation`）；不能因为拿不到场景就把录像运行标成 `standard`（DF-02）。它的 `runId` 仍由整份身份算出，所以两次不同的装配结果不会撞。DD-10 把最后一个调用方迁走后删掉它。

### 3.3 运行身份与摘要

类型照架构 §9 的 `RunIdentity`，不重抄。各字段的取法：

| 字段 | 取法 |
|---|---|
| `data.xlsxFileDate` | `data.version` |
| `data.xlsxSha256`、`data.resourceVersion` | `overrides.environment`；没有就省略 |
| `execution.gitCommit` | `overrides.environment.gitCommit`；没有记 `'unknown'` |
| `execution.contentFingerprint` | 同上；工作区干净时省略 |
| `execution.scenarioDigest` | `digestOf(有效场景)`，在第 2 步之后、装配之前算。`video`、`search`、`notation` 三个键先去掉：它们不影响执行。`tuneBreakOmitted` 与 `replay` 保留：前者改变结果的口径，后者改变有效的轴（DF-02） |
| `execution.resolvedDigest` | 按下面的分块规则 |
| `execution.entryMode` | `purpose === 'replay'` → `'replay'`；否则 `options.strict` → `'strict'`；否则 `'standard'` |
| `execution.strictSource` | `overrides.strict !== undefined` → `'cli-override'`；场景写了 → `'scenario'`；否则 `'default'` |
| `execution.inputTiming` | `options.inputDelay > 0`、有 `inputDelayAt`、`sample.jitter > 0`、有 `sample.hand`，任一成立就是 `'delayed'` |
| `execution.rules`、`options` | 装配后的 `resolved.rules`、`resolved.options` |
| `execution.sample` | `overrides.sample ?? null` |
| `execution.continueAfterIntentUnmet` | `overrides.continueAfterIntentUnmet ?? false` |
| `execution.outputSchemaVersion` | 常量 `OUTPUT_SCHEMA_VERSION`，放在 `run-types.ts`，从 `'1'` 起；`SimResult` 或事件的业务字段每变一次加 1 |

**`runId`** = `'run-' + sha256Hex(canonicalJson(identity)).slice(0, 16)`。

**`canonicalJson`**：对象的键按码点排序；数组保持顺序；`undefined` 的键去掉；`Infinity` / `-Infinity` 写成 `'inf'` / `'-inf'`；`Map` 写成按键排序的条目数组，`Set` 写成排序数组；遇到函数抛错。这和架构 §2.7 的对外 JSON 规则是同一套，DD-07 的 `wire.ts` 复用它。

**`sha256Hex`**：纯 TypeScript 实现，同步，放在 `digest.ts`。不用 `node:crypto`（引擎要在浏览器 Worker 里跑），不用 `crypto.subtle`（它是异步的，会把 `prepareRun` 变成异步）。用例拿三个标准测试向量核对（空串、`'abc'`、长串）。

**`resolvedDigest` 分块算、按对象缓存**。整份装配结果有 MB 量级，敏感度矩阵一次要跑几百个只差一个开关的变体，每个都整份序列化再哈希太贵。做法：

```ts
const cache = new WeakMap<object, string>()
const cached = (x: object, strip?: (x: any) => unknown): string => { /* 命中直接返回；否则 digestOf(strip ? strip(x) : x) 后存入 */ }

resolvedDigest = digestOf({
  data: cached(r.data, d => ({ ...d, hooks: {} })),     // 整份 GameData 去掉钩子表；同一个 data 对象只算一次
  team: r.team.map(m => cached(m)),
  enemy: cached(r.enemy),
  buffs: cached(r.buffs), effects: cached(r.effects),
  commands: digestOf(r.commands), opening: digestOf(r.opening),
  initial: r.initial, tuneBreakTiming: r.tuneBreakTiming, goal: r.goal,
})
```

- `rules` 与 `options` 不进 `resolvedDigest`，它们在身份里单列。
- 缓存按对象引用。前提是这些对象创建后不再被改写，这是引擎的既有约定；`tests/prepared-run.test.ts` 加一条：运行前后 `resolvedDigest` 重算（清缓存后）相同。
- **性能预算**：在 `m0-video-eq.yaml` 上，第二次及以后的 `prepareRun`（缓存已热）比单独的 `resolveScenario` 多出的时间不超过一次 `simulate` 的 5%。T01-3 实测并把数字写进提交说明；超了就把 `data` 的摘要改成由命令行在载入数据时算好、经 `RunEnvironment` 传入。

**不进身份的**：诊断开关与过滤条件、`onHit` 回调、是否跑 `checkLog`。它们是观察选项，前提是零干扰（DD-05 §6）。

### 3.4 新的运行入口与结果

```ts
export interface RunOptions {
  readonly diag?: DiagOptions            // DD-05；不给 = 诊断全关
  readonly onHit?: SimOptions['onHit']   // 择优的快速重算在用，原样透传
}

export function runPrepared(p: PreparedRun, opts?: RunOptions): SimResult
```

`SimResult` 加字段（都是必有的，除了 `diag`）：

```ts
export interface SimResult {
  log: SimEvent[]; summary: Summary; forte: ForteStep[]; cooldowns: CooldownStep[]
  /** @deprecated 由 completion 派生，给还没迁移的调用方；规则见 §3.7 */
  error?: { code: string; message: string; frame: number; line?: number; loop?: number }
  runId: string
  identity: RunIdentity
  completion: RunCompletion
  interventions: InterventionRecord[]       // 本文只保证字段存在；内容见 §3.8
  strictReport: StrictReport                // DD-02 §3.4；所有入口都有。DD-02 做完之前只有 entry 与空数组
  damageScope: DamageScope                  // DD-02 §3.7：谐度破坏含不含在 DPS 里；DD-02 做完之前按 options.tuneBreak 推
  ruleUsage: RuleUsageReport                // DD-05；做完之前是 { byProposition: [], coverage: [] }
  diag?: Diagnostics                        // DD-05、DD-06
}
```

`RunCompletion` 照架构 §2.4，加一个字段（总览 §6 的 S-01）：

```ts
readonly engineError?: { readonly code: 'chainDepth' | 'invariant' | 'uncaught'; readonly message: string }
```

**`engineError` 不再往外抛**。基线上钩子里的 `throw new Error` 会从 `simulate` 直接冒出去；新入口接住，状态记 `engineError`，日志与汇总保留到出错为止。调用方要靠 `completion.status` 判断，不能再靠"没抛异常"。

**观察回调**（S-04 的条件）：`onHit` 与 DD-05 §6.1 的边界观察回调只读收到的对象，不得修改，也不得留到回调之后再改。零干扰测试（DD-05 §6.2）包括"给一个什么都不做的 `onHit`"与"不给"两侧相等。回调自己抛的异常不算这次运行的状态，原样从 `runPrepared` 抛给调用方：那是调用方的错，不是引擎或轴的结论。

### 3.5 记下停止点要补的三处簿记

这三处都是运行环境里的簿记，不是业务状态，不进 `SimState`，不影响执行。

**① 当前相位**。`Kernel` 加一个可变字段，`tick` 在每个相位开头写：

```ts
export interface Kernel { rules: Rules; hooks: KernelHooks; at: { phase: 'init' | 'P1' | 'P2' | 'P3' | 'P4' | 'P6' | 'afterP7' } }

export function tick(s, k, schedule) {
  k.at.phase = 'P1'; const rates = computeRates(s, k.rules)
  k.at.phase = 'P2'; /* startedThisTick、endDueActions、schedule、空闲判断 */
  k.at.phase = 'P3'; advanceActions(...)
  k.at.phase = 'P4'; settleJudgments(...)
  k.at.phase = 'P6'; /* 冷却、hooks.timers */
  s.battleFrames += rates.battle; s.frame += 1
  k.at.phase = 'afterP7'
  return true
}
```

`runPrepared` 创建 `Kernel` 时初值是 `'init'`。测试台 `tests/helpers/kernel-harness.ts` 自己建 `Kernel` 的地方补上 `at`。

**② 正在处理的事件**。`EventBus` 加 `inFlight: number | null`：

```ts
const i = bus.cursor++
bus.inFlight = i                 // 在连锁深度检查之前写，chainDepth 也算"处理这条时出错"
... 深度检查 ... handle(sim, s, s.log[i]!) ...
bus.inFlight = null              // 只在正常处理完后清；抛错时保留
```

`finally` 里不清 `inFlight`。于是：

```ts
handledEndExclusive = bus.inFlight ?? bus.cursor
```

**③ 循环怎么退出的**。`runLoop` 改成返回退出原因；抛错的行为不变：

```ts
export function runLoop(s, k, schedule, maxFrames): 'idle' | 'maxFramesInFlight'
```

- `tick` 返回 false → 返回 `'idle'`；
- 到上限、指令已空 → 记警告事件后返回 `'maxFramesInFlight'`；
- 到上限、指令没发完 → 照旧 `throw fail('maxFrames', …)`。

`ScheduleError` 加只读字段 `viaFail: boolean`（构造函数第 5 个参数，缺省 false；`fail()` 传 true）。它回答"失败收尾做了没有"，比按错误码猜可靠。

### 3.6 完成状态怎么算

`runPrepared` 的骨架（`execute` 是从 `simulate` 挪出来的运行体，`s`、`sim`、`k` 是它建的）：

```ts
let initCompleted = false
let loopExit: RunCoverage['loopExitAt'] | null = null
let finalization: RunCoverage['finalization'] = { kind: 'none', completed: true }
let caught: unknown = null
try {
  /* 常驻 buff、onResolve */ drain(sim, s)
  initCompleted = true
  const why = runLoop(s, k, schedule, r.options.maxFrames)
  loopExit = { reason: why === 'idle' ? 'idle' : 'maxFrames', worldFrame: s.frame, phase: why === 'idle' ? 'P2' : 'afterP7' }
  finalization = { kind: 'postDrain', completed: false }
  drain(sim, s)
  finalization = { kind: 'postDrain', completed: true }
} catch (e) { caught = e }
return buildCompletion(...)
```

`buildCompletion` 的判定表。"相位"取 `k.at.phase`，"在处理"取 `bus.inFlight`：

| 情形（按顺序判第一个成立的） | `status` | `loopExitAt` | `finalization` | `terminal.kind` |
|---|---|---|---|---|
| 没抛错，`why === 'idle'` | `completed` | `idle`、`P2` | `postDrain` 做完 | `afterPostDrain` |
| 没抛错，`why === 'maxFramesInFlight'` | `truncated`（`inFlightRemains`） | `maxFrames`、`afterP7` | `postDrain` 做完 | `afterPostDrain` |
| 抛错，`initCompleted === false` | `engineError`；是调度错误且属于轴失败的码时按下一行的规则归 `axisFailed` | `engineError` 或 `axisFailed`、`init` | `none` | `initIncomplete` |
| 抛错，`loopExit !== null`（循环已正常退出，错出在收尾的 `drain`） | `engineError` | 保留 `loopExit` 原值 | `postDrain` 没做完，带 `inFlightEventSeq` | `postDrainFailed` |
| 抛的是 `ScheduleError`，码是 `maxFrames` | `truncated`（`commandsPending`） | `maxFrames`、`afterP7` | `failClose` 做完 | `afterFailClose` |
| 抛的是 `ScheduleError`，码在轴失败集合里 | `axisFailed` | `axisFailed`、当时的相位 | `viaFail` 为真是 `failClose` 做完，否则 `none` | `midTick` |
| 抛的是 `ScheduleError`，码是 `chainDepth` / `invariant` | `engineError` | `engineError`、当时的相位，带 `inFlightEventSeq` | `none` | `midTick` |
| 别的异常 | `engineError`（`uncaught`） | 同上 | `none` | `midTick` |

- **轴失败集合**：`comboBroken`、`timeout`、`notOnField`、`switchSelf`、`airEntry`、`entrySkill`、`intentUnmet`（最后一个由 DD-02 加）。映射到 `AxisFailureKind` 时同名；严格入口下 `airEntry`、`entrySkill` 归成 `intentUnmet` 的规则在 DD-02 §3.3。
- **其余字段**：
  - `completedTicks = s.frame`。世界帧只在 P7 加 1，所以任何时刻它都等于走完的 tick 数；
  - `loggedEventEndExclusive = s.log.length`；
  - `terminal.prefix = { eventEndExclusive: s.log.length, handledEndExclusive: bus.inFlight ?? bus.cursor, interventionEndExclusive: interventions.length }`；
  - `truncation.remains`：`pendingCommands` 分两支算（DF-01）：还在启动轴（`queue.loop === 0`）时是 `(opening.length − next) + repeat × commands.length`，否则是 `(commands.length − next) + (repeat − loop) × commands.length`；`activeActions` 数 `chars` 里 `action && !action.ended` 的；`pendingJudgments = s.judgments.length`；`pendingTails = s.tails.length`；
  - `loops`：只认日志里的轮边界，不看游标（DF-01）。架构 §2.4 的 `{ planned, completed }` 之外加两项：
    ```ts
    readonly loops: {
      readonly planned: number                  // queue.repeat
      readonly started: number                  // 日志里 loop ≥ 1 的 loop 事件个数
      readonly completed: number                // 结束边界已确认的循环轮数
      readonly openingCompleted: boolean | null // 没有启动轴时 null
      /** 结束边界已确认的各轮（含启动轴，记为第 0 轮）的真实结束战斗帧：下一轮 loop 事件的战斗帧；
       *  最后一轮自然结束时取不带 endAt 的统计窗口终点 windowEnd(log, s)。不受 endAt 影响（DF-25） */
      readonly roundEnds: readonly { readonly loop: number; readonly endBattleFrame: number }[]
    }
    ```
    第 k 轮（k ≥ 1）的结束边界已确认，当且仅当日志里有第 k + 1 轮的 `loop` 事件，或者它是最后开始的一轮、并且 `status === 'completed'`（自然结束，场上已空）。启动轴同理：有第 1 轮的 `loop` 事件，或者整次运行在启动轴里自然结束。这与汇总的分轮口径一致（第 k 轮是 `[第 k 轮的 loop 事件, 第 k + 1 轮的 loop 事件)`）。
    - 截断（两种）、轴失败、引擎错误时，最后开始的那一轮都不算完成，哪怕它的指令已经发完：末条动作可能还在场上，下一轮的游标也可能已经前移而下一轮还没开始。单看 `queue.loop` 或 `queue.next` 会把这两种情形算成完成。
    - `endAt` 不参与：它只截统计窗口，不截执行（C01-18）。统计窗口是否完整覆盖了某一轮，不能看汇总的 `perLoop`：它已经按 `endAt` 把最后一轮的终点裁成了窗口终点。DD-03 §7.1 的 `usableBasis` 拿 `roundEnds` 与统计窗口终点比（DF-25）。
  - `goal`：按架构 §2.4 的三条定义，由 `summary` 与上面的状态算；稳态那一条按 DD-03 §7.1 的两个条件判：所选的每一轮在执行上已确认（`r ≤ loops.completed`），且它的 `roundEnds` 不晚于统计窗口终点（DF-25）；
  - `conditioning`：`interventions` 为空是 `unconditioned`，否则 `conditioned` 且 `firstInterventionIndex = 0`；
  - `engineError.message` 取异常的 `message`；非 `Error` 的取 `String(e)`。
- **汇总照常算**。任何状态下都调 `summarize`，包括 `initIncomplete`（这时是空汇总）。消费者按 `completion.status` 决定用不用。
- **内部的探针信号不是运行状态**：DD-05 §6.1 与 DD-07 §3.2 用内部异常 `ProbeStop` 中途停下一次重放。它只在 `runForInspection` / `replayTo` 里出现并被接住，不经 `fail`、不做收尾，也不交给 `buildCompletion`，所以不会被归成 `engineError`。停在中途得到的是前缀，不是一次运行的完成状态（DF-10）。
- **`afterFailClose` 的 `handledEndExclusive`**：失败收尾写的那条 `wait` 没被处理，`bus.cursor` 不动，所以它自然比 `eventEndExclusive` 小 1（有等待段时）。不用特判。

### 3.7 兼容外壳与旧字段

```ts
/** @deprecated 新代码用 prepareRun + runPrepared */
export function simulate(r: ResolvedScenario, opts: SimOptions = {}): SimResult {
  return runPrepared(prepareResolved(r, { sample: opts.sample }), { onHit: opts.onHit })
}
```

旧字段 `error` 由完成状态派生，保持现有调用方的行为：

| `completion.status` | `error` |
|---|---|
| `completed`、`truncated`（`inFlightRemains`） | 没有 |
| `truncated`（`commandsPending`） | `{ code: 'maxFrames', … }`，同基线 |
| `axisFailed` | `{ code: 原调度错误码, … }`，同基线 |
| `engineError`，码是 `chainDepth` / `invariant` | `{ code, … }`，同基线 |
| `engineError`，`uncaught` | **兼容外壳重新抛出原异常**，保持基线行为；`runPrepared` 本身不抛 |

最后一行是为了不让现有的 `try { simulate(r) } catch` （`sensitivity.ts` 的 `cell`、`fit.ts` 的 `run`）悄悄换了语义。各分析层文件迁到 `runPrepared` 的时间点：`sensitivity`、`insight` 在 DD-04；`calibration`、`analysis`、`search`、`plan` 在 DD-03 §7；`fit` 在 DD-09；其余在 DD-10。

### 3.8 外部干预记录（本文只做最小的）

类型照架构 §4.1 的 `InterventionRecord`。本文只做：
- `Sim` 加 `interventions: InterventionRecord[]`，`runPrepared` 把它放进结果；
- 现有三种录像指令各记一条，`firedTriggers: true`、`skippedTriggers: []`：
  - `fillCommand`（`能量满`）：`kind: 'fill'`，带 `target`、`before`、`adopted`、`delta`；
  - `enemyCommand`：`kind: 'enemyDisharmony'` 或 `'enemySwap'`；
- `afterEventSeq = s.log.length − 1`（执行这条指令时日志里最后一条的下标），`orderInAnchor` 在同一个 `afterEventSeq` 下从 0 递增；`phase: 'P2'`。

记录写在业务动作**之前**，所以它排在自己引出的 `resource` / `enemyState` 事件之前。`sync` 留给 DD-09。

### 3.9 分层检查

`tests/layering.test.ts`，读源码文本做静态检查，不执行被测模块：

- 常量 `ANALYSIS`：架构附录 B 的 14 个文件名，加上本目录新增的分析层文件 `candidates`、`observations`。
- 用正则取每个 `src/engine/*.ts` 的 `import … from '…'` 与 `export … from '…'` 的路径。
- **规则 1**：不在 `ANALYSIS` 里的文件，import 路径不能解析到 `ANALYSIS` 里的文件，也不能以 `../cli/`、`../report/`、`../../web/` 开头。
- **规则 2**：`src/engine/` 下所有文件的 import 路径不能是 `fs`、`path`、`child_process`、`crypto` 及它们的 `node:` 写法，也不能解析到 `src/data/load.ts`。
- 另加一条防呆：`src/engine/` 下出现了既不在 `ANALYSIS`、也不在测试里"核心文件"清单中的新文件，测试失败并提示把它归到某一层。

基线上规则 1 有没有现存的违反，T01-1 先跑出来。有的话列进提交说明，在本工作包里改掉（预期没有：架构 §1.1 核对过）。

## 4. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T01-1 | 分层检查 | `tests/layering.test.ts` | 测试通过；故意在 `kernel.ts` 里 import `./fit` 时失败 |
| T01-2 | 类型文件 | `run-types.ts`；`types.ts` 的 `SimResult` 加字段（先都标可选，T01-6 再改成必有） | `pnpm check` 通过 |
| T01-3 | 摘要 | `digest.ts`；`tests/prepared-run.test.ts` 的摘要部分 | C01-1～C01-3 通过；性能数字写进提交说明 |
| T01-4 | 停止点簿记 | `kernel.ts` 的 `Kernel.at` 与 `tick`；`context.ts`、`triggers.ts` 的 `inFlight`；`scheduler.ts` 的 `runLoop` 返回值与 `viaFail`；测试台补 `at` | 现有测试全过；`pnpm conformance` 的输出与改之前逐字节相同 |
| T01-5 | 运行体挪出、`runPrepared` 与完成状态 | `simulate.ts`、`run.ts` | C01-8～C01-16 通过；`pnpm conformance` 输出不变（这一步 conformance 还没写新字段） |
| T01-6 | `prepareRun`、`prepareResolved`、兼容外壳 | `run.ts`、`simulate.ts`；`SimResult` 的新字段改成必有 | C01-4～C01-7 通过；现有测试全过 |
| T01-7 | 干预记录的最小实现 | `context.ts`、`simulate.ts` | C01-17 通过 |
| T01-8 | 命令行采集身份 | `src/cli/run-env.ts`；`src/cli/sim.ts` 改用 `prepareRun` + `runPrepared`，汇总末尾打印 `runId` 与完成状态 | `pnpm sim scenarios/m0-team.yaml` 打印的数与改之前相同，多两行 |
| T01-9 | conformance 写新字段 | `src/cli/conformance.ts`：输出里加 `runId`、`completion`、`interventions`、`strictReport`、`damageScope`、`ruleUsage`，以及去掉 `gitCommit` 与 `contentFingerprint` 的 `identity`（这两项随环境变） | 只多这几个键，原有的 `log`、`summary`、`error` 逐字节相同 |

`run-env.ts` 的取法：
- `gitCommit`：`git rev-parse HEAD`；不在仓库里记 `'unknown'`。
- `contentFingerprint`：`git status --porcelain -- src/engine src/data data/curated scenarios inventory data/xlsx-versions.json` 有输出时才算。把这些路径下已跟踪且有改动的、已暂存的、未跟踪的文件，按路径排序，逐个取"路径 + 内容的 sha256"，再对整张表取 sha256。`data/generated/` 不进 git，用它的文件清单（路径、大小、修改时间不算）加各文件 sha256 的方式太慢，改为取 `data/generated/meta.json`（或构建报告，以实际文件为准，T01-8 时定）的 sha256。
- `xlsxSha256`、`resourceVersion`：读 `data/xlsx-versions.json` 的 `current` 项。

## 5. 用例

`tests/prepared-run.test.ts`：

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C01-1 | `sha256Hex` 对空串、`'abc'`、一百万个 `'a'` | 等于标准测试向量 |
| C01-2 | `canonicalJson` 对键顺序不同的两个对象、含 `Infinity` 的对象、含 `Map` / `Set` 的对象、含函数的对象 | 前两个相等；`'inf'`；排序数组；抛错 |
| C01-3 | 同一个 `ResolvedScenario` 清缓存前后算 `resolvedDigest`；运行一次后再算 | 三次相同 |
| C01-4 | 合成数据的同一场景 `prepareRun` 两次 | `runId` 相同 |
| C01-5 | 只改 `overrides.continueAfterIntentUnmet`；只改一个角色的一条副词条（最终装配内容变）；只改 `overrides.rules.defFloor`；只改 `RunOptions.diag` | 前三种 `runId` 各不相同且都不同于基准；最后一种 `runId` 相同（架构 §13.2 的 AF-28 条） |
| C01-6 | `overrides.options.inputDelay = 6`；`overrides.sample = { seed: 1, jitter: 3 }`；`overrides.sample = { seed: 1 }` | 前两个 `inputTiming === 'delayed'`；第三个 `'earliest'`，`sample.seed` 在身份里 |
| C01-7 | 场景写 `options.rules: { defFloor: true }`，`overrides.rules = { defFloor: false }` | 身份里 `rules.defFloor === false`；`strictSource` 等来源字段符合 §3.3 |

`tests/run-coverage.test.ts`，用 `tests/helpers/synth.ts` 的合成角色。每条都断言 `status`、`loopExitAt`、`finalization`、`terminal.kind`、`completedTicks` 与两个上界：

| 编号 | 前提与操作 | 断言的要点 |
|---|---|---|
| C01-8 | 一个 10 帧、第 5 帧有一个判定的动作，一条指令 | `completed`；`idle`、`P2`；`afterPostDrain`；`handled === event === log.length` |
| C01-9 | 一个 1 帧的动作，钩子在 `actionEnd` 时给自己加 1 点核心资源 | 日志里有 `actionEnd` 与随后的 `resource`；两条的 `f` 都等于 `completedTicks`；它们在 `[0, loggedEventEndExclusive)` 里（这两条产生于不计入的那个 tick，属于终态，不属于任何 `S[f]`） |
| C01-10 | 动作带一个 500 帧寿命的持续判定，`maxFrames: 100`，指令只有这一条 | `truncated`、`inFlightRemains`；`remains.pendingJudgments ≥ 1`；`maxFrames`、`afterP7`；`afterPostDrain`；日志最后有 `maxFrames` 警告 |
| C01-11 | 两条指令，第二条的冷却 500 帧，`maxFrames: 100`、`maxWait: 1000`（到上限时第二条正在等冷却，等待段没关） | `truncated`、`commandsPending`；`failClose` 做完；`afterFailClose`；日志最后一条是 `wait`；`handled === event − 1`；`remains.pendingCommands === 1` |
| C01-12 | 同 C01-11，但第二条写 `wait 500`（`INTENDED` 的等待也有等待段）；另一个变体：到上限那一帧第一条刚执行完、第二条还没开始求值过 | 第一种同 C01-11；第二种没有等待段：`afterFailClose`，`handled === event` |
| C01-13 | 让收尾的 `drain` 出错：最后一个动作结束于不计入的 tick，钩子在收到它的 `actionEnd` 时 `throw new Error('boom')` | `engineError`、`uncaught`；`loopExitAt.reason === 'idle'`（不改写）；`finalization` 是 `postDrain`、没做完、`inFlightEventSeq` 指向那条 `actionEnd`；`postDrainFailed`；`handled === inFlightEventSeq` |
| C01-14 | 第二条指令是连段后续，但前置动作不对（`comboBroken`） | `axisFailed`、`comboBroken`；`P2`；`failClose`；`midTick`；`completedTicks` 等于出错那一帧的世界帧 |
| C01-15 | 钩子在 `onEvent` 里对每条 `resource` 事件再加资源，造出超过 `maxChainDepth` 的连锁 | `engineError`、`chainDepth`；`finalization.kind === 'none'`；`midTick`；`inFlightEventSeq` 有值 |
| C01-16 | 钩子在 `onResolve` 里抛错 | `engineError`；`initCompleted === false`；`initIncomplete`；`completedTicks === 0` |
| C01-17 | 轴里有 `能量满 <角色>` 与 `敌人 失谐` | `interventions.length === 2`；各自的 `afterEventSeq` 小于它引出的事件的下标；`conditioning.basis === 'conditioned'` |
| C01-18 | 同一场景分别设 `endAt` 与不设 | 两次的日志、`completion.coverage` 相同；只有汇总的窗口不同 |
| C01-19 | 兼容外壳：对 C01-8、C01-11、C01-14 用 `simulate(r)` | `error` 字段与基线的行为一致（没有 / `maxFrames` / `comboBroken`） |
| C01-20 | 兼容外壳：C01-13 的场景用 `simulate(r)` | 抛出 `Error('boom')` |
| C01-21 | DF-01：启动轴 3 条、循环轴 2 条、`repeat: 2`，启动轴第 2 条轴失败 | `loops.started === 0`、`completed === 0`、`openingCompleted === false`；若改成在那里截断，`remains.pendingCommands === 2 + 2 × 2 = 6`（不是负数，也不是按循环轴算的数） |
| C01-22 | DF-01：`repeat: 2`，第 2 轮末条动作带 500 帧持续判定，它开始后不久到 `maxFrames` | `truncated`、`inFlightRemains`；`started === 2`、`completed === 1`：指令发完了，第 2 轮仍不算完成 |
| C01-23 | DF-01：第 1 轮末条执行后，第 2 轮首条一直在等冷却，到 `maxFrames` | `queue.loop` 已经是 2，但日志里没有第 2 轮的 `loop` 事件：`started === 1`、`completed === 0` |
| C01-24 | DF-01、DF-25：同一个能自然结束的场景，只改 `endAt` | `loops` 的各字段（含 `roundEnds`）都相同：`endAt` 不影响执行轮数与真实的轮边界 |

## 6. 验收清单

- [ ] `tests/layering.test.ts`、`tests/prepared-run.test.ts`、`tests/run-coverage.test.ts` 全过。
- [ ] 架构 §2.3 的七条停止路径各有至少一个用例（C01-8、10、11、13、14、15、16），断言了表里的每一列。
- [ ] 现有测试不改断言就全过；`tests/__snapshots__` 没有变化。
- [ ] `pnpm conformance` 的输出与基线相比只多 T01-9 列出的那几个键，原有字段逐字节相同。各键在后续工作包里才有内容的，此时是空值或初值。
- [ ] `pnpm fuzz` 通过。
- [ ] `pnpm sim` 的终端输出多出 `runId` 与完成状态两行，其余数字不变。
- [ ] `prepareRun` 的性能数字在预算内，写进了提交说明。
- [ ] `src/engine/` 没有新的模块级可变状态（`digest.ts` 的 `WeakMap` 缓存是纯函数的记忆化，允许，写注释说明）。

## 7. 要同步的正式文档

- TD-02：`SimResult` 的新字段、`RunCompletion` 等类型、`ScheduleErrorCode`。
- TD-04 §1：`tick` 的相位标记、"不计入的 tick"与终态。
- TD-09 §3.8：`runLoop` 的返回值与两条帧数上限路径。
- 总设计 §10.1：`runPrepared` 是换实现时要对拍的入口；`completion` 进 conformance。

## 8. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD01-Q1 | 摘要算法 | A：纯 TS 的 SHA-256；B：更快的非密码学哈希（如 128 位 FNV / xxHash 的纯 TS 版） | A。身份要给人看、要能和命令行工具算出的值互相核对；性能靠分块缓存解决 |
| DD01-Q2 | `runId` 取多长 | 16 个十六进制字符（64 位）；32 个 | 16。个人项目的运行数量级下不会撞；完整的身份对象随结果一起存，撞了也能发现 |
| DD01-Q3 | `uncaught` 的引擎错误，兼容外壳要不要重新抛 | A：抛，保持旧行为；B：不抛，旧调用方看到 `error.code === 'uncaught'` | A。B 会让 `fuzz` 等把钩子崩溃当成普通的"跑不通"吞掉 |
| DD01-Q4 | `scenarioDigest` 去掉 `video`、`search`、`notation` | 去掉；不去 | 去掉。它们不影响执行；不去的话改一个视频锚点就换了 `runId`，查询缓存白白失效。贴合度报告的身份另含观测集合的摘要（DD-09 §4.4 的 `observationSetDigest`） |
| DD01-Q5 | 初始化阶段的调度错误（理论上不会有）归哪类 | 一律 `engineError`；按错误码归类 | 一律 `engineError`。初始化不执行指令，出现调度错误说明实现有问题。§3.6 表的第三行按这个建议简化 |
