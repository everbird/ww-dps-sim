// data/curated/characters/渊武.ts —— 渊武（4 星，导电，臂铠）。格式以 TD-08 为准
// 原文：nanoka 3.7 的技能说明、xlsx 渊武块（20261019 版）的备注与"基础"页的共鸣链 / 固有技能文本。确认清单见 docs/tys-confirm.md。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 雷之楔（雷柱）：存在 12 秒（xlsx 雷柱-召唤"立即获得12秒存在时间，期间每秒获得6核心能量"）。只建一根：再放刷新 */
const PILLAR = 720
/** 雷柱协同攻击的内置冷却（xlsx 雷柱-协同"内置CD1.2秒"） */
const COORD_CD = 72
const VARS = { 雷柱到: -1, 协同冷却到: -1, 掀雷已放: false }
type Ctx = HookContext<typeof VARS>

const pillarUp = (ctx: Ctx): boolean => ctx.state.battleFrames < ctx.vars.雷柱到
const rage = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[0]!
const thunder = (ctx: Ctx): boolean => ctx.buffStacks('渊武.雷厉风行') > 0

/** 立起一根雷柱（E 的第 18 帧、或敛光切走时自动留下） */
function plant(ctx: Ctx, note: string): void {
  ctx.spawnJudgment('雷柱-召唤', { note })
  ctx.vars.雷柱到 = ctx.state.battleFrames + PILLAR
  ctx.vars.掀雷已放 = false
  ctx.removeBuff('渊武.雷柱计时')
  ctx.addBuff('渊武.雷柱计时')
}
/** 万壑雷、大招：引爆场上的雷柱 */
function detonate(ctx: Ctx, why: string): void {
  if (!pillarUp(ctx)) return
  ctx.spawnJudgment('雷柱-引爆', { note: why })
  ctx.vars.雷柱到 = -1
  ctx.removeBuff('渊武.雷柱计时')
}

export default defineCharacter('渊武', {
  weaponType: '臂铠',
  treeStats: { '导电伤害加成': 0.12, '防御%': 0.152 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '锋芒' },
  aliases: { E: 'E短按', R: '大招', QTE: 'QTE', 拳震凌武: 'E短按', 万壑雷: 'E长按' },
  vars: VARS,
  buffs: [
    { id: '渊武.雷柱计时', source: '雷柱-召唤：期间每秒获得6核心能量（钩子每 60 帧加一次）', target: 'self', duration: 60, trigger: 'hook' },
    {
      // 万壑雷"10s强化状态"；大招"为附近队伍中所有角色提供雷厉风行状态，持续10秒"——对别人只有抗打断，只给渊武记
      id: '渊武.雷厉风行', source: '雷厉风行：渊武普攻、重击换成强化版；施放重击后3秒内短按普攻施放蹑风追雷；不会回复锋芒。持续10秒',
      target: 'self', duration: 600, trigger: { on: 'actionStart', where: { actions: ['E长按', '大招'] } },
    },
    {
      id: '渊武.追击', source: '强化重击：获得3s追击tag（施放重击后3秒内短按普攻，将会施放蹑风追雷）',
      target: 'self', duration: 180, trigger: { on: 'actionStart', where: { actions: ['强化重击'] } },
      consume: { on: 'actionStart', where: { actions: ['强化重击-追击1'] } },
    },
    {
      id: '渊武.共鸣链5', source: '共鸣链5：场上存在雷柱时，施放大招后获得持续时间为5秒的50%大招伤害加成提升buff。',
      zone: 'DamageChangeType', value: 0.5, filter: { tags: ['共鸣解放'] }, target: 'self', duration: 300, trigger: 'hook', requires: { chain: 5 },
    },
    {
      id: '渊武.共鸣链6', source: '共鸣链6：处于雷柱范围内时，全队获得持续时间为3秒的32%防御提升buff。',
      zone: 'defPct', value: 0.32, target: 'team', duration: 180, trigger: 'hook', requires: { chain: 6 },
    },
    // 延奏驱雷只削白条（xlsx 延奏-削白条"7.5%白条伤害"），没有伤害
  ],
  resourceEffects: [
    {
      id: '渊武.共鸣链2', source: '共鸣链2：变奏后，额外获得15大招能量。',
      resource: 'energy', amount: 15, requires: { chain: 2 }, trigger: { on: 'actionStart', where: { actions: ['QTE'] } },
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const on = thunder(ctx)
      if (id === 'E长按') return rage(ctx) >= 100 ? true : '锋芒不满 100'
      if (id === '强化重击-追击1') return ctx.buffStacks('渊武.追击') > 0 ? true : '强化重击后 3 秒内才有蹑风追雷'
      if (/^强化(A\d|重击)$/.test(id)) return on ? true : '不在雷厉风行状态'
      if (/^(A\d|重击)$/.test(id)) return on ? '雷厉风行状态里普攻、重击是强化版' : true
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      const now = ctx.state.battleFrames
      // E 第 18 帧立柱：E短按并进了雷柱组，"雷柱-召唤"按第 18 帧生成（见 actionOverrides）；这里只记存在时间
      if (ev.type === 'judgmentSpawn' && ev.char === me && ev.judgment === '雷柱-召唤' && ev.action === 'E短按') {
        ctx.vars.雷柱到 = now + PILLAR
        ctx.vars.掀雷已放 = false
        ctx.removeBuff('渊武.雷柱计时')
        ctx.addBuff('渊武.雷柱计时')
        return
      }
      if (ev.type === 'actionStart' && ev.char === me) {
        if (ev.action === 'E长按') detonate(ctx, '万壑雷引爆雷柱')
        if (ev.action === '大招') {
          if (pillarUp(ctx)) ctx.addBuff('渊武.共鸣链5')
          detonate(ctx, '大招引爆雷柱')
          if (ctx.chain >= 4) for (const c of ctx.state.chars) ctx.shield('共鸣链4：大招护盾', c.slot)
        }
        return
      }
      // 每秒 +6 锋芒（渊武在后台也算；雷厉风行里不回）；6 链全队防御
      if (ev.type === 'buffExpire' && ev.buff === '渊武.雷柱计时' && ev.target === me && ev.reason === 'timeout') {
        if (!pillarUp(ctx)) return
        if (!thunder(ctx)) ctx.addResource('core1', 6, ctx.self, '雷柱每秒 +6 锋芒')
        if (ctx.chain >= 6) ctx.addBuff('渊武.共鸣链6', { target: ctx.state.onField })
        ctx.addBuff('渊武.雷柱计时')
        return
      }
      // 锋芒充满：雷柱放一次掀雷（"雷柱-充能完毕"，连 P1 版；固有1 另加 50% 防御，见 modifyHit）
      if (ev.type === 'resource' && ev.char === me && ev.resource === 'core1' && ev.value >= 100 && pillarUp(ctx) && !ctx.vars.掀雷已放) {
        ctx.vars.掀雷已放 = true
        ctx.spawnJudgment('雷柱-充能完毕', { note: '锋芒充满：掀雷' })
        return
      }
      if (ev.type === 'resource' && ev.char === me && ev.resource === 'core1' && ev.value < 100) ctx.vars.掀雷已放 = false
      // 雷池：登场角色的攻击命中时，雷柱协同攻击（每 1.2 秒一次）。打单体，按登场角色一直在雷池里算——每次命中都能触发（2026-10-26 用户确认）
      if (ev.type === 'hit' && ev.dmg && pillarUp(ctx) && now >= ctx.vars.协同冷却到 && !ev.judgment.startsWith('雷柱')) {
        const onField = ctx.state.chars[ctx.state.onField]!.name
        if (ev.char !== onField) return
        ctx.vars.协同冷却到 = now + COORD_CD
        ctx.spawnJudgment('雷柱-协同', { note: `雷池：${ev.char} ${ev.judgment}` })
        return
      }
      // 敛光：锋芒没充满时切到后台，原地留下一根雷柱
      if (ev.type === 'switch' && ev.from === me && rage(ctx) < 100) plant(ctx, '敛光：切走时锋芒没满，自动留下雷柱')
    },
    modifyHit(ctx, hit) {
      // 固有1：掀雷附加当前防御 50% 的额外伤害；3 链：雷柱协同附加当前防御 20%（面板按装配时的静态值，假设 stat-scaling-static）
      if (hit.judgment.name === '雷柱-充能完毕') hit.extraFlat += 0.5 * ctx.stat('def')
      if (hit.judgment.name === '雷柱-协同' && ctx.chain >= 3) hit.extraFlat += 0.2 * ctx.stat('def')
    },
    forte(ctx) {
      return [pillarUp(ctx) ? `雷柱 ${((ctx.vars.雷柱到 - ctx.state.battleFrames) / 60).toFixed(1)} 秒` : '', thunder(ctx) ? '雷厉风行' : ''].filter(Boolean).join(' · ')
    },
  },
  actionOverrides: {
    // E短按并进雷柱组：第 18 帧立柱（xlsx E短按"第18F柱来！并获得3点协奏能量"）；拳震凌武冷却 3 秒（nanoka）
    E短按: { absorb: ['雷柱'], cooldown: 180, judgments: { '雷柱-召唤': { spawnFrame: 18 } }, accept: ['noLife', 'persistsGuess'] },
    雷柱: { kind: 'other', accept: ['noEnd', 'noPriority', 'noLife', 'persistsGuess', 'kindGuess'] },
    大招: { cooldown: 1200 },                                    // 寂土重明冷却 20 秒（nanoka 3.7）
    QTE: { accept: ['priorityChangeGuess'] },
    'A4-1D': { accept: ['priorityChangeGuess'] },
    强化闪避反击: { accept: ['priorityChangeGuess'] },
    空中普攻: { accept: ['landingUnshifted', 'priorityChangeGuess'] },   // 轴里不用
    '延奏-削白条': { accept: ['noEnd', 'noPriority'] },
  },
})
