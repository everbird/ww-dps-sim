// data/curated/characters/维里奈.ts —— 角色模块（M0 只填 xlsx 没有的信息；buff 与钩子在 M2 / M3 按 TD-07 / TD-08 补）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('维里奈', {
  weaponType: '音感仪',
  treeStats: { '治疗效果加成': 0.12, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: { E: 'E', R: '大招', QTE: 'QTE' },
  buffs: [
    {
      // 大招命中给目标附加光合标记，12 秒（nanoka 3.7，m0-confirm §6 V3）
      id: '维里奈.光合标记', source: '共鸣解放：命中目标时给目标附加光合标记（光合标记持续时间 12 秒）',
      target: 'enemy', duration: 720, trigger: { on: 'judgmentSettle', where: { judgments: ['大招-标记'] } },
    },
    {
      // "重击星星花绽放"= 强化重击（动作组"重击"）；"空中攻击星星花绽放"= 强化空中A1–A3（nanoka 3.7 三段倍率与之一致，TD-07 Q9）
      id: '维里奈.固有1',
      source: '固有技能1：施放重击星星花绽放、空中攻击星星花绽放、共鸣解放草木生长或延奏技能盛放时，队伍中的角色攻击提升20%，持续20秒。',
      zone: 'atkPct', value: 0.2, target: 'team', duration: 1200,
      trigger: [{ on: 'actionStart', where: { actions: ['重击', '强化空中A1', '强化空中A2', '强化空中A3', '大招'] } }, { on: 'outro' }],
    },
    {
      id: '维里奈.延奏',
      source: '延奏：持续为下一位登场角色回复生命值……附近队伍中所有角色全伤害加深15%，持续30秒。（治疗不建模）',
      zone: 'DamageAmplify0', value: 0.15, target: 'team', duration: 1800,   // 不带类别的"全伤害加深"= 0 类（TD-03 §2）
      trigger: { on: 'outro' },
    },
  ],
  resourceEffects: [
    {
      id: '维里奈.共鸣链2.光合能量', source: '共鸣链2：施放共鸣技能扩繁试验时，额外获得1点【光合能量】和10点协奏能量。',
      resource: 'core1', amount: 1, requires: { chain: 2 }, trigger: { on: 'actionStart', where: { actions: ['E'] } },
    },
    {
      id: '维里奈.共鸣链2.协奏', source: '共鸣链2：施放共鸣技能扩繁试验时，额外获得1点【光合能量】和10点协奏能量。',
      resource: 'concerto', amount: 10, requires: { chain: 2 }, trigger: { on: 'actionStart', where: { actions: ['E'] } },
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const e = ctx.state.chars[ctx.self].core[0]                              // 光合能量
      if (id === '重击') return e >= 1 ? true : '强化重击要光合能量'
      if (id === '重击-冲') return e < 1 ? true : '有光合能量时重击是强化重击（动作"重击"）'
      return true
    },
    // 协同攻击（m0-confirm §6 V4）：任何人（含维里奈自己）的伤害命中带光合标记的目标时触发，全队共用 1 秒冷却；协同本身不再触发
    onEvent(ctx, ev) {
      if (ev.type !== 'hit' || ev.dmg === null || ev.judgment === '大招-协同伤害') return
      if (ctx.buffStacks('维里奈.光合标记', 'enemy') === 0) return
      const last = ctx.getFlag('协同上次')
      const now = ctx.state.battleFrames
      if (typeof last === 'number' && now - last < 60) return
      ctx.setFlag('协同上次', now)
      ctx.spawnJudgment('大招-协同伤害', { action: '大招' })
    },
  },
  actionOverrides: {
    // A3 的三行是同一段普攻的互斥情形（倍率相同）；打单体默认目标在 3m 内，另两行去掉，否则会算三次伤害（m0-confirm 2.1）
    A3: { dropRows: ['A3-无目标/3m外', 'A3-地面出场技'] },
    // 强化重击的两行是两种起手，不是先后两段：一次强化重击只消耗 1 层光合能量、回 12 协奏（nanoka 3.7）。
    // 两行都算会变成 +24 / −2；先留与普通重击同样第 24 帧冲出的"强化冲"（连冲何时出现待查，m0-confirm §6 V2）
    重击: { dropRows: ['重击-强化连冲'], followUp: { after: '重击-强化冲', action: '重击-强化撞1' } },
    '重击-冲': { followUp: { after: '重击-冲', action: '重击-撞' } },
    QTE: { followUp: { after: 'QTE-冲', action: 'QTE-撞' } },                // 冲刺总能撞到（m0-confirm §6 V1）
    // 协同攻击不随大招自动出，由钩子在命中带光合标记的目标时生成（TD-08 P9）
    大招: { cooldown: 1500, judgments: { '大招-协同伤害': { spawnFrame: null } } },
    E: { cooldown: 720 },                  // 共鸣技能冷却 12 秒，不是按次数充能（2026-09-27 用户提供）

  },
})
