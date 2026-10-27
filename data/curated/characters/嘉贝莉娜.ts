// data/curated/characters/嘉贝莉娜.ts —— 嘉贝莉娜（5 星，热熔，佩枪）。格式以 TD-08 为准
// 原文：nanoka 3.7 的技能说明，xlsx 嘉贝莉娜块（20261019 版）「特殊能量」「强化状态」「被动技能」几行的备注。确认清单见 docs/tower-20261026.md。
// 只写到 0 链。两种状态：阈限（常态动作）与恶魔位格（动作 ID 带"恶魔"，加上 E2 掠袭）。
// 核心资源槽 1 一槽两用：阈限里是罪火（常态攻击命中获得），恶翼扬升时等量转成净炼火（恶魔位格里命中消耗，耗完退出）。余火记在状态量里。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

const P = '嘉贝莉娜.'
/** 恶魔位格 50 秒 */
const 恶魔帧 = 3000
/** 恶魔位格里才能用的动作（另有 E2 掠袭） */
const DEMON = ['恶魔A1', '恶魔A2', '恶魔A3', '恶魔A3-1D', '恶魔A4', '恶魔A4-1', '恶魔A5', '恶魔重击1', '恶魔重击2', '恶魔重击3', '恶魔空中攻击', '恶魔暴风雨']
/** 阈限里才能用的动作 */
const NORMAL = new Set(['A1', 'A2', 'A3', 'A3-1D', 'A4', '重击1', '重击2', '重击3', '空中攻击', '暴风雨', 'E1', 'E3'])
/** 固有1 死运既定的技能分类（xlsx 被动技能）：同一类 5 秒内只加一层 */
const CATEGORY: Record<string, number> = {
  A1: 1, A2: 1, A3: 1, A4: 1,
  恶魔A1: 2, 恶魔A2: 2, 恶魔A3: 2, 恶魔A4: 2, '恶魔A4-1': 2, 恶魔A5: 2,
  重击1: 3, 重击2: 3, 重击3: 3, 恶魔重击1: 4, 恶魔重击2: 4, 恶魔重击3: 4,
  'A3-1D': 5, '恶魔A3-1D': 5, 空中攻击: 6, 暴风雨: 6, 恶魔空中攻击: 6, 恶魔暴风雨: 6,
  E1: 7, E2: 7, E3: 8, 地狱穿行: 9, QTE: 10, 大招: 11,
}
const CAT_CD = 300

const VARS = {
  恶魔: false,
  余火: 0,
  余火声骸: 0,              // 这一轮阈限里已经给过余火的队友（槽位的位）："同名声骸只可触发1次"
  c1: -1, c2: -1, c3: -1, c4: -1, c5: -1, c6: -1, c7: -1, c8: -1, c9: -1, c10: -1, c11: -1,   // 死运既定各分类上一次加层的战斗帧
}
type Ctx = HookContext<typeof VARS>
type CatKey = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'c9' | 'c10' | 'c11'
const me = (ctx: Ctx): string => ctx.state.chars[ctx.self].name
const fire = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[0]!

/** 退出恶魔位格（净炼火耗完、或 50 秒到）：清空净炼火、余火，重置声骸监听 */
function leaveDemon(ctx: Ctx, why: string): void {
  if (!ctx.vars.恶魔) return
  ctx.vars.恶魔 = false
  ctx.vars.余火 = 0
  ctx.vars.余火声骸 = 0
  ctx.removeBuff(`${P}恶魔位格`)
  ctx.removeBuff(`${P}余火`)
  const left = fire(ctx)
  if (left > 0) ctx.addResource('core1', -left, ctx.self, `退出恶魔位格（${why}），清空净炼火`)
}

export default defineCharacter('嘉贝莉娜', {
  weaponType: '佩枪',
  treeStats: { '暴击伤害': 0.16, '攻击%': 0.12 },     // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '罪火' },
  coreCaps: { 1: 100 },
  aliases: { E: 'E1', R: '大招', QTE: 'QTE', 迫近: 'E1', 掠袭: 'E2', 恶翼扬升: 'E3' },
  vars: VARS,
  buffs: [
    { id: `${P}恶魔位格`, source: '恶魔位格：施放恶翼扬升后获得，持续50秒；消耗完【净炼火】时退出', target: 'self', duration: 恶魔帧, trigger: 'hook' },
    {
      id: `${P}强化`, source: '共鸣解放·炼净：恶魔位格期间，普攻·炽天猎杀、重击·炼羽裁决、空中攻击·火狱暴雨、闪避反击·罪业当涤的伤害倍率提升85%，持续14秒。',
      zone: 'RateBonus', value: 0.85, filter: { actions: DEMON }, target: 'self', duration: 840, trigger: { on: 'actionStart', where: { actions: ['大招'] } },
    },
    {
      id: `${P}内燃烧`, source: '内燃烧：施放变奏技能、地狱穿行、普攻·炽天猎杀第4段、共鸣技能·迫近、恶翼扬升、掠袭时，攻击提升20%，持续4秒。',
      zone: 'atkPct', value: 0.2, target: 'self', duration: 240,
      trigger: { on: 'actionStart', where: { actions: ['QTE', '地狱穿行', '恶魔A4', '恶魔A4-1', 'E1', 'E2', 'E3'] } },
    },
    {
      // "每1点余火使 恶魔A、恶魔重击、恶魔空中攻击、E2 造成的伤害提升1.5%，该提升作用于目标减伤区"（xlsx 特殊能量）：一层 = 1 点余火
      id: `${P}余火`, source: '恶魔位格期间，每点【余火】会使目标受到嘉贝莉娜的普攻·炽天猎杀、重击·炼羽裁决、空中攻击·火狱暴雨、共鸣技能·掠袭、闪避反击·罪业当涤伤害提升1.5%，至多提升至60%，退出恶魔位格时移除。',
      zone: 'TargetDamageReduce', value: -0.015, maxStacks: 40, filter: { actions: [...DEMON, 'E2'] }, target: 'self', duration: 'inf', trigger: 'hook',
    },
    {
      // 死运既定：挂在目标上、只加嘉贝莉娜的伤害，这里挂在她自己身上（一个敌人，等价）；她的首位声骸也会吃到（多算一点）
      id: `${P}死运既定`, source: '固有1·誓猎：……命中目标时，会为目标叠加一层死运既定，每层使嘉贝莉娜的常态攻击、共鸣技能、共鸣回路、共鸣解放、变奏技能、延奏技能造成的伤害加深5%，可叠加4层，持续5.5秒。同种类型的技能，对同一目标5秒内只能叠加一次。',
      zone: 'DamageAmplify0', value: 0.05, maxStacks: 4, target: 'self', duration: 330, trigger: 'hook',
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const v = ctx.vars
      if ((DEMON.includes(id) || id === 'E2') && !v.恶魔) return `${id} 要在恶魔位格里`
      if (NORMAL.has(id) && v.恶魔) return `恶魔位格里不能用 ${id}（要用恶魔版）`
      if (id === 'E3') return fire(ctx) >= 100 ? true : `恶翼扬升要罪火满（${Math.floor(fire(ctx))} / 100）`
      return true
    },
    onEvent(ctx, ev) {
      const v = ctx.vars
      const self = me(ctx)
      switch (ev.type) {
        case 'actionStart': {
          // 余火：阈限里队伍中的角色施放声骸技能（不同名，每人一次）+8，上限 40
          if (!v.恶魔 && /^Q/.test(ev.action)) {
            const slot = ctx.state.chars.findIndex(c => c.name === ev.char)
            if (!(v.余火声骸 & (1 << slot))) { v.余火声骸 |= 1 << slot; v.余火 = Math.min(40, v.余火 + 8) }
          }
          if (ev.char !== self) return
          if (ev.action === 'E3') {                             // 恶翼扬升：进恶魔位格，罪火转成等量净炼火（同一槽），余火开始起作用
            v.恶魔 = true
            ctx.addBuff(`${P}恶魔位格`)
            if (v.余火 > 0) ctx.addBuff(`${P}余火`, { stacks: v.余火 })
          }
          return
        }
        case 'hit': {
          if (ev.char !== self || ev.dmg === null || ev.effect) return
          // 死运既定：每类技能 5 秒内加一层
          const cat = CATEGORY[ev.action]
          if (cat !== undefined) {
            const key = `c${cat}` as CatKey
            const now = ctx.state.battleFrames
            if (v[key] < 0 || now >= v[key] + CAT_CD) { v[key] = now; ctx.addBuff(`${P}死运既定`) }
          }
          return
        }
        case 'resource':
          // 净炼火耗完退出：命中扣的、恶魔普攻起手扣的（起手即得）都算——原来只看命中，起手扣到 0 的留在恶魔位格里
          if (ev.char === self && ev.resource === 'core1' && ev.delta < 0 && v.恶魔 && ev.value <= 0) leaveDemon(ctx, '净炼火耗完')
          return
        case 'buffExpire':
          if (ev.target === self && ev.buff === `${P}恶魔位格` && ev.reason === 'timeout') leaveDemon(ctx, '50 秒到')
          return
      }
    },
    modifyHit(_ctx, hit) {
      // 地狱穿行"造成固定热熔伤害（666）"：倍率是 0，按附加基础伤害算（仍会吃伤害加成，多算一点）
      if (hit.judgment.name === '地狱穿行-伤害') hit.extraFlat = 666
    },
    forte(ctx) {
      const v = ctx.vars
      const parts = [v.恶魔 ? '恶魔位格' : '阈限']
      if (v.余火 > 0) parts.push(`余火 ${v.余火}`)
      if (ctx.buffStacks(`${P}强化`) > 0) parts.push('强化')
      return parts.join(' · ')
    },
  },
  actionOverrides: {
    // 连段（nanoka 3.7）：普攻第 4 段、重击第 1 段、变奏、大招之后短按出第 2 段；重击第 2、3 段、空中下落之后出第 3 段；闪避反击之后出第 4 段。
    // 恶魔位格同理，另有恶翼扬升之后出炽天猎杀第 2 段、第 5 段之后出第 3 段；变奏后长按出燧发杀戮 / 炼羽裁决第 2 段
    A2: { comboFrom: ['A1', 'A4', '重击1', 'QTE', '大招'] },
    A3: { comboFrom: ['A2', '重击2', '重击3', '空中攻击'] },
    A4: { comboFrom: ['A3', 'A3-1D'] },
    重击2: { comboFrom: ['重击1', 'QTE'] },
    恶魔A2: { comboFrom: ['恶魔A1', '恶魔重击1', 'E3', 'QTE', '大招'] },
    恶魔A3: { comboFrom: ['恶魔A2', '恶魔A5', '恶魔重击2', '恶魔重击3', '恶魔空中攻击'] },
    恶魔A4: { comboFrom: ['恶魔A3', '恶魔A3-1D'] },
    恶魔A5: { comboFrom: ['恶魔A4', '恶魔A4-1'] },
    恶魔重击2: { comboFrom: ['恶魔重击1', 'QTE'] },
    E1: { cooldown: 300, cooldownGroup: '迫近' },             // 迫近、掠袭共享 5 秒冷却
    E2: { cooldown: 300, cooldownGroup: '迫近' },
    E3: { cooldown: 780 },                                    // 恶翼扬升冷却 13 秒
    大招: { cooldown: 1500 },
    // 段数按 nanoka（"…*3"）：寿命放到刚好装下 3 次（间隔同恶魔A3-1 的 6 帧、延奏-1 的 9 帧）
    '恶魔A3-1D': { judgments: { '恶魔A3-1D': { ticks: 3, lifeFrames: 13 } } },
    延奏: { accept: ['noEnd'], judgments: { '延奏-1': { ticks: 3, lifeFrames: 19 } } },   // 延奏走独立时间线，结束帧用不到
    // 落地段的帧从落地算：落地时刻取下落行的结束帧（第 42 帧）
    空中攻击: { shiftRows: { '空中攻击-落地': 42 } },
    恶魔空中攻击: { shiftRows: { '恶魔空中攻击-落地': 42 } },
    暴风雨: { accept: ['noEnd'] },                            // 按住扫射的循环段，结束看松手
    恶魔暴风雨: { accept: ['noEnd'] },
    A1: { accept: ['targetOther'] },                          // A1-自顿帧"无伤害，仅命中自己"
    地狱穿行: { kind: 'dodge', accept: ['kindGuess'] },       // "短按闪避可施放"，能触发成功闪避；伤害算普攻伤害
    特殊能量: { accept: ['noEnd', 'noPriority', 'kindGuess'] },   // 以下是状态的说明行，不是动作
    强化状态: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    被动技能: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
  },
})
