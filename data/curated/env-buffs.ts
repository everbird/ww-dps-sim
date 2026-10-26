// data/curated/env-buffs.ts —— 场景 buff（深塔、矩阵的环境特性），场景里 environment: [id] 引用（TD-07 §3，持有者记 env）。
// 原文照游戏里"环境特性"面板抄；写清哪一期、哪一层，不同期同一层可能不同。
import type { BuffDefInput } from '../../src/data/buff.schema'

const buffs: BuffDefInput[] = [
  // 深塔 28 期 左 4（2025-11，桃渊散录像 BV1o7kfBPE6y 开头的"环境特性"面板，第 7 秒）
  {
    id: '深塔28左4.湮灭抗性', source: '敌方湮灭抗性降低10%',
    zone: 'TargetElementResistant', value: -0.1, filter: { elements: ['湮灭'] }, target: 'team', duration: 'inf', trigger: 'always',
  },
  {
    // "角色施放变奏技能时"：给放变奏的那个人（变奏触发时他已在前台），各人各算 18 秒
    id: '深塔28左4.变奏暴伤', source: '角色施放变奏技能时，暴击伤害提升20%，普攻伤害加成提升40%，持续18秒，重复触发刷新持续时间。',
    zone: 'critDamage', value: 0.2, target: 'onField', duration: 1080, trigger: { on: 'intro' },
  },
  {
    id: '深塔28左4.变奏普攻', source: '角色施放变奏技能时，暴击伤害提升20%，普攻伤害加成提升40%，持续18秒，重复触发刷新持续时间。',
    zone: 'DamageChangeType', value: 0.4, filter: { tags: ['普攻'] }, target: 'onField', duration: 1080, trigger: { on: 'intro' },
  },
  // 深塔 41 期 中 3（2026-10-26 你自己的录像 20261026-深塔-中3-心雷卜.mp4 开头的"环境特性"面板；敌人与数据里的 41塔中3 对得上，docs/tower-20261026.md）
  // 面板上的"最终提升"没写类别，按 0 类最终伤害（FinalDamage0，同"全伤害加深"不带类别 = 0 类）：三条之间相加（假设 env-final-class）
  {
    // "攻击命中时会使敌人受到伤害最终提升…每经过5秒该效果值提升5%"：60 秒后队里有人命中就加一层，5 秒内置冷却，12 层封顶（60%）
    id: '深塔41中3.受伤递增', source: '战斗开始60秒后，角色攻击命中时会使敌人受到伤害最终提升5%，每经过5秒该效果值提升5%，最高提升至60%。',
    zone: 'FinalDamage0', value: 0.05, maxStacks: 12, icd: 300, target: 'enemy', duration: 'inf',
    trigger: { on: 'judgmentSettle', where: { by: 'team', afterBattle: 3600 } },
  },
  {
    id: '深塔41中3.抗性', source: '敌方全属性抗性提升15%。敌方受到的导电伤害和衍射伤害不受该效果影响。',
    zone: 'TargetElementResistant', value: 0.15, filter: { elements: ['物理', '冷凝', '热熔', '气动', '湮灭'] }, target: 'team', duration: 'inf', trigger: 'always',
  },
  {
    id: '深塔41中3.变奏', source: '角色施放变奏技能时，全队造成伤害最终提升15%，持续20秒。',
    zone: 'FinalDamage0', value: 0.15, target: 'team', duration: 1200, trigger: { on: 'intro', where: { by: 'team' } },
  },
  {
    // "自身" = 附加电磁效应的那个人（env 的 self 给触发者，triggers.ts）
    id: '深塔41中3.电磁', source: '角色附加电磁效应时，自身造成伤害最终提升55%，持续20秒。',
    zone: 'FinalDamage0', value: 0.55, target: 'self', duration: 1200,
    trigger: { on: 'enemyState', where: { by: 'team', enemyState: 'effectApplied', effect: '电磁效应' } },
  },
  // 第三句"角色响应同奏时，自身造成导电伤害最终提升50%，持续20秒"没写：同奏这种响应还没建模，心雷卜也不是靠它（待确认）
]
export default buffs
