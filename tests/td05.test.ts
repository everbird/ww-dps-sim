// tests/td05.test.ts —— TD-05 切人与变奏 / 延奏（§8 的用例）
// M0 队伍的用例依赖 data/generated（缺数据时跳过）；"人造角色"的用例用 helpers/synth，总是运行。
import { beforeAll, describe, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { at, finalResources, m0Run } from './helpers/m0'
import { eventsOfLog, idle, synthRun, type SynthChar } from './helpers/synth'

let gd: GameData

dataDescribe('TD-05 M0 队伍', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('T05-1 普通切人：协奏没满不变奏，切出者的动作在后台照常走完，协奏不清零', () => {
    const out = m0Run(gd, { initial: { onField: 1, concerto: [0, 50, 0] }, rotation: ['散华 E', 'switch 椿'] })
    // E 开始时：行进序曲 +8（actionStart 的触发）→ 施放资源 +15（TD-06 §7）；同一 tick 接着切人，此时 73 < 100
    expect(at(out.log, 0)).toEqual(['loop', 'start 散华 E', '散华 concerto +8 行进序曲.协奏', '散华 concerto +15 cast', 'switch 散华→椿'])
    expect(eventsOfLog(out.log, 'intro')).toEqual([])
    expect(eventsOfLog(out.log, 'outro')).toEqual([])
    expect(eventsOfLog(out.log, 'hit').map(h => [h.f, h.char, h.judgment])).toEqual([[19, '散华', 'E']])
    expect(finalResources(out).concerto).toEqual([0, 73, 0])
    // 初始 77：E 的 +8 +15 在同一 tick 先发，切人就成了变奏切人
    const full = m0Run(gd, { initial: { onField: 1, concerto: [0, 77, 0] }, rotation: ['散华 E', 'switch 椿'] })
    expect(eventsOfLog(full.log, 'switch')[0]!.intro).toBe(true)
  })

  test('T05-2 变奏切人：切人时开始变奏动作；延奏在变奏动作的触发帧发生，协奏清零，延奏 buff 挂给变奏的角色', () => {
    const out = m0Run(gd, { initial: { onField: 1, concerto: [0, 100, 0] }, rotation: ['switch 椿'] })
    expect(at(out.log, 0)).toEqual([
      'loop', 'switch 散华→椿 变奏', 'start 椿 QTE', '椿 concerto +10 cast', '椿 core1 +100 cast', 'intro 椿',
    ])
    expect(eventsOfLog(out.log, 'actionStart')[0]!.cmd).toEqual({ line: 1, item: 1, loop: 1 })   // 变奏带切人指令的出处
    // 椿 QTE 局部第 36 帧：散华协奏清零 → outro → 散华.延奏（nextIn）挂给椿
    expect(at(out.log, 36)).toEqual(['散华 concerto -100 outro', 'outro 散华→椿', '+散华.延奏→椿×1 840'])
    expect(finalResources(out).concerto).toEqual([10, 0, 0])
    expect(out.summary.windowFrames).toBe(92)                                   // 统计窗口到变奏动作结束
  })

  test('T05-3 变奏被大招强制打断：延奏照常，按战斗时钟在变奏的局部触发帧发生', () => {
    const out = m0Run(gd, { initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['switch 散华', '散华 R!'] })
    const cancel = eventsOfLog(out.log, 'actionCancel')[0]!
    expect([cancel.f, cancel.action, cancel.by, cancel.dropped]).toEqual([42, 'QTE', '大招', ['QTE']])
    // 第 42、43 帧战斗时钟照走（尾部到局部 44），第 44–133 帧是大招的全局时停，第 134 帧起再走 9 帧 → 第 143 帧
    const outro = eventsOfLog(out.log, 'outro')
    expect(outro.map(e => [e.f, e.char, e.to])).toEqual([[143, '椿', '散华']])
    // 椿有延奏动作：独立时间线，局部第 6 帧（第 149 帧）生成判定。三个版本要等 TD-08 的钩子挑，这里全生成；
    // 倍率是伤害表的第 1 级（延奏不随技能等级成长）：3.2924 / 3.2924 / 4.5902，与 nanoka 3.7 一致
    expect(outro[0]!.instance).toBeTypeOf('number')
    const outroHits = eventsOfLog(out.log, 'hit').filter(h => h.char === '椿')
    expect(outroHits.map(h => [h.f, h.action, h.judgment])).toEqual([[149, '延奏', '延奏-C0普通'], [149, '延奏', '延奏-C0含苞'], [193, '延奏', '延奏-C0含苞追加']])
    expect(outroHits.every(h => h.dmg !== null && h.dmg.expected > 0)).toBe(true)
    expect(gd.characters['椿']!.actions['延奏']!.judgments.filter(j => j.chainRange?.max === 4).map(j => j.multiplier)).toEqual([3.2924, 3.2924, 4.5902])
  })

  test('T05-5 切人结束技能：切出时 A4 已过局部第 72 帧 → 按取消处理；没到则在后台打完', () => {
    const cut = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 A1 A2 A3 A4', 'wait 100', 'switch 散华'] })
    const c = eventsOfLog(cut.log, 'actionCancel').find(e => e.action === 'A4')!
    expect([c.by, c.dropped]).toEqual(['切人', ['A4-13', 'A4-14', 'A4-15', 'A4-16', 'A4-17', 'A4-18', 'A4-19', 'A4-20']])
    expect(c.f).toBe(eventsOfLog(cut.log, 'switch')[0]!.f)
    const bg = m0Run(gd, { initial: { onField: 0 }, rotation: ['椿 A1 A2 A3 A4', 'wait 30', 'switch 散华'] })
    expect(eventsOfLog(bg.log, 'hit').filter(h => h.action === 'A4')).toHaveLength(20)
    expect(eventsOfLog(bg.log, 'actionEnd').map(e => e.action)).toContain('A4')
  })

  test('T05-6 onSwitchOut clear：散华延奏挂在椿身上，椿被切下时移除', () => {
    const out = m0Run(gd, { initial: { onField: 1, concerto: [0, 100, 0] }, rotation: ['switch 椿', 'switch 维里奈'] })
    const exp = eventsOfLog(out.log, 'buffExpire').filter(e => e.buff === '散华.延奏')
    expect(exp.map(e => [e.f, e.target, e.reason])).toEqual([[eventsOfLog(out.log, 'switch')[1]!.f, '椿', 'switchOut']])
  })
})

// ---------------------------------------------------------------------------
// 人造角色

const QTE = (outroTriggerFrame: number) => action({
  id: 'QTE', kind: 'intro', endFrame: 60, outroTriggerFrame, priority: [{ fromFrame: 0, value: 11 }],
})

describe('TD-05 人造角色', () => {
  test('T05-4 延奏动作的独立时间线：不取消切出者的动作，也不被切出者之后的动作清掉', () => {
    const 甲: SynthChar = {
      name: '甲',
      actions: [
        action({ id: 'X', kind: 'normal', endFrame: 55, judgments: [judgment({ name: 'x', spawnFrame: 50 })] }),
        action({
          id: '延奏', kind: 'outro', endFrame: 90,
          judgments: [judgment({ name: 'y1', spawnFrame: 6 }), judgment({ name: 'y2', spawnFrame: 80, persistsOnCancel: false })],
        }),
        action({ id: 'Y', kind: 'normal', endFrame: 30 }),
      ],
    }
    const out = synthRun([甲, { name: '乙', actions: [QTE(20)] }, idle('丙')], {
      initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['甲 X', 'switch 乙', 'switch 甲', '甲 Y'],
    })
    expect(out.error).toBeUndefined()
    expect(eventsOfLog(out.log, 'outro').map(e => [e.f, e.char, e.to])).toEqual([[20, '甲', '乙']])
    // y1 在延奏后第 6 帧；X 没被取消，第 50 帧照常命中；第 60 帧切回甲出 Y，不可脱手的 y2 仍在第 100 帧命中
    expect(eventsOfLog(out.log, 'hit').map(h => [h.f, h.action, h.judgment])).toEqual([[26, '延奏', 'y1'], [50, 'X', 'x'], [100, '延奏', 'y2']])
    expect(eventsOfLog(out.log, 'actionCancel')).toEqual([])
    expect(eventsOfLog(out.log, 'actionStart').find(e => e.action === 'Y')).toMatchObject({ f: 60 })
    expect(eventsOfLog(out.log, 'actionStart').find(e => e.action === 'Y')!.dropped).toBeUndefined()
  })

  test('T05-7 切入者没有变奏动作：按普通切人，协奏不清零，记警告', () => {
    const out = synthRun([idle('甲'), { name: '乙', actions: [QTE(20)] }, idle('丙')], {
      initial: { onField: 0, concerto: [100, 0, 0] }, rotation: ['switch 丙'],
    })
    expect(eventsOfLog(out.log, 'switch').map(e => e.intro)).toEqual([false])
    expect(eventsOfLog(out.log, 'warning').map(w => w.code)).toEqual(['noIntro'])
    expect(finalResources(out).concerto).toEqual([100, 0, 0])
  })

  test('T05-8 变奏切人时切入者在后台还有动作：被变奏动作取消（§7）', () => {
    const 乙: SynthChar = { name: '乙', actions: [QTE(20), action({ id: 'B', kind: 'normal', endFrame: 300 })] }
    const out = synthRun([idle('甲'), 乙, idle('丙')], {
      initial: { onField: 1, concerto: [100, 0, 0] }, rotation: ['乙 B', 'switch 甲', 'switch 乙'],
    })
    expect(eventsOfLog(out.log, 'switch').map(e => [e.f, e.intro])).toEqual([[0, false], [60, true]])
    const c = eventsOfLog(out.log, 'actionCancel')
    expect(c.map(e => [e.f, e.action, e.by])).toEqual([[60, 'B', 'QTE']])
  })
})
