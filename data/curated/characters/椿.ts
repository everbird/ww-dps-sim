// data/curated/characters/椿.ts —— 角色模块（TD-08 §5.2；结论见 m0-confirm §6 C1–C3、G3）
import { defineCharacter } from '../../../src/data/define'

/** 白椿（不在盛绽）才能用的动作；盛绽状态下普攻 / 重击 / E 换成盛绽版本（"盛绽·"开头与 E2） */
const WHITE = new Set(['A1', 'A2', 'A3', 'A3-1D', 'A4', 'A5', '空中A5', '空中普攻', '重击', 'P1重击', 'E1'])
const BLOOM = (id: string) => id.startsWith('盛绽·') || id === 'E2'
const OUTRO_PLAIN = ['延奏-C0普通', '延奏-C5普通']
const OUTRO_BUD = ['延奏-C0含苞', '延奏-C0含苞追加', '延奏-C5含苞', '延奏-C5含苞追加']
const snap = (x: number) => Math.round(x * 1e9) / 1e9

export default defineCharacter('椿', {
  weaponType: '迅刀',
  treeStats: { '暴击伤害': 0.16, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: { E: 'E1', R: '大招', QTE: 'QTE' },
  buffs: [
    {
      // 一日花进入含苞，15 秒；切人或红椿·蕊耗完时提前结束（后者在钩子里）
      id: '椿.含苞', source: '共鸣回路：施放一日花时，进入含苞状态；切换至其他角色时、消耗完【红椿·蕊】时，将提前结束含苞状态',
      target: 'self', duration: 900, onSwitchOut: 'clear', trigger: { on: 'actionStart', where: { actions: ['E3'] } },
    },
    {
      // nanoka 3.7 的规则（m0-confirm §6 C2）：每消耗 10 点蕊得 1 层，15 秒，最多 10 层；一日花时清空并折算进酣梦
      id: '椿.红椿·蕾', source: '共鸣回路：每消耗10点【红椿·蕊】，回复4点协奏能量，并获得1层红椿·蕾，持续15秒，可叠加10层',
      target: 'self', maxStacks: 10, duration: 900, trigger: 'hook',
    },
    {
      id: '椿.固有1',
      source: '固有技能1：湮灭伤害加成提升15%，重击修枝伤害视为普攻伤害。（后半句见 actionOverrides.重击）',
      zone: 'DamageChangeElement', value: 0.15, filter: { elements: ['湮灭'] },
      target: 'self', duration: 'inf', trigger: 'always',
    },
    {
      id: '椿.固有2',
      source: '固有技能2：普攻伤害加成提升15%，普攻和普攻蔓舞、普攻烬华蔓舞的抗打断能力提升。',
      zone: 'DamageChangeType', value: 0.15, filter: { tags: ['普攻'] },
      target: 'self', duration: 'inf', trigger: 'always',
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const c = ctx.state.chars[ctx.self]
      const bloom = ctx.getFlag('盛绽') === true
      if (id === 'E3') return c.concerto >= 100 ? true : '一日花要协奏满'
      // 协奏满且一日花不在冷却时，共鸣技能替换为一日花
      if ((id === 'E1' || id === 'E2') && c.concerto >= 100 && !(c.cooldowns['E3'] ?? 0)) return '协奏满时共鸣技能是一日花（E3）'
      if (BLOOM(id) && !bloom) return `${id} 要在盛绽状态下`
      if (WHITE.has(id) && bloom) return `盛绽状态下 ${id} 换成了盛绽版本`
      return true
    },
    onEvent(ctx, ev) {
      if (ev.type === 'actionStart' && ev.char === '椿') {
        if (ev.action === 'E1') ctx.setFlag('盛绽', true)                       // 切人不退出盛绽（m0-confirm §6 C1）
        if (ev.action === 'E2' || ev.action === '盛绽·跳跃') ctx.setFlag('盛绽', false)
        if (ev.action === 'E3') {                                                // 清空红椿·蕾，层数折算进酣梦
          ctx.setFlag('酣梦层数', Math.min(10, ctx.buffStacks('椿.红椿·蕾')))
          ctx.removeBuff('椿.红椿·蕾')
        }
        return
      }
      if (ev.type === 'hit' && ev.char === '椿') {
        const used = -(ev.gains.core[0] ?? 0)
        if (used <= 0) return
        // 每消耗 10 点蕊：协奏 +4、红椿·蕾 +1（含苞中不得蕾）
        let acc = snap(Number(ctx.getFlag('蕊消耗') ?? 0) + used)
        const bud = ctx.buffStacks('椿.含苞') > 0
        while (acc >= 10) {
          acc = snap(acc - 10)
          ctx.addResource('concerto', 4)
          if (!bud) ctx.addBuff('椿.红椿·蕾')
        }
        ctx.setFlag('蕊消耗', acc)
        if (bud && ctx.state.chars[ctx.self].core[0] <= 0) ctx.removeBuff('椿.含苞')   // 蕊耗完，含苞提前结束
        return
      }
      // 延奏挑版本（m0-confirm §6 C3）：切走那一刻在含苞中 → 含苞 + 含苞追加，否则 → 普通。
      // 含苞在切出时就被清掉了，所以在切出那一刻记下
      if (ev.type === 'switch' && ev.from === '椿') ctx.setFlag('切走时含苞', false)
      if (ev.type === 'buffExpire' && ev.buff === '椿.含苞' && ev.reason === 'switchOut') ctx.setFlag('切走时含苞', true)
      if (ev.type === 'outro' && ev.char === '椿' && ev.instance !== undefined)
        ctx.skipJudgments(ev.instance, ctx.getFlag('切走时含苞') === true ? OUTRO_PLAIN : OUTRO_BUD)
    },
    // 消耗红椿·蕊的那几类攻击（数据里核心回收为负的，与酣梦、回能规则覆盖的是同一组）
    modifyHit(ctx, d) {
      const j = d.judgment
      if (!(j.gains.core[0] < 0)) return
      if (ctx.buffStacks('椿.含苞') > 0) {
        d.selfEnergyScale = 0                                                    // 含苞期间自己的回能降至 0%（队友不受影响，G3）
        if (j.formula) d.multiplier += j.formula.rate * (10 + Number(ctx.getFlag('酣梦层数') ?? 0))   // 酣梦 +50%，每层蕾 +5%
      } else if (ctx.state.chars[ctx.self].core[0] > 0) {
        d.selfEnergyScale = 2.5                                                  // 消耗蕊时自己的基础回能 +150%（G3）
      }
    },
  },
  actionOverrides: {
    // 固有1"重击修枝伤害视为普攻伤害"：吃普攻加成与普攻加深（TD-08 P8）；P1重击在数据里已经是普攻
    重击: { judgments: { '重击-1': { tags: ['普攻'] }, '重击-2': { tags: ['普攻'] }, '重击-3': { tags: ['普攻'] } } },
    // 共鸣技能（2026-09-27 用户说明，出处：nanoka 的共鸣技能与共鸣回路描述）：
    //   白椿状态 E1 → 变红椿（盛绽）；红椿状态 E2 → 变回白椿；E1 / E2 共用 4 秒冷却
    //   协奏满且一日花不在冷却时，E 替换为 E3 一日花（不限白椿 / 红椿），消耗 70 点协奏、进入含苞状态；
    //   一日花单独 25 秒冷却（nanoka 共鸣回路；6 链文本"独立冷却25秒的一日花"也印证）
    //   含苞状态持续 15 秒，切走或【红椿·蕊】耗完时提前结束（延奏按切走那一刻是否在含苞选版本）
    //   状态与协奏条件由角色钩子 canStart 判断（TD-08），协奏消耗归 TD-06，这里只写冷却
    E1: { cooldown: 240, cooldownGroup: 'E' },
    E2: { cooldown: 240, cooldownGroup: 'E' },
    // 一日花的优先级 [8, 5, 2] 没有变化帧：派生窗口 [78, 108) 要优先级降到 2 普攻才接得上，所以第 78 帧降到 2
    // （2026-10-04 用户确认，m0-confirm §8）；中间的 5 从哪帧起不影响普攻，取命中帧 60。E3-C6永生花 6 链才有
    E3: {
      cooldown: 1500, accept: ['chainAdditive'],
      priority: [{ fromFrame: 0, value: 8 }, { fromFrame: 60, value: 5 }, { fromFrame: 78, value: 2 }],
    },
    大招: { cooldown: 1500 },             // 共鸣解放冷却 25 秒（nanoka 3.7）
    QTE: { accept: ['priorityChangeGuess'] },       // 第 71 帧（输入锁结束）降到 1（2026-10-04 用户确认）
    延奏: { accept: ['noEnd'] },                     // 延奏走独立时间线（TD-05 §4.3），结束帧用不到
  },
})
