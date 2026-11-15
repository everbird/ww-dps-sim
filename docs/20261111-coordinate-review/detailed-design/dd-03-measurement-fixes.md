# DD-03 量尺与报告修复

**版本**：v0.4，2026-11-14，Claude。v0.2 按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10：DF-01、DF-21、DF-24）；v0.3 按 Codex 第二轮复核修订（意见文件 §13：DF-25 的统计窗口完整性）；v0.4 改正 `roundEnds` 的记法（意见文件 §16）。
**状态**：Final（2026-11-15）。本文 v0.4 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。还没实现。
**阶段**：一。**前置**：DD-01（只有 §7 需要；§3–§6、§8 不需要）。**被依赖**：DD-04、DD-08、DD-09。

## 1. 范围与依据

路线图 §9.4 第 1–6 项，架构 §3.2、§10.1、§10.2、§10.4。六项修复互相独立，可以分给不同的执行者，各自提交：

| 节 | 问题 | 一句话 |
|---|---|---|
| §3 | R01 | 一轮时长的校准点写明时钟 |
| §4 | R06 | 跳字的校准点写明暴击分支；另加区间、用途、条件 |
| §5 | R09 | `buffApply` / `buffExpire` 带提供者与实例号；覆盖率按提供者统计 |
| §6 | R10 | 按击杀拆分伤害时包含致死一击 |
| §7 | R11 | 截断与失败的运行不进比较 |
| §8 | R03 的 P0 部分 | 贴合度在没有有效观测时报"不可评估" |

不做：贴合度的一对一匹配与资格签名（DD-09）；`compareObservations` 的完整接口（DD-08）。

每项只阻塞依赖它的消费者（路线图 §9.1 第 1 条），不阻塞 DD-05～DD-07。

## 2. 现状

| 问题 | 事实 | 位置 |
|---|---|---|
| R01 | `loop` 点的注释写"世界秒，含时停、顿帧"；取值是 `span.endT − span.t`，`t` 是战斗秒 | `calibration.schema.ts`；`calibration.ts` 的 `simValue` |
| R01 | `LoopSpan` 同时带世界帧 `f`、`endF` 与战斗秒 `t`、`endT` | `trace.ts` 的 `loopSpan` |
| R06 | 跳字返回 `[nonCrit, crit]`，`calibrate` 用 `reduce` 取离实测近的那个当 `matched` | `calibration.ts` |
| — | `points.yaml` 现有 37 个点，`game` 全是空的（待实测） | `docs/calibration/points.yaml` |
| R09 | `buffApply` 事件只有 `buff`、`target`、`stacks`、`remaining`；`buffExpire` 只有 `buff`、`target`、`reason` | `types.ts` 的 `SimEvent` |
| R09 | 写这两种事件的地方共 4 处：`applyBuff`、`extendBuff`、`removeBuff`、`consume` 里"只消耗几层" | `buffs.ts`、`triggers.ts` |
| R09 | `BuffRuntime` 有 `id` 与 `owner` | `types.ts` |
| R09 | `buffUptime` 的键是 `"buff→目标"`；同键第二次 `buffApply` 时 `since` 已有值，不另起一段；第一条 `buffExpire` 就把这一段关了 | `summary.ts` 的 `buffUptime` |
| R10 | `killOf` 返回累计伤害达到血量的那一下的战斗帧；`goalSummary` 把它当窗口的 `hi` | `summary.ts` |
| R10 | `dpsBreakdown` 用 `f < b.lo \|\| f >= b.hi` 过滤，致死那一下与同帧的命中全被排除 | `analysis.ts` |
| R11 | 到帧数上限、指令已发完时只记一条警告，没有 `error`；各消费者只看 `res.error` | `scheduler.ts` 的 `runLoop`；`analysis.ts`、`sensitivity.ts`、`search.ts`、`plan.ts` 等 |
| R03 | 没有锚点对上时 `f0 = 0`、`v0 = 0`，照样算出各项；没有 `video.events`、`hp` 等时 `score` 是 0 | `fit.ts` 的 `replayFit` |

## 3. R01：一轮时长的时钟

**schema**（`calibration.schema.ts` 的 `loop` 分支）：

```ts
z.strictObject({ ...Base, kind: z.literal('loop'), loop: z.number().int().min(0),
  clock: z.enum(['battle', 'world']).default('battle') })
```

- 缺省 `'battle'`：与现有取值一致，旧写法的点含义不变。
- 那一行的注释改成："一轮的时长。`clock: battle` 是战斗秒（大招过场的全局时停里不走，深塔倒计时是这个）；`clock: world` 是世界秒（按视频时间量的是这个）。"

**取值**（`calibration.ts` 的 `simValue`）：

```ts
case 'loop': {
  const span = loopSpan(log, p.loop)
  if (!span) return `没有第 ${p.loop} 轮`
  return [p.clock === 'world' ? (span.endF - span.f) / 60 : span.endT - span.t]
}
```

**文档**：`docs/calibration/README.md` 里说明一轮时长的地方加上 `clock`，写明两种量法各对应哪个。

## 4. R06：跳字的分支，以及区间、用途、条件

### 4.1 schema

公共字段 `Base` 加：

```ts
gameRange: z.tuple([z.number(), z.number()]).refine(([a, b]) => a <= b).optional(),   // 区间读数；与 game 二选一
purpose: z.enum(['given', 'formulation', 'selection', 'independent_validation', 'unspecified']).default('unspecified'),
condition: z.strictObject({
  gameVersion: z.string().default('unknown'),
  recordedAt: z.string().optional(),
  note: z.string().optional(),                 // 配装、敌人、环境、初态里与场景不同或不确定的
  unknowns: z.array(z.string()).default([]),   // 明说哪些不知道
}).optional(),
```

`hit` 分支加 `branch: z.enum(['crit', 'nonCrit', 'unknown']).default('unknown')`。

文件级校验（`CalibrationFileSchema.superRefine`）：`game` 与 `gameRange` 不能同时给。

### 4.2 比对结果

```ts
export type ComparisonStatus = 'passed' | 'conflicted' | 'unmatched' | 'ambiguous' | 'insufficientCondition' | 'unassessable'

export interface BranchResidual { readonly sim: number; readonly diff: number; readonly within: boolean }

export interface CalibrationResult {
  point: CalibrationPoint
  sim: number[] | null
  error?: string
  /** 跳字才有：两支各自的仿真值与残差 */
  branches?: { readonly nonCrit: BranchResidual; readonly crit: BranchResidual }
  /** 拿来比的仿真值。跳字且 branch 是 unknown 时为 null：不替观测选分支 */
  matched: number | null
  diff: number | null
  comparison: ComparisonStatus
  /** @deprecated 旧的四值状态，由 comparison 派生，给现有的表格输出用 */
  status: 'ok' | 'off' | 'todo' | 'error'
}
```

`ComparisonStatus` 定义在 `src/engine/observations.ts`（新文件，本文只放这个类型；DD-08 往里加内容），`calibration.ts` 从那里引用。

判定规则：

| 情形 | `comparison` | `matched` / `diff` | 旧 `status` |
|---|---|---|---|
| 取不到仿真值 | `unmatched` | null | `error` |
| `game` 与 `gameRange` 都没有 | `unassessable` | null | `todo` |
| 面板、时长，或跳字且 `branch` 是 `crit` / `nonCrit`：残差在容差内 | `passed` | 那个值 | `ok` |
| 同上，超出容差 | `conflicted` | 那个值 | `off` |
| 跳字、`unknown`：两支都超出容差 | `conflicted` | null | `off` |
| 跳字、`unknown`：恰有一支在容差内 | `ambiguous` | null | `ok` |
| 跳字、`unknown`：两支都在容差内 | `ambiguous` | null | `ok` |

- `unknown` 时不论哪种，`branches` 里两支的残差都列出。
- "恰有一支在容差内"仍是 `ambiguous`：它只说明"存在相容的解释"，证明不了那一下确实暴击了（路线图 §6.1）。旧 `status` 给 `ok` 是为了现有的 `tests/calibration.test.ts` 不把它当失败。
- **残差的算法**。点值：`diff = sim / game − 1`（`game` 为 0 时用差值，同基线）。区间 `[lo, hi]`：`sim` 在区间里 `diff = 0`；低于 `lo` 是 `sim / lo − 1`；高于 `hi` 是 `sim / hi − 1`。容差照旧取 `p.tolerance ?? DEFAULT_TOLERANCE[kind]`。

### 4.3 输出

- `pnpm calibrate`（`src/cli/calibrate.ts`）的表：跳字且 `unknown` 的行两支各占一列残差，状态写"相容（分支未知）"或"冲突"；`purpose` 不是 `independent_validation` 的点在表尾汇总里单独计数，不算进"独立检验通过 N 个"。
- `tests/calibration.test.ts`：失败条件改成 `comparison === 'conflicted'`。
- 现有 37 个点不用改：`branch` 缺省 `unknown`、`clock` 缺省 `battle`、`purpose` 缺省 `unspecified`。

## 5. R09：同名 buff 的提供者

### 5.1 事件字段

`buffApply`、`buffExpire` 各加两个**业务字段**，一直都有，进 conformance：

```ts
| (EventBase & { type: 'buffApply'; buff: string; owner: CharName | 'env'; instanceId: number; target: …; stacks: number; remaining: number | 'inf' })
| (EventBase & { type: 'buffExpire'; buff: string; owner: CharName | 'env'; instanceId: number; target: …; reason: … })
```

- `instanceId` 取 `BuffRuntime.id`；`owner` 取 `BuffRuntime.owner`，槽位换成角色名。
- 4 个写入点都补（§2 的表）。`buffs.ts` 里加一个内部函数 `ownerName(s, b.owner)`，4 处共用。
- `OUTPUT_SCHEMA_VERSION` 加 1。
- 钩子的 `onEvent` 会看到新字段。基线上的角色模块有没有按字段全等比较或展开这两种事件的写法，T03-3 时 `grep "buffApply\|buffExpire" data/curated` 核对一遍；只读已有字段的不受影响。

### 5.2 覆盖率

`summary.ts`：

```ts
export interface BuffUptimeRow { readonly buff: string; readonly owner: CharName | 'env'; readonly target: CharName | 'enemy'; readonly uptime: number }

/** 按实例跟踪，[lo, hi) 是战斗帧。返回按"提供者、buff、目标"的明细，与按"buff→目标"的并集 */
export function buffUptimeDetail(log, lo, hi): { rows: BuffUptimeRow[]; union: Record<string, number> }
/** 兼容：等于 buffUptimeDetail(...).union */
export function buffUptime(log, lo, hi): Record<string, number>
```

算法：
1. 按 `instanceId` 跟踪每个实例的存在区间：第一条 `buffApply` 开始，`buffExpire` 结束（`timeout` 的那一帧整帧算在内，同基线）；日志结束时还在的算到 `hi`。同一实例的后续 `buffApply`（叠层、延长、消耗几层）不另起区间。
2. **明细**：同一个（提供者、buff、目标）下各实例的区间取并集，求与 `[lo, hi)` 重叠的帧数，除以窗口帧数。
3. **并集**：同一个（buff、目标）下所有提供者的区间取并集，再同样求比例。这就是"显式聚合"：两个人各给的同名 buff，合起来的覆盖率是"至少有一份在"的时间，不超过 1。
4. 到期当帧又挂上的：区间在并集里自然接上，不会算两次（基线靠 `ended` 表处理的那种情形）。
5. 输出顺序显式：`rows` 按 buff、提供者槽位（`env` 最后）、目标排序；`union` 的键按码点排序。

`Summary` 加 `buffUptimeBy: BuffUptimeRow[]`；`buffUptime` 保留，含义改为上面的并集。

**数值会变的场景**：只有"同一个 buff 定义、同一个目标、不同提供者、区间有先后重叠"的。T03-4 跑全部场景，把 `buffUptime` 变了的键与前后数值列进提交说明，逐个确认是这种情形。DPS 不受影响（覆盖率只是报告）。

`analysis.ts` 的 `Comparison.uptime` 仍按 `"buff→目标"` 的并集比；另加 `uptimeBy`（按三元组的差），`pnpm compare` 在并集有差、且该 buff 有多个提供者时展开显示。

## 6. R10：按击杀拆分伤害

### 6.1 致死事件

`summary.ts` 的 `killOf` 改成同时返回致死事件的位置与溢出。它现在只收到 `hits`，要改成能拿到日志下标：

```ts
interface KillPoint { readonly frame: number; readonly eventSeq: number; readonly rawDamage: number; readonly overflow: number }
```

- `eventSeq`：致死那条 `hit` 在日志里的下标；
- `rawDamage`：从头到这一下为止的原始伤害之和（含这一下的全额）；
- `overflow = rawDamage − hp`。

`Summary.kill` 加 `eventSeq: number | null`、`overflow: number | null`（没打到时都是 null）。`Summary.goal`（`kind: 'kill'`）加可选的 `lethal?: { eventSeq: number; rawDamage: number; overflow: number }`，`reached` 为真时才有。两处各记各的：`kill` 按 1 倍血 `enemy.hp`，`goal` 按目标血量 `goal.hp`。

### 6.2 拆分

`Basis` 加可选的 `lethal?: { eventSeq: number; overflow: number }`，`basisOf` 在目标是击杀且打到了的时候填上。

```ts
export interface DamageBreakdown {
  /** 窗口内各项的伤害。击杀口径下是有效扣血：致死那一下只算打掉的剩余血量 */
  readonly damageByChar: Map<string, number>; readonly damageByAction: Map<string, number>
  /** 每秒伤害 = 伤害 ÷ 窗口秒数。zeroDuration 时是空的 */
  readonly byChar: Map<string, number>; readonly byAction: Map<string, number>
  readonly zeroDuration: boolean
  /** 击杀口径才有：致死那一下的溢出量，以及按原始伤害算的两张表 */
  readonly overflow?: number
  readonly rawByChar?: Map<string, number>; readonly rawByAction?: Map<string, number>
}
export function dpsBreakdown(res: SimResult, b: Basis): DamageBreakdown
```

选哪些命中：
- **`b.lethal` 有值（击杀口径）**：日志下标 `≤ b.lethal.eventSeq` 的 `hit`。包含致死那一下；不包含同一帧里排在它后面的。
- **否则（普通窗口）**：战斗帧在 `[lo, hi)` 里的，同基线。

每条的值：击杀口径下致死那一下取 `hitValue(e) − overflow`，其余取 `hitValue(e)`。`raw*` 两张表里致死那一下取全额。

不变式（用例里断言，按 `num.ts` 的口径比）：
- 击杀口径：`Σ damageByChar = b.damage = 目标血量`；`Σ rawByChar − overflow = 目标血量`；
- `!zeroDuration` 时：`Σ byChar = b.dps`；
- 击杀发生在战斗帧 0：`zeroDuration === true`，`damage*` 照常有值，`byChar`、`byAction` 为空。调用方显示"零时长"，不靠给时间加 1 帧躲开除零。

`byChar`、`byAction` 两个字段名与含义不变，现有调用方不用改。`pnpm compare` 在击杀口径下多打印一行溢出量。

## 7. R11：截断与失败的运行不进比较

DD-01 已经让每次运行带 `completion`。这里把它接到消费者上。

### 7.1 一个判断函数

放在新文件 `src/engine/basis.ts`：它属于执行核心包的汇总组，与 `summary.ts` 同层。`analysis.ts` 现有的 `basisOf` 也挪过来，`analysis.ts` 原样再导出，调用方不用改。这样 DD-07 的 `diffRuns`（①D 查询层）与分析层共用同一个判定，不会出现 ①D 引 ④ 的反向依赖，阶段一的分层检查就能通过（DF-21）：

```ts
export type BasisResult =
  | { readonly ok: true; readonly basis: Basis }
  | { readonly ok: false; readonly status: RunStatus; readonly reason: string; readonly partial?: Basis }

/** 这次运行的比较口径能不能当结论用 */
export function usableBasis(res: SimResult): BasisResult
```

规则（按目标的种类分开，DF-25）：

| `completion.status` | 目标 | 条件 | 结果 |
|---|---|---|---|
| `engineError` | 任意 | — | `ok: false`，没有 `partial` |
| `axisFailed` | 任意 | — | `ok: false`，`reason` 取失败明细；有 `partial`，只供排错时看 |
| `completed` 或 `truncated` | 稳态，且有稳态 | 稳态的每一轮都完整（见下） | `ok: true` |
| `completed` 或 `truncated` | 稳态，且有稳态 | 有一轮不完整 | `ok: false`，`reason` 写明是哪一轮、缺在执行上还是统计上；有 `partial` |
| `completed` | 稳态，但没有稳态（不到 2 轮） | — | `ok: true`，比较口径是整个统计窗口 |
| `truncated` | 稳态，但没有稳态 | — | `ok: false`：整个窗口被截断了 |
| `completed` | 击杀或前 N 秒 | 达到或没达到都算 | `ok: true`。没达到时是基线已有的估计策略：`basis` 用估计值，并有 `goalNotReached` 警告，由 `basis.label` 与警告说明 |
| `truncated` | 击杀或前 N 秒 | 达到了 | `ok: true` |
| `truncated` | 击杀或前 N 秒 | 没达到 | `ok: false`，`reason: '到帧数上限时目标还没达到：…'`，带 `truncation.remains`；有 `partial` |

估计策略只用于击杀与前 N 秒两种目标，不再作为所有 `completed` 运行的兜底；稳态的所选轮次没有完整统计覆盖时一律 `ok: false`（DF-25）。

**稳态的一轮怎样算完整**。架构 §2.4 说稳态的 `goal.reached` 是"有稳态，且稳态包含的每一轮都完整走完"。这里落成两个同时成立的条件：
- **执行上**：这一轮 `r ≤ completion.loops.completed`，即它的结束边界在日志里确认了（DD-01 §3.6，DF-01）；
- **统计上**：这一轮**真实的**结束边界 `completion.loops.roundEnds.find(x => x.loop === r)?.endBattleFrame` 不晚于统计窗口的终点 `summary.windowFrames`。按 `loop` 找条目，不把轮号当数组下标：有没有启动轴（第 0 轮）会改变下标（Codex §14.2）。找不到条目（这一轮的结束边界没确认）就是不完整。

统计上这一条不能用"`basisOf` 给的稳态窗口落在汇总窗口里"来判：基线的 `summary.loops()` 已经按 `endAt` 把最后一轮的终点裁成了窗口终点，`basisOf` 又是从裁过的结果得到稳态窗口的，裁过的窗口当然落在它自己里面。Codex 的反例：只有一个 100 帧动作、判定在局部帧 99 命中、`repeat: 2`，两轮都自然执行完；不写 `endAt` 时稳态窗口 `[100, 200)`、伤害 463.25，写 `endAt: 150` 时日志逐条相同，稳态窗口却是 `[100, 150)`、伤害 0。`roundEnds` 来自日志里的轮边界，不受 `endAt` 影响（DD-01 §3.6），用它比较就能发现第 2 轮只统计了一半。

不自动退回更早的完整轮次：那样要同步改窗口的选法、标签与跨运行的可比条件。这一版只判"能不能当结论用"。

于是"截断但稳态各轮完整"的运行仍可用；"截断在稳态的某一轮中间"、"末轮的指令发完了但动作还在场上"、"执行完整但 `endAt` 截掉了稳态的一部分"都不可用。

### 7.2 消费者

把"`res.error ? 失败 : basisOf(res)`"这类写法统一换成 `usableBasis`。逐个文件：

| 文件 | 现在 | 改成 |
|---|---|---|
| `analysis.ts` 的 `compare` 及边际 | 看 `error` | 任一边 `ok: false` 就返回带原因的失败结果，不出差值 |
| `sensitivity.ts` 的 `cell` | `res.error ? {dps: null, error: code} : …` | `Cell` 加 `status: RunStatus`；`ok: false` 时 `dps: null`、`error` 写状态与原因 |
| `search.ts`、`plan.ts` | 跑不通的候选不排名 | 同样处理 `ok: false`；结果表里把"截断"与"轴失败"分开标 |
| `insight.ts`、`scorecard.ts`、`cards.ts`、`optimize.ts`、`matrix.ts`、`sample.ts` | 看 `error` | 同上 |
| `fuzz.ts` | 看 `error` 与 `checkLog` | `engineError` 单独计数并让 `pnpm fuzz` 以非零退出；`axisFailed`、`truncated` 是变体轴的正常结果 |
| `src/cli/sim.ts` | 打印报错 | 打印完成状态一行；截断时列 `remains`；`ok: false` 时在 DPS 前标"不完整，不能当结论" |
| `web/app` 的运行页 | 显示 `error` | 显示完成状态；截断时在汇总上方加一条提示。只改文字，不改布局 |

T03-6 先 `grep -n "\.error" src/engine src/cli web/app/src` 列全，每处归到上表的一行，列表贴进提交说明。

这些文件在这一步从 `simulate` 迁到 `prepareResolved` + `runPrepared`，或者继续用兼容外壳但读 `res.completion`，两种都可以；`sensitivity`、`insight` 的入口改造留给 DD-04。

### 7.3 `uncaught` 的处理

兼容外壳对 `uncaught` 的引擎错误会重新抛出（DD-01 §3.7）。上表里原来有 `try / catch` 的消费者（`sensitivity` 的 `cell`、`fit` 的 `run`）保持接住，但结果记成 `status: 'engineError'`，不再和"轴跑不通"混在同一个 `error` 文本里。

### 7.4 口径标注：未含谐度破坏的结果

DD-02 §3.7 给每次运行定了 `damageScope`。比较层这样用它：

- **`Basis` 带上口径**：`basisOf` / `usableBasis` 返回的 `Basis` 加 `scope: DamageScope`。它不影响 `ok` 与否：未含谐度破坏的结果照样可用，只是口径不同。
- **两边口径不同时照算，但必须标出**。`Comparison` 加：
  ```ts
  readonly scopeMismatch?: { readonly base: DamageScope; readonly other: DamageScope; readonly differsIn: readonly ('mode' | 'gauge')[]; readonly note: string }
  ```
  `pnpm compare` 在差值上方先打印一行，例如"口径不同：基准未含谐度破坏（原文没给位置），对比是自动谐破。差值里包含谐度破坏的伤害，不全是轴的差别"。
- **"口径相同"的判据**（DF-24）：`mode` 相同，并且两边都是 `omitted` 时 `gauge` 也相同。`omitted/off` 与 `omitted/accumulates` 是不同口径：后者目标会失谐，依赖失谐的效果会触发。`reason` 不同（原文没给、当时游戏里没有、刻意不打）不算口径不同，只在输出里并列显示。
- **一张表里有多条轴的**（`pnpm scorecard`、`pnpm matrix`、敏感度矩阵的场景行、网页的对比页）：加一列"谐破"，取值 `含`（`written`）/ `自动`（`auto`）/ `含+自动`（`writtenPlusAuto`）/ `未含`（`omitted`、`gauge: 'off'`）/ `未含·量表累积`（`omitted`、`gauge: 'accumulates'`），原因写在悬停或脚注里。按 DPS 排名的表里，口径与第一名不同的行带一个标记，表尾脚注解释。不自动剔除，也不自动换算。
- **同一条轴的变体**（`pnpm run search`、`pnpm plan`、候选检查）：口径相同，不加列；变体若改变了口径（例如候选把 `tuneBreak` 翻成 `auto`），那一行标出。
- **"打了多少折"由单独的参考运行回答**，不在比较层里估：DD-04 §5.6 对严格轴另跑一次自动谐破，作为参考值并排列出。
- **`Summary` 的文字输出**：`pnpm sim` 在 DPS 那一行后面加"（未含谐度破坏：原文没给位置）"这类说明。

## 8. R03 的 P0 部分：没有有效观测时"不可评估"

`fit.ts` 的 `Fit` 改两处：

```ts
export interface Fit {
  …
  /** 有没有可比的数据。anchors = 对上的时间锚点数 */
  coverage: { anchors: number; events: number; eventsMatched: number; hp: number; concerto: number; core: number }
  assessable: boolean
  score: number | null          // 不可评估时 null
}
```

- **不可评估的条件**：`coverage.anchors === 0`。没有任何一个时间锚点对上，视频秒与世界帧的换算就没有依据（基线这时用 `f0 = 0`、`v0 = 0`，后面各项全是在错的时间轴上比出来的）。此时各分项仍然返回（供排错），`score` 是 null。
- **另一种不可评估**：有锚点，但除了锚点自身以外没有任何观测（`events`、`hp`、`concerto`、`core` 都没有），且锚点只有 1 个。一个锚点只定了对齐，自己的残差恒为 0，没有东西可比。
- `fitVariants`：
  - 原场景不可评估时直接抛错，说明缺什么；
  - 变体里不可评估的不参与排序，放进 `FitReport.unassessable: FitRow[]`；
  - 排序函数里 `score` 为 null 的不与数字比较。
- `src/cli/fit.ts`：不可评估的行显示"不可评估：没有对上的锚点"，不显示 0。

这里只堵住"没有可比数据却报出一个好分数"。删动作反而得分更好、参照跟着候选变、规则候选与改轴候选混排，都留给 DD-09。

## 9. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T03-1 | R01 | `calibration.schema.ts`、`calibration.ts`、`docs/calibration/README.md` | C03-1 |
| T03-2 | R06 与公共字段 | 同上，加 `observations.ts`（只有类型）、`src/cli/calibrate.ts`、`tests/calibration.test.ts` | C03-2～C03-5；`pnpm calibrate` 对现有 37 个点的输出只是多了列，状态都是待测 |
| T03-3 | R09 事件字段 | `types.ts`、`buffs.ts`、`triggers.ts` | conformance 输出里这两种事件各多两个键，其余逐字节相同；快照不变（汇总没变） |
| T03-4 | R09 覆盖率 | `summary.ts`、`analysis.ts`、`src/cli/compare.ts` | C03-6、C03-7；变了的 `buffUptime` 键逐个列出 |
| T03-5 | R10 | `summary.ts`、`analysis.ts`、`src/cli/compare.ts` | C03-8～C03-11 |
| T03-6 | R11 | `src/engine/basis.ts`（新）与 §7.2 的各文件 | C03-12～C03-14、C03-20a～C03-22；现有测试全过；`tests/layering.test.ts` 把 `basis` 列为核心文件 |
| T03-8 | 口径标注（§7.4） | `analysis.ts`、`src/cli/compare.ts`、`src/cli/sim.ts`、`scorecard.ts`、`matrix.ts`、`src/cli/sensitivity.ts`、网页的对比页 | C03-17、C03-18 |
| T03-7 | R03 的 P0 部分 | `fit.ts`、`src/cli/fit.ts` | C03-15、C03-16；`pnpm fit scenarios/xin-tower4-video.yaml` 的原场景分数不变 |

## 10. 用例

`tests/calibration-clock-branch.test.ts`：

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C03-1 | 人造日志：第 1 轮的 `loop` 事件在 `f = 0, t = 0`，第 2 轮的在 `f = 600, t = 6`（中间有 4 秒全局时停） | `clock: 'world'` 得 10；`clock: 'battle'` 得 6；不写 `clock` 得 6 |
| C03-2 | 一下跳字，仿真不暴击 1000、暴击 2000，容差 0.2%。`branch: 'crit'`、`game: 2000` | `passed`，`matched === 2000` |
| C03-3 | 同上，`branch: 'nonCrit'`、`game: 2000` | `conflicted`（不会因为暴击那一支对得上而通过） |
| C03-4 | 同上，不写 `branch`、`game: 2000` | `ambiguous`；`matched === null`；`branches.crit.within === true`、`branches.nonCrit.within === false`，两支的 `diff` 都有 |
| C03-4b | 同上，`game: 1500` | `conflicted`；两支残差都列出 |
| C03-5 | `gameRange: [0.75, 0.85]` 的面板点，仿真 0.80 / 0.70 | 前者 `passed`、`diff === 0`；后者 `conflicted`、`diff ≈ 0.70 / 0.75 − 1` |
| C03-5b | 同时写 `game` 与 `gameRange` | schema 报错 |

`tests/summary-boundaries.test.ts`：

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C03-6 | 合成队伍：甲、乙各有一个 id 相同（`同名`）、目标是敌人、持续 120 战斗帧的 buff。甲在战斗帧 0 挂、乙在 60 挂；窗口 `[0, 240)` | 日志里两条 `buffApply` 的 `owner` 不同、`instanceId` 不同；`buffUptimeBy` 里甲、乙各 0.5（按 `timeout` 那一帧算在内的口径写出确切值）；`buffUptime['同名→enemy']` 是并集 0.75 的那个确切值。基线的结果是只算到甲到期（约 0.5），断言不等于它 |
| C03-7 | 同一个人的同一个 buff 到期当帧又挂上 | 并集里不重复计那一帧；整段不断时等于 1，不超过 1 |
| C03-8 | 敌人血 1000；一下 1500 的命中在战斗帧 30，目标 `kill: 1` | `goal.lethal.overflow === 500`；`Σ damageByChar === 1000`；`Σ rawByChar === 1500`；`Σ byChar === goal.dps`（不是 0） |
| C03-9 | 同一帧三下各 400，血 1000 | 致死的是第三下，`overflow === 200`；三下都在内 |
| C03-9b | 同一帧四下各 400，血 1000 | 第四下不在击杀口径里：`Σ damageByChar === 1000`，`damageByAction` 里第四下所属动作的值不含它 |
| C03-10 | 战斗帧 0 一下打死 | `zeroDuration === true`；`damageByChar` 有值；`byChar.size === 0` |
| C03-11 | 稳态口径的普通场景 | `dpsBreakdown` 的 `byChar`、`byAction` 与改之前逐项相同 |
| C03-12 | `repeat: 4`，`maxFrames` 卡在第 3 轮中间（稳态是第 2–3 轮） | `usableBasis` 返回 `ok: false`，`status: 'truncated'`；`compare` 拿它当任一边时不出差值 |
| C03-13 | `repeat: 4`，`maxFrames` 卡在第 4 轮结束后、还有判定在途 | `status: 'truncated'`、`inFlightRemains`，但稳态第 2–3 轮完整：`ok: true` |
| C03-17 | 同一条轴，`tuneBreak: off` 加 `tuneBreakOmitted` 与 `auto` 各跑一次，`compare` | 结果有 `scopeMismatch`，两边的 `mode` 分别是 `omitted` 与 `auto`；终端输出第一行是口径提示 |
| C03-18 | `scorecard` 一张表里放一条未含谐破的轴与一条自动谐破的轴 | "谐破"一列分别是"未含"与"自动"；口径与第一名不同的行带标记 |
| C03-19 | DF-24 | 同一条轴 `off` 与 `manual`（都不写谐破、都声明省略）`compare` | `scopeMismatch.differsIn` 是 `['gauge']`；两条声明的 `reason` 不同而 `mode`、`gauge` 相同时没有 `scopeMismatch` |
| C03-20a | DF-01 的反例：执行截断 | `repeat: 2`，稳态是第 2 轮，第 2 轮末条动作还在场上时截断 | `usableBasis` 返回 `ok: false`，原因是执行上第 2 轮没完成 |
| C03-20b | DF-25 的反例：执行完整、统计裁剪 | 只有一个 100 帧动作、判定在局部帧 99 命中、`repeat: 2`，`endAt: 150` | 状态 `completed`，`completion.loops.completed === 2`（与不写 `endAt` 时相同）；第 2 轮的 `roundEnds` 是 200，晚于 150，`usableBasis` 返回 `ok: false`，原因是统计窗口截掉了第 2 轮的后半段 |
| C03-21 | DF-25：同上，`endAt: 200` | `ok: true`，稳态窗口 `[100, 200)` |
| C03-22 | DF-25：自然完成，但击杀目标没打到 | `ok: true`，用估计值，有 `goalNotReached` 警告（估计策略没有被误禁） |
| C03-14 | 敏感度矩阵里某个翻转让轴 `axisFailed`、另一个让钩子抛错 | 前一格 `status: 'axisFailed'`、`dps: null`；后一格 `status: 'engineError'`；两格的文字不同 |

`tests/fit.test.ts`（在现有文件里加）：

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C03-15 | `video.marks` 的键都指向不存在的行（锚点全部失配），没有别的观测 | `assessable === false`，`score === null`，`coverage.anchors === 0` |
| C03-16 | `fitVariants` 里某个变体把所有带锚点的行都挪没了 | 它在 `unassessable` 里，不在 `rows` 的排序里 |

## 11. 验收清单

- [x] 路线图 §9.2 的 P0 完成标准逐条有用例：10 世界秒 / 6 战斗秒（C03-1）、两份同名 buff 不丢（C03-6）、致死一击能解释（C03-8）、截断不冒充完整（C03-12）、没有有效观测时不可评估（C03-15）。
- [x] `tests/calibration-clock-branch.test.ts`、`tests/summary-boundaries.test.ts` 全过；`tests/fit.test.ts`、`tests/calibration.test.ts` 更新后全过。
- [x] conformance 输出相对 DD-01 之后：只多 `buffApply` / `buffExpire` 的两个键，以及 `summary` 里的 `buffUptimeBy`、`kill` 与 `goal` 的新字段；`buffUptime` 的数值变化有清单（29 个现有场景 `buffUptime` 变化 0 项，无多提供者同目标同名 buff；多提供者并集与同帧重挂由 `C03-6` / `C03-7` 覆盖；`.input.json` 全相同，`outputSchemaVersion` `'1' -> '2'`）。
- [x] 所有场景的 DPS、稳态、每轮时长与基线逐个相同（这六项都不改执行，29 个场景 `conformance` 逐项验证无差异）。
- [x] `grep` 出的 `.error` 用法每处都有归属。
- [x] `pnpm fuzz` 通过（29 个场景、问题 0 条）；`engineError` 会让它以非零退出。
- [x] 未含谐度破坏的结果在 `pnpm sim`、`compare`、`scorecard`、`matrix` 的输出里都看得出来（§7.4）。

## 12. 要同步的正式文档

- TD-02：`buffApply` / `buffExpire` 的字段、`Summary.buffUptimeBy`、`kill` / `goal` 的新字段、校准点的 `clock`、`branch`、`gameRange`、`purpose`、`condition`、`Fit` 的新字段。
- TD-07 §10.1：覆盖率按提供者统计与并集的定义。
- TD-10 §2–§4：击杀口径的拆分（两个口径、零时长）、截断与失败不进比较。§6：贴合度的"不可评估"。
- `docs/calibration/README.md`：`clock`、`branch`、区间、用途。

## 13. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD03-Q1 | 跳字 `unknown` 且恰有一支在容差内，旧 `status` 给什么 | `ok`；新增一个值 | `ok`，同时 `comparison` 是 `ambiguous`。新代码都读 `comparison`，旧字段随 DD-08 删掉 |
| DD03-Q2 | `Summary.buffUptime` 的含义改成并集，还是保留旧算法另加新字段 | 改；保留 | 改。旧算法在多提供者时的值没有明确含义；单提供者时两者相同 |
| DD03-Q3 | "截断但稳态各轮完整"算不算可用 | 可用；一律不可用 | 可用。稳态本来就不含最后一轮；一律不可用会让很多现有场景（最后一轮的尾部判定没走完）失效 |
| DD03-Q4 | 只有一个锚点、没有其他观测时算不算不可评估 | 算；不算（分数为 0） | 算。0 分在这里没有信息量 |
