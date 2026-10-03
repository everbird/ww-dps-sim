# 鸣潮 DPS 引擎 · TD-07 Buff 系统 v0.1

> **状态**：v0.1（2026-09-28 起草）；已按本文实现（2026-09-30，`src/engine/buffs.ts`、`src/engine/triggers.ts`，§10.2 的用例在 `tests/td07.test.ts`）。§12 的清单与 §13 的待定问题仍待确认
> **依据**：《技术总体设计 v0.1.4》（下称"总设计"）§3.2、§4 T8 / T14、§6.3、§6.4 不变量 6、§6.8；《设计文档 v0.2.9》（下称"机制设计"）§6、§6.1；《TD-02 类型与 Schema v0.1.3》§5.1、§7；《TD-03 伤害公式规格 v0.1》§2.3、§4、§9.4；《TD-01 数据字典 v0.1.3》§1.6、§10.2、§13.1；《TD-05 切人与变奏 / 延奏 v0.1》§2、§4.2；《TD-06 资源 v0.1》§5、§6
> **下游**：TD-08（钩子怎么加 buff、用标记型 buff 表示状态）、TD-10（buff 覆盖率的展示）
> **验证**：§11 的 M0 队伍清单逐条对照了 nanoka 3.7 原文与 xlsx「伤害配置」buff 库；规则尚无实现，§10 的用例是实现时的验收标准

---

## 0. 范围与约定

**本文定**：`BuffDef` 每个字段在运行时的含义；实例的施加、叠层、刷新、到期、移除；作用对象怎么落到具体角色；触发事件目录、每种事件的"发出者"与可过滤字段、内置冷却；同一 tick 的处理顺序与连锁；切人时的清除；两种新写法——消耗型（"下次…"）与标记型（只表示状态与计时）；资源型触发效果（`ResourceEffect`）；buff 覆盖率；从原文起草 `BuffDef` 的规则与检查清单；M0 队伍的 buff 清单。

**本文不定**：乘区怎么选（TD-03 §2.3、§9.4）；一次结算怎么收集 buff（TD-03 §4，已实现）；资源怎么加减（TD-06 §5）；角色特化机制（TD-08）。

**约定**：持续时间、内置冷却一律按**战斗帧**（全局时停期间不走，总设计不变量 6）；"持有者"（owner）是登记这条 buff 的角色（角色模块、它的武器与声骸），场景 buff 的持有者是 `env`；"目标"（target）是实例挂在谁身上。

### 0.1 要点

1. 同一条 buff 对同一目标只有一个实例（持有者、定义、目标三者确定一个实例）；再次施加时加 `stackGain` 层（不超过 `maxStacks`），`refresh: 'refresh'` 刷新持续时间，`'keep'` 不刷新（总设计 §6.8）。
2. 触发事件目录不变（总设计 §6.8）：`actionStart`、`judgmentSettle`、`intro`、`outro`、`switchIn`、`switchOut`、`enemyState`、`resourceFull`。每种事件有一个"发出者"，`where.by` 按它过滤（默认 `self`：发出者就是持有者）。
3. **动作类别按技能归类**（dmg `Skill.Type`），不按伤害类型：椿的 E1 / E2 / E3"此次伤害为普攻伤害"，但施放它们是"施放共鸣技能"。TD-01 §13.1 据此修订（§4.3）。
4. 先算伤害，后触发（总设计 §6.3）：一次结算用它之前的 buff 算伤害，再处理它触发的效果。事件按队列依次处理，连锁深度上限 `rules.maxChainDepth`（16）。
5. `onSwitchOut: 'clear'` 只在原文明写"切换至其他角色则提前结束"时用（机制设计 §6.1）；挂在谁身上，谁被切下时移除。
6. 新写法：`consume`（"下次 X…"：被 X 用掉）、标记型（不写 `zone`：只表示状态与计时，给钩子用）、`trigger` 可以写成数组（任一事件触发）。
7. 资源型触发效果（"施放共鸣技能时回复 8 点协奏"）另成一类 `ResourceEffect`，与 buff 共用触发机制，落地调 TD-06 的 `grant`。

---

## 1. BuffDef 字段的运行语义

字段定义见 TD-02 §5.1（`src/data/buff.schema.ts`）；本文新增的三项标 ★。

| 字段 | 含义 |
|---|---|
| `id` | 全局唯一，写成"来源.名目"：`散华.共鸣链6`、`千古洑流.攻击`。日志、覆盖率、钩子都用它 |
| `source` | 原文整句，核对用 |
| `zone` ★可省 | 乘区（TD-03 §2）。**不写 = 标记型**（§7）：不进伤害收集，只表示状态与计时 |
| `value` | 每层的数值；数组 = 武器谐振 R1–R5，装配时按阶取（TD-02 §7.1）。标记型可省 |
| `filter` | 结算时这段伤害吃不吃它（TD-03 §4）：元素、标签、动作、判定、目标身上的效应、效应自身伤害、只进暴击分支 |
| `target` | 挂在谁身上（§3） |
| `maxStacks` / `stackGain` | 层数上限；每次施加加几层 |
| `duration` | 持续战斗帧；`'inf'` 不到期（常驻 buff 必须是 `'inf'`） |
| `refresh` | 再次施加时：`'refresh'` 刷新持续时间（缺省，"重复获得刷新持续时间"）；`'keep'` 不刷新 |
| `onSwitchOut` | `'persist'`（缺省）/ `'clear'`（§8） |
| `icd` | 触发内置冷却（战斗帧）："每 N 秒可触发 1 次" = N × 60 |
| `trigger` ★可为数组 | `'always'`（常驻）；`'hook'`（只由角色钩子施加，如散华的冰、椿的红椿·蕾，2026-10-03 新增）；`{ on, where? }`；或它的数组，任一事件都触发（维里奈固有：重击星星花绽放、大招、延奏三处都给攻击） |
| `consume` ★ | "下次…"：`{ on, where?, stacks? }`，满足时移除（§6） |
| `requires.chain` | 共鸣链门槛，装配时过滤 |

---

## 2. 实例

```ts
// BuffRuntime（TD-02 §7.2，已有）：{ id, defId, owner, target, stacks, remaining, lastTriggerAt }——内置冷却不看 lastTriggerAt，见 §4.4
```

- **身份**：（`defId`, `owner`, `target`）。同一武器两人各带，是两条各自的 buff。
- **施加**：没有实例 → 新建，层数 = min(`stackGain`, `maxStacks`)，剩余 = `duration`；已有 → 层数 = min(层数 + `stackGain`, `maxStacks`)，`refresh` 时剩余 = `duration`。记 `buffApply`（层数、剩余）。层数已满也照常刷新。
- **计时**：P6 按战斗速率递减（TD-04 §1），到 0 移除，记 `buffExpire`（`timeout`）。**施加的那个 tick 算第 1 帧**：`duration` = 480 的 buff 在施加后第 480 个战斗帧的 P6 移除。
- **移除**：到期、切人清除（§8）、被消耗（§6）、钩子 `removeBuff`（`removed`）。
- **常驻**（`trigger: 'always'`）：开场施加，不到期（M2 已实现）。
- **取值**：结算时 值 × 层数（TD-03 §4 第 3 步）。

---

## 3. 作用对象

| `target` | 施加给 | 说明 |
|---|---|---|
| `self` | 持有者本人 | 持有者是 `env` 时给全队 |
| `team` | 三人各一个实例 | "队伍中的角色""附近队伍中所有角色" |
| `teamExceptSelf` | 另两人 | |
| `onField` | 触发型：施加那一刻的前台角色；常驻型：三人都挂，结算时只在出伤者在前台时算 | "当前登场角色" |
| `nextIn` | 由 `outro` 触发：这次变奏的角色（`outro` 事件的 `to`，TD-05 §4.2）；由其他事件或钩子触发：**挂起**，下一次有角色切入（`switchIn`）时施加给他，持续时间从那一刻算 | "下一位登场角色"；挂起期间同一 buff 再次触发按叠层规则累加层数（不超过上限） |
| `enemy` | 敌人 | 所有打这个敌人的伤害都算（TD-03 §4）；异常效应伤害的防御例外见 TD-03 §4 |

挂起的 `nextIn` 记在状态里：

```ts
// SimState 新增（TD-02 §7.2）
pendingNextIn: { owner: Slot | 'env'; defId: string; stacks: number }[]
```

---

## 4. 触发

### 4.1 事件目录

| `trigger.on` | 来自哪条日志事件 | 发出者 | 可用的 `where` 字段 |
|---|---|---|---|
| `actionStart` | `actionStart` | 出招的角色 | `actionKinds`、`actions` |
| `judgmentSettle` | `hit`（含 `dmg: null` 的非伤害结算） | 判定的持有者 | `judgments`、`actions`、`tags`、`elements` |
| `intro` | `intro` | 变奏的角色（切入者） | —— |
| `outro` | `outro` | 延奏的发出者（切出者） | —— |
| `switchIn` | `switch` 的 `to` | 切入者 | —— |
| `switchOut` | `switch` 的 `from` | 切出者 | —— |
| `enemyState` | `enemyState`（TD-06 v0.2） | 造成变化的角色 | `enemyState`、`effect` |
| `resourceFull` | `resourceFull`（TD-06 §6） | 该角色 | `resource` |

- `judgmentSettle` 的 `tags` / `elements` 按这次结算**最终**的标签与元素（`modifyHit` 可能改过，TD-03 §4）。为此 `hit` 事件新增 `element`、`tags` 两个字段（TD-02 §7.3）。
- `actions` / `judgments` 写动作 ID / 判定名，原样匹配（AGENTS.md：不做模糊匹配）。
- `where` 里各字段之间是"且"，同一字段的多个值是"或"（与 TD-03 §4 的过滤规则一致）。对这种事件没有意义的字段（如 `outro` 上写 `judgments`）不满足。

### 4.2 发出者过滤 `where.by`

| 值 | 条件 |
|---|---|
| `self`（缺省） | 发出者 = 持有者 |
| `team` | 任何人（含持有者） |
| `onField` | 发出者此刻在前台 |

持有者是 `env` 时，`self` 当作 `team`。

### 4.3 动作类别按技能归类（修订 TD-01 §13.1）

`actionKinds` 过滤的 `ActionDef.kind` 原先取"组内第一个连上 dmg 的判定的伤害类型"（M2 实现）。这对"施放 X 技能时"的触发是错的：

| 角色 / 动作 | dmg `Skill.Type`（技能归类） | `Damage.Type`（伤害类型） | 原来的 kind | 应为 |
|---|---|---|---|---|
| 椿 E1 / E2 / E3 | 2 共鸣技能 | 0 普攻 | normal | skill |
| 散华 大招-引爆冰川 | 8（回路 / 追加） | 4 共鸣技能 | skill | liberation（按组名；它不作为动作开始，不影响 `actionStart` 触发） |
| 维里奈 QTE-撞 | 4 变奏 | 3 变奏 | intro | intro |

改为：`kind` 取组内第一个连上 dmg 的判定的 **`Skill.Type`**：0 普攻 → `normal`、1 重击 → `heavy`、2 共鸣技能 → `skill`、3 共鸣解放 → `liberation`、4 变奏 → `intro`、5 闪避反击 → `normal`；其余（6、8、9、11、12、13、14）→ 按组名推，再推不出 → `other`（`kindGuess`）。延奏组散在 8 / 9 / 12 / 13 里，而 12 里也有赞妮"E1-精准反击前置"、丽贝卡"待机"这类非延奏的组，所以延奏只按组名认。**伤害标签仍取 `Damage.Type`**（椿的 E 吃普攻伤害加成，TD-03 §3.4）。

### 4.4 内置冷却

- `icd`：一次触发成功后，同一（`defId`, `owner`）在 `icd` 个战斗帧内的再次触发全部忽略。上次触发成功的战斗帧记在 `SimState.lastTrigger`（键"持有者|定义 id"），与有没有实例、挂在谁身上无关；资源型效果同样。
- `icd: 1` 可以表达"同一战斗帧内只算一次"。散华 C6 原本按 xlsx"每个引爆周期可获得 1 层"这样写，实测同时引爆两块冰给 2 层（2026-10-03），已去掉（Q3）。

### 4.5 触发之后

- 按 §3 把这条 buff 施加给目标（`stackGain` 层）。
- 触发条件满足时，即使目标上已是满层也照常刷新。

---

## 5. 同一 tick 的顺序与连锁

1. 引擎每记下一条事件，就把它放进本 tick 的**事件队列**（先进先出）。
2. 队列逐条处理，每条按这个顺序：
   - ① **消耗**（§6）：满足 `consume` 的实例先移除——它们已经作用在引起这条事件的那次结算上；
   - ② **buff 触发**：按登记顺序（槽位 0 → 2，然后 `env`；同一角色内：角色模块、武器、声骸套装）；
   - ③ **资源型效果**（§9）：同上顺序；
   - ④ **角色钩子 `onEvent`**（TD-08）：槽位 0 → 2。
3. 处理中产生的新事件（`buffApply`、`resource`、钩子生成判定的结算…）排到队尾，同一 tick 内处理完。
4. 连锁深度（一条事件引出的事件链）超过 `rules.maxChainDepth`（16）报错：`SimResult.error`，`code: 'chainDepth'`，信息里写起点事件。钩子生成的判定，它在同一 tick 里的结算接在生成它的那条链上（钩子每次命中就生成判定的死循环也拦得住）。

**先算伤害，后触发**：P4 的一次结算先按当时的 buff 算完伤害、发完资源（TD-06），记 `hit` 事件，然后才进队列处理触发。所以"引爆后全队攻击 +10%"（散华 C6）不作用于引爆的这一下，作用于同一 tick 之后结算的判定（总设计 §6.3）。

**动作开始**：`actionStart` 进队列的时机见 TD-06 §7（扣大招能量之后、施放资源之前）。

---

## 6. 消耗型："下次 X…"

```ts
consume?: { on: TriggerEvent; where?: TriggerFilter; stacks?: number | 'all' }   // 缺省 'all'
```

- 满足 `consume` 的事件发生时，移除相关实例的 `stacks` 层（`'all'` 或层数不够时移除实例，记 `buffExpire`（`removed`）；只消耗几层时记一条 `buffApply`，层数为剩下的，剩余时间不变）。
- **相关实例**：挂在该事件发出者身上的实例；`target: 'enemy'` 的挂在敌人身上的实例。
- 消耗在触发之前处理（§5 ①），而伤害在事件记下之前已经算完，所以**消耗它的那一次结算吃得到它**。
- 例：散华 C4"5 秒内的下次重击爆裂伤害提升 120%"：`trigger: { on: 'actionStart', where: { actions: ['大招'] } }`、`duration: 300`、`consume: { on: 'judgmentSettle', where: { judgments: ['重击居合-1', '重击居合-2'] } }`。

---

## 7. 标记型 buff

不写 `zone`（也不写 `value`）的 buff 是标记：不参与伤害，只在状态里占一个带层数、带倒计时的位置，给钩子判断和计时用。

- 例：散华【冰棱】（挂在敌人身上，存在 342 帧，TD-08）、椿【含苞】（900 帧，切人清除）、维里奈【光合标记】（敌人）。
- 钩子用 `ctx.buffStacks(id)` 读、`ctx.addBuff` / `ctx.removeBuff` 写；到期的 `buffExpire` 事件钩子能收到（散华 C5：冰棱消失时直接爆炸）。
- 出现在事件日志与覆盖率里，不出现在 `hit.buffs` 里。

---

## 8. 切人时的清除

- `onSwitchOut: 'clear'`：`switchOut` 时，**挂在切出者身上**的这类实例全部移除（`buffExpire`，`switchOut`）。挂在别人或敌人身上的不动。
- 只在原文明写"切换至其他角色则该效果提前结束""离场…失效"时写 `clear`，其余一律 `persist`（机制设计 §6.1 的永久规则）。
- 例：散华延奏挂在椿身上，椿被切下时移除；维里奈延奏"全伤害加深 15%"没写切人失效，`persist`。

---

## 9. 资源型触发效果 `ResourceEffect`

```ts
// src/data/buff.schema.ts 新增
export const ResourceEffectSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  resource: z.enum(RESOURCE_KINDS),                         // energy / concerto / core1–core5
  amount: z.union([z.number(), z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])]),   // 可负；数组 = 武器 R1–R5
  target: z.enum(['self', 'team', 'teamExceptSelf', 'onField']).default('self'),
  trigger: TriggerSchema.or(z.array(TriggerSchema).min(1)),  // 与 BuffDef 同
  icd: z.number().int().min(1).optional(),
  scaledByRegen: z.literal(true).optional(),                // 能量乘共鸣效率：只给文案写明"此效果受共鸣效率影响"的（TD-06 Q3）
  requires: z.strictObject({ chain: z.number().int().min(1).max(6) }).optional(),
})
```

- 角色模块、武器模块新增 `resourceEffects?: ResourceEffectInput[]`（TD-02 §5.2；不叫 `effects`：`WeaponDef.effects` 已是原始被动文本）；声骸套装以后需要时再加。装配时同 buff：按共鸣链过滤、按谐振阶取值，登记为 `ResolvedScenario.effects`。
- 触发、`by`、内置冷却与 buff 完全相同（§4）；满足时调 TD-06 的 `grant(s, slot, resource, amount, id, scaledByRegen)`，给每个目标各一次；定值回复默认不乘共鸣效率（TD-06 Q3）。
- 例：行进序曲 / 奇幻变奏 `{ resource: 'concerto', amount: 8, trigger: { on: 'actionStart', where: { actionKinds: ['skill'] } }, icd: 1200 }`；散华 C4 `{ resource: 'energy', amount: 10, trigger: { on: 'actionStart', where: { actions: ['大招'] } }, requires: { chain: 4 } }`。

---

## 10. 覆盖率与测试

### 10.1 覆盖率

`Summary.buffUptime`：键"`buffId`→目标名"（`散华.延奏→椿`），值 = 统计窗口内该实例存在的战斗帧数 / 窗口帧数，由 `buffApply` / `buffExpire` 事件算出；常驻 = 1；标记型也算。到期（`timeout`）的实例在那一 tick 的 P6 才移除，那一帧算在内（`duration` = 30 的正好 30 帧）。按层数加权的版本留给 TD-10。

### 10.2 测试用例

队伍同 TD-05 §8。

| # | 场景 | 期望 |
|---|---|---|
| T07-1 叠层与刷新 | 椿（千古洑流 R5）`E1`，4 秒后 `E2`，再 4 秒后 `E1` | 千古洑流.攻击：第一次 1 层、剩余 600；第二次 2 层、刷新；第三次仍 2 层、刷新。E1 伤害按 atkPct +0.12 / +0.24 计 |
| T07-2 nextIn 与 clear | 散华协奏满 `switch 椿`（TD-05 T05-2）、`椿 A1`、`wait 30`、`switch 维里奈` | 第 36 帧 `散华.延奏` 挂到椿（840）；椿的 A1 吃 0 类加深 +38%；切走椿时移除（`switchOut`）；覆盖率 =（切走的帧 − 36）/ 窗口。A1 刚开始就切走的话，延奏 buff 在 A1 命中前就被清掉 |
| T07-3 内置冷却 | 散华（行进序曲 R5）`E`，冷却转好后（10 秒）再 `E` | 第一次 E 协奏 +15（施放资源）+8（行进序曲）；第二次 E 在 20 秒内：只 +15 |
| T07-4 先算伤害后触发 | 人造角色：同一帧的两个判定 a、b，a 的结算触发攻击 buff（散华的引爆要等 TD-08 的钩子） | a 的 `hit` 不含它；同 tick 之后结算的 b 含它 |
| T07-5 消耗型 | 人造角色：`consume` 在两个判定上的 buff；另一条 3 层、每次消耗 1 层（散华 C4 的乘区待 Q5） | j1 的 `hit.buffs` 含它，随后移除（`removed`），j2 不再吃；3 层的依次记 `buffApply` 2 层、1 层 |
| T07-6 动作类别按技能归类 | 椿 `E1`（伤害类型普攻） | `actionStart` 的 kind 为 `skill`，千古洑流.攻击 触发；E1 的伤害吃"普攻伤害加成"（固有 2） |
| T07-7 trigger 数组 | 维里奈 `R`，之后切走发延奏 | 维里奈.固有 在大招开始与延奏时各施加一次（全队，1200 帧） |
| T07-8 连锁上限 | 人造角色的钩子：`onEvent` 每收到自己的 `resource` 事件就再 `addResource` 1 点（每次又产生一条 `resource` 事件） | 连锁第 17 层报错，报错信息指出事件链的起点 |
| nextIn 挂起 | 人造角色：`actionStart` 触发的 `nextIn` buff，60 帧后切人 | 切人那一刻才施加给切入者，剩余 = `duration` |
| `where.by` | 人造角色乙的三条 buff：缺省、`team`、`onField`；甲出招 | 只有 `team`、`onField` 两条触发 |
| 标记型 | 人造角色：命中后给敌人挂 30 帧的标记 | 不进 `hit.buffs`；钩子读到层数、收到 `buffExpire`；覆盖率 30 / 窗口 |

---

## 11. 从原文起草 BuffDef

### 11.1 来源

角色：`characters.json` 的共鸣链 / 固有文本、`nanoka.json` 的技能描述（延奏、变奏、回路）；武器：`weapons.json` 的 `effects`（文本 + R1–R5 数值）；xlsx「伤害配置」buff 库（TD-01 §10.2 的 `buff-texts.json`，M3 按需生成）给分区，用来核对乘区（TD-03 §9.4）。

### 11.2 原文 → 字段

| 原文 | 字段 |
|---|---|
| "持续 N 秒" | `duration` = N 秒按 `FunctionalFrame` 换帧（TD-01 §1.6） |
| "可叠加 N 层" / "最多持有 N 层" | `maxStacks: N` |
| "重复获得刷新持续时间" | `refresh: 'refresh'`（缺省） |
| "每 N 秒可触发 1 次" | `icd: N × 60` |
| "若切换至其他角色则该效果提前结束" | `onSwitchOut: 'clear'` |
| "队伍中的角色""附近队伍中所有角色" | `target: 'team'` |
| "下一位登场角色""变奏出场角色" | `target: 'nextIn'` |
| "目标受到的伤害…""降低目标…" | `target: 'enemy'` |
| "施放 X 时 / 后" | `trigger: { on: 'actionStart', where: { actions \| actionKinds } }` |
| "X 命中时""引爆…后" | `trigger: { on: 'judgmentSettle', where: { judgments \| tags } }` |
| "施放变奏技能时" / 延奏 | `trigger: { on: 'intro' }` / `{ on: 'outro' }` |
| "下次 X…" | `consume` |
| "…伤害加成 / 提升" / "加深" / "最终伤害" | 乘区按 TD-03 §2.3；拿不准时看 xlsx buff 库的分区 |
| 共鸣链 N | `requires: { chain: N }` |
| "回复 N 点 X 能量" | `ResourceEffect`（§9） |
| 治疗、护盾、抗打断、耐力、减速 | 不建模（不影响伤害） |
| 条件是敌人生命、距离、受击 | 不建模，列入 Q4 |

### 11.3 流程

AI 起草（带 `source` 原文）→ 人工核对乘区与触发条件（有 xlsx buff 库条目的以它的分区为准）→ 写进 `data/curated/`（角色模块 `buffs` / `resourceEffects`、`weapons.ts`、`echo-sets.ts`）→ 每条带触发的 buff 至少一个用例。

---

## 12. M0 队伍的 buff 清单（2026-10-03 全部写完）

"状态"：已写 = 已在 `data/curated`；钩子 = 由角色钩子实现（TD-08 §5，`data/curated/characters/*.ts`）；不建模 = 不影响伤害或条件不建模。

| id | 原文（nanoka 3.7 / xlsx） | 写法 | 状态 |
|---|---|---|---|
| 散华.固有1 | 施放变奏技能时，共鸣技能伤害提升 20%，持续 8 秒（xlsx：技伤加成） | `DamageChangeType` 0.2，`tags: 共鸣技能`；self；`intro`；480 | 已写 |
| 散华.固有2 | 施放第 5 段普攻后，冰绽造成的伤害提升 20%，持续 8 秒 | `DamageChange` 0.2，`judgments: 三种引爆`；`actionStart` A5；480 | 已写（Q5 已关闭） |
| 散华.共鸣链1 | 施放第 5 段普攻时，暴击提升 15%，持续 10 秒（xlsx：8 秒） | `critRate` 0.15；`actionStart` A5；600 | 已写（时长按当前文本 10 秒，Q8 已关闭） |
| 散华.共鸣链3 | 攻击生命低于 70% 的目标时，伤害提升 35% | 条件是敌人生命 | 不建模（Q4） |
| 散华.共鸣链4 | 施放大招时回复 10 点能量；5 秒内下次重击爆裂伤害提升 120% | `ResourceEffect` 能量 10；buff `DamageChange` 1.2，两段爆裂都吃，第二段结算后 `consume` | 已写 |
| 散华.共鸣链5 | 冰绽的暴击伤害提升 100%；冰棱等消失时直接爆炸 | 常驻 `critDamage` 1.0，`judgments: 三种引爆`；爆炸归钩子 | 已写 + 钩子 |
| 散华.共鸣链6 | 引爆冰棱或冰川后，队伍攻击 +10%，持续 20 秒，2 层（xlsx：每个引爆周期 1 层，实测不对） | 每块冰的引爆各触发一次，不设 `icd` | 已写 |
| 散华.延奏 | 下一位登场角色普攻伤害加深 38%，14 秒，切人提前结束 | 已写 | 已写 |
| 椿.固有1 | 湮灭伤害加成提升 15%；重击修枝伤害视为普攻伤害 | 常驻 `DamageChangeElement` 0.15 湮灭；重击标签改普攻（`actionOverrides` 的 `judgments.tags`） | 已写 |
| 椿.固有2 | 普攻伤害加成提升 15% | 常驻 `DamageChangeType` 0.15 普攻 | 已写 |
| 椿.延奏 | 攻击目标造成 329.24% 湮灭伤害；一日花后下次额外 459.02% | 延奏动作（TD-05 §4.3）+ 钩子选版本、算 Formula1（TD-08） | 已写（钩子） |
| 椿 回路（酣梦、红椿·蕾、含苞、蕊的能量倍率） | 见 TD-08 §5.2 | 钩子 + 标记型 buff | 已写（钩子） |
| 维里奈.固有1 | 施放重击星星花绽放、空中攻击星星花绽放、大招或延奏时，队伍攻击提升 20%，持续 20 秒（xlsx 没有空中攻击） | `atkPct` 0.2；team；`trigger` 数组：`actionStart`（`重击` = 强化重击、强化空中A1–A3、`大招`）与 `outro`；1200 | 已写 |
| 维里奈.延奏 | 附近队伍中所有角色全伤害加深 15%，持续 30 秒（xlsx：全队全伤害加深） | `DamageAmplify0` 0.15；team；`outro`；1800；治疗不建模 | 已写 |
| 维里奈.共鸣链2 | 施放共鸣技能时额外获得 1 点光合能量和 10 点协奏能量 | 两条 `ResourceEffect`：`core1` +1、协奏 +10；`actionStart` E | 已写 |
| 维里奈 光合标记 / 协同攻击 | 大招命中给目标光合标记；队友命中带标记的目标时协同攻击，每秒 1 次 | 标记型 buff（敌人）+ 钩子 | 已写（钩子） |
| 千古洑流.共鸣效率 | 共鸣效率提升 12.8%（R5 25.6%） | 已写 | 已写 |
| 千古洑流.攻击 | 施放共鸣技能后攻击提升 6%（R5 12%），10 秒，2 层 | 已写（按 §4.3，椿的 E 才能触发） | 已写 |
| 行进序曲 / 奇幻变奏 | 施放共鸣技能时回复 8 点协奏能量，每 20 秒可触发 1 次 | `ResourceEffect` 协奏 8，`actionKinds: skill`，`icd: 1200` | 已写 |

---

## 13. 待定问题

| # | 问题 | 当前做法 | 如何关闭 |
|---|---|---|---|
| Q1 | 层数各自计时（"每层独立计时"）的 buff | 不支持：共用一个持续时间 | 遇到时由钩子或加字段 |
| Q2 | `nextIn` 由延奏以外的事件触发时"挂起到下一次切入"的语义 | 如此 | 遇到这类角色时对原文 |
| Q3 | "每个引爆周期"与"可叠加 2 层"两版文本（xlsx 与 nanoka）哪个对 | **已关闭（2026-10-03 用户实测）**：同时引爆多块给 2 层，每块各触发一次 | —— |
| Q4 | 以敌人生命、距离、受击为条件的效果（散华 C3 等） | 不建模 | 需要时加场景开关（"假定满足"） |
| Q5 | "X 伤害提升"落哪个乘区（散华冰绽 +20%、C4 +120%）：xlsx 没有这两条 | **已关闭（2026-10-03 用户确认）**：文本写明了针对哪种伤害（冰绽 = 共鸣技能伤害、爆裂 = 重击伤害），按伤害加成（`DamageChange`）只对这些判定；"下次"只一次，一次爆裂的两段都吃 | —— |
| Q6 | 动作类别改按技能归类后，各角色"施放普攻 / 重击时"的触发是否仍对 | §4.3 的映射 | 启用角色时核对 |
| Q7 | `buff-texts.json` 与起草工具 | M3 手写 M0 队伍；工具按需 | 启用第二支队伍时 |
| Q8 | 散华共鸣链1 的持续时间：nanoka 3.7"持续10秒"，xlsx"持续时间为8秒" | **已关闭（2026-10-03）**：按当前文本 10 秒（nanoka 3.7 与外部查证的当前文本一致，xlsx 是旧版资源） | —— |
| Q9 | 维里奈固有1 的"空中攻击星星花绽放"对应哪个动作 | **已关闭（2026-10-03）**：强化空中A1–A3（nanoka 3.7 三段倍率与之一致），已加进触发 | —— |

---

## 14. 对其他文档的调整

> **已并回**（2026-10-03）：下列调整已写进总设计 v0.1.5、TD-01 v0.1.4、TD-02 v0.1.4、TD-04 v0.1.2、TD-09 v0.1.1（见各文档附录）。

- **TD-02**：`BuffDefSchema`——`zone` / `value` 可省（标记型，两者同时省）、`trigger` 可为数组、新增 `consume`；新增 `ResourceEffectSchema`；`CharacterModule` / `WeaponModule` 新增 `resourceEffects`，`CharacterDef` / `WeaponDef` 同名字段，`ResolvedScenario` 新增 `effects: RegisteredEffect[]`；`SimState` 新增 `pendingNextIn`、`lastTrigger`；`HitEvent` 新增 `element`、`tags`；`SimEvent` `outro` 新增 `to`；`Summary.buffUptime` 的键按 §10.1；`ScheduleErrorCode` 新增 `chainDepth`。
- **TD-01 → v0.1.4**：§13.1 `kind` 改按 dmg `Skill.Type`（§4.3），伤害标签仍按 `Damage.Type`。
- **TD-03**：§4 第 3 步"按作用对象筛选"指向本文 §3。
- **总设计**：§6.8 补消耗型、标记型、触发数组、资源型效果与事件队列顺序（§5）；§3.2 指向本文 §11。

## 附录：变更历史

- **v0.1（2026-09-28）**：初版。
- **v0.1（2026-09-30 修订，随实现）**：模块字段 `effects` 改名 `resourceEffects`；§4.3 技能归类只认 0–5，延奏按组名（12 里有非延奏的组）；内置冷却记在 `SimState.lastTrigger`；`nextIn` 挂起时再次触发累加层数；部分消耗记 `buffApply`；连锁报错走 `SimResult.error`，钩子生成的判定接在原链上；覆盖率的到期帧算在内；T07-2 改轴、T07-4 / T07-5 改用人造角色，补 nextIn 挂起、`where.by`、标记型的用例；§12 更新状态；新增 Q8、Q9。
