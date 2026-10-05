# 鸣潮 DPS 引擎 · TD-13 声骸库存择优 v0.1

> **状态**：v0.1（2026-10-05），随实现写成（`src/data/inventory.schema.ts`、`src/engine/optimize.ts`、`src/cli/optimize.ts`，用例 `tests/optimize.test.ts`）。用户定的范围：库存手写 YAML、一次一个角色（2026-10-05）。
> **依据**：《技术总体设计 v0.1.9》（下称"总设计"）§3.5（稳态口径）、第 12 节 M5 / M7；《TD-10 输出与报告 v0.1.3》§3（对比口径 `basisOf`）、§4（副词条边际）；《TD-03 伤害公式规格》（`computeHit`）；《TD-07 Buff 系统》（`accumulate` 与过滤条件）
> **不讲**：轴怎么排（轴固定，排轴搜索属于 M7）；声骸词条的强化与概率

---

## 0. 要点

1. **问题**：给定一条轴、队友的配装，从声骸库存里给一个角色挑 5 件，让稳态 DPS（TD-10 §3 的口径）最高。
2. **约束**：cost 合计 ≤ 12；首位声骸不变（轴里的 `Q` 是它的技能）；套装件数沿用现在的（≥ 2 件的套装，件数不少于现在），或用 `--set` 指定 5 件套；同一件不能用两次；缺省不拿队友身上的（`owner` 是队友）。
3. **快速重算**：完整仿真一次 0.1–0.15 秒，库存几十件时组合上万，不能每套都完整跑。先完整跑一次，记下这个角色每次直接伤害结算的输入；换声骸时只按新面板重算这些结算（每套约 1 毫秒）。
4. **搜索**：按边际收益预筛 → 枚举 → 逐件替换；估计最好的几套各自完整仿真确认，排名只看完整仿真。
5. **两遍**：第二遍按第一遍完整仿真最好的那套重新记录、再搜一次，修正套装或共鸣效率改变时间轴带来的偏差。

---

## 1. 命令

```bash
pnpm optimize scenarios/m0-team.yaml --inv inventory/m0-equipped.yaml --char 椿 [--top 5] [--keep 8] [--set 沉日劫明] [--include-team]
```

输出：首位声骸、套装要求、可用件数；现在的 DPS；快速重算与完整仿真的套数、耗时；前 `top` 套（完整仿真 DPS、与现在的差、估计值、面板的攻击 / 暴击 / 暴伤 / 共鸣效率、5 件的 id、名字、cost、套装、词条，在队友身上的注明）；最后给出第 1 套的 `echoes` 写法，可以直接贴回场景。退出码：0 成功；1 场景 / 库存有错；2 用法错误。

| 选项 | 缺省 | 含义 |
|---|---|---|
| `--top` | 5 | 列出几套 |
| `--keep` | 8 | 预筛时每个（cost、套装）留几件；越大越慢、越不容易漏 |
| `--set` | 沿用现在的 | 指定 5 件套 |
| `--include-team` | 不拿 | 也从队友身上拿（`owner` 是队友的） |

---

## 2. 库存文件

`inventory/<名字>.yaml`（进 git，和场景一样是用户的数据）：

```yaml
echoes:
  - { id: 无冠-1, owner: 椿, name: 梦魇·无冠者, set: 沉日劫明, main: 暴击率, subs: { 暴击伤害: 0.138, 共鸣效率: 0.084 } }
  - { name: 暗鬃狼, set: 沉日劫明, main: { 湮灭伤害加成: 0.3, 攻击: 100 }, subs: { 暴击率: 0.075 } }
  - { name: 某个 1C, set: 沉日劫明, cost: 1, main: 攻击%, subs: {} }
```

| 字段 | 说明 |
|---|---|
| `id` | 可选，缺省按顺序编号 `#1`、`#2`…；输出里用它指认是哪一件，不能重复 |
| `name`、`set` | 同场景的 `echoes`；首位声骸要在声骸表里（异相·X 取 X） |
| `main` | 只写主词条名字（`暴击率`）：满级值取 `echo-stats.json` 的 `mains`，固定副主属性（4C 攻击 150、3C 攻击 100、1C 生命 2280）取 `fixedSubs`；或者写全（同场景） |
| `cost` | 可选。依次从声骸表、主词条（只有一种 cost 有这个主词条时，如元素伤害只在 3C）、写全的主词条里的固定副主属性推出；都推不出时报错 |
| `subs` | 副词条，比例写小数 |
| `owner` | 可选，现在装在谁身上 |
| `note` | 可选，备注 |

报错一次列全：推不出 cost、cost 与声骸表不符、这个 cost 没有这种主词条、id 重复。`inventory/m0-equipped.yaml` 是 M0 三人现在身上的 15 件，可以当格式例子。

---

## 3. 快速重算

**记录**：`simulate(r, { onHit })` 在每次直接伤害结算（`computeHit` 那一支；谐度破坏、异常效应不算）时给出 `HitRecord`：出伤者、日志里 hit 事件的下标、`computeHit` 除面板外的输入（倍率、相关属性、附加基础伤害、等级、敌人防御与抗性）、过滤条件要看的 `HitView`、当时生效的 buff（`ActiveBuff[]`）、钩子直接补的乘区。

**重算**（`buildReplayer`）：

- 只取稳态窗口（`basisOf`）里这个角色的记录；窗口里其余伤害（队友、这个角色的谐度破坏）当常数。
- 这个角色身上声骸的贡献分两部分：面板类（生命 / 攻击 / 防御的百分比与固定值、暴击、暴伤、共鸣效率、治疗加成）在静态面板里；带过滤条件的（元素伤害、技能类型伤害）是常驻 buff `<角色>.声骸.<属性>`（resolve 的 `statAdder`）。记录时把它们都扣掉，得到"没有声骸词条"的面板与每次结算的乘区；换一套时按新的词条合计加回去，再调用同一个 `computeHit`。
- 首位加成、套装效果、其余 buff 按记录时的原样（所以套装件数、首位声骸不变时，时间轴不变的前提下重算是精确的：`tests/optimize.test.ts`；M0 代表轴上椿各加一档的结果与 `pnpm marginal` 逐位相同）。

**会偏的情形**：共鸣效率变了、大招放出来的时机跟着变；套装件数变了（5 件效果有无）；触发条件与面板有关的 buff。这些都靠完整仿真确认（§4），估计与完整仿真差超过 0.5% 的会提示。

---

## 4. 搜索

1. **可用的件**：库存里 `owner` 不是队友的（`--include-team` 时全部）；首位候选是与现在首位同名的（异相算同名）。
2. **预筛**：在记录时的词条附近，各属性加一档（`subTiers` 平均）算出每单位属性的 DPS 增量，每件按线性分排序；每个（cost、是否计入套装要求的套装）留前 `keep` 件，首位候选也留前 `keep` 件。
3. **枚举**：首位 × 其余 4 件的全部组合，满足 cost ≤ 12、套装件数；每套快速重算。
4. **逐件替换**：从估计最好的 max(2 × top, 6) 套出发，每个位置换成可用的任意一件（不只预筛留下的），有提升就换，直到不再提升；弥补线性预筛漏掉的组合。
5. **确认**：估计最好、还没确认的 2 × top 套各完整仿真一次；完整仿真报错的（如能量不够）不列，提示一次。
6. **第二遍**：按第一遍完整仿真最好的那套重新记录，重做 2–5。
7. 结果按完整仿真的 DPS 排，取前 `top` 套。

规模（2026-10-05，M0 代表轴，椿）：库存 109 件（15 件现役 + 94 件随机生成）、`keep` 8：快速重算约 2.4 万套、完整仿真 12 套，约 25 秒；找到的第 1 套比现在高 0.34%（换了一件 1C）。人造数据上的结果与穷举（每套完整仿真）相同。

---

## 5. 类型

```ts
// src/engine/context.ts
interface HitRecord { slot; index; ctx: Omit<HitContext, 'panel'>; view: HitView; active: ActiveBuff[]; draft: Pick<HitDraft, 'zones' | 'critOnly'> }
interface SimOptions { onHit?(rec: HitRecord): void }        // simulate(r, opts?)

// src/data/inventory.schema.ts
InventorySchema; resolveInventory(inv, data) → { pieces: InvPiece[]; issues: string[] }
interface InvPiece { id; name; set; cost: 1 | 3 | 4; main; subs; owner? }

// src/engine/optimize.ts
totalsOf(pieces) → Totals; buildReplayer(r, res, recs, slot) → Replayer { basis; totals0; hits; dps(totals) }
runRecorded(sc, data); withEchoes(sc, slot, pieces)
optimize(sc, data, pieces, { slot, top?, keep?, set?, includeTeam? }) → OptimizeResult { char; current; plan; main; pool; evaluated; verified; builds: Build[]; notes }
```

---

## 6. 待定问题

| # | 问题 | 现在的做法 | 什么时候再看 |
|---|---|---|---|
| Q1 | 首位声骸能不能也换 | 不换：轴里 `Q` 的位置按这件的技能排过（TD-10 §3 的例子），换首位常要改轴 | 需要时加 `--main`，按候选首位各自完整记录一次 |
| Q2 | 全队一起分配（同一件不能给两个人） | 一次一个角色；队友身上的缺省不拿 | 用户需要时；可以按角色依次择优、已选的件从库存去掉 |
| Q3 | 预筛会不会漏掉好组合 | 线性分预筛 + 逐件替换（替换时看全部可用的件）；人造数据上与穷举一致 | 库存大到 `keep` 不够时，提高 `keep` 对比结果 |
| Q4 | 速度 | 每套重算约 1 毫秒（M0 代表轴 170 次结算），2 万套约 20 秒 | 慢到影响使用时：重算不复制面板、预先按过滤条件合并结算 |
| Q5 | 库存从哪来 | 手写 YAML | 以后加导入（扫描 / 导出工具的 JSON） |

---

## 附录：变更历史

- **v0.1（2026-10-05）**：初版，随实现写成。
