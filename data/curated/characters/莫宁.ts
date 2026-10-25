// data/curated/characters/莫宁.ts —— 角色模块（爱弥斯 · 琳奈 · 莫宁 队伍，2026-10-25；待确认的条目见 docs/alm-confirm.md）
// 原文：nanoka 3.7 的技能说明、xlsx 莫宁块（20261019 版 R4544–R4627）「特殊状态」「共鸣模态·莫宁」两行的备注。只写 0 链。
// 静质量能与相对动能共用核心资源 1（xlsx"静质量能=相对动能，上限100点"）：基准模式下 A、重击、闪避反击、最优求解给，满 100 时重击是
// 位势转换（强化重击）；广域观测模式（观测状态）下观测 A、分布式阵列（E2）给，满 100 时重击是反演（观测重击）。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 观测：广域观测模式（30 秒，切走、落地时结束）。观测标记至：目标身上的观测标记到哪个战斗帧（反演命中挂 30 秒）。
 *  场：0 没有、1 谐振场、2 强谐振场（各 25 秒，到时由 buff 到期结束） */
const VARS = { 观测: false, 观测标记至: -1, 场: 0 }
type Ctx = HookContext<typeof VARS>
const BASE = new Set(['A1', 'A2', 'A3', 'A4', '闪避反击', '重击', 'E1', 'E1-最优求解'])
const OBSERVE = new Set(['观测A1', '观测A2', '观测A2-闪避反击', '观测A3', 'E2'])
const 观测帧 = 1800                        // "广域观测模式持续30秒"

function enterObserve(ctx: Ctx, why: string, damage2: boolean): void {
  ctx.vars.观测 = true
  ctx.addBuff('莫宁.观测')
  // 进入广域观测模式时展开谐振场（"展开谐振场时，造成热熔伤害"：伤害1 五段；伤害2"非QTE期间在目标处生成"）
  ctx.spawnJudgment('谐振场-伤害1', { action: '谐振场', note: why })
  if (damage2) ctx.spawnJudgment('谐振场-伤害2', { action: '谐振场', note: why })
  ctx.removeBuff('莫宁.强谐振场')
  ctx.addBuff('莫宁.谐振场')
  ctx.vars.场 = 1
  ctx.heal('谐振场')
  ctx.addBuff('莫宁.谐振场治疗计时')
}

function leaveObserve(ctx: Ctx, why: string): void {
  if (!ctx.vars.观测) return
  ctx.vars.观测 = false
  ctx.removeBuff('莫宁.观测')
  // "状态持续时间自然结束时，清空特殊能量"；切走（"处于后台…移除该状态"）也按清空算
  const left = ctx.state.chars[ctx.self].core[0]!
  if (left > 0) ctx.addResource('core1', -left, ctx.self, why)
}

export default defineCharacter('莫宁', {
  weaponType: '长刃',
  treeStats: { '治疗效果加成': 0.12, '防御%': 0.152 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  // 构建出的槽：1"静能/动能"上限 10000（按百分数记的，实际 100）、2 与 3 都叫"核心能量3"（重名）
  coreNames: { 1: '质能', 2: '核心能量2' },
  coreCaps: { 1: 100 },
  aliases: { R: '大招', QTE: 'QTE', 位势转换: '强化重击', 反演: '观测重击', 分布式阵列: 'E2', 期望误差: 'E1' },
  vars: VARS,
  buffs: [
    { id: '莫宁.蓝图', source: '固有技能·蓝图：莫宁的共鸣效率提升10%。', zone: 'energyRegen', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' },
    { id: '莫宁.观测', source: '广域观测模式持续30秒。', target: 'self', duration: 观测帧, trigger: 'hook' },
    {
      id: '莫宁.谐振场', source: '谐振场持续25秒……谐振场生效范围内附近队伍中所有角色偏谐值累积效率提升50%。',
      zone: 'tunabilityRate', value: 0.5, target: 'team', duration: 1500, trigger: 'hook',
    },
    {
      // 强谐振场"继承谐振场的抗打断提升效果和偏谐值累积效率提升效果"：偏谐效率照旧 +50%，另加防御 20%
      id: '莫宁.强谐振场', source: '强谐振场持续25秒……附近队伍中所有角色防御提升20%……继承谐振场的偏谐值累积效率提升效果',
      zone: 'tunabilityRate', value: 0.5, target: 'team', duration: 1500, trigger: 'hook',
    },
    { id: '莫宁.强谐振场防御', source: '强谐振场生效范围内附近队伍中所有角色防御提升20%。', zone: 'defPct', value: 0.2, target: 'team', duration: 1500, trigger: 'hook' },
    { id: '莫宁.谐振场治疗计时', source: '谐振场：持续回复生效范围内附近队伍中登场角色的生命值，每3秒可触发1次', target: 'self', duration: 180, trigger: 'hook' },
    // 临界协议："每超过1%的共鸣效率使该技能造成伤害的暴击提升0.5%，上限80%，并使造成的暴击伤害提升1%，上限160%"
    {
      id: '莫宁.临界协议暴击', source: '莫宁自身共鸣效率大于100%时，每超过1%的共鸣效率使该技能造成伤害的暴击提升0.5%，上限80%',
      zone: 'critRate', value: 0.005, scale: { stat: 'energyRegen', per: 0.01, offset: -1, cap: 0.8 }, filter: { actions: ['大招'] },
      target: 'self', duration: 'inf', trigger: 'always',
    },
    {
      id: '莫宁.临界协议暴伤', source: '……并使造成的暴击伤害提升1%，上限160%。',
      zone: 'critDamage', value: 0.01, scale: { stat: 'energyRegen', per: 0.01, offset: -1, cap: 1.6 }, filter: { actions: ['大招'] },
      target: 'self', duration: 'inf', trigger: 'always',
    },
    {
      // 干涉标记："若目标处于【震谐·干涉】或【集谐·干涉】状态，则附近队伍中所有角色对其造成的伤害提升…上限40%"（xlsx"伤害加成"，8 秒）。
      // 观测标记的目标进入干涉时挂上（与干涉同时开始、同样 8 秒）
      id: '莫宁.干涉标记', source: '干涉标记：若目标处于【震谐·干涉】……附近队伍中所有角色对其造成的伤害提升：莫宁自身共鸣效率大于100%时，每超过1%的共鸣效率计算为0.25%的伤害提升，上限40%。',
      zone: 'DamageChange', value: 0.0025, scale: { stat: 'energyRegen', per: 0.01, offset: -1, cap: 0.4 },
      target: 'team', duration: 480, trigger: 'hook',
    },
    {
      id: '莫宁.延奏', source: '延奏技能·递归：队伍中的角色全伤害加深25%，持续30秒。',
      zone: 'DamageAmplify0', value: 0.25, target: 'team', duration: 1800, trigger: { on: 'outro' },
    },
  ],
  resourceEffects: [
    { id: '莫宁.蓝图·变奏', source: '施放变奏技能·归敛时，回复自身20点协奏能量，每20秒可触发1次。', resource: 'concerto', amount: 20, icd: 1200, trigger: { on: 'actionStart', where: { actions: ['QTE'] } } },
    { id: '莫宁.蓝图·观测A3', source: '施放普攻·广域观测模式第3段时，回复自身20点协奏能量，每20秒可触发1次。', resource: 'concerto', amount: 20, icd: 1200, trigger: { on: 'actionStart', where: { actions: ['观测A3'] } } },
  ],
  hooks: {
    canStart(ctx, id) {
      const v = ctx.vars
      const core = ctx.state.chars[ctx.self].core[0]!
      if (BASE.has(id) && v.观测) return '广域观测模式里用观测普攻、分布式阵列（E2）'
      if (OBSERVE.has(id) && !v.观测) return '基准模式：不在广域观测模式'
      if (id === '重击' && core >= 100) return '静质量能满 100 时重击是位势转换（强化重击）'
      if (id === '强化重击') return v.观测 ? '广域观测模式里满 100 是反演（观测重击）' : core >= 100 ? true : `静质量能 ${Math.floor(core)} / 100`
      if (id === '观测重击') return v.观测 && core >= 100 ? true : `相对动能 ${Math.floor(core)} / 100`
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      const v = ctx.vars
      if (ev.type === 'actionStart' && ev.char === me) {
        // 位势转换"第48F获得30秒观测状态"、变奏"第69F获得30秒观测状态"：按起手算（之后的动作都在这几帧之后）
        if (ev.action === '强化重击') { ctx.assume('module-guess', '莫宁：位势转换 / 变奏进入观测按起手算'); enterObserve(ctx, '位势转换', true) }
        if (ev.action === 'QTE') { ctx.assume('module-guess', '莫宁：位势转换 / 变奏进入观测按起手算'); enterObserve(ctx, '变奏·归敛', false) }
        if (ev.action === 'E1' || ev.action === 'E2') ctx.heal(ev.action === 'E1' ? '期望误差' : '分布式阵列')
        // 观测 A1、A2 的相对动能数据只在起手给一次（2.5、3），按每下都给补足（A1 4 下 = 10、A2 4 下 = 12；3A + 分布式阵列正好 100）
        if (ev.action === '观测A1' || ev.action === '观测A2') {
          ctx.assume('module-guess', '莫宁：观测 A1、A2 的相对动能按每下都给（数据只写在起手）')
          ctx.addResource('core1', ev.action === '观测A1' ? 7.5 : 9, ctx.self, '观测普攻每下都给相对动能')
        }
        if (ev.action === '大招') {
          // 大招两行伤害：常态（第 272 帧）与观测状态（第 277 帧），只出一行
          ctx.skipJudgments(ev.instance, [v.观测 ? '大招-伤害' : '大招-伤害#2'])
          // "施放该技能时，若已存在谐振场，随后将其摧毁并展开强谐振场"（xlsx 第265F；按起手算）
          if (v.场 >= 1) {
            ctx.removeBuff('莫宁.谐振场')
            ctx.addBuff('莫宁.强谐振场')
            ctx.addBuff('莫宁.强谐振场防御')
            v.场 = 2
          }
        }
        return
      }
      if (ev.type === 'hit' && ev.char === me && ev.judgment === '观测重击') {
        v.观测标记至 = ctx.state.battleFrames + 1800                 // "命中目标将为其附加观测标记，持续30秒"
        return
      }
      // 观测标记的目标进入干涉：挂干涉标记（"队伍中的角色对拥有观测标记的目标造成【谐度破坏】伤害后"）
      if (ev.type === 'enemyState' && ev.change === 'interference' && ctx.state.battleFrames < v.观测标记至) {
        ctx.addBuff('莫宁.干涉标记')
        return
      }
      if (ev.type === 'switch' && ev.from === me) { leaveObserve(ctx, '切走，退出广域观测模式'); return }
      if (ev.type === 'buffExpire' && ev.target === me && ev.reason === 'timeout') {
        if (ev.buff === '莫宁.观测') leaveObserve(ctx, '广域观测模式到时')
        if (ev.buff === '莫宁.谐振场' || ev.buff === '莫宁.强谐振场') { v.场 = 0; ctx.removeBuff('莫宁.谐振场治疗计时') }
        if (ev.buff === '莫宁.谐振场治疗计时' && v.场 > 0) { ctx.heal('谐振场'); ctx.addBuff('莫宁.谐振场治疗计时') }
      }
    },
    forte(ctx) {
      const v = ctx.vars
      return [v.观测 ? '广域观测模式' : '基准模式', ['', '谐振场', '强谐振场'][v.场]!].filter(Boolean).join(' · ')
    },
  },
  actionOverrides: {
    E1: { cooldown: 300, accept: ['dilationStartGuess'] },          // 期望误差 5 秒（nanoka）
    E2: { cooldown: 960 },                                          // 分布式阵列 16 秒
    大招: { cooldown: 1500, accept: ['multiEnd'] },
    闪避反击: { accept: ['priorityChangeGuess'] },
    '观测A2-闪避反击': { accept: ['priorityChangeGuess', 'priorityChangeMissing'] },
    空中攻击: { accept: ['multiEnd'] },
    // 谐振场：伤害、治疗由钩子在进入观测时生成，不单独施放
    谐振场: { kind: 'other', accept: ['noEnd', 'kindGuess', 'ticksGuess', 'persistsGuess'] },
    观测闪避: { accept: ['dirVariant'] },
    观测极限闪避: { accept: ['dirVariant'] },
    特殊状态: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    '共鸣模态·莫宁': { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    震谐响应: { kind: 'other', accept: ['noEnd', 'kindGuess'] },
  },
})
