// tests/timeline.test.ts —— 时间轴网页的数据与嵌入（src/report/timeline.ts；网页本身是 web/timeline.html，不在这里测）；
// 调试表与视频时间点（TD-11 §6 P3）
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { renderDesign, renderTimeline, TIMELINE_VIEWS, timelineModel } from '../src/report/timeline'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData, type SynthChar } from './helpers/synth'

const 甲 = { name: '甲', actions: [action({ id: 'X', kind: 'skill', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gauges: { toughness: 10, tunability: 10 } })] })] }
const sc = ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
  enemy: { custom: { level: 90, tunabilityMax: 100, whiteBar: 50 } },
  rotation: ['甲 X X   # 注释里写 </script><b>', 'wait 10'],
})
const data = synthData([甲, idle('乙'), idle('丙')])
data.characters['甲']!.tunabilityRate = 1                          // 人造角色缺省偏谐效率 0
const r = resolveScenario(sc, data)
const res = simulate(r)
const template = readFileSync(new URL('../web/timeline.html', import.meta.url), 'utf8')

describe('时间轴网页', () => {
  test('模型：队伍的能量上限、敌人量表、排轴原文、各动作的类别；日志去掉判定生成', () => {
    const m = timelineModel('scenarios/demo.yaml', sc, r, res)
    expect(m.title).toBe('demo')
    expect(m.team.map(t => [t.name, t.energyCap])).toEqual([['甲', 100], ['乙', 100], ['丙', 100]])
    expect(m.enemy).toMatchObject({ tunabilityMax: 100, whiteBarTough: 50 })
    expect(m.kinds['甲']).toEqual({ X: 'skill' })
    expect(m.rotation[0]).toContain('</script>')
    expect((m.log as { type: string }[]).some(e => e.type === 'judgmentSpawn')).toBe(false)
    // 有量表的敌人：每次命中带上之后的偏谐值与白条
    expect(m.log.filter(e => e.type === 'hit').map(e => e.type === 'hit' && e.enemy)).toEqual([
      { tunability: 10, whiteBar: 40 }, { tunability: 20, whiteBar: 30 },
    ])
  })
  test('嵌入：数据里的 "<" 转义，取回来与原数据相同；标题换成队伍；独立网页带 doctype 与 charset，--fragment 不带', () => {
    const m = timelineModel('scenarios/demo.yaml', sc, r, res)
    const html = renderTimeline(template, m)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<title>甲·乙·丙 时间轴</title>')
    expect(html).not.toContain('</script><b>')
    const json = /<script id="timeline-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(m)))
    expect(html.indexOf('<title>')).toBeLessThan(html.indexOf('</head>'))
    const frag = renderTimeline(template, m, true)
    expect(frag.startsWith('<title>')).toBe(true)
    expect(frag).not.toContain('<!doctype')
  })
  test('调试表：每轮一份分段、逐条、资源逐步；视频时间点带仿真与按视频推算的世界帧', () => {
    const sc2 = ScenarioSchema.parse({ ...sc, rotation: ['甲 X', 'wait 30', '甲 X'], options: { repeat: 2 }, video: { loop: 1, marks: { 1: '0:10', 3: 11, 7: 12 } } })
    const r2 = resolveScenario(sc2, data)
    const m = timelineModel('scenarios/demo.yaml', sc2, r2, simulate(r2))
    expect(m.trace.map(t => [t.loop, t.commands.map(c => c.label), t.ledgers.map(l => l.name)])).toEqual([
      [1, ['甲 X', '甲 X'], ['协奏', '能量']], [2, ['甲 X', '甲 X'], ['协奏', '能量']],
    ])
    // 第 3 条比第 1 条晚 30 帧（wait 从 X 开始时算），视频里晚 1 秒：仿真快 0.5 秒
    expect(m.video).toEqual({
      loop: 1, missing: [7],
      marks: [{ line: 1, video: 0, sim: 0, diff: 0, step: 0, f: 0, vf: 0, at: 10 }, { line: 3, video: 1, sim: 0.5, diff: -0.5, step: -0.5, f: 30, vf: 60, at: 11 }],
      events: [], hp: [],
    })
    expect(timelineModel('scenarios/demo.yaml', sc, r, res).video).toBeNull()
  })
  test('录像里看到的动作（video.events，视图 F 对照用）：时刻按"分:秒"或秒数，动作换成动作 ID，换不了的为 null', () => {
    const sc3 = ScenarioSchema.parse({ ...sc, video: { marks: { 1: 10 }, events: ['10.5 甲 X', '0:11 甲 Y', '12 丁 X'] } })
    const r3 = resolveScenario(sc3, data)
    expect(timelineModel('scenarios/demo.yaml', sc3, r3, simulate(r3)).video!.events).toEqual([
      { t: 10.5, char: '甲', label: 'X', action: 'X' }, { t: 11, char: '甲', label: 'Y', action: null }, { t: 12, char: '丁', label: 'X', action: null },
    ])
    expect(() => ScenarioSchema.parse({ ...sc, video: { marks: { 1: 10 }, events: ['甲 X'] } })).toThrow(/视频秒/)
  })
  test('录像里敌人的血条（video.hp，视图 F 对照累计伤害）："<视频秒> <剩余比例>"；模型带上敌人生命', () => {
    const sc4 = ScenarioSchema.parse({ ...sc, video: { marks: { 1: 10 }, hp: ['10.5 1', '0:12 0.62'] } })
    const r4 = resolveScenario(sc4, data)
    const m = timelineModel('scenarios/demo.yaml', sc4, r4, simulate(r4))
    expect(m.video!.hp).toEqual([{ t: 10.5, left: 1 }, { t: 12, left: 0.62 }])
    expect(m.enemy.hp).toBe(r4.enemy.hp)
    expect(() => ScenarioSchema.parse({ ...sc, video: { marks: { 1: 10 }, hp: ['10.5 62%'] } })).toThrow(/剩余比例/)
  })
  test('视图 D 的检查器：每人能量、协奏与有变化的核心资源逐帧值（只在变了的帧记），钩子 forte 给的共鸣回路状态变了才记', () => {
    const 丁: SynthChar = {
      name: '丁', core: [{ slot: 1, name: '蓄', cap: 10 }, { slot: 2, name: '没用到', cap: 5 }], vars: { 段: 0 },
      actions: [action({ id: 'Y', kind: 'skill', endFrame: 30, judgments: [judgment({ name: 'y', spawnFrame: 10, gains: { energy: 0, concerto: 6, core: [3, 0, 0] } })] })],
      hooks: {
        onEvent: (ctx, ev) => { if (ev.type === 'hit') ctx.vars.段 = Number(ctx.vars.段) + 1 },
        forte: ctx => `第 ${ctx.vars.段} 段`,
      },
    }
    const sc3 = ScenarioSchema.parse({ team: ['丁', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['丁 Y Y'] })
    const r3 = resolveScenario(sc3, synthData([丁, idle('乙'), idle('丙')]))
    const res3 = simulate(r3)
    const own = timelineModel('scenarios/demo.yaml', sc3, r3, res3).resources.find(x => x.char === '丁')!
    expect(own.tracks.map(t => [t.key, t.name, t.cap])).toEqual([['energy', '能量', 100], ['concerto', '协奏', 100], ['core1', '蓄', 10]])   // 没变过的槽不列
    expect(own.tracks.find(t => t.key === 'core1')!.steps).toEqual([[0, 0], [10, 3], [40, 6]])
    expect(own.tracks.find(t => t.key === 'concerto')!.steps).toEqual([[0, 0], [10, 6], [40, 12]])
    expect(res3.forte.map(x => [x.f, x.char, x.text])).toEqual([[0, '丁', '第 0 段'], [10, '丁', '第 1 段'], [40, '丁', '第 2 段']])
  })
  test('冷却（视图 E 的帧画面）：放了技能记"从第几战斗帧起能用"，倒计时与全局时停里不再记，好了记 null；按次数充能的另记还剩几次', () => {
    const 戊: SynthChar = {
      name: '戊',
      actions: [
        action({ id: 'Y', kind: 'skill', endFrame: 30, cooldown: 100 }),
        action({ id: 'T', kind: 'other', endFrame: 60, dilations: [{ type: '全局时停', anchor: 'action', start: 1, ally: { rate: 0, duration: 50 }, enemy: { rate: 0, duration: 50 } }] }),
        action({ id: 'C', kind: 'echo', endFrame: 10, cooldown: 120, charges: 2 }),
      ],
    }
    const sc4 = ScenarioSchema.parse({ team: ['戊', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })), enemy: { custom: { level: 90 } }, rotation: ['戊 Y T Y', '戊 C C', 'wait 300'] })
    const res4 = simulate(resolveScenario(sc4, synthData([戊, idle('乙'), idle('丙')])))
    // T 的 50 帧全局时停：Y 的"第 100 战斗帧起能用"不变，世界第 150 帧第二次放出
    expect(res4.cooldowns.filter(x => x.key === 'Y').map(x => [x.f, x.ready])).toEqual([[0, 100], [149, null], [150, 200], [249, null]])
    expect(res4.cooldowns.filter(x => x.key === 'echo').map(x => [x.f, x.ready, x.charges])).toEqual([[180, 250, 1], [190, 250, 0], [299, 370, 1], [419, null, 2]])
    expect(timelineModel('scenarios/demo.yaml', sc4, resolveScenario(sc4, synthData([戊, idle('乙'), idle('丙')])), res4).cooldowns).toBe(res4.cooldowns)
  })
  test('角色颜色（web/designs/shared.js 的 teamColors）：同元素的第一个用元素色，第二个往 --ink 调、第三个往 --panel 调；不同元素不动', () => {
    const win: { WW?: { teamColors: (m: { team: { element: string }[] }) => string[] } } = {}
    new Function('window', readFileSync(new URL('../web/designs/shared.js', import.meta.url), 'utf8'))(win)
    const colors = (...els: string[]) => win.WW!.teamColors({ team: els.map(element => ({ element })) })
    expect(colors('导电', '导电', '导电')).toEqual(['var(--el-electro)', 'color-mix(in oklab, var(--el-electro) 65%, var(--ink))', 'color-mix(in oklab, var(--el-electro) 75%, var(--panel))'])
    expect(colors('湮灭', '衍射', '湮灭')).toEqual(['var(--el-havoc)', 'var(--el-spectro)', 'color-mix(in oklab, var(--el-havoc) 65%, var(--ink))'])
    expect(colors('冷凝', '湮灭', '衍射')).toEqual(['var(--el-glacio)', 'var(--el-havoc)', 'var(--el-spectro)'])
  })
  test('视频对照（视图 E，web/designs/shared.js 的 videoMap）：锚点之间按直线拉伸、两头 60 帧一秒外推；offset 只用最早的点；两个方向互逆', () => {
    type Map2 = { t2f: (t: number) => number; f2t: (f: number) => number }
    const win: { WW?: { videoMap: (a: { t: number; f: number }[], mode: string) => Map2 } } = {}
    new Function('window', readFileSync(new URL('../web/designs/shared.js', import.meta.url), 'utf8'))(win)
    // 视频 10 秒 = 第 0 帧，12 秒 = 第 150 帧（仿真这一段比视频长 30 帧）
    const anchors = [{ t: 12, f: 150 }, { t: 10, f: 0 }]
    const s = win.WW!.videoMap(anchors, 'stretch'), o = win.WW!.videoMap(anchors, 'offset')
    expect([9, 10, 11, 12, 13].map(s.t2f)).toEqual([-60, 0, 75, 150, 210])
    expect([10, 11, 12].map(o.t2f)).toEqual([0, 60, 120])
    for (const t of [8.5, 10.4, 11.9, 14]) { expect(s.f2t(s.t2f(t))).toBeCloseTo(t, 9); expect(o.f2t(o.t2f(t))).toBeCloseTo(t, 9) }
    expect(win.WW!.videoMap([], 'stretch').t2f(2)).toBe(120)                 // 没有锚点：视频 0 秒就是第 0 帧
  })
  test('视图 A–D（pnpm timeline --view）：模板都在、共用脚本内联、数据带上 buff 的给予者与定义', () => {
    const m = timelineModel('scenarios/demo.yaml', sc, r, res)
    const shared = readFileSync(new URL('../web/designs/shared.js', import.meta.url), 'utf8')
    for (const file of Object.values(TIMELINE_VIEWS)) {
      const html = renderDesign(readFileSync(new URL(`../web/designs/${file}`, import.meta.url), 'utf8'), shared, m)
      expect(html.startsWith('<!doctype html>')).toBe(true)
      expect(html).toContain('window.WW')
      expect(html).not.toContain('/*@shared*/')
      const json = /<script id="timeline-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!
      expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(m)))
    }
    expect(Object.keys(m.buffOwners).length).toBe(Object.keys(m.buffInfo).length)
  })
})
