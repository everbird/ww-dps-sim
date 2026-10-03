// data/curated/characters/散华.ts —— 角色模块示例（格式以 TD-08 为准）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('散华', {
  weaponType: '迅刀',
  treeStats: { '冷凝伤害加成': 0.12, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: { E: 'E', R: '大招', QTE: 'QTE', A1: 'A1', A2: 'A2', A3: 'A3', A4: 'A4', A5: 'A5' },
  buffs: [
    {
      id: '散华.固有1',
      source: '固有技能1：变奏后，获得持续时间为8秒的20%共鸣技能伤害提升buff',
      zone: 'DamageChangeType', value: 0.2, filter: { tags: ['共鸣技能'] },
      target: 'self', duration: 480, trigger: { on: 'intro' },
    },
    {
      // "伤害提升"按伤害加成（与元素 / 类型加成相加），只对写明的那种伤害：冰绽 = 三种引爆（2026-10-03 用户确认，TD-07 Q5）
      id: '散华.固有2',
      source: '固有技能2：施放第5段普攻后，散华共鸣回路冰绽造成的伤害提升20%，持续8秒。',
      zone: 'DamageChange', value: 0.2, filter: { judgments: ['E-引爆冰棱', 'QTE-引爆冰棘', '大招-引爆冰川'] },
      target: 'self', duration: 480, trigger: { on: 'actionStart', where: { actions: ['A5'] } },
    },
    {
      // 持续时间待确认：nanoka 3.7 写 10 秒，xlsx 写"施放A5后，获得持续时间为8秒的15%暴击率提升buff"；先按 nanoka
      id: '散华.共鸣链1',
      source: '共鸣链1：施放第5段普攻时，散华自身暴击提升15%，持续10秒。',
      zone: 'critRate', value: 0.15, target: 'self', duration: 600,
      requires: { chain: 1 },
      trigger: { on: 'actionStart', where: { actions: ['A5'] } },
    },
    {
      // "下次"只管一次重击爆裂；一次爆裂的两段都吃，第二段结算后用掉（2026-10-03 用户确认，TD-07 Q5）。
      // 爆裂在第二段之前被打断时不会用掉，留到 5 秒到期——可接受的近似
      id: '散华.共鸣链4',
      source: '共鸣链4：……并且5秒内的下次重击爆裂伤害提升120%。',
      zone: 'DamageChange', value: 1.2, filter: { judgments: ['重击居合-1', '重击居合-2'] },
      target: 'self', duration: 300, requires: { chain: 4 },
      trigger: { on: 'actionStart', where: { actions: ['大招'] } },
      consume: { on: 'judgmentSettle', where: { judgments: ['重击居合-2'] } },
    },
    {
      id: '散华.共鸣链5',
      source: '共鸣链5：共鸣回路冰绽的暴击伤害提升100%。（"消失时直接爆炸"归钩子，TD-08 §5.1）',
      zone: 'critDamage', value: 1, filter: { judgments: ['E-引爆冰棱', 'QTE-引爆冰棘', '大招-引爆冰川'] },
      target: 'self', duration: 'inf', trigger: 'always',
      requires: { chain: 5 },
    },
    {
      // 每引爆一块冰给一层：一次重击爆裂同时引爆两块，直接叠到 2 层（2026-10-03 用户实测；xlsx"每个引爆周期可获得1层"不对，TD-07 Q3）
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
  resourceEffects: [
    {
      id: '散华.共鸣链4.能量',
      source: '共鸣链4：施放共鸣解放焦瞑冻土时，回复10点共鸣能量。',
      resource: 'energy', amount: 10, requires: { chain: 4 },
      trigger: { on: 'actionStart', where: { actions: ['大招'] } },
    },
  ],
  actionOverrides: {
    谐度破坏: { accept: ['multiEnd'] },     // 两个结束帧是谐度破坏的两段，取第一个即可
    // 备注"第42F可响应大招"，数据没给优先级变化帧，默认回退到派生帧 61；按手感改成 42（m0-confirm 2.3，2026-09-27 确认）
    QTE: { priority: [{ fromFrame: 0, value: 11 }, { fromFrame: 42, value: 8 }] },
    E: { cooldown: 600 },                  // 共鸣技能冷却 10 秒（2026-09-27 用户提供）
    大招: { cooldown: 960 },               // 共鸣解放冷却 16 秒（nanoka 3.7）；大招-引爆冰川是跟随判定的动作，不设冷却
  },
})
