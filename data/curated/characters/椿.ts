// data/curated/characters/椿.ts —— 角色模块（M0 只填 xlsx 没有的信息；buff 与钩子在 M2 / M3 按 TD-07 / TD-08 补）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('椿', {
  weaponType: '迅刀',
  treeStats: { '暴击伤害': 0.16, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: { E: 'E1', R: '大招', QTE: 'QTE' },
  buffs: [
    {
      id: '椿.固有1',
      source: '固有技能1：湮灭伤害加成提升15%，重击修枝伤害视为普攻伤害。（后半句见 actionOverrides.重击）',
      zone: 'DamageChangeElement', value: 0.15, filter: { elements: ['湮灭'] },
      target: 'self', duration: 'inf', trigger: 'always',
    },
    {
      id: '椿.固有2',
      source: '固有技能2：普攻伤害加成提升15%，普攻和普攻蔓舞、普攻烬华蔓舞的抗打断能力提升。',
      zone: 'DamageChangeType', value: 0.15, filter: { tags: ['普攻'] },
      target: 'self', duration: 'inf', trigger: 'always',
    },
  ],
  actionOverrides: {
    // 固有1"重击修枝伤害视为普攻伤害"：吃普攻加成与普攻加深（TD-08 P8）；P1重击在数据里已经是普攻
    重击: { judgments: { '重击-1': { tags: ['普攻'] }, '重击-2': { tags: ['普攻'] }, '重击-3': { tags: ['普攻'] } } },
    // 共鸣技能（2026-09-27 用户说明，出处：nanoka 的共鸣技能与共鸣回路描述）：
    //   白椿状态 E1 → 变红椿（盛绽）；红椿状态 E2 → 变回白椿；E1 / E2 共用 4 秒冷却
    //   协奏满且一日花不在冷却时，E 替换为 E3 一日花（不限白椿 / 红椿），消耗 70 点协奏、进入含苞状态；
    //   一日花单独 25 秒冷却（nanoka 共鸣回路；6 链文本"独立冷却25秒的一日花"也印证）
    //   含苞状态持续 15 秒，切走或【红椿·蕊】耗完时提前结束（延奏按切走那一刻是否在含苞选版本）
    //   状态与协奏条件由角色钩子 canStart 判断（TD-08），协奏消耗归 TD-06，这里只写冷却
    E1: { cooldown: 240, cooldownGroup: 'E' },
    E2: { cooldown: 240, cooldownGroup: 'E' },
    E3: { cooldown: 1500 },
    大招: { cooldown: 1500 },             // 共鸣解放冷却 25 秒（nanoka 3.7）
  },
})
