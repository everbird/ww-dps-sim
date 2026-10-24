// data/curated/characters/守岸人.ts —— 角色模块（景燃 · 尤诺 · 守岸人 队伍，2026-10-24；待确认的条目见 docs/jys-confirm.md）
// 原文：nanoka 3.7 的技能说明与共鸣链、xlsx 守岸人块（20261019 版角色-女 R2230–R2282）的备注。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 星域阶段：0 没有星域、1 浅析、2 深潜、3 解限（星域里有人变奏升一阶，TD-08）。
 *  坍缩核：每得 1 段实论数据生成 1 枚，最多 5 枚；6 秒后、施放演绎（强化重击）时、或满 5 枚又得一枚时演化为耀星·蝶（见 evolve） */
const VARS = {
  星域: 0, 洞悉已用: false,
  核: 0, 核最早: 0,                          // 场上坍缩核几枚、最早那枚生成的战斗帧（6 秒后演化，计时用标记型 buff）
  星域治疗跳数: 0,
}
type Ctx = HookContext<typeof VARS>
const 演化帧 = 360                           // "在6秒后演化为耀星·蝶"
const STAGE_BUFFS = ['守岸人.深潜星域', '守岸人.解限星域'] as const
const FIELD = ['守岸人.星域', '守岸人.星域·1链'] as const

/** 坍缩核演化为耀星·蝶：每枚生成一次"A-耀星·蝶"判定（倍率 37.29%，"A"组的 5 只同倍率，取第 1 只）。
 *  飞行时间不建模，演化当帧出伤害 */
function evolve(ctx: Ctx, why: string): void {
  const n = ctx.vars.核
  if (n > 0) ctx.assume('module-guess', '守岸人：坍缩核按得实论数据计枚数，演化为耀星·蝶当帧出伤害（不算飞行时间）')
  for (let i = 0; i < n; i++) ctx.spawnJudgment(`A-耀星·蝶${i + 1}`, { action: 'A', note: why })
  ctx.vars.核 = 0
  ctx.removeBuff('守岸人.坍缩核计时')
}

/** 得到 k 段实论数据：生成 k 枚坍缩核；已满 5 枚时先让这 5 枚提前演化（"若场上坍缩核的数量已达到5枚，守岸人下一次普攻会催生坍缩核"） */
function addCores(ctx: Ctx, k: number): void {
  for (let i = 0; i < k; i++) {
    if (ctx.vars.核 >= 5) evolve(ctx, '满 5 枚后再得实论数据：提前演化')
    if (ctx.vars.核 === 0) {
      ctx.vars.核最早 = ctx.state.battleFrames
      ctx.addBuff('守岸人.坍缩核计时')
    }
    ctx.vars.核 += 1
  }
}

function endField(ctx: Ctx): void {
  for (const id of [...STAGE_BUFFS, '守岸人.自我引力', '守岸人.星域治疗计时', ...FIELD]) ctx.removeBuff(id)
  ctx.vars.星域 = 0
}

export default defineCharacter('守岸人', {
  weaponType: '音感仪',
  treeStats: { '治疗效果加成': 0.12, '生命%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: { E: 'E-地面', R: '大招', QTE: 'QTE', 演绎: '强化重击' },
  vars: VARS,
  buffs: [
    // 星域（共鸣解放）：从"大招-C0领域 / C1领域"那一段生成起算，30 秒，1 链 +10 秒（判定的持续帧也是 1800 / 2400）
    { id: '守岸人.星域', source: '共鸣解放：展开浅析星域……星域持续时间 30 秒', target: 'self', duration: 1800, trigger: 'hook' },
    { id: '守岸人.星域·1链', source: '共鸣链1：共鸣解放终末回环展开的星域……持续时间增加10秒', target: 'self', duration: 2400, trigger: 'hook', requires: { chain: 1 } },
    {
      // 深潜星域："守岸人自身每0.2%共鸣效率计算为0.01%暴击提升，上限12.5%"；共鸣效率含星域里固有2 的 +10%（offset）
      id: '守岸人.深潜星域', source: '深潜星域生效范围内附近队伍中所有角色暴击提升：守岸人自身每0.2%共鸣效率计算为0.01%暴击提升，上限12.5%。',
      zone: 'critRate', value: 0.0001, scale: { stat: 'energyRegen', per: 0.002, offset: 0.1, cap: 0.125 },
      target: 'team', duration: 2400, trigger: 'hook',
    },
    {
      id: '守岸人.解限星域', source: '解限星域生效范围内附近队伍中所有角色暴击伤害提升：守岸人自身每0.1%共鸣效率计算为0.01%暴击伤害提升，上限25%。',
      zone: 'critDamage', value: 0.0001, scale: { stat: 'energyRegen', per: 0.001, offset: 0.1, cap: 0.25 },
      target: 'team', duration: 2400, trigger: 'hook',
    },
    {
      id: '守岸人.自我引力', source: '固有技能·自我引力：队伍中登场角色处于星域生效范围内时，守岸人共鸣效率提升10%',
      zone: 'energyRegen', value: 0.1, target: 'self', duration: 2400, trigger: 'hook',
    },
    { id: '守岸人.坍缩核计时', source: '共鸣回路：坍缩核在6秒后演化为耀星·蝶', target: 'self', duration: 演化帧, trigger: 'hook' },
    { id: '守岸人.星域治疗计时', source: '浅析星域：持续为处于星域生效范围内的附近队伍中登场角色回复生命值，每3秒可触发1次', target: 'self', duration: 180, trigger: 'hook' },
    {
      id: '守岸人.延奏', source: '延奏技能·双联合相：……队伍中的角色全伤害加深15%。（最多存在30秒）',
      zone: 'DamageAmplify0', value: 0.15, target: 'team', duration: 1800, trigger: { on: 'outro' },   // 不带类别的"全伤害加深"= 0 类
    },
    {
      id: '守岸人.共鸣链2', source: '共鸣链2：浅析星域新增额外效果：附近队伍中的角色攻击提升40%。',
      zone: 'atkPct', value: 0.4, target: 'team', duration: 2400, trigger: 'hook', requires: { chain: 2 },
    },
  ],
  hooks: {
    introAction(ctx) {
      // 解限星域里变奏是洞悉（同一个解限星域只一次）
      return ctx.vars.星域 === 3 && !ctx.vars.洞悉已用 ? '强化QTE' : undefined
    },
    canStart(ctx, id) {
      const core = ctx.state.chars[ctx.self].core[0]!
      if (id === '强化重击' || id === '空中普攻-强化下落') return core >= 5 ? true : '实论数据不足 5 段'
      if (id === '重击' || id === '空中普攻') return core < 5 ? true : '实论数据满 5 段时是演绎 / 衍变'
      if (id === 'E') return '黯星·蝶并进了 E-地面 / E-空中：轴里写 E-地面'
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      // 实论数据 → 坍缩核（xlsx"A-坍缩核：获得核心能量时生成"）
      // 施放时给的记在 resource 事件里，命中时给的记在 hit 事件的 gains 里
      if (ev.type === 'resource' && ev.char === me && ev.resource === 'core1' && ev.delta > 0) { addCores(ctx, Math.round(ev.delta)); return }
      if (ev.type === 'hit' && ev.char === me && (ev.gains.core[0] ?? 0) > 0) addCores(ctx, Math.round(ev.gains.core[0]!))
      if (ev.type === 'buffExpire' && ev.target === me && ev.reason === 'timeout') {
        if (ev.buff === '守岸人.坍缩核计时') evolve(ctx, '坍缩核 6 秒后演化')
        if (ev.buff === '守岸人.星域治疗计时' && ctx.vars.星域 > 0) {
          ctx.heal('浅析星域')
          ctx.addBuff('守岸人.星域治疗计时')
        }
        if (ev.buff === '守岸人.星域' || ev.buff === '守岸人.星域·1链') endField(ctx)
        return
      }
      if (ev.type === 'actionStart' && ev.char === me) {
        if (ev.action === '强化重击' || ev.action === '空中普攻-强化下落') evolve(ctx, '演绎 / 衍变：所有坍缩核立即演化')
        if (ev.action === 'E-地面' || ev.action === 'E-空中') ctx.heal('共鸣技能·混沌理论')        // "第17F回血"，按起手记
        if (ev.action === 'QTE') ctx.heal('变奏技能·启迪')
        if (ev.action === '强化QTE') {
          ctx.heal('变奏技能·洞悉')
          ctx.vars.洞悉已用 = true
          if (ctx.chain < 1) endField(ctx)                       // "施放时对应星域状态结束"；1 链"施放变奏技能洞悉后不再结束星域"
        }
        return
      }
      // 星域在领域那一段生成时展开（再放大招时重新从浅析开始）
      if (ev.type === 'judgmentSpawn' && ev.char === me && (ev.judgment === '大招-C0领域' || ev.judgment === '大招-C1领域')) {
        endField(ctx)
        ctx.vars.星域 = 1
        ctx.vars.洞悉已用 = false
        ctx.addBuff(ctx.chain >= 1 ? '守岸人.星域·1链' : '守岸人.星域')
        ctx.addBuff('守岸人.自我引力')
        ctx.addBuff('守岸人.星域治疗计时')
        if (ctx.chain >= 2) ctx.addBuff('守岸人.共鸣链2')
        ctx.heal('浅析星域')
        return
      }
      // 星域里有人变奏：浅析 → 深潜 → 解限（假设打单体时全队都在星域范围内）
      if (ev.type === 'intro' && ctx.vars.星域 >= 1 && ctx.vars.星域 < 3) {
        ctx.assume('module-guess', '守岸人：星域里有人变奏就升一阶，打单体时全队都在星域范围内')
        ctx.vars.星域 += 1
        ctx.addBuff(ctx.vars.星域 === 2 ? '守岸人.深潜星域' : '守岸人.解限星域')
      }
    },
    modifyHit(ctx, hit) {
      // 洞悉"此次伤害为共鸣解放伤害，并且必定暴击"（xlsx"第216F内必暴"）
      if (hit.judgment.name.startsWith('强化QTE-')) hit.zones.critRate = (hit.zones.critRate ?? 0) + 1
    },
    forte(ctx) {
      return ['', '浅析星域', '深潜星域', '解限星域'][ctx.vars.星域]! + (ctx.vars.核 > 0 ? ` · 坍缩核 ${ctx.vars.核}` : '')
    },
  },
  actionOverrides: {
    // E-地面只有起手（"第17F回血"、协奏 20），五只黯星·蝶写在"E"组（"E（17F）脱手后自行生成"，帧从 E 起手算）
    // 黯星·蝶的「位置状态」是"空中"（飞行道具），守岸人在地面
    'E-地面': { absorb: ['E'], air: null, cooldown: 960, cooldownGroup: 'E', accept: ['priorityChangeGuess', 'priorityChangeMissing'] },
    'E-空中': { absorb: ['E'], cooldown: 960, cooldownGroup: 'E', accept: ['priorityChangeGuess', 'priorityChangeMissing'] },
    // 大招的领域、变奏的黯星·蝶「位置状态」写"空中"，是飞行道具 / 领域的位置，守岸人本人在地面
    大招: { air: null, cooldown: 1500 },
    QTE: { air: null, accept: ['priorityChangeGuess'] },
    // 洞悉"第142～172F触发上一角色延奏"：取最早的第 142 帧（全局时停在第 143 帧结束）
    强化QTE: { outroTriggerFrame: 142 },
    重击: { accept: ['priorityChangeGuess', 'airGuess'] },          // 化蝶（解限状态），轴里不用
    A: { kind: 'other', accept: ['noEnd', 'noPriority'] },
    // 并进了 E-地面 / E-空中，不单独施放（轴里写"E"会先找到这个组，所以要写 E-地面）
    E: { accept: ['noEnd', 'noPriority'] },        // 耀星·蝶：钩子在坍缩核演化时生成，不单独施放
    'A1-标签': { accept: ['noEnd'] },                            // A1 标签的额外实论数据不建模（见 jys-confirm）
    '延奏-受身前置': { accept: ['noEnd'] },
  },
})
