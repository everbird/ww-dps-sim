// data/curated/characters/雷主·男.ts —— 漂泊者·导电（男）（心 · 雷主 · 卜灵 队伍，2026-10-19；待确认的条目见 docs/xin-confirm.md）
// 原文：nanoka 3.7 的技能说明、xlsx 雷主块「特殊能量」行的备注（R1024）与 characters.json 的共鸣链 / 固有文本。
// 只写到 1 链：2 链"大招命中后附加 5 层电磁效应"、3 / 4 / 6 链的倍率提升、5 链临界共鸣的暴伤、临界共鸣（长按超负荷）本身都没写。
import { defineCharacter } from '../../../src/data/define'

/** 超负荷（强化E）的四个版本：地面 / 空中 × 短按 / 长按 */
const OVERLOAD = ['强化E', '强化E-长按超负荷', '空中强化E', '空中强化E-长按']
const SHORT = ['强化E', '空中强化E']
const LONG = ['强化E-长按超负荷', '空中强化E-长按']
/** 固有1：超负荷第 3 段命中后附加 10 层电磁效应 */
const P1 = { judgments: { '强化E-3': { applies: { effect: '电磁效应' as const, stacks: 10 } } } }

export default defineCharacter('雷主·男', {
  weaponType: '迅刀',
  treeStats: { '暴击率': 0.08, '攻击%': 0.12 },     // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreCaps: { 1: 120, 2: 100 },                     // 电涌上限 120、霆怒上限 100（主表按 ×100 写成 12000 / 10000，TD-01 Q22）
  aliases: { E: 'E', R: '大招', QTE: 'QTE', 超负荷: '强化E' },
  buffs: [
    {
      // xlsx 伤害配置 R622"共鸣回路·短按强化E 全队攻击+10%"；特殊能量备注"短按施放结束后，20秒内全队攻击+10%"：按第 3 段（第 114 帧）出手算
      id: '雷主·男.超负荷', source: '短按施放共鸣技能超负荷，造成导电伤害，随后清空【电涌】并使队伍中的角色获得10%攻击加成，持续20秒。',
      zone: 'atkPct', value: 0.1, target: 'team', duration: 1200,
      trigger: { on: 'judgmentSettle', where: { actions: SHORT, judgments: ['强化E-3'] } },
    },
    {
      id: '雷主·男.固有2', source: '固有技能2：长按施放共鸣技能超负荷后，自身共鸣技能伤害加成提升20%，持续20秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageChangeType', value: 0.2, filter: { tags: ['共鸣技能'] }, target: 'self', duration: 1200, onSwitchOut: 'clear',
      trigger: { on: 'actionStart', where: { actions: LONG } },
    },
    // 延奏（xlsx 伤害配置 R281"变奏出场角色尝试赋予异常效应后全伤害加深+25%"）：下一位登场角色得电髓（20 秒，切走移除）；
    // 持有电髓的角色附加异常效应后，用掉电髓、全伤害加深 25%（14 秒，切走移除）。谁附加的要看事件，由钩子处理
    {
      id: '雷主·男.电髓', source: '延奏：下一位登场角色获得电髓，持续20秒，切换至其他角色时，移除电髓',
      target: 'nextIn', duration: 1200, onSwitchOut: 'clear', trigger: { on: 'outro' },
    },
    {
      id: '雷主·男.延奏', source: '持有电髓的角色附加异常效应后，消耗电髓并获得全伤害加深25%，持续14秒，切换至其他角色时，该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.25, target: 'nextIn', duration: 840, onSwitchOut: 'clear', trigger: 'hook',
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const c = ctx.state.chars[ctx.self]
      // xlsx 大招备注"结束帧前禁用E技能"
      if ((id === 'E' || OVERLOAD.includes(id)) && c.action?.id === '大招') return '大招结束前不能放共鸣技能'
      // "【电涌】达到上限时，共鸣技能替换为共鸣技能超负荷"
      if (id === 'E') return c.core[0] < 120 ? true : '电涌满了，共鸣技能是超负荷（强化E）'
      if (OVERLOAD.includes(id)) return c.core[0] >= 120 ? true : `超负荷要电涌满（${Math.floor(c.core[0])} / 120）`
      return true
    },
    onEvent(ctx, ev) {
      // 电髓：持有者附加异常效应后换成全伤害加深（雷主自己的事件不算：电髓在下一位登场的角色身上）
      if (ev.type !== 'enemyState' || ev.change !== 'effectApplied' || ev.by === undefined) return
      const slot = ctx.state.chars.findIndex(c => c.name === ev.by) as 0 | 1 | 2
      if (ctx.buffStacks('雷主·男.电髓', slot) === 0) return
      ctx.removeBuff('雷主·男.电髓', slot)
      ctx.addBuff('雷主·男.延奏', { target: slot })
    },
  },
  actionOverrides: {
    E: {
      cooldown: 600,                                // 共鸣技能冷却 10 秒（nanoka 3.7）
      // E-落地是落地后的标记行，它的派生窗口从落地起算；只留 E-伤害的窗口
      cancelWindows: [{ from: 28, until: 116 }],
      accept: ['multiEnd'],
    },
    // 共鸣解放冷却 25 秒（nanoka 3.7）；"大招-全局时停"的类型格空着，按行名推断为全局时停 224 帧（行名就是"全局时停"，
    // WuwaLAB 也记 time_stop 224；2026-10-22，docs/engine-quality-plan.md §5 P5）
    大招: { cooldown: 1500, accept: ['dilationTypeGuess'] },
    // 超负荷冷却 25 秒（nanoka 3.7"超负荷冷却时间"），四个版本共用
    强化E: { cooldown: 1500, cooldownGroup: '超负荷', ...P1 },
    '强化E-长按超负荷': { cooldown: 1500, cooldownGroup: '超负荷', ...P1 },
    空中强化E: { cooldown: 1500, cooldownGroup: '超负荷', ...P1 },
    '空中强化E-长按': { cooldown: 1500, cooldownGroup: '超负荷', ...P1 },
    // "持续帧内每6F进行一次判定"没写次数，持续 36 帧按规则只排得下 6 次；nanoka 3.7"13.27%*7"、WuwaLAB 第 30–66 帧 7 下，
    // 第 7 下正好在持续帧末尾：改 7 次、持续帧放到 37（2026-10-24，pnpm check:data --flags 的 nanoka 段数核对）
    A3: { judgments: { A3: { ticks: 7, lifeFrames: 37 } } },
    // 普攻第 4 段先跳起（A4-下落，46 帧落地），两段落地伤害的帧数从落地起算
    A4: { shiftRows: { 'A4-落地1': 46, 'A4-落地2': 46 } },
  },
})
