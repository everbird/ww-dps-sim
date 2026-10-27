// data/curated/characters/达妮娅.ts —— 达妮娅（5 星，热熔，音感仪）。格式以 TD-08 为准
// 原文：nanoka 3.7 的技能说明，xlsx 达妮娅块（20261019 版）「特殊能量」「共鸣模态」两行的备注。确认清单见 docs/tower-20261026.md。
// 只写共鸣模态·聚爆（2026-10-26 用户说明：深塔 41 期中 1、中 2 用的是聚爆）；集谐没写。只写到 0 链。
// 两种形态：布景之形（动作 ID 带"白"）与幻灭之形（带"黑"）。白大招后切到幻灭，黑大招后切回布景。
// 核心资源：槽 1 虚质粒子、槽 2 共形能量（动作表的列）、槽 3 黯核（上限 3）。主表的槽名是"虚质粒子、黯核、共形能量"，和动作表的列对不上（黑A 加的是
// 第 2 列、数值是共形能量的；黑大招第 2 列 −100 是"清空共形能量"），按动作表改名。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 熵变强化·幻灭之形 12.1 秒、熵变强化·布景之形 30.1 秒（xlsx 特殊能量） */
const 幻灭帧 = 726
const 布景帧 = 1806
/** 蚀域存在 30 秒；黑大招第 157 帧第一次出伤害（xlsx 蚀域-伤害），之后每 240 帧一次（"每4秒发动1次攻击"） */
const 蚀域帧 = 1800
const 黯核上限 = 3
/** 聚爆模态：这些技能造成伤害时为目标附加聚爆效应（几层），同一技能对同一目标 2 秒内只触发 1 次（xlsx 共鸣模态） */
type CdKey = '冷却白QTE' | '冷却黑QTE' | '冷却白大招' | '冷却黑大招' | '冷却蚀域' | '冷却白A3' | '冷却白A4' | '冷却黑A3' | '冷却黑A4'
const IMPLODE: Record<string, { key: CdKey; stacks: number }> = {
  白QTE: { key: '冷却白QTE', stacks: 2 }, 黑QTE: { key: '冷却黑QTE', stacks: 2 },
  白大招: { key: '冷却白大招', stacks: 2 }, 黑大招: { key: '冷却黑大招', stacks: 2 }, 蚀域: { key: '冷却蚀域', stacks: 2 },
  白A3: { key: '冷却白A3', stacks: 1 }, 白A4: { key: '冷却白A4', stacks: 1 },
  黑A3: { key: '冷却黑A3', stacks: 1 }, 强化黑A3: { key: '冷却黑A3', stacks: 1 },
  黑A4: { key: '冷却黑A4', stacks: 1 }, 强化黑A4: { key: '冷却黑A4', stacks: 1 }, '黑A4-1': { key: '冷却黑A4', stacks: 1 },
}
const IMPLODE_CD = 120
/** 幻灭之形有虚质粒子时，常态攻击按强化版算（"使本次技能获得以下效果：伤害为共鸣解放伤害，且伤害倍率提升50%；共形能量获取效率提升100%"）。
 *  强化黑A 与黑A 的帧数一样（xlsx），所以轴里一律写黑A，钩子按下面这张表（xlsx 强化黑* 各行的倍率、消耗的虚质粒子）换倍率、标签与资源 */
const ENHANCED: Record<string, { mult: number; cost: number }> = {
  黑A1: { mult: 0.5476, cost: 18 }, '黑A2-1': { mult: 0.5626, cost: 18 }, '黑A2-2': { mult: 0.211, cost: 7 }, 黑A3: { mult: 0.9358, cost: 30 },
  '黑A3-D': { mult: 1.6211, cost: 52 }, '黑A4-1': { mult: 0.5331, cost: 18 }, '黑A4-2': { mult: 1.2438, cost: 40 }, 黑重击: { mult: 2.0559, cost: 66 },
  '黑空中重击-下落': { mult: 0.4438, cost: 15 }, '黑空中重击-落地': { mult: 0.6657, cost: 22 },
}

const VARS = {
  幻灭: false,              // 现在是幻灭之形（否则布景之形）
  放逐黯核: 0,              // 这一次放逐第二段消耗了几枚黯核（倍率 ×(1 + 1.5 × 枚数)）
  强化本下: false,          // modifyHit 判定这一下按强化算，hit 事件里扣虚质粒子、补共形能量
  蚀域至: -1,               // 蚀域消失的战斗帧；-1 = 没有
  冷却白QTE: -1, 冷却黑QTE: -1, 冷却白大招: -1, 冷却黑大招: -1, 冷却蚀域: -1,
  冷却白A3: -1, 冷却白A4: -1, 冷却黑A3: -1, 冷却黑A4: -1,
}
type Ctx = HookContext<typeof VARS>
const me = (ctx: Ctx): string => ctx.state.chars[ctx.self].name
const 虚质 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[0]!
const 共形 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[1]!
const SLOTS = [0, 1, 2] as const

/** 熵变强化（两种互斥）：获得一种时移除另一种；固有2 蚀刻繁彩（聚爆）跟着熵变走，给全队热熔 +30% */
function entropy(ctx: Ctx, kind: '幻灭' | '布景'): void {
  const other = kind === '幻灭' ? '布景' : '幻灭'
  ctx.removeBuff(`达妮娅.熵变·${other}`)
  for (const t of SLOTS) ctx.removeBuff(`达妮娅.蚀刻繁彩·${other}`, t)
  ctx.addBuff(`达妮娅.熵变·${kind}`)
  ctx.addBuff(`达妮娅.蚀刻繁彩·${kind}`)
  if (kind === '布景') { ctx.removeBuff('达妮娅.虚质计时'); ctx.addBuff('达妮娅.虚质计时') }
  if (ctx.buffStacks('达妮娅.黯核计时') === 0) ctx.addBuff('达妮娅.黯核计时')
}
const inEntropy = (ctx: Ctx): boolean => ctx.buffStacks('达妮娅.熵变·幻灭') + ctx.buffStacks('达妮娅.熵变·布景') > 0
const 黯核 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[2]!
function addCore(ctx: Ctx, n: number, why: string): void { ctx.addResource('core3', Math.min(n, 黯核上限 - 黯核(ctx)), ctx.self, why) }

/** 生成蚀域（黑大招）：已有的销毁，30 秒；第一次出伤害等"蚀域首次"计时到，之后每 4 秒 */
function erode(ctx: Ctx): void {
  ctx.vars.蚀域至 = ctx.state.battleFrames + 145 + 蚀域帧
  ctx.removeBuff('达妮娅.蚀域计时')
  ctx.removeBuff('达妮娅.蚀域首次')
  ctx.addBuff('达妮娅.蚀域首次')
}

export default defineCharacter('达妮娅', {
  weaponType: '音感仪',
  treeStats: { '暴击伤害': 0.16, '攻击%': 0.12 },     // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '虚质粒子', 2: '共形能量', 3: '黯核' },
  coreCaps: { 1: 100, 2: 100, 3: 3 },
  aliases: {
    E: '白E', R: '白大招', QTE: '白QTE',
    拟态泡泡: '白E', 轻唤: '黑E', 放逐: '黑强化E1', 放逐2: '黑强化E2', 白R: '白大招', 黑R: '黑大招',
  },
  vars: VARS,
  buffs: [
    {
      id: '达妮娅.熵变·幻灭', source: '熵变强化·幻灭之形：攻击提升30%。获得该效果时，移除熵变强化·布景之形。（持续12.1秒，xlsx 特殊能量）',
      zone: 'atkPct', value: 0.3, target: 'self', duration: 幻灭帧, trigger: 'hook',
    },
    { id: '达妮娅.熵变·布景', source: '熵变强化·布景之形：每秒获得1点【虚质粒子】。获得该效果时，移除熵变强化·幻灭之形。（持续30.1秒）', target: 'self', duration: 布景帧, trigger: 'hook' },
    { id: '达妮娅.虚质计时', source: '熵变强化·布景之形：每秒获得1点【虚质粒子】（钩子每 60 帧加一次）', target: 'self', duration: 60, trigger: 'hook' },
    { id: '达妮娅.黯核计时', source: '【黯核】获取规则：处于熵变强化时，每12秒获得1枚【黯核】', target: 'self', duration: 720, trigger: 'hook' },
    {
      id: '达妮娅.蚀刻繁彩·幻灭', source: '固有技能·蚀刻繁彩：处于熵变强化时，若处于共鸣模态·聚爆，队伍中的角色热熔伤害加成提升30%。',
      zone: 'DamageChangeElement', value: 0.3, filter: { elements: ['热熔'] }, target: 'team', duration: 幻灭帧, trigger: 'hook',
    },
    {
      id: '达妮娅.蚀刻繁彩·布景', source: '固有技能·蚀刻繁彩：处于熵变强化时，若处于共鸣模态·聚爆，队伍中的角色热熔伤害加成提升30%。',
      zone: 'DamageChangeElement', value: 0.3, filter: { elements: ['热熔'] }, target: 'team', duration: 布景帧, trigger: 'hook',
    },
    { id: '达妮娅.蚀域首次', source: '蚀域：黑大招第 145 帧生成，第 157 帧第一次出伤害（xlsx 蚀域-伤害）', target: 'self', duration: 157, trigger: 'hook' },
    { id: '达妮娅.蚀域计时', source: '蚀域：每4秒发动1次攻击（xlsx"首次生成聚怪/伤害后，每240F生成1次"）', target: 'self', duration: 240, trigger: 'hook' },
    {
      // 挂在目标身上、只加在聚爆效应自身的伤害上；"达妮娅切换模态时提前结束"不会发生（只写聚爆）
      id: '达妮娅.延奏', source: '延奏技能·未竟的谎言：处于共鸣模态·聚爆时，队伍中登场角色周围的目标受到聚爆效应伤害加深60%，持续30秒。',
      zone: 'DamageAmplify0', value: 0.6, filter: { effects: ['聚爆效应'] }, target: 'enemy', duration: 1800, trigger: { on: 'outro' },
    },
  ],
  hooks: {
    onResolve(ctx) {
      // 固有1 伪物弥留：处于布景之形进入战斗时，黯核不足 2 枚回复至 2 枚，虚质粒子不足 20 点回复至 20 点
      if (黯核(ctx) < 2) addCore(ctx, 2 - 黯核(ctx), '伪物弥留：进入战斗时补到 2 枚')
      const lack = 20 - 虚质(ctx)
      if (lack > 0) ctx.addResource('core1', lack, ctx.self, '伪物弥留：进入战斗时补到 20')
    },
    introAction(ctx) { return ctx.vars.幻灭 ? '黑QTE' : '白QTE' },
    canStart(ctx, id) {
      const v = ctx.vars
      if (id.startsWith('白') && v.幻灭) return `幻灭之形不能用 ${id}`
      if ((id.startsWith('黑') || id.startsWith('强化黑')) && !v.幻灭) return `布景之形不能用 ${id}`
      if (id.startsWith('强化黑')) return '轴里写黑A：有虚质粒子时钩子自动按强化版算'
      switch (id) {
        case '黑E': return 黯核(ctx) > 0 ? `有黯核（${黯核(ctx)}），共鸣技能是放逐` : true
        case '黑强化E1': return 黯核(ctx) > 0 ? true : '放逐要有黯核'
        case '黑大招': return 共形(ctx) >= 100 ? true : `幻灭之形的帷幕终景要共形能量满（${Math.floor(共形(ctx))} / 100）`
      }
      return true
    },
    onEvent(ctx, ev) {
      const v = ctx.vars
      const self = me(ctx)
      switch (ev.type) {
        case 'actionStart': {
          if (ev.char !== self) return
          switch (ev.action) {
            case '白大招': v.幻灭 = true; entropy(ctx, '幻灭'); return             // 第 130 帧切到幻灭之形（按起手算）
            case '黑大招': v.幻灭 = false; entropy(ctx, '布景'); erode(ctx); return  // 第 1 帧移除黑熵变、销毁蚀域，第 142 帧切回布景（按起手算）
            case '白QTE': addCore(ctx, 1, '久疏问候！获得 1 枚黯核'); return
            case '黑QTE':
              addCore(ctx, 1, '轻叩门扉获得 1 枚黯核')
              entropy(ctx, '幻灭')
              ctx.addResource('concerto', 10, ctx.self, '轻叩门扉回复协奏能量（nanoka 3.7；动作表没写）')
              return
            case '黑强化E2':                                                     // "第1F清空黯核，每移除1点使该技能倍率提升"
              v.放逐黯核 = 黯核(ctx)
              if (v.放逐黯核 > 0) ctx.addResource('core3', -v.放逐黯核, ctx.self, '放逐第二段消耗全部黯核')
              return
          }
          return
        }
        case 'hit': {
          if (ev.char !== self || ev.dmg === null || ev.effect) return
          if (v.强化本下) {
            v.强化本下 = false
            const e = ENHANCED[ev.judgment]!
            ctx.addResource('core1', -Math.min(e.cost, 虚质(ctx)), ctx.self, `强化${ev.judgment}消耗虚质粒子`)
            const gain = ev.gains.core[1] ?? 0
            if (gain > 0) ctx.addResource('core2', gain, ctx.self, '虚质粒子：共形能量获取效率提升100%')
          }
          const rule = IMPLODE[ev.action]
          if (!rule) return
          const now = ctx.state.battleFrames
          if (v[rule.key] >= 0 && now < v[rule.key] + IMPLODE_CD) return
          v[rule.key] = now
          ctx.applyEffect('聚爆效应', rule.stacks, `达妮娅 ${ev.action}（共鸣模态·聚爆）`)
          return
        }
        case 'buffExpire': {
          if (ev.target !== self || ev.reason !== 'timeout') return
          switch (ev.buff) {
            case '达妮娅.虚质计时':
              if (ctx.buffStacks('达妮娅.熵变·布景') === 0) return
              ctx.addResource('core1', 1, ctx.self, '熵变强化·布景之形：每秒 1 点')
              ctx.addBuff('达妮娅.虚质计时')
              return
            case '达妮娅.黯核计时':
              if (!inEntropy(ctx)) return
              addCore(ctx, 1, '熵变强化：每 12 秒 1 枚')
              ctx.addBuff('达妮娅.黯核计时')
              return
            case '达妮娅.蚀域首次': case '达妮娅.蚀域计时':
              if (now(ctx) >= v.蚀域至) return
              ctx.spawnJudgment('蚀域-伤害', { action: '蚀域', note: '蚀域每 4 秒一次' })
              ctx.addBuff('达妮娅.蚀域计时')
              return
          }
          return
        }
      }
    },
    modifyHit(ctx, hit) {
      const e = ENHANCED[hit.judgment.name]
      if (e && ctx.vars.幻灭 && 虚质(ctx) > 0) {
        ctx.vars.强化本下 = true
        hit.multiplier = e.mult
        hit.tags = ['共鸣解放']
      }
      // 放逐第二段：每消耗 1 枚黯核，伤害倍率提升 150%——按原倍率的比例（×(1 + 1.5n)），不是加 150 个百分点：
      // 2026-10-27 中 2 录像 3 枚时暴击跳字 100150，按比例算 100189 / 按加法算 91400（6 链写的是"倍率增加1200%"，措辞不同）
      if (hit.judgment.name === '黑强化E2' && ctx.vars.放逐黯核 > 0) hit.multiplier *= 1 + 1.5 * ctx.vars.放逐黯核
    },
    forte(ctx) {
      const v = ctx.vars
      const parts = [v.幻灭 ? '幻灭之形' : '布景之形']
      if (ctx.buffStacks('达妮娅.熵变·幻灭') > 0) parts.push('熵变·幻灭')
      if (ctx.buffStacks('达妮娅.熵变·布景') > 0) parts.push('熵变·布景')
      if (v.蚀域至 > ctx.state.battleFrames) parts.push('蚀域')
      return parts.join(' · ')
    },
  },
  actionOverrides: {
    // 寿命放不下全部次数（ticksCapped）：按 nanoka 的段数把寿命放到刚好装下（白重击 80.76%*2、黑·普攻第二段 14.07%*4、轻唤 14.52%*5）
    白重击: { judgments: { 白重击: { ticks: 2, lifeFrames: 13 } } },
    黑A2: { judgments: { '黑A2-2': { ticks: 4, lifeFrames: 19 } } },
    强化黑A2: { judgments: { '强化黑A2-2': { ticks: 4, lifeFrames: 19 } } },
    白E: { cooldown: 1200 },                                   // 拟态泡泡冷却 20 秒（nanoka 3.7）
    黑E: { cooldown: 240, cooldownGroup: '轻唤', judgments: { '黑E-2': { ticks: 5, lifeFrames: 61 } } },   // 轻唤、放逐共享 4 秒冷却
    黑强化E1: { kind: 'skill', cooldown: 240, cooldownGroup: '轻唤', accept: ['kindGuess'] },
    黑强化E2: { kind: 'skill', comboFrom: ['黑强化E1'], accept: ['kindGuess'] },
    白大招: { cooldown: 1500 },
    黑大招: { kind: 'liberation', cooldown: 1500, energyCost: 0, accept: ['kindGuess'] },
    白A4: { comboFrom: ['白A3', '白QTE', '白A3-聚怪D'], accept: ['noLife'] },   // 久疏问候、闪避反击之后短按普攻出第 4 段
    蚀域: { kind: 'other', accept: ['noEnd'] },                // 由钩子生成（黑大招之后每 4 秒），不单独施放
    '延奏-聚爆模态': { kind: 'other', accept: ['noEnd', 'noDmg'] },   // 延奏的效果写成 buff 达妮娅.延奏
    特殊能量: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    共鸣模态: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
  },
})

const now = (ctx: Ctx): number => ctx.state.battleFrames
