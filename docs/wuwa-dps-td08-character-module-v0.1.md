# 鸣潮 DPS 引擎 · TD-08 角色模块编写指南 v0.1

> **状态**：v0.1（2026-09-28 起草）。通用能力已实现（2026-09-30，`tests/td08.test.ts`）；§5 的问题已全部确认，M0 三人的模块已按 §5 实现（2026-10-03，`data/curated/characters/*.ts`，用例 `tests/m0-team.test.ts`）；代表轴 `scenarios/m0-team.yaml`（第一版，按机制排）与场景汇总快照 `tests/scenarios.test.ts`（2026-10-03）
> **依据**：《技术总体设计 v0.1.4》（下称"总设计"）§4 T8、§6.9、§3.3；《TD-01 数据字典 v0.1.3》§13.4；《TD-02 类型与 Schema v0.1.3》§5.2、§7.4、Q5；《TD-03 伤害公式规格 v0.1》§3.2、§3.4、§4、Q6、Q7、Q13；《TD-05 切人与变奏 / 延奏 v0.1》；《TD-06 资源 v0.1》；《TD-07 Buff 系统 v0.1》；`docs/m0-confirm.md`
> **下游**：每个角色的 `data/curated/characters/<角色>.ts` 与它的测试
> **验证**：§5 的机制逐条对照了 nanoka 3.7 技能描述、xlsx 动作表备注与「伤害计算」页的公式写法

---

## 0. 范围与约定

**本文定**：一个角色模块由哪些部分组成、各写什么；新增一个角色的步骤；四个钩子的调用时机与能做的事；钩子的受控接口（含本文新增的两项）；常见机制的写法模式；每个角色必须带的测试；M0 队伍三人的模块草案与待确认问题。

**本文不定**：buff 的语义（TD-07）；资源规则（TD-06）；切人、变奏、延奏的通用流程（TD-05）；数据装配的默认规则（TD-01 §13）。

**原则**（总设计 T8）：一条 `BuffDef` / `ResourceEffect` 说得清的写数据；读写资源、改变动作可用性、依赖多条件组合的写钩子。钩子只有四个，只通过 `ctx` 改状态。

### 0.1 要点

1. 模块 = 数据（武器类型、技能树属性、别名、buff、资源型效果、动作覆盖）+ 至多四个钩子（`onResolve`、`canStart`、`onEvent`、`modifyHit`）。
2. 角色状态放在两处：**标记**（`ctx.setFlag`，无计时，如椿的盛绽）与**标记型 buff**（有层数、有倒计时、可被切人清除，如椿的含苞、散华的冰棱，TD-07 §7）。
3. 新增两项受控能力：`ctx.skipJudgments(instance, names)`（运行时挑判定版本）、`HitDraft.selfEnergyScale`（这次结算的基础能量倍率，TD-06 §2.1）。
4. 新增两个动作覆盖字段：`followUp`（某判定命中后自动接下一个动作组，维里奈 QTE-冲 → QTE-撞）、`energyCost` / `endOnSwitchOut`（TD-06 / TD-05）。
5. 每个角色至少带：装配快照（flag 已知）、nanoka 核对（冷却、技能树）、每个钩子机制一个用例、一条代表轴的回归快照。

---

## 1. 模块的组成

```ts
// data/curated/characters/<角色>.ts
export default defineCharacter('<角色>', {
  weaponType, bodyType?, mergeBlocks?, coreCaps?,   // 数据层修正（TD-01 §5、Q2、Q22）
  treeStats,                                        // 技能树属性节点合计（M2，与 nanoka 核对）
  aliases,                                          // 排轴别名；约定键见 §1.1
  buffs,                                            // BuffDef[]（TD-07）
  resourceEffects,                                  // ResourceEffect[]（TD-07 §9）
  actionOverrides,                                  // 动作覆盖（TD-01 §13.4，§1.2）
  hooks,                                            // 至多四个钩子（§3）
})
```

### 1.1 别名约定

| 键 | 含义 | 谁用 |
|---|---|---|
| `E` / `R` / `Q` | 共鸣技能 / 共鸣解放 / 首位声骸技能 | 排轴；`R` 指向的动作收大招能量（TD-06 §2.3） |
| `QTE` | 变奏动作 | 变奏切人（TD-05 §2.1） |
| `延奏` | 延奏动作（带伤害的延奏） | 延奏触发（TD-05 §4.3） |
| `A1`…`A5` 等 | 写轴方便 | 排轴 |

### 1.2 动作覆盖（`actionOverrides`）

TD-01 §13.4 已有：`dropRows`、`kind`、`endFrame`、`priority`、`cancelWindows`、`outroTriggerFrame`、`switchLockUntil`、`comboFrom`、`cooldown`、`cooldownGroup`、`judgments`（改 `spawnFrame`、`lifeFrames`、`ticks`、`tickInterval`、`persistsOnCancel`、`multiplier`、`tags`、`target`、`chainRange`）、`accept`。本轮新增：

| 字段 | 作用 | 出处 |
|---|---|---|
| `energyCost` | 开始时要有并扣掉的大招能量（`R` 指向的动作自动设） | TD-06 §2.3 |
| `endOnSwitchOut` | 切出时走到这一局部帧就结束 | TD-05 §5 |
| `followUp` | `{ after: 判定名, action: 动作 ID }`：本动作的该判定第一次结算后（本动作还在进行时），立刻开始 `action`（取消本动作，TD-04 §4.2）；接续的动作继承原动作的指令出处（统计窗口按它算，TD-09 §3.9）。它在结算的那个 tick（P4）开始，下一 tick 起推进：局部第 0 帧在下一 tick。注册层检查动作与判定名都存在 | 本文 §4 P10 |

常见用途：把"数据有、但应由事件生成"的判定改成 `spawnFrame: null`（维里奈的协同伤害）；伤害表里没有、技能说明有数的判定手填 `multiplier`（椿的延奏）；静态的伤害类型改写用 `judgments.tags`（椿"重击修枝伤害视为普攻伤害"）。

---

## 2. 新增一个角色的步骤

1. `pnpm build:data -- --strict <角色>`：伤害判定全部连上 dmg，或在 `dmg-join.json` 里明确处理（TD-01 §4.4）。
2. `pnpm check:data -- --flags <角色>`：列出装配时推断的值，整理成一份确认清单交给你（格式参照 `docs/m0-confirm.md`）。
3. 冷却（`actionOverrides.<E / R>.cooldown`）与技能树（`treeStats`）照 nanoka 填，`--flags` 会核对。
4. 别名（§1.1）。
5. buff 与资源型效果：按 TD-07 §11 从原文起草。
6. 数据写不了的机制写钩子（§3、§4）；每个钩子机制先在 §5 这样的表里写清"原文 → 写法"，请你确认。
7. 测试（§6）；`scenarios/` 里放一条代表轴。

---

## 3. 钩子

### 3.1 四个钩子

| 钩子 | 何时调用 | 能做的事 | 不能做的事 |
|---|---|---|---|
| `onResolve(ctx)` | 仿真开始：常驻 buff 施加之后、第 0 帧之前 | 初始化标记（初始形态）、施加开场的标记型 buff | —— |
| `canStart(ctx, actionId)` | 调度器每 tick 检查出招合法性时（TD-09 §3.2 第 7 项，冷却与资源之后、就绪之前） | 返回 `true` 或不允许的原因（写进等待记录，代码 `hook`） | 改状态（这里只读） |
| `onEvent(ctx, ev)` | 事件队列处理每条事件的最后一步（TD-07 §5 ④）：buff 触发与资源型效果之后 | 用 `ctx` 的全部写操作 | 直接改 `ctx.state` |
| `modifyHit(ctx, draft)` | 每次结算、收集 buff 之前（TD-03 §4） | 改倍率、`extraFlat`、元素、标签、`selfEnergyScale`，往 `zones` / `critOnly` 补值 | 用 `ctx` 的写操作（结算中途改状态会让顺序难以追溯；要改就在随后的 `hit` 事件里改） |

`onEvent` 收到**所有**事件（不只是 TD-07 的触发目录），包括自己与队友的 `hit`、`actionStart`、`buffExpire`、`resource`、`judgmentSpawn`、`switch`、`intro`、`outro`。每个角色都会收到全队的事件，按 `ev.char` 判断是谁的。

### 3.2 受控接口 `ctx`

| 方法 | 作用 |
|---|---|
| `self`、`state` | 自己的槽位；只读的仿真状态（敌人、buff、三人的资源与标记） |
| `chain` ★ | 本角色的共鸣链数（按链数分支，如散华 C5"冰消失时直接爆炸"，2026-10-03 新增） |
| `getFlag(key)` / `setFlag(key, value)` | 读写自己的标记 |
| `buffStacks(id, target?)` | 自己登记的某条 buff 在目标上的层数（0 = 没有） |
| `addBuff(id, { target?, stacks? })` / `removeBuff(id, target?)` | 施加 / 移除自己登记的 buff（`id` 必须在本模块的 `buffs` 里；不能凭空造） |
| `addResource(resource, amount, slot?)` | 加减资源（TD-06 §5 的 `grant`，`cause: 'hook'`） |
| `spawnJudgment(name, { action? })` | 生成自己的一个判定（事件生成的判定，如散华的引爆）；同一 tick 内结算 |
| `skipJudgments(instance, names)` ★ | 在某个动作实例（或延奏的独立时间线）里不生成这些判定；只对还没生成的有效。在 `actionStart` / `outro` 事件里调用，TD-06 的协奏汇总也会排除它们 |
| `warn(message)` | 记一条警告 |

`HitDraft` 新增 `selfEnergyScale`（缺省 1）★：这次结算出伤者自己那份能量的倍率，队友那 50% 不受影响（TD-06 §2.1）。

### 3.3 写钩子的规矩

- 只读 `ctx.state`，只经 `ctx` 写；不在模块里存全局变量（仿真要能 `structuredClone` 分支，总设计 §3.7）。状态存在标记或标记型 buff 里。
- 时间一律按事件推进：钩子没有"每帧回调"。需要计时的状态用标记型 buff，到期时收 `buffExpire`。
- 同一件事只在一个地方做：能写成 buff / 资源型效果 / 动作覆盖的，不写进钩子。
- 每个钩子分支至少一个测试（§6）。

---

## 4. 常见写法

| # | 模式 | 写法 | 例 |
|---|---|---|---|
| P1 | 形态 / 状态（无计时） | `onEvent` 看自己的 `actionStart` 设标记；`canStart` 读标记 | 椿 盛绽（E1 进入、E2 / 跳跃退出） |
| P2 | 限时状态 | 标记型 buff（`duration`、`onSwitchOut`）；提前结束用 `removeBuff`；到期效果收 `buffExpire` | 椿 含苞（900 帧，切人结束）；散华 冰棱（敌人身上，342 帧） |
| P3 | 出招条件 | `canStart` 返回原因 | 椿 一日花要协奏满；维里奈强化重击要光合能量 |
| P4 | 事件生成判定 | `onEvent` 看某次 `hit`，`ctx.spawnJudgment` | 散华 重击爆裂引爆冰棱 / 冰棘 / 冰川 |
| P5 | 运行时挑版本 | `onEvent` 看 `actionStart` / `outro`，`ctx.skipJudgments` 去掉不适用的版本 | 椿 延奏（普通 / 含苞 / 含苞追加）|
| P6 | 倍率随状态变 / Formula1 | `modifyHit`：`draft.multiplier += judgment.formula.rate × N`（xlsx 写法 `FormulaParam5 × N × 属性`，TD-03 §3.2）；不必读攻击力 | 椿 酣梦 |
| P7 | 出伤者能量倍率 | `modifyHit`：`draft.selfEnergyScale = …`（只乘出伤者那份） | 椿 消耗红椿·蕊时 ×2.5，含苞时 ×0 |
| P8 | 伤害类型改写 | 静态：`actionOverrides.<动作>.judgments.<判定>.tags`；随状态：`modifyHit` 改 `draft.tags` | 椿 重击修枝视为普攻 |
| P9 | 队友命中触发的追加攻击 | `onEvent` 看任何人的 `hit`（`dmg ≠ null`），敌人身上有标记且内置冷却已过 → `spawnJudgment`；冷却时刻存标记 | 维里奈 光合标记协同攻击（每秒 1 次） |
| P10 | 命中后接下一个动作组 | `actionOverrides.<动作>.followUp`（数据，不写钩子） | 维里奈 QTE-冲 命中 → QTE-撞 |
| P11 | 资源计数触发 | `onEvent` 看自己的 `hit.gains.core`，累计到阈值时 `addResource` / `addBuff` | 椿 每消耗 10 点红椿·蕊 → 协奏 +4、红椿·蕾 +1 |

示意（P4，散华引爆；完整写法以实现为准）：

```ts
onEvent(ctx, ev) {
  if (ev.type !== 'hit' || ev.char !== '散华' || !ev.judgment.startsWith('重击居合')) return
  for (const [ice, judgment, action] of ICES) {               // 冰棱 → E-引爆冰棱（E 组）…
    if (ctx.buffStacks(ice, 'enemy') === 0) continue
    ctx.removeBuff(ice, 'enemy')
    ctx.spawnJudgment(judgment, { action })
  }
}
```

---

## 5. M0 队伍的模块草案

表里"写法"一列对应 §4 的模式；"确认结果"一列是 2026-10-03 关闭的问题（详见 `m0-confirm.md` §6）。三人的模块已按此实现。

### 5.1 散华（6 链）

| 机制（原文 / 数据） | 写法 | 确认结果 |
|---|---|---|
| E"剑气留下 1 道【冰棱】"；数据"冰棱判定存在 342F" | E 的伤害判定生成时（第 19 帧，不看是否命中），给敌人施加标记型 buff `散华.冰棱`（342 帧，同时只有 1 道，再放刷新） | ① 已确认（2026-10-03）：不需要命中，在技能判定生成时出现（按生成帧，不看命中）；存在时间按 xlsx；同一种冰只有 1 块 |
| 变奏"留下 1 道【冰棘】"（486F）、大招"形成 1 道【冰川】"（390F） | 同上：QTE 第 55 帧、大招-伤害第 72 帧的判定生成时施加（不看是否命中） `散华.冰棘` / `散华.冰川` | 同 ① |
| 重击爆裂引爆范围内的冰棱、冰棘、冰川（冰绽，共鸣技能伤害）；数据：重击居合-1"第29F～36F可引爆" | P4：重击居合局部第 29 帧（xlsx"第29F～36F可引爆"的起点；钩子没有按帧回调，用重击居合开始时挂上的 29 帧标记 `散华.引爆计时`，到期那一刻引爆），场上有哪种冰就生成对应的引爆判定（E-引爆冰棱 / QTE-引爆冰棘 / 大招-引爆冰川），移除该冰 | ② 已确认（2026-10-03）：按 xlsx 在重击居合局部第 29 帧（"第29F～36F可引爆"的起点）引爆，默认总能打中冰；③ 已确认：重击居合两行是一次爆裂的两段（nanoka"186.29%*2"），都打 |
| C5"冰棱、冰川、冰棘消失时直接爆炸" | P2：收到 `散华.冰*` 的 `buffExpire`（`timeout`）→ 生成对应引爆判定 | —— |
| C5"冰绽的暴击伤害 +100%"、C6、固有 2、C1、C4 | 数据（TD-07 §12），都已写 | —— |
| 【透视】层数、指针（核心资源 1） | 不建模（只影响冰痕区域大小，不影响伤害；TD-06 Q6） | —— |
| 重击爆裂需要松开时指针落在冰痕区域 | 视为总能成功 | —— |

### 5.2 椿（0 链）

| 机制（原文 / 数据） | 写法 | 确认结果 |
|---|---|---|
| 盛绽状态：E1"第1F进入"；E2 黯蕊猎心、盛绽·跳跃"第1F解除"；盛绽时普攻 / 闪避反击 / E 换成盛绽版本 | P1：标记 `盛绽`；`canStart`：盛绽·A1…、E2 要在盛绽中，A1…、E1 要不在 | ④ 已确认（2026-10-03）：切人不退出盛绽 |
| 一日花 E3：协奏满且一日花不在冷却时替换共鸣技能；消耗 70 协奏（数据 −70）；回复 100 红椿·蕊（数据）；进入含苞 | P3：`canStart(E3)` 要协奏 ≥ 100（冷却 25 秒已在数据）；P2：E3 开始时施加标记型 buff `椿.含苞`（900 帧，`onSwitchOut: 'clear'`） | —— |
| 含苞提前结束："切换至其他角色时"、"消耗完【红椿·蕊】时" | `clear` 处理切人；P11：每次自己的 `hit` 后红椿·蕊为 0 → `removeBuff` | —— |
| 酣梦（含苞时）：常态攻击、盛绽各段、旋舞、偿赎、红椿盛绽、黯蕊猎心的伤害倍率 +50%；一日花时每层红椿·蕾再 +5%（最多 +50%） | P6：含苞中这些判定 `multiplier += formula.rate × N`，N = 10 + 施放一日花时的红椿·蕾层数（≤ 10）。xlsx 就是这样写的：`FormulaParam5`（= 倍率 × 5%）× 层数 × 攻击 | ⑤ 已确认（2026-10-03）：按 nanoka 3.7，椿改过，xlsx 是旧规则 |
| 红椿·蕊：各段命中消耗（数据负数）；"此次攻击的基础共鸣能量回复效率提升 150%"；含苞时这些攻击的基础回能效率降为 0 | P7：`modifyHit` 里 蕊 > 0 → `selfEnergyScale = 2.5`；含苞中 → `selfEnergyScale = 0` | —— （TD-06 Q4 已关闭：只乘椿自己那份） |
| 每消耗 10 点红椿·蕊 → 协奏 +4、红椿·蕾 +1（15 秒，10 层；含苞中不获得） | P11：标记记累计消耗量；标记型 buff `椿.红椿·蕾` | 同 ⑤ |
| 延奏：329.24% 湮灭伤害；一日花后的下次延奏额外 459.02%；数据三个版本（普通 / 含苞 / 含苞追加，倍率 3.2924 / 3.2924 / 4.5902，与 nanoka 3.7 的伤害表一致） | P5：`outro` 事件里用 `ctx.skipJudgments` 挑版本 | ⑥ 已确认（2026-10-03）：切走那一刻在含苞中 → 含苞 + 含苞追加，否则 → 普通 |
| 固有 1"重击修枝伤害视为普攻伤害" | P8 静态：`actionOverrides.重击.judgments.*.tags = ['普攻']`（P1重击在数据里已经是普攻）——已写 | —— |
| A4"第72F后切人立即结束技能"、盛绽·A3循环聚怪"第24F后切人结束技能" | `endOnSwitchOut`（构建脚本抽出，TD-05 §5） | —— |

### 5.3 维里奈（3 链）

| 机制（原文 / 数据） | 写法 | 确认结果 |
|---|---|---|
| 变奏：QTE（资源行：协奏 +10、光合 +1）→ QTE-冲（第 53 帧，无伤害，"第53F触发上一角色延奏"）→ 撞到目标后 QTE-撞（第 9 帧伤害） | P10：`actionOverrides.QTE.followUp = { after: 'QTE-冲', action: 'QTE-撞' }`；延奏在 QTE-冲 结算前的 P3 触发（TD-05 §4.1） | ⑦ 已确认：位置细节不建模，总能撞到 |
| 重击：普通（重击-冲 → 重击-撞）、有光合能量时强化（重击 = 强化冲 / 强化连冲 → 重击-强化撞1），强化时消耗 1 层光合、协奏 +12 | P10 接续；P3：`canStart(重击)` 要光合能量 ≥ 1，`canStart(重击-冲)` 要为 0 | ⑧ 已确认：两个版本，一次强化重击 +12 协奏、−1 光合；只留"强化冲"（`dropRows`） |
| 光合能量（核心资源 1，上限 4）：第 5 段普攻命中、E、变奏 +1（数据） | 数据 | —— |
| 大招"命中目标时给目标附加光合标记"（大招-标记，第 58 帧） | 大招-标记结算时给敌人施加标记型 buff `维里奈.光合标记` | ⑨ 已确认：12 秒（nanoka 3.7） |
| 协同攻击：队伍中角色命中带光合标记的目标时，维里奈协同攻击，每秒 1 次（数据：大招组里的"大招-协同伤害"第 30 帧、备注"冷却1s"） | 覆盖 `大招-协同伤害` 为 `spawnFrame: null`（不随大招自动出）；P9：任何人的伤害 `hit` 且敌人有标记、距上次 ≥ 60 帧 → `spawnJudgment('大招-协同伤害')` | ⑩ 已确认：自己的命中也触发；全队共用 1 秒冷却，协同本身不再触发 |
| 固有 1、延奏、C2 | 数据（TD-07 §12），已写；固有 1 暂不含空中攻击（TD-07 Q9）；治疗与护盾不建模 | —— |

---

## 6. 每个角色必须带的测试

1. **装配**：`--flags` 输出的推断项数量与确认清单一致（改了覆盖要同步）。
2. **nanoka 核对**：冷却、技能树（`tests/nanoka.test.ts` 已有 M0 三人的写法）。
3. **每个钩子机制一个用例**：输入一段最短的轴，断言关键事件（状态进出、生成的判定、跳过的版本、资源变化）。
4. **一条代表轴的回归快照**：`scenarios/<队伍>.yaml` 的汇总（总伤害、窗口、各动作占比）存快照；数据或引擎改动导致的变化人工确认后再更新（总设计 §11 第 5 条）。

M0 三人的用例在实现时写进 `tests/m0-team.test.ts`，编号 T08-散华-n 等。

---

## 7. 待定问题

| # | 问题 | 当前做法 | 如何关闭 |
|---|---|---|---|
| Q1 | 钩子需要"读当前属性"（攻击、暴击…）的场景 | 暂无：Formula1 用加倍率代替（P6） | 遇到时给 `ctx` 加只读的"按当前 buff 合成面板" |
| Q2 | 丽贝卡 C6 这类"把已有加成再放大"（TD-03 Q5） | 不支持 | 做到时再议 |
| Q3 | 多版本变奏的选法（TD-05 Q1） | 别名指向默认版本 | 做到守岸人等 |
| Q4 | 溢出暴击率转暴伤（TD-03 Q7） | `modifyHit` 补 `critDamage`（要读当前暴击率，同 Q1） | 做到时 |
| Q5 | `onEvent` 每个事件都调三个角色的钩子，事件多时的开销 | 先不优化 | 仿真时间超过百毫秒量级再说 |
| Q6 | §5 的 ①–⑩ | **已全部关闭（2026-10-03）**，结论见 `m0-confirm.md` §6 | —— |

---

## 8. 对其他文档的调整

> **已并回**（2026-10-03）：下列调整已写进总设计 v0.1.5、TD-01 v0.1.4、TD-02 v0.1.4、TD-04 v0.1.2、TD-09 v0.1.1（见各文档附录）。

- **TD-02**：`HookContext` 新增 `skipJudgments`；`HitDraft` 新增 `selfEnergyScale`；`ActionOverride` / `ActionDef` 新增 `followUp`、`energyCost`、`endOnSwitchOut`；`CharacterModule` 新增 `resourceEffects`（原稿写作 `effects`，与 `WeaponDef.effects` 的原始文本重名，改了）；`ActionRuntime` 新增 `cmd?`（接续动作继承）、`skip?: string[]`，`TailRuntime` 新增 `skip?`（被跳过的判定名）；Q5 关闭（按本文 §3.2 的清单扩充，以后再加一项记一次附录）。
- **TD-04**：§4.1 时间线的 `spawn` 事件跳过 `skip` 里的判定（跳过的判定也不挡"就绪"，§6.4）；§9 `startAction` 支持继承指令出处（`followUp`），开始后调 `hooks.actionStarted`（TD-06 §7）。
- **TD-09**：§3.9 指令的完成时刻：出招若有接续动作，按最后一个接续动作结束的帧。
- **总设计**：§6.9 钩子表补调用时机与"能 / 不能做的事"（本文 §3.1）；示例改用本文 §4。

## 附录：变更历史

- **v0.1（2026-09-28）**：初版。
- **v0.1（2026-09-30 修订，随实现）**：模块字段 `effects` 改名 `resourceEffects`；`followUp` 的开始时刻与注册层检查；§5 标出已写的数据。
