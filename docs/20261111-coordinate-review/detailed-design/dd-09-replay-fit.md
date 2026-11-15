# DD-09 录像输入与贴合度

**版本**：v0.3，2026-11-14，Claude。v0.2 按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10：DF-09、DF-18、DF-19）；v0.3 按 Codex 第二轮复核修订（意见文件 §13：DF-18 的歧义判定）。
**状态**：Final（2026-11-15）。本文 v0.3 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）。还没实现。
**阶段**：四。**前置**：DD-01、DD-03、DD-06、DD-07、DD-08。阶段一、二的代表轴集成验收通过之后再动工。

离动工还远。本文写到"接口、任务与验收条件能评审"的程度；动工前按当时的代码再修订一次，尤其是 §3 的语法。

## 1. 范围与依据

做（路线图 §6.2、§6.3、§7、§10.2；架构 §10.3、§12）：
- **录像的三种时段**与未观测时段的填法。
- **状态同步指令**：不发业务触发，记干预记录与账本条目。
- **贴合度重做**：观测有固定的 ID 与通道；按通道一对一、保序匹配；参照固定；先资格后排序；规则候选与改轴候选分表；加单下跳字的通道。
- **分通道残差与最早偏差**。
- **中 3、中 4 按新写法重记**，并做路线图 §10.2 留下的两项证据任务。

不做：
- 改调度器里补位的停止条件（路线图 §6.3）。
- 敌人走位、多目标、空间命中。
- 自动从录像识别动作。读录像仍是人工加脚本辅助。

## 2. 现状

| 事实 | 位置 |
|---|---|
| 录像场景用 `at <秒>` 把每段钉到视频时刻，段里用补位 `~` 填到 `at`；另有 `能量满`、`敌人 失谐`、`敌人 换` | `scenarios/xin-tower3-video.yaml`、`xin-tower4-video.yaml`、`tys-video.yaml`、`fire-tower*-video.yaml` |
| `能量满` 走 `grant`，写 `resource` 事件（`cause: 'forced'`），会触发钩子与 `resourceFull` | `simulate.ts` 的 `fillCommand` |
| `video` 块有 `marks`、`events`、`hp`、`concerto`、`core`；每条是一行文本，没有 ID | `scenario.schema.ts` |
| `replayFit`：录像动作在 10 秒内找最近的同名动作，可以多条对上同一下；切人类型的参照从候选自己的 `r.commands` 读；各项按权重折成秒相加 | `fit.ts` |
| `fitVariants`：翻开关的变体与改轴的变体放进同一个数组一起排 | `fit.ts` |
| DD-03 之后：没有对上的锚点时不可评估 | DD-03 §8 |
| 中 3、中 4 的场景里雷主首位还是天演溯心；用户 2026-11-11 确认是绝息魄 | 路线图 §0.2 第 4 条 |

## 3. 录像输入

### 3.1 三种时段

场景加一个只在 `purpose: replay` 下允许的块：

```ts
replay: z.strictObject({
  /** 录像里哪些时段不是"已观测的动作"。没列出的时段都按已观测处理 */
  segments: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('idle'), from: VideoTime, to: VideoTime,
      basis: z.string().min(1) }),                       // 凭什么确认这段没有会影响模型的战斗输入
    z.strictObject({ kind: z.literal('unobserved'), from: VideoTime, to: VideoTime,
      reason: z.string().min(1),                         // 为什么看不到：遮挡、镜头外、读不清
      fills: z.array(z.strictObject({ name: z.string().min(1), lines: z.array(z.string()) })).min(1) }),
  ])).default([]),
}).optional()
```

- **已观测的动作**：照现在的写法写进轴，包括闪避、跳跃。
- **已知空闲**（`idle`）：必须写 `basis`。"没有跳字"不算依据；纯跑位只有在声明的空间近似下、确认不影响所问的问题时才能写成空闲（路线图 §6.3）。执行上它对应轴里这段时间的等待。
- **未观测**（`unobserved`）：必须给出至少一种填法。每种填法是一组轴的行，替换进这个时段。
  - 一个有 k 个未观测时段、各有若干填法的场景，展开成每个组合一次运行；组合数超过 16 时报错，要求调用方指定要跑哪几个组合。
  - 各组合**分别运行、分别报告**。两种填法的结果不当作上下界：真实情况落在它们之外，只说明这两种填法都不对。
  - 填法的名字进运行身份（它改变了有效场景，`scenarioDigest` 自然不同），报告里每一行带填法组合的名字。
- 编译期检查：时段不重叠；`from < to`；时段要落在相邻两个 `at` 之间，不能跨过已观测的动作。

### 3.2 状态同步

新指令（名字待 TD-09 定，这里用 `同步` / `sync`）：

```text
同步 <角色> <资源> <值>          sync <char> <resource> <value>
  资源：能量 | 协奏 | <核心资源名>
  值：  =62      绝对值
        62%      占上限的比例（没有上限的核心资源不能写比例，编译期报错）
```

行为：
1. 直接把这个角色这种资源设成采用值（截在 `[0, 上限]`）。这是 `add` 与延奏清零之外的**第三个资源写入点**，放在 `resources.ts` 里的新函数 `syncResource`，文件头的写入点清单相应更新（DD-06 §6）。
2. **不写日志，不发业务触发**：不产生 `resource`、`resourceFull` 事件，钩子的 `onEvent` 看不到。
3. **记一条干预记录**（架构 §4.1）：`kind: 'sync'`、`before`、`adopted`、`delta`、`firedTriggers: false`；`skippedTriggers` 列出"如果这是一次普通变化本来会发的触发"，例如从不满到满时是 `['resourceFull']`。
4. **记一条账本条目**：`kind: 'sync'`、`causeKind: 'sync'`、`relatedInterventionIndex`。
5. 假设表加一条 `forced-sync`（同 `forced-energy` 的写法），每次同步 `assume` 一次。
6. 完成状态的 `conditioning` 从第一次干预起是 `conditioned`（DD-01 已经这样算）。

**按日志重放资源的地方都要读干预记录**（DF-09）。基线里不只 `invariants.ts` 的 `checkLog`，`summary.ts` 的 `loops()`（每轮的 `energyDelta`、`concertoDelta`）与 `resourceTimeline()` 也是从 `r.initial` 出发、只看 `hit.gains` 与 `resource` 事件重放的。抽一个三处共用的函数 `replayResources(log, initial, interventions)`：在每条事件之后按 `afterEventSeq`、`orderInAnchor` 应用干预，**只应用 `kind === 'sync'` 的**。旧的 `fill`（`能量满`）已经写了 `resource` 事件，再应用一次就重复计算了。`summarize` 因此多收一个 `interventions` 参数。诊断关着时这些也都成立（这就是干预记录必有、不放在诊断里的原因）。

**同步改不了的东西**要写在报告里：补满资源恢复不了隐藏的历史（什么时候到的满、内置冷却的时刻、因为没满而没触发的效果）。**差额不等于机制缺口**：`delta` 只说明仿真与读数在这一刻差多少。

**同一项读数不能两用**（路线图 §6.1）：一条 `video.concerto` 的读数如果被用来写了 `同步`，就要标 `purpose: given`，贴合度的评分集合里不能再有它。编译期检查：同一角色、同一资源、时刻相差不到 0.5 秒的同步与观测同时存在时，观测必须是 `given`。

### 3.3 外来事件与旧指令

- `敌人 换`、`敌人 失谐` 是外来事件，保留为显式输入，照旧发业务事件，并记干预记录（`firedTriggers: true`，DD-01 §3.8 已做）。
- `能量满` 保留旧行为，标为"旧写法"：`prepareRun` 对用了它的场景给一条警告，指向 `同步`。五个录像场景重记完之后，从语法里删掉它连同假设 `forced-energy`。
- "补位 `~` 打到 `at`"在新的录像场景里不再使用：那一段要么是已观测的动作（照写），要么是未观测（写填法）。调度器不改。现有场景在重记之前照旧能跑。

## 4. 贴合度

### 4.1 观测与通道

`video` 块里的每一条读数成为一个有固定 ID 的观测。ID 由通道与它在**原场景**列表里的位置组成，变体不改 `video`，所以 ID 在变体之间稳定。

| 通道 | 来源 | ID | 比什么 |
|---|---|---|---|
| `switch` | 新增 `video.switches`："<视频秒> <切出>→<切入> [intro\|normal]" | `switch#3` | 时刻；写了类型的再比类型 |
| `action` | `video.events` | `action#12` | 时刻 |
| `hp` | `video.hp` | `hp#40` | 这一刻的剩余比例 |
| `concerto` | `video.concerto` | `concerto#7` | 这一刻的比例 |
| `core` | `video.core` | `core#2` | 这一刻的比例 |
| `hit` | 新增 `video.hits`："<视频秒> <角色> <判定名> <数> [crit\|nonCrit]" | `hit#5` | 单下跳字（R15） |
| `summon` | `video.events` 里标了后台来源的（写法：动作名前加 `@`） | `summon#1` | 时刻；不进前台的顺序 |

- 每条可以在行尾加 `!given` / `!display`：`given` 是被用作输入的（§3.2），`display` 是只展示不评分的。
- 现有的 `marks`（行号 → 视频秒）继续当时间对齐的锚点，不是观测。
- 时间换算仍按第一个锚点对齐。锚点一个都对不上时不可评估（DD-03 §8）。

### 4.2 匹配

**按通道分别做，一对一，并且在通道的完整顺序里保序**（DF-18）。

`action`、`switch`、`summon`、`hit` 四个通道：
1. **两个序列**：通道里的观测按视频时刻排成一个序列；仿真那边同一通道的事件（`actionStart`、`switch`、`hit`）按时刻排成另一个序列。`action` 通道是前台动作，所有前台角色、所有动作在同一个序列里；后台召唤在 `summon` 通道里，不受前台顺序约束，也不强加不存在的全局顺序。
2. **能不能配由键决定，保序加在整个序列上**：角色、动作（或判定名）相同，并且时刻差不超过窗口（缺省 10 秒），这一对才允许配；配上的各对之间不能交叉。只在同名动作里保序是不够的：录像先 E（10 秒）后 R（11 秒）、仿真先 R（10 秒）后 E（11 秒），按名字分组会各配上一对，映射却交叉了。
3. **目标**：先让配上的对数最多，对数相同时让时刻差的总和最小。这是带权的最长公共子序列，用动态规划，规模是两个序列长度之积。
4. **歧义**（DF-18，按 Codex 第二轮的更正）：对每个配上的观测 o（当前配 e），对它的每个其他可配事件 e'（键相同、在窗口内）各求一次"强制 o 配 e'"的最优对齐：o 与 e' 把两个序列各切成前后两段，前段对前段、后段对后段各自求最优，再加上 (o, e') 这一对。只要有某个 e' 使总对数等于全局最优、总代价不超过最优值加 0.25 秒，o 就标 `ambiguous`，`candidates` 列出 e 与这些 e'。只"禁用原配对、再看一个新最优解"不够：新最优解可能让 o 落单，从而掩盖 o 配另一个事件的合法方案（三条观测在 0、0.1、0.2 秒，两条仿真事件在 0.1、0.2 秒：原最优 O1→E0、O2→E1；禁用 O1→E0 后的最优是 O0→E0、O2→E1，O1 落单；而 O0→E0、O1→E1 同样配两对，代价只多 0.2 秒）。
   - **实现**：正向、反向各做一遍动态规划，得到所有前缀对、后缀对的最优（对数、代价），每个 (o, e') 的强制解查表即得，总规模仍是两个序列长度之积。
   - **o 可能落单的情况**另给一个说明标记 `mayBeUnmatched: true`：存在对数同为最优、代价在阈值内、而 o 落单的对齐，意思是"这一条配不配都说得通"。它只是能力说明，不代替上面"有没有另一个事件可配"的检查。
   - 强制配 e' 会让总对数下降的（例如 e' 已经是别的观测不可替代的配对），不算歧义。第一版不输出全部方案。
5. **落单的**：观测标 `unmatched`；仿真那边落单的事件进 `extraInSim`（只展示）。

`hp`、`concerto`、`core` 三个通道不用匹配：取仿真在那一刻的值（资源用账本，DD-06）。运行在那一刻之前就停了的，标 `uncovered`。

每个观测的结果：

```ts
export interface ObservationFit {
  readonly id: string; readonly channel: Channel
  readonly status: 'matched' | 'conflicted' | 'ambiguous' | 'unmatched' | 'uncovered'
  readonly residual?: number                 // 秒、比例差或相对差，按通道
  readonly simEvent?: EventHandle; readonly candidates?: readonly EventHandle[]
  readonly mayBeUnmatched?: true             // 存在同样好的、让它落单的对齐（只是说明）
  readonly conflict?: string                 // 'switchType: 录像 intro，仿真 normal'；'hit: 两支都超出容差'
}
```

`conflicted` 只用于定性的冲突：切人类型不同；跳字在标明的分支上超出容差（分支未知时两支都超出）。时刻差大不是冲突，是残差。

### 4.3 参照固定

- 切人类型的参照**只来自观测**：`video.switches` 里写了类型的那些。
- 没写类型的切人不比类型。不再从候选自己的指令里读"轴里写了变奏就应该是变奏"。
- 过渡期（场景还没补 `video.switches`）：由原场景的指令在生成变体**之前**冻结出一份参照，所有变体共用这一份。报告里标"参照来自原场景的写法，不是录像读数"。

### 4.4 资格与排序

```ts
export interface FitScoreDef {
  readonly scoreObservationIds: readonly string[]     // 参与排名的观测；事先定
  readonly weights: Readonly<Record<Channel, number>> // 各通道残差折成同一单位的系数
  readonly tolerances: Readonly<Record<Channel, number>>
  readonly windowSeconds: number
}
export interface Eligibility {
  readonly hasQualitativeConflict: boolean
  readonly matchedScoreIds: readonly string[]         // 评分集合里匹配上的（排序后）
  readonly channelsCovered: readonly Channel[]
  readonly windowComplete: boolean                    // 运行覆盖了到最后一条评分观测为止的时间，且状态不是失败
  readonly signature: string                          // 以上四项的摘要
}
export interface FitResult {
  readonly runId: string; readonly fillCombo?: string
  readonly completion: RunCompletion
  readonly assessable: boolean
  readonly observations: readonly ObservationFit[]
  readonly eligibility: Eligibility
  readonly residualByChannel: Readonly<Partial<Record<Channel, { n: number; mae: number; rmse: number; mean: number }>>>
  readonly score: number | null                       // 只在同一签名的组里可比
  readonly earliestDeviation: { readonly observationId: string; readonly videoSeconds: number; readonly channel: Channel } | null
}
```

规则：
1. **评分集合事先定**。缺省是原场景里全部不带 `!given`、`!display` 的观测；调用方可以给一个子集。它连同权重、容差、窗口组成 `FitScoreDef`，它的摘要是报告身份的一部分。评分定义不同的两份报告不能互相比，命令行在这种情况下拒绝并排显示。
2. **评分集合之外的观测只展示**，不进 `score`，也不进签名。
3. **只在签名相同的组里按 `score` 排**。`score` 是评分集合里 `matched` 的观测的残差按通道加权后的和；没有概率意义。
4. **跨组不排总名次**。报告按组列出，组与组之间只展示覆盖与冲突的差别：哪一组多匹配了哪些观测、哪一组有哪处冲突。
5. **共有子集的比较要显式要求**：`--common-subset` 时，取两组都 `matched` 的评分观测重算残差，输出里列出各自被排除的观测，并标明"只比共有子集，不是整体更贴合"。
6. **不可评估**的不进任何组。
7. **规则候选与改轴候选分两张表**：`FitReport` 拆成 `ruleCandidates`（翻台账里的候选，经 DD-04 的分类）与 `axisVariants`（挪、删、对调动作），各自分组排序，互不混排。
8. **报告身份**（DF-19）：`FitScoreDef` 之外再加 `observationSetDigest`，它是这份报告实际用到的观测内容（读数、单位与时钟、分支、用途、参照）与时间对齐的输入（`marks` 锚点、对齐规则）的摘要。报告身份 = 各运行的 `runId` + `FitScoreDef` 的摘要 + `observationSetDigest`。`video` 不进执行身份（DD-01 §3.3），所以只改一个读数或锚点时 `runId` 不变，而报告身份变了，两份报告不能互相比。按位置生成的观测 ID 只保证同一批候选之间对得上，不证明两份观测的内容相同。
9. **引擎错误在分组之前排除**（DF-19）：`completion.status === 'engineError'` 的运行 `score: null`，不进任何组，单列在报告末尾并保留原因；即使它在出错之前已有可比的观测、签名与别的运行相同，也不给名次（架构 §2.2）。`axisFailed`、`truncated` 的运行按实际覆盖进组，`windowComplete` 照实。

`earliestDeviation`：评分集合里按视频时刻排，第一条 `conflicted`、`unmatched`，或残差超过该通道容差的观测。它只是"最早检测到的偏差"，不保证此前的隐藏状态都对（路线图 §7 第 4 步）。

### 4.5 三个不能出现的结果

架构 §10.3 的表，各对应一个用例（§7）：
- A 只匹配 O1、B 只匹配 O2：签名不同，不排先后。
- A 全覆盖但有一处切人类型冲突，B 删掉那个动作：两者签名不同（一个有冲突，一个少一条匹配），B 不排到 A 前面。
- 必需的 O0 加可有可无的 O1：O1 要么在评分集合里（B 少匹配一条，签名不同），要么不在（A 的 9 秒不计）。B 不会因为少匹配而分数更好。DD-03 之前"删掉动作从 9 分变 5 分"的反例在这里彻底关掉。

## 5. 中 3、中 4 重记与两项证据任务

按这个顺序做，每一步都重跑并记 `runId`：

1. **改配置**：两个场景的雷主声骸改成绝息魄排第一（场景照配置写）。重跑，更新场景快照与 `docs/tower-20261026.md` 里的数。预期（路线图 §7 案例）：两类伤害的残差变成同一个约 1.044。这是预测，改完要核对；对不上就把它作为新的差异记下来。
2. **补观测**：`video.switches`（带类型）、`video.hits`（已经读过的跳字搬进来，标分支）。
3. **换写法**：`能量满` 换成 `同步`，被用作同步依据的读数标 `!given`；"补位打到 `at`"的段逐段判断是已观测、已知空闲还是未观测，照 §3.1 写。
4. **出新报告**：`pnpm fit` 按 §4 输出。和旧报告不比分数（评分定义不同），只对照"哪些观测匹配上了"。
5. **窗口边界**（路线图 §10.2）：读心变奏入场到镇寰宇起手的深塔倒计时差 G，写成 `interval` 观测（`clock: battle`），带两端的帧范围、HUD 刷新情况。判法照路线图：整个落在 15 秒内是支持，整个超出是冲突，跨边界是分不清。按 DD-08 的格式记成一条 `backfill` 闭环。
6. **m ≈ 1.044 的来源**：读同时段队友的跳字比值、心的面板，写成观测；与 B10 分开。也记成一条闭环，候选未列全。

## 6. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T09-1 | `同步` 指令、`syncResource`、干预记录、账本条目；`replayResources` 与它的三个使用方（`checkLog`、`loops()`、`resourceTimeline()`） | `scenario.schema.ts`、`scheduler.ts`、`resources.ts`、`run.ts`、`invariants.ts`、`summary.ts`、`assumptions.ts` | C09-1～C09-5、C09-18；零干扰与账本闭合照旧通过 |
| T09-2 | `replay.segments` 与填法展开 | `scenario.schema.ts`、`run.ts`（或 `observations.ts` 里的展开函数） | C09-6、C09-7 |
| T09-3 | 观测的 ID 与通道、`video.switches`、`video.hits` | `scenario.schema.ts`、`observations.ts` | C09-8 |
| T09-4 | 通道内保序的一对一匹配与歧义（强制配对的前后缀动态规划） | `observations.ts` | C09-9、C09-10、C09-19～C09-21、C09-23 |
| T09-5 | 资格签名、分组排序、报告身份（含 `observationSetDigest`）、引擎错误的排除、两张表 | `fit.ts`（重写）、`src/cli/fit.ts` | C09-11～C09-15、C09-22 |
| T09-6 | 最早偏差、分通道残差 | `fit.ts` | C09-16 |
| T09-7 | 视图 F：有条件推演的标注（第一次干预之后的时间轴加底色与说明）、按通道显示匹配状态 | `web/designs/f-video.html`、`src/report/` | 人工看一次；只加标注 |
| T09-8 | 中 3、中 4 重记（§5 的 1–4） | 两个场景、`docs/tower-20261026.md`、快照 | 每步的 `runId` 与结果记在文档里 |
| T09-9 | 两项证据任务（§5 的 5、6） | `docs/evidence/`、`points.yaml` | 两条闭环记录 |
| T09-10 | 其余三个录像场景按新写法重记；之后删 `能量满` | `tys-video.yaml`、`fire-tower1/2-video.yaml`、语法 | 五个场景都不含旧写法 |

## 7. 用例

`tests/fit-eligibility.test.ts`（新）、`tests/replay-input.test.ts`（新），合成数据：

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C09-1 | `同步 甲 协奏 =62`，此前是 40 | 状态里是 62；日志里没有新的 `resource` 事件；钩子 `onEvent` 的调用次数与不写这条指令时相同；干预记录 `before: 40, adopted: 62, firedTriggers: false` |
| C09-2 | 同步到满 | 没有 `resourceFull` 事件；`skippedTriggers` 含它；依赖"协奏满时"的 buff 没挂上 |
| C09-3 | 连续两条同步，中间没有业务事件 | 两条干预的 `afterEventSeq` 相同、`orderInAnchor` 是 0 与 1；账本闭合；`checkLog` 通过（诊断关着） |
| C09-4 | 严格入口的场景里写 `同步` | 编译期报 `strict.external` |
| C09-5 | 同一时刻既有 `同步` 又有没标 `!given` 的同种观测 | 编译期报错 |
| C09-6 | 一个未观测时段、两种填法 | 展开成两次运行，`runId` 不同；报告里两行各带填法名；没有"上下界"之类的合并字段 |
| C09-7 | `idle` 不写 `basis`；时段跨过一个已观测的动作 | schema / 编译期报错 |
| C09-8 | 对同一场景生成删掉一个动作的变体 | 变体里各观测的 ID 与原场景相同 |
| C09-9 | 录像两条同名动作隔 1 秒，仿真只有一下落在中间 | 只有一条配上，另一条 `unmatched`；不会两条都配同一下 |
| C09-10 | 只有一条观测，仿真两下同名动作，离它的时刻差几乎相同（两种对齐都合法、对数相同） | 那条观测 `ambiguous`，`candidates` 有两个 |
| C09-11 | 架构 §10.3 情形一：A 只匹配 O1，B 只匹配 O2 | 两者 `signature` 不同，不在同一组，报告里没有两者的先后 |
| C09-12 | 情形二：A 全覆盖但一处切人类型冲突；B 删掉那个动作 | B 不排在 A 前面；`--common-subset` 时才有共有子集的残差，并列出各自被排除的观测 |
| C09-13 | 情形三：O0 必需、O1 可选；A 两条都匹配（残差 0 与 9 秒），B 只匹配 O0。分别把 O1 放进与不放进评分集合 | 放进：签名不同；不放进：两者 `score` 相同（都是 0）。两种下 B 都不优于 A |
| C09-14 | 两份评分定义不同的报告 | 命令行拒绝并排比较 |
| C09-15 | `fitVariants` 的输出 | 规则候选与改轴候选在两张表里；任何一张表里没有另一类 |
| C09-16 | 三条观测依次：匹配且残差小、残差超过容差、切人类型冲突 | `earliestDeviation` 指向第二条 |
| C09-17 | 跳字通道：标了 `crit` 而仿真暴击支对不上 | `conflicted`，进 `hasQualitativeConflict` |
| C09-18 | DF-09：轮边界上一次同步；同一锚点连续两次同步；另一条轴用旧的 `能量满` | 前两者的 `perLoop` 资源首尾差与 `resourceTimeline` 都与状态一致，`checkLog` 通过；`能量满` 没有被重复计算 |
| C09-19 | DF-18：录像同一角色先 E（10 秒）后 R（11 秒），仿真先 R（10 秒）后 E（11 秒） | 只配上一对，另一条 `unmatched`；不会两对都配上 |
| C09-20 | DF-18：两条观测与两条仿真事件分别在 0、0.1 秒，唯一的满配对齐 | 两条都 `matched`，不因为邻居在 0.25 秒之内就标 `ambiguous` |
| C09-21 | DF-18：后台召唤事件与前台动作交错 | 两个通道各自匹配，召唤不受前台顺序约束 |
| C09-22 | DF-19：只改一个观测的读数；只改一个锚点；两个签名相同的 `engineError` 结果 | 前两种 `runId` 不变而报告身份变了；后者都 `score: null`、都没有名次 |
| C09-23 | DF-18 第二轮：同一角色同一动作的三条观测 O0、O1、O2 在 0、0.1、0.2 秒，两条仿真事件 E0、E1 在 0.1、0.2 秒 | O1 是 `ambiguous`，`candidates` 含 E0 与 E1；C09-20 的唯一满配例仍然没有歧义 |

## 8. 验收清单（阶段四）

- [ ] 路线图 §9.2 的 P2 完成标准：9 秒 → 5 秒的反例不再得高分（C09-13）；能区分单位错、漏动作、资源时机（分通道残差）；分不清时保留候选（C09-10）。
- [ ] `tests/fit-eligibility.test.ts` 覆盖架构 §10.3 的四种情形。
- [ ] 状态同步不发业务触发，账本闭合、`checkLog`、零干扰都通过。
- [ ] 中 3、中 4 按新写法重记；报告里标明哪些时段是有条件推演、哪些读数被用作输入。
- [ ] 两项证据任务各有闭环记录；结论照实（可以是分不清）。
- [ ] 任何报告都不把"贴合"写成"机制对"，不把"补了状态"写成"恢复了历史"（路线图 §9.3 阶段四那一行）。

## 9. 要同步的正式文档

- TD-09 §2：`同步` 的写法；`replay.segments`；`能量满` 标为旧写法直至删除。
- TD-02：`InterventionRecord`、`video.switches`、`video.hits`、`FitResult` 等。
- TD-06：状态同步是第三个资源写入点；差额的两个口径。
- TD-10 §6：贴合度的资格、签名、分组、评分定义的身份。
- TD-11 §6、TD-12 §2.1：视图 F 的有条件标注、按通道的匹配状态。
- 总设计 §13：假设 `forced-sync`；`forced-energy` 的去留。
- `docs/rotation-video.md`、`docs/video-input-guide.md`：三种时段怎么记。

## 10. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD09-Q1 | 同步值的单位 | `=62` 绝对值与 `62%` 比例两种都支持；只支持一种 | 两种都支持。读协奏环得到的是比例，读能量数字得到的是绝对值 |
| DD09-Q2 | 三种时段写在哪 | A：独立的 `replay.segments` 块；B：写成轴里的指令 | A。时段是对录像的说明，填法才是轴；分开写，变体不会动到时段 |
| DD09-Q3 | 匹配的目标 | 先配对数最多、再总时刻差最小；只看总时刻差 | 前者。否则会为了缩小时刻差而少配 |
| DD09-Q4 | 旧场景的切人类型参照 | 过渡期从原场景冻结；必须先补 `video.switches` | 过渡期冻结并标明；重记时补齐 |
| DD09-Q5 | 填法组合的上限 | 16；不设 | 16，超过要显式指定。组合爆炸时结果也读不过来 |
