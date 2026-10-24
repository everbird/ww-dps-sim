// data/curated/characters/景燃.ts —— 角色模块（景燃 · 尤诺 · 守岸人 队伍，2026-10-24；待确认的条目见 docs/jys-confirm.md）
// 原文：nanoka 3.7 的技能说明、xlsx 景燃块（20261019 版角色-男 R1041–R1149，"特殊能量"行的备注写了炁、命火、鬼护、行途、荧惑）。只写 0 链。
// 按生命上限换算的（幽而复明、阳变阴合、祸兮福兮、命火的倍率）都按装配时的生命上限（假设 stat-scaling-static）。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 阳：true 抱阳、false 负阴（"景燃初始处于抱阳状态"）。鬼护（上限 50）、敛神记在状态量里；
 *  命火生效：这次重击起手时在荧惑里、命火不为 0（施放资源扣命火之前判断），本次重击各段按生命上限加倍率 */
const VARS = { 阳: true, 鬼护: 25, 敛神: true, 行途: 0, 命火生效: false, 魑魅已召: false, 鬼护上次: -30, 队友盾上次: -30, 画地盾上次: -30 }
type Ctx = HookContext<typeof VARS>
const HEAVY = new Set(['阳重击', '阴重击'])
const 炁 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[0]!
const 命火 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[1]!

function gainGuard(ctx: Ctx, n: number): void {
  ctx.vars.鬼护 = Math.min(50, ctx.vars.鬼护 + n)
}

export default defineCharacter('景燃', {
  weaponType: '长刃',
  treeStats: { '暴击率': 0.08, '生命%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: {
    E: '阳E1', R: '大招', QTE: 'QTE', 延奏: '延奏-伤害',
    踏罡: '阳重击', 劫魄: '阴重击', 阳焚身: '阳E1', 往生送: '阳E2', 阴蚀骨: '阴E1', 黄泉渡: '阴E2',
  },
  vars: VARS,
  buffs: [
    // 幽而复明、阳变阴合（xlsx"每1000点生命上限转换为1层强化层数"：按整千取层数）
    {
      id: '景燃.幽而复明', source: '幽而复明：景燃基于生命上限获得热熔伤害加成提升：景燃每1000点生命上限获得1.5%热熔伤害加成提升，上限75%。',
      zone: 'DamageChangeElement', value: 0.015, filter: { elements: ['热熔'] }, scale: { stat: 'hp', per: 1000, floor: true, cap: 0.75 },
      target: 'self', duration: 'inf', trigger: 'always',
    },
    {
      id: '景燃.阳变阴合', source: '阳变阴合：景燃基于生命上限获得额外攻击：景燃每1000点生命上限获得36点攻击，上限1800。',
      zone: 'atkFlat', value: 36, scale: { stat: 'hp', per: 1000, floor: true, cap: 1800 }, target: 'self', duration: 'inf', trigger: 'always',
    },
    {
      // 变奏时由钩子按鬼护的点数加层（"消耗全部鬼护，并转化为相同层数的祸兮福兮"）
      id: '景燃.祸兮福兮', source: '祸兮福兮：每层……景燃每1000生命上限获得0.05%热熔伤害加成提升，每层最多以此方式使得景燃获得2.5%热熔伤害加成提升，持续15秒。若切换至其他角色则该效果提前结束。',
      zone: 'DamageChangeElement', value: 0.0005, filter: { elements: ['热熔'] }, scale: { stat: 'hp', per: 1000, floor: true, cap: 0.025 },
      maxStacks: 50, onSwitchOut: 'clear', target: 'self', duration: 900, trigger: 'hook',
    },
    { id: '景燃.荧惑', source: '共鸣解放：进入荧惑状态，持续15秒（xlsx"第170F获得15秒荧惑状态、15秒3层行途"）', target: 'self', duration: 900, trigger: 'hook' },
    {
      id: '景燃.破秽', source: '施放共鸣技能·阴蚀骨或共鸣技能·阳焚身时，获得破秽，持续4秒……切换至其他角色、切换至负阴 / 抱阳状态、施放黄泉渡 / 往生送时提前结束',
      target: 'self', duration: 240, onSwitchOut: 'clear', trigger: 'hook',
    },
    {
      id: '景燃.画地', source: '固有技能·贴壁听尘：施放变奏技能·挑灯问冢，共鸣技能·阴蚀骨或共鸣技能·阳焚身时可获得画地。画地：15秒内……',
      target: 'self', duration: 900, trigger: { on: 'actionStart', where: { actions: ['QTE', '阳E1', '阴E1'] } },
    },
    {
      id: '景燃.冥途满层', source: '冥途夜行之灯·5：叠至满层时，自身造成的热熔伤害提升15%。（钩子在 4 层时挂上，同层数的持续时间）',
      zone: 'DamageChange', value: 0.15, filter: { elements: ['热熔'] }, target: 'self', duration: 300, trigger: 'hook',
    },
    {
      id: '景燃.承天满层', source: '千般渡·承天：达到6层时，重击伤害的暴击提升48%（钩子在 6 层时挂上）',
      zone: 'critRate', value: 0.48, filter: { tags: ['重击'] }, target: 'self', duration: 420, onSwitchOut: 'clear', trigger: 'hook',
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const v = ctx.vars
      const form = id.startsWith('阳') ? true : id.startsWith('阴') ? false : undefined
      if (form !== undefined && form !== v.阳) return v.阳 ? '抱阳状态：动作是阳的那一套' : '负阴状态：动作是阴的那一套'
      if (HEAVY.has(id)) return 炁(ctx) >= 300 ? true : `炁 ${Math.floor(炁(ctx))} / 300`
      if (id === '阳E2' || id === '阴E2') return ctx.buffStacks('景燃.破秽') > 0 ? true : '没有破秽（先放阴蚀骨 / 阳焚身）'
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      const v = ctx.vars
      const now = ctx.state.battleFrames
      if (ev.type === 'actionStart' && ev.char === me) {
        if (HEAVY.has(ev.action)) {
          // 命火：荧惑里、命火不为 0 时这次重击按生命上限加倍率（施放资源扣 25 点在这之后）
          v.命火生效 = ctx.buffStacks('景燃.荧惑') > 0 && 命火(ctx) > 0
          v.魑魅已召 = false
          v.阳 = ev.action === '阴重击'                               // 踏罡后切换到负阴、劫魄后切换到抱阳（xlsx 第70 / 74F，按起手算）
          ctx.removeBuff('景燃.破秽')                                  // "切换至负阴状态或抱阳状态时"破秽提前结束
          // 千般渡·载物：施放重击时消耗最多 2 层，每层重击无视防御 15%
          const n = ctx.buffStacks('千般渡.载物')
          if (n > 0) {
            const k = Math.min(2, n)
            ctx.removeBuff('千般渡.载物')
            if (n > k) ctx.addBuff('千般渡.载物', { target: ctx.self, stacks: n - k })
            ctx.addBuff('千般渡.无视防御', { target: ctx.self, stacks: k })
          }
        }
        if (ev.action === '阳E1' || ev.action === '阴E1') ctx.addBuff('景燃.破秽')
        if (ev.action === '阳E2' || ev.action === '阴E2') ctx.removeBuff('景燃.破秽')
        if (ev.action === '大招') {
          v.行途 = 3
          ctx.addBuff('景燃.荧惑')
        }
        if (ev.action === 'QTE') {
          // 变奏：消耗全部鬼护，转化为相同层数的祸兮福兮
          ctx.removeBuff('景燃.祸兮福兮')
          if (v.鬼护 >= 1) ctx.addBuff('景燃.祸兮福兮', { target: ctx.self, stacks: Math.floor(v.鬼护) })
          v.鬼护 = 0
        }
        return
      }
      if (ev.type === 'outro' && ev.char === me) { v.敛神 = true; return }   // "施放延奏技能·收山出煞时，景燃获得敛神"
      if (ev.type === 'buffExpire' && ev.target === me && ev.buff === '景燃.荧惑') {
        if (命火(ctx) > 0) ctx.addResource('core2', -命火(ctx), ctx.self, '荧惑结束，清空命火')
        v.行途 = 0
        return
      }
      if (ev.type === 'hit' && ev.char === me && ev.dmg !== null) {
        // 行途："施放重击·劫魄或重击·踏罡时，获得200点炁，并减少1层行途"（xlsx 写在第 2 段：施放后额外获得）
        if ((ev.judgment === '阳重击-2' || ev.judgment === '阴重击-2') && v.行途 > 0) {
          v.行途 -= 1
          ctx.addResource('core1', 200, ctx.self, '行途')
        }
        // 荧惑：重击造成伤害时召唤魑魅魍魉，每次重击一次
        if (HEAVY.has(ev.action) && !v.魑魅已召 && ctx.buffStacks('景燃.荧惑') > 0) {
          v.魑魅已召 = true
          ctx.spawnJudgment('魑魅魍魉', { action: '魑魅魍魉', note: '荧惑：重击造成伤害' })
        }
        // 画地：景燃为登场角色时造成伤害获得护盾，每 0.5 秒一次（荧惑里额外的那份护盾同一时刻，不另算一次）
        if (ctx.buffStacks('景燃.画地') > 0 && ctx.state.onField === ctx.self && now - v.画地盾上次 >= 30) {
          v.画地盾上次 = now
          ctx.assume('module-guess', '景燃：画地的护盾每 0.5 秒算一次"获得护盾"，荧惑里额外那份护盾不另算一次')
          ctx.shield('固有技能·画地')
        }
        return
      }
      if (ev.type === 'shield') {
        if (ev.char === me) {
          // "景燃获得护盾时，可获得1点鬼护，每0.5秒可生效一次"
          if (now - v.鬼护上次 >= 30) { v.鬼护上次 = now; gainGuard(ctx, 1) }
          // 冥途夜行之灯、千般渡的满层效果（层数由套装 / 武器的触发加，这里只看满没满）
          if (ctx.buffStacks('冥途夜行之灯.5') >= 4) ctx.addBuff('景燃.冥途满层')
          if (ctx.buffStacks('千般渡.承天') >= 6) ctx.addBuff('景燃.承天满层')
        } else if (now - v.队友盾上次 >= 30) {
          // "附近队伍中除景燃以外的角色获得护盾时，景燃获得2点鬼护，每0.5秒可触发一次"；有敛神时另得 15 点并移除敛神
          v.队友盾上次 = now
          ctx.assume('module-guess', '景燃：队友获得护盾时景燃在后台也得鬼护（"附近队伍中"）')
          gainGuard(ctx, 2)
          if (v.敛神) { gainGuard(ctx, 15); v.敛神 = false }
        }
      }
    },
    modifyHit(ctx, hit) {
      // 命火：每超过 1000 点生命上限（25000 以上，最多计入 25000 点）加 FormulaParam5 的倍率（dmg 连的"强化重击"行）
      const f = hit.judgment.formula
      if (f && ctx.vars.命火生效 && HEAVY.has(ctx.state.chars[ctx.self].action?.id ?? '')) {
        const units = Math.min(25, Math.max(0, Math.floor((ctx.stat('hp') - 25000) / 1000)))
        hit.multiplier += f.rate * units
      }
    },
    forte(ctx) {
      const v = ctx.vars
      return [v.阳 ? '抱阳' : '负阴', ctx.buffStacks('景燃.荧惑') > 0 ? `荧惑 · 行途 ${v.行途}` : '', `鬼护 ${Math.floor(v.鬼护)}`].filter(Boolean).join(' · ')
    },
  },
  actionOverrides: {
    // 重击的优先级分在两行（"-1"行 7 → 5 在第 1 帧，最后一段 5 → 0 在第 78 / 76 帧），装配只取到前一半（同心的强化重击）
    阳重击: { priority: [{ fromFrame: 0, value: 7 }, { fromFrame: 1, value: 5 }, { fromFrame: 78, value: 0 }] },
    阴重击: { priority: [{ fromFrame: 0, value: 7 }, { fromFrame: 1, value: 5 }, { fromFrame: 76, value: 0 }] },
    阳E1: { cooldown: 900 },                          // 阳焚身冷却 15 秒
    阴E1: { cooldown: 900 },                          // 阴蚀骨冷却 15 秒
    // 往生送 / 黄泉渡的落地段：帧数从落地起算（下落行第 66 / 60 帧落地）
    阳E2: { shiftRows: { '阳E2-落地': 66 } },
    阴E2: { shiftRows: { '阴E2-落地': 60 } },
    大招: { cooldown: 1500, judgments: { '大招-特效': { persistsOnCancel: true } } },
    魑魅魍魉: { kind: 'other', accept: ['noEnd', 'kindGuess'] },   // 荧惑里重击命中时钩子生成，不单独施放
    '延奏-伤害': { accept: ['noEnd'] },
    特殊能量: { accept: ['noEnd', 'noPriority', 'kindGuess'] },       // 说明行
  },
})
