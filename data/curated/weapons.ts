// data/curated/weapons.ts —— 武器被动写成 BuffDef（总设计 §3.2）。数值按谐振阶 R1–R5 写成数组，原文见 weapons.json 的 effects。
// 只写用到的武器；xlsx 只有"属性 + 各阶数值 + 文本"，触发条件与持续时间由这里补。
import type { ResourceEffectInput } from '../../src/data/buff.schema'
import { defineWeapon } from '../../src/data/define'

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
  // 行进序曲（散华）、奇幻变奏（维里奈）：被动都是回复协奏，写成资源型触发效果（TD-07 §9）；定值，各阶相同
  defineWeapon({ name: '行进序曲', passives: [], resourceEffects: [concerto8('行进序曲')] }),
  defineWeapon({ name: '奇幻变奏', passives: [], resourceEffects: [concerto8('奇幻变奏')] }),
]

function concerto8(weapon: string): ResourceEffectInput {
  return {
    id: `${weapon}.协奏`, source: '施放共鸣技能时，回复8点协奏能量，每20秒可触发1次。',
    resource: 'concerto', amount: 8, icd: 1200, trigger: { on: 'actionStart', where: { actionKinds: ['skill'] } },
  }
}
