// data/curated/characters/桃祈.ts —— 桃祈（4 星，湮灭，长刃）。格式以 TD-08 为准
// 原文：nanoka 3.7 的技能说明、xlsx 桃祈块（20261019 版）的备注与"基础"页的共鸣链 / 固有技能文本。确认清单见 docs/tys-confirm.md。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 磐岩护壁：E 生成 3 个，持续 12 秒（3 链 30 秒，xlsx 基础页共鸣链3"由12s延长至30s"） */
const WALLS = 3
const VARS = { 护壁: 0 }
type Ctx = HookContext<typeof VARS>
const STANCES = ['桃祈.磐岩护壁', '桃祈.磐岩护壁·3链'] as const

/** 护壁转成刚柔化势（A4 全部转换、护壁到时剩下的转换）：数据只在 A4 上写了固定的 +3，按实际个数补差 */
function endWalls(ctx: Ctx): void {
  ctx.vars.护壁 = 0
  for (const id of STANCES) ctx.removeBuff(id)
}

export default defineCharacter('桃祈', {
  weaponType: '长刃',
  treeStats: { '湮灭伤害加成': 0.12, '防御%': 0.152 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '刚柔化势' },
  aliases: { E: 'E', R: '大招', QTE: 'QTE', 固若金汤: 'E', 不动如山: '大招' },
  vars: VARS,
  buffs: [
    { id: STANCES[0], source: '共鸣技能：生成3个【磐岩护壁】（持续 12 秒，xlsx 基础页）', target: 'self', duration: 720, trigger: 'hook' },
    { id: STANCES[1], source: '共鸣链3：E生成的磐岩护壁持续时间由12s延长至30s。', target: 'self', duration: 1800, trigger: 'hook' },
    {
      id: '桃祈.护心', source: '固有技能护心：E生成的磐岩护壁存在期间，获得15%防御提升buff。',
      zone: 'defPct', value: 0.15, target: 'self', duration: 'inf', trigger: 'hook',
    },
    {
      id: '桃祈.共鸣链6', source: '共鸣链6：E生成的磐岩护壁存在期间，获得40%普攻和重击伤害加成提升buff。',
      zone: 'DamageChangeType', value: 0.4, filter: { tags: ['普攻', '重击'] }, target: 'self', duration: 'inf', trigger: 'hook', requires: { chain: 6 },
    },
    {
      id: '桃祈.共鸣链2暴击', source: '共鸣链2：大招的暴击率和暴击伤害提升20%。',
      zone: 'critRate', value: 0.2, filter: { actions: ['大招'] }, target: 'self', duration: 'inf', trigger: 'always', requires: { chain: 2 },
    },
    {
      id: '桃祈.共鸣链2暴伤', source: '共鸣链2：大招的暴击率和暴击伤害提升20%。',
      zone: 'critDamage', value: 0.2, filter: { actions: ['大招'] }, target: 'self', duration: 'inf', trigger: 'always', requires: { chain: 2 },
    },
    {
      id: '桃祈.共鸣链4', source: '共鸣链4：触发后发制人后，回血25%、获得持续时间为5秒的50%防御提升buff，同时该效果进入15s冷却。',
      zone: 'defPct', value: 0.5, target: 'self', duration: 300, icd: 900, requires: { chain: 4 },
      trigger: { on: 'actionStart', where: { actions: ['后发制人'] } },
    },
    {
      id: '桃祈.共鸣链5', source: '共鸣链5：御反之隙伤害加成提升50%。',
      zone: 'DamageChangeType', value: 0.5, filter: { actions: ['御反之隙-1', '御反之隙-2', '御反之隙-3'] }, target: 'self', duration: 'inf', trigger: 'always', requires: { chain: 5 },
    },
    {
      id: '桃祈.延奏', source: '延奏：下一位登场角色共鸣技能伤害加深38%，效果持续14秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.38, filter: { tags: ['共鸣技能'] }, target: 'nextIn', duration: 840, onSwitchOut: 'clear',
      trigger: { on: 'outro' },
    },
  ],
  hooks: {
    canStart(ctx, id) {
      if (id.startsWith('御反之隙')) return ctx.state.chars[ctx.self].core[0]! >= 1 ? true : '没有刚柔化势'
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      if (ev.type === 'actionStart' && ev.char === me && ev.action === 'E') {
        endWalls(ctx)
        ctx.vars.护壁 = WALLS
        ctx.addBuff(ctx.chain >= 3 ? STANCES[1] : STANCES[0])
        ctx.addBuff('桃祈.护心')
        if (ctx.chain >= 6) ctx.addBuff('桃祈.共鸣链6')
        ctx.heal('共鸣技能：回复桃祈生命值')
        ctx.assume('module-guess', '桃祈：敌人的攻击不建模，磐岩护壁只由第 4 段普攻和到时转成刚柔化势（队友受击消耗的没算）')
        return
      }
      // 第 4 段普攻：消耗全部护壁，换成同样多的刚柔化势（数据写死 +3，按实际个数补差）
      if (ev.type === 'hit' && ev.char === me && (ev.judgment === 'A4' || ev.judgment === 'A4-后发制人派生')) {
        const diff = ctx.vars.护壁 - WALLS
        if (diff !== 0) ctx.addResource('core1', diff, ctx.self, `第 4 段普攻：护壁 ${ctx.vars.护壁} 个`)
        if (ctx.vars.护壁 > 0) { endWalls(ctx); ctx.removeBuff('桃祈.护心'); ctx.removeBuff('桃祈.共鸣链6') }
        return
      }
      // 护壁到时：剩下的换成刚柔化势
      if (ev.type === 'buffExpire' && ev.target === me && (STANCES as readonly string[]).includes(ev.buff) && ev.reason === 'timeout') {
        if (ctx.vars.护壁 > 0) ctx.addResource('core1', ctx.vars.护壁, ctx.self, '磐岩护壁到时，剩下的换成刚柔化势')
        ctx.vars.护壁 = 0
        ctx.removeBuff('桃祈.护心')
        ctx.removeBuff('桃祈.共鸣链6')
        return
      }
      // 御反之隙命中：获得护盾；5 链另回 20 能量
      if (ev.type === 'hit' && ev.char === me && ev.judgment.startsWith('御反之隙')) {
        ctx.shield('御反之隙命中')
        if (ctx.chain >= 5) ctx.addResource('energy', 20, ctx.self, '共鸣链5：御反之隙命中')
        return
      }
      if (ev.type === 'actionStart' && ev.char === me && ev.action === '后发制人' && ctx.chain >= 4) ctx.heal('共鸣链4：后发制人回血')
    },
    forte(ctx) {
      return ctx.vars.护壁 > 0 ? `磐岩护壁 ${ctx.vars.护壁}` : ''
    },
  },
  actionOverrides: {
    E: { cooldown: 900 },                                        // 固若金汤冷却 15 秒（nanoka 3.7）
    大招: { cooldown: 960, accept: ['priorityChangeGuess'] },     // 不动如山冷却 16 秒（nanoka 3.7）
    QTE: { accept: ['priorityChangeGuess'] },
    重击: { accept: ['priorityChangeGuess'] },
    闪避反击: { accept: ['priorityChangeGuess'] },
    // 优先级变化帧没写的几段：推断值照用（轴里按视频打，接不上再看）
    A3: { comboFrom: ['A2', 'A2-地面出场技'], accept: ['priorityChangeMissing'] },   // 地面出场技（普通切入按 A）是 A2，之后接 A3（录像里这样打）
    A4: { accept: ['priorityChangeMissing'] },
    'A4-后发制人派生': { accept: ['priorityChangeMissing'] },
    后发制人: { accept: ['priorityChangeMissing'] },
    蓄力: { accept: ['noEnd', 'kindGuess'] },                    // 按住普攻进磐岩守势的标记行；后发制人单列一个动作
    空中普攻: { accept: ['landingUnshifted', 'priorityChangeGuess', 'minusOneAfterEnd'] },   // 轴里不用
  },
})
