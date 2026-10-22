# `data/generated` 与 Wuthery 解包数据核对（2026-10-21）

## 口径

本次只读核对，没有改 `data/generated`、xlsx 或仿真规则。冻结的本地样本是 `鸣潮动作数据汇总-20261019.xlsx`（SHA-256 `8b8c9c077aff34b1c1f7ca855945b060482e77fe76d7afd5da7ce65ba7c528f1`）构建出的 `data/generated`，`meta.json` 记载资源版本 **3.7.13**、构建时间 `2026-10-21T08:27:43Z`。核对时生成目录正被另一个任务重建，因此实际比对的是开始时冻结到 `out/wuthery-audit/generated/` 的副本；完成测试后逐文件核对，这份副本与当时的 `data/generated` **88 个文件哈希完全一致**。该目录还存有本次下载的解包文件、原始逐条结果 `probe.json`、声骸核对结果和哈希清单；它位于 git 忽略的 `out/` 下。

对照源是 [Wuthery 的 GameData 解包](https://files.wuthery.com/d/README.md)。其 [wau-release.json](https://files.wuthery.com/d/GameData/wau-release.json) 记录资源版本 **3.7.15**、`changeList=9068879`、`generatedAt=2026-10-16T06:40:52Z`、`releaseId=342ac25feb76e5786e75734c8b4b1a886e14c224e1afb20b3b7f66bc7303f1ba-61b33421fe6946d6b9af2a889feb6c4b`。版本号略新，但解包时间早于本地 xlsx 文件名日期；出现差异时，**不能仅凭 3.7.15 > 3.7.13 就认定哪边正确**。Wuthery 的 `ConfigDBParsed` 数字 ID 有些以 IEEE-754 double 的位模式存为 JSON 整数；核对伤害、buff 时先按位还原 ID。字段换算依据 TD-01 §4–§5、§7–§9、§11，伤害公式依据 TD-03 §3.2。

| 范围 | 对照结果 | 说明 |
| --- | --- | --- |
| 当前角色与声骸已连接的伤害条目 | **2681/2681** 条的选定技能等级倍率一致；2661 条全部被比较的字段一致 | 按 `charaId + skillName` 找 xlsx 的 `DamageId`，再比 [Damage.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/Damage.json)；`旧椿` 的 66 条历史数据另列。20 条字段差异见下文。倍率统计不是逐级全表一致率。 |
| 角色基础属性 | **61/64** 个现行角色的 L1、L90 基础生命/攻击/防御、能量上限、元素、偏谐效率、谐破增幅一致 | 另 3 个差异；`旧椿` 无现行 `RoleInfo`。对照 [RoleInfo.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/RoleInfo.json)、[BaseProperty.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/BaseProperty.json)、[RolePropertyGrowth.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/RolePropertyGrowth.json)。 |
| 当前武器基本属性 | **119/124** 件的品质、种类、90 级主/副属性一致 | 浮点尾差按 `1e-6` 忽略；另有 1 件历史同 ID 武器。对照 [WeaponConf.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/WeaponConf.json) 与 [WeaponPropertyGrowth.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/WeaponPropertyGrowth.json)。 |
| 声骸属性 | **22/22** 个满级主属性和固定属性一致 | 对照 [PhantomMainPropItem.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/PhantomMainPropItem.json)、[PhantomMainProperty.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/PhantomMainProperty.json)、[PhantomGrowth.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/PhantomGrowth.json)；未比随机副词条的抽取概率。 |
| 声骸技能冷却 | **80/85** 个完全一致；4 个有数值差异；1 个有额外的 0 秒动作组 | 按声骸 ID 连 [PhantomItem.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/PhantomItem.json) 和 [PhantomSkill.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/PhantomSkill.json)。 |
| 异常伤害基础值 | **100/100** 级一致 | `effects.json.abnormalBaseByLevel` 对照 [AbnormalDamageConfig.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/AbnormalDamageConfig.json) 的 `Abnormal1001`。 |

这里的 2681 条是去重的已连接伤害键，不是 `meta.json` 中的判定行数；相同伤害条目可被多处动作复用。单独比较当前两支队伍的直接伤害键：椿 78、散华 21、维里奈 22、应世心 68、照世心 59、雷主 64、卜灵 18，以上各项所比字段全部一致。

## 可定位的差异

武器的 5 个现行差异如下。`raw` 一列是本次解包，不代表已经确立为应修改的权威版本；对应的 [Grouped/Weapon](https://files.wuthery.com/d/GameData/Grouped/Weapon/) 也能按 ID 查到解包侧数据。

| 武器（ID） | `data/generated` / xlsx | Wuthery 解包 |
| --- | --- | --- |
| 云琅（21020106） | 长刃 | 迅刀 |
| 沉冥（21020107） | 长刃 | 迅刀 |
| 戍关迅刀·镇海（21020053） | 90 级攻击 325 | 90 级攻击 300 |
| 碎骨（21030066） | 90 级暴击率 36% | 90 级暴击伤害 72% |
| 阳焰（21030104） | 90 级暴击伤害 40.5% | 90 级暴击率 20.25% |

`纹秋鸣刀·流愿` 在 xlsx 中与现行 `千古洑流` 共用 ID 21020015，前者的攻击/副属性因此对不上现行解包；它是历史条目，不计入 124 件现行武器的分母。武器被动的触发、持续等依 TD-01 §7 尚需手写，以上数字**不包括**被动验证。

声骸冷却差异：

| 声骸 | `data/generated` | 解包 / 本地 nanoka 3.7 | xlsx 说明文字 |
| --- | ---: | ---: | ---: |
| 梦魇·无常凶鹭 | 20 秒 | 25 秒 | 20 秒 |
| 梦魇·赫卡忒 | 20 秒 | 25 秒 | 25 秒 |
| 角鳄 | 20 秒 | 15 秒 | 15 秒 |
| 霁息兽尊 | 15 秒 | 20 秒 | 20 秒 |

后三项尤其像动作表冷却与说明文字不同，生成数据已打 `cooldownText` 类 flag；无常凶鹭则可能是真正的版本差异。`伪作的神王` 的主动作 8 秒与解包相同，另一个动作组为 0 秒，属于动作组语义差异，**不是第五个确定的冷却错误**。在当前 M0 与心队场景用到的首位声骸中，已比对的冷却没有发现上述差异。这四项目前仅作为待核实差异记录；若决定修正，应在 `data/curated/echoes.ts` 中覆盖，并保留上表的原始生成值供追溯。

角色基础属性的 3 个差异：`景燃` 的 L1 生命/攻击为 **932/33**，解包 **1230/25**；按同一 90 级成长曲线分别得到 **11650/412** 与 **15375/312**，双方防御均为 0，看起来仍是未完成角色数据。`达妮娅`、`丽贝卡` 的 `harmonyBreakBoost` 本地为 0，解包 `WeaknessMastery` 为 10。角色核心资源上限另外有大量单位换算或覆盖（例如心的 100 对原始 10000），不能做原值相等比较；见 TD-01 §5.2，不计入 61/64。

20 条现行伤害字段差异可归为四类：15 条谐度破坏/响应的 `relatedProperty` 为 xlsx 加工后的 **10000099**，解包字段为 **7**，属于公式参数重写（TD-01 §4.1、TD-03 §6）；2 条角色专属声骸伤害的 `rates[]` 在 6–20 级由 xlsx 重复 5 级值，而解包填 0，声骸实际选用 5 级倍率仍一致；`达妮娅` 两条“泡泡”治疗判定的 `cureBase` 本地为 **0**、解包为 **100**，今后使用该角色时需查清；`叮咚咚` 的 nanoka 补连伤害 ID **20005001** 本地 `FormulaType=0`、倍率 0，解包 `FormulaType=1`、`FormulaParam7=[2000,2300,2600,2900,3200]`、`FormulaParam10=[40,46,52,58,64]`。其说明文字写“32.00%+64 冷凝伤害”，因此目前若把这个声骸用于仿真，**可能漏算整下伤害**。TD-01 §4.1 目前只抽 `FormulaParam5`；应先针对该特殊公式补抽取与用例，再决定如何修正，不宜直接把 32%+64 当普通倍率硬填进去。

散华一链还有**文本与解包的矛盾**：xlsx / `characters.json` 写暴击率提升持续 8 秒，[ResonantChain.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/ResonantChain.json) 的 ID 19 参数为 `15%`、`10`；其链接的 [Buff.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/Buff.json) 中 ID 1102901002 的 `DurationMagnitude=[10]`。当前 `data/curated/characters/散华.ts` 已按 10 秒、600 帧处理，故**不影响当前仿真**，但生成的文本仍与解包冲突。

## 续查：动作帧与运行时 buff

续查时 Wuthery 的 [版本记录](https://files.wuthery.com/d/GameData/wau-release.json) 已更新至 **3.7.16**（`releaseId=e8e7cfd6dfbdb56665c8064723d726be678046db85b0a5f7bc563156f65a3f51-e2c69fd542ae482f97be21b1f19208b7`）。为避免混用，本节另存了 3.7.16 的 `Buff.json` 和版本记录；逐条比较发现，**3.7.15 与 3.7.16 的 `Buff.json` 27394 条内容完全相同**（SHA-256 均为 `ac0fe5049e3b4241df4912d938fdf06892b286ff8fcf59ee720a7306c3c49387`）。本节动作配置表来自 3.7.16，前文其余统计仍属 3.7.15。

### 动作帧：找到动画引用，没有找到逐帧时间表

逐项查看 [EntitySkillPreload.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/EntitySkillPreload.json)（24595 条，其中 23626 条列出动画路径）、[AbpMontageData.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/AbpMontageData.json)（5729 条）、[MontageData.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/MontageData.json)（560 条）、[Skill.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/Skill.json)（602 条）、[SkillInput.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/SkillInput.json)、[Damage.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/Damage.json) 和未解析的 `db_skill` 目录。这里需要更正前一次调查的说法：`AbpMontageData` 主要是 NPC/对话动画路径，**不是角色战斗动作的主要索引**。真正有用的是 `EntitySkillPreload`：它以 `SkillId`、角色蓝图、`Animations` 路径关联技能和动画。例如散华 `SkillId=1102001` 指向 `/Game/Aki/Character/Role/FemaleM/Sanhua/CommonAnim/AM_Attack01.AM_Attack01`，按命名很可能对应 A1；本地 A1 写判定第 13 帧、派生第 21 帧、结束第 41 帧，但这份预加载表没有 `Frame`、`Time`、`Notify` 或事件时间字段，**不能直接从路径验证这三个数**。`Skill` 可以把 UI 技能与伤害 ID 相连，也没有每下伤害的发生帧、派生帧、结束帧。`PassiveSkill` 的部分 `CDTime` 是被动触发冷却，不等于动作判定时间。公开 GameData 顶层只列 ConfigDB、Grouped、TextMaps、UIResources 等，没有这些路径所指的战斗动画资产本体。

因此，TD-01 §3 的 `spawnFrame`、`deriveFrame`、`endFrame`、`delayFrames`、无敌起止帧、受击停顿等 **在这份公开解包里目前找不到独立的逐项基准**。它们能追溯到 xlsx 的公式和缓存值，但“作者从游戏解包提取”的上游步骤无法仅凭 Wuthery 这份文件验证。不能把上节伤害倍率的 2681/2681 套用为动作帧的匹配率；这里没有可比较的分母。要做帧级印证，需要动画资产/事件轨道或实测视频等另一种来源（TD-11 §2、§6）。

可行的下一步：用 `EntitySkillPreload.SkillId + ActorBlueprint + Animations` 缩小到一个动作；在拥有相同游戏版本客户端文件的前提下，用 [FModel](https://github.com/4sval/FModel) 查看相应 Unreal 动画包，确认是否存在 [Animation Notify、Notify State、Montage 事件](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-notifies-in-unreal-engine)、输入/取消窗口等。若能读到事件时间，再用 [CUE4Parse](https://github.com/FabianFG/CUE4Parse) 批量导出，以动作起点、播放速率与 60fps 口径换算，并逐项对照 xlsx。**是否能还原派生帧或伤害帧，取决于该游戏是否把这些语义写在可解析的动画事件里**；项目自定义逻辑、子弹飞行、命中检测、时停/顿帧可能使动画事件与实际结算不同。若资产里也没有足够信息，按 TD-11 §2、§6 用高帧率视频逐帧测首击、后续跳字及最早可接下一动作的时刻，重复测量并记录误差。

### 互联网续查：公开帧表及原包提取线索（2026-10-21）

本节记录公开来源和一次小样本对照，**不把社区帧表当作原包真值**。检索范围包括 Wuthery、[Arikatsu 的 3.7 解包仓库](https://github.com/Arikatsu/WutheringWaves_Data)、[Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData)、[encore.moe 列出的数据来源](https://www.encore.moe/about)、社区仿真器及 Unreal 资产工具。截至本次检索，没有找到公开的、可追溯到同版游戏原包且覆盖「每一帧全部战斗状态」的统一表；以下结论只限定于查过的公开资源，不能推断游戏客户端内不存在这些信息。

| 来源 | 实际可用的帧级线索 | 出处与局限 |
| --- | --- | --- |
| [Arikatsu `entityskillpreload.json`](https://github.com/Arikatsu/WutheringWaves_Data/blob/3.7/BinData/entity_skill_preload/entityskillpreload.json)、[技能输入表](https://github.com/Arikatsu/WutheringWaves_Data/blob/3.7/BinData/skillTree/skillinput.json) | 前者以 `SkillId` 连动画路径，后者列 `InputArray`、`SkillArray`。 | 有索引和按键组合，没有逐击发生帧或派生窗口；与 Wuthery 同属公开配置类解包，不能算独立的帧数核验。 |
| [WuwaLAB 散华角色 API](https://api.wuwalab.com/api/app/characters/sanhua)、[心角色 API](https://api.wuwalab.com/api/app/characters/hsin) | 动作有 `total_frames`、`earliest_frame_cancel`、`no_swap`、`time_stop`、`motion_stop`、`priority_timeline`；逐击有 `hits[].frame`、`commit_frame`、倍率、资源；部分动作另有 `events[]`。 | 这是目前找到的最细的**公开、可直接读取的社区动作表**。[网站](https://wuwalab.com/)称其逐帧模拟；API 未给每个时间值标注原包位置、测量方法或资源版本，可能与 xlsx 共用上游，不能据相同数字宣称独立印证。 |
| [WU.DA.MAGE 更新记录](https://wudamage.com/changelog)、[使用说明](https://wudamage.com/how-to-use) | 模拟器按时刻结算逐击、buff；作者明确说动作时长及每击落点是游戏内测量值，可编辑动作时长和取消窗口。 | 可作为**实测口径**交叉检查，不是公开原包逐帧导出。 |
| [Maygi 公开计算表](https://docs.google.com/spreadsheets/d/1vTbG2HfkVxyqvNXF2taikStK-vJJf40QrWa06Fgj17c/edit)、[作者说明](https://www.reddit.com/r/WutheringWaves/comments/1j1ikxo/dps_calculator_build_sheets_release/) | 角色页按动作列 `Time`、命中数和 `(Cancel)`、`(Swap)` 变体；散华页可直接查看。 | 是循环耗时与操作变体参考，不是逐击/派生事件原包表；该表角色覆盖与本地 3.7.13 样本也不完全同步。 |

WuwaLAB API 的散华页在本次读取时有 **20** 个动作定义。散华 A1（`Basic: Frigid Light 1`）的逐击 `frame=13`、`commit_frame=13`，与本地 `data/generated/actions/散华.json` 的 `spawnFrame=13` 一致；它另记 `earliest_frame_cancel=13`、`total_frames=23`，而本地按 TD-01 §3 记 `deriveFrame=21`、`endFrame=41`。这些字段的**语义不同**：本地派生帧是常规输入衔接下一技能的起点，结束帧是完全可控时间；不能直接把社区表的最早取消帧或总帧数判为矛盾。散华 A2 的首次命中是社区表第 **24** 帧、本地第 **25** 帧；应先核对计帧起点、命中与判定生成的区别、动作变体和游戏版本，再决定是否属于真实差异。社区表的心「Answering Form - Electro Flare」事件还同时给 `commit_frame=12` 与 `frame=39`，说明至少有些延迟事件分开记提交和发生，不能把所有伤害/效果都压成一个动画 Notify 时间。以上 API 数字均为 **2026-10-21 的读取快照**；API 未暴露与本地 `resourceVersion=3.7.13` 可对齐的逐动作版本号。

要独立验证原包，先从散华 A1 这一条做可复查实验：以 `SkillId=1102001` 定位 `AM_Attack01`，取得与 xlsx 对应资源版本的客户端动画包；用 [FModel](https://github.com/4sval/FModel) 浏览资产，[FModelCLI](https://github.com/Herselfta/FModelCLI) 可按路径筛选提取鸣潮包，再用 [CUE4Parse](https://github.com/FabianFG/CUE4Parse)或 [UAssetGUI](https://github.com/atenfyr/UAssetGUI)检查保留的资产元数据。优先记录 Animation Sequence / Montage 的 Notify 名称和时间、Notify State 起止、Section、片段偏移及播放速率；只导出骨骼动画画面不足以核事件。Unreal 的[官方文档](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-notifies-in-unreal-engine)确认 Notify 可落在指定帧、State 可跨一段时间，**但这只说明引擎有能力，并未证明鸣潮将派生窗口写在该轨道**。把读出的时间按 TD-01 §3 的动作起点、60fps 和取整口径换算，再查事件所触发的技能逻辑、飞行物/碰撞判定与 `DamageId`，最后用 TD-11 §2、§6 的实机逐帧视频测「最早可接常规动作」「实际跳字」「完全收招」。若资产未见第 21 帧的相关事件，也不能据此否定 xlsx：窗口可能由蓝图、自定义状态机或运行时条件决定。

### Buff：当前两队可定位参数 17/17 组一致

`data/generated` 目前没有 `buff-texts.json`；运行时效果主要由 `data/curated/characters/*.ts` 手写（TD-01 §10.2、TD-07 §11）。按角色 ID 前缀、[ResonantChain.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/ResonantChain.json) 的 `BuffIds`、[Buff.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/Buff.json) 的属性 ID 与数值，给当前 M0 和心队选出 **17 组**能合理定位的效果/状态，对照了 **22 条**原始 buff 记录；选中的持续时间、属性、数值、叠层上限共识别出的字段全部一致。`GameAttributeID` 对照 [PropertyIndex.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/PropertyIndex.json)；比例按万分数转换，攻击百分比还核了 `CalculationPolicy=1`。逐项比较留在忽略目录 `out/wuthery-audit/buff-crosscheck.json`。

| 模块 | 已核对的对应效果与解包 ID | 一致的主要参数 |
| --- | --- | --- |
| 椿 | 含苞 `1603000004`；红椿·蕾 `1603906017`；固有 1/2 `1603801001`、`1603802001` | 15 秒；15 秒/10 层；湮灭、普攻伤害各 15% |
| 散华 | 固有 1 `1102951002`；一链 `1102901002`；六链 `1102906002` | 技伤 20%/8 秒；暴击率 15%/10 秒；攻击 10%/20 秒/2 层 |
| 维里奈 | 光合标记 `1503031001`；固有 1 `1503031011` | 12 秒；攻击 20%/20 秒 |
| 心 | 心相心生 `1311001101`；统御众机 `1311002003`；协同 `1311001102`；四链 `1311600430`–`1311600435` | 45 秒；13 秒；45 秒/21 层；六种元素各 20%/30 秒 |
| 雷主·男 | 超负荷 `1309800005`；固有 2 `1309800009` | 攻击 10%/20 秒；技伤 20%/20 秒 |
| 卜灵 | 开阵 `1307600003`；雷法·两仪交泰 `1307600006` | 24 秒；技伤 10%（后者在解包里无独立时长，由状态控制） |

这是**选中且能定位的参数样本**，不代表所有手写 buff 都验证过。仅靠 `Buff.json` 的数值仍不能确认效果作用对象、触发时点、清除条件、某些层级组合，以及手写钩子的事件顺序；它们可能由 `PassiveSkill`、状态机或动画事件决定。本次没有发现这 17 组的数值冲突。已知的散华一链冲突只在 xlsx 文本与解包之间，手写运行值与解包一致。

## 尚未印证的部分与处理顺序

`data/generated/enemies.json` 的 1533 条是 xlsx 敌人属性、等级/成长和场景覆写的结果，[BaseProperty.json](https://files.wuthery.com/d/GameData/ConfigDBParsed/BaseProperty.json) 只提供其中一部分原型。不能把同一 `PropertyId` 的塔层/全息衍生数值直接当作原型逐项比较。当前两支队伍所用全息敌人的直接原型字段基本对上；`ToughReduce` 的本地中性值 10000 与解包 0 反映默认值表示法差异。敌人最终血量、攻击、防御仍需连同场景参数重建后另做逐项核对。

动作帧、buff 触发逻辑、武器被动、随机副词条分布等仍未得到完整独立验证；本次高匹配率不覆盖这些部分。四个声骸冷却与 5 件武器仍需核对同一游戏版本，再处理 `叮咚咚` 与两条治疗数据，最后按 TD-01 §9 的合成规则核敌人。改动若成立，应按仓库约定在 `data/curated/` 覆盖或更新抽取规则并登记推断依据，不直接修改生成文件。
