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
      {
        // 挂在目标身上、只加在电磁效应自身的伤害上（TD-06 §18）；"若装备者处于前台"= ownerOnField。"同名效果之间取最高值"：一个人装备，不用管
        id: '玉阙玄华.电磁加深', source: '附加电磁效应后或响应同奏后，30秒内若装备者处于前台，半径50米内的目标受到电磁效应伤害加深30%，每0.1秒可触发1次。同名效果之间取最高值。',
        zone: 'DamageAmplify0', value: [0.3, 0.375, 0.45, 0.525, 0.6], filter: { effects: ['电磁效应'] },
        target: 'enemy', duration: 1800, icd: 6, trigger: ELECTRO, ownerOnField: true,
      },
    ],
  }),
  // 景燃 · 尤诺 · 守岸人的专武（2026-10-24，docs/jys-confirm.md）。"获得护盾时"= shield 事件（护盾量不建模）
  defineWeapon({
    name: '千般渡',                          // 景燃。承天满 6 层时重击暴击 +48%、载物的消耗写在景燃的模块里（要看层数）
    passives: [
      {
        id: '千般渡.全属性', source: '全属性伤害加成提升12%',
        zone: 'DamageChangeElement', value: [0.12, 0.15, 0.18, 0.21, 0.24], filter: { elements: ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] },
        target: 'self', duration: 'inf', trigger: 'always',
      },
      {
        // 内置冷却 0.5 秒原文只对护盾，这里两种触发共用（变奏与护盾相隔不到 0.5 秒时少一层）
        id: '千般渡.承天', source: '施放变奏技能或获得护盾时，获得1层【承天】……每0.5秒可通过获得护盾触发1次，可叠加6层，持续7秒，不处于前台时移除所有层数。承天：每层使暴击伤害提升4%',
        zone: 'critDamage', value: [0.04, 0.05, 0.06, 0.07, 0.08], maxStacks: 6, onSwitchOut: 'clear', icd: 30,
        target: 'self', duration: 420, trigger: [{ on: 'intro' }, { on: 'shield' }],
      },
      {
        id: '千般渡.载物', source: '施放变奏技能或获得护盾时，获得……1层【载物】……可叠加6层，持续7秒，不处于前台时移除所有层数。',
        maxStacks: 6, onSwitchOut: 'clear', icd: 30, target: 'self', duration: 420, trigger: [{ on: 'intro' }, { on: 'shield' }],
      },
      {
        id: '千般渡.无视防御', source: '载物：每次施放重击时，消耗最多2层【载物】，每消耗1层【载物】，重击伤害无视目标15%防御，持续2秒。',
        zone: 'RoleIgnoreDefRate', value: [0.15, 0.175, 0.2, 0.225, 0.25], filter: { tags: ['重击'] }, maxStacks: 2,
        target: 'self', duration: 120, trigger: 'hook',
      },
    ],
  }),
  defineWeapon({
    name: '万物持存的注释',                  // 尤诺
    passives: [
      { id: '万物持存的注释.攻击', source: '攻击提升12%', zone: 'atkPct', value: [0.12, 0.15, 0.18, 0.21, 0.24], target: 'self', duration: 'inf', trigger: 'always' },
      {
        id: '万物持存的注释.大招加成', source: '施放变奏或大招后，获得持续时间为15秒的20%大招伤害加成提升buff。',
        zone: 'DamageChangeType', value: [0.2, 0.25, 0.3, 0.35, 0.4], filter: { tags: ['共鸣解放'] },
        target: 'self', duration: 900, trigger: { on: 'actionStart', where: { actionKinds: ['intro', 'liberation'] } },
      },
      {
        // "施放变奏技能时……视为满层（36%），持续3秒"：按变奏时直接加满 5 层算（层数照常持续 7 秒；尤诺每个动作都给自己护盾，3 秒后多半仍是满层）
        id: '万物持存的注释.无视防御', source: '获得护盾后，7秒内大招伤害无视目标7.2%防御，每0.5秒可生效1次，可叠加5层。施放变奏技能时，大招伤害无视目标防御的效果视为满层（36%），持续3秒。',
        zone: 'RoleIgnoreDefRate', value: [0.072, 0.084, 0.096, 0.108, 0.12], filter: { tags: ['共鸣解放'] }, maxStacks: 5, icd: 30,
        target: 'self', duration: 420, trigger: [{ on: 'shield' }, { on: 'intro', stacks: 5 }],
      },
    ],
  }),
  defineWeapon({
    name: '星序协响',                        // 守岸人
    passives: [
      { id: '星序协响.生命', source: '生命提升12%', zone: 'hpPct', value: [0.12, 0.15, 0.18, 0.21, 0.24], target: 'self', duration: 'inf', trigger: 'always' },
      {
        // "造成治疗的伤害类型为共鸣技能伤害时"：共鸣技能混沌理论、变奏技能启迪（伤害为共鸣技能伤害）都回复生命值
        id: '星序协响.攻击', source: '造成治疗的伤害类型为共鸣技能伤害时，20米内的全队角色获得持续时间为30s的14%攻击提升buff',
        zone: 'atkPct', value: [0.14, 0.175, 0.21, 0.245, 0.28],
        target: 'team', duration: 1800, trigger: { on: 'actionStart', where: { actions: ['E-地面', 'E-空中', 'QTE'] } },
      },
    ],
    resourceEffects: [
      {
        id: '星序协响.协奏', source: '施放大招后，获得8点协奏能量，冷却20秒。',
        resource: 'concerto', amount: 8, icd: 1200, trigger: { on: 'actionStart', where: { actionKinds: ['liberation'] } },
      },
    ],
  }),
  // 行进序曲（散华）、奇幻变奏（维里奈、卜灵）：被动都是回复协奏，写成资源型触发效果（TD-07 §9）
  defineWeapon({ name: '行进序曲', passives: [], resourceEffects: [concertoOnSkill('行进序曲')] }),
  defineWeapon({ name: '奇幻变奏', passives: [], resourceEffects: [concertoOnSkill('奇幻变奏')] }),
  defineWeapon({ name: '异响空灵', passives: [], resourceEffects: [concertoOnSkill('异响空灵')] }),   // 莫宁（爱琳莫）
  defineWeapon({
    name: '时和岁稔',                        // 桃祈（视频 BV1o7kfBPE6y 的配装）
    passives: [
      {
        id: '时和岁稔.全属性', source: '全属性伤害加成提升12%',
        zone: 'DamageChangeElement', value: [0.12, 0.15, 0.18, 0.21, 0.24], filter: { elements: ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] },
        target: 'self', duration: 'inf', trigger: 'always',
      },
      {
        id: '时和岁稔.变奏', source: '变奏后，获得持续时间为12s的24%共鸣技能伤害加成提升buff',
        zone: 'DamageChangeType', value: [0.24, 0.3, 0.36, 0.42, 0.48], filter: { tags: ['共鸣技能'] }, target: 'self', duration: 720, trigger: { on: 'intro' },
      },
      {
        id: '时和岁稔.技能', source: '施放共鸣技能后，获得持续时间为12s的24%共鸣技能伤害加成提升buff',
        zone: 'DamageChangeType', value: [0.24, 0.3, 0.36, 0.42, 0.48], filter: { tags: ['共鸣技能'] }, target: 'self', duration: 720,
        trigger: { on: 'actionStart', where: { actionKinds: ['skill'] } },
      },
    ],
  }),
  defineWeapon({ name: '华彩乐段', passives: [], resourceEffects: [concertoOnSkill('华彩乐段')] }),   // 莫特斐（景莫守）
  defineWeapon({
    name: '永远的启明星',                    // 爱弥斯
    passives: [
      {
        id: '永远的启明星.全属性', source: '全属性伤害加成提升12%',
        zone: 'DamageChangeElement', value: [0.12, 0.15, 0.18, 0.21, 0.24], filter: { elements: ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] },
        target: 'self', duration: 'inf', trigger: 'always',
      },
      // "附加震谐·偏移或聚爆效应时"：自己给目标挂上偏移（enemyState shift，by 自己，TD-06 §19）
      {
        id: '永远的启明星.无视防御', source: '附加震谐·偏移或聚爆效应时，共鸣解放伤害无视目标32%防御，持续8秒。',
        zone: 'RoleIgnoreDefRate', value: [0.32, 0.4, 0.48, 0.56, 0.64], filter: { tags: ['共鸣解放'] },
        target: 'self', duration: 480, trigger: { on: 'enemyState', where: { enemyState: 'shift' } },
      },
      {
        id: '永远的启明星.无视抗性', source: '附加震谐·偏移或聚爆效应时，共鸣解放伤害无视目标10%热熔抗性，持续8秒。',
        zone: 'RoleIgnoreResistance', value: [0.1, 0.15, 0.2, 0.25, 0.3], filter: { tags: ['共鸣解放'], elements: ['热熔'] },
        target: 'self', duration: 480, trigger: { on: 'enemyState', where: { enemyState: 'shift' } },
      },
    ],
  }),
  defineWeapon({
    name: '停驻之烟',                        // 琳奈（爱琳莫、爱琳守）
    passives: [
      { id: '停驻之烟.共鸣效率', source: '共鸣效率提升12.8%', zone: 'energyRegen', value: [0.128, 0.16, 0.192, 0.224, 0.256], target: 'self', duration: 'inf', trigger: 'always' },
      {
        id: '停驻之烟.攻击', source: '触发延奏后，当前变奏入场角色获得持续时间为14s的10%攻击提升buff',
        zone: 'atkPct', value: [0.1, 0.125, 0.15, 0.175, 0.2], target: 'nextIn', duration: 840, trigger: { on: 'outro' },
      },
    ],
  }),
  // 三火（嘉贝莉娜 · 达妮娅 · 露帕）的专武（2026-10-26，docs/tower-20261026.md；你说"都是 01"，按专武 1 精，待确认）
  defineWeapon({
    name: '赝作的矮星',                      // 达妮娅
    passives: [
      { id: '赝作的矮星.攻击', source: '攻击提升12%', zone: 'atkPct', value: [0.12, 0.15, 0.18, 0.21, 0.24], target: 'self', duration: 'inf', trigger: 'always' },
      {
        id: '赝作的矮星.解放', source: '附加聚爆效应或集谐·偏移时，共鸣解放伤害加成提升36%，持续5秒。',
        zone: 'DamageChangeType', value: [0.36, 0.45, 0.54, 0.63, 0.72], filter: { tags: ['共鸣解放'] }, target: 'self', duration: 300,
        trigger: { on: 'enemyState', where: { enemyState: 'effectApplied', effect: '聚爆效应' } },
      },
      {
        // "该角色"= 附加的人；队里只有达妮娅附加聚爆效应，按装备者自己算
        id: '赝作的矮星.队伍攻击', source: '队伍中的角色附加聚爆效应或集谐·偏移时，该角色攻击提升24%，持续15秒，同名效果之间不可叠加。',
        zone: 'atkPct', value: [0.24, 0.3, 0.36, 0.42, 0.48], target: 'self', duration: 900,
        trigger: { on: 'enemyState', where: { enemyState: 'effectApplied', effect: '聚爆效应' } },
      },
    ],
  }),
  defineWeapon({
    name: '焰痕',                            // 露帕
    passives: [
      { id: '焰痕.攻击', source: '攻击提升12%', zone: 'atkPct', value: [0.12, 0.15, 0.18, 0.21, 0.24], target: 'self', duration: 'inf', trigger: 'always' },
      {
        // "造成重击伤害后，延长大招伤害加成提升buff持续时间4秒"没写（buff 不能按事件延长，只少算延长的那几秒）
        id: '焰痕.大招', source: '施放大招或变奏后，获得持续时间为6秒的24%大招伤害加成提升buff。',
        zone: 'DamageChangeType', value: [0.24, 0.3, 0.36, 0.42, 0.48], filter: { tags: ['共鸣解放'] }, target: 'self', duration: 360,
        trigger: [{ on: 'actionStart', where: { actionKinds: ['liberation'] } }, { on: 'intro' }],
      },
      {
        id: '焰痕.热熔', source: '造成重击伤害后，全队获得持续时间为30秒的24%热熔伤害加成提升buff。',
        zone: 'DamageChangeElement', value: [0.24, 0.3, 0.36, 0.42, 0.48], filter: { elements: ['热熔'] }, target: 'team', duration: 1800,
        trigger: { on: 'judgmentSettle', where: { tags: ['重击'] } },
      },
    ],
  }),
  defineWeapon({
    name: '光影双生',                        // 嘉贝莉娜
    passives: [
      { id: '光影双生.攻击', source: '攻击提升12%', zone: 'atkPct', value: [0.12, 0.15, 0.18, 0.21, 0.24], target: 'self', duration: 'inf', trigger: 'always' },
      {
        id: '光影双生.重击加深', source: '造成声骸技能伤害时，重击伤害加深24%，持续6秒',
        zone: 'DamageAmplify0', value: [0.24, 0.3, 0.36, 0.42, 0.48], filter: { tags: ['重击'] }, target: 'self', duration: 360,
        trigger: { on: 'judgmentSettle', where: { tags: ['声骸技能'] } },
      },
      {
        id: '光影双生.声骸加深', source: '造成重击伤害时，声骸技能伤害加深24%，持续6秒',
        zone: 'DamageAmplify0', value: [0.24, 0.3, 0.36, 0.42, 0.48], filter: { tags: ['声骸技能'] }, target: 'self', duration: 360,
        trigger: { on: 'judgmentSettle', where: { tags: ['重击'] } },
      },
      {
        // "同时拥有以上两种加深效果时"：近似成"已有一种加深时又造成另一种伤害"，持续 6 秒（只看触发时有没有前一种，可能多算一点）
        id: '光影双生.无视防御', source: '同时拥有以上两种加深效果时，造成伤害时无视目标8%防御',
        zone: 'RoleIgnoreDefRate', value: [0.08, 0.1, 0.12, 0.14, 0.16], target: 'self', duration: 360,
        trigger: [
          { on: 'judgmentSettle', where: { tags: ['重击'], ownerHas: '光影双生.重击加深' } },
          { on: 'judgmentSettle', where: { tags: ['声骸技能'], ownerHas: '光影双生.声骸加深' } },
        ],
      },
    ],
  }),
]

/** 协奏按阶 8 / 10 / 12 / 14 / 16：xlsx 武器表只有 1 阶的文本"回复8点"（没有各阶数值），各阶按 nanoka 3.7（武器 21020024、21050024 的 param；华彩乐段 21030024 同一被动） */
function concertoOnSkill(weapon: string): ResourceEffectInput {
  return {
    id: `${weapon}.协奏`, source: '施放共鸣技能时，回复8点协奏能量，每20秒可触发1次。',
    resource: 'concerto', amount: [8, 10, 12, 14, 16], icd: 1200, trigger: { on: 'actionStart', where: { actionKinds: ['skill'] } },
  }
}
