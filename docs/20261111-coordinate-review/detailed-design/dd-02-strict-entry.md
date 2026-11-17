# DD-02 严格教学轴入口

**版本**：v0.3，2026-11-14，Claude。v0.2 按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10：DF-03、DF-04、DF-08、DF-23、DF-24 与 DD02-Q3 的补充）；v0.3 改正 §3.3 对时序的说法（意见文件 §13，Codex §12.5）。
**状态**：Final（2026-11-15）。本文 v0.3 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。已实现阶段一范围（2026-11-16）；`!@N` 按 DD02-Q3 延后。验证与兼容性差异见[实现记录](dd-02-implementation.md)。
**阶段**：一。**前置**：DD-01。**被依赖**：DD-04。

## 1. 范围与依据

做（路线图 §3、§9.4 第 7 项；架构 §2.2、§11.1–§11.3）：
- **声明**：场景 `options.strict`，命令行 `--strict` / `--no-strict`。
- **编译期检查**：严格入口不允许的写法、输入自相矛盾。
- **运行期**：变奏切人的等待单独记码；意图没达到就是轴失败；可选的降级续跑。
- **`strictReport`**：检查结果、按意图的等待、提示。
- **夹具** `tests/strict-teaching.test.ts`。

不做：
- 候选检查与代表轴（DD-04）。
- 删除 `~`、`?`、自动谐破。它们留在非严格入口里（路线图 §1.3）。
- 按键到动作的自动转写。只留一个可选的出处字段（§3.6）。

## 2. 现状

| 事实 | 位置 |
|---|---|
| 行语法由 `parseRotationLine` 解析，条目带 `optional`、`filler`、`force`、`delay`；另有 `wait`、`at`、`enemy`、`fill`、`switch`（可带 `expectIntro`） | `scenario.schema.ts` |
| `options.tuneBreak` 缺省是 `'auto'` | `ScenarioSchema` |
| 变奏切人等出手：`c.expectIntro && 协奏 < 上限 && !settled(…)` 时返回等待代码 `settled`，和默认的等就绪同码 | `scheduler.ts` 的 `evaluate`，`switch` 分支 |
| 等完协奏仍不满：`execute` 照常普通切人，之后记 `warning`（`introMissed`） | `scheduler.ts` 的 `execute` |
| `airEntry` 一处抛出；`entrySkill` 三处抛出：写了 A1 而该写出场技、出场技不在普通切人入场后第一个出（`evaluate` 与 `evaluateAct` 各一处） | `scheduler.ts` |
| `closeSeg` 在等待代码是 `settled` 时记假设 `wait-settled` | `scheduler.ts` |
| 不计入 `maxWait` 的等待代码：`delay`、`wait`、`at`、`input` | `scheduler.ts` 的 `INTENDED` |
| 手写谐度破坏在目标没失谐时：`canStart` 里的 `canTuneBreak` 返回原因，等待代码 `hook`，等满 `maxWait` 报 `timeout` | `simulate.ts`、`enemy.ts` |
| `canTuneBreak` 第一项就拒绝 `tuneBreak: off`，手写的谐破动作也放不出 | `enemy.ts` |
| 谐破动作按 `def.kind === 'tuneBreak'` 识别 | `enemy.ts` 的 `tuneBreakActionsOf` |
| 变奏动作：别名 `QTE` 或钩子 `introAction` | `switch.ts` 的 `introOf`、`onSwitch` |

## 3. 设计

### 3.1 声明

- `ScenarioSchema.options` 加 `strict: z.boolean().optional()`。不给缺省值，这样才分得清"场景写了"和"没写"（`strictSource`）。
- 命令行：`pnpm sim`、`pnpm insight`、`pnpm sensitivity`、DD-04 的 `pnpm candidates` 认 `--strict` 与 `--no-strict`，写进 `RunOverrides.strict`。
- `ResolvedScenario.options` 加 `strict: boolean`（装配时把缺省落成 false）。
- "用途"与"是否严格"是两个维度：`purpose: rotation` 可以严格也可以不严格；`purpose: replay` 加严格在编译期报错。

### 3.2 编译期检查

放在 `src/engine/strict.ts`，两个纯函数，由 `prepareRun` 调（DD-01 §3.2 第 3、4 步）：

```ts
/** 只看场景文本就能查的 */
export function checkStrictSource(sc: Scenario): PrepareIssue[]
/** 要看装配后的动作种类才能查的 */
export function checkStrictResolved(r: ResolvedScenario): { issues: PrepareIssue[]; warnings: string[] }
```

| 代码 | 条件 | 哪个函数 | 报什么 |
|---|---|---|---|
| `strict.replay` | `purpose === 'replay'` | source | 录像剖析不能走严格入口 |
| `strict.tuneBreakAuto` | `options.tuneBreak === 'auto'`（含没写、落到缺省的情形） | source | 严格入口要写 `tuneBreak: manual` 或 `off`；谐度破坏写成轴里的动作 |
| `strict.filler` | 某项带 `~` | source | 第几条第几个；补位不进严格入口 |
| `strict.optional` | 某项带 `?` | source | 同上 |
| `strict.at` | 有 `at` / `对时` | source | 同上 |
| `strict.external` | 有 `能量满`、`敌人 失谐`、`敌人 换` | source | 外部指令只用于录像剖析 |
| `strict.tuneBreakOff` | `options.tuneBreak === 'off'`，而 `opening` 或 `commands` 里有 `kind === 'act'` 且动作 `def.kind === 'tuneBreak'` 的指令 | resolved | 输入自相矛盾：关了谐度破坏又在轴里写了它 |
| `strict.tuneBreakUndeclared` | 轴里没有谐破动作（按装配后的 `def.kind === 'tuneBreak'` 判，动作名与别名代替不了），且没有 `tuneBreakOmitted`（§3.7，DF-03） | resolved | 要么把谐度破坏写进轴，要么声明为什么不打 |
| `strict.noIntroAction` | 有 `switch <角色> 变奏`，而该角色 `introOf(m)` 为空且钩子没有 `introAction` | resolved | 这个角色没有变奏动作，"变奏"的意图不可能成立 |

- 启动轴与循环轴都查；每个问题带 `line`、`item`，启动轴的带 `opening: true`。
- 一次报全，不在第一个问题上停。
- **非严格入口**：`checkStrictResolved` 的 `strict.tuneBreakOff` 条件成立时给一条警告（进 `PrepareResult.warnings` 与 `resolved.warnings`），其余不查。
- `strictReport.compileChecks` 列出实际查过的代码与结果，使用者看得到"查了什么"。

### 3.3 运行期

**① 变奏切人的等待单独记码。** `WaitCode` 加 `'concertoSettle'`。`evaluate` 的 `switch` 分支里那一处返回改成：

```ts
return { go: false, code: 'concertoSettle', reason: `等 ${…} 出手（变奏要协奏满）` }
```

- 所有入口都改，不只严格入口。这是业务字段的变化：日志里这类 `wait` 事件、`summary.waits` 的 `code` 从 `settled` 变成 `concertoSettle`。
- `closeSeg` 只对 `settled` 记假设 `wait-settled`，所以这类等待不再计入那条假设。这是对的：`wait-settled` 说的是"默认等出手，写 `!` 可以抢帧"，而变奏切人的等待写 `!` 也跳不过。
- **不进 `INTENDED`**。它照样计入 `maxWait`，协奏一直补不满时还有超时保护（架构 §14.3）。
- 新常量，给报告分类用，不影响调度：
  ```ts
  /** 按轴写的意图替轴选时机的等待（路线图 §3.3）。只用于报告分类；免计 maxWait 的仍是 INTENDED */
  export const INTENT_WAITS: readonly WaitCode[] = ['concertoSettle', 'airborne', 'entryBusy']
  ```
- 受影响的下游在 T02-2 里逐个核对：`insight.ts`（按等待代码归因的地方）、`summary.ts` 的 `waits`、`web/` 里按代码着色或翻译的表、`tests/__snapshots__`。

**② 意图没达到就是轴失败。** `SchedulerOptions` 加两项：

```ts
strict?: boolean
/** 严格入口下某条意图没达到。返回 'continue' = 记下来、按非严格的行为接着跑（只对 introMissed 有意义） */
onIntentUnmet?(s: SimState, d: UnmetIntentDetail): 'fail' | 'continue'
```

`ScheduleErrorCode` 加 `'intentUnmet'`，`ScheduleError` 加可选的 `intent?: UnmetIntentDetail`。

| 意图 | 检测点 | 严格入口下的行为 |
|---|---|---|
| 变奏切人（`introMissed`） | `execute` 的 `switch` 分支**最开头**，任何状态改动之前：`c.expectIntro && 切出者协奏 < 上限` | 调 `onIntentUnmet`。`'fail'`：`throw fail(s, 'intentUnmet', …)`，这时前台、切人冷却、`entry` 都还没动。`'continue'`：往下走基线的路径（普通切人 + `introMissed` 警告） |
| 变奏切人，协奏满但没有变奏动作 | 没有别名 `QTE`、也没有 `introAction` 钩子的，编译期已拦（`strict.noIntroAction`）。运行期按 `onSwitch` 同样的规则选动作：钩子返回的 ID；返回 `undefined` 时回退到 `introOf`，这是正常回退，不算意图未满足。回退之后仍然没有，才按上一行处理，`expected: '有变奏动作'`。钩子返回不存在的 ID 是实现错误，照旧是 `engineError`。调度器经新的 `SchedulerOptions.introAvailable?(s, to)` 问这件事，由 `simulate` 用同一套规则实现（DF-08） | 同上 |
| 空中入场（`airEntry`） | 基线抛 `airEntry` 的那一处 | `throw fail(s, 'intentUnmet', …)`，`intent.kind = 'airEntry'`。不问 `onIntentUnmet`：引擎没有"当作地面入场继续"的行为可走 |
| 出场技（`entrySkill`） | 基线抛 `entrySkill` 的三处 | 同上，`intent.kind = 'entrySkill'` |

- `UnmetIntentDetail` 的 `expected` / `actual` 写成能读的短句，数值用 `roundTo(…, 100)`：`expected: '切出者协奏 ≥ 100'`、`actual: '椿 协奏 92.31'`。
- **非严格入口完全不变**：`strict` 为假时四处都走基线的代码路径，错误码、警告、日志逐字节相同。
- 归类（接 DD-01 §3.6 的判定表）：`ScheduleError.code === 'intentUnmet'` → `status: 'axisFailed'`，`axisFailure = { kind: 'intentUnmet', unmetIntent: e.intent, detail: e.message }`。

- **检测放在最终切人条件全部满足的那一刻**（`evaluate` 放行、`execute` 开头），不前移到 `evaluate` 里 `concertoSettle` 那一步。那一步通过之后，`evaluate` 还要查切人锁、等跳起、等后台动作与操作延迟，这些都可能让切人再等几帧，这几帧里协奏还可能补满；在那一步就判失败，会让严格入口与非严格入口在同一条轨迹上分岔。这些等待都在 `evaluate` 里面，放行之后同一次调度就执行，所以 `execute` 开头看到的协奏与放行那一刻相同（v0.2 把这几项等待说成在放行之后，Codex §12.5 指出不符合代码，已改正）。DD-07 的 `explainSwitch` 相应多一项 `introReady`，专门对应这一处检查（DD-07 §4.2，DF-08）。

**③ 降级续跑。** `runPrepared` 给调度器的 `onIntentUnmet`：

```ts
onIntentUnmet: (s, d) => {
  sim.unmetIntents.push({ ...d, worldFrame: s.frame })
  if (!p.effective.continueAfterIntentUnmet) return 'fail'
  sim.continuationFrom ??= { worldFrame: s.frame, prefix: currentPrefix() }
  return 'continue'
}
```

- `sim.unmetIntents`、`sim.continuationFrom` 是运行环境里的簿记，不进 `SimState`。
- 续跑过的运行，`buildCompletion` 在 DD-01 §3.6 的判定表之前加一条：`sim.unmetIntents.length > 0` 且最终不是 `engineError` 时，`status` 一律是 `axisFailed`（`intentUnmet`，取第一条），`loopExitAt` 与 `finalization` 照实际的退出记，`diagnosticContinuationFrom = sim.continuationFrom`。也就是说，续跑到正常结束的运行，状态仍是失败，只是多了后半段的日志可看。
- 续跑起点之后的业务事件不加标记（架构 §2.4）。消费者用 `diagnosticContinuationFrom.prefix.eventEndExclusive` 切分。
- 汇总照常算全程。**任何把汇总数字当结论的消费者**（对比、搜索、候选报告）看到 `axisFailed` 就不能用它，这条在 DD-03 §7 统一落实。

**④ 多余的 `!`。** 只记提示，不改执行，不往日志里加事件。`execute` 的 `act` 分支在 `startAction` 之前看一眼：

| 提示代码 | 条件（`c.force` 为真时） | 含义 |
|---|---|---|
| `forceNoCancel` | 这个角色 `action === null` 或 `action.ended` | 前一个动作已经自然结束，没有发生取消 |
| `forceNoEffect` | 动作还在进行，但 `settled(s, slot)` 为真 | 发生了取消，但不写 `!` 也是这一帧：没有判定可丢 |

通过 `SchedulerOptions.onHint?(s, hint)` 交给 `runPrepared` 收进 `sim.hints`。所有入口都收集，报告里都有。

**⑤ 手写谐度破坏。** 不改调度器。严格入口下的表现就是基线：写 `<角色> 谐度破坏`，目标没失谐时等待代码 `hook`，等满 `maxWait` 报 `timeout`（`axisFailed`）。报告里 `timeout` 的明细带上被什么挡住（架构 §2.2 的限定），见 §3.4。

### 3.4 `strictReport`

所有入口都有这份记录；非严格入口的 `compileChecks` 是空的。（DD-01 §3.4 里 `SimResult.strictReport` 的类型按本节，不是可空的。）

```ts
export interface StrictReport {
  readonly entry: 'standard' | 'strict' | 'replay'
  /** 严格入口，并且没有任何操作延迟（架构 §2.1 的"最早合法帧基线"） */
  readonly earliestLegalBaseline: boolean
  readonly compileChecks: readonly { readonly code: string; readonly passed: boolean }[]
  readonly intentWaits: readonly {
    readonly cmd: CommandRef
    readonly code: 'concertoSettle' | 'airborne' | 'entryBusy'
    readonly fromFrame: Frame; readonly frames: number; readonly battleFrames: number
    readonly reason: string
  }[]
  readonly unmetIntents: readonly (UnmetIntentDetail & { readonly worldFrame: Frame; readonly continued: boolean })[]
  readonly hints: readonly { readonly code: 'forceNoCancel' | 'forceNoEffect'; readonly cmd: CommandRef; readonly message: string }[]
  /** 状态是 timeout 时：等待预算、超时那一刻挡住它的条件、相关角色此刻的资源与冷却（DF-04） */
  readonly timeoutContext?: {
    readonly maxWait: Frame
    readonly cmd: CommandRef
    readonly blocked: { readonly code: WaitCode; readonly reason: string; readonly sinceFrame: Frame }
    readonly subjects: readonly {
      readonly role: 'actor' | 'switchOut' | 'switchIn'
      readonly char: CharName
      readonly energy: number; readonly concerto: number; readonly core: readonly number[]
      readonly cooldowns: Readonly<Record<string, Frame>>
    }[]
    readonly blockingRole?: 'actor' | 'switchOut' | 'switchIn'   // 挡住它的条件看的是谁；操作延迟这类不属于角色的省略
  }
}
```

- `intentWaits` 运行后从日志的 `wait` 事件里筛 `INTENT_WAITS` 得到，不另设簿记。失败收尾会把正在累计的等待段写进日志（DD-01 §2），所以失败前那一段也在里面。
- `timeoutContext.blocked` 不能从终态的 `queue.seg` 读：`fail()` 先调 `closeSeg`，已经把它清空了（DF-04）。`hold()` 判定超时、调 `fail` 之前，把这一刻的 `{ code, reason, sinceFrame: q.seg.from }` 存进 `ScheduleError` 的新字段 `blocked`，`buildCompletion` 从那里取。资源与冷却从终态读：失败收尾只写一条 `wait`，不改资源。
- `subjects`：出招指令只有出招的人（`actor`）。切人指令两个都列：切出者（`switchOut`，当时的 `s.onField`）与切入者（`switchIn`，`c.to`）。`blockingRole` 按挡住的代码取：`switchCd`、`entryBusy` 看切入者；`globalStop`、`concertoSettle`、`switchLock`、`airborne` 看切出者；`input`、`delay` 不属于哪个角色，省略。消费者不用从错误文字里猜是谁。

### 3.5 取消写局部帧（可延后）

路线图 §3.4："可选写局部帧，那一帧不合法就报错。"代表轴用不到，排在本工作包最后，评审可以决定推迟（DD02-Q3）。

- **语法**：`<动作>!@N`，例如 `椿 闪避!@42`。只能和 `!` 连用。含义：前台角色当前动作的局部帧第一次 `≥ N` 的那个 tick 开始这个动作。
- **解析**：`parseRotationLine` 的条目加 `cancelAt?: number`；`Command`（`act`）同名字段。
- **调度**：`evaluateAct` 开头：
  - 当前没有进行中的动作，或局部帧已经 `> N` 且还没尝试过：`intentUnmet`，`kind: 'cancelFrameIllegal'`，`actual: '到达时前一个动作已在第 X 帧 / 已结束'`；
  - 局部帧 `< N`：返回等待代码 `cancelAt`（新码，进 `INTENDED`，这是写轴的人要求的等待）；
  - 局部帧第一次 `≥ N`：照常做其余检查；有任何一项不通过，不等，直接 `intentUnmet`（`cancelFrameIllegal`，`actual` 写挡住的那一项）。
- **怎样算到达**（Codex 对 DD02-Q3 的补充）：判的是"局部帧第一次 `≥ N` 的那个 tick"。时停里局部帧不走，就一直等；顿帧或膨胀让局部帧一步越过 N，也算到达，不算错过。"错过"只指到达之前前一个动作已经结束或被别的动作替换。实施时这两种时钟情形各配一个用例。
- 非严格入口下同样的语法、同样的行为，只是失败的码按 DD-01 的归类仍是 `intentUnmet`。

### 3.6 转写的出处（可选字段）

路线图 §3.5 建议"场景每一行能对回原文的哪几个记号"。只加一个不参与执行的字段：

```ts
// ScenarioSchema
notation: z.strictObject({
  source: z.string().optional(),                                   // 原文从哪来
  opening: z.record(z.string().regex(/^\d+$/), z.string()).optional(),   // 第几条 → 原文记号，如 { "1": "椿AAE" }
  rotation: z.record(z.string().regex(/^\d+$/), z.string()).optional(),
  readings: z.array(z.string()).optional(),                        // 采用的读法，如 "红椿里的 A 是蔓舞"
}).optional()
```

- 不影响执行，和 `video`、`search` 一样不进 `scenarioDigest`。
- 校验：键指向的行存在。
- DD-04 转代表轴时把现在写在 YAML 注释里的"按键 → 动作"搬进来。

### 3.7 谐度破坏的口径：没写位置时按不打，并显式标注

用户 2026-11-14 定：**有些教学轴只讲怎么打轴，不给谐度破坏的位置，实战里自行决定何时打。这种轴分析时按没打谐度破坏算，并在结果上显式标注"未含谐度破坏"**，和别的轴比较时知道这个 DPS 是打了折的。

**场景里的声明**（`ScenarioSchema` 顶层，可选）：

```ts
tuneBreakOmitted: z.strictObject({
  reason: z.enum([
    'sourceSilent',   // 原文（教学轴、攻略）没给谐度破坏的位置
    'notInGame',      // 录像的那个版本游戏里还没有谐度破坏（tys-video.yaml）
    'deliberate',     // 这条轴本来就不打（例如专门量"不打谐破"的对照场景）
  ]),
  note: z.string().optional(),
}).optional()
```

- 只能和"轴里没有谐破动作、`tuneBreak` 不是 `auto`"同时出现。两种矛盾在两处查（DF-03）：声明省略又开着 `auto`，只看场景字段就能判，`ScenarioSchema` 报错；轴里写了谐破动作又声明省略，要按装配后的 `def.kind === 'tuneBreak'` 判，放在 `prepareRun` 第 4 步，问题代码 `tuneBreak.omittedButWritten`，严格与非严格入口都拦。
- 不影响执行。它是对结果口径的说明，但进 `scenarioDigest`：口径不同的两份结果不应共用一个 `runId`。

**归一成结果的口径**。`prepareRun` 算出一个 `DamageScope`，放进 `PreparedRun.effective.damageScope`，并原样带进 `SimResult.damageScope`（必有）：

```ts
export interface DamageScope {
  readonly tuneBreak:
    | { readonly mode: 'written' }                  // manual，轴里写了谐破动作
    | { readonly mode: 'auto' }                     // auto，轴里没写：时机全由调度器选
    | { readonly mode: 'writtenPlusAuto' }          // auto，轴里也写了：手写的照放，调度器还会另外插（只在非严格入口出现）
    | { readonly mode: 'omitted'
        readonly reason: 'sourceSilent' | 'notInGame' | 'deliberate' | 'disabledByOption' | 'undeclared'
        readonly gauge: 'off' | 'accumulates' }
}
```

按最终的有效配置分类，不按"文本里有没有写"（DF-24）。是否"轴里有谐破动作"按装配后的动作种类判：

| `options.tuneBreak` | 轴里有谐破动作 | `mode` | 说明 |
|---|---|---|---|
| `manual` | 有 | `written` | — |
| `manual` | 没有 | `omitted`，`gauge: 'accumulates'` | 偏谐值照常累积、目标会失谐，只是没人按 |
| `off` | 没有 | `omitted`，`gauge: 'off'` | 偏谐值也不累积，目标不会失谐 |
| `off` | 有 | `omitted`，`gauge: 'off'`，`reason: 'disabledByOption'` | 写了也放不出来（`canTuneBreak` 第一项就拒绝 `off`）。严格入口报 `strict.tuneBreakOff`；非严格给警告 |
| `auto`（含缺省） | 没有 | `auto` | — |
| `auto` | 有 | `writtenPlusAuto` | 严格入口报 `strict.tuneBreakAuto` |

- `omitted` 的 `reason`：写了 `tuneBreakOmitted` 时取它的；`off` 加手写谐破是 `disabledByOption`；其余没声明的是 `undeclared`（非严格入口给一条警告，严格入口报 `strict.tuneBreakUndeclared`）。
- 比较时，"口径是否相同"看 `mode` 与 `gauge` 两项，它们会改变机制；`reason` 只说明来源，不参与判定，在输出里并列显示（DD-03 §7.4）。

"未含谐度破坏"的含义写进类型注释与报告：**谐度破坏自身的伤害不在 DPS 里；`gauge: 'off'` 时，依赖失谐的效果也不在**。

**严格入口**加一条装配后的检查（§3.2 的表，放在 `checkStrictResolved`）：

| 代码 | 条件 | 报什么 |
|---|---|---|
| `strict.tuneBreakUndeclared` | 轴里没有谐破动作，且没有 `tuneBreakOmitted` | 严格入口要说清谐度破坏：写进轴，或用 `tuneBreakOmitted` 说明为什么不打 |

于是严格轴只有两种合法状态：写了谐破（`written`），或声明了省略（`omitted`）。`auto` 本来就被 `strict.tuneBreakAuto` 挡住。

**给 agent 的能力说明**：信封的 `CapabilityDisclosure.unsupported`（DD-07 §10.1）在 `omitted` 时加一项 `'damage.tuneBreak: 未含谐度破坏（<reason>）'`，`gauge: 'off'` 时再加 `'damage.disharmonyDependent'`。比较时怎么用这个口径见 DD-03 §7.4。

**现有场景**：`tys-video.yaml` 已经是 `tuneBreak: off`，补 `tuneBreakOmitted: { reason: notInGame }`（T02-10）。其余现有场景都是 `auto` 或写了谐破，不用改。

## 4. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T02-1 | `options.strict` 与命令行开关 | `scenario.schema.ts`、`types.ts`、`resolve.ts`、`src/cli/` 的参数解析 | C02-9、C02-10；现有场景不写 `strict`，行为不变 |
| T02-2 | `concertoSettle` | `types.ts`、`scheduler.ts`；核对并更新 `insight.ts`、`summary.ts`、`web/` 里用到 `settled` 的地方 | C02-1 的等待代码断言；快照里只有等待代码与 `wait-settled` 的次数变化，逐个场景列进提交说明；DPS 一个都不变 |
| T02-3 | 编译期检查 | `strict.ts`；`run.ts` 的第 3、4 步接上 | C02-6、C02-7、C02-8 |
| T02-4 | `intentUnmet` 与三处严格分支 | `scheduler.ts`、`run.ts`、`run-types.ts` | C02-2、C02-3 |
| T02-5 | 降级续跑 | `run.ts`、`context.ts` | C02-11 |
| T02-6 | 提示与 `strictReport` | `scheduler.ts`、`run.ts` | C02-4、C02-12 |
| T02-7 | `pnpm sim` 打印 `strictReport` 的摘要：入口、是否基线、按意图的等待几处、提示几条、失败的意图 | `src/cli/sim.ts`、`src/cli/format.ts` | 人工看一次输出 |
| T02-8 | 取消写局部帧（可延后） | `scenario.schema.ts`、`scheduler.ts` | C02-13 |
| T02-9 | `notation` 字段（可选） | `scenario.schema.ts`、`digest` 的排除项 | C02-14 |
| T02-10 | 谐度破坏的口径：`tuneBreakOmitted`、`DamageScope`、编译期检查；`tys-video.yaml` 补声明 | `scenario.schema.ts`、`run.ts`、`run-types.ts`、`strict.ts`、`scenarios/tys-video.yaml` | C02-15～C02-17；`tys-video.yaml` 的结果除 `damageScope` 外不变 |

T02-2 与 T02-4 都改 `scheduler.ts`，各自跑 `pnpm conformance` 与 `pnpm fuzz`。T02-4 之后非严格场景的 conformance 输出与 T02-2 之后逐字节相同。

## 5. 用例

`tests/strict-teaching.test.ts`。全部用合成角色（`tests/helpers/synth.ts`）或测试台（`kernel-harness.ts`），不依赖 `data/generated`。每个用例开头用注释写明初态、动作定义与相位；帧数只在这些前提下成立。

合成队伍的约定（各用例共用，文件开头定义一次）：
- 甲：动作 `打`（40 帧，第 20 帧一个判定，命中给甲 10 协奏）、`跳`（30 帧，`air.from = 10`）、`谐破`（`kind: 'tuneBreak'`）；
- 乙：有变奏动作 `QTE`（`kind: 'intro'`）、`空A`（`kind: 'normal'`，`air.from = 0`）、`出场`（`entrySkill: true`）、`长`（200 帧）；
- 丙：空闲。
- **严格夹具的公共设置**：`strict: true`、`tuneBreak: off`、`tuneBreakOmitted: { reason: deliberate }`。否则新加的装配检查（`strict.tuneBreakUndeclared`）会先把本来要测运行期行为的夹具挡在编译阶段（DF-23）。测谐度破坏的 C02-5 另写 `tuneBreak: manual`。

| 编号 | 对应 | 前提与操作 | 断言 |
|---|---|---|---|
| C02-1 | 路线图夹具 1 | 甲协奏初值 90；`甲 打`、`switch 乙 变奏`；严格 | `completed`；有一条 `wait`，`code === 'concertoSettle'`，结束帧是判定结算那一帧的下一帧：判定在第 20 帧的 P4 结算时协奏到 100，那一帧的 P2 已经过去，等待段在第 21 帧的 P2 关闭并切人（`frames === 21`，DF-23）；`switch` 事件 `intro: true`；`strictReport.intentWaits.length === 1`；`summary.assumptions` 里没有因这段等待记 `wait-settled` |
| C02-2 | 夹具 2 | 同上，协奏初值 89（等完是 99） | `axisFailed`、`intentUnmet`；`unmetIntent.kind === 'introMissed'`，`actual` 里有 99；日志里**没有** `switch` 事件；终态前台仍是甲、甲的切人冷却是 0；`completedTicks` 是失败那一帧 |
| C02-2b | 对照 | C02-2 的场景去掉 `strict` | `completed`；有 `switch`（`intro: false`）与 `introMissed` 警告。与基线行为一致 |
| C02-3a | 夹具 3 | `甲 跳`、`switch 乙`、`乙 空A`；严格 | `completed`；有 `code === 'airborne'` 的等待；切人发生在甲局部帧 ≥ 10 之后 |
| C02-3b | 夹具 3 | `甲 打`、`switch 乙`、`乙 空A`；严格 | `axisFailed`、`intentUnmet`、`kind: 'airEntry'` |
| C02-3c | 出场技 | 乙先在前台放 `长` 后被切走，随即 `switch 乙`、`乙 出场`；严格 | 有 `entryBusy` 的等待，之后 `completed` |
| C02-3d | 出场技失败 | `switch 乙 变奏`（协奏满）后写 `乙 出场` | `axisFailed`、`intentUnmet`、`kind: 'entrySkill'` |
| C02-4 | 夹具 4 | 同一初态跑两次：`甲 打`、`甲 打` 与 `甲 打`、`甲 打!` | 第二次的第二个 `actionStart` 早于第一次，帧差等于"判定出手帧 − 最早可取消帧"（按夹具的动作定义写出具体数）；带 `!` 的那次第一个 `打` 的判定没有 `hit`（被丢）；`strictReport.hints` 为空 |
| C02-4b | 多余的 `!` | `甲 打`、`wait 60`、`甲 打!` | `hints` 里有一条 `forceNoCancel`；状态仍是 `completed` |
| C02-5a | 夹具 5 | 敌人 `tunabilityMax` 很小，`甲 打` 打满偏谐值；`tuneBreak: manual`；`甲 打`、`甲 谐破` | `completed`；`谐破` 在失谐之后开始；之前有 `code === 'hook'` 的等待 |
| C02-5b | 夹具 5 | 敌人偏谐值打不满，`maxWait: 120` | `axisFailed`、`timeout`；`strictReport.timeoutContext.blocked.code === 'hook'`，`blockingRole === 'actor'`，`maxWait === 120` |
| C02-6 | 夹具 6 | 严格场景分别含 `~`、`?`、`at 3`、`能量满 甲`、`敌人 失谐`、`tuneBreak: auto`、不写 `tuneBreak` | 各自 `prepareRun` 返回 `ok: false`，问题的 `code` 分别是表里的那个，带对的 `line`、`item` |
| C02-7 | 架构 §11.2 | `tuneBreak: off` 且轴里有 `甲 谐破`：严格与非严格各一次 | 严格：`strict.tuneBreakOff`；非严格：`ok: true`，`warnings` 里有一条 |
| C02-8 | 架构 §11.1 | `purpose: replay` 加 `strict: true` | `strict.replay` |
| C02-9 | 声明 | 场景写 `strict: true`；场景不写、`overrides.strict = true`；场景写 true、`overrides.strict = false` | `entryMode` / `strictSource` 分别是 `strict/scenario`、`strict/cli-override`、`standard/cli-override` |
| C02-10 | 基线标记 | 严格加 `overrides.options.inputDelay = 6` | 运行成功；`strictReport.earliestLegalBaseline === false`；`identity.execution.inputTiming === 'delayed'` |
| C02-11 | 降级续跑 | C02-2 加 `continueAfterIntentUnmet: true` | `status === 'axisFailed'`（`intentUnmet`）；`diagnosticContinuationFrom.worldFrame` 等于 C02-2 的失败帧；日志里之后有 `switch`（`intro: false`）；`unmetIntents[0].continued === true`；`loopExitAt.reason === 'idle'` |
| C02-12 | 报告 | 非严格场景 | `strictReport.entry === 'standard'`，`compileChecks` 为空，`intentWaits` 照常有 |
| C02-13 | §3.5 | `甲 打`、`甲 跳!@25` 与 `甲 跳!@5`（第 5 帧优先级不够） | 前者在甲局部帧 25 开始 `跳`；后者 `intentUnmet`、`cancelFrameIllegal` |
| C02-15 | §3.7 | 严格场景，轴里没有谐破动作、不写 `tuneBreakOmitted`；补上 `{ reason: sourceSilent }` 再跑 | 前者 `strict.tuneBreakUndeclared`；后者 `ok`，`damageScope.tuneBreak` 是 `omitted`、`sourceSilent`、`gauge: 'off'` |
| C02-16a | §3.7 | 声明省略又开 `auto` | `ScenarioSchema` 报错 |
| C02-16b | §3.7、DF-03 | 用别名写了谐破动作（装配后 `kind === 'tuneBreak'`）又声明省略；严格与非严格各一次 | 两次 `prepareRun` 都 `ok: false`，代码 `tuneBreak.omittedButWritten` |
| C02-17 | §3.7 | 非严格场景 `tuneBreak: manual`、没有谐破动作、不声明 | 运行成功；`damageScope` 是 `omitted`、`undeclared`、`gauge: 'accumulates'`；有一条警告 |
| C02-18 | DF-04 | `switch 乙`，乙的切人冷却一直不到，`maxWait: 60` | `timeout`；`blocked.code === 'switchCd'`，`blockingRole === 'switchIn'`；`subjects` 有两条，角色分别是切出者与切入者 |
| C02-19 | DF-24 | 非严格：`auto` 加手写谐破；`off` 加手写谐破 | 前者 `mode: 'writtenPlusAuto'`；后者 `omitted`、`disabledByOption`、`gauge: 'off'`，并有一条警告 |
| C02-14 | §3.6 | `notation.rotation` 指向不存在的行；改 `notation` 的文字 | 前者 schema 报错；后者 `runId` 不变 |

另外在 `tests/td09.test.ts` 里原来断言"变奏切人等出手的等待代码是 `settled`"的用例，改成 `concertoSettle`。

## 6. 验收清单

- [x] `tests/strict-teaching.test.ts` 全过，路线图 §3.7 的六个夹具都有对应用例。
- [x] 非严格场景：T02-2 之后的 conformance 输出，与 T02-9 之后的业务字段逐键相同（log、summary、error、completion、interventions）。整份输出不可能逐字节相同：本包有意新增了 strictReport 的内容、身份里的 options.strict 与 tys-video 的口径原因，口径改写的理由见[实现记录](dd-02-implementation.md)的"兼容性核对"。
- [x] T02-2 引起的快照变化只有等待代码与 `wait-settled` 的计数，没有任何伤害或帧数变化；变化清单在提交说明里。
- [x] `m0-video-eq.yaml` 加 `--strict` 运行，得到 `strict.tuneBreakAuto` 的编译问题（它用的是缺省的自动谐破），不是运行期错误。
- [x] `pnpm fuzz` 通过。
- [x] `strictReport` 在所有入口的结果里都有。

## 7. 要同步的正式文档

- TD-09 §2：`options.strict`、`!@N`、`notation`、`tuneBreakOmitted`。§3.3：等待代码 `concertoSettle`、`cancelAt`。§3.5：`introMissed` 在严格入口下由警告改为失败；出场技与空中入场在严格入口下归 `intentUnmet`。§4：严格入口的编译期检查表。
- TD-02：`WaitCode`、`ScheduleErrorCode`、`StrictReport`、`UnmetIntentDetail`。
- 总设计 §3.3、§6.5：严格教学轴入口。
- TD-12：等待代码的显示名加一项。

## 8. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD02-Q1 | `concertoSettle` 是否所有入口都换码 | A：都换；B：只在严格入口换 | A。同一种等待在两种入口下用不同的码，下游要写两套；代价是一次快照更新 |
| DD02-Q2 | 严格入口下 `entrySkill` 的三处要不要细分（"该写出场技却写了 A1"更像轴写错了） | A：三处都归 `intentUnmet`；B：写 A1 那一处仍归 `entrySkill` | A，照架构 §2.2 的表；`UnmetIntentDetail.expected` 写清是哪一种 |
| DD02-Q3 | `!@N` 做不做在阶段一 | 做；推迟到有轴需要时 | 推迟。语法与行为按 §3.5 定下来，代表轴用不到 |
| DD02-Q4 | 严格入口下没写 `tuneBreak` 算不算 `auto` | A：算，报错让作者写明；B：严格入口下缺省改成 `manual` | A。缺省值随另一个开关变，读场景的人容易看错 |
| DD02-Q5 | 多余 `!` 的提示要不要在非严格入口也收集 | 都收集；只严格 | 都收集，成本为零，录像场景里也有用 |
| DD02-Q6 | 原文没给谐破位置的轴，严格基线用 `off` 还是 `manual`（不写谐破） | A：`off`（偏谐值不累积）；B：`manual`（累积但没人按） | A 作为基线，路线图 §3.2 对 `off` 的定义就是"这条轴不打谐度破坏"；B 作为策略试验单列（DD-04 §5.6），两者不同时说明失谐状态本身影响了结果 |
