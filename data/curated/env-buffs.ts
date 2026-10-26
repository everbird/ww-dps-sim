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
]
export default buffs
