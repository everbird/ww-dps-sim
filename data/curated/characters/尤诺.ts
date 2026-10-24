// data/curated/characters/尤诺.ts —— 角色模块（景燃 · 尤诺 · 守岸人 队伍，2026-10-24；待确认的条目见 docs/jys-confirm.md）
// 原文：nanoka 3.7 的技能说明、xlsx 尤诺块（20261019 版角色-女 R2750–R2855）的备注。只写 0 链。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 月相：0 不在月相流转、1 弦月（月环）、2 新月（月弓）。告终解锁至：告终的喧响可用到哪个战斗帧（"持续5秒"）。
 *  祝颂上次：满月领域给登场角色加苍白死光的祝颂"每0.5秒可触发一次"的计时 */
const VARS = { 月相: 0, 告终解锁至: -1, 祝颂上次: -30 }
type Ctx = HookContext<typeof VARS>
const 月相动作 = new Set(['E2', '大招'])                     // "通过施放共鸣技能·告终的喧响或共鸣解放进入月相流转状态"
const 解锁告终 = new Set(['环A3', 'E1', 'QTE'])               // "不处于月相流转状态时，施放月环·普攻第3段、变奏技能或原初的律动时……替换为告终的喧响，持续5秒"
/** 固有技能·盈昇："每次施放普攻、重击、闪避反击、共鸣技能、共鸣解放、变奏技能时"获得护盾（闪避、声骸技能不算） */
const 给护盾 = (id: string): boolean => /^(环A|弓A|强化弓A|空中攻击|E\d|强化E3|跳跃|至臻完满|大招|QTE)/.test(id)

function setMoon(ctx: Ctx, phase: number): void {
  ctx.vars.月相 = phase
  if (phase === 0) ctx.removeBuff('尤诺.月相流转')
}

/** 月弓的箭矢命中后生成爆炸（xlsx"箭矢命中后立即生成爆炸"）：飞行时间不建模，箭矢结算的当帧生成。
 *  弓A2 三支箭各一次"弓A2-爆炸"（"55.67%*3"）；越限的弦引一支箭，爆炸2 在爆炸1 之后 28 帧（判定的"延迟"） */
function explode(ctx: Ctx, action: string, arrow: string): void {
  const names = /E3-箭矢$/.test(arrow) ? [arrow.replace('箭矢', '爆炸1'), arrow.replace('箭矢', '爆炸2')]
    : [arrow.replace(/箭矢(\d?)(D?)$/, (_, n: string, d: string) => (/弓A2/.test(arrow) ? `爆炸${d}` : `爆炸${n}${d}`))]
  ctx.assume('module-guess', '尤诺：月弓的箭矢不算飞行时间，箭矢结算的当帧生成爆炸')
  for (const n of names) ctx.spawnJudgment(n, { action, note: '箭矢命中' })
}

export default defineCharacter('尤诺', {
  weaponType: '臂铠',
  treeStats: { '暴击率': 0.08, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: { E: 'E1', R: '大招', QTE: 'QTE', 越限的弦引: '强化E3', 至臻的完满: '至臻完满', 流变月弓: '跳跃-变弓', 流变月环: '跳跃' },
  vars: VARS,
  buffs: [
    { id: '尤诺.月相流转', source: '共鸣回路：月相流转持续时间 15 秒', target: 'self', duration: 900, trigger: 'hook' },
    // 满月领域：至臻的完满展开，30 秒（xlsx"至臻完满-前置：第1F获得30秒领域状态"）
    { id: '尤诺.满月领域', source: '重击·至臻的完满：以自身为中心展开满月领域（满月领域持续时间 30 秒）', target: 'self', duration: 1800, trigger: 'hook' },
    {
      // 加在获得护盾的登场角色身上（钩子），切走提前结束
      id: '尤诺.苍白死光的祝颂', source: '苍白死光的祝颂：角色全伤害加深4%，持续10秒，可叠加10层，重复添加时刷新持续时间。若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.04, maxStacks: 10, onSwitchOut: 'clear', target: 'self', duration: 600, trigger: 'hook',
    },
    {
      id: '尤诺.延奏', source: '延奏技能·晦渡为明：……下一个登场角色重击伤害加深50%，持续14秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.5, filter: { tags: ['重击'] }, onSwitchOut: 'clear', target: 'nextIn', duration: 840, trigger: { on: 'outro' },
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const v = ctx.vars
      const spirit = ctx.state.chars[ctx.self].core[0]!          // 灵性
      const now = ctx.state.battleFrames
      const full = ctx.state.chars[ctx.self].concerto >= ctx.rules.concertoMax
      switch (id) {
        case 'E1': return v.月相 === 0 && now >= v.告终解锁至 ? true : v.月相 === 0 ? '告终的喧响可用：共鸣技能是 E2' : '月相流转里共鸣技能是未终的喧响 / 越限的弦引'
        case 'E2': return v.月相 === 1 || (v.月相 === 0 && now < v.告终解锁至) ? true : v.月相 === 2 ? '新月：共鸣技能是越限的弦引' : '没有解锁告终的喧响'
        case 'E3': return v.月相 === 2 ? (spirit < 25 ? true : '有灵性时是强化越限的弦引') : '不在新月'
        case '强化E3': return v.月相 === 2 ? (spirit >= 25 ? true : '灵性不足 25') : '不在新月'
        case '跳跃-变弓': return v.月相 === 1 ? true : '不在弦月'
        case '跳跃': return v.月相 === 2 ? true : '不在新月（月相流转外跳跃不是重击·流变，不建）'
        case '至臻完满': return full ? true : '协奏没满'
      }
      const bow = /^(强化)?弓A(\d)/.exec(id)
      if (bow) {
        if (v.月相 !== 2) return '月弓·普攻要在新月'
        const cost = [10, 15, 25][Number(bow[2]) - 1]!
        if (bow[1]) return spirit >= cost ? true : `灵性不足 ${cost}`
        return spirit < cost ? true : '有灵性时是强化的月弓·普攻'
      }
      if (/^环A/.test(id) && v.月相 === 2) return '新月里普攻是月弓'
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      const v = ctx.vars
      if (ev.type === 'actionStart' && ev.char === me) {
        // 变奏的护盾放到 intro 事件之后给：先让万物持存的注释"施放变奏技能时……视为满层"生效，再走护盾的 0.5 秒内置冷却
        if (给护盾(ev.action) && ev.action !== 'QTE') ctx.shield('固有技能·盈昇')
        if (月相动作.has(ev.action)) {
          if (v.月相 === 0) v.月相 = 1
          ctx.addBuff('尤诺.月相流转')                           // 进入或刷新 15 秒
        }
        if (ev.action === '跳跃-变弓') v.月相 = 2
        if (ev.action === '跳跃') v.月相 = 1
        if (ev.action === '至臻完满') {
          setMoon(ctx, 0)                                        // "结束自身的月相流转状态"（xlsx 第30F，按起手算）
          ctx.addBuff('尤诺.满月领域')
          ctx.heal('重击·至臻的完满')
        }
        if (解锁告终.has(ev.action) && v.月相 === 0) v.告终解锁至 = ctx.state.battleFrames + 300
        // 固有技能·新衍：施放变奏技能或共鸣解放时，自身直接获得 5 层苍白死光的祝颂
        if (ev.action === 'QTE' || ev.action === '大招') ctx.addBuff('尤诺.苍白死光的祝颂', { target: ctx.self, stacks: 5 })
        return
      }
      if (ev.type === 'intro' && ev.char === me) { ctx.shield('固有技能·盈昇'); return }
      if (ev.type === 'hit' && ev.char === me && /箭矢\d?D?$/.test(ev.judgment)) { explode(ctx, ev.action, ev.judgment); return }
      if (ev.type === 'buffExpire' && ev.target === me && ev.buff === '尤诺.月相流转' && ev.reason === 'timeout') { v.月相 = 0; return }
      // 满月领域：处于领域中的登场角色获得护盾时，获得一层苍白死光的祝颂（每 0.5 秒一次）；打单体时登场角色都在领域里
      if (ev.type === 'shield' && ctx.buffStacks('尤诺.满月领域') > 0) {
        const slot = ctx.state.chars.findIndex(c => c.name === ev.char)
        const now = ctx.state.battleFrames
        if (slot === ctx.state.onField && now - v.祝颂上次 >= 30) {
          v.祝颂上次 = now
          ctx.addBuff('尤诺.苍白死光的祝颂', { target: slot as 0 | 1 | 2 })
        }
      }
    },
    forte(ctx) {
      return ['', '月相流转·弦月', '月相流转·新月'][ctx.vars.月相]! + (ctx.buffStacks('尤诺.满月领域') > 0 ? ' · 满月领域' : '')
    },
  },
  actionOverrides: {
    E1: { cooldown: 360, judgments: { 'E1-1': { ticks: 7, lifeFrames: 25 } } },   // 原初的律动 6 秒；"每4F一次，最多7次"在 24 帧里只排得下 6 次（nanoka"18.65%*7"）
    E2: { cooldown: 480, accept: ['priorityChangeGuess'] },              // 告终与未终的喧响共用 8 秒
    // 越限的弦引：初始 2 次、10 秒回 1 次（按次数充能）；强化版消耗灵性，共用次数。爆炸2 在爆炸1 之后 28 帧
    E3: { cooldown: 600, cooldownGroup: '越限的弦引', charges: 2, judgments: { 'E3-爆炸2': { delayFrames: 28 } } },
    强化E3: { cooldown: 600, cooldownGroup: '越限的弦引', charges: 2, judgments: { '强化E3-爆炸2': { delayFrames: 28 } }, accept: ['priorityChangeGuess'] },
    // 至臻的完满：协奏满时的重击（xlsx 类别空着），满月领域 25 秒最多一次
    至臻完满: { kind: 'heavy', cooldown: 1500 },
    QTE: { judgments: { 'QTE-1': { ticks: 7, lifeFrames: 25 } }, accept: ['priorityChangeGuess'] },   // "每4F一次，最多7次"（nanoka"15.91%*7"）
    大招: { cooldown: 1500, accept: ['priorityChangeGuess'] },
    跳跃: { accept: ['dilationStartGuess'] },
    '跳跃-变弓': { accept: ['dilationStartGuess'] },
    空中攻击: { accept: ['landingUnshifted', 'multiEnd'] },              // 轴里不用
    '环A2-1D': { accept: ['priorityChangeMissing'] },
    漫溯巡游: { kind: 'dodge', accept: ['multiEnd'] },
    月相状态: { accept: ['noEnd', 'noPriority', 'kindGuess'] },          // 状态说明行，不是动作
    领域状态: { accept: ['noEnd', 'noPriority', 'kindGuess', 'persistsGuess'] },
  },
})
