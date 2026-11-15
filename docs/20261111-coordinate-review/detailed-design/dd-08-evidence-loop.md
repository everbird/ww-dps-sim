# DD-08 证据闭环与进游戏实验的做法

**版本**：v0.4，2026-11-14，Claude。v0.2 按第一轮评审修订（[意见文件](detailed-design-feedback.md) §10：DF-16、DF-17）；v0.3 按 Codex 第二轮复核修订（意见文件 §13：DF-16 的区分力）；v0.4 按第三轮复核统一单候选分支（意见文件 §16：DF-16）。
**状态**：Final（2026-11-15）。本文 v0.4 即签署版本，Claude、Codex、Antigravity 三方通过（[意见文件](detailed-design-feedback.md) §16–§18；整套见[总览](README.md)）；定稿时按意见文件 §17.2 在 §4.1 作一处文字澄清，判定不变。还没实现。
**阶段**：三。**前置**：DD-03（量尺）、DD-04（台账与候选）、DD-07（查询）。**被依赖**：DD-09。

## 1. 范围与依据

阶段三的目标（路线图 §9.3）：**一条共享规则走完收敛闭环**。交付的是一张结构化的记录："候选 → 条件化预测 → 观测及误差范围 → 判断 → 采用决定 → 受影响场景重跑"。"现有观测下分不清、还缺哪项观测"同样是合格的结论（路线图 §9.1 第 4 条）。

做（路线图 §5、§6.1、§7、§10；架构 §8.1 的证据部分、§10.1–§10.2）：
- **观测的数据模型**：在校准点上扩出阶段三要用的几种观测。
- **`compareObservations`**：少数明确观测字段的结构化比较。
- **闭环记录**的格式、存放与生成命令。
- **进游戏实验的做法**：事先登记预测、录制与读数的要求、入账。
- **三个回填案例**与**第一条新闭环**的选题。
- 证据入台账；字段出处；"已处理的 flag 不等于已验证"的显示。

不做：
- 完整的录像匹配（DD-09）。
- 把全部假设补齐证据。只做闭环涉及的命题。
- 自动的"数据版本差异 → 受影响规则"（路线图 §5.4 说是待实现的能力，本阶段仍人工维护）。

## 2. 现状

| 事实 | 位置 |
|---|---|
| 校准点三种：面板一项、某一下的跳字、一轮时长；DD-03 之后带 `clock`、`branch`、`gameRange`、`purpose`、`condition` | `calibration.schema.ts` |
| 实验手册按题号写了账号、操作、看什么、交什么、答案改变什么；开头的优先顺序按 DPS 敏感度排 | `docs/verify-guide.md` |
| 录像截图的存放与裁切坐标、训练场按键记录的格式已有约定 | `docs/okww-axis-notes.md`；记忆里的 `~/.cache/ww-frames` |
| 已解的案例与未解的案例散在各确认清单与复盘里 | `docs/m0-confirm.md`、`docs/tower-20261026.md`、`docs/replay-retro.md` |
| 假设表的"依据"是一段文字，不分支持的是哪个候选、用途是什么 | `assumptions.ts` 的 `why` |

## 3. 观测

### 3.1 种类

`src/data/calibration.schema.ts` 的判别联合再加三种。它们和已有三种共用 `Base`（含 DD-03 加的 `gameRange`、`purpose`、`condition`）：

```ts
// 两个事件之间隔多久
z.strictObject({ ...Base, kind: z.literal('interval'),
  from: EventSelector, to: EventSelector,
  clock: z.enum(['world', 'battle']),          // 必填：录像数帧是 world；深塔倒计时是 battle
  unit: z.enum(['frames', 'seconds']).default('frames') }),

// 某个时刻某人某种资源的值（或占上限的比例）
z.strictObject({ ...Base, kind: z.literal('resourceAt'),
  at: EventSelector, when: z.enum(['before', 'after']).default('after'),
  char: z.string(), resource: z.string(),      // 'energy'、'concerto' 或核心资源名
  as: z.enum(['value', 'ratio']).default('value') }),

// 某次切人是变奏还是普通
z.strictObject({ ...Base, kind: z.literal('switchType'), at: EventSelector, expect: z.enum(['intro', 'normal']) }),
```

```ts
const EventSelector = z.strictObject({
  type: z.enum(['actionStart', 'switch', 'hit', 'intro', 'outro', 'buffApply', 'buffExpire']),
  char: z.string().optional(), action: z.string().optional(), judgment: z.string().optional(), buff: z.string().optional(),
  loop: z.number().int().min(0).optional(),    // 限定在第几轮里
  nth: z.number().int().min(1).default(1),     // 满足条件的第几个
})
```

- `switchType` 没有数值，`game` / `gameRange` 不用填，实测结果写在 `expect`。
- 时刻与数值都能写区间（`gameRange`）。读数的精度写进 `condition.note`，例如"30 帧录像，±2 世界帧"。
- 文件名与位置不变（`docs/calibration/points.yaml`）；"校准点"在文档里改叫"观测"，类型名 `CalibrationPoint` 留一个别名 `Observation`。

### 3.2 比较

`src/engine/observations.ts`（④；DD-03 已放了 `ComparisonStatus`）：

```ts
export interface ObservationComparison {
  readonly observationId: string
  readonly status: ComparisonStatus
  readonly sim: readonly number[] | string | null      // 数值、类别，或取不到
  readonly residual: number | null                     // 相对或绝对，见 residualKind
  readonly residualKind: 'relative' | 'absoluteFrames' | 'categorical' | null
  readonly branches?: CalibrationResult['branches']    // 跳字、分支未知时
  readonly reason?: string                             // unmatched / ambiguous / insufficientCondition / unassessable 时必填
}

export function compareObservations(p: PreparedRun, res: SimResult, observations: readonly Observation[]): QueryEnvelope<readonly ObservationComparison[]>
```

各状态的含义（架构 §10.2）：

| 状态 | 什么时候 |
|---|---|
| `passed` | 仿真值落在观测（点值加容差，或区间加容差）里 |
| `conflicted` | 落在外面；`switchType` 的类别不同 |
| `unmatched` | 选择器在日志里找不到对应的事件（名字错、轮次不够、运行在那之前停了）。运行提前停的，`reason` 带完成状态 |
| `ambiguous` | 跳字分支未知而至少一支相容；选择器在同一帧匹配到多个无法区分的事件 |
| `insufficientCondition` | 观测的 `condition.unknowns` 里有这个比较必需的条件。必需哪些由观测自己的 `requires: string[]` 声明（如 `'敌人等级'`、`'首位声骸'`） |
| `unassessable` | 观测没有实测值 |

- `interval` 的容差按帧给绝对值（缺省 ±1 帧；30 帧录像缺省 ±2），不用相对误差：间隔很短时相对误差没有意义。`DEFAULT_TOLERANCE` 加一项。
- `resourceAt` 的 `before` / `after` 用账本取值（DD-06）：`at` 选中的事件之前最后一条、或它引出的条目之后的余额。
- 容差在看到比较结果之前定：闭环记录里的"判据"一栏在登记预测时就填（§5.2）。
- 信封里的 `observationSummary` 按四类计数（架构 §2.7）。

`calibrate()`（面板、跳字、时长）改成 `compareObservations` 的薄包装；`pnpm calibrate` 的表多出新种类的行。

## 4. 闭环记录

### 4.1 格式与存放

一条闭环一个文件：`docs/evidence/<闭环 ID>.yaml`，schema 在 `src/data/evidence.schema.ts`（新）。

```ts
export interface ClosureRecord {
  readonly id: string                          // 'ult-input-locks-switch.2026-11'
  readonly propositionId: string
  readonly question: string                    // 一句话：这次要区分什么
  readonly kind: 'backfill' | 'experiment'     // 回填已有材料，还是新做实验
  /** 实验才有：预测是在观测之前登记的 */
  readonly preRegistration?: {
    readonly commit: string; readonly date: string
    readonly identities: readonly string[]     // 每个预测运行的完整 RunIdentity 存放在哪（随记录保存的身份文件）
    readonly observationsDigest: string        // 参与判断的观测定义的摘要：选择器、单位、时钟、分支、用途、容差、requires；不含实测读数
    readonly predictionsDigest: string         // 全部预测值的摘要
  }
  readonly setups: readonly {                  // 用来出预测的场景；通常是专门写的小场景
    readonly id: string; readonly scenario: string; readonly note?: string
  }[]
  readonly candidates: readonly {
    readonly candidateId: string
    readonly conditions: string                // 这个候选写全的条件：触发点、时钟、时长、目标、适用范围
    readonly runs: readonly { readonly setupId: string; readonly runId: string; readonly status: RunStatus }[]
    readonly predictions: readonly { readonly observationId: string; readonly predicted: number | readonly [number, number] | string | null }[]
  }[]
  readonly criteria: string                    // 判据：容差、怎样算支持 / 冲突 / 分不清。在观测之前写
  readonly observationIds: readonly string[]   // points.yaml 里的观测
  readonly verdicts: readonly {
    readonly candidateId: string
    readonly perObservation: readonly {
      readonly observationId: string; readonly status: ComparisonStatus; readonly residual: number | null
      readonly purpose: EvidencePurpose; readonly covered: boolean          // covered：观测落在这个候选运行的覆盖范围里
    }[]
    readonly overall: 'consistent' | 'inconsistent' | 'notAssessed'
    readonly notAssessedReason?: 'unimplemented' | 'engineError' | 'noCoveredObservation' | 'allInsufficient'
    readonly runStatuses: readonly RunStatus[]                           // 各 setup 的运行状态；axisFailed 原样留着
    readonly intentFailures?: readonly string[]                          // axisFailed 的明细：这个候选下哪条意图不成立
  }[]
  /** 结论说的是哪个候选、证据强度到哪、命中决策表的哪一行（DF-16） */
  readonly conclusion: {
    readonly proposition: Conclusion           // 架构 §8.1 的七种
    readonly about: string | null              // 结论所指的候选；没有可评估的候选时为 null
    /** 结论靠哪些观测，按决策表的行填（见下面的说明，DF-16 第三轮）：有被判 inconsistent 的竞争候选时是排除它们的观测；
     *  没有时是与 A 相容的观测；A 不相容时是与 A 冲突的观测。只有 unverified 可以为空 */
    readonly basis: {
      readonly independent: readonly string[]      // 起作用的 independent_validation 观测
      readonly other: readonly string[]            // 起作用的 formulation / selection / unspecified 观测
      /** 每个竞争候选被哪些观测排除（A 相容、它冲突的那些），独立的与其他的分开 */
      readonly excludedBy?: Readonly<Record<string, { readonly independent: readonly string[]; readonly other: readonly string[] }>>
    }
    readonly rule: number                      // §4.1 决策表的行号
    readonly suggests?: readonly string[]      // refuted 时：与观测相容的其他候选
  }
  readonly scopeTested: string                 // 结论成立的条件：版本、角色、配装、敌人
  readonly discriminatingObservationNeeded?: string   // 分不清时：下一项能区分的观测
  readonly decision: { readonly adoptedBefore: string; readonly adopted: string; readonly defaultChanged: boolean; readonly note: string }   // 人做的采用决定，与结论分开存
  readonly reruns: readonly {                  // 采用决定之后受影响场景的重跑
    readonly scenario: string
    readonly before: { readonly runId: string; readonly status: RunStatus; readonly dps: number | null; readonly steadyLoopBattleFrames: readonly number[] | null }
    readonly after: { /* 同上 */ }
    readonly changed: boolean
  }[]
  readonly notes?: string
}
```

**候选级判断**（DF-16）。由生成命令按下面的规则算，不靠人填：
- **只用评分观测**：`purpose: given` 的观测是输入，不参与判断。
- **单条观测对单个候选**：`passed` 算相容；`ambiguous` 算相容但不区分；`conflicted` 算不相容；`unmatched`、`insufficientCondition`、`unassessable` 两边都不算。
- **运行状态**：`engineError` 的那次运行作废，它的观测都不算。`truncated`、`axisFailed` 的运行，覆盖范围以内的观测照常比，覆盖范围以外的记 `covered: false`，不算不相容，也不把整个 setup 的预测抹成空。`axisFailed` 另作线索记在 `intentFailures`（"这个候选下意图不成立"）；只有某条观测明确表明那个意图在游戏里成立了（例如录像里那次是变奏切人），才经由那条观测算不相容。
- **候选的 `overall`**：至少一条不相容 → `inconsistent`；没有不相容、至少一条相容 → `consistent`；其余 → `notAssessed`，并写原因：候选未实现、引擎错误、没有覆盖到的观测、全部条件不足。
- **每条观测与候选的关系**（架构 §8.1 的三种）：同一条观测上，相容的候选集合记 P，冲突的记 C。P、C 都不空：这条观测支持 P 里的候选（相对 C 而言），反驳 C 里的；只有 P：与 P 里的候选相容但区分不了（`consistentWith`）；只有 C：反驳 C 里的。台账里的 `Evidence` 照这个关系写，不把"通过了"一律写成 `supports`。
- **独立用途与区分力分开判**（DF-16 第二轮）：竞争候选 B 被"独立地排除"，当且仅当至少有一条 `independent_validation` 的观测**同时**满足"A 相容、B 冲突"。只"有一条独立观测通过"不够：它若同时相容 B，对 A、B 只是 `consistentWith`。排除 B 的若只有选模材料，B 就只算被选模材料排除。`basis.excludedBy` 按竞争候选逐个列出排除它的观测。

**命题结论的决策表**。按当前采用的候选 A 的判断、以及其余候选的情况分行，各行互斥，覆盖全部情形：

| # | A | 其余候选 | `proposition` | `about` | 说明 |
|---|---|---|---|---|---|
| 1 | notAssessed | 没有一个可评估 | `unverified` | null | |
| 2 | notAssessed | 有可评估的 | `unverified` | A | 其余候选的判断照记；要先让 A 可评估 |
| 3 | consistent | 有 consistent 的 | `ambiguous` | A | 必须填 `discriminatingObservationNeeded` |
| 4 | consistent | 没有 consistent，至少一个 inconsistent，且其余都可评估 | 每个竞争候选都被独立地排除 → `supported`；否则 `provisional` | A | `basis.excludedBy` 写明哪些候选只被选模材料排除 |
| 5 | consistent | 没有 consistent，但有 notAssessed（未实现、被截断等） | `provisional` | A | 不能因为别的候选没评估就当它们被排除了 |
| 6 | consistent | 没有其他候选 | `provisional`（不论 `candidatesExhaustive` 与观测用途） | A | 没有竞争候选，就没有被排除的读法：观测对 A 只是 `consistentWith`，不升为 `supported`（DF-16 第三轮）。要得到 `supported`，先登记一个能给出不同预测、已实现的竞争候选，再用独立观测把它排除 |
| 7 | inconsistent | 有 consistent 的 | `refuted` | A | `suggests` 列出相容的候选；要填 `decision` |
| 8 | inconsistent | 全部可评估且全部 inconsistent | `candidatesExhaustive` → `conflicted`；否则 `outOfScope` | A | 人可以改选另一个，写理由 |
| 9 | inconsistent | 没有 consistent，有 notAssessed | `refuted` | A | 其余候选的情况照记；不推出谁对 |

- `refuted` 不要求独立观测：用来挑选读法的材料同样可以否定一个读法。`given` 的观测照样不参与。`refuted` 时 `basis` 列出与 A 冲突的观测，独立的与其他的分开，所以"有独立反证"不会显示成"没有证据"（DF-16 第二轮）。
- 闭环 YAML、`pnpm evidence --md` 的总表、台账里的命题结论都由同一个函数按这张表算出，三处一致，不依赖 if 分支的先后（C08-7、C08-13～C08-16、C08-19～C08-22 各覆盖一行或几行）。
- **`basis` 按行填**（DF-16 第三轮）：
  - 第 4 行，以及第 5 行里有被判 inconsistent 的竞争候选时：列排除这些竞争候选的观测（A 相容、它冲突），`excludedBy` 逐个候选写。某个竞争候选只在 A 没评估到的观测上冲突、没有这种观测时，`excludedBy` 里它那一项为空，`basis` 另列与 A 相容的观测（这时第 4 行也只能给 `provisional`）；
  - 第 3 行、第 6 行，以及第 5 行其余候选全是 notAssessed 时：列与 A 相容的评分观测，`excludedBy` 省略。各观测与候选的关系沿用前面的 P/C 规则，`basis` 只收集观测引用，不改写它们已有的关系：比如一条观测相容 A、B 而冲突 C，它相对 C 对 A、B 仍是 `supports`，只是分不开 A 与 B，整体仍是第 3 行的 `ambiguous`（Codex §17.2 的澄清）；
  - 第 7～9 行：列与 A 冲突的观测；
  - 第 1、2 行（`unverified`）可以为空；其余各行 `basis` 都不为空。
- **只有第 4 行能给出 `supported`**：它要求每个竞争候选都被同一条独立观测排除，那条观测对 A 就是 `supports`，§4.3 的入账约束自然满足。v0.3 的第 6 行在单候选时也给 `supported`，而那时观测对 A 只是 `consistentWith`，过不了入账约束；v0.4 统一成 `provisional`（Codex §14.3 的方案一）。
- **不选赢家**：`decision` 与结论分开存。`ambiguous` 时 `decision.adopted` 保持 `adoptedBefore`，`defaultChanged: false`。

### 4.2 命令

`src/cli/evidence.ts`，`package.json` 加脚本 `evidence`：

```bash
pnpm evidence predict docs/evidence/<ID>.yaml     # 跑各候选在各 setup 上的运行，填 runs 与 predictions；登记之后只能 --verify
pnpm evidence judge docs/evidence/<ID>.yaml       # 观测填好之后：拿冻结的预测与读数比，出 verdicts 与 conclusion；decision 留给人填
pnpm evidence rerun docs/evidence/<ID>.yaml       # decision 填好之后：重跑受影响的场景，填 reruns
pnpm evidence --md                                # 把全部闭环记录渲染成 docs/evidence/README.md 的总表
pnpm evidence --stale                             # 列出观测的游戏版本与当前声明的不同、需要复核的证据
```

- **`predict`**：对每个候选用 DD-04 的 `RunOverrides` 生成运行，逐个观测取仿真值作为预测。某个 setup 在某个候选下 `axisFailed` 或截断时照实记状态；覆盖范围以内的观测照常有预测，只有覆盖范围以外的是 null 并标原因（DF-16）。**登记之后**（`preRegistration` 已填）不再覆写任何字段，只接受 `--verify`。
- **登记冻结什么**（DF-17）：提交号与日期之外，`preRegistration` 还存每个预测运行的完整 `RunIdentity`（随记录保存的身份文件，含 setup 与候选的覆盖值）、观测定义的摘要 `observationsDigest`、全部预测值的摘要 `predictionsDigest`。
- **`judge`**：直接拿冻结的预测与观测的实测读数比，不重新跑仿真。比较用 `observations.ts` 里与 `compareObservations` 共用的纯函数 `compareValue(observation, predicted)`。它先核对两件事：观测定义的摘要与登记时相同（只填了读数、没改定义与容差），预测的摘要与登记时相同。任何一项不同，返回"预测或判据在登记后改过，需另开一条记录"，不判。拒绝在 `preRegistration` 为空的 `experiment` 记录上运行。
- **`judge --verify`**：另外用当前代码重跑各预测运行。`runId` 与登记的不同（代码、数据或场景变了），报"预测已过期"，也不判。
- **`rerun`**：在**同一份当前代码**上，对每个受影响的场景跑两次：一次用采用决定之前的值（`decision.adoptedBefore` 的绑定，显式写进 `RunOverrides`），一次用之后的值。所以不论缺省是否已经改了，这都是"同一实现下两种采用值"的对照，两边都带身份。要看跨代码版本的历史变化，另读登记时存下的运行身份与结果，标明是不同版本，不与前一种混在一张表里（DF-17）。
- "受影响场景"：`scenarios/` 下 `purpose: rotation` 的场景里，基准运行的 `ruleUsage` 中这条命题 `decisiveCount > 0` 的；再加上 `summary.assumptions` 里碰到对应假设的。`defaultChanged` 为假时两次应当相同，照样跑并断言。
- 三个子命令都只写自己负责的字段，重复运行结果不变。

### 4.3 进台账

闭环有了结论之后，在 `propositions.ts` 对应的命题上：
- 加一条或几条 `Evidence`（架构 §8.1）：`supports` / `refutes` / `consistentWith` 填候选 ID；`purpose` 照实；`observation.gameVersion` 与 `condition`；`simulationRunId` 取预测用的运行；`ref` 指向闭环文件。
- 更新 `conclusion`；采用的候选变了就改 `adopted` 与规则的缺省值，并按 AGENTS.md 配用例。
- **用途的约束**（`tests/propositions.test.ts` 加断言）：`conclusion === 'supported'` 的命题，至少有一条 `purpose === 'independent_validation'` 且 `supports` 含当前采用候选的证据；只有 `formulation` / `selection` 证据的，结论最多是 `provisional`。这与 §4.1 的决策表一致：只有第 4 行给 `supported`，单候选的第 6 行只给 `provisional`，所以不会出现一处报支持、另一处拒绝入账（DF-16 第三轮）。
- **三种关系不混**：两个候选都预测到同一个观测值时，这条证据对它们都是 `consistentWith`，不是 `supports`。

## 5. 进游戏实验的做法

实验在真正动工以后才做（路线图 §0.2 第 5 条）。操作步骤以 `docs/verify-guide.md` 的题目为准，这里定的是它没有写的四件事：事先登记、录制、读数、入账。

### 5.1 一项实验的记录

每项实验在 `docs/experiments/<题号>-<简称>.md` 有一页，按固定的栏目写：

| 栏目 | 写什么 |
|---|---|
| 命题与候选 | 台账里的命题 ID；每个候选写全条件 |
| 账号与配置 | 哪个账号；角色、链数、武器、声骸首位；与对应场景文件不同的地方 |
| 场地与敌人 | 训练场还是深塔哪一层；敌人、等级；环境效果 |
| 初态 | 能量、协奏、核心资源、形态、冷却；怎么把它摆成这样 |
| 操作 | 逐步的按键；引用手册的题号，不重抄 |
| 控制与重复 | 对照组是什么；每组做几次（缺省 3 次） |
| 录什么 | 见 §5.3 |
| 读什么 | 每个观测怎么从录像里读出来，读成点值还是区间 |
| 预测 | 由 `pnpm evidence predict` 生成的表：每个候选、每个观测的预测值 |
| 判据 | 容差；怎样算支持、冲突、分不清 |
| 成本 | 操作、换号、重置、读数各估多少；实际花了多少（做完再填） |
| 结果 | 做完后填：观测 ID、读数、指向闭环记录 |

### 5.2 先登记预测，再进游戏

1. 写好实验页的前七栏与判据，写好 setup 小场景与观测（`game` 留空）。
2. `pnpm evidence predict`，把预测填进闭环文件与实验页。
3. **检查这个实验能不能区分候选**（DF-16 第二轮）：每个观测上，按预登记的判据算出各候选的接受区间（预测 ± 容差；区间读数、分支未知时按完整的区间与两个分支算），两两比较。两个候选的接受区间不重叠，这条观测对这两个候选"可区分"；重叠的标"可能区分不了"：读数落在重叠处时两者都相容。容差不能小于读数精度。全都区分不了的实验先不做，在闭环文件里写明原因。登记时可区分只说明有机会区分，实际的关系以 `judge` 按 §4.1 算出的为准。
4. **提交**。闭环文件的 `preRegistration` 记这次提交的哈希与日期，以及预测运行的身份、观测定义与预测值的两个摘要（§4.2）。之后不再改 `candidates`、`criteria` 与观测的容差；要改就另开一条闭环，旧的保留。
5. 进游戏做实验。

第 3 步是"先列候选与预测"（路线图 §7 第 7 步）的可执行版本：它在进游戏之前就告诉你这次录制值不值得做。

### 5.3 录制与读数

- **录制**：60 帧、原始分辨率；HUD 全开，能看到技能栏冷却、协奏环、回路条、敌人血条；训练场开伤害数字；每段录像开头念出或打出题号与第几次。录像放 `~/wuthering-waves/experiments/<日期>/`，文件名带题号。
- **按键记录**（可选）：有条件时同时开"跑轴记录"插件，按 `docs/okww-axis-notes.md` 的格式留一份按键时间，读帧时省去判断"哪一帧按下"。只借格式，不抄代码。
- **读帧**：逐帧截图放 `~/.cache/ww-frames/`。读的是"可见的现象出现的第一帧"，例如 HUD 消失的第一帧、切人后新角色头像亮起的第一帧。每个读数记成帧范围 `[最早可能, 最晚可能]`，再换成观测的 `gameRange`。
- **观测帧与模型帧分列**：实验页里录像帧号与换算出的模型帧各占一列，写明换算（起点对齐在哪个事件上）。不用模型里的 1–2 帧去预先修正读数（路线图 §10.2）。
- **时钟**：录像数帧得到的是世界帧；用深塔倒计时读的是战斗时钟。观测的 `clock` 照实填。
- **读不出来就写读不出来**：遮挡、掉帧、HUD 没刷新时，这次重复作废或把区间放宽，不靠猜。

### 5.4 各题的设计要点

题号与操作见手册。下表是每题的观测与判法；"共享"指检验的是共享运行规则，可以作为阶段三的闭环样例。

| 题 | 命题 | 共享 | 观测 | 各候选预测的差别 | 备注 |
|---|---|---|---|---|---|
| B7、C5 | `ult-input-locks-switch` | 是 | `interval`：大招 `actionStart` → 紧接着的 `switch`，世界帧。连按切人键，取最早成功的一次 | `locks` 与 `free` 相差的就是"不响应输入"比动画多挡的那几帧（卜灵约 7 帧） | 差别小，必须 60 帧录像；卜灵与椿各做，两个角色一致才算对共享规则的支持 |
| B10 | 同类加成的叠加（台账里新开一条） | 是 | `hit`：同一下攻击在四种组合下的跳字（都没有、只有超负荷、只有无归的谬误、两者都有），分支标明 | 叠加：两者都有 = 基准 ×（1 + 两个加成按同一乘区相加）；不叠：等于只有一个 | "不叠"的候选现在没有实现，先入账为未实现；预测可以手算。四种组合缺一不可 |
| B1 | `forte-keep.心-照世相` | 否 | 直接观察：切走再切回后回路条与动作形态 | 类别不同 | 不经仿真比较，直接记一条证据 |
| B2 | `forte-keep.卜灵-卦象` | 否 | 同上 | 类别不同 | 与 B1 分开入账 |
| B11 | `summon-as-char` | 是 | 心在后台时阵的冲击波命中后，心身上有没有霆心域（切回来看状态或下一下的跳字） | 类别不同；或 `hit` 的倍数差 | 保持手册的原条件 |
| A1、A2 | 公式层的锚点（不是单条命题） | — | `panel` 与开场几下的 `hit`，分支标明 | — | 给后面所有跳字比较提供"面板对不对"的前提；`purpose: given` 或 `independent_validation` 视用途定 |
| C1 | 椿的动作（角色内容） | 否 | 直接观察 | 类别不同 | |
| C4 | 出场技的入场条件 | 是 | 直接观察：入场后先闪避再按 A 出的是哪个动作 | 类别不同 | |
| 待设计 | `echo-input-priority` | 是 | `interval`：重击或技能的 `actionStart` → 声骸的 `actionStart`，在后摇里尽早按 Q | 两个候选相差"能不能打断后摇"的那段帧数，通常几十帧 | 手册里还没有这一项；差别大、容易读，是代表轴两对组合效应的交汇点 |

### 5.5 第一条新闭环选哪条

按"能检验一条共享规则"选（路线图 §9.1 第 4 条），不按回包先后。三个候选题目的比较：

| 题目 | 候选都能跑吗 | 预测差别 | 读数难度 | 对代表轴的意义 |
|---|---|---|---|---|
| `echo-input-priority`（待设计的那题） | 能 | 几十帧 | 低 | 高：M0 两对组合效应都涉及它 |
| `ult-input-locks-switch`（B7、C5） | 能 | 约 7 帧 | 高 | 中：C5 是椿的大招 |
| 同类加成的叠加（B10） | "不叠"未实现 | 跳字差约 9% | 低 | 低：心队的事 |

**第一条做 `echo-input-priority`**（用户 2026-11-14 同意）：两个候选现在都能跑、差别大、和代表轴直接相关。它的实验页要新写（T08-6），题目也要加进 `verify-guide.md`（T08-9）。什么时候进游戏由用户安排。

## 6. 三个回填案例

路线图 §9.5 的软件验收要求：已解的真实案例（散华 E、焰痕）和一个分不清的案例（卜灵协奏时机）各走完一遍。它们不用进游戏，用现有材料按 §4 的格式回填，`kind: 'backfill'`。

| 闭环 ID | 材料 | 预期的结论 | 要注意的 |
|---|---|---|---|
| `sanhua-e.backfill` | `docs/m0-confirm.md` §11 里散华 E 的那几条与对应的视频时刻 | `supported` 或 `provisional`，看有没有不参与挑选的观测 | 把当时参与"决定怎么读"的观测标 `selection`；只有另外独立对上的才标 `independent_validation` |
| `yanhen.backfill` | `docs/tower-20261026.md` 中 2 的跳字对照：两次狼舞的决意·极 19482、破敌 9606 | `provisional` | 这两个跳字参与了模型选择，不能再当独立检验（路线图 §5.3）。记录里要写出下一项独立观测是什么 |
| `buling-concerto-timing.backfill` | `docs/replay-retro.md` §4 与 `docs/tower-20261026.md` 中 4 第 9 条：切走时协奏总量相符，段中仿真偏高 | `ambiguous` | 候选至少列"到账时机不同""时刻对齐有偏差"，标 `candidatesExhaustive: false`；必须填 `discriminatingObservationNeeded`（例如训练场里单放卜灵某一招，逐帧读协奏环在命中前后的变化） |

回填时每个案例都要经过一遍：写 setup 小场景或指定现有场景 → 把读数写成观测 → `predict` → `judge` → 入台账。做不下去的地方（材料缺条件、读数没有区间）照实写成 `insufficientCondition`，这正是回填要暴露的东西。

仿真列一律由命令生成并带 `runId`。旧文档里手抄的仿真数不沿用（路线图 §7 案例的最后一条）。

## 7. 字段出处与文档状态

- **字段出处**（R07）：闭环涉及具体数据字段时（某判定的协奏、某动作的帧数），在命题上填 `fieldProvenance`（架构 §8.1）：原始来源用数据身份加定位符（xlsx 的 sheet 与 A 列块名、行内的列名；nanoka 的条目键），不写裸行号；转换过程指向构建规则或 curated 里的符号。只给闭环涉及的字段填。
- **"已处理"不等于"已验证"**（R12）：
  - `pnpm check:data -- --flags` 的输出里，"已处理"一栏的表头改成"已处理（采用了某种读法，不代表已证实）"；
  - `pnpm assumptions --ledger` 的表里，"采用"与"结论"是两列，结论缺省是"未验证"；
  - 各确认清单（`m0-confirm.md` 等）不改正文，只在开头加一句指向台账。
- **换版之后**：`pnpm evidence --stale` 按观测的 `gameVersion` 列出要复核的证据。沿用的证据在台账里显示"沿用自 <版本>，待复核"，结论不升级（路线图 §5.4）。当前的游戏版本写在哪里（`data/xlsx-versions.json` 加一个手填的 `gameVersion`，还是另放），T08-7 时定。

## 8. 实施步骤

| 编号 | 做什么 | 改哪里 | 做完的判据 |
|---|---|---|---|
| T08-1 | 三种新观测与选择器 | `calibration.schema.ts` | C08-1 |
| T08-2 | `compareObservations`；`calibrate` 改成包装 | `observations.ts`、`calibration.ts`、`src/cli/calibrate.ts` | C08-2～C08-6；现有 37 个点的输出不变 |
| T08-3 | 闭环记录的 schema 与 `pnpm evidence` 的三个子命令 | `src/data/evidence.schema.ts`、`src/cli/evidence.ts`、`observations.ts` | C08-7～C08-10、C08-13～C08-18 |
| T08-4 | 证据入台账的约束 | `propositions.ts`、`tests/propositions.test.ts` | C08-11 |
| T08-5 | 三个回填案例 | `docs/evidence/*.yaml`、需要的小场景、`points.yaml` | 三份记录都能 `predict` / `judge`；结论与 §6 的预期不同时写明为什么 |
| T08-6 | 实验页模板与第一条闭环的实验页、预测登记 | `docs/experiments/` | 预测已提交，`preRegistration` 已填；区分度检查通过 |
| T08-7 | 文档状态的三处显示、`--stale` | `src/data/check-generated.ts`、`src/cli/assumptions.ts`、`src/cli/evidence.ts` | 人工看一次 |
| T08-8 | 进游戏、读数、`judge`、`decision`、`rerun`、入台账 | 用户做实验；其余同上 | §9 的清单 |
| T08-9 | `verify-guide.md` 按账号与目的分包重排，B10 写成四种组合，加 `echo-input-priority` 一题 | `docs/verify-guide.md` | 与 §5.4 的表一致 |

T08-1～T08-7 不用进游戏。T08-8 等用户安排。

## 9. 用例

`tests/observations.test.ts`（新）与 `tests/evidence.test.ts`（新），合成数据：

| 编号 | 前提与操作 | 断言 |
|---|---|---|
| C08-1 | 选择器写不存在的事件类型；`interval` 不写 `clock` | schema 报错 |
| C08-2 | 合成轴：大招在世界帧 100 开始、有 60 帧全局时停，切人在世界帧 240。`interval` 观测分别按 `world`、`battle` | 仿真值 140 与 80；观测写 `[139, 141]` 世界帧时 `passed` |
| C08-3 | `resourceAt`：命中给 10 协奏，`when: before` 与 `after` | 相差 10；取值来自账本 |
| C08-4 | `switchType`：`expect: intro`，仿真里是普通切人 | `conflicted`，`residualKind: 'categorical'` |
| C08-5 | 选择器指向运行截断之后的事件 | `unmatched`，`reason` 里有完成状态 |
| C08-6 | 观测声明 `requires: ['敌人等级']`，`condition.unknowns` 里有它 | `insufficientCondition` |
| C08-7 | 两个候选的合成闭环，观测只和采用的 A 相容，观测标 `independent_validation`；同一组数值改标 `selection` 再判 | 前者 `supported`、`about: A`、决策表第 4 行；后者 `provisional`；两次 `decision` 都没被自动填 |
| C08-13 | 采用 A，独立观测只和 B 相容 | `refuted`、`about: A`、`suggests: [B]`（第 7 行） |
| C08-14 | A 相容；B 未实现。另一组：B 的运行在观测之前就截断了 | 两组都是 `provisional`（第 5 行），B 是 `notAssessed`，原因分别是 `unimplemented` 与 `noCoveredObservation` |
| C08-15 | 一条覆盖范围以内的观测加一条截断之后才发生的观测 | 后者 `covered: false`，不算不相容，也不把前者的预测抹掉；结论只由前者定 |
| C08-16 | 所有候选都相容 | `ambiguous`（第 3 行），没填 `discriminatingObservationNeeded` 时校验失败 |
| C08-17 | DF-17：登记之后只改倍率（代码变）；只改判据的容差；只填游戏读数 | 第一种 `judge --verify` 报"预测已过期"；第二种 `judge` 拒绝；第三种正常判 |
| C08-18 | DF-17：缺省已经改成新值之后跑 `rerun` | 两次运行的 `rules` 里这个开关分别是旧值与新值，身份都带上 |
| C08-8 | 两个候选在全部观测上预测相同 | `predict` 之后的区分度检查报"可能区分不了"；`judge` 后两者对这些观测都是 `consistentWith`，结论 `ambiguous` |
| C08-19 | DF-16 第二轮的混合用途例子：采用 A，候选 A、B 都完整覆盖。旧的 `selection` 观测 A 预测 100、B 130，读数 100 ±1；新的 `independent_validation` 观测 A 预测 100、B 104，读数 102 ±3 | 仍采用 A、`provisional`；`excludedBy.B` 只有那条选模观测；新观测对 A、B 都是 `consistentWith`。把新观测改成只相容 A、明确排斥 B 之后才是 `supported` |
| C08-20 | DF-16 第二轮：候选 A、B，一条独立观测反驳 A、与 B 相容（第 7 行） | `refuted`、`about: A`、`suggests: [B]`，`basis.independent` 含这条观测 |
| C08-21 | DF-16 第三轮：只登记候选 A；`candidatesExhaustive` 为真 / 假 × 观测用途 `independent_validation` / `selection`，四种组合，观测都与 A 相容 | 四种都是 `provisional`（第 6 行）；每条观测 `consistentWith: [A]`、`supports: []`；`basis` 列出这些观测、不为空；`judge`、总表与台账校验三处结论一致，台账校验通过 |
| C08-22 | 只登记候选 A，一条独立观测与它冲突（第 8 行） | `candidatesExhaustive` 为真时 `conflicted`，为假时 `outOfScope`；`basis.independent` 含这条观测 |
| C08-9 | `kind: experiment`、没有 `preRegistration` | `judge` 拒绝运行 |
| C08-10 | `rerun`：`defaultChanged: false` | 每个场景 `changed === false`；人为让它变了时命令以非零退出 |
| C08-11 | 台账里一条 `supported` 的命题只有 `selection` 证据 | 测试失败 |
| C08-12 | 同一份闭环文件 `predict` 两次 | 文件内容相同 |

## 10. 验收清单（阶段三）

- [ ] 三个回填案例各有一份闭环记录，其中 `buling-concerto-timing.backfill` 的结论是 `ambiguous` 并写明了下一项可区分的观测。
- [ ] 至少一条共享规则的新闭环走完：预测在观测之前登记；有判断；有采用决定；受影响场景带 `runId` 重跑。结论是 `supported`、`refuted` 或 `ambiguous` 都算完成。
- [ ] 台账里这几条命题带证据条目，用途、三种关系、条件、版本都填了。
- [ ] 结论变了的命题：代表轴的 `docs/m0-strict-conclusion.md` 重新生成，"依赖的未证实规则"相应变化。
- [ ] `pnpm calibrate`、`pnpm evidence --md` 的输出里，没有任何一处把"相容"写成"证实"。
- [ ] `tests/observations.test.ts`、`tests/evidence.test.ts`、`tests/propositions.test.ts` 全过。

## 11. 要同步的正式文档

- TD-11 §1、§4、§5：两阶段方法（读材料自上而下、做实验自下而上）、候选写全条件、观测帧与模型帧分列；§6：`pnpm evidence`。
- TD-02：观测的三种新种类、`ObservationComparison`、`ClosureRecord`。
- 总设计 T15：证据带三种版本身份；T16：台账的证据部分。
- TD-01 §13–§14：flag 与台账的关系。
- `docs/calibration/README.md`：新种类、仿真列带身份。
- `docs/verify-guide.md`：T08-9。
- AGENTS.md：命令表加 `pnpm evidence`；文档表加 `docs/evidence/`、`docs/experiments/`。

## 12. 待评审的决定

| 编号 | 问题 | 候选 | 建议 |
|---|---|---|---|
| DD08-Q1 | 第一条新闭环做哪条 | — | 已定：`echo-input-priority`（用户 2026-11-14） |
| DD08-Q2 | 闭环记录存成什么 | A：`docs/evidence/*.yaml` 加生成的总表；B：全部写进 `propositions.ts` | A。记录里有运行、预测、重跑，体量大且由命令写；台账只留引用 |
| DD08-Q3 | 预测登记靠什么保证"在观测之前" | 提交哈希与日期；不做保证 | 提交哈希。个人项目里这已经够用，也便于事后核对 |
| DD08-Q4 | 观测要不要从 `docs/calibration/` 搬到新目录、改文件名 | 不搬，只在文档里改叫"观测"；搬 | 不搬。现有的测试与命令都指着它 |
| DD08-Q5 | 每组实验重复几次 | 3 次；按题定 | 缺省 3 次，实验页里可以改并写理由 |
