# DD-05 事件来源、诊断旁路、规则使用与零干扰

**版本**：v0.2，2026-11-14，Claude。按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10；本文涉及 DF-06、DF-10、DF-23 与 S-04 的条件）。
**状态**：Final（2026-11-15）。本文 v0.2 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。**已实现（2026-11-16）**：T05-1～T05-8，验收清单见 §9；实施中与正文对不上、按代码改了正文的几处记在 §12。
**阶段**：二。**前置**：DD-01。**被依赖**：DD-06、DD-07。

## 1. 范围与依据

做（路线图 §4.1、§4.2、§4.4；架构 §3.3、§3.5、§4）：
- **诊断收集器**：一个只写不读的旁路，引擎的业务逻辑不看它。
- **事件的直接来源** `diag.eventMeta`，以及延迟实体（判定、尾部）的来源。
- **规则使用**：必有的摘要 `ruleUsage`，可选的逐次明细 `diag.ruleTrace`。
- **零干扰检查** `tests/zero-interference.test.ts`，并接进 `pnpm conformance`。
- **相位边界用例** `tests/phase-boundary.test.ts`。
- 让 `trace.ts` 用记录下来的来源，不再按日志邻近关系猜（R02）。

不做：
- 资源账本（DD-06）；它用本文的收集器。
- 伤害输入、触发检查、窗口余量的记录（DD-07 §6–§8）；它们也用本文的收集器。
- 改 `bus.spawned`、`bus.chain`、`Link.root` 的寿命或含义。它们参与 `chainDepth` 的判断，是业务（架构 §3.3）。

## 2. 现状

| 事实 | 位置 |
|---|---|
| 全引擎写日志只有一个入口 `log(s, ev)`，它只拿到 `SimState` | `kernel.ts` |
| `drain` 处理第 `i` 条事件时，把这期间新写的事件登记为 `{ depth + 1, root }`；`bus.current` 处理完就清空 | `triggers.ts` |
| `handle` 的顺序：消耗 → buff 触发 → buff 延长 → 资源型效果 → 三个角色的 `onEvent` | 同上 |
| 调度器拿到的是 `k: Kernel`，没有 `Sim`；`buffs.ts`、`enemyTimers` 的函数只拿到 `s` | `scheduler.ts`、`buffs.ts`、`enemy.ts` |
| 判定生成都经 `spawnJudgment(s, …)`，它写一条 `judgmentSpawn` 事件（带判定 `id`） | `kernel.ts` |
| 尾部的 4 个生成点：`startAction`（后台动作开始时留下的）、`endAction`（自然结束）、`cancelAction`（取消）、`outroTrigger`（延奏） | `kernel.ts`、`switch.ts` |
| 自然结束与取消产生的尾部沿用动作的 `instance`；后台与延奏的用新的 `s.nextId++` | 同上 |
| `tickBuffs(s, rates)` 在一次调用里让同一帧到期的 buff 依次 `removeBuff`，各写一条 `buffExpire` | `buffs.ts` |
| `trace.ts` 的 `walkOwners` 按日志里的先后推"谁引出的" | `trace.ts` |
| `assume(s, id, detail)` 写 `s.assumed`；49 处调用，引擎 20 处、13 个角色模块 20 处、`simulate.ts` 另有钩子上下文里的两处转发 | `grep "assume("` |
| 读规则的地方直接写 `k.rules.x`、`sim.r.rules.x`、`ctx.rules.x`，没有统一的记录点 | 各文件 |

## 3. 诊断收集器

### 3.1 形态

`src/engine/diagnostics.ts`（新，①D）。一个类，一次运行一个实例；诊断全关时不创建。

```ts
export interface DiagOptions {
  readonly eventMeta?: boolean
  readonly resourceLedger?: boolean       // DD-06
  readonly ruleTrace?: boolean
  readonly hitInputs?: boolean            // DD-07
  readonly hitMargins?: boolean           // DD-07
  readonly triggerChecks?: readonly TriggerTarget[]   // DD-07 §6
  readonly commandVerdicts?: boolean      // DD-07 §4.4：调度器每次真实求值的记录
}

export interface Diagnostics {
  readonly eventMeta?: readonly EventMeta[]              // 与日志下标一一对应
  readonly entityOrigins?: { readonly judgments: readonly EntityOrigin[]; readonly tails: readonly EntityOrigin[] }
  readonly resourceLedger?: readonly ResourceLedgerEntry[]
  readonly ledgerMarks?: LedgerMarks
  readonly ruleTrace?: readonly RuleTraceEntry[]
  readonly hitInputs?: …; readonly hitMargins?: …; readonly triggerChecks?: …
}

export class DiagSink { /* 下面各节的方法；只有追加，没有任何读回给引擎的方法 */ }
```

**怎么够得着**：`Kernel` 加 `diag: DiagSink | null`（`Sim` 经 `sim.k.diag` 拿）。只拿到 `s` 的少数函数（`tickBuffs`、`endDueActions` → `endAction`）加一个可选的末位参数把它传进去。不用模块级的表按 `SimState` 找收集器：那是隐藏的全局状态，也不好移植。

**写法约束**（零干扰靠它们保证，代码评审时逐条看）：
1. 插桩处一律写成 `k.diag?.方法(…)`，返回值不参与任何业务判断。
2. 传给收集器的实参里不调用有副作用的函数。要读的值先由业务代码算好，或者只调纯函数。
3. 收集器不拿 `SimState` 的可写引用去改；需要快照的值当场拷贝成数字或字符串。
4. 收集器不消耗 `s.nextId`、不碰 `s.rng`、不写 `s.assumed`、不写日志。
5. 诊断开着时不多调任何钩子，也不改变调用钩子的次数与顺序。

### 3.2 事件的直接来源

类型照架构 §3.3 的 `OriginContext`、`EventMeta`，补两种来源（总览 §6 的 S-05）：

```ts
| { kind: 'finalization'; step: 'failClose' | 'maxFramesWarning' }   // 循环退出时写的 wait、帧数上限的警告
| { kind: 'unattributed' }                                           // 没有落在任何作用域里的事件；出现了就是插桩有漏
```

**不改 `log()`，用作用域回填。** 收集器维护一个作用域栈。作用域打开时记下当时的日志长度，关闭时把这期间新写的、还没有来源的事件都标成这个作用域的来源。内层先关，所以内层的事件归内层，外层只补剩下的。

```ts
open(origin: OriginContext, logLength: number): number          // 返回作用域号
close(scope: number, logLength: number, phase: Phase): void     // 回填 [打开时的长度, logLength) 里还没标的
finish(logLength: number): void                                 // 运行结束：把没关的作用域按从内到外关掉，剩下没标的记 unattributed
```

调用处成对出现：

```ts
const sc = k.diag?.open({ kind: 'judgmentSettle', judgmentId: j.id }, s.log.length)
k.hooks.settle(s, j, n)
if (sc !== undefined) k.diag!.close(sc, s.log.length, k.at.phase)
```

- 不用 `try / finally`：抛错时作用域留着，`finish` 统一收尾。这样抛错路径上诊断开关两侧的控制流完全一样。
- `phase` 取 `k.at.phase`（DD-01 §3.5），`'afterP7'` 与收尾阶段记成 `'post'`，初始化记 `'init'`。

作用域的位置（每个都是一对 `open` / `close`）：

| 来源 | 包住什么 | 在哪 |
|---|---|---|
| `init`（`sourceId: 'alwaysBuffs'`） | 挂常驻 buff 的循环 | `run.ts` 的运行体 |
| `init`（`sourceId: 'onResolve:<角色>'`） | 每个角色的 `onResolve` | 同上 |
| `command` | 调度器对队首指令的一轮处理。算出 `ref` 之后立刻打开，包住插队分支里的 `hold` / `closeSeg`、补位与可选的 `skip`、`evaluate`、`hold`、`execute`（含 `onSwitch`、`startAction`）。只包后半段的话，插队分支写出的 `wait` 会落成 `unattributed`（DF-06） | `scheduler.ts` 的 `createScheduler` 循环体 |
| `autoInterject` | 插队动作的 `startAction`，嵌在 `command` 作用域里面 | 同上，`ij` 分支 |
| `actionLifecycle` | `endAction` 写 `actionEnd` 与生成尾部 | `kernel.ts` 的 `endDueActions`（加参数 `k`） |
| `actionLifecycle`（实施时加，§12 第 1 条） | `startAction` 里的 `hooks.actionStarted`：扣大招能量、施放资源与它们的 `resourceFull` | `kernel.ts` 的 `startAction` |
| `actionLifecycle`（实施时加，§12 第 1 条，`actionInstance` 是延奏尾部的实例号） | 延奏动作开始时的施放资源 | `switch.ts` 的 `outroTrigger` |
| `timeline` | 每个时间线节点的 `fireEvent`（资源、膨胀、生成判定、延奏） | `kernel.ts` 的 `advanceActions` 里调 `fireEvent` 处；`nodeIndex` 是节点在 `timelineOf(def)` 里的下标，尾部的带 `detached` |
| `judgmentSettle` | 每次 `hooks.settle` | `kernel.ts` 的 `settleJudgments` |
| `judgmentExpire` | 每次 `hooks.expired` | 同上 |
| `timer`（`effectTick`） | `effectTicks` 里每个效应的一次结算 | `enemy.ts` |
| `timer`（`enemy`） | `enemyTimers` 里每个到点的计时器 | `enemy.ts`（加可选参数） |
| `timer`（`buff`，带 `id`、`defId`） | `tickBuffs` 里**每一个**到期 buff 的 `removeBuff` | `buffs.ts`（加可选参数） |
| `trigger`（`consume`） | `consume` 里每个被消耗的实例 | `triggers.ts` |
| `trigger`（`buffTrigger`、`buffExtend`、`resourceEffect`） | `handle` 里每个登记项的一次 `firing` 成功后的施加 | 同上；`handlerId` 是定义 ID |
| `trigger`（`charHook`） | 每个角色的一次 `onEvent` | 同上；`handlerId` 是角色名 |
| `finalization` | `fail()` 里的 `closeSeg`；`runLoop` 写帧数上限警告 | `scheduler.ts` |

- `trigger` 的 `directParentSeq` 是 `drain` 正在处理的下标 `i`。`handle` 加一个参数把 `i` 传进去。
- 钩子在 `onEvent` 里调 `ctx.addResource`、`ctx.spawnJudgment` 等写的事件，落在 `charHook` 的作用域里。钩子在 `modifyHit` 里写的落在 `judgmentSettle` 里。
- `command` 的作用域里嵌着 `onSwitch → drain`，`drain` 里的事件先被各自的 `trigger` 作用域标掉，`command` 只补直接由指令写的（`switch`、`actionStart`、`wait`、`skip`、`loop`）。

**同帧多个到期不再串**（R02）：每个 buff 的 `removeBuff` 有自己的 `timer` 作用域，带各自的实例号；随后 `drain` 处理每条 `buffExpire` 时，引出的事件各自带 `directParentSeq` 指向那一条。队列交错（E1、E2 先后入队，E1 引出的事件写在 E2 之后）也一样：来源在处理 E1 时就标了，不看位置。

### 3.3 两种关系：谁直接引出了它，它说的是哪个实体（DF-06）

`EventMeta` 在架构的 `phase`、`origin`、`directParentSeq` 之外加一个 `subjectSeq`（总览 §6 的 S-12）：

```ts
export interface EventMeta {              // diag.eventMeta[seq]，与日志下标一一对应
  readonly phase: Phase
  readonly origin: OriginContext          // 写它的那个作用域：谁发起的
  readonly directParentSeq?: number       // 直接引出它的那条事件（因果）
  readonly subjectSeq?: number            // 它说的那个实体（动作实例、判定、buff 实例、尾部）是哪条事件创建的
}
```

`actionCancel` 说明了为什么要两个字段：指令 B 开始新动作，取消了指令 A 留下的旧动作。"谁让它取消的"是 B，记在 `origin`（B 的 `command` 作用域）；"取消的是哪个动作"是 A 的那个实例，记在 `subjectSeq`（指向 A 的 `actionStart`）。只留一条父链，总会丢掉其中一个。

| 事件 | `directParentSeq` | `subjectSeq` |
|---|---|---|
| `trigger` 作用域里写的 | 正在处理的那条事件（`drain` 的下标 `i`） | 视事件种类，同下 |
| `onSwitch` 写完 `switch` 之后直接写的：切出者 buff 的 `buffExpire`、`actionCancel`、挂起 buff 的 `buffApply`、变奏动作的 `actionStart`、`intro` | 那条 `switch` | 视事件种类，同下 |
| `actionEnd`、`actionCancel` | 没有（发起方在 `origin`） | 这个动作实例的 `actionStart` |
| `judgmentSettle`、`judgmentExpire` 作用域里写的（`hit` 等） | 没有 | 这个判定的 `judgmentSpawn` |
| `timeline` 作用域里写的（进行中的动作） | 没有 | 这个动作实例的 `actionStart` |
| `timeline` 作用域里写的（尾部） | 没有 | 尾部来源表里记的创建事件 |
| `timer`（`buff`）里的 `buffExpire` | 没有 | 这个实例的第一条 `buffApply` |
| 其余（`command`、`autoInterject`、`init`、`timer` 的其他种类、`finalization`、`unattributed`） | 没有 | 没有 |

- **`onSwitch` 那一行靠带父事件的作用域实现**：`onSwitch` 写完 `switch` 之后，打开一个同样是 `command` 来源、带 `parentSeq` 的内层作用域，`close` 时把这个父事件填给它回填的事件。收集器的 `open` 因此多一个可选参数 `parentSeq`。
- **实体映射**（动作实例 → `actionStart` 的下标、buff 实例 → 第一条 `buffApply`、判定 → `judgmentSpawn`）由 `finish` 扫一遍日志建立。`actionStart` 带 `instance`、`judgmentSpawn` 带 `id`、`buffApply` 带 `instanceId`（DD-03 §5）。所以 DD-03 的 T03-3 要先于本工作包交付（README §2）。

**实体来源表**：

```ts
export interface EntityOrigin {
  readonly id: number                  // 判定是 JudgmentRuntime.id；尾部是 TailRuntime.instance
  readonly createdAtFrame: Frame
  readonly createdBySeq: number | null // 生成它的那条事件，必须是已经写出的
  readonly origin: OriginContext       // 生成那一刻所在的作用域
}
```

- **判定**：`spawnJudgment` 总会写 `judgmentSpawn`，`createdBySeq` 就是它的下标，`finish` 扫一遍日志建表，不用在 4 个生成点各自插桩。T05-3 先核对"每个判定都有 `judgmentSpawn`"在基线上成立（C05-6 也断言）。
- **尾部**：没有专门的事件，在 4 个生成点显式登记 `k.diag?.tailCreated(instance, createdBySeq, frame)`：
  - 自然结束：那条 `actionEnd`；
  - 取消：那条 `actionCancel`；
  - 召唤类声骸开始时留下的：基线的 `startAction` 在写 `actionStart` **之前**就推入了这条尾部，所以登记要挪到写完 `actionStart` 之后，`createdBySeq` 是那条 `actionStart`（DF-06）；
  - 延奏：那条 `outro`（它也在尾部创建之后才写，登记放在写完 `outro` 之后）。
- 表在诊断里跨 tick 保留，运行时的 `JudgmentRuntime`、`TailRuntime` 不加字段。

**解释时两种关系都给**：`explainEvent`（DD-07 §7）的 `directCauses` 有 `directParentSeq` 就沿它，没有就沿 `subjectSeq`，每一步标明走的是哪种关系；这条事件自己的 `origin` 另外单列。C05-7 那种取消的例子，被取消的 A 与发起取消的 B 因此都查得到。这不是通用的因果图，只是不丢掉已经记下的这两种关系。

**诊断的父链与业务的 `Link.root` 是两回事**。父链回答"哪条事件直接引出了它"；`Link.root` 回答"伤害与资源算在谁名下"。`explainEvent`（DD-07）两个都给，分开标。

### 3.4 让 `trace.ts` 用它

- `trace.ts` 里用到 `walkOwners` 的函数加一个参数 `meta?: readonly EventMeta[]`：给了就沿 `directParentSeq` 找来源；没给时保留旧算法，并在返回里标 `ownersInferred: true`。
- `src/cli/trace.ts`、时间轴模型（`src/report/`）的调用方改成带 `diag: { eventMeta: true }` 运行。
- 旧算法在所有调用方迁完后删掉（T05-8）。

## 4. 规则使用

### 4.1 判定点登记表

`src/engine/rule-points.ts`（新，②，纯数据）：

```ts
export interface RulePoint {
  readonly id: string                    // 'sched.switch.switchEndsStop'
  readonly propositionId: PropositionId  // DD-04 的台账
  readonly symbol: string                // 'scheduler.ts evaluate/switch'
  readonly decisiveWhen: string          // 一句话：什么局部状态下它决定分支
}
export const RULE_POINTS = [ … ] as const satisfies readonly RulePoint[]
export type RulePointId = (typeof RULE_POINTS)[number]['id']
```

`RuleUsageReport.coverage` 就是这张表。没登记的读取是"未插桩"，不是 0 次。

首版的表。来源是把 49 处 `assume()` 逐个归成三类（碰到假设 / 读规则 / 决定分支），再加上现在没有 `assume()`、但直接读可翻规则的地方：

| 判定点 | 命题 | 位置 | 什么时候算"决定了分支" |
|---|---|---|---|
| `sched.switch.switchEndsStop` | `switch-ends-stop` | `evaluate` 的切人分支，算 `early` 处 | 有写明的切人锁、锁比全局时停早结束、局部帧已过锁但没过时停 |
| `sched.execute.switchEndsStop` | 同上 | `execute` 清时停处 | 切出者还有没走完的时停窗口 |
| `sched.switch.ultInputLock` | `ult-input-locks-switch` | `evaluate`，算 `off` 处 | 当前动作的锁来自"不响应输入"，局部帧还在锁内 |
| `sched.switch.invincibleLock` | `invincible-locks-switch` | 同上 | 当前动作的锁来自无敌推断，局部帧还在锁内 |
| `sched.act.echoInputPriority` | `echo-input-priority` | `evaluateAct` 调 `gate` 处 | `gate(ch, def, true)` 与 `gate(ch, def, false)` 的结果不同（`gate` 是纯函数，多算一次没有副作用） |
| `sched.input.delay` | `input-delay` | `afterInput` | 这条指令的延迟大于 0 |
| `sched.interject.tuneBreak` | `tune-break-mode` | `interject` 返回非空处 | 插入了一次自动谐破 |
| `kernel.dilation.hitstopInGlobalStop` | `hitstop-in-global-stop` | `registerDilation` | 战斗时钟正被全局时停停住，且登记的是作用在角色侧的攻击顿帧 |
| `formula.defFloor` | `def-floor` | `formula.ts` 用 `rules.defFloor` 处 | 减防后的防御不是整数 |
| `enemy.effectTick.reset` | `effect-tick-timer` | `applyEffect` 里处理计时处 | 效应已在计时中又被附加 |
| `enemy.effectTick.owner` | `effect-owner` | `effectTicks` 选归属处 | 最后附加者、第一次附加者、当前前台三者不全相同 |
| `enemy.interferenceFrames` | `interference-frames` | 进入干涉处 | 每次进入干涉（数值型规则：用到就算） |
| `triggers.summonAsChar` | `summon-as-char` | `occurrencesOf` 的 `enemyState` 分支；`enemy.ts` 对应处 | 事件带 `summon` |
| `char.心.forteKeep` | `forte-keep.心-照世相` | 心的钩子，切出时 | 切出时有照世相或心相心生的状态可清 |
| `char.卜灵.forteKeep` | `forte-keep.卜灵-卦象` | 卜灵的钩子，切出时 | 切出时卦象不为空 |
| `char.爱弥斯.trackNoConsume` | `track-no-consume` | 爱弥斯的钩子 | 过载后第一次光翼共奏 |

**后补的两点（2026-11-17，合入后审查 Antigravity M4）**：首版之后又发现两处直接读可翻规则的地方，补进表里（共 18 个点）：

| 判定点 | 命题 | 位置 | 什么时候算"决定了分支" |
|---|---|---|---|
| `char.心.summonAsChar` | `summon-as-char` | 心的钩子，`enemyState` 的电磁效应附加处 | 事件带 `summon`、记了附加者（固有1、霆霓、霆心域换个读法就算 / 不算） |
| `res.concertoTiming.卜灵` | `buling-concerto-timing`（DD-08 回填的按角色命题） | `resources.ts` 的 `castResources`、`settleGains`（`concertoTimingOf` 处，施放者 / 出伤者是卜灵时） | 起手时：动作有由时间线生成、带协奏的判定；结算时：判定由时间线生成、带协奏 |

按角色的那一点只对台账里有按角色命题的角色记（`rule-points.ts` 的 `CONCERTO_TIMING_POINTS`，角色名放在台账这一层），别人读的是共享的 `concertoTiming`（2026-10-03 实测，不在台账）。有了这一点，DD-08 的 `rerun` 对这条命题按规则使用找受影响的场景，不再退回 `appliesToChars`。

其余的 `assume()` 调用点都是"碰到假设"：`wait-settled`、`data-guess`、`dilation-rules`、`summon-clock`、`later-damage`、`stat-scaling-static`、`forced-energy`、`forced-disharmony`、`enemy-swap`、`effect-burst`、`effect-settle-clear`、`resonance-rules`、`tunability-base`、`white-bar`、`module-guess`、`burst-release`，以及已被上表覆盖的那几个 ID 的原调用。它们照旧只调 `assume()`，不进判定点表。T05-5 把 49 处的逐个归类做成一张表贴进提交说明，作为这一节的核对记录。

### 4.2 记录函数

```ts
// Kernel 上：总是有，不随诊断开关变
export interface RuleRecorder { note(point: RulePointId, value: number | boolean | string, decisive: boolean): void }
export interface Kernel { …; rule: RuleRecorder }

// 钩子上下文：角色模块用
interface HookContext { …; noteRule(point: RulePointId, decisive: boolean): void }
```

- 调用处写成一行，放在读规则的那个判断旁边：
  ```ts
  k.rule.note('sched.switch.ultInputLock', k.rules.ultInputLocksSwitch, last.localFrame < lock)
  ```
- **摘要是必有的**：`RuleRecorder` 的实现在运行环境里按判定点累计 `readCount`、`decisiveCount`、`firstFrame`（战斗帧），运行结束时按命题汇总成 `RuleUsageReport.byProposition`。它不进 `SimState`。
- **逐次明细是可选的**：`diag.ruleTrace` 开着时，同一次 `note` 另外追加一条：
  ```ts
  export interface RuleTraceEntry {
    readonly point: RulePointId; readonly propositionId: string
    readonly f: Frame; readonly battleFrame: number; readonly phase: Phase
    readonly afterEventSeq: number            // 这一刻日志里最后一条的下标
    readonly value: number | boolean | string; readonly decisive: boolean
  }
  ```
- **调用次数的口径**：调度器对同一条指令每个 tick 都会重新求值，每求一次记一次读取。`readCount` 因此是"求值次数"，报告里这样标注；`decisiveCount` 同理。要"这条指令被它挡了几帧"时看 `ruleTrace` 或等待事件。
- **零干扰**：`note` 的第三个实参是业务代码本来就算出来的布尔值，或纯函数的结果（上表里的 `gate` 那一行）。不为了算 `decisive` 去调 `afterInput`、`firing`、`assume` 这类有副作用的函数。
- **`decisive` 的含义**写进 `RuleUsageReport` 的类型注释：在当时的局部状态下换成另一个已实现的候选值，这一处会走另一条分支。它不等于改变了结果（架构 §4.2）。

### 4.3 与 `assumptionsEncountered` 的关系

三种记录并存，同一套命题 ID 串起来：
- `summary.assumptions`（沿用）：碰到了哪条已登记的假设；
- `ruleUsage`（必有）：列明的判定点上读到、决定了哪条规则；
- `diag.ruleTrace`（可选）：逐次明细。

`CapabilityDisclosure`（DD-07）把前两个原样带出去，不合并成一个数。

## 5. 相位边界用例

`tests/phase-boundary.test.ts`，对应架构 §3.5。已有用例能覆盖的直接引用（T05-1 先在 `tests/td04.test.ts`、`td07.test.ts` 里找，有的话在新文件里注明出处，只补缺的断言）。

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C05-1 | 测试台：动作 `E` 冷却 60 战斗帧，没有时停。世界帧 0 放一次，之后的指令还是 `E` | 第二个 `actionStart` 在世界帧 60，不在 59。在第 59 帧 P2 时冷却剩 1（用 `diag.ruleTrace` 以外的方式看：等待段的结束帧是 60）。`stateAt` 的断言在 DD-07 的 C07-3 |
| C05-2 | 一个持续 30 战斗帧的 buff 在战斗帧 0 挂上（第 0 帧的 P6 就扣第一次，第 29 帧的 P6 到期）；两个判定分别在世界帧 29、30 结算（没有时停；DF-23） | 第 29 帧的 `hit` 的 `buffs` 里有它，第 30 帧的没有；第 29 帧的 `hit` 下标小于 `buffExpire`，两条的 `f` 都是 29；`eventMeta` 里 `hit` 的相位是 `P4`，`buffExpire` 是 `P6` |
| C05-3 | 两个 buff 甲、乙同一帧到期；各有一个"到期时"触发的钩子分支：甲到期给 1 点核心资源、乙到期给 1 点协奏 | 两条 `resource` 的 `directParentSeq` 分别指向各自的 `buffExpire`；两条 `buffExpire` 的来源是带不同实例号的 `timer`。用旧的 `walkOwners` 算，两条都会归到乙（断言新旧不同，证明用例确实打到了 R02） |
| C05-4 | 队列交错：一条事件 E1 的处理器写了 X1，同一帧稍后入队的 E2 的处理器写了 X2，而日志顺序是 E1、E2、X1、X2 | X1 的父是 E1，X2 的父是 E2 |

## 6. 零干扰检查

### 6.1 取状态的入口与边界观察点

零干扰要比完整状态；DD-06 的任意帧闭合、DD-07 的 `stateAt` 也要合法的帧边界。本文提供一个内部入口，三处共用（DF-10）：

```ts
// run.ts，只给 diagnostics / query 用
export interface BoundaryObserver {
  readonly frames: ReadonlySet<Frame>
  /** 到了 S[f]：s 是本体，只读；要留就自己拷贝（DD-07 的 viewOf）。返回 'stop' 就在这里停下 */
  onBoundary(f: Frame, s: SimState, prefix: StatePrefix, ledgerLength: number | null): void | 'stop'
}
export function runForInspection(p: PreparedRun, opts?: RunOptions & { observer?: BoundaryObserver }): {
  readonly result: SimResult | null          // 观察回调要求 stop 时为 null：停在中途得到的是前缀，不是一次运行的结果
  readonly stoppedAt: Frame | null
  readonly terminal: SimState                // 停下时的 SimState 本体，调用方不要改它
  readonly busCursor: number
}
```

边界观察点只在两类位置，都是架构 §5.2 定义的合法边界：
- **`S[0]`**：初始化（常驻 buff、`onResolve`、首次 `drain`）全部做完之后、第 0 帧 P1 之前；
- **`S[f + 1]`**：每次 `tick` 走完 P7、返回 true 之后，**在 `runLoop` 检查帧数上限之前**。基线的 `runLoop` 在 P7 之后马上判上限，然后失败收尾或记警告退出，不会回到循环开头；只在循环开头检查会错过 `S[maxFrames]`。`runLoop` 加一个可选参数 `afterTick?(s): 'stop' | void`，不给时一个分支都不多走。

回调要求停下时，用内部异常 `ProbeStop` 退出：它不经 `fail`，不做失败收尾，也不做收尾的 `drain`；`run.ts` 接住它，不交给 `buildCompletion`（DD-01 §3.6）。`ledgerLength` 在开了账本诊断时给出，就是这个边界的 `ledgerEndExclusive`（DD-06）。

### 6.2 比什么

`tests/zero-interference.test.ts`。对每个被测场景，诊断全关跑一次、全开跑一次：

| 比较对象 | 怎么比 |
|---|---|
| `result` 去掉 `diag` | `canonicalJson` 后逐字节相等。这包括日志、汇总、`forte`、`cooldowns`、`completion`（整份，没有豁免字段）、`interventions`、`strictReport`、`ruleUsage`、`runId` |
| `terminal` | 逐字段深比较。`SimState` 的全部字段：`frame`、`battleFrames`、`onField`、`chars`（含 `action`、`last`、`combo`、`switchCd`、`startedThisTick`、三种资源、`cooldowns`、`charges`、`vars`）、`judgments`、`tails`、`buffs`、`enemy`、`dilations`、`queue`（全部游标与等待字段）、`log`、`nextId`、`outroLinks`、`pendingNextIn`、`lastTrigger`、`assumed`、`rng`、`entry` |
| `busCursor` | 相等 |
| 报错行为 | 两侧的 `completion.status` 与 `engineError` 相同；兼容外壳两侧要么都抛、要么都不抛，抛的消息相同 |

DD-07 做完后再加一项：抽样若干世界帧（首、尾、三个中间点）的 `stateAt`，两侧逐字段相等。

**被测场景**：
- 合成的小场景，至少各含：同帧多个到期、钩子生成判定、延奏、取消留下尾部、截断（两种）、轴失败、钩子抛错；
- 抽样模式的一个场景（`sample: { seed: 7, jitter: 3 }`），专门看 `rng`；
- 同一个场景给一个什么都不做的 `onHit` 与不给，两侧比较（S-04 的条件，DD-01 §3.4）；
- 有 `data/generated` 时：`m0-video-eq.yaml`、`xin-team.yaml`、`xin-tower4-video.yaml`（用 `dataDescribe`，缺数据时跳过）。

**反向用例**（证明检查真的能抓到干扰）：测试里临时构造一个违规的收集器子类，在 `open` 里把 `s.nextId` 加 1，断言比较失败。

### 6.3 接进 conformance

`src/cli/conformance.ts` 加参数 `--zero-interference`（缺省开）：每个场景在写出样例之外，带全部诊断再跑一次，比较 §6.2 的前三行；不一致就打印第一个不同的路径并以非零退出。诊断本身不写进样例文件。

## 7. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T05-1 | 相位边界用例里不需要诊断的断言 | `tests/phase-boundary.test.ts` | C05-1；C05-2 的前三项 |
| T05-2 | 收集器骨架、`Kernel.diag`、`runForInspection` 与边界观察点（§6.1）、零干扰测试的框架（这时诊断是空的，两侧必然相等） | `diagnostics.ts`、`kernel.ts`、`run.ts`、`scheduler.ts`（`afterTick`）、`tests/zero-interference.test.ts` | 测试通过；反向用例能失败；C05-14 |
| T05-3 | 作用域插桩与 `eventMeta` | §3.2 表里的各文件 | C05-2、C05-3、C05-4、C05-5；零干扰通过 |
| T05-4 | 实体来源表、`directParentSeq` 与 `subjectSeq` | `diagnostics.ts`、`kernel.ts`、`switch.ts` | C05-6、C05-7、C05-12、C05-13 |
| T05-5 | 判定点表、`RuleRecorder`、`ruleUsage`、`ruleTrace`、`ctx.noteRule` | `rule-points.ts`、`kernel.ts`、`scheduler.ts`、`formula.ts`、`enemy.ts`、`triggers.ts`、`simulate.ts`、三个角色模块 | C05-8～C05-10；49 处调用的归类表在提交说明里 |
| T05-6 | conformance 的零干扰对拍 | `src/cli/conformance.ts` | 全部场景通过 |
| T05-7 | `trace.ts` 用 `eventMeta` | `trace.ts`、`src/cli/trace.ts`、`src/report/` | C05-11；`pnpm trace` 在现有场景上的输出逐个比较，有差别的行逐条确认是旧算法的错归 |
| T05-8 | 删掉旧的 `walkOwners` | `trace.ts` | 没有调用方；测试通过 |

每一步之后非诊断运行的 conformance 输出只允许一种变化：T05-5 之后 `ruleUsage` 有了内容。

## 8. 其余用例

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C05-5 | `m0-video-eq.yaml` 与一个合成场景，开 `eventMeta` | `eventMeta.length === log.length`；没有 `unattributed`；每种事件类型的来源种类在允许的集合里（如 `hit` 只能是 `judgmentSettle` 或 `timer`/`trigger`〔异常效应的伤害〕） |
| C05-6 | 同上 | 日志里每个 `hit`（非异常效应）的 `id` 都能在 `entityOrigins.judgments` 里找到，且那条的 `createdBySeq` 指向一条 `judgmentSpawn` |
| C05-7 | 合成：指令 B 的动作取消了指令 A 留下的动作，旧动作留下带一个判定的尾部；延奏动作的尾部生成一个判定 | 第一个 `hit` 沿 `subjectSeq` 回到 `judgmentSpawn` → 尾部的创建事件 `actionCancel` → A 的 `actionStart`（来源是指令 A），同时 `actionCancel` 的 `origin` 是指令 B：A、B 都查得到（DF-06）；第二个 `hit` 回到 `outro` → … → 切人指令 |
| C05-12 | DF-06：放一个召唤类声骸；另一条轴里自动谐破先等待、随后放出 | 召唤尾部的 `createdBySeq` 指向它自己的 `actionStart`（不是更早的事件）；插队分支写出的 `wait` 的来源是 `command`，不是 `unattributed` |
| C05-13 | DF-06：变奏切人，切出者有切走即移除的 buff，切入者有挂起的 `nextIn` buff | `buffExpire`（`switchOut`）、`buffApply`、变奏动作的 `actionStart`、`intro` 的 `directParentSeq` 都是那条 `switch` |
| C05-14 | DF-10：`maxFrames: 100`，指令没发完与已发完两种；边界观察点 `{0, 100}` | 两种都拿到 `S[100]`，而且是在失败收尾或帧数上限警告之前：此时日志里还没有那条 `wait` / `warning`；回调要求 `stop` 时 `result === null`，没有 `engineError` |
| C05-8 | 合成：大招的切人锁来自"不响应输入"，轴里紧接着切人。`ultInputLocksSwitch` 为 true 与 false 各跑一次 | true：该判定点 `decisiveCount > 0`，有 `switchLock` 的等待；false：`decisiveCount > 0`（这一处同样决定了分支，方向相反），没有等待。两次的 `readCount` 都大于 0 |
| C05-9 | 同一场景，切人写在锁结束之后 | `readCount > 0`，`decisiveCount === 0` |
| C05-10 | 任意场景 | `ruleUsage.coverage` 等于 `RULE_POINTS`；诊断关与开，`ruleUsage` 相同；`ruleTrace` 的条数等于各点 `readCount` 之和 |
| C05-11 | C05-3 的场景过 `trace.ts` 的来源函数，给与不给 `meta` | 给：两条各归各的；不给：`ownersInferred === true`（T05-8 删掉旧算法后 `meta` 必填，"不给"一支改为对照搬到测试里的旧算法：它把两条都归到乙，§12 第 6 条） |

## 9. 验收清单

- [x] `tests/phase-boundary.test.ts`、`tests/zero-interference.test.ts` 全过；反向用例证明检查有效（在 `open` 里改 `s.nextId` 的收集器子类，比较失败并指出路径）。
- [x] `pnpm conformance` 带零干扰对拍，全部场景通过（29 个场景；样例的 `log`、`summary`、`error`、`completion` 等与实现之前逐字节相同，只有 `ruleUsage` 有了内容）。
- [x] 代表场景上 `eventMeta` 没有 `unattributed`（`m0-video-eq.yaml` 与合成主轴，`tests/event-origin.test.ts`；零干扰对拍另跑了 `xin-team.yaml`、`xin-tower4-video.yaml`）。
- [x] `ruleUsage` 在所有运行里都有，`coverage` 列出 16 个判定点（2026-11-17 增至 18 个，见 §4.1 表后的说明）。
- [x] 路线图 §4.2 末尾说的两种错归（同帧多个到期、队列交错）各有用例，并断言了旧算法在该用例上是错的（C05-3、C05-11：旧算法搬到 `tests/helpers/old-owners.ts` 只作对照，§12 第 6 条）。
- [x] 诊断全关时，单次运行的耗时相对 DD-01 之后的增加不超过 3%：`m0-video-eq.yaml` 两份代码同一进程交替跑，200 对的成对比值中位数 +0.9%、+1.4%；各跑 20 次取中位数的 5 次交替测量 −1.3%、+3.9%、+4.3%、−1.1%、−2.3%（单次测量的机器噪声约 ±4%，平均 +0.7%）。
- [x] `pnpm fuzz` 通过（29 个场景，问题 0 条）。

## 10. 要同步的正式文档

- TD-02：`Diagnostics`、`EventMeta`、`OriginContext`、`RuleUsageReport`、`HookContext.noteRule`。
- TD-04 §1：诊断旁路的写法约束。
- TD-07 §5：`handle` 的各处理器与来源种类的对应。
- TD-11 §6：调试表的来源改由记录得到。
- 总设计 §10.1、§11：零干扰对拍是 conformance 的一部分。

## 11. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD05-Q1 | 收集器怎么够得着只拿到 `s` 的函数 | A：挂在 `Kernel` 上，少数函数加可选参数；B：模块级 `WeakMap<SimState, DiagSink>`；C：给 `log()` 加参数 | A。B 是隐藏的全局状态；C 要改一百多处调用 |
| DD05-Q2 | 事件来源用作用域回填，还是在 `log()` 里当场标 | 回填；当场标 | 回填。不动 `log()` 的签名，漏插桩时有 `unattributed` 兜底并能被用例发现 |
| DD05-Q3 | 作用域要不要 `try / finally` | 要；不要 | 不要。抛错路径上两侧的控制流保持一致，收尾交给 `finish` |
| DD05-Q4 | `readCount` 按求值次数还是按指令去重 | 求值次数；按指令 | 求值次数，口径最简单；按指令的统计由 `ruleTrace` 加工 |
| DD05-Q5 | 角色模块里的规则读取怎么记 | A：`ctx.noteRule`，模块显式调；B：把 `ctx.rules` 包一层自动记 | A。B 等于换了个地方用 `Proxy`（路线图 §1.3 已排除），也分不出"决定了分支" |

## 12. 实施记录（2026-11-16）

按代码改正文、或正文没写到的几处。README §8：设计结案后实施中发现对不上，直接改对应的文档并在总览的修订记录里记一条。

1. **`actionLifecycle` 多包两处**（§3.2 的表已补两行）：`startAction` 里的 `hooks.actionStarted`（扣大招能量、施放资源与它们的 `resourceFull`），以及延奏动作开始时的施放资源（`outroTrigger` 里的 `castResources`）。不包的话，前者落在指令的作用域里、没有 `subjectSeq`；后者落在切入者变奏动作的时间线节点里，`subjectSeq` 指到别人的 `actionStart`。包了以后前者的 `subjectSeq` 是这个动作的 `actionStart`，后者经尾部来源表回到那条 `outro`。`command` 作用域因此只补直接由指令写的（switch、actionStart、actionCancel、wait、skip、loop、录像指令的事件、introMissed 警告）。
2. **`subjectSeq` 的取法**：先按事件种类（`actionEnd` / `actionCancel` → 这个实例的 `actionStart`；`buffExpire` 与同一实例再次施加的 `buffApply` → 第一条 `buffApply`；非异常效应的 `hit` → 它的 `judgmentSpawn`），种类没说的再按作用域（§3.3 的表）；只认更早写的事件。表里没写"再次施加的 `buffApply`"，按"它说的实体"补上。
3. **收集器的接口**：`finish(log, phase)` 收日志与结束时的相位（建实体映射要读日志；没关的作用域都包着抛错的那一点，按这个相位记）；另加 `markPost()`——空闲退出时 `k.at.phase` 停在 P2，收尾的 `drain` 只靠相位分不出来。`EventMeta`、`RuleTraceEntry` 现在就带 `scope`（总览 S-08）：`trace.ts` 要按它找"这次结算的 hit"。`runForInspection` 的选项多一个测试用的 `sink`（反向用例换收集器）。
4. **判定点的"读取"**照业务代码里那个表达式实际求值的时机记（短路的不算读）：`sched.switch.ultInputLock` / `invincibleLock` 只在锁来自"不响应输入" / 无敌推断时读；`sched.act.echoInputPriority` 每次 `evaluateAct` 都读（它是 `gate` 的实参），换个读法的 `gate` 只对有起手优先级的动作另算一次；`sched.interject.tuneBreak` 记在 `simulate.ts` 的插队回调里（选项的值在那里），决定分支只认"插入了一次"；`formula.defFloor` 经三个公式函数的可选参数 `rule` 记；`char.爱弥斯.trackNoConsume` 只在"无消耗期间、有轨迹层数"时读，读到就决定分支。规则使用的普查（29 个场景）与敏感度矩阵一致：心队 `xin-team.yaml` 的 forteKeep 两点、全部场景的 defFloor 一次都没决定分支，对应矩阵里 F7、F1 对它们"·"；按套路重排的心队变体 forteKeep 决定分支 10 次，对应"翻过来跑不通"。
5. **`assume()` 的调用点**：实施时数到 45 处（引擎 24 处、钩子上下文的两处转发、13 个角色模块 19 处；正文"49 处"是基线 `6eedc0b` 的数法），逐个归类的表在提交说明里。归成"决定分支"的 7 处（`ult-no-switch`、`echo-input-priority`、`switch-ends-stop`、`hitstop-in-global-stop`、`effect-owner`、`track-no-consume`，以及 `tune-break-auto` 由插队那一处判定点覆盖）、"读规则"的 2 处（`def-no-floor`、`summon-as-char` 的说明文字）都有对应的判定点；其余是"碰到假设"，照旧只调 `assume()`。另有 8 处直接读可翻规则、没有 `assume()` 的判定点（§4.1 表里的其余几行）。心的模块里 `ctx.rules.summonCountsAsChar` 那一处没有登记，算"未插桩"。
6. **T05-7 与 T05-8 一起做**：出处的函数（`gainSteps`、`hitCauses`、`traceLedger`、`measureSegment`）的 `meta` 是必填的，没有"不给 meta 就按旧算法、标 `ownersInferred`"的过渡态；`metaOf(res)` 在结果没带诊断时报错。只要资源数值的（录像剖析的贴合度）改用不归动作的 `resourceSteps`。旧算法 `walkOwners` 原样搬到 `tests/helpers/old-owners.ts`，只给 C05-3、C05-11 断言"旧算法在这里是错的"。新的规则（`walkCauses`）见 TD-11 §6.1；在 29 个场景上与旧算法逐条比，`pnpm trace` 的缺省表与 `--hits` 表、各资源的逐帧值都相同，有差别的只有出处，逐类是旧算法的错归：
   - 钩子在 `judgmentSpawn` 上反应（心的引爆魔方与额外能量、莫特斐的前置碰撞爆炸）：处理那条 `judgmentSpawn` 时日志里已经又写了这一下的 `hit`，旧算法把它当成触发者（"命中"），实际是判定生成（"开始"）——队列交错；
   - 持续帧结束后生成的判定（嘉贝莉娜 E1-跳 → E1-爆炸、琳奈棱镜 → 激光）：旧算法归到最近一次命中（琳奈的激光算到延奏、爱弥斯的 A3 头上），新的沿到期的判定回到它的动作；
   - 钩子生成、所在动作组从不开始的判定（心的协同-飞阙、守岸人的耀星·蝶、达妮娅的蚀域）与它们引出的异常效应伤害：旧算法退到"出伤者最近开始的动作"（常是延奏或之后的普攻），新的沿计时器链回到起头的那次命中或动作（飞阙 → 起头的照世·E，耀星·蝶 → 生成坍缩核的 A1，蚀域 → 黑大招）；
   - 切出时钩子写的资源（卜灵切走清卦象）：处理 `switch` 时日志里已经写了切入者变奏的 `actionStart`，旧算法算到它头上；新的不归动作（切人不是动作）——队列交错；
   - 外部干预（能量满）：旧算法算到前一次命中头上，新的不归动作。
   套路卡跟着变的是这些出处的合计（景尤守守岸人的套路多算了自己 A1 生成的耀星·蝶，心队照世·E 的套路多算了它起头的飞阙）。

