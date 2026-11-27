# 证据闭环

## 读法

一条闭环一个文件（`<闭环 ID>.yaml`，格式见 `src/data/evidence.schema.ts`、DD-08 §4.1）：候选 → 条件化预测 → 观测及误差范围 → 判断 → 采用决定 → 受影响场景重跑。

- **结论**按 DD-08 §4.1 的决策表算，说的是"所指候选"（当前采用的那个）：证实（所测条件内）要求每个竞争候选都被同一条独立检验的观测排除（第 4 行）；只有相容或选模材料的是"暂定"；"分不清"要写出下一项能区分的观测。
- **相容不是证实**：一条观测与几个候选都相容时，对它们都只是"相容但区分不了"。
- **采用决定**由人填，与结论分开存；"重跑"是采用决定之后，同一份代码上采用前、后两个值的对照。
- 观测在 `docs/calibration/points.yaml`，进游戏实验的记录在 `docs/experiments/`。

生成：`pnpm evidence --md`（DD-08 §4.2）。

<!-- generated: DD-04 -->
## 闭环总表

| 闭环 | 命题 | 种类 | 结论 | 各候选 | 依据（独立 / 其他） | 采用决定 | 重跑 | 下一项可区分的观测 |
|---|---|---|---|---|---|---|---|---|
| [buling-concerto-timing.backfill](buling-concerto-timing.backfill.yaml) | buling-concerto-timing | 回填 | 分不清（as-data，决策表第 3 行） | as-data 相容；on-cast 相容；later-split 未评估（候选未实现） | — / 卜灵协奏.中3.切雷主#1、卜灵协奏.中3.切雷主#3、卜灵协奏.中3.切雷主#5、卜灵协奏.中3.切雷主#7、卜灵协奏.中4.切雷主#1、卜灵协奏.中4.切雷主#3、卜灵协奏.中4.切雷主#5、卜灵协奏.中4.切雷主#7 | as-data → as-data（缺省不变） | 11 个场景，变了 0 个 | 训练场单放卜灵的一招（E、重击、大招各一次，切到卜灵后协奏从 0 起），60 帧逐帧读协奏环在起手与各段命中前后的变化；同一段录像顺带标定读环的方法（环的显示有没有滞后、心的环为什么稳定高约 5%）。能区分"起手一次给全""随命中逐段给""E 的 23 分摊到 E-2" |
| [buling-first-echo.backfill](buling-first-echo.backfill.yaml) | buling-first-echo | 回填 | 暂定（echo-cast，决策表第 5 行） | echo-cast 相容；no-echo 不相容；xin-only-atk 未评估（候选未实现）；target-side 未评估（候选未实现） | 卜灵首段声骸.中4.电磁QTE-2 / 卜灵首段声骸.中4.LT冷却、卜灵首段声骸.中4.电磁QTE-3、卜灵首段声骸.中4.心召唤-6、卜灵首段声骸.中4.E-落地、卜灵首段声骸.中4.镇红尘#1 | no-echo → echo-cast（缺省不变） | 没有受影响的场景 | — |
| [cast-gain-at-start.2026-11](cast-gain-at-start.2026-11.yaml) | cast-gain-at-start | 实验 | 证实（所测条件内）（at-start，决策表第 4 行） | at-start 相容；at-first-hit 不相容 | 散华E协奏.抢帧第1次、散华E协奏.抢帧第3次 / — | at-start → at-start（缺省不变） | 25 个场景，变了 0 个 | — |
| [echo-input-priority.2026-11](echo-input-priority.2026-11.yaml) | echo-input-priority | 实验 | 预测已登记（2026-11-16），等读数 | 还没判断 | — | 待定 | — | — |
| [echo-input-priority.backfill](echo-input-priority.backfill.yaml) | echo-input-priority | 回填 | 证实（所测条件内）（generic-5，决策表第 4 行） | generic-5 相容；echo-table 不相容 | 声骸起手.散华EQ抢帧、声骸起手.维里奈EQ抢帧、声骸起手.椿E1Q抢帧 / — | generic-5 → generic-5（缺省不变） | 24 个场景，变了 0 个 | — |
| [sanhua-e.backfill](sanhua-e.backfill.yaml) | cast-gain-at-start | 回填 | 分不清（at-start，决策表第 3 行） | at-start 相容；at-first-hit 相容 | — / 散华E.散EQ变奏椿.启动轴、散华E.散EQ变奏椿.第1轮、散华E.散EQ变奏椿.第2轮、散华E.散EQ变奏椿.第3轮 | at-start → at-start（缺省不变） | 25 个场景，变了 0 个 | 已登记为 C9（docs/evidence/cast-gain-at-start.2026-11.yaml、docs/experiments/C9-散华E协奏起手即得.md）：散华协奏从 0 开始，E 一起手就按声骸把 E 打断（C8 回填看到的：E 进冷却、冰棱不出现，E 的命中根本没有），隔 21 秒做三次，每次凶鹭砸地后读协奏环——起手即得 0.31 / 0.62 / 0.93，随第一段命中给 0.16 / 0.32 / 0.48。（原来写的"E 后立刻切人看下一位变不变奏"要把协奏攒到差一两格满、还要在第 19 帧前切人，难做；切人也不一定打断 E） |
| [yanhen.backfill](yanhen.backfill.yaml) | yanhen-extend | 回填 | 暂定（nanoka-text，决策表第 5 行） | nanoka-text 相容；xlsx-three-sentences 未评估（候选未实现） | — / 焰痕.破敌#2、焰痕.狼舞的决意·极#2、焰痕.狼舞的决意·极#3 | nanoka-text → nanoka-text（缺省不变） | 没有受影响的场景 | 下一项独立观测（没参与挑读法的）：训练场露帕放大招后过 6 秒再打一下重击，看之后狼舞的决意·极的跳字是否吃到共鸣解放 +24%；连打两下重击，看第二下还延不延长（最多 1 次）；延长成功那一刻看队友面板的热熔伤害加成是否 +24%。或者另一局录像里没参与过改读法的狼舞的决意·极与破敌跳字 |
| [zhenhuanyu-window.backfill](zhenhuanyu-window.backfill.yaml) | zhenhuanyu-window | 回填 | 未验证（无可评估的候选，决策表第 1 行） | expired-as-sim 未评估（全部条件不足）；in-window 未评估（候选未实现） | — / — | 待定 | — | 训练场：雷主放过声骸（绝息魄首位）后延奏切心变奏入场，入场后按倒计时掐在 14.5 秒与 15.5 秒各放一次镇寰宇（各三次），比两组跳字是否差 1.1222 倍；或者在本局里找镇寰宇离入场更远（明显超过 15 秒）或更近（明显不到）的一轮看跳字 |
