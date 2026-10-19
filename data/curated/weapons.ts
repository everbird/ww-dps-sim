// data/curated/weapons.ts —— 武器被动写成 BuffDef（总设计 §3.2）。数值按谐振阶 R1–R5 写成数组，原文见 weapons.json 的 effects。
// 只写用到的武器；xlsx 只有"属性 + 各阶数值 + 文本"，触发条件与持续时间由这里补。
import type { ResourceEffectInput, TriggerSpec } from '../../src/data/buff.schema'
import { defineWeapon } from '../../src/data/define'

/** 装备者为目标附加电磁效应后（TD-06 §18） */
const ELECTRO: TriggerSpec = { on: 'enemyState', where: { by: 'self', enemyState: 'effectApplied', effect: '电磁效应' } }

export default [
  defineWeapon({
    name: '千古洑流',                        // 椿（m0-confirm §4）
    passives: [
      {
        id: '千古洑流.共鸣效率', source: '共鸣效率提升12.8%',
        zone: 'energyRegen', value: [0.128, 0.16, 0.192, 0.224, 0.256],
        target: 'self', duration: 'inf', trigger: 'always',
      },
      {
        id: '千古洑流.攻击',
        source: '施放共鸣技能后，获得一层持续时间为10s的6%攻击提升buff，重复获得刷新持续时间，最多持有2层buff。',
        zone: 'atkPct', value: [0.06, 0.075, 0.09, 0.105, 0.12], maxStacks: 2,
        target: 'self', duration: 600, trigger: { on: 'actionStart', where: { actionKinds: ['skill'] } },
      },
    ],
  }),
  defineWeapon({
    name: '玉阙玄华',                        // 心
    passives: [
      {
        id: '玉阙玄华.全属性', source: '全属性伤害加成提升12%',
        zone: 'DamageChangeElement', value: [0.12, 0.15, 0.18, 0.21, 0.24], filter: { elements: ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] },
        target: 'self', duration: 'inf', trigger: 'always',
      },
      {
        // 不带类别的"伤害加深"= 0 类（TD-03 §2）；"响应同奏"是同奏模态的，没写
        id: '玉阙玄华.加深', source: '附加电磁效应后或响应同奏时，共鸣技能伤害加深36%，持续30秒，每0.1秒可触发1次。',
        zone: 'DamageAmplify0', value: [0.36, 0.45, 0.54, 0.63, 0.72], filter: { tags: ['共鸣技能'] },
        target: 'self', duration: 1800, icd: 6, trigger: ELECTRO,
      },
      {
        id: '玉阙玄华.无视抗性', source: '附加电磁效应后或响应同奏时，共鸣技能伤害无视目标10%导电伤害抗性，持续30秒，每0.1秒可触发1次。',
        zone: 'RoleIgnoreResistance', value: [0.1, 0.135, 0.17, 0.205, 0.24], filter: { tags: ['共鸣技能'], elements: ['导电'] },
        target: 'self', duration: 1800, icd: 6, trigger: ELECTRO,
      },
      // 第 4 条"30秒内若装备者处于前台，半径50米内的目标受到电磁效应伤害加深30%"只加在电磁效应自身的伤害上，等结算接上时再写（TD-06 §18）
    ],
  }),
  // 行进序曲（散华）、奇幻变奏（维里奈、卜灵）：被动都是回复协奏，写成资源型触发效果（TD-07 §9）
  defineWeapon({ name: '行进序曲', passives: [], resourceEffects: [concertoOnSkill('行进序曲')] }),
  defineWeapon({ name: '奇幻变奏', passives: [], resourceEffects: [concertoOnSkill('奇幻变奏')] }),
]

/** 协奏按阶 8 / 10 / 12 / 14 / 16：xlsx 武器表只有 1 阶的文本"回复8点"（没有各阶数值），各阶按 nanoka 3.7（武器 21020024、21050024 的 param） */
function concertoOnSkill(weapon: string): ResourceEffectInput {
  return {
    id: `${weapon}.协奏`, source: '施放共鸣技能时，回复8点协奏能量，每20秒可触发1次。',
    resource: 'concerto', amount: [8, 10, 12, 14, 16], icd: 1200, trigger: { on: 'actionStart', where: { actionKinds: ['skill'] } },
  }
}
