# DD-04 规则台账、候选检查、代表轴与第一份有条件结论

**版本**：v0.2，2026-11-14，Claude。按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10；本文涉及 DF-05、DF-20、DF-24）。
**状态**：Final（2026-11-15）。本文 v0.2 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。**T04-1、T04-2 已实现（2026-11-16）**：用例 C04-1～C04-4 在 `tests/propositions.test.ts`；实现时的决定记在 AGENTS.md"与设计文档的差异"第 53 条。T04-3～T04-10 已实现：`src/engine/candidates.ts`、`tests/candidates.test.ts` 与两份生成文档。覆盖计数按 §5.3 的兼容性检查后集合，策略不计主表；排除项用 `candidates[]` 保留整对；另列 `timingFaster`、`timingUnassessable`，不丢失失败对照。
**阶段**：一（台账的证据部分在 DD-08 接着做）。**前置**：DD-01、DD-02、DD-03 的 §7。**被依赖**：DD-08、阶段一、二的汇合验收。

## 1. 范围与依据

做（路线图 §5.1–§5.2、§9.4 第 8、9 项；架构 §8、§11.4）：
- **台账的数据结构**与首批命题：只收代表轴用得到的与现有能翻的开关。
- **拆开关**：`forteKeepOnSwitch` 加按角色覆盖；规则路径的多段设值。
- **候选检查工具**：按候选的类别过滤，跑单项与两两组合，保留失败结果，覆盖按实际运行统计。
- **代表轴转成严格轴**：谐度破坏按"原文没给位置"省略并标注、另存场景、跑通；另给自动谐破下的参考值。
- **第一份有条件结论**。

不做：
- 证据条目的填写、实验（DD-08）。本文的命题里 `evidence` 先只迁移现有假设表里已经写着的依据文字。
- 把 40 条假设全部拆成命题。按影响逐步补（路线图 §5.2）。
- 三项及以上的组合。

## 2. 现状

| 事实 | 位置 |
|---|---|
| 假设表 `ASSUMPTIONS` 40 条，纯数据；14 条带 `adjust.path`，展开成 15 个可翻的取值（`effectOwner` 有两个） | `assumptions.ts` |
| `AdjustPath` 是 14 个字面量的联合，12 个 `rules.*`、2 个 `options.*` | 同上 |
| `flipsOf()` 把 15 个取值不加区分地全部展开 | `sensitivity.ts` |
| `adjusted(r, path, v)` 按 `.` 拆成两段，直接改装配结果的 `rules` 或 `options` | `insight.ts` |
| `rules.forteKeepOnSwitch` 一个布尔值同时管心与卜灵；两个角色模块的钩子各自读它 | `gamedata.ts` 的 `Rules`；`data/curated/characters/心.ts`、`卜灵.ts` |
| `module-guess` 在 12 个角色模块里有 17 处调用 | `grep "assume("` |
| `m0-video-eq.yaml` 用缺省的 `tuneBreak: auto`；轴里没有 `~`、`?`、`at` | `scenarios/m0-video-eq.yaml` |
| 椿有两种谐度破坏动作（常态、盛绽），自动插入时按 `canStart` 挑 | `simulate.ts` 的 `interject` |
| 卡帧点分析：`options.inputDelayAt` 让循环轴的某一条指令每轮单独晚几帧 | `insight.ts`；`simulate.ts` 的 `delayAt` |

## 3. 台账

### 3.1 文件与类型

`src/engine/propositions.ts`（新，属于 ② 共享规则与台账）。类型照架构 §8.1：`Proposition`、`Candidate`、`Evidence`、`FieldProvenance`、`EvidencePurpose`、`Conclusion`、`CandidateChange`、`ScenarioFeature`。补三处架构没写到的细节：

```ts
export interface Proposition {
  …                                           // 架构 §8.1 的全部字段
  /** 对应的旧假设 ID（assume() 记的那个）。一条假设可以对应几条命题 */
  readonly assumptionId?: AssumptionId
  /** 这条命题只在这些角色在队里时才有意义；不写 = 不限 */
  readonly appliesToChars?: readonly CharName[]
}

export const PROPOSITIONS = [ … ] as const satisfies readonly Proposition[]
export type PropositionId = (typeof PROPOSITIONS)[number]['id']
export const propositionOf = (id: string): Proposition | undefined => …
```

- **纯数据，不放函数**。判兼容的函数在 `candidates.ts`（④）。
- **`binding`**：`{ kind: 'rule', path: 'defFloor', value: true }` 的 `path` 是 `Rules` 下的路径，不带 `rules.` 前缀，可以多段（`forteKeepOnSwitchBy.心`）；`{ kind: 'option', path: 'inputDelay', value: 6 }` 是 `options` 下的键。`curated`、`hook` 两种现在不能自动翻，`implemented` 仍可以是 true（当前采用的那个），其余候选是 `unimplemented`。
- **每条命题恰有一个候选的 `id` 等于 `adopted`**，它的 `binding.value` 等于规则的缺省值。
- **和 `ASSUMPTIONS` 的关系**：`ASSUMPTIONS` 与 `assume()` 不动，`summary.assumptions` 照旧。台账是在它旁边的新索引，靠 `assumptionId` 关联。等命题覆盖了全部假设，再由台账反过来生成假设表（DD-08 之后的事，本文不做）。

### 3.2 首批命题

只收两类：现有能翻的 15 个取值涉及的，以及代表轴基准运行碰到的假设（`summary.assumptions` 里列出的）。下面是 15 个取值的归类，T04-2 照这张表写；代表轴碰到的其余假设（预期有 `wait-settled`、`data-guess`、`burst-release`、`dilation-rules`、`tunability-base` 等，以实际运行为准）各建一条只有一个已实现候选、`candidatesExhaustive: false` 的命题。

| 命题 ID | 旧假设 | 范围 | 候选（★ 是当前采用的） | 类别 | 冲突的场景特征 |
|---|---|---|---|---|---|
| `def-floor` | `def-no-floor` | shared | ★`none`（`defFloor: false`）、`floor`（true） | mechanism | — |
| `effect-tick-timer` | `effect-tick` | shared | ★`from-first`（`effectTickReset: false`）、`reset-on-apply`（true）；取整方式是另一个点，记 `candidatesExhaustive: false` | mechanism | — |
| `effect-owner` | `effect-owner` | shared | ★`last`、`first`、`onField` | mechanism | — |
| `forte-keep.心-照世相` | `forte-keep-on-switch` | character | ★`keep`（`forteKeepOnSwitchBy.心: true`）、`clear`（`forteKeepOnSwitchBy.心: false`） | mechanism | — |
| `forte-keep.卜灵-卦象` | 同上 | character | ★`keep`（`forteKeepOnSwitchBy.卜灵: true`）、`clear`（`forteKeepOnSwitchBy.卜灵: false`） | mechanism | — |
| `ult-input-locks-switch` | `ult-no-switch` | shared | ★`locks`、`free`（`ultInputLocksSwitch: false`） | mechanism | — |
| `invincible-locks-switch` | `switch-no-lock` | shared | ★`locks`、`free` | mechanism | — |
| `switch-ends-stop` | `switch-ends-stop` | shared | ★`ends`、`blocks`（false） | mechanism | — |
| `hitstop-in-global-stop` | 同名 | shared | ★`ignored`（false）、`applies`（true） | mechanism | — |
| `echo-input-priority` | 同名 | shared | ★`generic-5`（true）、`echo-table`（false） | mechanism | — |
| `interference-frames` | `resonance-rules` | shared | ★`480`、`300` | mechanism | — |
| `track-no-consume` | 同名 | character（爱弥斯） | ★`kept`、`consumed` | mechanism | — |
| `summon-as-char` | 同名 | shared | ★`counts`、`not` | mechanism | — |
| `input-delay` | `earliest-frame` | policy | ★`0`、`6`（`options.inputDelay: 6`） | policy | — |
| `tune-break-mode` | `tune-break-auto` | policy | `auto`、`manual`、`off`（`options.tuneBreak`）；`adopted` 写 `auto`（缺省值） | `auto`、`manual` 是 policy；`off` 是 input | `auto`：`strictEntry`；`off`：`hasManualTuneBreak` |

- 两条 `forte-keep.*` 各带 `appliesToChars`。
- 这两条的当前生效值一律经 `forteKept(rules, char)` 读（§4.1），不直接读 `forteKeepOnSwitchBy[char]`：场景只写了旧的 `forteKeepOnSwitch: false` 时，按角色的表里没有键，直接读得到 `undefined`，而实际生效的是 `clear`（DF-05）。
- `tune-break-mode` 的三个候选说明了为什么它不进严格轴的主表：`auto` 是调度策略，`off` 会让轴里手写的谐破放不出来（`canTuneBreak` 第一项拒绝），是和场景输入冲突的项。
- 每条的 `proposition` 文字写成能单独证伪的游戏事实，不抄假设表的"现在怎么处理"。例如 `switch-ends-stop`："写了'第 n 帧前不能切人'、且 n 早于全局时停结束帧的大招，过了第 n 帧能切人，切人时剩余的时停随之结束。"
- `impact` 除了沿用假设表的 DPS 等级，补 `threshold`、`timingFrames`：不知道的写 `'unknown'`，不估。

### 3.3 文档生成

- `pnpm assumptions --ledger [--md]`（在现有 `src/cli/assumptions.ts` 上加参数）：打印命题表。每条：ID、命题、范围、采用的候选、其余候选（标"未实现"）、是否列全、结论、证据条数。
- 生成的 markdown 写到 `docs/proposition-ledger.md`，开头留手写的"读法"一节，重新生成时保留（做法同 `pnpm sensitivity --md`）。

## 4. 拆开关

### 4.1 `forteKeepOnSwitch`

- `Rules` 加 `forteKeepOnSwitchBy: Partial<Record<CharName, boolean>>`，缺省 `{}`。共享的 `Rules` 里不出现具体角色名的字段，角色名只作为这张表的键。
- `gamedata.ts`（或 `Rules` 所在处）加纯函数：
  ```ts
  export const forteKept = (rules: Rules, char: CharName): boolean => rules.forteKeepOnSwitchBy[char] ?? rules.forteKeepOnSwitch
  ```
- 心、卜灵的钩子把 `ctx.rules.forteKeepOnSwitch` 换成 `forteKept(ctx.rules, '心')` / `forteKept(ctx.rules, '卜灵')`。
- 场景里原有的写法 `options.rules.forteKeepOnSwitch: false` 含义不变（两个都清）。`xin-tower4-video.yaml` 不用改。
- `AdjustPath` 里的 `'rules.forteKeepOnSwitch'` 保留，敏感度矩阵照旧能翻"两个一起"。

### 4.2 规则路径的多段设值

`src/engine/run.ts`（DD-01 的合并步骤用）加：

```ts
/** 把 { 'forteKeepOnSwitchBy.心': false, defFloor: true } 展开并合并进 options.rules 的输入对象。
 *  父对象逐层浅拷贝后设值，不整体替换；路径的第一段不是 Rules 的键时返回问题 */
export function mergeRulePaths(base: Record<string, unknown> | undefined, paths: Readonly<Record<string, number | boolean | string>>):
  { ok: true; rules: Record<string, unknown> } | { ok: false; issues: string[] }
```

- 合并结果仍交给装配时的逐项校验，类型不对在那里报。
- **路径冲突检查**（给两两组合用，放 `candidates.ts`）：
  ```ts
  export function pathConflict(a: Binding, b: Binding): string | null
  ```
  同一种 `kind` 下：路径相同而值不同 → 冲突；一个路径是另一个的前缀（父子）→ 冲突；否则 null。`rule` 与 `option` 之间不冲突。
- `insight.ts` 的 `adjusted()` 不改，留给还在用它的分析；注释里写明"只支持两段路径，新代码用 `prepareRun` 的 `overrides.rules`"。

## 5. 候选检查

### 5.1 文件与入口

`src/engine/candidates.ts`（新，④ 分析层）；命令行 `src/cli/candidates.ts`，`package.json` 加脚本 `candidates`。

```ts
export function scenarioFeatures(p: PreparedRun): ReadonlySet<ScenarioFeature>
export function classifyCandidates(p: PreparedRun, ledger: readonly Proposition[]): CandidatePlan
export function runCandidateReport(scenario: Scenario, data: GameData, opts: { overrides?: RunOverrides; pairs: boolean; onProgress?: (done: number, total: number) => void }): StrictCandidateReport
```

```bash
pnpm candidates scenarios/m0-video-eq-不打谐破.yaml --pairs            # 终端表格
pnpm candidates <场景> --pairs --json out/candidates/<场景名>.json      # 整份 StrictCandidateReport（经 DD-07 的 wire 规则）
pnpm candidates <场景> --pairs --md docs/m0-strict-conclusion.md        # 写成文档，保留开头手写的读法
```

不要求场景是严格的；非严格场景也能跑，报告里 `baseline` 的 `strictReport.entry` 会写明。

### 5.2 场景特征与分类

`scenarioFeatures` 由 `PreparedRun` 算，不看原始文本：

| 特征 | 条件 |
|---|---|
| `strictEntry` | `p.effective.strict` |
| `hasManualTuneBreak` | `opening` 或 `commands` 里有 `act` 指令，其动作 `def.kind === 'tuneBreak'` |
| `hasAutoTuneBreak` | `resolved.options.tuneBreak === 'auto'` |
| `hasFillerOrOptional` | 有带 `filler` 或 `optional` 的指令 |
| `hasForcedIntervention` | 有 `fill` 或 `enemy` 指令 |

`classifyCandidates` 遍历台账里每条命题的每个**不是当前生效的**候选（"当前生效"按这次运行的有效值判，不按台账的缺省：严格轴的 `tuneBreak` 生效值是 `off`，所以 `tune-break-mode` 要试的是 `auto` 与 `manual`），按顺序归类，归到第一个成立的：

1. `binding.kind === 'unimplemented'` 或 `implemented === false` → **未实现**；
2. 命题有 `appliesToChars` 且队里一个都没有 → **不适用**（单列，不算已检查也不算排除）；
3. `conflictsWith` 里任意一项在场景特征里 → **排除**，原因写出命中的特征；
4. `changes === 'policy'` → **操作策略试验**；
5. `changes === 'input'` → **排除**，原因"改变的是轴的输入"；
6. 其余（`mechanism`、`data`）→ **主表候选**。

当前生效值由 `effectiveValue(binding, resolved)` 取：`rule` 绑定读 `resolved.rules` 的对应路径，`forteKeepOnSwitchBy.<角色>` 经 `forteKept`；`option` 绑定读 `resolved.options`。与哪个候选的 `binding.value` 相等，哪个就是"当前生效"的，不再试它。

`candidatesExhaustive === false` 的命题 ID 另收进 `nonExhaustivePropositions`。

### 5.3 运行

对每个要跑的组合，生成 `RunOverrides`（基准的覆盖项加上候选的 `binding`），调 `prepareRun` 再 `runPrepared`。

- **单项**：每个主表候选一次；每个策略候选一次（进 `policyTrials`）。
- **两两**（`--pairs`）：主表候选两两组合，**同一条命题的两个候选不组合**（它们互斥）。每一对先做三步检查，任一步不过就进 `excluded`，原因写清，不运行：
  1. `pathConflict` 不为 null；
  2. 合并两个 `binding` 后 `prepareRun` 返回 `ok: false`（严格入口检查或装配不通过）；
  3. 用**合并后的** `PreparedRun` 重新算场景特征，两个候选的 `conflictsWith` 任意一项命中。
- **保留失败**：`axisFailed` 的运行照样进主表，带完成状态。`engineError` 也留在表里，但计入 `engineErrorCount`，不算已检查。
- **不删行**：报告生成函数里没有任何按状态过滤主表的代码；用例 C04-7 断言这一点。

`CandidateOutcome` 照架构 §11.4，补几项（总览 §6 的 S-07）：

```ts
export interface CandidateOutcome {
  …                                                   // 架构 §11.4 的字段
  readonly completion: RunCompletion                  // 机器可读的失败原因在这里
  readonly steadyLoopBattleFrames: readonly number[] | null   // 稳态各轮的战斗帧数；steadyLoopBattleSeconds 是它们的平均 ÷ 60
  readonly loopTime: 'same' | 'changed' | 'notComparable'     // 与基准比：稳态各轮帧数逐轮相等才是 same
  /** 与基准比的 DPS。实际的差都给出；same 只表示数值相同，不表示"差在误差内"（DF-20） */
  readonly dps: {
    readonly status: 'same' | 'changed' | 'notComparable'     // same：相对差 ≤ 1e-9
    readonly delta: number | null                             // 候选 − 基准
    readonly ratio: number | null                             // 候选 ÷ 基准 − 1
    readonly withinWindowVariation: boolean | null            // |ratio| ≤ 基准的 steady.spread：变化没超过"把窗口挪一轮"的幅度。spread 不是误差条，也不是置信区间
  }
  readonly intentWaitCount: number
  readonly identicalLog: boolean                      // 业务日志的摘要与基准相同：这个候选在这条轴上没有任何可见作用
}
```

- `notComparable`：`usableBasis`（DD-03 §7）返回 `ok: false`，或双方的稳态窗口不是同样的轮次。
- `comparedWindow` 写成 `'稳态第 2–3 轮'` 这样的实际窗口。
- `identicalLog` 只是提示，**不用来跳过两两组合**：单项没有作用的候选，和另一个候选组合后可能有作用（路线图 §9.5 查出的两对就是这样）。

`coverage` 由实际集合算：`singlesPlanned` / `pairsPlanned` 是分类与检查后要跑的数量，`*Run` 是状态不是 `engineError` 的数量，`notRunCount` 是因进程中断等没跑的。`higherOrderChecked` 恒为 false。

### 5.4 等待与指令时刻的敏感度

- **`observedWaits`**：基准运行的稳态各轮里的全部 `wait` 事件，`INTENDED` 的四种（`delay`、`wait`、`at`、`input`）不列；`intent` 字段按 `INTENT_WAITS`（DD-02 §3.3）标。
- **对照只回答"这条指令的时刻"**（DF-20 ②）：对每条有等待、属于决策点的指令做一次对照运行，只把它晚 6 帧（`overrides.inputDelayAt = { '<行>.<项>': 6 }`）。
  - 稳态平均每轮变长：进 `timingSensitive`。意思是"这条指令一晚，轮长跟着晚"，它在决定轮长的那条时序路径上。`loopSecondsDelta` 是变长的量，`controlRunId` 是对照运行。
  - 不变：进 `timingAbsorbed`，意思是这几帧被后面的时序吸收了。
  - 变快：单列为提示（路线图 §3.6 的"上限不一定是时序最优"）。
- **不由此推出是哪一项等待门槛决定了轮长**。操作延迟是在其他门槛全部满足之后才开始计的。一条指令同时被冷却与资源挡到同一帧时，把它晚 6 帧会让轮长变长，但单独放宽冷却，它仍然被资源挡在同一帧。Codex 用合成场景实测过（DF-20）：基准两次起手在第 0、30 帧；冷却改成 0 仍是 0、30，等待原因变成资源；只晚 6 帧是 0、36。所以每条 `timingSensitive` 旁边只列"记录到的等待原因"，并标明门槛级的对照没做（`gateConfirmed: false`）。逐项放宽某个门槛的对照，第一版不做。
- 连段后续不是决策点，`inputDelayAt` 对它不起作用，没有对照可做，只留在 `observedWaits` 里。
- 对照运行是操作策略试验（`inputTiming: 'delayed'`），不是台账候选。它只说明模型的轮长对这条指令的时刻敏感，不说明游戏里有更快的打法（架构 §11.4）。

类型上，架构 §11.4 的 `confirmedBottlenecks` 换成下面两项（总览 §6 S-07 的修订，评审通过后改架构）：

```ts
readonly timingSensitive: readonly {
  readonly cmd: CommandRef; readonly controlRunId: string; readonly window: string
  readonly loopSecondsDelta: number
  readonly recordedWaits: readonly WaitCode[]     // 这条指令记录到的等待原因，只是记录
  readonly gateConfirmed: false                   // 门槛级对照未做
}[]
readonly timingAbsorbed: readonly { readonly cmd: CommandRef; readonly controlRunId: string }[]
```

### 5.5 报告的文字版

`--md` 按路线图 §9.4 第 9 项的格式生成一段，全部由 `StrictCandidateReport` 的字段拼出，不手写数字：

> 按最早合法帧执行，第 2–3 轮每轮 X 战斗秒，记录到等待 Y（其中经对照确认决定轮长的指令为 Z，挡住它们的等待原因记录为 …，门槛级的对照未做）；按意图的等待 N 处（列表）；有效机制候选集（列表）单项及两两组合已查（单项 a/b、两两 c/d），结论在 {…} 下保持不变、在 {…} 下变为 …（或断轴失败）；操作容错（+6f）单列结果为 …；因输入冲突排除的项：…；三项及以上未查；未实现 / 未列出的机制：…；依赖的未证实规则：…

- "依赖的未证实规则"：基准运行的 `summary.assumptions` 对应的命题里，`conclusion` 不是 `supported` 的那些。
- 基准不是"最早合法帧基线"（DD-02 §3.4）时，第一句改成实际的入口与延迟设置。
- 文件开头写明：基准与每个候选的 `runId`、代码提交、数据版本、生成命令。

### 5.6 口径参考：自动谐破下的值

严格轴未含谐度破坏时（`damageScope.tuneBreak.mode === 'omitted'`），报告另跑一次**参考运行**，回答"这个 DPS 打了多少折"：

- 输入：同一场景，覆盖 `strict: false`、`tuneBreak: auto`，去掉 `tuneBreakOmitted`。它是非严格入口的运行，谐破时机是调度器在目标失谐后选的，不是轴的写法。
- 报告字段：
  ```ts
  readonly scopeReference?: {
    readonly runId: string; readonly status: RunStatus
    readonly steadyDps: number | null; readonly steadyLoopBattleFrames: readonly number[] | null
    /** 带"谐度破坏"标签的命中伤害 ÷ 全部命中伤害。分子分母取同一个窗口的同一组命中，由 basis.ts 的 damageShareByTag 算；
     *  不用 summary.enemy.tuneBreakDamage，它是整个统计窗口的量，和稳态窗口不是一回事（DF-24） */
    readonly tuneBreakDamageShare: { readonly steady: number | null; readonly wholeWindow: number | null }
    readonly dpsDeltaVsBaseline: number | null         // 参考 ÷ 基准 − 1
    readonly loopTimeChanged: boolean | null           // 插入谐破后每轮时长变没变
  }
  ```
- `--md` 的文字版在第一句后面加一句："未含谐度破坏（原文没给位置）；同一条轴由调度器自动放谐破时稳态 DPS 为 X（+Y%，其中谐度破坏伤害占 Z%），每轮时长 {不变 / 变为 …}。参考值不是这条轴的结论。"
- 参考运行不进主表、不进覆盖统计，也不参与"结论在哪些候选下保持不变"。
- 另外把 `tuneBreak: manual`（不写谐破，偏谐值照常累积）作为一项策略试验放进 `policyTrials`（DD02-Q6）。它和基准不同，说明失谐状态本身（不只是谐破的伤害）影响了这条轴。

## 6. `pnpm sensitivity` 的改动

只做两处，矩阵的形状不变：
- `flipsOf()` 的每一项带上台账里的类别（`changes`），矩阵的列头标出"策略""输入"；
- 读 `usableBasis` 而不是 `error`（DD-03 §7）。

矩阵仍然是"全部场景 × 全部开关"的 DPS 粗筛，候选检查是"一条轴 × 兼容的候选 × 两两"的结论检查，两者不合并。

## 7. 代表轴转成严格轴

### 7.1 谐度破坏按"原文没给位置"处理

用户 2026-11-14 定（取代路线图 §0.2 第 2 条、§9.4 第 9 项里"照视频读谐破位置"的做法）：教学轴没给谐度破坏位置的，分析时按没打谐度破坏算，并在结果上显式标注（DD-02 §3.7、DD-03 §7.4）。

`m0-video-eq.yaml` 属于这种：B 站简介里的启动轴与循环轴（场景开头注释抄了原文）只写了 A、E、Z、Q、R、跳、闪与切人，没有谐度破坏。原场景用的是缺省的自动谐破，那是调度器替轴选的时机，不是原文的写法。所以严格轴：
- `tuneBreak: off`，`tuneBreakOmitted: { reason: sourceSilent, note: "简介的文字轴没写谐度破坏；实战里自行决定何时打" }`；
- 不读视频。以后如果要研究"作者在视频里实际在哪打了谐破"，另存一份只差这一处的对照场景（`m0-video-eq-视频谐破.yaml`），不改这一份。

### 7.2 新场景

`scenarios/m0-video-eq-不打谐破.yaml`：原场景不改。与原场景的差别只有：
- `options` 加 `strict: true`，`tuneBreak: auto` 改成 `off`；
- 加 `tuneBreakOmitted`（§7.1）；
- 开头注释里的"按键 → 动作"搬进 `notation`（DD-02 §3.6），注释保留一句指向它；
- 开头注释写明：谐度破坏按"原文没给位置"省略（用户 2026-11-14 定），这份的 DPS 不含谐度破坏，和含谐破的轴比较时看口径标注。

按 AGENTS.md，它进 `tests/scenarios.test.ts` 的快照。已知的参考数（路线图 §9.5，`20261019` 数据、当时的代码）：原配置稳态 DPS 40,472，关掉谐破 37,577。新场景跑出来的数以实际运行为准，并与这两个数对一下；对不上就查是哪次代码改动带来的。

### 7.3 跑通与第一份结论

1. `pnpm sim scenarios/m0-video-eq-不打谐破.yaml`：记下完成状态、每轮时长、按意图的等待、提示、`damageScope`。跑不通（某条意图失败）时，这本身就是阶段一的结论之一，照实写，再和用户商量是轴的问题还是模型的问题。
2. `pnpm candidates scenarios/m0-video-eq-不打谐破.yaml --pairs --md docs/m0-strict-conclusion.md`。
3. 在 `docs/m0-strict-conclusion.md` 开头手写"读法"：这份结论能说什么、不能说什么（路线图 §9.3 阶段一那一行），并写明"未含谐度破坏"与 §5.6 的参考值怎么读。
4. 把结论里"依赖的未证实规则"与路线图 §10.1 的实验清单对一遍，标出哪些实验能升级这份结论，交给 DD-08。

路线图 §9.5 写的原配置下的数字（25.00 秒、两对组合效应）是在自动谐破下查的，不能直接搬过来；新场景要重新查。其中"声骸起手优先级 × 关闭谐破"那一对，在新场景里"关闭谐破"已经是基线，相当于只剩声骸起手优先级的单项。

## 8. 阶段一的集成验收（本文负责的部分）

在 `m0-video-eq-不打谐破.yaml` 上：

- [x] 严格入口得到 completed；同一 `runId` 重复运行，日志逐字节相同。
- [x] `strictReport` 列出全部按意图的等待与提示。
- [x] 主表只有机制 / 数据；input-delay 与 manual 在策略试验；auto 因 strictEntry 排除；omitted / sourceSilent 带 scopeReference；不在队的角色命题单列不适用。
- [x] 覆盖数字与行数一致；higherOrderChecked=false。
- [x] 断轴和引擎错误保留 completion（合成用例）；代表轴 11 单项 / 54 对没有失败。
- [x] 结论由命令生成，带各 runId 与命令；固定输入与代码状态重复生成相同。

## 9. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T04-1 | `forteKeepOnSwitchBy` 与 `mergeRulePaths` | `gamedata.ts`、`resolve.ts` 的规则校验、`run.ts`、心与卜灵的角色模块 | C04-1～C04-3；全部场景的结果不变 |
| T04-2 | 台账类型与首批命题 | `propositions.ts` | C04-4 |
| T04-3 | 台账的命令行与文档 | `src/cli/assumptions.ts`、`docs/proposition-ledger.md` | 人工看一次；重复生成不变 |
| T04-4 | 特征、分类、路径冲突 | `candidates.ts` | C04-5、C04-6 |
| T04-5 | 运行、主表、覆盖 | `candidates.ts`、`src/cli/candidates.ts` | C04-7～C04-10 |
| T04-6 | 等待与瓶颈 | `candidates.ts` | C04-11 |
| T04-7 | `pnpm sensitivity` 的两处改动 | `sensitivity.ts`、`src/cli/sensitivity.ts` | 矩阵的数字不变，列头多类别 |
| T04-8 | 口径参考运行（§5.6） | `candidates.ts` | C04-13 |
| T04-9 | 新场景与快照 | `scenarios/m0-video-eq-不打谐破.yaml`、`tests/__snapshots__` | 场景能跑；快照是新增的一条；`damageScope` 正确 |
| T04-10 | 第一份有条件结论 | `docs/m0-strict-conclusion.md`；`docs/m0-conclusions.md` 加一行指向它 | §8 的清单 |

T04-1～T04-8 用合成场景与现有场景验收；T04-9、T04-10 依赖 DD-02 的 T02-10。整个工作包不用视频、不用进游戏。

## 10. 用例

`tests/candidates.test.ts`（合成数据）与 `tests/propositions.test.ts`：

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C04-1 | 合成两个角色，各有一个切走时按 `forteKept` 清状态的钩子。覆盖 `forteKeepOnSwitchBy.甲: false` | 甲清、乙不清；`resolved.rules.forteKeepOnSwitch` 仍是 true |
| C04-2 | 覆盖 `forteKeepOnSwitchBy.乙: false`；两个都覆盖；只写旧的 `forteKeepOnSwitch: false` | 乙清甲不清；都清且 `Rules` 其余键不变；都清 |
| C04-3 | `mergeRulePaths` 给一个不存在的首段；给 `forteKeepOnSwitchBy.甲` 与已有的 `forteKeepOnSwitchBy: { 乙: false }` | 前者返回问题；后者合并后两个键都在 |
| C04-4 | 台账自检 | ID 唯一；每条恰有一个候选是 `adopted`，且它的 `binding.value` 等于 `Rules` / `options` 的缺省值；`rule` 绑定的路径首段是 `Rules` 的键；`flipsOf()` 的 15 个取值每个都能在台账里找到绑定相同的候选；`assumptionId` 都在 `ASSUMPTIONS` 里 |
| C04-4b | DF-05 | 场景只写旧的 `forteKeepOnSwitch: false`，心与卜灵都在队里 | 两条 `forte-keep.*` 的当前生效候选都是 `clear`；要试的是 `keep`，不会再把 `clear` 当成待翻的候选 |
| C04-5 | 严格、含手写谐破的合成场景，对一份小台账分类 | `tuneBreak: off` 的候选被排除，原因含 `hasManualTuneBreak`；`auto` 被排除，原因含 `strictEntry`；`inputDelay: 6` 在策略试验里；带 `appliesToChars`、角色不在队的在"不适用"里；未实现的在未实现里 |
| C04-6 | `pathConflict`：同路径不同值；`a.b` 与 `a`；`rule` 的 `x` 与 `option` 的 `x`；同路径同值 | 冲突；冲突；不冲突；不冲突 |
| C04-7 | 小台账里放一个让合成轴 `axisFailed` 的候选（例如把切人锁打开导致连段断） | 它在 `mechanismOutcomes` 里，`status === 'axisFailed'`，`completion.axisFailure` 有值；`coverage.axisFailedCount === 1`；主表行数等于 `singlesPlanned + pairsPlanned − 排除的对数` |
| C04-8 | 两个候选各自不改变轮长、组合后改变（合成：A 让某动作可提前取消，B 让冷却提前转好，单独都被另一个门槛挡住） | 两个单项 `loopTime: 'same'`，那一对 `loopTime: 'changed'` |
| C04-9 | 同一命题的两个候选 | 不出现在任何一对里 |
| C04-10 | 一个候选让钩子抛错 | 行在表里，`status === 'engineError'`；`coverage.singlesRun` 比 `singlesPlanned` 少 1 |
| C04-11 | 合成轴：一条指令等冷却 30 帧，且它决定轮长；另一条等 10 帧但后面有更长的等待吸收 | 前者在 `timingSensitive`，`loopSecondsDelta > 0`，`gateConfirmed === false`；后者在 `timingAbsorbed` |
| C04-14 | DF-20 的双门槛例子：甲 `E` 耗 10 能量、冷却 30、动作 1 帧；判定第 0 帧生成、延迟 29 帧给回 10 能量；初始能量 10；轴 `甲 E`、`甲 E` | 第二条在 `timingSensitive`，`recordedWaits` 含 `cooldown`；报告与文字版里没有"冷却是瓶颈"这类门槛级的结论 |
| C04-15 | DF-20 ①：基准稳态 DPS 100000、`spread` 0.02，候选在同样的轮次窗口里是 101000 | `dps.status === 'changed'`、`ratio` 约 0.01、`withinWindowVariation === true` |
| C04-16 | DF-24：严格轴有启动轴，参考运行里启动轴的谐破伤害占比与稳态明显不同 | `tuneBreakDamageShare.steady` 与 `wholeWindow` 分开给出，且各自的分子分母来自同一个窗口 |
| C04-13 | 严格、声明省略谐破的合成场景（敌人偏谐值打得满） | 报告有 `scopeReference`，它的 `runId` 不同于基准、`status` 照实；`tuneBreakDamageShare.steady > 0`；参考运行不在主表与覆盖统计里；`manual` 那一项在 `policyTrials` 里 |
| C04-12 | 对同一场景跑两次报告 | 两份 `StrictCandidateReport` 经 `canonicalJson` 后相同 |

## 11. 要同步的正式文档

- 总设计 T16：假设表扩成台账；§13 的假设列表指向台账。
- TD-02：`Rules.forteKeepOnSwitchBy`、台账与候选报告的类型。
- TD-08：心、卜灵的钩子读 `forteKept`。
- TD-10 §6："单项 + 两两组合"的检查口径、候选的四类、与敏感度矩阵的分工。
- AGENTS.md：命令表加 `pnpm candidates`、`pnpm assumptions --ledger`；文档表加 `proposition-ledger.md`、`m0-strict-conclusion.md`。

## 12. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD04-Q1 | 命令的名字 | A：新命令 `pnpm candidates`；B：`pnpm sensitivity <场景> --pairs` | A。两者的问题不同（§6），合在一个命令里参数会互相打架 |
| DD04-Q2 | 瓶颈的对照用什么 | — | 按 DF-20 收口：保留"晚 6 帧"的对照，它只确认"这条指令的时刻决定轮长"（`timingSensitive`），不确认是哪一项等待门槛；门槛级对照第一版不做（§5.4） |
| DD04-Q3 | ~~谐破周期和轴周期不一致时怎么写严格轴~~ | — | 用户 2026-11-14 定原文没给位置时不打谐破（§7.1），这一项不再需要。以后有给了谐破位置、且周期对不上的轴时再议 |
| DD04-Q4 | 首批命题的范围 | A：15 个可翻取值 + 代表轴碰到的；B：40 条全拆 | A（路线图 §5.2） |
| DD04-Q5 | "DPS 不变"的判据 | — | 按 DF-20 收口：`same` 只表示数值相同（相对差 ≤ 1e-9），实际的差照给；另报"没超过把窗口挪一轮的变化幅度"。`spread` 不当误差条用（§5.3） |
