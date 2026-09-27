// data/curated/characters/散华.ts —— 角色模块示例（格式以 TD-08 为准）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('散华', {
  weaponType: '迅刀',
  aliases: { E: 'E', R: '大招', QTE: 'QTE', A1: 'A1', A2: 'A2', A3: 'A3', A4: 'A4', A5: 'A5' },
  buffs: [
    {
      id: '散华.固有1',
      source: '固有技能1：变奏后，获得持续时间为8秒的20%共鸣技能伤害提升buff',
      zone: 'DamageChangeType', value: 0.2, filter: { tags: ['共鸣技能'] },
      target: 'self', duration: 480, trigger: { on: 'intro' },
    },
    {
      id: '散华.共鸣链6',
      source: '共鸣链6：引爆【冰棱】或【冰川】后，队伍中的角色攻击提升10%，持续20秒，可叠加2层',
      zone: 'atkPct', value: 0.1, target: 'team', maxStacks: 2, duration: 1200,
      requires: { chain: 6 },
      trigger: { on: 'judgmentSettle', where: { judgments: ['E-引爆冰棱', 'QTE-引爆冰棘', '大招-引爆冰川'] } },
    },
    {
      id: '散华.延奏',
      source: '延奏：下一位登场角色普攻伤害加深38%，效果持续14秒，若切换至其他角色则该效果提前结束',
      zone: 'DamageAmplify0', value: 0.38,                 // 不带类别的"伤害加深"= 0 类（TD-03 §2）
      filter: { tags: ['普攻'] }, target: 'nextIn', duration: 840, onSwitchOut: 'clear',
      trigger: { on: 'outro' },
    },
  ],
  actionOverrides: {
    谐度破坏: { accept: ['multiEnd'] },     // 两个结束帧是谐度破坏的两段，取第一个即可
    // 备注"第42F可响应大招"，数据没给优先级变化帧，默认回退到派生帧 61；按手感改成 42（m0-confirm 2.3，2026-09-27 确认）
    QTE: { priority: [{ fromFrame: 0, value: 11 }, { fromFrame: 42, value: 8 }] },
  },
})
