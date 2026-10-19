// data/curated/characters/卜灵.ts —— 角色模块（心 · 雷主 · 卜灵 队伍，2026-10-19；待确认的条目见 docs/xin-confirm.md）
// 原文：nanoka 3.7 的技能说明、xlsx 卜灵块「初始化」行的备注（R4533）与 characters.json 的共鸣链 / 固有文本。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 卦象（共鸣回路）：上限 4 枚，满了再得时全部左移、去掉最左边那枚。核心资源槽 1 只记枚数（数据给 +1 / −2）；
 *  哪枚是艮、哪枚是震记在状态量里：卦象位的第 i 位（最左边是第 0 位）为 1 = 震。重击按最左边两枚选式子（canStart） */
const VARS = {
  卦象数: 0, 卦象位: 0,
  少阳: false, 少阴: false, 阴阳相生: false,
  雷法: 0,                                  // 开阵期间第几阶：0 一气初动、1 两仪交泰、2 三才合一（每次有人变奏升一阶）
  冲击波: 0,                                // 这座五雷荡煞阵已经放了几次冲击波
  固有2上次: -600,                          // 固有2"每10秒可生效1次"：上次的战斗帧
  链2上次: -1440,                           // 共鸣链2"每24秒可生效1次"
  震为雷跳数: 0, 延奏跳数: 0,               // 两种持续回复各跳了几次
}
type Ctx = HookContext<typeof VARS>
/** 持续回复（治疗量不建模，每跳记一次治疗事件，触发隐世回光等"提供治疗时"的效果；同维里奈）：每秒一跳 */
const HOT = {
  '卜灵.震为雷计时': { source: '重击·震为雷', count: '震为雷跳数', ticks: 8 },   // "持续回复附近队伍中所有角色的生命值，每秒回复1次，持续8秒"
  '卜灵.延奏计时': { source: '延奏', count: '延奏跳数', ticks: 16 },            // "每秒回复卜灵18%攻击的生命值，持续16秒"
} as const
type HotId = keyof typeof HOT
const isHot = (id: string): id is HotId => Object.hasOwn(HOT, id)
function startHot(ctx: Ctx, id: HotId): void {
  ctx.vars[HOT[id].count] = 0
  ctx.addBuff(id)                                              // 再次施放时刷新、重新计数
}
function tickHot(ctx: Ctx, id: HotId): void {
  ctx.heal(HOT[id].source)
  const n = ctx.vars[HOT[id].count] + 1
  ctx.vars[HOT[id].count] = n
  if (n < HOT[id].ticks) ctx.addBuff(id)
}
const 艮 = 0, 震 = 1
/** 四式重击：最左边两枚卦象 → 动作 ID，得少阳还是少阴 */
const HEAVY = [
  { id: '重击', left: [艮, 震], gain: '少阳' },                 // 山雷颐
  { id: '重击-震艮前置', left: [震, 艮], gain: '少阳' },        // 雷山小过
  { id: '重击-艮艮', left: [艮, 艮], gain: '少阴' },            // 艮为山
  { id: '重击-震震', left: [震, 震], gain: '少阴' },            // 震为雷
] as const
const LEIFA = ['卜灵.雷法·两仪交泰', '卜灵.雷法·三才合一', '卜灵.共鸣链6'] as const

function push(ctx: Ctx, sym: number): void {
  const v = ctx.vars
  if (v.卦象数 < 4) { v.卦象位 |= sym << v.卦象数; v.卦象数 += 1 }
  else v.卦象位 = (v.卦象位 >> 1) | (sym << 3)                  // 满了：左移，去掉最左边那枚
}
const leftTwo = (ctx: Ctx): [number, number] => [ctx.vars.卦象位 & 1, (ctx.vars.卦象位 >> 1) & 1]

/** 重击用掉最左边两枚，得少阳 / 少阴；两者都有时进入阴阳相生 */
function divine(ctx: Ctx, gain: '少阳' | '少阴'): void {
  const v = ctx.vars
  v.卦象位 >>= 2
  v.卦象数 = Math.max(0, v.卦象数 - 2)
  v[gain] = true
  if (!(v.少阳 && v.少阴)) return
  v.少阳 = false
  v.少阴 = false
  v.阴阳相生 = true
  const now = ctx.state.battleFrames
  if (ctx.chain >= 2 && now - v.链2上次 >= 1440) {             // 共鸣链2：进入阴阳相生时回 25 点共鸣能量，24 秒一次
    v.链2上次 = now
    ctx.addResource('energy', 25, ctx.self, '共鸣链2：进入阴阳相生')
  }
}

export default defineCharacter('卜灵', {
  weaponType: '音感仪',
  treeStats: { '治疗效果加成': 0.12, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreCaps: { 1: 4 },                                  // 卦象上限 4 枚（主表写 255）
  aliases: {
    E: 'E', R: '大招', QTE: 'QTE',
    E派生A4: 'A4#2',                                   // "施放共鸣技能后，一定时间内短按普攻，将会释放普攻第四段"
    山雷颐: '重击', 雷山小过: '重击-震艮前置', 艮为山: '重击-艮艮', 震为雷: '重击-震震', 鬼门占卦: '重击-鬼门占卦',
  },
  vars: VARS,
  buffs: [
    {
      // 开阵状态 24 秒：xlsx 大招-前置"处于阴阳相生状态时，第236F获得24秒开阵状态"；由钩子在开阵前置那一段（第 235 帧）挂上
      id: '卜灵.开阵', source: '大招-前置：处于阴阳相生状态时，第236F获得24秒开阵状态、移除阴阳相生',
      target: 'self', duration: 1440, trigger: 'hook',
    },
    { id: '卜灵.五雷荡煞阵', source: '大招-五雷荡煞阵：持续1440帧，持续帧内每2秒生成一次冲击波，最多10次', target: 'self', duration: 1440, trigger: 'hook' },
    { id: '卜灵.冲击波计时', source: '大招-五雷荡煞阵：每2秒生成一次冲击波', target: 'self', duration: 120, trigger: 'hook' },
    { id: '卜灵.震为雷计时', source: '重击·震为雷：持续回复附近队伍中所有角色的生命值，每秒回复1次，持续8秒', target: 'self', duration: 60, trigger: 'hook' },
    { id: '卜灵.延奏计时', source: '延奏：持续为队伍中登场角色回复生命值，每秒回复卜灵18%攻击的生命值，持续16秒', target: 'self', duration: 60, trigger: 'hook' },
    // 雷法（xlsx 伤害配置 R597–R599"法阵二阶段 技伤加成+10%、三阶段 +15%、共鸣链6 三阶段 +25%"）：登场（前台）角色的共鸣技能伤害加成。
    // 钩子挂到三个人身上，作用对象 onField 让只有前台出伤者吃到；开阵结束时钩子一并移除
    {
      id: '卜灵.雷法·两仪交泰', source: '【雷法·两仪交泰】状态持续期间，使队伍中登场的角色共鸣技能伤害加成提升10%',
      zone: 'DamageChangeType', value: 0.1, filter: { tags: ['共鸣技能'] }, target: 'onField', duration: 1440, trigger: 'hook',
    },
    {
      id: '卜灵.雷法·三才合一', source: '【雷法·三才合一】状态持续期间，使队伍中登场的角色共鸣技能伤害加成提升25%',
      zone: 'DamageChangeType', value: 0.25, filter: { tags: ['共鸣技能'] }, target: 'onField', duration: 1440, trigger: 'hook',
    },
    {
      id: '卜灵.共鸣链6', source: '共鸣链6：【雷法·三才合一】状态持续期间，队伍中登场的角色获得的共鸣技能伤害加成效果提升至50%',
      zone: 'DamageChangeType', value: 0.25, filter: { tags: ['共鸣技能'] }, target: 'onField', duration: 1440, trigger: 'hook',
      requires: { chain: 6 },
    },
    {
      id: '卜灵.共鸣链1', source: '共鸣链1：共鸣解放·飞雷诀·归一造成伤害时，此次伤害的暴击提升20%。',
      zone: 'critRate', value: 0.2, filter: { judgments: ['大招-强化伤害'] }, target: 'self', duration: 'inf', trigger: 'always',
      requires: { chain: 1 },
    },
    {
      id: '卜灵.共鸣链4', source: '共鸣链4：卜灵的治疗效果加成提升20%。',
      zone: 'healBonus', value: 0.2, target: 'self', duration: 'inf', trigger: 'always', requires: { chain: 4 },
    },
    {
      // 持续回复的每一跳见钩子（治疗事件）
      id: '卜灵.延奏', source: '延奏：……附近队伍中所有角色全伤害加深15%，持续30秒。',
      zone: 'DamageAmplify0', value: 0.15, target: 'team', duration: 1800, trigger: { on: 'outro' },   // 不带类别的"全伤害加深"= 0 类
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const heavy = HEAVY.find(h => h.id === id)
      if (heavy) {
        if (ctx.vars.卦象数 < 2) return '卦象不足 2 枚（重击是鬼门占卦）'
        const [a, b] = leftTwo(ctx)
        const name = (x: number) => (x === 震 ? '震' : '艮')
        return a === heavy.left[0] && b === heavy.left[1] ? true : `最左边两枚卦象是${name(a)}${name(b)}`
      }
      if (id === '重击-鬼门占卦') return ctx.vars.卦象数 < 2 ? true : '有 2 枚以上卦象时重击按卦象出式子'
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      if (ev.type === 'actionStart' && ev.char === me) {
        if (ev.action === 'E') push(ctx, 震)                        // "施放共鸣技能·遁影牵雷时获得【卦象·震】"（E-前置第 1 帧）
        // 艮为山、震为雷：数据在起手时扣 2 枚卦象（gain 行，原文"第40F"），这里同时记少阴；
        // 艮为山"回复附近队伍中所有角色的生命值"，震为雷持续回复 8 秒（都按起手算）
        if (ev.action === '重击-艮艮' || ev.action === '重击-震震') divine(ctx, '少阴')
        if (ev.action === '重击-艮艮') ctx.heal('重击·艮为山')
        if (ev.action === '重击-震震') startHot(ctx, '卜灵.震为雷计时')
        if (ev.action === '大招') {
          // 阴阳相生：放的是飞雷诀·归一（强化伤害、开阵）；否则是飞雷诀（常态伤害）
          const strong = ctx.vars.阴阳相生
          ctx.skipJudgments(ev.instance, strong ? ['大招-常态伤害'] : ['大招-强化伤害', '大招-C5异常', '大招-开阵前置'])
          ctx.vars.阴阳相生 = false
        }
        return
      }
      if (ev.type === 'hit' && ev.char === me) {
        if (ev.judgment === 'A2-卦象') push(ctx, 艮)                // "普攻第2段造成伤害时获得【卦象·艮】"
        else if (ev.judgment === 'A4' || ev.judgment === '空中攻击-落地') push(ctx, 震)
        else if (ev.judgment === '重击-艮震' || ev.judgment === '重击-震艮') divine(ctx, '少阳')   // 数据在第 40 帧这一段扣 2 枚
        else if (ev.judgment === '大招-开阵前置') {
          // 开阵（xlsx 大招-开阵前置"持续帧结束后自行生成开阵子弹"，子弹"碰撞后生成五雷荡煞阵"）：按 30 帧后子弹一出来就碰到算阵的生成，
          // 之后每 2 秒一次冲击波，第一次在阵生成后 2 秒（推断，见 docs/xin-confirm.md）
          ctx.addBuff('卜灵.开阵')
          ctx.vars.雷法 = 0
          ctx.removeBuff('卜灵.冲击波计时')
          ctx.vars.冲击波 = 0
          ctx.addBuff('卜灵.五雷荡煞阵')
          ctx.addBuff('卜灵.冲击波计时')
          ctx.assume('module-guess', '卜灵：五雷荡煞阵按开阵前置之后立即生成、第一次冲击波在 2 秒后')
        } else if (ev.judgment === 'QTE-伤害') {
          ctx.heal('变奏')                                           // "攻击目标，造成导电伤害，并回复附近队伍中所有角色的生命值"
          const now = ctx.state.battleFrames                         // 固有2：变奏伤害命中后附加 4 层电磁效应，10 秒一次
          if (now - ctx.vars.固有2上次 >= 600) { ctx.vars.固有2上次 = now; ctx.applyEffect('电磁效应', 4, '卜灵 固有2：变奏命中') }
        }
        return
      }
      // 雷法：开阵期间队伍中有人施放变奏技能，升一阶
      if (ev.type === 'intro' && ctx.buffStacks('卜灵.开阵') > 0 && ctx.vars.雷法 < 2) {
        ctx.vars.雷法 += 1
        for (const id of LEIFA) ctx.removeBuff(id)
        const ids = ctx.vars.雷法 === 1 ? [LEIFA[0]] : ctx.chain >= 6 ? [LEIFA[1], LEIFA[2]] : [LEIFA[1]]
        for (const id of ids) for (const slot of [0, 1, 2] as const) ctx.addBuff(id, { target: slot })
        return
      }
      if (ev.type === 'outro' && ev.char === me) { startHot(ctx, '卜灵.延奏计时'); return }
      if (ev.type !== 'buffExpire' || ev.reason !== 'timeout' || ev.target !== me) return
      if (isHot(ev.buff)) { tickHot(ctx, ev.buff); return }
      if (ev.buff === '卜灵.冲击波计时' && ctx.buffStacks('卜灵.五雷荡煞阵') > 0) {
        ctx.spawnJudgment('大招-冲击波', { action: '大招', note: '五雷荡煞阵每 2 秒一次' })
        ctx.vars.冲击波 += 1
        if (ctx.vars.冲击波 < 10) ctx.addBuff('卜灵.冲击波计时')
      }
      if (ev.buff === '卜灵.开阵') {
        for (const id of LEIFA) ctx.removeBuff(id)
        ctx.vars.雷法 = 0
      }
    },
    // 共鸣回路的状态说明（时间轴检查器）：卦象从左到右（空位写 ○），少阳 / 少阴 / 阴阳相生，开阵时雷法第几阶、五雷荡煞阵放了几次冲击波
    forte(ctx) {
      const v = ctx.vars
      const syms = [0, 1, 2, 3].map(i => (i >= v.卦象数 ? '○' : (v.卦象位 >> i) & 1 ? '震' : '艮')).join('')
      const parts = [`卦象 ${syms}`]
      if (v.阴阳相生) parts.push('阴阳相生')
      else for (const k of ['少阳', '少阴'] as const) if (v[k]) parts.push(k)
      if (ctx.buffStacks('卜灵.开阵') > 0) parts.push(`开阵 · 雷法${['一气初动', '两仪交泰', '三才合一'][v.雷法]}`)
      if (ctx.buffStacks('卜灵.五雷荡煞阵') > 0) parts.push(`冲击波 ${v.冲击波}/10`)
      return parts.join(' · ')
    },
  },
  actionOverrides: {
    // 落地后接 A 出的是普攻第 2 段：用户的轴"下落A（蓝符） A（黄符）"，黄符（艮）只有第 2 段给
    A2: { comboFrom: ['A1', '空中攻击'] },
    'A4#2': { comboFrom: ['E'] },                       // 由 E 派生的普攻第 4 段
    // 下落攻击：xlsx 落地那一行的帧数从落地起算，下落 38 帧落地
    // 优先级 6 → 3 没写哪帧变：按落地段"第3F前不能闪避"（落地后第 3 帧，第 41 帧）
    空中攻击: { shiftRows: { '空中攻击-落地': 38 }, accept: ['priorityChangeGuess'] },
    E: { cooldown: 900, accept: ['persistsGuess'] },    // 共鸣技能冷却 15 秒（nanoka 3.7）；E-0 是"无伤害"的标记段，脱不脱手都一样
    // 变奏伤害"脱手后延迟54F生效"：第 7 帧出手、第 61 帧结算
    QTE: { judgments: { 'QTE-伤害': { spawnFrame: 61 } } },
    大招: {
      cooldown: 1440,                                   // 共鸣解放冷却 24 秒（nanoka 3.7）
      // 优先级 10 → 2 没写哪帧变：按"第238F前不响应输入"；大招-C5异常 是 5 链额外多出的一段（不是替换），见 applies
      accept: ['priorityChangeGuess', 'chainAdditive'],
      // 切人锁不用写：xlsx 只写了"第238F前不响应输入"，装配按大招出招阶段不能切人取 238（假设 ult-no-switch）；
      // 开阵在第 236 帧，大招后马上变奏的那一下正好算进雷法
      judgments: {
        '大招-冲击波': { applies: { effect: '电磁效应', stacks: 2 } },    // "命中后赋予目标2层电磁效应"
        '大招-C5异常': { applies: { effect: '电磁效应', stacks: 6 } },    // 共鸣链5"生成五雷荡煞阵时……附加6层"
      },
    },
  },
})
