// data/curated/characters/琳奈.ts —— 角色模块（爱弥斯 · 琳奈 · 莫宁 / 守岸人 队伍，2026-10-25；待确认的条目见 docs/alm-confirm.md）
// 原文：nanoka 3.7 的技能说明、xlsx 琳奈块（20261019 版 R3074–R3232）「特殊能量」「共鸣模态·琳奈」两行的备注。只写 0 链、共鸣模态·震谐。
// 核心资源（构建出的槽名与各行实际加的对不上，按各行改）：1 溢彩（上限 120，A / E1 / 空中攻击 / 变奏给，灵感碰撞清空）、
// 2 流光（上限 120，绮彩巡游里才有）、3 本色（上限 3，幻光折跃各 +1，虹彩飞溅 / 视觉冲击清空）。
// 简化（docs/alm-confirm.md）：流光随时间的回复与流失不建模——灵感碰撞（按满蓄力的 3 级）后直接满 120，三段幻光折跃各耗 40。
import { defineCharacter } from '../../../src/data/define'
import type { HookContext } from '../../../src/engine/types'

/** 巡游：绮彩巡游状态（灵感碰撞后进入；长按 E、延奏退出） */
const VARS = { 巡游: false }
type Ctx = HookContext<typeof VARS>
const 偏移帧 = 1500                       // "光致变染为目标附加【震谐·偏移】，持续25秒"
/** 命中时挂震谐·偏移（光致变染）的判定：幻光折跃三段、变奏、虹彩飞溅 / 视觉冲击的落地与颜料 */
const SHIFT = new Set(['折跃1-1', '折跃1-2', '折跃1-3', '折跃2-震谐伤害', '折跃3-1', '折跃3-2', 'QTE-震谐状态', 'E3-震谐状态落地', 'E4-震谐状态落地', 'E4-C0震谐颜料'])
/** 只写共鸣模态·震谐：集谐版与 1 链版的判定不生成 */
const SKIP: Record<string, string[]> = {
  QTE: ['QTE-集谐状态'], '轮滑跳跃-折跃2': ['折跃2-集谐伤害'], E3: ['E3-集谐状态落地'],
  E4: ['E4-集谐状态落地', 'E4-C0集谐颜料', 'E4-C1集谐颜料', 'E4-C1震谐颜料', 'E4-C1颜料牵引1', 'E4-C1颜料牵引2'],
}
const JUMPS = ['轮滑跳跃', '轮滑跳跃-折跃2', '轮滑跳跃-折跃3']
const 溢彩 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[0]!
const 流光 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[1]!
const 本色 = (ctx: Ctx): number => ctx.state.chars[ctx.self].core[2]!

function leaveTour(ctx: Ctx, why: string): void {
  if (!ctx.vars.巡游) return
  ctx.vars.巡游 = false
  // "退出绮彩巡游时清除所有【流光】""退出绮彩巡游状态时清除所有【本色】"
  if (流光(ctx) > 0) ctx.addResource('core2', -流光(ctx), ctx.self, why)
  if (本色(ctx) > 0) ctx.addResource('core3', -本色(ctx), ctx.self, why)
}

export default defineCharacter('琳奈', {
  weaponType: '佩枪',
  treeStats: { '暴击率': 0.08, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  coreNames: { 1: '溢彩', 2: '流光', 3: '本色' },
  coreCaps: { 1: 120, 2: 120, 3: 3 },
  aliases: {
    E: 'E1', R: '大招', QTE: 'QTE', 延奏: '延奏', 灵感碰撞: '灵感碰撞3级', 幻光折跃1: '轮滑跳跃', 幻光折跃2: '轮滑跳跃-折跃2', 幻光折跃3: '轮滑跳跃-折跃3',
    虹彩飞溅: 'E3', 视觉冲击: 'E4', 加色混合: 'E2',
  },
  vars: VARS,
  buffs: [
    {
      id: '琳奈.爆炸喷涂', source: '共鸣解放·爆炸喷涂：施放时使附近队伍中所有角色造成的伤害提升24%，持续30秒。',
      zone: 'DamageChange', value: 0.24, target: 'team', duration: 1800, trigger: { on: 'actionStart', where: { actions: ['大招'] } },
    },
    {
      id: '琳奈.视觉冲击', source: '普攻·视觉冲击：……使附近队伍中所有角色的谐度破坏增幅提升40点，持续30秒。',
      zone: 'harmonyBreakBoost', value: 40, target: 'team', duration: 1800, trigger: { on: 'actionStart', where: { actions: ['E4'] } },
    },
    {
      id: '琳奈.自适应光学', source: '固有技能：施放变奏技能·来点儿颜色瞧瞧时，9秒内自身的衍射伤害加成提升25%。',
      zone: 'DamageChangeElement', value: 0.25, filter: { elements: ['衍射'] }, target: 'self', duration: 540, trigger: { on: 'intro' },
    },
    {
      id: '琳奈.延奏', source: '延奏技能·有空一起兜风！：下一个登场的角色全伤害加深15%……持续14秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.15, target: 'nextIn', duration: 840, onSwitchOut: 'clear', trigger: { on: 'outro' },
    },
    {
      id: '琳奈.延奏·解放', source: '延奏技能·有空一起兜风！：下一个登场的角色……共鸣解放伤害加深25%，持续14秒，若切换至其他角色则该效果提前结束。',
      zone: 'DamageAmplify0', value: 0.25, filter: { tags: ['共鸣解放'] }, target: 'nextIn', duration: 840, onSwitchOut: 'clear', trigger: { on: 'outro' },
    },
  ],
  hooks: {
    canStart(ctx, id) {
      const v = ctx.vars
      if (id === '灵感碰撞-蓄力') return v.巡游 ? '已经在绮彩巡游' : 溢彩(ctx) >= 120 - 1e-9 ? true : `溢彩 ${Math.floor(溢彩(ctx))} / 120`
      if (/^灵感碰撞\d级$/.test(id)) return ctx.state.chars[ctx.self].last?.id === '灵感碰撞-蓄力' ? true : '灵感碰撞要接在蓄力后面'
      if (JUMPS.includes(id)) return v.巡游 ? (流光(ctx) >= 40 - 1e-9 ? true : `流光 ${Math.floor(流光(ctx))} / 40（1/3 上限）`) : '不在绮彩巡游：跳跃不是幻光折跃'
      if (id === 'E3' || id === 'E4') {
        if (!v.巡游 || 本色(ctx) < 3) return `虹彩飞溅 / 视觉冲击要绮彩巡游里本色满 3（${本色(ctx)}）`
        return true                                                   // 视觉冲击在冷却时是虹彩飞溅（冷却由调度器查）
      }
      if (id === 'E2') return v.巡游 ? true : '加色混合要在绮彩巡游里（不在时是琳奈式创想 E1）'
      if (id === 'E1') return v.巡游 ? '绮彩巡游里短按 E 是加色混合（E2），长按是 E1-创想长按' : true
      if (id === 'E1-创想长按') return v.巡游 ? true : '不在绮彩巡游'
      if (/^轮滑/.test(id)) return v.巡游 ? true : '不在绮彩巡游'
      if (/^A\d|^A3-闪避反击D$|^空中攻击$/.test(id)) return v.巡游 ? '绮彩巡游里普攻是轮滑普攻' : true
      return true
    },
    onEvent(ctx, ev) {
      const me = ctx.state.chars[ctx.self].name
      const v = ctx.vars
      if (ev.type === 'actionStart' && ev.char === me) {
        if (SKIP[ev.action]) ctx.skipJudgments(ev.instance, SKIP[ev.action]!)
        if (/^灵感碰撞\d级$/.test(ev.action)) {
          // "施放普攻·灵感碰撞时，进入绮彩巡游状态"；3 级 = 满蓄力，流光 100%
          v.巡游 = true
          ctx.assume('module-guess', '琳奈：流光随时间的增减不建模，灵感碰撞（满蓄力 3 级）后直接满 120')
          ctx.addResource('core2', 120 - 流光(ctx), ctx.self, '灵感碰撞满蓄力：流光 100%')
        }
        if (JUMPS.includes(ev.action)) {
          ctx.addResource('core2', -40, ctx.self, '幻光折跃消耗 1/3 流光')
          ctx.addResource('core3', 1, ctx.self, '幻光折跃（战斗中）+1 本色')
        }
        if ((ev.action === 'E3' || ev.action === 'E4') && 本色(ctx) > 0) ctx.addResource('core3', -本色(ctx), ctx.self, '虹彩飞溅 / 视觉冲击清空本色')
        if (ev.action === 'E1-创想长按') leaveTour(ctx, '长按 E 退出绮彩巡游')
        // "不处于轮滑状态时，第1F获得100点溢彩"：数据里变奏起手就给 100，在巡游里时退回去
        if (ev.action === 'QTE' && v.巡游) ctx.addResource('core1', -100, ctx.self, '在绮彩巡游里变奏不给溢彩')
        return
      }
      if (ev.type === 'hit' && ev.char === me && SHIFT.has(ev.judgment)) { ctx.applyShift('震谐', 偏移帧, `琳奈 ${ev.judgment}：光致变染`); return }
      if (ev.type === 'outro' && ev.char === me) { leaveTour(ctx, '延奏：退出绮彩巡游'); return }
    },
    forte(ctx) {
      return ctx.vars.巡游 ? `绮彩巡游 · 流光 ${Math.round(流光(ctx))} · 本色 ${本色(ctx)}` : `光学取样 · 溢彩 ${Math.round(溢彩(ctx))}`
    },
  },
  actionOverrides: {
    // 灵感碰撞蓄力："每0.2秒将15点【溢彩】转换为12.5%的【流光】"，120 点溢彩 8 次 = 1.6 秒满蓄力（结束帧 96，推断），之后接灵感碰撞
    '灵感碰撞-蓄力': { kind: 'heavy', endFrame: 96, cancelWindows: [{ from: 96, until: 126 }], priority: [{ fromFrame: 0, value: 4 }] },
    灵感碰撞1级: { comboFrom: ['灵感碰撞-蓄力'] },
    灵感碰撞2级: { comboFrom: ['灵感碰撞-蓄力'] },
    灵感碰撞3级: { comboFrom: ['灵感碰撞-蓄力'] },
    // 幻光折跃：xlsx 的结束帧取了"落地"标记行（1）。三段在空中接着放：第 36 帧起可接下一段（各段"第35F改变中断优先级"、派生 36 帧起），
    // 不接时落地时刻没写，按派生窗口末（第 88 帧）结束（推断）
    轮滑跳跃: { endFrame: 88, air: { from: 0, until: 88 }, cancelWindows: [{ from: 36, until: 88 }] },
    '轮滑跳跃-折跃2': { endFrame: 88, air: { from: 0, until: 88 }, cancelWindows: [{ from: 36, until: 88 }], comboFrom: ['轮滑跳跃'] },
    // 折跃3：扔罐碰撞后生成折跃3-1，3-1 持续 11 帧结束后生成 3-2；碰撞时刻没写，按扔罐（第 14 帧）后 16 帧算（推断）
    '轮滑跳跃-折跃3': { comboFrom: ['轮滑跳跃-折跃2'], judgments: { '折跃3-1': { spawnFrame: 30 }, '折跃3-2': { spawnFrame: 41 }, '折跃3-顿帧': { spawnFrame: 30 } } },
    // 视觉冲击：下落第 45 帧落地（"E4-下落"出现帧），落地段各行从落地算；落地后第 23 帧可取消（"落地后第23F改变中断优先级"）
    E4: {
      cooldown: 1500,                                              // 视觉冲击冷却 25 秒（虹彩飞溅没有冷却）
      shiftRows: { 'E4-集谐状态落地': 45, 'E4-震谐状态落地': 45, 'E4-C0集谐颜料': 45, 'E4-C0震谐颜料': 45, 'E4-C1集谐颜料': 45, 'E4-C1震谐颜料': 45, 'E4-C1颜料牵引1': 45, 'E4-C1颜料牵引2': 45 },
      endFrame: 87, air: { from: 0, until: 45 }, priority: [{ fromFrame: 0, value: 6 }, { fromFrame: 68, value: 2 }], cancelWindows: [{ from: 68, until: 135 }],
      accept: ['multiEnd', 'minusOneAfterEnd', 'ticksGuess', 'chainAdditive'],
    },
    E3: { accept: ['multiEnd'] },                                   // 虹彩飞溅（视觉冲击冷却时才用），轴里不用
    QTE: { accept: ['priorityChangeGuess'] },
    E1: { cooldown: 360, cooldownGroup: 'E' },                     // 琳奈式创想与加色混合共享冷却 6 秒
    'E1-创想长按': { cooldown: 360, cooldownGroup: 'E' },
    E2: { cooldown: 360, cooldownGroup: 'E' },
    大招: { cooldown: 1500, accept: ['priorityChangeGuess'] },
    // 轴里用不到的
    'A3-闪避反击D': { accept: ['priorityChangeGuess'] },
    空中攻击: { accept: ['landingUnshifted', 'multiEnd'] },
    '轮滑A1-闪避反击': { accept: ['priorityChangeGuess'] },
    轮滑空中攻击: { accept: ['landingUnshifted', 'multiEnd'] },
    '轮滑重击-跃动集束#2': { accept: ['priorityChangeGuess'] },
    轮滑空中重击: { accept: ['multiEnd', 'priorityChangeGuess'] },
    大招派生: { accept: ['ticksCapped'] },
    轮滑闪避: { accept: ['dirVariant'] },
    轮滑极限闪避: { accept: ['dirVariant'] },
    特殊能量: { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    '共鸣模态·琳奈': { accept: ['noEnd', 'noPriority', 'kindGuess'] },
    震谐响应: { kind: 'other', accept: ['noEnd', 'kindGuess'] },
  },
})
