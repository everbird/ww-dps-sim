// data/curated/characters/莫特斐.ts —— 莫特斐（4 星，热熔，佩枪）。格式以 TD-08 为准
// 原文：nanoka 3.7 的技能说明、xlsx 莫特斐块（20261019 版角色-男 R383–R402）。确认清单见 docs/jms-confirm.md。
import type { BuffDefInput } from '../../../src/data/buff.schema'
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 协同攻击的公用冷却：xlsx 大招-协同状态"全队共用【冷却+总冷却】 = 0.38秒"（冷却 2 帧 + 总冷却 21 帧；nanoka"每0.35秒可进行1次"） */
const COORD_CD = 23
/** 协同状态（浮翼狂想）：大招第 60 帧获得（xlsx 大招-前置），10 秒；4 链 17 秒 */
const STATES = ['莫特斐.浮翼狂想', '莫特斐.浮翼狂想·4链'] as const
/** 激昂变奏、怒火赋格、变奏的火焰闪电：前置（飞行的那一段，没有伤害）"持续帧结束或碰撞立即爆炸"，爆炸由钩子在前置生成时生成 */
const BLASTS: Readonly<Record<string, string>> = { 'E1-前置': 'E1-爆炸', 'E2-前置': 'E2-爆炸', 'QTE-前置': 'QTE-爆炸' }
const NOTE = '浮翼狂想期间普攻命中给 1 发加强音、重击命中给 2 发'
const VARS = { 协同冷却到: -1 }
type Ctx = HookContext<typeof VARS>

const inState = (ctx: Ctx): boolean => STATES.some(id => ctx.buffStacks(id) > 0)
/** 打出 n 发加强音（action：1 链 / 5 链的额外加强音另有动作，见 actionOverrides 的 copyAs） */
function shoot(ctx: Ctx, n: number, action: string, note: string): void {
  for (let k = 0; k < n; k++) ctx.spawnJudgment('协同-加强音', { action, note })
}
/** 受公用冷却限制的协同攻击：冷却中不打 */
function coordinated(ctx: Ctx, n: number, action: string, note: string): void {
  const now = ctx.state.battleFrames
  if (now < ctx.vars.协同冷却到) return
  ctx.vars.协同冷却到 = now + COORD_CD
  shoot(ctx, n, action, note)
}

const stateBuffs: BuffDefInput[] = [
  { id: STATES[0], source: '共鸣解放：为队伍中所有角色附加浮翼狂想（持续时间10秒）', target: 'self', duration: 600, trigger: 'hook' },
  { id: STATES[1], source: '共鸣链4：共鸣解放浮翼狂想的持续时间延长7秒', target: 'self', duration: 1020, trigger: 'hook' },
]

export default defineCharacter('莫特斐', {
  weaponType: '佩枪',
  treeStats: { '热熔伤害加成': 0.12, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '怒气值' },
  aliases: { E: 'E1', R: '大招', QTE: 'QTE', 激昂变奏: 'E1', 怒火赋格: 'E2' },
  vars: VARS,
  buffs: [
    ...stateBuffs,
    {
      id: '莫特斐.激昂', source: '怒气值获取规则：施放激昂变奏后5秒内，常态攻击即兴发挥命中目标时，额外回复【怒气值】（xlsx E1-前置"5s内每段A额外获得7核心能量"）',
      target: 'self', duration: 300, trigger: { on: 'actionStart', where: { actions: ['E1'] } },
    },
    {
      id: '莫特斐.密接和应', source: '固有技能密接和应：施放共鸣技能激昂变奏后8秒内，共鸣技能怒火赋格的伤害提升25%。',
      zone: 'DamageChange', value: 0.25, filter: { judgments: ['E2-爆炸'] },
      target: 'self', duration: 480, trigger: { on: 'actionStart', where: { actions: ['E1'] } },
    },
    {
      // "命中后……使下次的加强音伤害提升"：这一发结算之后才加层；1、5 链的额外加强音同样算（xlsx 固有2）。协同状态结束时钩子清掉
      id: '莫特斐.节奏自由', source: '固有技能节奏自由：每次共鸣解放加强音命中后，都会使下次的共鸣解放加强音伤害提升1.5%，每0.35秒可触发1次，上限50层。共鸣解放浮翼狂想结束后重置效果层数。',
      zone: 'DamageChange', value: 0.015, filter: { judgments: ['协同-加强音'] }, maxStacks: 50, icd: 21,
      target: 'self', duration: 'inf', trigger: { on: 'judgmentSettle', where: { judgments: ['协同-加强音'] } },
    },
    {
      id: '莫特斐.延奏', source: '延奏：下一位登场角色重击伤害加深38%，效果持续14秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.38, filter: { tags: ['重击'] }, target: 'nextIn', duration: 840, onSwitchOut: 'clear',
      trigger: { on: 'outro' },
    },
    {
      id: '莫特斐.共鸣链3', source: '共鸣链3：共鸣解放浮翼狂想持续期间，共鸣解放加强音的暴击伤害提升30%。',
      zone: 'critDamage', value: 0.3, filter: { judgments: ['协同-加强音'] }, target: 'self', duration: 'inf', trigger: 'hook', requires: { chain: 3 },
    },
    {
      // xlsx C5"C5额外加强音伤害加成降低50%"：只对 5 链的那几发（动作 C5加强音）
      id: '莫特斐.共鸣链5', source: '共鸣链5：……打出4发共鸣解放加强音，造成热熔伤害，此次共鸣解放加强音伤害降低50%。',
      zone: 'DamageChange', value: -0.5, filter: { actions: ['C5加强音'] }, target: 'self', duration: 'inf', trigger: 'always', requires: { chain: 5 },
    },
    {
      id: '莫特斐.共鸣链6', source: '共鸣链6：施放共鸣解放暴烈终曲时，队伍中的角色攻击提升20%，持续20秒。',
      zone: 'atkPct', value: 0.2, target: 'team', duration: 1200, requires: { chain: 6 },
      trigger: { on: 'actionStart', where: { actions: ['大招'] } },
    },
  ],
  resourceEffects: [
    {
      id: '莫特斐.共鸣链2', source: '共鸣链2：使用声骸技能后，额外回复10点共鸣能量，每20秒可触发1次。',
      resource: 'energy', amount: 10, icd: 1200, requires: { chain: 2 },
      trigger: { on: 'actionStart', where: { actionKinds: ['echo'] } },
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const rage = ctx.state.chars[ctx.self].core[0]!
      if (id === 'E1') return rage < 100 ? true : '怒气值满 100 时共鸣技能是怒火赋格（E2）'
      if (id === 'E2') return rage >= 100 ? true : '怒气值不满 100'
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      // 火焰闪电：前置生成即爆炸（打单体、贴脸，飞行时间不计）
      if (ev.type === 'judgmentSpawn' && ev.char === me && BLASTS[ev.judgment]) {
        ctx.assume('module-guess', '莫特斐：激昂变奏 / 怒火赋格 / 变奏的火焰闪电在前置生成时就爆炸（"碰撞立即爆炸"，飞行时间不计）')
        ctx.spawnJudgment(BLASTS[ev.judgment]!, { note: '前置碰撞爆炸' })
        return
      }
      // 大招第 60 帧获得协同状态：按"大招-伤害"生成（第 62 帧）记
      if (ev.type === 'judgmentSpawn' && ev.char === me && ev.judgment === '大招-伤害') {
        for (const id of STATES) ctx.removeBuff(id)
        ctx.addBuff(ctx.chain >= 4 ? STATES[1] : STATES[0])
        ctx.addBuff('莫特斐.共鸣链3')
        return
      }
      if (ev.type === 'buffExpire' && ev.target === me && (STATES as readonly string[]).includes(ev.buff) && ev.reason === 'timeout') {
        ctx.removeBuff('莫特斐.节奏自由')
        ctx.removeBuff('莫特斐.共鸣链3')
        return
      }
      if (ev.type === 'hit') {
        // 激昂变奏后 5 秒内，自己的普攻命中额外 +7 怒气值（每下）
        if (ev.char === me && ev.tags.includes('普攻') && ctx.buffStacks('莫特斐.激昂') > 0) ctx.addResource('core1', 7, ctx.self, '激昂变奏后 5 秒内普攻命中')
        // 5 链：自己的共鸣技能伤害命中后 4 发（不受公用冷却限制，原文没写）
        if (ctx.chain >= 5 && ev.char === me && ev.tags.includes('共鸣技能') && ev.dmg) shoot(ctx, 4, 'C5加强音', '5 链：共鸣技能命中')
        if (!inState(ctx) || ev.action === '大招-协同状态' || !ev.dmg) return
        // 浮翼狂想：登场角色的普攻 1 发、重击 2 发
        const onField = ctx.state.chars[ctx.state.onField]!.name
        if (ev.char !== onField) return
        if (ev.tags.includes('重击')) coordinated(ctx, 2, '大招-协同状态', `${NOTE}：${ev.char} ${ev.judgment}`)
        else if (ev.tags.includes('普攻')) coordinated(ctx, 1, '大招-协同状态', `${NOTE}：${ev.char} ${ev.judgment}`)
        return
      }
      // 1 链：登场角色施放共鸣技能时 2 发（同公用冷却，xlsx C1"公用冷却0.35秒"）
      if (ev.type === 'actionStart' && ctx.chain >= 1 && inState(ctx)) {
        const c = ctx.state.chars.find(x => x.name === ev.char)
        if (c && c.slot === ctx.state.onField && c.action?.def.kind === 'skill') coordinated(ctx, 2, 'C1加强音', `1 链：${ev.char} 施放 ${ev.action}`)
      }
    },
    forte(ctx) {
      return inState(ctx) ? `浮翼狂想 · 节奏自由 ${ctx.buffStacks('莫特斐.节奏自由')} 层` : ''
    },
  },
  actionOverrides: {
    // 地面出场技（普通切人入场按 A）是 A4：xlsx A4-1 备注"地面出场技复用"；BV1VJYL6HEuQ 作者"莫特斐自动打出入场平a"
    A4: { copyAs: ['A4-地面出场技'] },
    'A4-地面出场技': { comboFrom: [] },
    E1: { cooldown: 840, accept: ['priorityChangeGuess'] },      // 激昂变奏冷却 14 秒（nanoka 3.7）；第 22 帧（派生帧）降到 3
    E2: { accept: ['priorityChangeGuess'] },                      // 怒火赋格不另设冷却（怒气值满就能放）
    大招: { cooldown: 1200 },                                     // 暴烈终曲冷却 20 秒（nanoka 3.7）
    闪避反击: { accept: ['priorityChangeGuess'] },
    // 加强音所在的标记组（不会被当成动作放）；1 链、5 链的额外加强音另存一份，5 链的伤害降低只对它（filter.actions）
    '大招-协同状态': { accept: ['noEnd', 'noPriority'], copyAs: ['C1加强音', 'C5加强音'] },
    'C1加强音': { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    'C5加强音': { accept: ['noEnd', 'noPriority', 'kindGuess'] },
  },
})
