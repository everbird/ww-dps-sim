// data/curated/characters/爱弥斯.ts —— 角色模块（爱弥斯 · 琳奈 · 莫宁 / 守岸人 队伍，2026-10-25；待确认的条目见 docs/alm-confirm.md）
// 原文：nanoka 3.7 的技能说明、xlsx 爱弥斯两块（20261019 版 R3236 起的"爱弥斯"、R3383 起的"机兵爱弥斯"）「特殊能量」「共鸣模态·爱弥斯」两行的备注。
// 只写 0 链、共鸣模态·震谐（聚爆没写）。动作分两块：人形"爱弥斯"与机兵形态"机兵爱弥斯"，后者并入时动作 ID 加前缀"机兵·"（同心 / 照世心）。
// 核心资源（构建出的槽名与各行实际加的对不上，按各行改）：1 同步率（上限 200，A / E2 命中、变奏 +40、过载 +30，光翼共奏 −100，终结清空）、
// 2 共鸣率（上限 4，光翼共奏、过载各 +1，流光增幅时过载再 +1，终结清空；数据里没有，钩子加）。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

const P = '机兵·'
/** 机兵：现在是机兵形态。光翼至：光翼共奏之时（"强化E解锁前置"，A4 后 5 秒）到哪个战斗帧。流光增幅至：变奏给的流光增幅（15 秒）。
 *  增幅次数 / 增幅至：过载给的 2 层"强化E增幅次数"（星屑共振，30 秒），光翼共奏追加震谐伤害 5 → 10 次。
 *  无消耗至：过载给的"轨迹无消耗"（30 秒），下一次光翼共奏不移除震谐轨迹。释放至：星辉破界而来·于此释放（60 秒），期间过载换成终结。
 *  速蓄：于此释放期间共鸣率满时获得，蓄力到一段派生帧自动出强化重击（+200 同步率），即刻响应（重击伤害加深 200%）同期。
 *  轨迹 / 轨迹至：目标身上的震谐轨迹层数与到期战斗帧。星与星之间：已触发过的角色（槽位的位）。偏移·X：各技能上次挂偏移的战斗帧（3 秒一次） */
const VARS = {
  机兵: false, 光翼至: -1, 流光增幅至: -1, 增幅次数: 0, 增幅至: -1, 无消耗至: -1, 释放至: -1, 速蓄: false,
  轨迹: 0, 轨迹至: -1, 星与星之间: 0,
  偏移A3: -999, 偏移A4: -999, 偏移E2: -999, 偏移QTE: -999, 偏移机兵A3: -999, 偏移机兵A4: -999, 偏移机兵E2: -999, 偏移机兵QTE: -999,
}
type V = typeof VARS
type Ctx = HookContext<V>
const now = (ctx: Ctx): number => ctx.state.battleFrames
const 同步率 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[0]!
const 共鸣率 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[1]!
const 偏移帧 = 1500                       // 爱弥斯挂的偏移持续多久没写，按琳奈光致变染的 25 秒（推断）

/** 只能在人形 / 机兵形态用的（并入的动作带前缀；大招、声骸 Q、通用块的闪避两种形态都能用） */
const HUMAN = new Set(['A1', 'A2', 'A3', 'A3-1D', 'A4', '蓄力', '重击', '强化重击', '空中攻击', 'E1-常规切换机兵', 'E1-QTE切换机兵', 'E2', '强化E', 'QTE', '谐度破坏'])
/** 造成伤害时挂震谐·偏移的技能（"为寂静赋形"：A3、A4、E2、变奏，人形与机兵各算一个技能）→ 计时用的 vars 键 */
const SHIFT_BY: Record<string, keyof V> = {
  A3: '偏移A3', A4: '偏移A4', E2: '偏移E2', QTE: '偏移QTE',
  [`${P}A3`]: '偏移机兵A3', [`${P}A4`]: '偏移机兵A4', [`${P}E2`]: '偏移机兵E2', [`${P}QTE`]: '偏移机兵QTE',
}
/** 这些动作结束时（起手时）换形态：true = 变成机兵 */
const FORM_AFTER: Record<string, boolean> = {
  E2: true, 强化E: true, 'E1-常规切换机兵': true, 'E1-QTE切换机兵': true, 大招1: true,
  [`${P}E2`]: false, [`${P}强化E`]: false, [`${P}E1-常规切换爱弥斯`]: false, [`${P}E1-大招1切换爱弥斯`]: false, [`${P}E1-QTE切换爱弥斯`]: false, 大招2: false,
}

function setForm(ctx: Ctx, mech: boolean): void { ctx.vars.机兵 = mech }

/** 共鸣率加 n（上限 4）；于此释放期间满 4 → 速蓄（即刻响应） */
function addResonance(ctx: Ctx, n: number, why: string): void {
  const room = 4 - 共鸣率(ctx)
  if (room > 0) ctx.addResource('core2', Math.min(n, room), ctx.self, why)
  if (共鸣率(ctx) >= 4 - 1e-9 && now(ctx) < ctx.vars.释放至 && !ctx.vars.速蓄) {
    ctx.vars.速蓄 = true
    ctx.addBuff('爱弥斯.即刻响应')
  }
}

function endFastCharge(ctx: Ctx): void {
  ctx.vars.速蓄 = false
  ctx.removeBuff('爱弥斯.即刻响应')
}

/** 星与星之间（共鸣模态·震谐）：队伍中的角色附加震谐·偏移或造成震谐伤害时 +1 层（每名角色只触发 1 次，最多 3 层） */
function starToStar(ctx: Ctx, slot: number): void {
  const bit = 1 << slot
  if (ctx.vars.星与星之间 & bit) return
  ctx.vars.星与星之间 |= bit
  ctx.addBuff('爱弥斯.星与星之间')
  if (ctx.buffStacks('爱弥斯.星与星之间') >= 3) ctx.addBuff('爱弥斯.星与星之间·终结')
}

export default defineCharacter('爱弥斯', {
  weaponType: '迅刀',
  treeStats: { '暴击率': 0.08, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  mergeBlocks: [{ block: '机兵爱弥斯', prefix: P }],
  coreNames: { 1: '同步率', 2: '共鸣率', 3: '大招2激活' },
  coreCaps: { 1: 200, 2: 4 },
  aliases: {
    R: '大招1', QTE: 'QTE', 过载: '大招1', 终结: '大招2', 降临: '强化E', 登台: `${P}强化E`, 兵装融合: 'E2', 启明之音: `${P}E2`,
    构型切换: 'E1-常规切换机兵',
  },
  vars: VARS,
  buffs: [
    {
      id: '爱弥斯.星与星之间', source: '固有技能·星与星之间：处于共鸣模态·震谐时，队伍中的角色附加【震谐·偏移】或造成震谐伤害时，爱弥斯暴击伤害提升20%，最多可叠加3层。该效果每名角色仅可触发1次。',
      zone: 'critDamage', value: 0.2, maxStacks: 3, target: 'self', duration: 'inf', trigger: 'hook',
    },
    {
      id: '爱弥斯.星与星之间·终结', source: '……达到3层时，共鸣解放星辉破界而来·终结伤害加深25%。',
      zone: 'DamageAmplify0', value: 0.25, filter: { actions: ['大招2'] }, target: 'self', duration: 'inf', trigger: 'hook',
    },
    {
      id: '爱弥斯.即刻响应', source: '固有技能·于万籁之前：处于即刻响应状态时，重击·爱弥斯、重击·机兵造成的伤害加深200%。',
      zone: 'DamageAmplify0', value: 2, filter: { actions: ['强化重击', `${P}强化重击`] }, target: 'self', duration: 'inf', trigger: 'hook',
    },
    {
      // 光翼共奏移除震谐轨迹：每移除 1 层，追加的震谐伤害"获得2类最终伤害提升4%，持续1秒，至多叠加60层"（钩子按层数加）
      id: '爱弥斯.轨迹增幅', source: '施放强化E期间，移除目标震谐轨迹层数，每移除1层，使 强化E-震谐/震谐增幅 对目标造成伤害时获得2类最终伤害提升4%，持续1秒，该提升至多叠加60层。',
      zone: 'FinalDamage2', value: 0.04, maxStacks: 60, filter: { tags: ['震谐响应'], actions: ['强化E', `${P}强化E`] }, target: 'self', duration: 60, trigger: 'hook',
    },
    {
      id: '爱弥斯.延奏', source: '延奏技能·不可见的守候：处于共鸣模态·震谐时，队伍中除爱弥斯以外的角色全伤害加深10%，持续20秒。',
      zone: 'DamageAmplify0', value: 0.1, target: 'teamExceptSelf', duration: 1200, trigger: { on: 'outro' },
    },
    {
      // "角色附加【震谐·偏移】时，该角色的该全伤害加深效果提升至20%"：延奏期间挂了偏移的队友再加 10%（钩子挂给那个人，到延奏结束）
      id: '爱弥斯.延奏·偏移', source: '……角色附加【震谐·偏移】时，该角色的该全伤害加深效果提升至20%。',
      zone: 'DamageAmplify0', value: 0.1, target: 'self', duration: 1200, trigger: 'hook',
    },
  ],
  hooks: {
    introAction(ctx) { return ctx.vars.机兵 ? `${P}QTE` : undefined },
    canStart(ctx, id) {
      const v = ctx.vars
      const t = now(ctx)
      if (HUMAN.has(id) && v.机兵) return `机兵形态：写 ${P}${id}`
      if (id.startsWith(P) && !v.机兵) return '人形：不在机兵形态'
      if (id === '强化E' || id === `${P}强化E`) {
        if (t >= v.光翼至) return '光翼共奏要在普攻第 4 段后 5 秒内（光翼共奏之时）'
        return 同步率(ctx) >= 100 - 1e-9 ? true : `同步率 ${Math.floor(同步率(ctx))} / 100`
      }
      if (id === '大招1') return t < v.释放至 ? '于此释放期间过载换成终结（大招2）' : true
      if (id === '大招2') {
        if (t >= v.释放至) return '要在过载之后 60 秒内（于此释放）'
        return 同步率(ctx) >= 200 - 1e-9 && 共鸣率(ctx) >= 4 - 1e-9 ? true : `同步率 ${Math.floor(同步率(ctx))} / 200，共鸣率 ${共鸣率(ctx)} / 4`
      }
      if (id === '强化重击' || id === `${P}强化重击`) return v.速蓄 ? true : '强化重击要在速蓄状态（于此释放期间共鸣率满）'
      if (id === '重击' || id === `${P}重击`) return v.速蓄 ? '速蓄状态下蓄力自动出强化重击' : true
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      const v = ctx.vars
      const t = now(ctx)
      if (ev.type === 'actionStart' && ev.char === me) {
        const id = ev.action
        if (id === 'QTE' || id === `${P}QTE`) v.流光增幅至 = t + 900                    // "施放时获得流光增幅状态，持续15秒"
        if (id === 'A4' || id === `${P}A4`) v.光翼至 = t + 300                         // "施放普攻第4段时，获得光翼共奏之时，持续5秒"
        if (id === '强化E' || id === `${P}强化E`) {
          v.光翼至 = -1                                                                // "移除光翼共奏之时状态"
          addResonance(ctx, 1, '光翼共奏 +1 共鸣率')
          // 追加的震谐伤害：有增幅次数（星屑共振）时 10 次（震谐增幅），否则 5 次
          const boosted = v.增幅次数 > 0 && t < v.增幅至
          ctx.skipJudgments(ev.instance, [boosted ? '强化E-震谐' : '强化E-震谐增幅'])
          if (boosted) v.增幅次数 -= 1
        }
        if (id === '大招1') {
          addResonance(ctx, t < v.流光增幅至 ? 2 : 1, t < v.流光增幅至 ? '过载 +1 共鸣率，流光增幅再 +1' : '过载 +1 共鸣率')
          v.流光增幅至 = -1
          v.增幅次数 = 2; v.增幅至 = t + 1800; v.无消耗至 = t + 1800; v.释放至 = t + 3600
        }
        if (id === '大招2') {
          if (共鸣率(ctx) > 0) ctx.addResource('core2', -共鸣率(ctx), ctx.self, '终结清空共鸣率')
          v.释放至 = -1
          endFastCharge(ctx)
        }
        if ((id === '强化重击' || id === `${P}强化重击`) && v.速蓄) {
          ctx.addResource('core1', 200, ctx.self, '速蓄的强化重击 +200 同步率')
          endFastCharge(ctx)
        }
        if (id in FORM_AFTER) setForm(ctx, FORM_AFTER[id]!)
        return
      }
      // 光翼共奏移除震谐轨迹（"强化E-模态增益"那一刻）：每层 +4% 追加震谐伤害；轨迹无消耗期间不移除
      if (ev.type === 'judgmentSpawn' && ev.char === me && ev.judgment === '强化E-模态增益') {
        const layers = t < v.轨迹至 ? v.轨迹 : 0
        if (layers > 0) ctx.addBuff('爱弥斯.轨迹增幅', { target: ctx.self, stacks: layers })
        if (t < v.无消耗至) v.无消耗至 = -1
        else { v.轨迹 = 0; v.轨迹至 = -1 }
        return
      }
      // 震谐轨迹：队伍中的角色响应震谐·干涉时 +10 层（上限 30，30 秒）
      if (ev.type === 'enemyState' && ev.change === 'response') {
        v.轨迹 = Math.min(30, (t < v.轨迹至 ? v.轨迹 : 0) + 10)
        v.轨迹至 = t + 1800
        if (ev.by) starToStar(ctx, ctx.state.chars.findIndex(c => c.name === ev.by))
        return
      }
      if (ev.type === 'enemyState' && ev.change === 'shift' && ev.by) {
        const slot = ctx.state.chars.findIndex(c => c.name === ev.by)
        starToStar(ctx, slot)
        if (slot !== ctx.self && ctx.buffStacks('爱弥斯.延奏', slot as 0 | 1 | 2) > 0) ctx.addBuff('爱弥斯.延奏·偏移', { target: slot as 0 | 1 | 2 })
        return
      }
      // 为寂静赋形：这几个技能造成伤害时挂震谐·偏移，同一技能 3 秒一次
      if (ev.type === 'hit' && ev.char === me && ev.action in SHIFT_BY) {
        const key = SHIFT_BY[ev.action]!
        if (t - (v[key] as number) >= 180) {
          ;(v[key] as number) = t
          ctx.assume('module-guess', '爱弥斯：挂的震谐·偏移按 25 秒（原文没写时长）')
          ctx.applyShift('震谐', 偏移帧, `爱弥斯 ${ev.action}`)
        }
      }
    },
    forte(ctx) {
      const v = ctx.vars
      const t = now(ctx)
      return [v.机兵 ? '机兵' : '人形', t < v.释放至 ? '于此释放' : '', v.速蓄 ? '速蓄' : '', t < v.轨迹至 && v.轨迹 > 0 ? `轨迹 ${v.轨迹}` : '']
        .filter(Boolean).join(' · ')
    },
  },
  actionOverrides: {
    大招1: { cooldown: 1500 },
    大招2: { cooldown: 1500 },
    // 连段："施放该技能后在一定时间内短按普攻，将会施放普攻·X第n段"——变奏（人形）→ A3、变奏（机兵）→ 机兵 A3、
    // 降临 / 过载 → 机兵 A2、登台 / 启明之音 → A2、兵装融合 → 机兵 A2
    A2: { comboFrom: ['A1', `${P}强化E`, `${P}E2`] },
    A3: { comboFrom: ['A2', 'QTE', '谐度破坏'] },                 // 谐度破坏"施放后在一定时间内短按普攻，将会施放普攻第3段"
    [`${P}A2`]: { comboFrom: [`${P}A1`, '强化E', '大招1', 'E2'] },
    [`${P}A3`]: { comboFrom: [`${P}A2`, `${P}QTE`], judgments: { 'A3-2': { ticks: 3, lifeFrames: 27 }, 'A3-3': { ticks: 3, lifeFrames: 27 } } },
    // 多段被持续帧截短（"每nF一次，最多m次"比持续帧多），按 nanoka 补：降临"14.92%*6"、机兵 A1"23.20%*3"、机兵 A3"3.89%*6"
    强化E: { judgments: { '强化E-2': { ticks: 6, lifeFrames: 24 } } },
    [`${P}A1`]: { judgments: { A1: { ticks: 3, lifeFrames: 24 } } },
    // 构型切换："切换形态共享冷却1秒，立即施放机兵A1 / 爱弥斯A1"：切换本身按 1 帧写，后面接的普攻在轴里写出来
    'E1-常规切换机兵': { kind: 'skill', endFrame: 1, cooldown: 60, cooldownGroup: '构型切换' },
    'E1-QTE切换机兵': { kind: 'skill', endFrame: 1, cooldown: 60, cooldownGroup: '构型切换' },
    [`${P}E1-常规切换爱弥斯`]: { kind: 'skill', endFrame: 1, cooldown: 60, cooldownGroup: '构型切换' },
    [`${P}E1-大招1切换爱弥斯`]: { kind: 'skill', endFrame: 1, cooldown: 60, cooldownGroup: '构型切换' },
    [`${P}E1-QTE切换爱弥斯`]: { kind: 'skill', endFrame: 1, cooldown: 60, cooldownGroup: '构型切换' },
    // 蓄力：速蓄状态下"蓄力达到一段派生帧后自动施放强化重击"（人形一段派生第 40 帧、机兵第 40 帧）；不速蓄时到二段（第 94 / 100 帧）
    蓄力: { kind: 'heavy', cancelWindows: [{ from: 40, until: 94 }], accept: ['chainAdditive'] },
    [`${P}蓄力`]: { kind: 'heavy', cancelWindows: [{ from: 40, until: 100 }], accept: ['chainAdditive'] },
    强化重击: { comboFrom: ['蓄力'], accept: ['chainAdditive'] },
    [`${P}强化重击`]: { comboFrom: [`${P}蓄力`], accept: ['chainAdditive'] },
    // 震谐响应：由引擎在震谐·干涉时生成（TD-06 §19），不单独施放；出现帧、持续帧没写
    震谐响应: { kind: 'other', accept: ['noEnd', 'kindGuess'], judgments: { 震谐响应: { spawnFrame: 0, lifeFrames: 6 } } },
    // 轴里用不到的
    'A3-1D': { accept: ['priorityChangeMissing'] },
    空中攻击: { accept: ['multiEnd'] },
    [`${P}空中攻击`]: { accept: ['multiEnd'] },
    特殊能量: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    '共鸣模态·爱弥斯': { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    [`${P}地面闪避`]: { accept: ['dirVariant'] },
    [`${P}空中闪避`]: { accept: ['dirVariant'] },
    [`${P}极限闪避`]: { accept: ['dirVariant'] },
    [`${P}探索工具-流光突进`]: { kind: 'other', accept: ['kindGuess'] },
  },
})
