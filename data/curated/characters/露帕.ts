// data/curated/characters/露帕.ts —— 露帕（5 星，热熔，长刃）。格式以 TD-08 为准
// 原文：nanoka 3.7 的技能说明，xlsx 露帕块（20261019 版）各行备注与「追猎状态」「荣光状态」两行。确认清单见 docs/tower-20261026.md。
// 只写到 0 链。核心资源槽 1 狼焰（上限 100）；狼魂（上限 2，10 秒）记在状态量里。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 追猎、荣光 35 秒；赛点沸腾 12 秒；狼魂 10 秒；围猎后 8 秒内能放凶噬（标记也是 8 秒）；狼舞的决意后 8 秒内监听队友大招 */
const 追猎帧 = 2100
const 狼魂帧 = 600
const 窗口帧 = 480
const SLOTS = [0, 1, 2] as const
/** 消耗 50 狼焰、得 1 点狼魂的三招：狼咬、锐爪、焰袭 */
const SOUL = new Set(['强化重击1', '强化重击2', '空中A3-强化下落'])

const VARS = {
  狼魂: 0,
  围猎至: -1,               // 围猎后能接凶噬到这一帧
  标记至: -1,               // 围猎给目标的标记到这一帧
  破敌至: -1,               // 大招第 120 帧起 4 秒内能放破敌（"第120F解锁E3-破敌，持续4秒"）
  监听至: -1,               // 狼舞的决意后 8 秒内监听队友施放大招
  延燃已出: false,
  追杀: false,              // 追猎满 3 层：下一次变奏是你无法逃离！（同一个追猎只进一次）
  追猎层冷却至: -1,         // 追猎每次加层冷却 0.2 秒
}
type Ctx = HookContext<typeof VARS>
const me = (ctx: Ctx): string => ctx.state.chars[ctx.self].name
const 狼焰 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[0]!
const now = (ctx: Ctx): number => ctx.state.battleFrames
const boiling = (ctx: Ctx): boolean => ctx.buffStacks('露帕.赛点沸腾') > 0

function gainSoul(ctx: Ctx): void {
  ctx.vars.狼魂 = Math.min(2, ctx.vars.狼魂 + 1)
  ctx.removeBuff('露帕.狼魂计时')
  ctx.addBuff('露帕.狼魂计时')
}
function clearHunt(ctx: Ctx): void {
  for (const t of SLOTS) for (const id of ['露帕.追猎', '露帕.追猎·热熔', '露帕.荣光']) ctx.removeBuff(id, t)
  ctx.vars.追杀 = false
}

export default defineCharacter('露帕', {
  weaponType: '长刃',
  treeStats: { '暴击率': 0.08, '攻击%': 0.12 },      // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '狼焰' },
  coreCaps: { 1: 100 },                                // 主表写 10000（按百分数记的）
  aliases: {
    E: 'E1', R: '大招', QTE: 'QTE',
    围猎: 'E1', 凶噬: 'E2', 破敌: 'E3', 狼舞: 'E4', 狼舞极: 'E4-狼舞的决意·极', 狼咬: '强化重击1', 锐爪: '强化重击2', 焰袭: '空中A3-强化下落',
    你无法逃离: '强化QTE',
  },
  vars: VARS,
  buffs: [
    {
      id: '露帕.燃旗', source: '燃旗：施放共鸣技能凶噬期间、重击·狼咬 / 锐爪或空中攻击·焰袭期间、共鸣解放期间、狼舞的决意期间，攻击提升12%，持续8秒。',
      zone: 'atkPct', value: 0.12, target: 'self', duration: 480,
      trigger: { on: 'actionStart', where: { actions: ['E2', '强化重击1', '强化重击2', '空中A3-强化下落', '大招', 'E4', 'E4-狼舞的决意·极'] } },
    },
    { id: '露帕.赛点沸腾', source: '赛点沸腾：常态攻击命中时获取【狼焰】效率提升500%，且无法施放共鸣技能围猎、共鸣技能凶噬。（12 秒）', target: 'self', duration: 720, trigger: 'hook' },
    { id: '露帕.狼魂计时', source: '【狼魂】持续10秒，重复获得时刷新时间，持续时间结束后，每点未消耗的【狼魂】返还50点【狼焰】。', target: 'self', duration: 狼魂帧, trigger: 'hook' },
    {
      // 追猎：施放大招时全队 1 层（攻击 +6%），之后登场角色每次变奏 +1 层，上限 3 层（18%）；按 nanoka"额外增加6%，上限为18%"读
      id: '露帕.追猎', source: '追猎：持有追猎的角色攻击提升6%……队伍中登场角色施放变奏技能时，会强化追猎效果，队伍中的角色追猎的攻击提升效果额外增加6%，上限为18%。',
      zone: 'atkPct', value: 0.06, maxStacks: 3, target: 'team', duration: 追猎帧, trigger: 'hook',
    },
    {
      // 攻击怒涛级或海啸级目标时（深塔的 boss 都是）；队里 3 名热熔额外 +10%
      id: '露帕.追猎·热熔', source: '追猎：攻击怒涛级或海啸级目标时热熔伤害加成提升10%，无法叠加。若队伍中的热熔属性角色达到3名时，攻击怒涛级或海啸级目标时的热熔伤害加成效果额外增加10%。',
      zone: 'DamageChangeElement', value: 0.2, filter: { elements: ['热熔'] }, target: 'team', duration: 追猎帧, trigger: 'hook',
    },
    {
      id: '露帕.荣光', source: '固有2·荣光：队伍中的角色攻击时无视3%热熔抗性，每有一名除露帕外的热熔属性角色增加3%，上限9%；队伍中的热熔属性角色达到3名时，额外增加6%。',
      zone: 'RoleIgnoreResistance', value: 0.15, filter: { elements: ['热熔'] }, target: 'team', duration: 追猎帧, trigger: 'hook',
    },
    {
      id: '露帕.延奏·热熔', source: '延奏技能：下一位登场角色热熔伤害加深20%，普攻伤害加深25%，效果持续14秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.2, filter: { elements: ['热熔'] }, target: 'nextIn', duration: 840, onSwitchOut: 'clear', trigger: { on: 'outro' },
    },
    {
      id: '露帕.延奏·普攻', source: '延奏技能：下一位登场角色热熔伤害加深20%，普攻伤害加深25%，效果持续14秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.25, filter: { tags: ['普攻'] }, target: 'nextIn', duration: 840, onSwitchOut: 'clear', trigger: { on: 'outro' },
    },
  ],
  hooks: {
    introAction(ctx) { return ctx.vars.追杀 ? '强化QTE' : 'QTE' },
    canStart(ctx, id) {
      const v = ctx.vars
      const full = 狼焰(ctx) >= 50
      switch (id) {
        case '重击': return full ? '狼焰满 50，重击是狼咬 / 锐爪' : true
        case '强化重击1': return !full ? `狼咬要狼焰 50（${Math.floor(狼焰(ctx))}）` : v.狼魂 === 1 ? '有 1 点狼魂，重击是锐爪' : true
        case '强化重击2': return !full ? `锐爪要狼焰 50（${Math.floor(狼焰(ctx))}）` : v.狼魂 === 1 ? true : `锐爪要 1 点狼魂（${v.狼魂}）`
        case '空中A3': return full ? '狼焰满 50，空中攻击第 3 段是焰袭' : true
        case '空中A3-强化下落': return full ? true : `焰袭要狼焰 50（${Math.floor(狼焰(ctx))}）`
        case 'E1':
          if (boiling(ctx)) return '赛点沸腾里不能放围猎'
          return v.狼魂 >= 2 ? '有 2 点狼魂，共鸣技能是狼舞的决意' : true
        case 'E2':
          if (boiling(ctx)) return '赛点沸腾里不能放凶噬'
          return now(ctx) < v.围猎至 ? true : '凶噬要在围猎后 8 秒内'
        case 'E3': return now(ctx) < v.破敌至 ? true : '破敌要在大招后 4 秒内'
        case 'E4': return v.狼魂 >= 2 && !boiling(ctx) ? true : `狼舞的决意要 2 点狼魂、不在赛点沸腾（狼魂 ${v.狼魂}）`
        case 'E4-狼舞的决意·极': return v.狼魂 >= 2 && boiling(ctx) ? true : '狼舞的决意·极要 2 点狼魂、在赛点沸腾里'
      }
      return true
    },
    onEvent(ctx, ev) {
      const v = ctx.vars
      const self = me(ctx)
      switch (ev.type) {
        case 'actionStart': {
          if (ev.char !== self) {
            // 狼舞的决意 8 秒内切走：队友施放共鸣解放时，露帕协助攻击一次（延燃，最多 1 次）
            if (/大招$/.test(ev.action) && now(ctx) < v.监听至 && !v.延燃已出 && ctx.state.onField !== ctx.self) {
              v.延燃已出 = true
              ctx.spawnJudgment('延燃-下落', { action: '延燃', note: '狼舞的决意后队友施放共鸣解放' })
              ctx.spawnJudgment('延燃-落地', { action: '延燃', note: '狼舞的决意后队友施放共鸣解放' })
            }
            return
          }
          if (SOUL.has(ev.action)) {
            ctx.addResource('core1', -50, ctx.self, `${ev.action}消耗 50 点狼焰`)
            gainSoul(ctx)
            return
          }
          switch (ev.action) {
            case 'E1': v.围猎至 = now(ctx) + 窗口帧; v.标记至 = now(ctx) + 窗口帧; return
            case 'E2':
              v.围猎至 = -1
              ctx.skipJudgments(ev.instance, [now(ctx) < v.标记至 ? 'E2-无标记伤害' : 'E2-对标记伤害'])
              return
            case '大招':
              v.破敌至 = now(ctx) + 120 + 240
              v.狼魂 = 0                                         // 第 31 帧清空狼魂（按起手算）
              ctx.removeBuff('露帕.狼魂计时')
              clearHunt(ctx)
              ctx.addBuff('露帕.追猎')                            // 第 161 帧获得追猎、荣光（按起手算）
              ctx.addBuff('露帕.追猎·热熔')
              ctx.addBuff('露帕.荣光')
              ctx.assume('module-guess', '露帕：追猎施放大招时全队 1 层，每次变奏 +1 层；追猎·热熔、荣光按队里 3 名热熔、目标是怒涛 / 海啸级算')
              return
            case 'E3': v.破敌至 = -1; ctx.addBuff('露帕.赛点沸腾'); return
            case 'E4': case 'E4-狼舞的决意·极':
              v.狼魂 = 0
              ctx.removeBuff('露帕.狼魂计时')
              v.监听至 = now(ctx) + 窗口帧
              v.延燃已出 = false
              if (ev.action !== 'E4') ctx.removeBuff('露帕.赛点沸腾')
              return
            case '强化QTE': clearHunt(ctx); return              // 第 1 帧解除追猎、荣光
          }
          return
        }
        case 'intro': {
          // 登场角色施放变奏：追猎 +1 层（冷却 0.2 秒），满 3 层进追杀
          if (ctx.buffStacks('露帕.追猎') === 0 || now(ctx) < v.追猎层冷却至) return
          v.追猎层冷却至 = now(ctx) + 12
          ctx.addBuff('露帕.追猎')
          if (ctx.buffStacks('露帕.追猎') >= 3) v.追杀 = true
          return
        }
        case 'hit':
          // 赛点沸腾：常态攻击命中时狼焰获取 ×6（数据给的那份之外再加 5 倍）
          if (ev.char === self && boiling(ctx) && ev.gains.core[0]! > 0 && (ev.tags.includes('普攻') || ev.tags.includes('重击')))
            ctx.addResource('core1', 5 * ev.gains.core[0]!, ctx.self, '赛点沸腾：狼焰获取效率提升500%')
          return
        case 'buffExpire':
          if (ev.target === self && ev.buff === '露帕.狼魂计时' && ev.reason === 'timeout' && v.狼魂 > 0) {
            ctx.addResource('core1', 50 * v.狼魂, ctx.self, '狼魂到时，每点返还 50 点狼焰')
            v.狼魂 = 0
          }
          return
      }
    },
    forte(ctx) {
      const v = ctx.vars
      const parts = [`狼魂 ${v.狼魂}`]
      if (boiling(ctx)) parts.push('赛点沸腾')
      const hunt = ctx.buffStacks('露帕.追猎')
      if (hunt > 0) parts.push(`追猎 ${hunt} 层`)
      if (v.追杀) parts.push('追杀')
      if (ctx.state.battleFrames < v.围猎至) parts.push('可凶噬')
      if (ctx.state.battleFrames < v.破敌至) parts.push('可破敌')
      return parts.join(' · ')
    },
  },
  actionOverrides: {
    E1: { cooldown: 720 },                                    // 围猎冷却 12 秒（nanoka 3.7）
    E2: { dropRows: ['E2-C6回能'] },                          // 6 链才有
    大招: { cooldown: 1200 },                                 // 冷却 20 秒
    // 落地段的帧从落地算（landingUnshifted）：落地时刻取下落行的结束帧
    空中A3: { shiftRows: { '空中A3-落地': 38 } },
    '空中A3-强化下落': { shiftRows: { '空中A3-强化落地': 38 } },
    空中长按: { shiftRows: { '空中长按-落地1': 30, '空中长按-落地2': 30 } },
    // 延燃由钩子生成（狼舞的决意后队友施放大招），不单独施放；聚怪那一行没有伤害
    延燃: { kind: 'other', shiftRows: { '延燃-落地': 64, '延燃-落地聚怪': 64 }, accept: ['noEnd', 'ticksCapped'] },
    燃旗: { accept: ['noEnd', 'noPriority', 'kindGuess'] },   // 以下是状态的说明行，不是动作（燃旗、追猎、荣光写成 buff）
    强制受身: { accept: ['noEnd', 'kindGuess'] },
    追猎状态: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    荣光状态: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
  },
})
