// data/curated/characters/散华.ts —— 角色模块示例（格式以 TD-08 为准）
import type { BuffDefInput } from '../../../src/data/buff.schema'
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 三种冰（TD-08 §5.1，m0-confirm §6 S3）：技能的伤害判定生成时出现（不看命中），存在时间按 xlsx，同一种只有 1 块（再放刷新）。
 *  from = 生成它的判定名；boom = 引爆它的判定（冰绽） */
const ICES = [
  { buff: '散华.冰棱', from: 'E', boom: 'E-引爆冰棱', frames: 342, source: '共鸣技能：剑气会留下1道【冰棱】（xlsx：冰棱判定存在342F）' },
  { buff: '散华.冰棘', from: 'QTE', boom: 'QTE-引爆冰棘', frames: 486, source: '变奏：留下1道【冰棘】（xlsx：冰棘判定存在486F）' },
  { buff: '散华.冰川', from: '大招-伤害', boom: '大招-引爆冰川', frames: 390, source: '共鸣解放：形成1道【冰川】（xlsx：冰川判定存在390F）' },
] as const
const iceBuffs: BuffDefInput[] = ICES.map(x => ({ id: x.buff, source: x.source, target: 'enemy', duration: x.frames, trigger: 'hook' }))

/** 【透视】（共鸣回路"无明心音"，nanoka 3.7）：A5、变奏、E 各 1 层，大招 2 层，最多 2 层，每层 5 秒，重击爆裂清空；每层扩大一次【冰痕】区域。
 *  层数就是核心资源槽 1（xlsx 核心回收1：A5 / E / QTE +1、大招 +2、重击居合 −2）；基础页把这一槽叫"指针"、上限 70，对不上（TD-06 Q6），
 *  改名、上限 2。数据只管加减，到时由钩子扣：每层各自计时（先得的先到时），两个计时标记各管一层，满 2 层再得时刷新先得的那层。
 *  只影响冰痕区域的大小；指针与区域没有数据，重击爆裂按总能成功算（假设 burst-release，待实测见 m0-confirm §13） */
const VARS = { 透视一起: -1, 透视二起: -1 }        // 两层各自开始计时的战斗帧；-1 = 这层没有
type Ctx = HookContext<typeof VARS>
const LAYERS = [{ buff: '散华.透视·一', since: '透视一起' }, { buff: '散华.透视·二', since: '透视二起' }] as const
/** 给透视的判定（命中时给，同 xlsx 核心回收1 所在的判定）；大招在开始时给 2 层 */
const GAIN_ON_HIT: Readonly<Record<string, number>> = { A5: 1, E: 1, QTE: 1 }
function gainLayers(ctx: Ctx, n: number): void {
  for (let k = 0; k < n; k++) {
    const v = ctx.vars
    const free = LAYERS.findIndex(l => v[l.since] < 0)
    const l = LAYERS[free >= 0 ? free : v.透视一起 <= v.透视二起 ? 0 : 1]!   // 满了：刷新先得的那层
    v[l.since] = ctx.state.battleFrames
    ctx.addBuff(l.buff)
  }
}

export default defineCharacter('散华', {
  weaponType: '迅刀',
  treeStats: { '冷凝伤害加成': 0.12, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '透视' },                            // 基础页叫"指针"，数据里加减的是透视层数（见上）
  coreCaps: { 1: 2 },                                  // 透视最多 2 层（基础页写 70）
  vars: VARS,
  aliases: { E: 'E', R: '大招', QTE: 'QTE', A1: 'A1', A2: 'A2', A3: 'A3', A4: 'A4', A5: 'A5' },
  buffs: [
    ...iceBuffs,
    ...LAYERS.map((l, i): BuffDefInput => ({
      id: l.buff, source: `透视第 ${i + 1} 层的计时：每层透视持续时间 5 秒（nanoka 3.7）`, target: 'self', duration: 300, trigger: 'hook',
    })),
    {
      // 重击爆裂的引爆时刻：xlsx 重击居合-1"第29F～36F可引爆"，取起点，局部第 29 帧（m0-confirm §6 S4）。
      // 钩子没有按帧回调，用一个 29 帧的标记计时，到期那一刻引爆（默认总能打中冰）
      id: '散华.引爆计时', source: '重击居合-1：第29F～36F可引爆',
      target: 'self', duration: 29, trigger: { on: 'actionStart', where: { actions: ['重击居合'] } },
    },
    {
      id: '散华.固有1',
      source: '固有技能1：变奏后，获得持续时间为8秒的20%共鸣技能伤害提升buff',
      zone: 'DamageChangeType', value: 0.2, filter: { tags: ['共鸣技能'] },
      target: 'self', duration: 480, trigger: { on: 'intro' },
    },
    {
      // "伤害提升"按伤害加成（与元素 / 类型加成相加），只对写明的那种伤害：冰绽 = 三种引爆（2026-10-03 用户确认，TD-07 Q5）
      id: '散华.固有2',
      source: '固有技能2：施放第5段普攻后，散华共鸣回路冰绽造成的伤害提升20%，持续8秒。',
      zone: 'DamageChange', value: 0.2, filter: { judgments: ['E-引爆冰棱', 'QTE-引爆冰棘', '大招-引爆冰川'] },
      target: 'self', duration: 480, trigger: { on: 'actionStart', where: { actions: ['A5'] } },
    },
    {
      // 持续时间待确认：nanoka 3.7 写 10 秒，xlsx 写"施放A5后，获得持续时间为8秒的15%暴击率提升buff"；先按 nanoka
      id: '散华.共鸣链1',
      source: '共鸣链1：施放第5段普攻时，散华自身暴击提升15%，持续10秒。',
      zone: 'critRate', value: 0.15, target: 'self', duration: 600,
      requires: { chain: 1 },
      trigger: { on: 'actionStart', where: { actions: ['A5'] } },
    },
    {
      // "下次"只管一次重击爆裂；一次爆裂的两段都吃，第二段结算后用掉（2026-10-03 用户确认，TD-07 Q5）。
      // 爆裂在第二段之前被打断时不会用掉，留到 5 秒到期——可接受的近似
      id: '散华.共鸣链4',
      source: '共鸣链4：……并且5秒内的下次重击爆裂伤害提升120%。',
      zone: 'DamageChange', value: 1.2, filter: { judgments: ['重击居合-1', '重击居合-2'] },
      target: 'self', duration: 300, requires: { chain: 4 },
      trigger: { on: 'actionStart', where: { actions: ['大招'] } },
      consume: { on: 'judgmentSettle', where: { judgments: ['重击居合-2'] } },
    },
    {
      id: '散华.共鸣链5',
      source: '共鸣链5：共鸣回路冰绽的暴击伤害提升100%。（"消失时直接爆炸"归钩子，TD-08 §5.1）',
      zone: 'critDamage', value: 1, filter: { judgments: ['E-引爆冰棱', 'QTE-引爆冰棘', '大招-引爆冰川'] },
      target: 'self', duration: 'inf', trigger: 'always',
      requires: { chain: 5 },
    },
    {
      // 每引爆一块冰给一层：一次重击爆裂同时引爆两块，直接叠到 2 层（2026-10-03 用户实测；xlsx"每个引爆周期可获得1层"不对，TD-07 Q3）
      id: '散华.共鸣链6',
      source: '共鸣链6：引爆【冰棱】或【冰川】后，队伍中的角色攻击提升10%，持续20秒，可叠加2层',
      zone: 'atkPct', value: 0.1, target: 'team', maxStacks: 2, duration: 1200,
      requires: { chain: 6 },
      trigger: { on: 'judgmentSettle', where: { judgments: ['E-引爆冰棱', 'QTE-引爆冰棘', '大招-引爆冰川'] } },
    },
    {
      id: '散华.延奏',
      source: '延奏：下一位登场角色普攻伤害加深38%，效果持续14秒，若切换至其他角色则该效果提前结束',
      zone: 'DamageAmplify0', value: 0.38,                 // 不带类别的"伤害加深"= 0 类（TD-03 §2）
      filter: { tags: ['普攻'] }, target: 'nextIn', duration: 840, onSwitchOut: 'clear',
      trigger: { on: 'outro' },
    },
  ],
  resourceEffects: [
    {
      id: '散华.共鸣链4.能量',
      source: '共鸣链4：施放共鸣解放焦瞑冻土时，回复10点共鸣能量。',
      resource: 'energy', amount: 10, requires: { chain: 4 },
      trigger: { on: 'actionStart', where: { actions: ['大招'] } },
    },
  ],
  hooks: {
    onEvent(ctx, ev) {
      // 透视：A5、E、变奏命中时各 1 层，大招开始时 2 层（层数由数据加，这里只管计时）；重击爆裂第一段清空
      if (ev.type === 'hit' && ev.char === '散华') {
        if (GAIN_ON_HIT[ev.judgment]) gainLayers(ctx, GAIN_ON_HIT[ev.judgment]!)
        if (ev.judgment === '重击居合-1') for (const l of LAYERS) { ctx.vars[l.since] = -1; ctx.removeBuff(l.buff) }
        return
      }
      if (ev.type === 'actionStart' && ev.char === '散华') {
        if (ev.action === '大招') gainLayers(ctx, 2)
        if (ev.action === '重击居合') ctx.assume('burst-release', '散华 重击居合')
        return
      }
      const layer = ev.type === 'buffExpire' && ev.reason === 'timeout' ? LAYERS.find(l => l.buff === ev.buff) : undefined
      if (layer) {
        ctx.vars[layer.since] = -1
        if (ctx.state.chars[ctx.self].core[0] > 0) ctx.addResource('core1', -1, ctx.self, '透视到时（每层 5 秒）')
        return
      }
      // 冰出现：对应的伤害判定生成时（不看命中）
      if (ev.type === 'judgmentSpawn' && ev.char === '散华') {
        const ice = ICES.find(x => x.from === ev.judgment)
        if (ice) ctx.addBuff(ice.buff, { target: 'enemy' })
        return
      }
      if (ev.type !== 'buffExpire') return
      // 重击爆裂第 29 帧：引爆场上所有的冰
      if (ev.buff === '散华.引爆计时' && ev.reason === 'timeout') {
        for (const ice of ICES) {
          if (ctx.buffStacks(ice.buff, 'enemy') === 0) continue
          ctx.removeBuff(ice.buff, 'enemy')
          ctx.spawnJudgment(ice.boom, { note: '重击爆裂引爆' })
        }
        return
      }
      // 共鸣链5：没被引爆的冰在消失时直接爆炸
      const ice = ICES.find(x => x.buff === ev.buff)
      if (ice && ev.reason === 'timeout' && ctx.chain >= 5) {
        // 自爆生成的是同一个引爆判定，6 链"引爆后攻击提升"照样触发（2026-10-18 用户实测，m0-confirm §11 V8）
        ctx.spawnJudgment(ice.boom, { note: '5 链：冰到时自爆' })
      }
    },
    // 共鸣回路的状态说明（时间轴检查器）：场上有哪几种冰（重击爆裂会引爆的）；透视层数看核心资源
    forte(ctx) {
      return ICES.filter(x => ctx.buffStacks(x.buff, 'enemy') > 0).map(x => x.buff.slice('散华.'.length)).join(' · ')
    },
  },
  actionOverrides: {
    // 两个结束帧是谐度破坏的两段，取第一个即可；组里的编号行（1、2、31…）是动画分段、没有伤害，谐度破坏优先级 11 不会被取消，
    // 可不可脱手都一样（m0-confirm §8 A 类，TD-06 §13.3）
    谐度破坏: { accept: ['multiEnd', 'persistsGuess'] },
    // 备注"第42F可响应大招"，数据没给优先级变化帧，默认回退到派生帧 61；按手感改成 42（m0-confirm 2.3，2026-09-27 确认）
    QTE: { priority: [{ fromFrame: 0, value: 11 }, { fromFrame: 42, value: 8 }] },
    // 推断值的处理见 m0-confirm §8（2026-10-04）
    E: { cooldown: 600, accept: ['priorityChangeGuess'] },   // 共鸣技能冷却 10 秒（2026-09-27 用户提供）；第 60 帧（派生帧）降到 2
    // 共鸣解放冷却 16 秒（nanoka 3.7）；第 98 帧（派生帧）降到 2、可接重击居合（2026-10-04 用户确认）
    大招: { cooldown: 960, accept: ['priorityChangeGuess'] },
    // A5 的优先级 [2, 4, 2]：备注"第6F～33F不能派生重击"（重击优先级 3）= 第 6 帧升到 4、第 33 帧降回 2
    A5: { priority: [{ fromFrame: 0, value: 2 }, { fromFrame: 6, value: 4 }, { fromFrame: 33, value: 2 }] },
    // 钩子生成的引爆判定所在的组（不设冷却），不会被当成动作放
    '大招-引爆冰川': { accept: ['noEnd', 'noPriority'] },
    // 6 链"引爆后攻击提升"已写成 buff 散华.共鸣链6，这一组标记行不会被当成动作放
    'C6-引爆触发器': { accept: ['noEnd', 'noPriority', 'kindGuess', 'chainAdditive'] },
    // 推断值按默认接受（m0-confirm §12 甲类，2026-10-18 用户同意）：蓄力只有名字的一行标记，没有帧数据，不会被当成动作放；
    // 普通重击（不是重击居合）第 47 帧（派生帧）降到 2
    蓄力: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    重击: { accept: ['priorityChangeGuess'] },
  },
})
