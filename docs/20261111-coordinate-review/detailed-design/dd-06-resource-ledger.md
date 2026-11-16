# DD-06 资源只读账本

**版本**：v0.2，2026-11-14，Claude。按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10；本文涉及 DF-07、DF-10）。
**状态**：Final（2026-11-15）。本文 v0.2 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。**已实现（2026-11-16）**：T06-1～T06-5，验收清单见 §6；实施中与正文对不上、按代码改了正文或正文没写到的几处记在 §9。
**阶段**：二。**前置**：DD-01、DD-05（收集器）。**被依赖**：DD-07、DD-09（状态同步）。

## 1. 范围与依据

做（路线图 §4.3；架构 §6；RR-02）：
- **账本条目**：覆盖全部实际的资源写入与期初余额。
- **收支闭合**的检查函数与用例。
- **两个口径的合计**：请求的获得量、实际的库存变化。
- 调试表的资源轨道改用账本。

不做：
- 状态同步指令（DD-09）。本文只把 `kind: 'sync'` 的入口留好。
- 把 `invariants.ts` 的 `checkLog` 改成读账本。它保留自己按日志的重放，作为与账本互相独立的另一种推法（§3.6）。
- 敌人量表（偏谐值、白条、异常效应层数）。账本只管三种角色资源：大招能量、协奏、核心资源。

## 2. 现状

| 事实 | 位置 |
|---|---|
| 改写角色资源的只有两处：`add()`（模块内的私有函数）与 `outroTrigger` 里的 `c.concerto = 0` | `resources.ts`、`switch.ts` |
| `add(sim, s, slot, res, amount, full)`：`c[res] = snap9(clamp(before + amount, cap))`，返回实际变化量；下限 0，上限 `cap`；核心资源没有登记上限的槽用 `Infinity` | `resources.ts` |
| `add` 的调用方：`grant`（施放资源、扣费、资源型效果、钩子、破盾回能、`能量满`）与命中资源的结算 `settleGains` | 同上 |
| `grant` 在 `amount` 为 0 时直接返回；实际变化量不为 0 才写 `resource` 事件 | 同上 |
| `grant` 的 `scaledByRegen`：正数的能量先乘接收者的共鸣效率再交给 `add` | 同上 |
| 命中资源：`settleGains` 先于 `hit` 事件写入日志；增量记在 `hit.gains` 里，没有单独的 `resource` 事件 | `simulate.ts` 的 `settle`、`resources.ts` |
| 数据把核心资源给到角色没有的槽时，丢弃并警告一次，不写状态 | `resources.ts` 的 `coreMissing` |
| 期初：`initialState` 按 `r.initial` 给 `energy`、`concerto`、`core`（5 个槽） | `simulate.ts` |
| 资源值每次改动后取整到 1e-9 | `num.ts` 的 `snap9` |
| 调试表的资源轨道由 `gainSteps` / `resourceTracks` 从日志重放 | `trace.ts` |
| `checkLog` 按 `resource` 事件与 `hit.gains` 重放资源，与事件里的 `value` 对账 | `invariants.ts` |

## 3. 设计

### 3.1 条目

类型照架构 §6.2 的 `ResourceLedgerEntry`，补一个字段（总览 §6 的 S-06）：

```ts
readonly causeKind: 'initial' | 'hit' | 'cast' | 'cost' | 'effect' | 'hook' | 'break' | 'forced' | 'outro' | 'sync'
```

`cause` 保留原文（资源型效果是它的定义 ID，钩子给的 `note` 也并进来，写成 `hook：<说明>`），`causeKind` 是给程序分类用的固定取值。实施时另加了 `battleFrame`（写入那一刻的战斗帧，§3.4 按战斗帧开窗口要它，§9 第 1 条）：

| `causeKind` | 什么时候 | `kind` |
|---|---|---|
| `initial` | 期初余额 | `initial` |
| `hit` | 命中资源结算（含全队的能量分配） | `change` |
| `cast` | 动作的施放资源 | `change` |
| `cost` | 开始动作时扣的大招能量、核心资源 | `change` |
| `effect` | 资源型效果 | `change` |
| `hook` | 角色钩子 `ctx.addResource` | `change` |
| `break` | 破盾回能 | `change` |
| `forced` | `能量满` | `change` |
| `outro` | 延奏触发时协奏清零 | `outroReset` |
| `sync` | 状态同步（DD-09） | `sync` |

### 3.2 在哪记

**① `add()`**。加一个参数 `causeKind`（由 `grant` 与 `settleGains` 传入；`grant` 按它收到的 `cause` 字符串映射，认不出的就是 `effect`）。在算完新值之后记：

```ts
if (amount !== 0) k.diag?.ledger({
  f: s.frame, phase: k.at.phase, slot, resource: res, kind: 'change', causeKind, cause,
  before, requestedDelta: amount, actualDelta: snap9(after - before), clippedDelta: snap9(amount - (after - before)), after, cap,
})
```

- `amount === 0` 不记（没有发生的变化）。`amount !== 0` 而实际变化为 0（满格再获得、空了再扣）要记，`clippedDelta` 就是被截掉的量：正数是到上限被截，负数是扣到 0 以下被截。
- `requestedDelta` 是交给 `add` 的量，也就是乘过共鸣效率之后的。
- `cap` 没有上限时是 `Infinity`。
- 被 `coreMissing` 丢弃的不记：它没有写状态。警告事件照旧。

**② 延奏清零**。`outroTrigger` 里 `c.concerto = 0` 之后：

```ts
k.diag?.ledger({ …, kind: 'outroReset', causeKind: 'outro', cause: 'outro',
  before, requestedDelta: -before, actualDelta: -before, clippedDelta: 0, after: 0, cap: rules.concertoMax })
```

基线在 `before === 0` 时不清也不写事件，账本同样不记。

**③ 期初**。运行体建好初始状态后、挂常驻 buff 之前，按固定顺序记 21 条（3 人 ×（能量、协奏、5 个核心资源槽））：

```ts
{ kind: 'initial', causeKind: 'initial', cause: 'initial', f: 0, phase: 'init',
  before: v, after: v, requestedDelta: 0, actualDelta: 0, clippedDelta: 0, cap }
```

期初条目的两个增量都写 0，余额在 `after` 里。这样闭合公式不用特判"期初不进求和"：对全部条目求 `actualDelta` 的和，再加上期初条目的 `after`。

**④ 关联的业务事件**。`add` 发生时对应的事件还没写（`resource` 在 `add` 之后写，`hit` 在 `settleGains` 之后写，中间还可能夹着警告），所以分两步：

```ts
const mark = k.diag?.ledgerMark()                  // 当前账本长度
… add(…) …
log(s, { type: 'resource', … })
k.diag?.ledgerRelate(mark, s.log.length - 1)       // 紧跟在 resource 之后、写 resourceFull 之前（DF-07）
for (const f of full) log(s, f)
```

- `grant`：关联必须在写 `resourceFull` 之前做，否则满格的那一次会指到 `resourceFull`。实际变化量为 0 时不写事件，也就不关联，`relatedEventSeq` 留空。
- `settle`：`settleGains` 之前取 `mark`；写完 `hit` 之后用 `ledgerRelate(mark, hitIndex)` 直接关联到 `hitIndex`，不用"日志最后一条"：`hit` 后面紧跟着可能还有 `resourceFull` 与 `heal`（DF-07）。
- 延奏清零：关联到随后那条 `resource`（`cause: 'outro'`）事件。
- `ledgerMark` 的返回值只回传给收集器，不参与业务判断（DD-05 §3.1 的约束 1）。

**⑤ 账本上界**（架构 §6.3 的 `LedgerMarks`）：
- `terminalEndExclusive`：运行停下时的账本长度，`finish` 时记；
- `continuationFromEndExclusive`：降级续跑起点那一刻的账本长度，在 DD-02 §3.3 的 `onIntentUnmet` 里 `k.diag?.markContinuation()`。

完成状态里不放任何账本的数（架构 §2.3）。

### 3.3 闭合

`diagnostics.ts` 里的纯函数：

```ts
/** 账本前 endExclusive 条推出的余额与 state 里的余额逐项比。返回不一致的项；空数组 = 闭合。
 *  LedgerBalances：每人的槽位、名字与三种资源，SimState 满足它（实施时从 Pick<SimState, 'chars'> 放宽，§9 第 4 条） */
export function checkLedgerClosure(ledger: readonly ResourceLedgerEntry[], endExclusive: number, state: LedgerBalances): LedgerMismatch[]

/** 对 tick 边界 S[f]：从整次运行的账本里取属于它的条目 */
export const ledgerPrefixForBoundary = (ledger, f: Frame) => ledger.filter(e => e.phase === 'init' || e.f < f)
```

- 推法：对每个（角色，资源），`期初条目的 after + Σ 其余条目的 actualDelta`。
- **边界 `S[f]` 的前缀是集合条件** `phase === 'init' || f' < f`。初始化阶段钩子改资源的条目 `f` 也是 0，写成"期初一段加 `f' < f` 一段"会把它们算两次或漏掉（架构 §6.3）。
- **终态用 `ledgerMarks.terminalEndExclusive`**，不用帧号去猜。
- **比较口径**：两边都取整到 1e-6 再比。每次写入已经 `snap9`，几千条相加的浮点误差远小于这个量。
- 另一条逐条的不变式也在这个函数里查：同一个（角色，资源）相邻两条满足 `前一条的 after === 后一条的 before`。中间有没进账本的写入时，这一条会先报出来，并指出是哪两条之间。

### 3.4 两个口径的合计

```ts
export interface ResourceTotals {
  readonly slot: Slot; readonly resource: ResourceKind
  readonly initial: number
  readonly gainRequested: number      // Σ 正的 requestedDelta
  readonly gainActual: number         // Σ 正的 actualDelta
  readonly clippedAtCap: number       // Σ 正的 clippedDelta：到上限被截掉的
  readonly spendRequested: number     // Σ 负的 requestedDelta（kind 是 change 的）
  readonly spendActual: number
  readonly clippedAtZero: number
  readonly outroReset: number         // 延奏清掉的量
  readonly synced: number             // 状态同步的净变化
  readonly final: number
}
/** 可按战斗帧或世界帧窗口（clock，缺省世界帧；[fromFrame, toFrame) 左闭右开）、按 causeKind 过滤（只筛变化量，§9 第 5 条） */
export function ledgerTotals(ledger, opts?: { clock?: 'world' | 'battle'; fromFrame?: Frame; toFrame?: Frame; causeKinds?: readonly LedgerCauseKind[] }): ResourceTotals[]
```

报"这个角色这一轮回了多少能量"时用 `gainRequested`（没按上限截断的获得量）；报"到上限后的实际库存"用 `gainActual` 与 `final`。被截掉的量单列，不当作可见状态（路线图 §4.3）。

### 3.5 调试表改用账本

- `trace.ts` 的 `gainSteps` / `resourceTracks` 加一个可选参数 `ledger`。给了就直接由账本生成轨道（每条的 `f` 与 `after`）；没给时保留从日志重放的旧路径，返回里标 `fromLog: true`。
- `src/cli/trace.ts` 的 `--res` 带 `diag: { resourceLedger: true }` 运行，并多一列"被截"。
- `fit.ts` 读协奏与核心资源那一刻的值（`ratioAt`）在 DD-09 里改成用账本。

### 3.6 与 `checkLog` 的关系

`checkLog` 继续按日志重放。新增一条交叉检查，只在测试与 `pnpm fuzz --ledger` 里跑：账本推出的每一步 `after`，与日志里对应 `resource` 事件的 `value` 相等。两种推法独立，互相能发现对方的漏记：
- 账本漏了某个写入点 → §3.3 的相邻条目不变式或闭合检查失败；
- 日志漏了事件或 `hit.gains` 记错 → `checkLog` 失败，而账本闭合。

## 4. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T06-1 | 条目类型、收集器的 `ledger` / `ledgerMark` / `ledgerRelate` / `markContinuation`，期初条目 | `diagnostics.ts`、`run.ts` | C06-1 |
| T06-2 | `add()` 与延奏清零的插桩，`causeKind` 的传递 | `resources.ts`、`switch.ts`、`simulate.ts` 的 `settle` | C06-2～C06-8；零干扰测试（DD-05）把 `resourceLedger` 加进"全开"后仍通过 |
| T06-3 | 闭合检查与合计 | `diagnostics.ts` | C06-9～C06-11 |
| T06-4 | `pnpm fuzz --ledger`：每条变体轴带账本运行，查终态闭合、相邻条目不变式、与日志的交叉检查 | `fuzz.ts`、`src/cli/fuzz.ts` | 全部场景的变体通过 |
| T06-5 | 调试表改用账本 | `trace.ts`、`src/cli/trace.ts` | C06-12；`pnpm trace --res` 在现有场景上的轨道与改之前逐点相同 |

T06-2 不改任何业务行为：`add` 的返回值、事件、状态都不变。conformance 的输出逐字节不变。

## 5. 用例

`tests/resource-ledger.test.ts`，合成角色。每个用例都在最后调一次 `checkLedgerClosure`（终态），并断言相邻条目不变式成立。

| 编号 | 对应架构 §6.3 的清单 | 前提与操作 | 断言 |
|---|---|---|---|
| C06-1 | 期初 | 场景 `initial: { energy: [50, 0, 100], concerto: 30, core: { 甲: { 槽一: 7 } } }` | 账本前 21 条都是 `initial`；甲的能量条目 `after === 50`；甲核心资源槽 1 的 `after === 7`；顺序固定（槽位、资源） |
| C06-2 | 初始化阶段钩子改资源 | 甲的 `onResolve` 给自己 5 点核心资源 | 有一条 `phase: 'init'`、`causeKind: 'hook'`、`f: 0` 的条目；`ledgerPrefixForBoundary(ledger, 0)` 包含它，`S[0]` 闭合；`S[1]` 的前缀里它只出现一次 |
| C06-3 | 正常获得 | 一个命中给甲 10 协奏、全队分能量 | 三个角色各有一条 `hit` 的能量条目；甲的协奏条目 `requestedDelta === actualDelta === 10`、`clippedDelta === 0`；这些条目的 `relatedEventSeq` 都指向那条 `hit` |
| C06-4 | 满格再获得 | 甲协奏 95 时命中给 10；甲协奏 100 时再命中给 10 | 第一条 `actualDelta === 5`、`clippedDelta === 5`；第二条 `actualDelta === 0`、`clippedDelta === 10`，仍然有这一条；`gainRequested === 20`、`gainActual === 5`、`clippedAtCap === 15` |
| C06-5 | 扣到 0 以下 | 钩子 `ctx.addResource('core1', −8)`，当前只有 3 | `requestedDelta === −8`、`actualDelta === −3`、`clippedDelta === −5`、`after === 0` |
| C06-6 | 大招扣费 | 甲能量满，放大招 | 一条 `causeKind: 'cost'`，`actualDelta === −energyCost`；`relatedEventSeq` 指向 `cause: 'cost'` 的 `resource` 事件 |
| C06-7 | 延奏清零 | 甲协奏满，切乙触发变奏 | 一条 `kind: 'outroReset'`，`before === 100`、`after === 0`、`actualDelta === −100`；它的 `f` 是变奏动作走到延奏触发帧的那一帧，不是切人那一帧 |
| C06-8 | 运行中钩子改资源；资源型效果 | 钩子在 `onEvent` 里给队友 2 点能量；一个 `scaledByRegen` 的资源型效果给 4 点能量，接收者共鸣效率 1.5 | 钩子那条 `slot` 是队友；效果那条 `causeKind: 'effect'`、`requestedDelta === 6` |
| C06-9 | 任意帧边界闭合 | 一条含以上各种写入的 300 帧合成轴，带账本跑完；再对 `f = 0, 1, 中间若干, completedTicks` 用 DD-05 §6.1 的边界观察点取 `S[f]`，回调里同时取账本长度当这个边界的上界。不用"`maxFrames = f` 的截断运行"代替：到上限之后的警告与收尾 `drain` 还会触发钩子、改状态（DF-10） | 每个 `f`：`checkLedgerClosure(ledgerPrefixForBoundary(ledger, f), …, S[f])` 为空 |
| C06-10 | 终态与 `S[N]` 分开 | DD-01 的 C01-9（1 帧动作，结束时钩子加资源） | `S[completedTicks]` 的前缀不含那条钩子条目；`terminalEndExclusive` 含它；两者各自闭合 |
| C06-11 | 能抓到漏记 | 测试里绕过 `add` 直接改 `s.chars[0].energy`（模拟一个没接进账本的新写入点） | 闭合检查失败，并指出角色与资源；相邻条目不变式在下一条能量条目处失败 |
| C06-12 | 调试表 | 同一场景的资源轨道，给与不给 `ledger` | 两种的（帧，值）序列相同；不给时 `fromLog === true` |
| C06-13 | 降级续跑的上界 | DD-02 的 C02-11，带账本 | `ledgerMarks.continuationFromEndExclusive` 存在且小于 `terminalEndExclusive`；用它取的前缀与续跑起点的状态闭合 |
| C06-14 | 丢弃的不记 | 动作数据给了角色没有的核心资源槽 | 有 `coreSlot` 警告事件；账本里没有对应条目；闭合成立 |
| C06-15 | 诊断开关 | 同一场景关与开 `resourceLedger` | 业务事件、状态、`firing` 成功的次数（数 `buffApply` 与 `resource` 事件）一致。这一条由 DD-05 的零干扰测试统一覆盖，这里只确认账本在它的"全开"集合里 |
| C06-16 | DF-07：满格那一次的关联 | 钩子给的能量让甲从差 1 点到满（写 `resource` 后紧跟 `resourceFull`）；一个带治疗的命中让协奏满（`hit` 后紧跟 `resourceFull` 与 `heal`） | 两条账本条目的 `relatedEventSeq` 分别指向那条 `resource` 与那条 `hit`，不是 `resourceFull`、`heal` |

有 `data/generated` 时另加一条：`m0-video-eq.yaml`、`xin-team.yaml` 带账本跑完，终态闭合，且账本与日志的交叉检查通过。

## 6. 验收清单

- [x] `tests/resource-ledger.test.ts` 全过（27 个，C06-1～C06-16 与两条真实轴）；RR-02 的关闭条件逐条有用例：获得 C06-3、上限截断 C06-4（另有扣到 0 以下 C06-5）、大招扣费 C06-6、延奏清零 C06-7、钩子修改 C06-2 / C06-8；诊断开关前后一致 C06-15。`tests/fuzz.test.ts` 另有两条：`pnpm fuzz --ledger` 的检查在正常的轴上没有问题、绕过账本改资源时报出闭合的问题。
- [x] 任意帧边界与终态的闭合在合成轴与两条真实轴上成立：合成轴（300 帧、各种写入都有）查了 `S[0]`…`S[300]` 的每一个边界；`m0-video-eq.yaml`、`xin-team.yaml` 每 37 帧一个边界加 `S[completedTicks]`，以及终态。每个边界都查了"按集合条件取的前缀长度 = 观察点给的账本上界"。
- [x] `pnpm fuzz --ledger` 通过（30 个场景，问题 0 条，约 6 分钟；跑不通的变体轴也查了终态闭合与交叉检查）。不带 `--ledger` 的 `pnpm fuzz` 同样 0 条。
- [x] conformance 输出逐字节不变（30 个场景的 60 个文件与实现之前 `diff` 相同）；零干扰对拍通过（`ALL_DIAG` 里已有 `resourceLedger`，30 个场景一致）。
- [x] 全引擎搜索 `\.energy\s*=`、`\.concerto\s*=`、`\.core\[.*\]\s*=`：只有 `resources.ts` 的 `add`（`after = c[res] = …` 与 `after = c.core[k - 1] = …` 两行）与 `switch.ts` 的延奏清零（`c.concerto = 0`），另有 `simulate.ts` 的 `initialState` 用对象字面量建初值；其余命中都不是写状态（`castResources` 里的局部累加 `sum.concerto`）。`data/curated` 的角色模块、`src/data`、`src/report`、网页没有命中。结果贴在提交说明里。
- [x] `resources.ts` 的文件头注释写明："新增资源写入点必须同时接进账本（DD-06）"。

## 7. 要同步的正式文档

- TD-06：资源只读账本一节（写入点、两个口径、闭合公式）。
- TD-02：`ResourceLedgerEntry`、`LedgerMarks`、`ResourceTotals`。
- TD-11 §6：`pnpm trace --res` 的"被截"一列。

## 8. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD06-Q1 | 期初条目的增量怎么写 | A：`before = after = 期初值`，增量为 0；B：`before = 0`，增量等于期初值 | A。闭合公式不用排除期初，合计里也不会把期初当成一次获得 |
| DD06-Q2 | `checkLog` 要不要改成读账本 | 改；保留独立的重放 | 保留。账本是可选诊断，`checkLog` 在诊断关着时也要能跑；两种推法互相校验更有用 |
| DD06-Q3 | 核心资源的期初条目记几个槽 | 5 个全记；只记角色有的槽 | 5 个全记。钩子可以写没登记上限的槽，闭合要覆盖到 |
| DD06-Q4 | 被截断到 0 变化的请求要不要有业务事件 | 不要（现状）；要 | 不要。多发事件会多触发钩子；这类请求只在账本里可见，正是账本存在的理由之一 |

## 9. 实施记录（2026-11-16）

按代码改正文、或正文没写到的几处。README §8：设计结案后实施中发现对不上，直接改对应的文档并在总览的修订记录里记一条。

1. **条目多一个 `battleFrame`**（写入那一刻的战斗帧）。§3.4 要"按战斗帧或世界帧窗口"合计，架构 §6.2 的条目只有世界帧 `f`。合计的选项对应加了 `clock: 'world' | 'battle'`（缺省世界帧）；`causeKinds` 的类型收窄为 `LedgerCauseKind`。没开全局时停的轴上两种窗口相同。
2. **收集器的接口**：`ledger(entry, phase)` 收写入那一刻的 `k.at.phase`，按 `EventMeta` 的口径折算（循环退出后与 `afterP7` 记 `post`），序号由收集器补；另加 `ledgerRelateIntervention(mark, index)`（`能量满` 的条目带 `relatedInterventionIndex`，架构 §6.2 有这个字段、正文没写谁填）与 `ledgerLength()`（边界观察点的 `ledgerLength`，账本关着时 `null`）。`markContinuation()` 只认第一次，在 `simulate.ts` 的 `onIntentUnmet` 里与 `diagnosticContinuationFrom` 同一刻取。期初条目由 `resources.ts` 的 `openingLedger(sim, s)` 记，在 `simulate.ts` 的 `execute`（运行体在这里，不在 `run.ts`）挂常驻 buff 之前调。
3. **`cause` 的写法**：钩子是 `'hook'`，带说明时 `'hook：<说明>'`；命中是 `'hit'`（是哪一下看 `relatedEventSeq`）；资源型效果是它的定义 ID；其余与 `causeKind` 相同。`grant` 按 `cause` 归类用 `switch`（`cast` / `cost` / `hook` / `break` / `forced`，认不出的是 `effect`），所以资源型效果的 ID 不能取这几个保留字（日志的 `resource.cause` 本来就是这个约定）。
4. **闭合检查收 `LedgerBalances`**（每人的槽位、名字与三种资源，`SimState` 满足它），不收 `Pick<SimState, 'chars'>`：边界观察点里拷几个数就能对账。报出的项 `LedgerMismatch` 分三种：`balance`（带账本推出的与状态里的）、`chain`（带接不上的两条的序号）、`initial`（没有期初条目、期初不在第一条或重复）。
5. **合计都是带符号的变化量**：`spendRequested`、`spendActual`、`clippedAtZero`、`outroReset` 是负数；`causeKinds` 只筛变化量，`initial` / `final` 总是窗口两端的实际余额。不过滤时 `final = initial + gainActual + spendActual + outroReset + synced`（C06-9 对每一项都查了，另查两个窗口首尾相接）。
6. **交叉检查 `crossCheckLedger(log, ledger, names)`** 放在 `diagnostics.ts`，与闭合检查一起。除 §3.6 的"每一步 `after` 与对应 `resource` 事件的 `value` 相等"，另查：每条 `resource` 事件恰好有一条条目关联；关联到 `hit` 的条目的 `actualDelta` 等于 `hit.gains` 里的那一项（没列的算 0），`gains` 里不是 0 的项都有条目；实际变化不是 0 的写入都有关联的事件。`pnpm fuzz --ledger` 的每条轴经 `fuzz.ts` 的 `ledgerRun`（`runForInspection` + `prepareResolved`）跑：这条路上钩子里的异常记成 `engineError` 不抛，由原有的审计当引擎错误算；初始化没走完的不做闭合（架构 §2.3），轴失败、截断、引擎错误的终态照样查。
7. **调试表**（T06-5）：
   - `resourceTracks(steps, r, ledger?)` 的返回改成 `CharResourceTracks[]`，按日志重放时每人标 `fromLog: true`；时间轴模型（`src/report/timeline.ts`）在结果带了账本时也用账本，现在的调用方都不开账本，模型只是多了 `fromLog`。
   - `gainSteps(log, r, meta, ledger?)`：给了账本，每步多 `values`（账本的 `after`）与 `clipped`（不是 0 的被截量）；命中时整次被截掉的人增减记 0（日志的 `gains.energy` 里不列）；实际变化为 0、没写事件的单人写入（满了的钩子、效果…，DD06-Q4）另起一步，排在它之前最近一条有事件的条目的那一步后面（账本与日志同序），不归动作。`pnpm trace --res` 因此多出"变化 ±0、被截 x"的行。套路卡与时间轴不给账本，`actionGains` 不变。
   - **按日志重放改成每步取整到 1e-9**（`resourceTracks` 与 `traceLedger` 里累加命中增减的地方，同引擎的 `snap9`）。否则浮点误差在两位小数的 `.xx5` 边界上会舍错：改之前有 7 个场景各 1 个点少了 0.01（状态里是 98.155，重放得 98.15499999999997，舍成 98.15）：`alm-爱琳守` 琳奈、`jms-5r18z` 景燃、`jys-team` 尤诺、`tys-video` 渊武、`xin-team`、`xin-team-r5`、`xin-team-r5-卜灵Q先放` 的雷主，都是能量。改了以后两种推法在 30 个场景上逐点相同（轨道全部相同；`--res` 的表各资源各轮共 66,422 行，去掉新加的"被截"一列与 5,475 行 ±0 之后全部相同）；与改之前比，`pnpm trace --res` 只差这 7 个点（表里 21 格，各差 0.01）。汇总自己的重放（`resourceTimeline`、分轮的能量 / 协奏首尾差）在 conformance 输出里，没有动。
8. **用例的做法**：C06-9 查了每一个边界而不是抽样；C06-11 另有反向的一支（日志的 `hit.gains` 记错时 `checkLog` 与交叉检查报出来、账本照样闭合）；C06-13 的续跑起点在 tick 中途（P2 的切人里），不是边界，用一个在 `markContinuation` 那一刻记下资源的收集器子类取那一刻的状态（同 DD-05 零干扰的反向用例）；C06-15 另在两个合成场景上跑了零干扰对拍。
9. **耗时**：诊断全关时只多了几处 `k.diag?.…` 的空判断与 `grant` 的一次归类。`m0-video-eq.yaml` 单次运行（40 次取中位数）与 main 交替测 6 对，比值 0.955～1.018，在机器噪声之内。
