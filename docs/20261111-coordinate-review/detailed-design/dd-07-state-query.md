# DD-07 状态查询、试算会话、"为什么没发生"、事件解释、跨运行比较与命令行 JSON

**版本**：v0.3，2026-11-14，Claude。v0.2 按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10）；v0.3 按 Codex 第二轮复核修订（意见文件 §13：DF-14 的覆盖判定，§12.5 的类型与措辞两处）。
**状态**：Final（2026-11-15）；**已实现（2026-11-16）**。本文 v0.3 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。已完成 T07-1～T07-10、`tests/state-query.test.ts`、`tests/wire-json.test.ts`、§3.5 耗时实测、§13 代表轴验收与 §15 文档同步。
**阶段**：二（§9 的指标级比较在阶段一就要，可以先做）。**前置**：DD-01、DD-05、DD-06。**被依赖**：DD-08、DD-09、DD-10。

## 1. 范围与依据

做（路线图 §4.0、§4.5–§4.9；架构 §2.5–§2.7、§3.4、§5、§7）：

| 节 | 能力 |
|---|---|
| §3 | 重放到指定停止点；`stateAt`、`terminalState`、`eventsBySeq` / `eventsBetween` |
| §4 | 试算会话、纯检查函数、只读的钩子上下文 |
| §5 | `commandCheck`：这条指令为什么还没放 |
| §6 | `whyDidEventNotTrigger`、`wouldHypotheticalEventTrigger` |
| §7 | `explainEvent`：直接来源、伤害的实际输入、资源条目、规则明细 |
| §8 | buff 窗口差几帧 |
| §9 | `diffRuns` |
| §10 | 信封、能力说明、JSON 转换、命令行 `pnpm query` |

不做：
- 帧内任意位置的暂停与恢复、快照缓存（DD-10）。第一版每次查询都从头重算。
- "假如此刻换一条指令"（替换队首、插入）。架构 §7.2 已推后。
- 服务化。只有纯函数与命令行。

## 2. 现状

| 事实 | 位置 |
|---|---|
| 没有状态查询；只有 P6 采集的两条展示轨道 `forte`、`cooldowns` | `simulate.ts` |
| `SimState` 是纯数据，但里面引用了定义对象：`ActionRuntime.def`、`JudgmentRuntime.def`、`TailRuntime.def`、`EnemyRuntime.preset`、`queue.commands` | `types.ts` |
| `settleQueue` 是 `kernel.ts` 的模块级变量；`spawnJudgment(s, …)` 往里追加，它没有 `k` 参数，全库 5 处调用 | `kernel.ts` |
| 调度检查 `evaluate` / `evaluateAct` 遇到第一个不满足的条件就返回，途中会 `assume`、写 `q.readyAt` / `q.until` / `q.extra`、调 `opts.inputDelay`（抽样时消耗 RNG）、可能 `throw fail` | `scheduler.ts` |
| 检查顺序（出招）：出场技入场条件 → `gate`（优先级、连段前置、输入锁、派生窗口；"本 tick 已开始过动作"延后报）→ 冷却 / 充能 → 资源 → 钩子 `canStart` → 等就绪（没写 `!` 时）→ 本 tick 已开始过 → `+N` → 操作延迟 | `evaluateAct`、`stateVerdict` |
| 检查顺序（切人）：切给自己 → 切人冷却 → 全局时停 → 变奏等出手 → 切人锁 → 空中入场 → 出场技等后台动作 → 操作延迟 | `evaluate` |
| `firing` 在通过且有内置冷却时写 `s.lastTrigger` | `triggers.ts` |
| `matches` 是纯函数；`gate` 是纯函数；`settled`、`airborne` 是纯函数 | `triggers.ts`、`kernel.ts` |
| 钩子上下文的 `stat()` 会 `assume`；`canStart` 拿到的是可写的上下文；基线上各角色模块的 `canStart` 不写状态 | `simulate.ts` 的 `hookContext`；架构 §7.1 |
| `HitEvent.buffs` 只有 `"id×层数"`；`ActiveBuff` 是 `{ def, value, stacks, owner }`，没有实例号与剩余时间 | `types.ts`、`formula.ts`、`buffs.ts` 的 `activeFor` |
| 异常效应自身的伤害不经 `settle`，在 `enemy.ts` 里算 | `enemy.ts` 的 `effectTicks`、`effectDamage` |

## 3. 重放与状态

### 3.1 先清掉模块级的可变状态

`settleQueue` 挪到 `Kernel` 上（`k.settleQueue: JudgmentRuntime[] | null`），`spawnJudgment` 加参数 `k`，5 处调用跟着改。理由：重放与试算会在一次运行的回调里再起一次运行（择优的 `onHit` 里已经有这种用法的苗头），模块级变量会让内层的判定写进外层的队列（架构 §5.3）。

这一步是业务行为不变的重构：conformance 输出逐字节不变。

### 3.2 停止点

`run.ts` 的运行体对外只经 `query.ts` 用，停止点有四种：

```ts
export type StopPoint =
  | { readonly kind: 'boundary'; readonly frame: Frame }                                   // S[frame]
  | { readonly kind: 'boundaries'; readonly frames: readonly Frame[]; readonly onReach: (f: Frame, v: StateView, prefix: StatePrefix) => void }
  | { readonly kind: 'evaluation'; readonly evaluationIndex: number }                     // 那一次真实求值之后（§4.4）
  | { readonly kind: 'terminal' }

/** 停在中途得到的前缀：不是一次运行的结果，没有完成状态（DF-10） */
export interface ReplayPrefix {
  readonly kind: 'prefix'
  readonly state: SimState; readonly sim: Sim
  readonly prefix: StatePrefix; readonly ledgerEndExclusive?: number
  readonly log: readonly SimEvent[]; readonly diag?: Diagnostics
}
/** 跑完了的运行：完整的 SimResult 与终态。停止点还没到运行就停了，也返回这个 */
export interface ReplayComplete { readonly kind: 'complete'; readonly result: SimResult; readonly state: SimState; readonly sim: Sim }

export function replayTo(p: PreparedRun, stop: StopPoint, opts?: RunOptions): ReplayPrefix | ReplayComplete
```

- **`boundary` / `boundaries`** 用 DD-05 §6.1 的边界观察点：`S[0]` 在初始化之后；`S[f + 1]` 在走完 P7 之后、帧数上限检查之前。所以 `S[maxFrames]` 取得到，不会被失败收尾或帧数上限的警告抢先（DF-10）。`boundaries` 只重放一次，到了列表里的帧就回调，不停。
- **`evaluation`**：§4.4。
- **`terminal`**：跑完，返回 `ReplayComplete`。DD-05 的 `runForInspection` 就是它。
- **停止点还没到运行就停了**（轴失败、截断、引擎错误）：返回 `ReplayComplete`，调用方据此回答"运行在到达之前就停了"。
- **中途停下**用内部的 `ProbeStop`。它不是运行状态，不进 `buildCompletion`；`ReplayPrefix` 不伪造 `completed` 或 `engineError`（DD-01 §3.6）。
- 重放用的严格选项、续跑策略、抽样种子都来自 `PreparedRun`（架构 §2.5 末段）。
- **不支持重入**：在一次运行的钩子或回调里对同一个正在进行的运行实例发起查询没有意义；`replayTo` 总是新建实例，所以回调里调它是安全的，但查的是从头重算的轨迹。

### 3.3 `stateAt` 与 `terminalState`

`src/engine/query.ts`（新，①D）：

```ts
export type QueryError =
  | { readonly code: 'outOfRange'; readonly completedTicks: Frame; readonly message: string }
  | { readonly code: 'noLegalState'; readonly message: string }       // 初始化没走完
  | { readonly code: 'runIdMismatch'; readonly expected: string; readonly got: string }
  | { readonly code: 'eventOutOfRange'; readonly loggedEventEndExclusive: number }
  | { readonly code: 'unsupported'; readonly what: string }

export type QueryResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: QueryError }

export interface StateAt {
  readonly frame: Frame
  readonly view: StateView
  readonly prefix: StatePrefix
  readonly ledgerEndExclusive?: number
}
export function stateAt(p: PreparedRun, f: Frame, opts?: { diag?: DiagOptions }): QueryResult<StateAt>
export function statesAt(p: PreparedRun, frames: readonly Frame[], opts?): QueryResult<StateAt[]>
export function terminalState(p: PreparedRun, opts?): QueryResult<StateAt & { readonly kind: RunCoverage['terminal']['kind']; readonly completion: RunCompletion }>
```

- **范围**：`0 ≤ f ≤ completedTicks`。超出返回 `outOfRange` 并带上 `completedTicks`。初始化没走完时任何 `f` 都返回 `noLegalState`。
- **`S[completedTicks]` 与终态分开**：`stateAt(p, completedTicks)` 停在最后一个合法边界；`terminalState` 是实际停下的那一刻。正常结束时后者多了 P1、`endDueActions` 与收尾的 `drain`（架构 §5.2）。
- **`prefix`**：到停止点时 `{ eventEndExclusive: s.log.length, handledEndExclusive: bus.inFlight ?? bus.cursor, interventionEndExclusive: sim.interventions.length }`。tick 边界上前两项相等。

**`StateView`** 是完整状态的可序列化投影，字段覆盖架构 §5.1 的四类；定义对象换成标识：

| `SimState` 里的 | `StateView` 里的 |
|---|---|
| `frame`、`battleFrames`、`onField`、`entry` | 原样 |
| `chars[i]` | `name`、`switchCd`、`startedThisTick`、`energy`、`concerto`、`core`、`cooldowns`、`charges`、`vars`（拷贝）；`action` / `last` / `combo` 各是 `ActionView \| null` |
| `ActionRuntime` | `ActionView`：`id`、`instance`、`localFrame`、`startedAt`、`cursor`、`ended`、`coreGranted`、`cmd`、`skip`。`last` 与 `combo` 指向同一个实例时，三处各写一份，靠 `instance` 认 |
| `judgments[]` | `id`、`owner`、`action`、`actionInstance`、`judgment`（定义名）、`spawnedAt`、`age`、`ticksDone`、`detached` |
| `tails[]` | `owner`、`action`、`instance`、`localFrame`、`events`（时间线事件原样，是纯数据）、`detached`、`skip`、`noted` |
| `buffs[]` | 原样（本来就没有定义对象） |
| `enemy` | 除 `preset` 换成预设的标识外原样 |
| `dilations[]` | 原样 |
| `queue` | `next`、`loop`、`loopBegun`、`waited`、`readyAt`、`extra`、`until`、`seg`；不带指令表 |
| `nextId`、`outroLinks`、`pendingNextIn`、`lastTrigger`、`assumed`、`rng` | 原样 |
| `log` | 不带；用 `prefix` 与 `eventsBySeq` |

- `StateView` 由纯函数 `viewOf(s)` 生成，数组与对象都是新拷贝。
- 零干扰测试（DD-05 §6.2）加的那一项，比的就是两侧的 `StateView`。
- 展示轨道 `forte`、`cooldowns` 不在里面：它们不是完整状态（架构 §5.1）。

### 3.4 事件

```ts
export function eventsBySeq(res: SimResult, from: number, toExclusive: number): QueryResult<readonly { seq: number; event: SimEvent; meta?: EventMeta }[]>
export function eventsBetween(res: SimResult, loBattleFrame: number, hiBattleFrame: number): QueryResult<…>
```

- `eventsBySeq` 能取到全部已记录的事件，范围 `[0, loggedEventEndExclusive)`，包括不计入的那个 tick 与收尾里写的。
- `eventsBetween` 按战斗帧窗口 `[lo, hi)`，同汇总的口径。
- 结果带了 `diag.eventMeta` 时一并返回。

### 3.5 成本

T07-3 实测并把数字写进提交说明与本文的修订记录：`m0-video-eq.yaml`（约 6,600 帧）与 `xin-tower4-video.yaml`（最长的录像场景）上，`stateAt` 取首、中、尾三个帧各要多久，`statesAt` 一次取 100 个帧要多久。超过 2 秒的查询在 `pnpm query` 里打印一行提示。缓存留给 DD-10，键用 `runId`。

- **2026-11-16 实测记录**：
  - `scenarios/m0-video-eq.yaml`（`completedTicks = 10001`）：`stateAt(0) = 1.69 ms`，`stateAt(5000) = 227.11 ms`，`stateAt(10001) = 193.86 ms`，`statesAt(100 个均匀帧) = 187.27 ms`。
  - `scenarios/xin-tower4-video.yaml`（`completedTicks = 13521`）：`stateAt(0) = 0.69 ms`，`stateAt(6760) = 148.88 ms`，`stateAt(13521) = 277.16 ms`，`statesAt(100 个均匀帧) = 276.09 ms`。
  - `pnpm query` 对单次耗时 > 2000 ms（例如带双份完整诊断的 `diff --target commands`，实测 `2064 ms`）在 `stderr` 打印提示，不污染 `stdout` JSON。

## 4. 试算会话与纯检查

### 4.1 会话就是一次重放

第一版的状态查询靠重算，所以"连 `Sim` 一起隔离的试算会话"不需要去克隆一个正在跑的 `Sim`：**每次查询都 `replayTo` 到需要的那一刻，得到一个独立的运行实例**，它的状态、事件总线、`warned`、钩子上下文都是自己的。在它上面求值，再把它丢掉。

```ts
export interface ProbeSession { readonly replay: ReplayPrefix; readonly ro: readonly ReadonlyHookContext[] /* 只读上下文，见 4.3 */ }
export function openProbe(p: PreparedRun, stop: StopPoint): QueryResult<ProbeSession>
```

即使是用完即弃的实例，检查函数也要是纯的：一次查询里要把全部条件都列出来（不在第一个不满足处停），前面的检查如果写了 `lastTrigger` 或 `q.readyAt`，后面的结果就不对了。

### 4.2 纯检查函数

`src/engine/probe.ts`（新，①D）。三个函数，都不写任何状态、不调 `assume`、不调 `opts.inputDelay`、不抛调度错误：

```ts
export function explainAct(s: SimState, k: Kernel, env: ProbeEnv, slot: Slot, def: ActionDef, ctx: ActContext): ConditionCheck[]
export function explainSwitch(s: SimState, k: Kernel, env: ProbeEnv, c: Extract<Command, { kind: 'switch' }>, ctx: SwitchContext): ConditionCheck[]
export function explainFiring(s: SimState, trigger: BuffDef['trigger'], owner: Slot | 'env', id: string, icd: number | undefined, occs: readonly Occurrence[]): ConditionCheck[]
```

`ConditionCheck` 与 `ConditionStatus` 照架构 §7.1。每个函数按真实执行的顺序列出**全部**条件；真实执行里会在第一个不满足处返回，所以排在它后面的条件标 `speculative: true`（是额外试算出来的）。返回值另带 `firstBlocking: string | null`。

`explainAct` 的条件表（`id`、对应真实执行的哪一步、不满足时真实执行怎么做）：

| `id` | 真实执行 | 不满足时 |
|---|---|---|
| `onField` | `evaluate` 的前台检查 | 报错 `notOnField` |
| `entry.skillRequired` | 写了 A1 而该写出场技 | 报错 `entrySkill` |
| `entry.skillAllowed` | 出场技要普通切人入场后第一个出 | 报错 `entrySkill`（可选指令是等待 `entry`） |
| `gate.combo`、`gate.inputLock`、`gate.priority`、`gate.derive` | `gate()` | 等待，或报错 `comboBroken`（`gate` 返回不可等时） |
| `cooldown` | `stateVerdict` | 等待 `cooldown` |
| `resource` | `canAfford` | 等待 `resource` |
| `hook.canStart` | 角色钩子（含谐度破坏的 `canTuneBreak`） | 等待 `hook` |
| `settled` | 没写 `!` 时等出手 | 等待 `settled`；写了 `!` 时状态是 `notApplicable` |
| `gate.started` | 本 tick 已开始过动作 | 等待 `started` |
| `delay` | `+N` | 等待 `delay`；没写时 `notApplicable` |
| `inputDelay` | 操作延迟 | 等待 `input`；延迟为 0 时 `notApplicable` |

- 每条带 `expected` / `actual` 的短句，例如 `cooldown`：`expected: 'E1 冷却 = 0'`、`actual: '还剩 9 帧'`。
- `gate` 只返回第一个不通过的原因。`gate.*` 四项里，`gate` 报的那一项标 `unmet`，它之前的标 `met`，之后的标 `shortCircuited`。要逐项试算得拆 `gateRules`，第一版不拆。
- `delay`、`inputDelay` 要用到 `q.readyAt`、`q.extra`，而真实的 `evaluate` 可能正是在这一次求值里第一次写入它们：首次遇到 `+N`、首次取操作延迟，抽样时还会消耗 RNG。所以解释的检查点放在**真实求值之后**（§4.4），这两项读的是这次真实求值写下的值，不重新向 `opts.inputDelay` 要，也不碰 RNG（DF-11）。

`explainSwitch` 的条件表同理：`switchSelf`、`switchCd`、`globalStop`、`concertoSettle`、`switchLock`、`airEntry`、`entryBusy`、`inputDelay`，最后加一项 `introReady`（DF-08）。写了"变奏"时，它按 `onSwitch` 的规则选出变奏动作（钩子返回的 ID；返回 `undefined` 时回退到 `introOf`），检查"切出者协奏满，而且有变奏动作"。它对应的真实执行不在 `evaluate` 里，而是 `execute` 开头的意图检查（DD-02 §3.3 ②）：前 8 项都满足而它不满足时，非严格入口只记一条 `introMissed` 警告并普通切人，严格入口以 `intentUnmet` 失败。报告里 `firstBlocking === 'introReady'` 的含义按入口写明。

`onField` 一项保留基线语义：后台角色出招在 `evaluate` 里直接报 `notOnField`，可选的 `?` 不会让它变成可跳过（可选的跳过发生在 `evaluate` 正常返回之后；Codex 对 DF-08 的更正）。

`explainFiring` 的条件表：

| `id` | 含义 |
|---|---|
| `occurrence` | 这条事件有没有产生触发点（异常效应自身的伤害、`summonCountsAsChar` 为假时阵附加的效应，都没有） |
| `on` | 事件种类对不对 |
| `by` | 发出者符不符合 `self` / `onField` / 任意 |
| `where.actionKinds`、`where.actions`、`where.judgments`、`where.tags`、`where.elements`、`where.resource`、`where.ownerHas`、`where.enemyState`、`where.effect`、`where.afterBattle` | 写了的字段各一条；没写的不列 |
| `icd` | 内置冷却；`actual` 写还剩几个战斗帧 |

- 触发规格是数组时，每个规格各出一组，返回里按规格分组；任一组全部满足就算会触发。
- 一条事件对应两个触发点时（`switch` 对应 `switchOut` 与 `switchIn`），按触发点分组。

**与真实执行一致**是验收条件（C07-9、C07-13）：在每一次真实求值之后的检查点（§4.4）调 `explainAct` / `explainSwitch`，`firstBlocking` 对应的代码等于这次真实结论的代码；真实结论是"放行"时，`firstBlocking` 为 null，或者是只在 `execute` 里检查的 `introReady`。

### 4.3 只读的钩子上下文（DF-13）

- **类型**（架构 §7.1）：新类型 `ReadonlyHookContext`，只有 `self`、`chain`、`rules`、`state: DeepReadonly<Omit<SimState, 'log'>>`（投影不带日志，类型如实表达这一点）、`buffStacks`、`vars: DeepReadonly<V>`、`stat`。`CharacterHooks` 的 `canStart`、`introAction`、`forte` 三个签名改收它。真实运行里传的仍是完整的 `HookContext`：它是 `ReadonlyHookContext` 的子类型，可以直接传。改了签名之后，角色模块在这三个钩子里调写方法，`pnpm check` 就会报错；T07-5 迁完签名、`pnpm check` 通过，即说明基线模块在这三处都是只读的。
- **试算时传的对象**：`probe.ts` 的 `readonlyContext(sim, s, slot)` 给一份**深冻结的投影**。`state` 是这一刻 `SimState` 的深拷贝：定义对象（`def`、`preset`、指令表）按引用保留，不拷贝也不冻结，它们本来就不是状态；其余部分（含 `chars[*].vars`、各个数组）逐层 `Object.freeze`。`vars` 就是投影里的那一份。浅的 `Readonly<SimState>` 挡不住 `ctx.state.chars[0].energy = …` 或数组操作，所以不能"照常返回 `state`"。
  - 投影里不带日志；三个只读钩子基线上都不读日志（T07-5 时 `grep` 核对）。有读的，再把日志前缀冻结后放进来。
- **违规与失败**：调写方法（`addBuff`、`addResource` 等）抛 `UnsupportedWrite`，这时 `hook.canStart` 记 `unmodeled`，`actual: '钩子在检查里尝试写状态，不支持只读求值'`。其他异常一律记 `unmodeled`、`actual: '只读求值失败'`，原样保留原错误的类型与消息：改冻结对象时严格模式抛的 `TypeError` 在其中，但读不存在的字段等别的错误也可能是 `TypeError`，所以不断言它是在写状态（Codex §12.5）。不静默吞掉后给一个看似正常的答案。
- **会话内不串**：钩子拿到的是冻结的投影，同一次查询里前一个条件的求值改不了后一个条件看到的状态（C07-7、C07-8）。
- 不给整个业务运行装 `Proxy`。

### 4.4 真实求值的记录与检查点（DF-11）

诊断选项 `commandVerdicts: true` 时，调度器每做一件下面的事就记一条。`evaluationIndex` 在一次运行里从 0 递增，同一帧里多次经过同一条指令也分得开。编号本身不随诊断开关：诊断关着也计数（计数在运行记忆 `progress.evalCount` 里、随快照保存），诊断关着拍的快照恢复后 `evaluation` 停止点与从头跑停在同一处（2026-11-17，Codex 审查 F5；DD-10 §3.1）：

```ts
export interface CommandVerdict {
  readonly evaluationIndex: number
  readonly f: Frame
  readonly cmd: CommandRef
  readonly kind: 'head' | 'interject' | 'evaluate' | 'execute' | 'skip'
  /** evaluate：这次真实求值的结论；抛错时是错误码 */
  readonly verdict?: { readonly go: true } | { readonly go: false; readonly code: WaitCode; readonly reason: string } | { readonly threw: ScheduleErrorCode }
  /** evaluate 之后的调度上下文：这次求值可能第一次写下 readyAt、extra、until */
  readonly context?: { readonly readyAt: number | null; readonly extra: number | null; readonly until: number | null; readonly waited: number; readonly force: boolean; readonly delay: number }
  /** interject：在它前面插了什么 */
  readonly interject?: { readonly slot: Slot; readonly action: ActionId }
}
```

- `head`：这条指令第一次成为队首（每条指令一次）。
- `interject`：在它前面插了一个动作（自动谐破）。插队之后调度循环 `continue`，同一帧会再对原指令求值一次；那一次另有自己的 `evaluate` 记录。只用"指令 + 帧"定位的话，这两次分不开（DF-11）。
- `evaluate`：一次真实的 `evaluate` 调用，带结论与求值之后的上下文。
- `execute`、`skip`：执行了、被 `?` 或 `~` 跳过。`wait`、`at`、外部指令、静默同步这些没有自己业务事件的指令，靠这条记录知道是哪一帧执行的；它们是末条也一样。

**检查点**：`StopPoint` 的 `evaluation` 停在指定的那次 `evaluate` **之后**、`hold` 或 `execute` 之前。实现是调度器在 `evaluate` 外面包一层：调完它（或接住它抛的 `ScheduleError`）之后调 `opts.afterEvaluate?(s, c, ref, verdict, evaluationIndex)`，返回 `'stop'` 时抛 `ProbeStop`；不停的话，接住的错误原样再抛出，真实执行照旧。不给 `afterEvaluate` 时一个分支都不多走；给了也只读，不改调度机制。检查点与真实求值是同一次，`explainAct` 看到的 `q.extra` 就是这次真实取到的值，不重新取，也不碰 RNG。

## 5. `commandCheck`

```ts
export interface CommandCheck {
  readonly cmd: CommandRef
  readonly outcome: 'executed' | 'skipped' | 'failedHere' | 'notReached'
  readonly firstAtHeadFrame: Frame | null
  readonly executedAtFrame: Frame | null
  readonly skip?: { readonly code: WaitCode; readonly reason: string }
  readonly notReachedBecause?: { readonly status: RunStatus; readonly stoppedAtFrame: Frame; readonly headCmd: CommandRef | null }
  /** 这条指令的每一次真实求值 */
  readonly evaluations: readonly { readonly evaluationIndex: number; readonly f: Frame; readonly verdict: NonNullable<CommandVerdict['verdict']> }[]
  readonly waits: readonly { readonly code: WaitCode; readonly intent: boolean; readonly fromFrame: Frame; readonly frames: number; readonly reason: string }[]
  /** 选定的那次真实求值之后的逐条件结果 */
  readonly checkedEvaluation: number | null
  readonly conditions: readonly ConditionCheck[]
  readonly firstBlocking: string | null
  readonly context: (NonNullable<CommandVerdict['context']> & { readonly entry: SimState['entry'] }) | null
}
export function commandCheck(p: PreparedRun, cmd: CommandRef, opts?: { evaluationIndex?: number }): QueryResult<CommandCheck>
```

怎么算：
1. **先跑一次带 `commandVerdicts` 的完整运行**。`outcome`、`firstAtHeadFrame`、`executedAtFrame`、`evaluations` 都从这份记录取，不从"下一条指令什么时候到队首"去推（DF-11）。运行提前停了的，按完成状态与当时的队首分 `failedHere` 与 `notReached`。这两种"没查到"与"被跳过"分开（架构 §14.3）。
2. **选一次真实求值**：缺省是这条指令最后一次 `evaluate`（执行了的，就是放行的那一次；一直在等的，就是停下前的最后一次）。调用方可以用 `evaluationIndex` 指定另一次；指定的那次不属于这条指令时报错。
3. **重放到那次求值之后**（`StopPoint` 的 `evaluation`），调 `explainAct` 或 `explainSwitch`。这一帧的 P1、`endDueActions`、排在前面的指令、同帧的插队都已经发生过，与真实执行完全相同。
4. **上下文取实际值**：`force`、`delay`、`readyAt`、`extra`、`waited`、`until` 取这次求值之后的记录，`entry` 取那一刻的状态。同一个动作名，带不带 `!`、带不带 `+N`，开始的帧不同，这里看得出来。
5. **不推进**：检查不走这一帧的后续相位。

`wait N`、`at` 的 `conditions` 只有一条（到没到时间）；外部指令与静默同步没有条件，`outcome` 与执行帧来自 `execute` 记录。

另给一个标明用途的低层检查，回答"P1 之前的原始条件"：

```ts
/** 在 S[f] 上、不经过这一帧的 P1 与 endDueActions 直接检查。结果标 basis: 'preP1'，不是调度结论 */
export function rawActionCheck(p: PreparedRun, f: Frame, slot: Slot, action: ActionId): QueryResult<{ basis: 'preP1'; conditions: ConditionCheck[] }>
```

"假如此刻换一条指令"的查询（替换队首、插入）以后再做。到时必须给出完整的请求并标为假想，不借用别的指令的等待起点。

## 6. 触发为什么没发生

```ts
export interface TriggerTarget { readonly kind: 'buff' | 'buffExtend' | 'resourceEffect' | 'consume' | 'charHook'; readonly owner: Slot | 'env'; readonly id: string }

export type TriggerOutcome =
  | 'fired'               // 检查过，触发了
  | 'checkedNotFired'     // 检查过，条件不满足
  | 'notEntered'          // 这条事件没有进到这个目标的检查；原因见 notEnteredReason
  | 'handlerNotRun'       // 事件在日志里，但处理它的处理器没有执行到这个目标
  | 'unsupported'         // 目标没有声明式的触发规格（角色钩子）

export interface TriggerCheck {
  readonly event: EventHandle
  readonly target: TriggerTarget
  readonly outcome: TriggerOutcome
  readonly notEnteredReason?: 'noOccurrence' | 'noInstance' | 'targetMismatch'
  readonly handlerNotRunReason?: 'failCloseUnhandled' | 'earlierHandlerThrew' | 'runStoppedBeforeHandling'
  readonly groups: readonly { readonly occurrence: string; readonly spec: number; readonly conditions: readonly ConditionCheck[] }[]
  readonly afterFiring?: string           // 触发了但没有可见效果时的说明：层数已满、nextIn 挂起等
}
/** 假想事件没有真实的事件序号，单独一种返回类型（Codex §12.5） */
export interface HypotheticalTriggerCheck {
  readonly hypothetical: true
  readonly atFrame: Frame                 // 用的是 S[atFrame]，帧开始时的状态
  readonly event: HypotheticalEvent
  readonly target: TriggerTarget
  readonly outcome: 'wouldFire' | 'wouldNotFire' | 'notEntered' | 'unsupported'
  readonly notEnteredReason?: 'noOccurrence' | 'noInstance' | 'targetMismatch'
  readonly groups: TriggerCheck['groups']
}
export function whyDidEventNotTrigger(p: PreparedRun, event: EventHandle, target: TriggerTarget): QueryResult<TriggerCheck>
export function wouldHypotheticalEventTrigger(p: PreparedRun, f: Frame, event: HypotheticalEvent, target: TriggerTarget): QueryResult<HypotheticalTriggerCheck>
```

**记录的时刻**：`handle` 处理这条事件、轮到目标处理器的那一刻。同一条事件的处理器有先后，依次是消耗、buff 触发与延长、资源型效果、角色钩子，同类里按登记顺序；排在目标前面的已经生效（架构 §7.3）。

**在哪里记**（DF-12）：带诊断 `triggerChecks: [target]` 重跑。收集器在 `handle` 里，对请求的目标，在每个可能提前跳过的分支都当场记一条，不事后拿终态补算：

| 分支 | 记什么 |
|---|---|
| `occs.length === 0`：整段声明式处理被跳过（异常效应自身的伤害、`summonCountsAsChar` 为假时阵附加的效应等） | `notEntered`、`noOccurrence` |
| buff 触发、资源型效果：调 `firing` 之前 | `explainFiring` 的结果；调完按真实结果标 `fired` 或 `checkedNotFired` |
| 延长：这个定义此刻没有实例（基线直接 `continue`） | `notEntered`、`noInstance` |
| 延长：有实例 | 触发条件与 `extendLimit`（延长次数到没到上限），以及结果 |
| 消耗：遍历在场实例之前，先看这个目标有没有实例 | 没有：`notEntered`、`noInstance`；有，但实例的目标既不是发出者也不是敌人：`notEntered`、`targetMismatch`；否则逐条件给结果（DF-08）。一个目标可能有几个实例（全队 buff 每人一个），一条事件也可能有几个触发点（切人：切出、切入）：每个相关实例在自己被处理的那一刻记解释（分组带 `instance`），所有实例看完再给结论，有一个真的被消耗了就是 `fired`（2026-11-17，Codex 审查 F6：原来在第一个相关实例上就定了结论） |
| 角色钩子 | `unsupported`：钩子内部未插桩。不把"没生成事件"硬归到某个门槛上 |

`explainFiring` 是纯函数，放在实参里不违反 DD-05 §3.1 的写法约束。

**没有记录时怎么回答**：
- 句柄的 `runId` 与 `p.runId` 不同：`runIdMismatch`（DF-14）。
- 序号不在 `[0, loggedEventEndExclusive)`：`eventOutOfRange`。只有这一种情况报它。
- 序号 ≥ `handledEndExclusive`：`handlerNotRun`。原因按完成状态分：
  - 失败收尾写出的那条 `wait` 从没进过 `drain`：`failCloseUnhandled`；
  - 正在处理的那条事件上，排在目标前面的处理器抛了错：`earlierHandlerThrew`（目标排在抛错的处理器之前的，照常有记录）；
  - 探针或续跑起点停在它被处理之前：`runStoppedBeforeHandling`。

  这几种都不能报成"检查过、没触发"（DF-12）。

**假想事件**：在指定边界 `S[f]` 的试算会话里构造事件，经 `occurrencesOf` 得到触发点，再调 `explainFiring`。结果 `hypothetical: true`，不当作历史。它用的是帧开始时的状态，不是这一帧中途某一刻的，这一点写在返回的能力说明里。

## 7. 事件解释

```ts
export function explainEvent(p: PreparedRun, event: EventHandle): QueryResult<EventExplanation>
```

公开签名收 `EventHandle`，句柄的 `runId` 与 `p.runId` 不同时返回 `runIdMismatch`。命令行的 `--seq N` 用当前 `PreparedRun.runId` 拼成句柄（DF-14）。

类型照架构 §3.4。带 `{ eventMeta, resourceLedger, ruleTrace, hitInputs, hitMargins }` 重跑一次，再组装：

| 字段 | 怎么来 |
|---|---|
| `directCauses` | 从这条事件起，有 `directParentSeq` 就沿它，没有就沿 `subjectSeq`（DD-05 §3.3），走到两者都没有为止；每一步带 `meta`，并标明走的是哪种关系（`via: 'parent' \| 'subject'`）。链的顶端通常是 `command`、`init` 或 `timer` |
| `origin` | 这条事件自己的 `origin` 单列：例如取消了别的动作的那条指令（DF-06） |
| `hitInputs` | `diag.hitInputs` 里这条 `hit` 的记录；见下 |
| `resourceEntries` | 账本里 `relatedEventSeq === seq` 的条目 |
| `ruleTrace` | 与这条事件同一个作用域里记的规则明细，加上 `directCauses` 上各事件所在作用域里的。为此 `EventMeta` 与 `RuleTraceEntry` 各带一个不对外承诺含义的 `scope: number`；链的顶端是 `command` 时，再加上这条指令各次求值时记的（`RuleTraceEntry` 带可选的 `cmd`） |
| `windowMargins` | §8 |
| `scope` | 恒为 `'direct_causes_and_immediate_inputs_only'` |

另外带一项架构没列、但区分两个概念要用的：`businessRoot?: { seq: number }`，取自 `bus.chain` 的 `Link.root`（由收集器在 `drain` 里顺手记下）。它是"算在谁名下"，和 `directCauses` 的"谁直接引出"分开标。

**伤害的实际输入**（`diag.hitInputs`，DF-15）。记的是真正传给公式的参数，按公式路径分开：

```ts
export type HitInputs =
  | {
      readonly path: 'direct'                               // computeHit
      readonly ctx: HitContext                              // rate（modifyHit 之后的倍率）、attr（倍率关联的属性）、extraFlat、level、enemy { def, res }、panel
      readonly acc: ZoneAccumulator                         // 最终的乘区累加：buff 与钩子直接补的 zones、critOnly 都在里面
      readonly view: HitView                                // 元素、标签、动作、判定：过滤条件看的那几项
      readonly multiplier: { readonly base: number; readonly afterModifyHit: number }
      readonly buffs: readonly ActiveBuffContribution[]     // 解释来源用，不承担还原公式输入
      readonly factors: HitFactors
      readonly output: { readonly nonCrit: number; readonly crit: number; readonly expected: number }
      readonly notRecorded: readonly string[]
    }
  | {
      readonly path: 'tuneBreak'                            // computeTuneBreak：谐度破坏与震谐响应
      readonly ctx: Parameters<typeof computeTuneBreak>[0]  // base、rate、level、enemy { def, res }、harmonyBreakBoost、vsNormal
      readonly acc: ZoneAccumulator
      readonly output: { readonly nonCrit: number; readonly crit: number; readonly expected: number }
      readonly notRecorded: readonly string[]
    }
```

- **只记 `buffs` 与 `factors` 不够**：`factors` 主要是非暴击支的结果，还原不了暴击专属的乘区；钩子还可以直接补乘区，例如守岸人的 `modifyHit` 给强化 QTE 的判定补 `hit.zones.critRate`。`acc` 就是 `accumulate(view, active, draft)` 的返回值，`settle` 里这些值都是现成的；基线给择优用的 `HitRecord` 也已经保留了 `draft.zones` 与 `critOnly`，做法相同。
- **规则不另存**：公式读的 `rules` 就是运行身份里的那份（`identity.execution.rules`），重算时从身份取。
- **`buffs`**（`ActiveBuffContribution`）：`activeFor` 返回的每一项补上 `instanceId` 与 `remaining`（`ActiveBuff` 加两个字段，公式不读它们），再筛出有乘区、且过滤条件对得上这一下的，就是基线算 `used` 的同一个集合。
- **`notRecorded`** 固定写出这一版没留的上游细节，例如 `'modifyHit 内部的分支'`、`'面板的装配来源'`。
- **输入与输出分开**：`HitEvent.dmg` 是输出，不拿来充当公式输入。

首版支持的伤害路径：

| 路径 | 支持 |
|---|---|
| 判定结算的直接伤害（`computeHit`） | 是 |
| 谐度破坏、震谐响应（`computeTuneBreak`） | 是 |
| 异常效应的定时结算、钩子主动触发的效应伤害 | 否。`hitInputs` 省略，能力说明的 `unsupported` 里写 `'explainEvent.hitInputs: 异常效应伤害'` |
| 非伤害判定（`dmg === null`） | `hitInputs` 省略，这是"不适用" |

对不是 `hit` 的事件，`explainEvent` 照样返回 `directCauses`、`origin`、`resourceEntries`、`ruleTrace`。

## 8. buff 窗口差几帧

```ts
export interface BuffWindowMargin {
  readonly defId: string; readonly owner: CharName | 'env'; readonly target: CharName | 'enemy'
  readonly instanceId: number
  readonly state: 'present' | 'left' | 'appliedLater'
  readonly remainingBattleFrames?: number | 'inf'     // present
  readonly leftBattleFramesAgo?: number               // left
  readonly exitReason?: 'timeout' | 'switchOut' | 'removed'
  readonly appliedBattleFramesLater?: number          // appliedLater：只在事后标注里有
  readonly note: 'hint_only'
}
```

- **哪些 buff 算"相符"**：在 `settle` 里记下这一下的 `matchingDefs`：`sim.r.buffs` 里有乘区、过滤条件对得上这一下、且按目标规则会作用到这个出伤者或敌人的定义（不管此刻在不在）。用的是 `matchesFilter` 这个纯函数。这是 `diag.hitMargins` 的运行期部分。
- **实例的区间**从日志的 `buffApply` / `buffExpire` 得到（靠 `instanceId`）。
- **组装**（事后，在 `explainEvent` 里）：对每个相符的定义，在场的实例给 `remainingBattleFrames`；这一下之前 `lookback`（缺省 120 战斗帧）内离开的给 `leftBattleFramesAgo` 与 `exitReason`；之后 `lookahead`（缺省 120）内才挂上的标 `appliedLater`。
- **被换人移除的**（`switchOut`）照实标原因，不按自然到期解释成"差几帧"。
- **只是提示**：每条带 `note: 'hint_only'`。"差 18 帧"不表示早 18 帧就能吃到。
- `stateAt` 不提供 `appliedLater`：单帧的状态不读未来（架构 §7.4）。

## 9. 跨运行比较

类型照架构 §2.6 的 `RunDiff`、`EventHandle`、`CorrespondenceStatus`。

```ts
export type DiffTarget =
  | { readonly kind: 'metrics' }
  | { readonly kind: 'commands' }
  | { readonly kind: 'events'; readonly types?: readonly SimEventType[]; readonly cmd?: CommandRef }

export interface RunDiffExtra {
  readonly metrics: { readonly status: [RunStatus, RunStatus]; readonly steadyLoopBattleFrames: [readonly number[] | null, readonly number[] | null]; readonly dps: [number | null, number | null]; readonly comparable: boolean; readonly notComparableReason?: string }
  readonly sameAxis: boolean                    // 两边的 opening 与 commands 摘要相同
  /** 各自覆盖到哪：只用于判"缺失"，不否定已经成对的事件（DF-14 第二轮） */
  readonly coverage: { readonly base: SideCoverage; readonly cand: SideCoverage }
  /** 两边都有合法状态边界的帧：f ≤ commonStateFrames。只给"同一世界帧的状态比较"用 */
  readonly commonStateFrames: Frame
}
export interface SideCoverage {
  readonly status: RunStatus
  readonly complete: boolean            // status === 'completed'：自然结束，日志就是整条有限轨迹
  readonly completedTicks: Frame
  readonly loggedEventEndExclusive: number
}
export function diffRuns(a: { p: PreparedRun; res: SimResult }, b: { p: PreparedRun; res: SimResult }, target: DiffTarget, opts?: { commandMapping?: readonly [CommandRef, CommandRef][] }): QueryResult<RunDiff & RunDiffExtra>
```

- **句柄与身份校验**：`a.res.runId !== a.p.runId`，或者 `b` 一侧同样不配，返回 `runIdMismatch`（DF-14）。
- **`metrics`**（阶段一就用，DD-04 的候选报告靠它）：完成状态、稳态各轮的战斗帧数、口径 DPS。`comparable` 由 `src/engine/basis.ts` 的 `usableBasis`（DD-03 §7.1）与"双方稳态窗口是不是同样的轮次"决定。`basis.ts` 属于执行核心包的汇总组，查询层引它不违反分层规则（DF-21）。
- **先对应，覆盖只用来判缺失**（DF-14，按 Codex 第二轮的更正）：
  - **两边都记录了的事件**，按对应键配对，报告帧差与数值差，不拿两边终态帧的较小值去否定它们。基准操作延迟 0、对照 6 的单动作运行，起手与结束都配上，差 6 帧；终态那一帧记下的事件（例如自然结束时不计入的那个 tick 里写的 `actionEnd`）照样参与对应。
  - **只有一边有的事件**，才看另一边能不能确认它没有：另一边自然结束（`coverage.*.complete`），它的日志就是整条有限轨迹，确认缺失，标 `addedOrRemoved`；另一边截断、轴失败、引擎错误，或者对应依据不足（不是同一条轴、又没有映射），保守标 `unanalyzed` 并写原因。例如指令 A 双方都执行了，A 留下一个第 60 帧才结算的后台判定，而一方在第 30 帧截断：第 60 帧那一下是 `unanalyzed`，不能说它被删了。
  - **同一个键出现多次**时按序数配；一边少了的那几次，照上一条判。
  - **`commonStateFrames`**（`min(completedTicks)`）只给"同一世界帧的状态比较"用：两边都有合法的 `S[f]`，才比状态。它不是事件对应的门槛。
- **`commands`**：
  - 同一条轴（`sameAxis`）时按 `CommandRef` 对应，两侧的指令取并集：轮数不同时只有一侧有的那几轮也列出，另一侧根本没有这条指令的按确认缺失处理（`addedOrRemoved`），不是"没执行到"（2026-11-17，Codex 审查 F7）。显式给了对应表就按对应表，空的对应表当作没给；
  - 不是同一条轴时，给了 `commandMapping` 才按映射对应。没给时 `CommandRef` 相同也不当作同一意图：删掉第一行之后，原来的第二行变成了第一行。这时只按结构键（同一轮、同一角色、同一动作、第几次）列候选，全部标 `ambiguous`；
  - 对应上的再分：`matched`（双方都执行了，带世界帧与战斗帧的差）、`addedOrRemoved`（一方执行、另一方跳过；或另一方自然结束而始终没有执行它）、`unanalyzed`（另一方在到达它之前就停了，带原因）。
- **`events`**：
  - 同一条轴，或给了 `commandMapping`：对应键是"链顶端的来源 + 事件类型 + 角色 + 动作 + 判定名 + 第几跳 + 同键里的第几个"。链顶端是 `command` 时用 `CommandRef`（不是同一条轴时先经映射换算）；是 `autoInterject`、`timer`、`init` 时用它们各自的派生键，不借用指令的编号。这要求两边都带 `eventMeta`，没带的话 `diffRuns` 自己带诊断重跑。`basis` 是 `'commandRef'` 或 `'explicitMapping'`。
  - 不是同一条轴、又没有对应表：只用结构键找候选，全部返回 `ambiguous`，`candidates` 列出，不报 `matched`（架构 §2.6）。
  - 只看某条指令引出的事件（`target.cmd`）时，对照一侧取对应表里它对应的那条；对应表里没有它，对照一侧就没有可比的事件（基准一侧的记 `unanalyzed`），不退回同一个编号——不是同一条轴时同一个编号可能是另一条指令。
- **`firstDivergence`**：在"已配对、但帧或数值不同"与"确认缺失"的事件里，取发生得最早的那个（按两边中较早的世界帧，同帧再按基准的事件序号）。`unanalyzed` 的不算分歧，所以它不会指向另一方还没执行到的事件。
- **阶段一可以只比指标**：每轮时长、合法性、完成状态。事件级的对应随后补。

## 10. 对外输出

### 10.1 信封与能力说明

`src/engine/wire.ts`（新，①D）。类型照架构 §2.7 的 `QueryEnvelope`、`CapabilityDisclosure`。

```ts
export const WIRE_SCHEMA_VERSION = '1'
export function envelope<T>(p: PreparedRun, res: SimResult, data: T, used: readonly string[], unsupported: readonly string[]): QueryEnvelope<T>
export function toWire(x: unknown): JsonValue     // 就是 DD-01 的 canonicalJson 的对象版，规则相同
```

`capabilitiesUsed` 与 `unsupported` 用固定的字符串，各查询在自己的实现里写明：

| 查询 | `capabilitiesUsed` | 可能的 `unsupported` |
|---|---|---|
| `stateAt` | `state.recompute` | — |
| `commandCheck` | `state.recompute`、`probe.act` / `probe.switch` | `gate 逐项试算`；钩子写状态时 `hook.canStart 只读求值` |
| `whyDidEventNotTrigger` | `diag.triggerChecks` | `charHook 内部` |
| `wouldHypotheticalEventTrigger` | `state.recompute`、`probe.firing` | `帧内时刻`（用的是帧开始的状态） |
| `explainEvent` | `diag.eventMeta`、`diag.hitInputs`、`diag.resourceLedger`、`diag.ruleTrace` | `异常效应伤害的输入`、`间接的时序影响` |
| `diffRuns` | `diff.metrics` / `diff.commands` / `diff.events` | `三项及以上的归因` |

`assumptionsEncountered` 取 `summary.assumptions`；`ruleUsage` 取结果里的；`conditioning` 取完成状态里的。

### 10.2 JSON 转换

规则照架构 §2.7，实现上：
- 数值字段的"未知"写字符串 `'unknown'`，"零时长"写 `'zeroDuration'`，无穷写 `'inf'` / `'-inf'`；
- "不适用"是省略字段，不写 `null`；`null` 只用于类型里本来就有 `null` 的字段（如 `firstAtHeadFrame`）；
- 顺序无含义的 `Map` 编成按键排序的 `[键, 值][]`，空的是 `[]`；`Set` 编成排序数组；
- 不输出钩子函数与整个 `ResolvedScenario`：`toWire` 遇到函数抛错，`envelope` 只放 `identity`，不放 `resolved`。

另给 `fromWire`，用于测试里的往返与 DD-10 的快照恢复。它**按 schema 解码**：没有标记的 `[]` 分不出数组、`Map`、`Set`，`'inf'` 也可能是普通文本，所以每种对外类型配一份解码描述（哪些字段是 `Map` 或 `Set`、哪些数值字段允许 `'inf'`、`'unknown'`、`'zeroDuration'`），不设计通用的带标签格式（Codex 的非阻塞意见）。

### 10.3 命令行

`src/cli/query.ts`，`package.json` 加脚本 `query`。输出一律是一份 `QueryEnvelope` 的 JSON，写到标准输出，或 `--out <文件>`。

```bash
pnpm query <场景> run                                   # 完成状态、身份、汇总的要点、strictReport、ruleUsage
pnpm query <场景> state --frame 1234
pnpm query <场景> state --frames 0,600,1200
pnpm query <场景> terminal
pnpm query <场景> events --seq 100..160
pnpm query <场景> events --window 0..3600               # 战斗帧 [lo, hi)
pnpm query <场景> explain --seq 2310
pnpm query <场景> command --loop 2 --line 6 --item 2 [--evaluation 57]
pnpm query <场景> why-not --seq 2310 --kind buff --owner 散华 --id <buff 定义 ID>
pnpm query <场景> would --frame 3000 --event '<JSON>' --kind buff --owner 散华 --id <ID>
pnpm query <场景> ledger [--totals] [--from 0 --to 3600]
pnpm query <场景> diff <另一个场景> --target metrics|commands|events
```

- 公共参数：`--strict` / `--no-strict`、`--rule <路径>=<值>`（可重复）、`--option <键>=<值>`、`--seed`、`--continue-after-intent-unmet`。它们都进 `RunOverrides`。
- `diff` 另有（2026-11-17 补上，合入后审查）：`--cmd <轮>:<条>.<项>`（`--target events` 只比这条指令引出的事件）、`--mapping <轮>:<条>.<项>=<轮>:<条>.<项>`（可重复，改轴时两边指令的对应，即 `commandMapping`）、`--cand-fill <组合名>`（对比场景的填法组合，DD-09 §3.1）。空的对应表当作没给。
- 每个子命令尽量只跑一次：查询函数复用这一次运行（`statesAndResult`、`terminalStateOf`、`explainEvent` 与 `commandCheck` 的 `res`），信封的完成状态就取它；只有 `why-not`、`would` 另跑一次。能力说明用 §10.1 的固定字符串（`run` 的是 `run`，`events` 的是 `diag.eventMeta`，`ledger` 的是 `diag.resourceLedger`、`ledger.closure`、`ledger.totals`），伤害口径的两项由 `envelope()` 自己补（DD-02 §3.7）。
- 退出码：查询本身出错（参数错、`QueryError`）是 2；运行是 `engineError` 时照样输出信封，退出码 1；其余 0。`axisFailed`、`truncated` 是有效结果，退出码 0，状态在信封里。
- 命令行负责采集 `RunEnvironment`（DD-01 的 `run-env.ts`）。

## 11. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T07-1 | `settleQueue` 进 `Kernel` | `kernel.ts` 与 5 处调用、测试台 | conformance 逐字节不变；C07-1 |
| T07-2 | `diffRuns` 的 `metrics`（阶段一先要） | `query.ts`，用 `basis.ts`（DD-03 §7.1） | C07-20；分层测试通过 |
| T07-3 | `replayTo`（`ReplayPrefix` / `ReplayComplete`，停止点用 DD-05 的边界观察点）、`viewOf`、`stateAt` / `statesAt` / `terminalState`、事件查询 | `run.ts`、`query.ts` | C07-2～C07-6、C07-25；成本数字；零干扰测试加上 `stateAt` 抽样 |
| T07-4 | `wire.ts` 与往返 | `wire.ts`、`tests/wire-json.test.ts` | C07-22、C07-23 |
| T07-5 | 纯检查函数；`ReadonlyHookContext` 与三个只读钩子的签名迁移；深冻结投影；诊断 `commandVerdicts` 与 `afterEvaluate` | `probe.ts`、`types.ts`、`scheduler.ts`、`diagnostics.ts`、角色模块（只改类型） | C07-7～C07-9、C07-26、C07-27 |
| T07-6 | `commandCheck` | `query.ts`、`scheduler.ts`（`afterEvaluate`） | C07-10～C07-12、C07-28 |
| T07-7 | `explainFiring`、`diag.triggerChecks`（含提前跳过的分支）、两个触发查询 | `probe.ts`、`triggers.ts`、`query.ts` | C07-13～C07-15、C07-29 |
| T07-8 | `diag.hitInputs`、`diag.hitMargins`、`explainEvent` | `simulate.ts` 的 `settle`、`buffs.ts` 的 `activeFor`、`formula.ts` 的 `ActiveBuff`、`query.ts` | C07-16～C07-19 |
| T07-9 | `diffRuns` 的对应与缺失判定、`commands`、`events` | `query.ts` | C07-21、C07-30、C07-31 |
| T07-10 | 命令行 | `src/cli/query.ts` | C07-24；§13 的集成清单 |

T07-5 的插桩与 T07-7、T07-8 的记录都走 DD-05 的收集器，每步之后零干扰对拍照跑。

## 12. 用例

`tests/state-query.test.ts`（合成角色与测试台）、`tests/wire-json.test.ts`。

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C07-1 | 在一次运行的 `onHit` 回调里再跑一次完整的运行 | 外层的日志与不嵌套时逐条相同（基线上这条会失败：内层的判定进了外层的队列） |
| C07-2 | 合成轴 300 帧。一次重放用 `boundaries` 取每一帧的 `StateView`；再对抽样的 20 个帧各调一次 `stateAt` | 对应帧的视图逐字段相等；`prefix.eventEndExclusive === handledEndExclusive` |
| C07-3 | DD-05 的 C05-1（冷却 60 帧） | `stateAt(59)` 里冷却剩 1；`stateAt(60)` 里是 0；第二个 `actionStart` 的 `f === 60`（架构 §3.5 第 1 条） |
| C07-4 | DD-01 的 C01-9（1 帧动作） | `stateAt(completedTicks)` 的动作还在（`ended === false`）；`terminalState` 里已结束，核心资源多 1，`kind === 'afterPostDrain'`；两者的 `prefix` 不同 |
| C07-5 | DD-01 的 C01-11（截断，等待段没关） | `stateAt(N)` 的 `queue.seg` 不为空；`terminalState` 的为空，`kind === 'afterFailClose'`，`handledEndExclusive === eventEndExclusive − 1` |
| C07-6 | `stateAt(completedTicks + 1)`；初始化失败的场景上 `stateAt(0)`；`eventsBySeq` 越界 | `outOfRange`（带 `completedTicks`）；`noLegalState`；`eventOutOfRange` |
| C07-7 | 查询前后的状态：对一个重放实例依次调 `explainAct`、`explainSwitch`、`explainFiring` 各若干次 | 实例的 `lastTrigger`、`assumed`、`queue`（全部字段）、`rng`、各角色的 `vars`、`nextId`、日志长度都没变（架构 §13.2） |
| C07-8 | 一个 `canStart` 里调 `ctx.addBuff` 的合成钩子 | `hook.canStart` 的状态是 `unmodeled`，说明里有"不支持只读求值"；没有 buff 被加上 |
| C07-9 | 带 `commandVerdicts` 跑三条合成轴（含 `!`、`+N`、等冷却、等资源、切人锁、变奏等出手、操作延迟 6）与一条真实轴（有数据时） | 每一次真实求值之后的检查点：`firstBlocking` 对应的代码等于这次 `verdict` 的代码；`verdict` 是放行时，`firstBlocking` 为 null 或 `introReady` |
| C07-10 | 轴：`甲 E`、`甲 E`（冷却 60）。查第二条 | `outcome: 'executed'`；`firstAtHeadFrame` 小于 `executedAtFrame`；`waits` 有一段 `cooldown`；指定第一次求值时 `firstBlocking === 'cooldown'`；`settled` 等后面的条件带 `speculative: true` |
| C07-11 | 同一个动作名，带 `!` 与不带；带 `+10` 与不带 | `context.force`、`context.delay` 各如所写；`settled` 一项在带 `!` 时是 `notApplicable`；执行帧不同且与日志一致 |
| C07-12 | 一条被 `?` 跳过的指令；一条在 `axisFailed` 之后的指令；失败的那一条；用 `evaluationIndex` 指向另一条指令的一次求值 | 依次 `skipped`（带 `skip`）、`notReached`（`notReachedBecause.status === 'axisFailed'`）、`failedHere`、报错（那次求值不属于这条指令） |
| C07-13 | 带 `triggerChecks` 跑：一个有内置冷却 60 帧的 buff，两次触发事件隔 30 帧 | 第二次：`outcome === 'checkedNotFired'`，`icd` 一项 `unmet`、`actual` 里有"还剩 30"，其余条件 `met`；与日志一致（第二次没有 `buffApply`） |
| C07-14 | 同一条事件上，排在前面的处理器先消耗掉了目标要求的 `ownerHas` 那个 buff | 目标的 `where.ownerHas` 是 `unmet`：证明用的是"轮到它那一刻"的状态，不是事件发生前的 |
| C07-15 | `charHook` 目标；假想事件 | 前者 `unsupported`；后者 `hypothetical === true`，且重放实例的 `lastTrigger` 没变 |
| C07-16 | 一下伤害吃到甲、乙各给的同名 buff；另有五例：只有钩子直接补的乘区、只有暴击专属的加成、倍率关联生命而不是攻击、谐度破坏、震谐响应（DF-15） | 第一例 `buffs` 有两条，`owner` 与 `instanceId` 不同；每一例用 `hitInputs` 的 `ctx`、`acc` 与身份里的 `rules` 重新调对应的公式（`computeHit` 或 `computeTuneBreak`），三个数都等于 `output` |
| C07-17 | 钩子在 `onEvent` 里生成的判定命中后给资源 | `directCauses` 依次是 `judgmentSpawn` → 触发它的事件 → … → 指令；`resourceEntries` 是这一下的账本条目；`businessRoot` 与父链顶端在这个夹具里不同 |
| C07-18 | 异常效应定时结算的那条 `hit` | `hitInputs` 省略；信封的 `unsupported` 里有对应的字符串；`directCauses` 的顶端是 `timer`（`effectTick`） |
| C07-19 | 一个 buff 在命中前 18 战斗帧到期；另一个在命中前 5 帧因切人被移除；第三个在命中后 10 帧才挂上 | 三条分别是 `left`（`leftBattleFramesAgo === 18`、`timeout`）、`left`（`switchOut`）、`appliedLater`；都带 `hint_only` |
| C07-20 | 同一条合成轴翻一个开关，各跑一次；其中一次改成被截断 | `metrics` 给出各轮帧数与差；截断的那次 `comparable === false` 并有原因 |
| C07-21 | 同一条轴翻开关，让某条指令晚 6 帧；另一组：删掉轴里第一个 `A` | 第一组：那条指令 `matched`、`delta.worldFrames === 6`，`firstDivergence` 指向它；第二组没有对应表时，剩下的 `A` 全是 `ambiguous`，给了 `commandMapping` 后是 `matched` |
| C07-22 | `toWire` / `fromWire` 往返：空 `Map`、非空 `Map`、`cap: Infinity` 的账本条目、`'unknown'`、`'zeroDuration'`、普通数值、省略的字段 | 往返后语义逐字段相等；空 `Map` 是 `[]` 不是 `{}`；省略的字段往返后仍然没有 |
| C07-23 | `toWire` 一个带函数的对象；`envelope` 的输出 | 前者抛错；后者没有 `resolved`、没有函数，`JSON.stringify` 后能 `JSON.parse` |
| C07-24 | 把一次运行的 `EventHandle` 拿给另一个 `PreparedRun` 的 `explainEvent`、`whyDidEventNotTrigger`；`diffRuns` 的 b 侧结果与它的 `PreparedRun` 不配 | 都是 `runIdMismatch` |
| C07-25 | DF-10：`f = 0`；恰好 `f = maxFrames`（指令没发完、已发完两支）；自然结束的边界；失败收尾会改资源的钩子 | 各自取得边界视图，且与终态的前缀分得开；`ProbeStop` 没有变成 `engineError`；`ReplayPrefix` 没有完成状态 |
| C07-26 | DF-13：违规的 `canStart` 分别直接改 `state.chars[0].energy`、改嵌套的 `vars`、对 `state.buffs` 做 `push` | 三种都是 `unmodeled`，`actual` 是"只读求值失败"并保留原错误（不说成"尝试写状态"，那是 C07-8 调写方法的情形）；同一次查询里后面的条件看到的状态与查询前相同 |
| C07-27 | DF-11：同一帧先自动插队、再对原指令求值；首次遇到 `+10`；抽样模式首次取到操作延迟 | 每一种都有两次（或一次）可区分的 `evaluate` 记录；检查点上的解释、真实 `verdict`、执行时刻三者一致；查询前后 RNG 状态没变 |
| C07-28 | DF-11：末条分别是 `wait 0`、`wait 30`、`at 3`、静默同步，运行完全成功 | `commandCheck` 都是 `executed`，执行帧来自 `execute` 记录，不是 `notReached` |
| C07-29 | DF-12：没有触发点的事件（异常效应伤害）；没有实例时的延长与消耗；前面的处理器先消耗掉了实例；前面的处理器抛错；失败收尾留下的未处理 `wait` | 依次 `notEntered`（`noOccurrence`）、`notEntered`（`noInstance`）、`checkedNotFired` 或 `notEntered`（按真实情况）、`handlerNotRun`（`earlierHandlerThrew`）、`handlerNotRun`（`failCloseUnhandled`）；后两种都不是 `checkedNotFired` |
| C07-30 | DF-14：双方都执行了指令 A，A 留下第 60 帧才结算的判定，一方在第 30 帧截断；另一组删掉第一行、不给映射，比 `commands` | 第 60 帧那一下是 `unanalyzed`；`firstDivergence` 不指向它；删行那组的指令全是 `ambiguous` |
| C07-31 | DF-14 第二轮：同一条轴只有一个 1 帧的动作，基准操作延迟 0、对照 6，两边都自然结束；同一次运行与自己比较；同一条轴的两次完整运行里，对照确实少了一条派生事件 | 第一例起手与结束都 `matched`、`delta.worldFrames === 6`，`firstDivergence` 指向起手；第二例全部 `matched`、差 0、没有分歧，终态那一帧的事件也在对应里；第三例那条事件是 `addedOrRemoved` |

## 13. 阶段二的集成验收（代表轴）

在 `m0-video-eq-不打谐破.yaml` 上（它还没就绪时先用 `m0-video-eq.yaml`，就绪后重做一遍）。每项用 `pnpm query` 跑，输出存到 `out/query/`：

- [x] **状态**：`state --frames` 取 5 个帧，与同一次 `boundaries` 重放的视图相同；每个帧的账本闭合（DD-06）。
- [x] **资源**：`ledger --totals` 给出三人每轮的能量与协奏两个口径；散华"切维里奈时协奏 76、在后台满 100"能从账本条目里逐笔读出来。
- [x] **切人**：对循环轴里两处 `switch 椿 变奏` 调 `command`，得到等待（如有）与逐条件结果；对散华切维里奈那一处，`explain` 那条 `switch` 事件，父链回到指令。
- [x] **冷却**：对"椿 E1"调 `command`，`waits` 里有 `cooldown`，与 DD-04 报告里 `observedWaits` 的同一条一致。
- [x] **buff**：挑一下吃到散华延奏的伤害 `explain`，`hitInputs.buffs` 里有它且带提供者；挑一下没吃到的，`windowMargins` 给出差几帧与离开原因；对"为什么这次没触发轻云出月"类的问题调一次 `why-not`。
- [x] **比较**：`diff` 基准与一个候选（DD-04 报告里让轮长变了的那个：`--cand-rule echoInputPriority=false`），`commands` 给出第一条变了的指令（`0:5:5`）。
- [x] **零干扰**：conformance 的对拍通过；上面每个查询前后，再跑一次不带诊断的运行，`runId` 与日志摘要不变。
- [x] 每份输出都有信封，`unsupported` 如实列出。

这对应路线图 §9.3 的"第一份可解释运行"：支持字段的 `stateAt`、收支对平、直接父来源、最小的命令行 JSON。全量事件的解释、所有条件的逐项试算，在此之后逐步补。

## 14. 验收清单

- [x] `tests/state-query.test.ts`、`tests/wire-json.test.ts` 全过。
- [x] `stateAt` 与直接执行一致（C07-2）；查询没有副作用（C07-7）；`commandCheck` 与真实执行一致（C07-9），含 `!` 与 `+N`（C07-11）。
- [x] 三种状态分得开（C07-3～C07-5）。
- [x] `src/engine/` 没有模块级的可变状态：`grep -n "^let " src/engine/*.ts` 的结果逐条说明（预期为空）。
- [x] §13 的集成清单全部完成，输出存档（`out/query/`）。
- [x] 查询成本的实测数字已记录（§3.5）。
- [x] `pnpm fuzz`、conformance（含零干扰对拍）通过。

## 15. 要同步的正式文档

- TD-04 §1：`stateAt` 与 `S[0]` 的边界、三种状态、`[from, to)`。
- TD-02：`StateView`、`QueryEnvelope`、`CapabilityDisclosure`、`CommandCheck`、`TriggerCheck`、`EventExplanation`、`RunDiff`、`ActiveBuff` 的新字段。
- TD-07：触发检查的只读版本、`buffWindowMargin`。
- TD-09 §3.2：检查顺序表（§4.2 的两张表就是它的结构化版本）。
- TD-11 §6：`pnpm query`。
- AGENTS.md：命令表加 `pnpm query`。

## 16. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD07-Q1 | 试算会话怎么实现 | A：每次查询重放出一个独立实例；B：克隆正在运行的 `Sim` 与状态 | A。第一版本来就靠重算，重放出来的实例天然隔离；B 要解决钩子上下文绑定在 `Sim` 上的问题，留到做快照时（DD-10）一起做 |
| DD07-Q2 | 纯检查函数与真实的 `evaluate` 是两份代码，怎么防止走样 | A：两份代码加一致性用例（C07-9）；B：把 `evaluate` 重构成"先列条件、再取第一个不满足的" | A。B 更干净，但要改动调度器的主路径，风险与收益不相称；一致性用例覆盖全部现有场景后再考虑 B |
| DD07-Q3 | `gate` 的四项要不要逐项试算 | 第一版不拆；现在就拆 `gateRules` | 不拆。`gate` 报的那一项已经是真实的挡住原因 |
| DD07-Q4 | `StateView` 要不要带定义的内容（动作的总帧数、判定的倍率） | 只带标识；带常用的几项 | 只带标识。定义在装配结果里，按标识能查；带进来会让状态比较混入不属于状态的东西 |
| DD07-Q5 | 窗口余量的回看与前看范围 | 各 120 战斗帧；可配置 | 缺省 120，`explainEvent` 的选项里可改 |
| DD07-Q6 | 命令的名字与形状 | 一个 `pnpm query` 加子命令；每种查询一个命令 | 一个命令。agent 只要记一个入口，输出的信封也统一 |
