// data/curated/characters/心.ts —— 角色模块（心 · 雷主 · 卜灵 队伍，2026-10-19；待确认的条目见 docs/xin-confirm.md）
// 原文：nanoka 3.7 的技能说明，xlsx 心的两块（应世心 R1317 起、照世心 R1522 起）「特殊能量」「通用状态」「电磁模态」几行的备注，
// characters.json 的共鸣链 / 固有文本。只写共鸣模态·电磁（队伍里有雷主，固有1 有雷主的加成）；同奏模态没写。
// 动作分两块：常态"应世心"（构建改叫"心"）与岁主形态"照世心"，后者并入时动作 ID 加前缀"照世·"（照世·A1、照世·大招…）。
// 只写到 0 链：2 链、3 链的倍率提升写了（与 dmg 里 C2 / C3 两版的倍率相同），4 链的全属性加成写了；1 链、3 链的电磁结算、5 / 6 链没写。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

const P = '照世·'
/** 应世相（常态）才能用的动作；照世相的动作都带前缀。其余（通用块的闪避、首位声骸 Q）两种形态都能用 */
const YING = new Set([
  'A1', 'A2', 'A2-1D', 'A3', 'A4', '重击', '强化重击', '增幅强化重击', '空中重击', '空中重击派生', '空中攻击', 'E', '大招',
  '借相-地面切换岁主', '借相-空中切换岁主',
])
/** 照世相统御众机（强化状态）期间才能用的 / 不能用的 */
const COMMAND = new Set(['强化A1', '强化A2', '强化A2-闪避反击', '强化A3', '强化A4', '强化重击', '增幅强化重击'].map(x => P + x))
const PLAIN = new Set(['A1', 'A2', 'A3'].map(x => P + x))          // 统御众机里普攻换成强化A（重击在照世心耗完前仍是普通重击）
/** 活字心锁（照世 A1 的魔方）在这几段出现时崩解：A2"第18F引爆"、重击"第36F引爆"（按第 32 帧的重击段算）、E"第90F引爆" */
const DETONATE = new Map([[`${P}A2`, 'A2'], [`${P}重击`, '重击'], [`${P}重击-前置D`, '重击D'], [`${P}E`, 'E-2']])
const ENDOW = ['强化A1-赋予1层电磁', '强化A2-赋予1层电磁', '强化A3-赋予1层电磁', '强化A4-赋予1层电磁']

const VARS = {
  照世: false,              // 现在是照世相（岁主形态）
  转相解锁: false,          // 应世相放过步红尘 / 镇红尘
  万阙解锁: false,          // 照世相放过临寰宇 / 镇寰宇
  电磁加一: 0,              // 【电磁+1】：照世相强化A还能附加几次电磁效应（转相结束后 5 层）
  额外能量: false,          // 【额外能量Buff】：照世相下一次引爆魔方时 +150 照世心
  魔方至: -1,               // 活字心锁消失的战斗帧；-1 = 场上没有
  霆霓: 0,                  // 固有2：不在心相心生时，队友每附加 1 层电磁效应 +1，上限 10
  固有1角色: 0,             // 固有1：哪几位角色已经触发过（槽位的位）
  敕令: 0,                  // 协同攻击还剩几次（转相时 21 层，45 秒）
}
type Ctx = HookContext<typeof VARS>
const me = (ctx: Ctx): string => ctx.state.chars[ctx.self].name

/** 心相心生下目标电磁效应为 0 层：附加 1 层；霆霓满 10 层时再附加疾霆，补到上限（固有2） */
function fillIfEmpty(ctx: Ctx): void {
  if (ctx.buffStacks('心.心相心生') === 0 || (ctx.state.enemy.effects['电磁效应']?.stacks ?? 0) > 0) return
  ctx.applyEffect('电磁效应', 1, '心 固有2：心相心生中目标没有电磁效应')
  if (ctx.vars.霆霓 >= 10) ctx.applyEffect('电磁效应', 9, '心 固有2：疾霆，补到上限')
}

/** 敕令：召唤飞阙协同攻击一次（xlsx 协同-特效"生成后，协同次数-1"，飞阙第 18 帧出手——这里一召唤就结算，推断） */
function strike(ctx: Ctx): void {
  if (ctx.vars.敕令 <= 0 || ctx.buffStacks('心.协同') === 0) return
  ctx.spawnJudgment('协同-飞阙', { action: '协同', note: '敕令：前台角色造成伤害后每秒一次' })
  ctx.vars.敕令 -= 1
  if (ctx.vars.敕令 > 0) ctx.addBuff('心.协同计时')
  ctx.assume('module-guess', '心：协同攻击在监听触发时立即出第一次、之后每秒一次，飞阙的 18 帧出手时间不计')
}

function onAction(ctx: Ctx, id: string, instance: number): void {
  const v = ctx.vars
  switch (id) {
    case '强化重击': case '增幅强化重击':
      v.转相解锁 = true                                        // "施放重击·应世相·步红尘或重击·应世相·镇红尘后，解锁转相"
      return
    case '大招': {                                           // 转相
      v.照世 = true
      v.转相解锁 = false
      v.额外能量 = true
      v.魔方至 = -1                                            // "进入心相心生状态时，重置心的照世相"
      v.敕令 = 21
      ctx.addBuff('心.心相心生')
      ctx.addBuff('心.协同')
      fillIfEmpty(ctx)
      return
    }
    case `${P}强化重击`: case `${P}增幅强化重击`:
      v.万阙解锁 = true                                        // "第1F解锁大招、移除强化状态"
      ctx.removeBuff('心.统御众机')
      return
    case `${P}大招`:                                         // 万阙垂天：回到应世相，退出心相心生，得照夜明
      v.照世 = false
      v.万阙解锁 = false
      v.魔方至 = -1
      ctx.removeBuff('心.心相心生')
      ctx.addBuff('心.照夜明')
      return
    case `${P}A1`:
      v.魔方至 = -1                                            // "A1-前置：第1F销毁场上A1-魔方"（新的第 1 帧生成）
      return
  }
  // 强化A：有【电磁+1】才生成"赋予1层电磁"那一段
  if (COMMAND.has(id) && v.电磁加一 <= 0) ctx.skipJudgments(instance, ENDOW)
}

export default defineCharacter('心', {
  weaponType: '音感仪',
  treeStats: { '暴击率': 0.08, '攻击%': 0.12 },      // 技能树属性节点合计（nanoka 3.7 skill_trees）
  mergeBlocks: [{ block: '照世心', prefix: P }],
  coreNames: { 1: '应世心', 2: '照世心' },
  aliases: {
    E: 'E', R: `${P}大招`, QTE: 'QTE',               // R = 万阙垂天（要满能量）；转相不耗能量，单列
    转相: '大招', 万阙垂天: `${P}大招`, 步红尘: '强化重击', 镇红尘: '增幅强化重击',
    万阙连衡: `${P}强化E`, 临寰宇: `${P}强化重击`, 镇寰宇: `${P}增幅强化重击`,
  },
  vars: VARS,
  buffs: [
    { id: '心.心相心生', source: '心相心生：施放应世心大招后获得该状态，持续45秒', target: 'self', duration: 2700, trigger: 'hook' },
    {
      // 统御众机（xlsx"强化状态"）：施放强化E（万阙连衡）后 13 秒；通过任意方式移除后清空照世心（钩子）
      id: '心.统御众机', source: '强化状态：施放强化E后获得该状态，持续13秒；施放强化重击后，移除该状态；通过任意方式移除该状态后，清空核心能量2',
      target: 'self', duration: 780, trigger: { on: 'actionStart', where: { actions: [`${P}强化E`] } },
    },
    { id: '心.协同', source: '协同状态：施放应世心大招后获得该状态，持续45秒；至多生成21次协同攻击', target: 'self', duration: 2700, trigger: 'hook' },
    { id: '心.协同前置', source: '协同-前置：持续180帧，重复获得时刷新持续时间，期间每1秒生成1次特效', target: 'self', duration: 180, trigger: 'hook' },
    { id: '心.协同计时', source: '协同-前置：期间每1秒生成1次特效', target: 'self', duration: 60, trigger: 'hook' },
    {
      // 照夜明：进入战斗（onResolve）或施放万阙垂天时获得，施放延奏时消耗（钩子在延奏的触发处理完之后移除）
      id: '心.照夜明', source: '延奏：心进入战斗状态或施放共鸣解放·万阙垂天时，将获得照夜明。心施放延奏技能时，将消耗照夜明',
      target: 'self', duration: 'inf', trigger: 'hook',
    },
    {
      id: '心.延奏', source: '延奏：处于共鸣模态·电磁时，队伍中除心之外的角色导电伤害加深20%，持续20秒。',
      zone: 'DamageAmplify0', value: 0.2, filter: { elements: ['导电'] }, target: 'teamExceptSelf', duration: 1200,
      trigger: { on: 'outro', where: { ownerHas: '心.照夜明' } },
    },
    {
      id: '心.固有1·电磁', source: '固有1：处于共鸣模态·电磁时，队伍中的角色附加【电磁效应】后，心导电伤害加成提升25%，最多可叠加2层，该效果每名角色仅可触发1次。',
      zone: 'DamageChangeElement', value: 0.25, filter: { elements: ['导电'] }, target: 'self', maxStacks: 2, duration: 'inf', trigger: 'hook',
    },
    {
      id: '心.固有1·雷主', source: '固有1：若漂泊者·导电处于同一编队中，则漂泊者·导电施放变奏技能·不啻惊雷时，心和漂泊者·导电的导电伤害加成提升20%，持续30秒。',
      zone: 'DamageChangeElement', value: 0.2, filter: { elements: ['导电'] }, target: 'self', duration: 1800, trigger: 'hook',
    },
    {
      id: '心.共鸣链2', source: '共鸣链2：重击·应世相·步红尘和重击·应世相·镇红尘的伤害倍率提升60%。重击·照世相·临寰宇和重击·照世相·镇寰宇的伤害倍率提升60%。',
      zone: 'RateBonus', value: 0.6, filter: { actions: ['强化重击', '增幅强化重击', `${P}强化重击`, `${P}增幅强化重击`] },
      target: 'self', duration: 'inf', trigger: 'always', requires: { chain: 2 },
    },
    {
      id: '心.共鸣链3', source: '共鸣链3：共鸣解放·万阙垂天的伤害倍率提升70%。',
      zone: 'RateBonus', value: 0.7, filter: { actions: [`${P}大招`] }, target: 'self', duration: 'inf', trigger: 'always', requires: { chain: 3 },
    },
    {
      id: '心.共鸣链4', source: '共鸣链4：队伍中的角色为目标附加【电磁效应】、【电磁爆发】后，使队伍中所有角色全属性伤害加成提升20%，持续30秒',
      zone: 'DamageChangeElement', value: 0.2, filter: { elements: ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] },
      target: 'team', duration: 1800, requires: { chain: 4 },
      trigger: { on: 'enemyState', where: { by: 'team', enemyState: 'effectApplied', effect: '电磁效应' } },
    },
  ],
  hooks: {
    onResolve(ctx) { ctx.addBuff('心.照夜明') },              // 进入战斗状态时获得照夜明
    canStart(ctx, id) {
      const v = ctx.vars
      const c = ctx.state.chars[ctx.self]
      const zhao = id.startsWith(P)
      if (!zhao && !YING.has(id)) return true
      if (zhao !== v.照世) return zhao ? `应世相不能用 ${id}` : `照世相不能用 ${id}（要用带"${P}"的）`
      const command = ctx.buffStacks('心.统御众机') > 0
      switch (id) {
        case '重击': return c.core[0] < 100 ? true : '应世心满了，重击是步红尘 / 镇红尘'
        case '增幅强化重击': return c.core[0] >= 100 ? true : `镇红尘要应世心满（${Math.floor(c.core[0])} / 100）`
        case '强化重击':
          if (c.core[0] < 100) return `步红尘要应世心满（${Math.floor(c.core[0])} / 100）`
          return (c.cooldowns['了尘愿'] ?? 0) > 0 ? true : '了尘愿可用：重击是镇红尘（增幅强化重击）'
        case '大招':
          if (ctx.buffStacks('心.心相心生') > 0) return '心相心生中，共鸣解放是借相'
          return v.转相解锁 ? true : '转相要先放步红尘 / 镇红尘'
        case `${P}E`: return c.core[1] < 300 ? true : '照世心满了，共鸣技能是万阙连衡（照世·强化E）'
        case `${P}强化E`: return c.core[1] >= 300 ? true : `万阙连衡要照世心满（${Math.floor(c.core[1])} / 300）`
        case `${P}大招`: return v.万阙解锁 ? true : '万阙垂天要先放临寰宇 / 镇寰宇'
      }
      if (COMMAND.has(id)) {
        if (!command) return `${id} 要在统御众机（万阙连衡之后 13 秒）里`
        if (id.endsWith('强化重击')) {
          if (c.core[1] > 0) return `临寰宇 / 镇寰宇要照世心耗完（还有 ${Math.ceil(c.core[1])}）`
          if (id === `${P}强化重击` && (c.cooldowns['承天则'] ?? 0) <= 0) return '承天则可用：重击是镇寰宇（照世·增幅强化重击）'
        }
        return true
      }
      if (PLAIN.has(id) && command) return '统御众机里普攻是强化A'
      return true
    },
    onEvent(ctx, ev) {
      const v = ctx.vars
      const self = me(ctx)
      switch (ev.type) {
        case 'actionStart':
          if (ev.char === self) onAction(ctx, ev.action, ev.instance)
          return
        case 'actionEnd': case 'actionCancel':
          if (ev.char === self && ev.action === '大招') v.电磁加一 = 5   // "技能结束或中断后，获得5层【电磁+1】"
          return
        case 'judgmentSpawn': {
          if (ev.char !== self) return
          const now = ctx.state.battleFrames
          if (ev.action === `${P}A1` && ev.judgment === 'A1-魔方') { v.魔方至 = now + 168; return }   // 魔方存在 168 帧
          if (DETONATE.get(ev.action) !== ev.judgment || v.魔方至 <= now) return
          v.魔方至 = -1
          ctx.spawnJudgment('A1-引爆魔方', { action: `${P}A1`, note: '活字心锁崩解' })
          // 额外能量Buff：照世心在前台、不在统御众机时，引爆魔方后 +150 照世心
          if (v.额外能量 && ctx.state.onField === ctx.self && ctx.buffStacks('心.统御众机') === 0) {
            v.额外能量 = false
            ctx.addResource('core2', 150, ctx.self, '额外能量Buff：引爆魔方')
          }
          return
        }
        case 'hit': {
          const onField = ctx.state.chars[ctx.state.onField].name
          if (ev.char === self) {
            // 应世心、照世心"处于前台时……命中后获取"，照世心还要不在统御众机里：不满足时把数据给的退回去
            const back = (k: 0 | 1, why: string) => ctx.addResource(k === 0 ? 'core1' : 'core2', -ev.gains.core[k]!, ctx.self, why)
            if (ctx.state.onField !== ctx.self) {
              if (ev.gains.core[0]! > 0) back(0, '不在前台不得应世心')
              if (ev.gains.core[1]! > 0) back(1, '不在前台不得照世心')
            } else if (ev.gains.core[1]! > 0 && ctx.buffStacks('心.统御众机') > 0) back(1, '统御众机里不得照世心')
            if (ENDOW.includes(ev.judgment)) v.电磁加一 = Math.max(0, v.电磁加一 - 1)
            if (ev.judgment === '强化A4-2' && v.电磁加一 > 0) {          // "持有【电磁+1】时，命中后赋予目标1层电磁效应"
              v.电磁加一 -= 1
              ctx.applyEffect('电磁效应', 1, '心 照世·强化A4-2（电磁+1）')
            }
          }
          // 敕令：前台角色造成声骸技能、协同攻击以外的伤害后，3 秒内每秒消耗 1 层召唤飞阙
          if (ev.dmg === null || ev.char !== onField || ev.tags.includes('声骸技能') || ev.judgment === '协同-飞阙') return
          if (v.敕令 <= 0 || ctx.buffStacks('心.协同') === 0) return
          const idle = ctx.buffStacks('心.协同计时') === 0
          ctx.addBuff('心.协同前置')
          if (idle) strike(ctx)
          return
        }
        case 'enemyState': {
          if (ev.effect !== '电磁效应') return
          if (ev.change === 'effectEnd') { fillIfEmpty(ctx); return }
          if (ev.change !== 'effectApplied' || ev.by === undefined) return
          const slot = ctx.state.chars.findIndex(c => c.name === ev.by)
          if (!(v.固有1角色 & (1 << slot))) {                       // 固有1：每名角色第一次附加时 +1 层（最多 2 层）
            v.固有1角色 |= 1 << slot
            ctx.addBuff('心.固有1·电磁')
          }
          // 固有2：不在心相心生时，队友每附加 1 层（含进了电磁爆发的）霆霓 +1
          if (ev.by !== self && ctx.buffStacks('心.心相心生') === 0)
            v.霆霓 = Math.min(10, v.霆霓 + (ev.added ?? 0) + (ev.burstAdded ?? 0))
          return
        }
        case 'intro':
          if (ev.char.startsWith('雷主')) {                          // 漂泊者·导电的变奏：心和雷主各得导电伤害加成 20%
            const lei = ctx.state.chars.findIndex(c => c.name === ev.char) as 0 | 1 | 2
            ctx.addBuff('心.固有1·雷主', { target: ctx.self })
            ctx.addBuff('心.固有1·雷主', { target: lei })
          }
          return
        case 'outro':
          if (ev.char === self) ctx.removeBuff('心.照夜明')         // 延奏的 buff 已按"有照夜明"触发过了
          return
        case 'buffExpire':
          if (ev.target !== self) return
          if (ev.buff === '心.统御众机') {                           // 统御众机结束（到时或被强化重击移除）：清空照世心
            const left = ctx.state.chars[ctx.self].core[1]
            if (left > 0) ctx.addResource('core2', -left, ctx.self, '统御众机结束，清空照世心')
          } else if (ev.buff === '心.心相心生') v.霆霓 = 0          // "移除心相心生状态后，清空霆霓、疾霆"
          else if (ev.buff === '心.协同') v.敕令 = 0                 // 敕令"持续时间结束移除全部层数"
          else if (ev.buff === '心.协同计时' && ev.reason === 'timeout' && ctx.buffStacks('心.协同前置') > 0) strike(ctx)
          return
      }
    },
    // 共鸣回路的状态说明（时间轴检查器）：应世相 / 照世相，心相心生、统御众机，了尘愿 / 承天则（镇红尘、镇寰宇）能不能用，
    // 电磁+1、敕令、霆霓还有几层，额外能量，场上有没有活字心锁
    forte(ctx) {
      const v = ctx.vars
      const cd = ctx.state.chars[ctx.self].cooldowns
      const parts = [v.照世 ? '照世相' : '应世相']
      if (ctx.buffStacks('心.心相心生') > 0) parts.push('心相心生')
      if (ctx.buffStacks('心.统御众机') > 0) parts.push('统御众机')
      const g = v.照世 ? '承天则' : '了尘愿'
      parts.push(`${g}${(cd[g] ?? 0) <= 0 ? '可用' : '冷却中'}`)
      if (v.电磁加一 > 0) parts.push(`电磁+1 ×${v.电磁加一}`)
      if (v.敕令 > 0) parts.push(`敕令 ${v.敕令}`)
      if (v.霆霓 > 0) parts.push(`霆霓 ${v.霆霓}`)
      if (v.额外能量) parts.push('额外能量')
      if (v.魔方至 > ctx.state.battleFrames) parts.push('活字心锁')
      return parts.join(' · ')
    },
  },
  actionOverrides: {
    // 连段（nanoka 3.7 常态攻击）：重击、空中攻击之后按普攻出第 2 段；电磁模态的变奏、共鸣技能之后出第 4 段
    A2: { comboFrom: ['A1', '重击', '空中攻击', '空中重击派生'] },
    A3: { accept: ['noLife'] },                                 // A3-特效没写持续帧：它只是"脱手后自行生成A3-1、A3-2、A3-3"，不出伤害
    延奏: { accept: ['noEnd', 'noLife'] },                      // 延奏走独立时间线（TD-05 §4.3），结束帧用不到；延奏-特效同 A3-特效
    A4: { comboFrom: ['A3', 'QTE', 'E'] },
    E: { cooldown: 720 },                                       // 共鸣技能·应世相冷却 12 秒（nanoka 3.7）
    // 第一个连上 dmg 的段（大招-异常）技能归类写的是 4（变奏），按组名是共鸣解放
    大招: { kind: 'liberation', cooldown: 1500, judgments: { '大招-异常': { applies: { effect: '电磁效应', stacks: 5 } } } },   // 转相冷却 25 秒
    // 步红尘 / 镇红尘：xlsx"第114F前霸体、不能切人，第114F解锁大招"，优先级第 1 帧升到 11、第 114 帧降到 2（两行各写了一半，装配只取到前一半）。
    // 了尘愿（倍率增幅）24 秒一次：有的时候重击就是镇红尘，所以冷却挂在镇红尘上
    强化重击: { priority: [{ fromFrame: 0, value: 5 }, { fromFrame: 1, value: 11 }, { fromFrame: 114, value: 2 }] },
    增幅强化重击: {
      priority: [{ fromFrame: 0, value: 5 }, { fromFrame: 1, value: 11 }, { fromFrame: 114, value: 2 }], cooldown: 1440, cooldownGroup: '了尘愿',
      judgments: { '增幅强化重击-异常': { applies: { effect: '电磁效应', stacks: 1 } } },
    },
    QTE: { judgments: { '电磁QTE-异常': { applies: { effect: '电磁效应', stacks: 1 } } } },
    // 照世相
    [`${P}A1`]: { dropRows: ['A1-150点核心能量'] },             // 只在有额外能量Buff时引爆魔方才给（钩子）
    [`${P}A3`]: { comboFrom: [`${P}A2`, `${P}重击`, `${P}重击-前置D`] },
    [`${P}E`]: { cooldown: 1200 },                              // 共鸣技能·照世相冷却 20 秒（nanoka 3.7）
    [`${P}强化E`]: { cooldown: 720, judgments: { '强化E-1': { applies: { effect: '电磁效应', stacks: 5 } } } },   // 万阙连衡冷却 12 秒
    [`${P}强化A1`]: { judgments: { '强化A1-赋予1层电磁': { applies: { effect: '电磁效应', stacks: 1 } } } },
    [`${P}强化A2`]: { judgments: { '强化A2-赋予1层电磁': { applies: { effect: '电磁效应', stacks: 1 } } } },
    [`${P}强化A2-闪避反击`]: { judgments: { '强化A2-赋予1层电磁': { applies: { effect: '电磁效应', stacks: 1 } } } },
    [`${P}强化A3`]: { judgments: { '强化A3-赋予1层电磁': { applies: { effect: '电磁效应', stacks: 1 } } } },
    [`${P}强化A4`]: { judgments: { '强化A4-赋予1层电磁': { applies: { effect: '电磁效应', stacks: 1 } } } },
    [`${P}增幅强化重击`]: { cooldown: 1440, cooldownGroup: '承天则', judgments: { '增幅强化重击-2': { applies: { effect: '电磁效应', stacks: 5 } } } },
    [`${P}QTE`]: { judgments: { '电磁QTE-异常': { applies: { effect: '电磁效应', stacks: 1 } } } },
  },
})
