// tests/td09.test.ts —— TD-09 排轴脚本与调度语义的用例
// T09-1、T09-2、T09-4、T09-6（前半）、T09-7、T09-8 用人造动作，总能跑；其余依赖 data/generated（没有时跳过）。
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseRotationLine } from '../src/data/scenario.schema'
import type { ActionDef } from '../src/data/gamedata'
import { compileRotation, ScheduleError, type CompileMember } from '../src/engine/scheduler'
import 椿 from '../data/curated/characters/椿'
import 散华 from '../data/curated/characters/散华'
import 维里奈 from '../data/curated/characters/维里奈'
import { action, block, dataDescribe, eventsOf, hasData, judgment, member, run, tryRun, type Cmd, type RunResult } from './helpers/kernel-harness'

const starts = (r: RunResult) => eventsOf(r, 'actionStart').map(e => `${e.action}@${e.f}`)
const waits = (r: RunResult) => eventsOf(r, 'wait').map(e => `${e.cmd.line}:${e.code} ${e.from}+${e.frames}`)
const thrown = (f: () => unknown): ScheduleError => {
  try { f() } catch (e) { if (e instanceof ScheduleError) return e; throw e }
  throw new Error('没有报错')
}

// 人造动作：A1 → A2 连段、E（优先级 4）、大招（10）、变奏
const A = (id: string, o: Partial<ActionDef> = {}): ActionDef => action({ id, endFrame: 30, ...o })
const acts: Record<string, ActionDef> = {
  A1: A('A1', { cancelWindows: [{ from: 10, until: 40, row: 0 }] }),
  A2: A('A2', { comboFrom: ['A1'] }),
  E: A('E', { priority: [{ fromFrame: 0, value: 4 }] }),
  大招: A('大招', { kind: 'liberation', priority: [{ fromFrame: 0, value: 10 }] }),
  QTE: A('QTE', { kind: 'intro' }),
}
const fake: CompileMember[] = ['甲', '乙', '丙'].map(name => ({ name, actions: acts, aliases: { R: '大招' } }))

describe('T09-1 语法（§2）', () => {
  const act = (action: string, delay = 0, force = false) => ({ kind: 'act', char: '散华', action, delay, force })
  test('一行多个动作、强制、延迟', () => {
    expect(parseRotationLine('散华 E A1 A2 +3 大招!')).toEqual([act('E'), act('A1'), act('A2', 3), act('大招', 0, true)])
    expect(parseRotationLine('散华 大招 ! +5')).toEqual([act('大招', 5, true)])
    expect(parseRotationLine('散华 A2+3')).toEqual([act('A2', 3)])
  })
  test('全角标点与全角空格、注释、中文关键词', () => {
    expect(parseRotationLine('散华　大招！ ＋5   # 开大')).toEqual([act('大招', 5, true)])
    expect(parseRotationLine('# 第二轮')).toEqual([])
    expect(parseRotationLine('千咲 电锯A2#2')).toEqual([{ kind: 'act', char: '千咲', action: '电锯A2#2', delay: 0, force: false }])
    expect(parseRotationLine('切人 长离')).toEqual([{ kind: 'switch', char: '长离' }])
    expect(parseRotationLine('等待 20')).toEqual([{ kind: 'wait', frames: 20 }])
    expect(parseRotationLine('散华 A2 ＋３ E ＃注释')).toEqual([act('A2', 3), act('E')])   // 全角数字、＃ 也按半角
    expect(parseRotationLine('等待 ３０')).toEqual([{ kind: 'wait', frames: 30 }])
  })
  test('错误', () => {
    const err = (s: string) => { const r = parseRotationLine(s); return 'error' in r ? r.error : '' }
    expect(err('散华')).toContain('只有角色名')
    expect(err('散华 +3')).toContain('前面要有动作')
    expect(err('散华 A2 3')).toContain('延迟要写成 +3')
    expect(err('散华 A2 +3 +4')).toContain('两个延迟')
    expect(err('散华 A2 +0 +4')).toContain('两个延迟')
    expect(err('等待 abc')).toContain('格式不对')
    expect(err('switch')).toContain('格式不对')
  })
})

describe('T09-2 编译：名字解析与静态检查（§4）', () => {
  test('别名、行号与行内序号', () => {
    const r = compileRotation(['甲 E R', 'switch 乙', '乙 A1 A2! +3', 'wait 10'], fake, 0)
    expect(r).toEqual({
      ok: true, commands: [
        { kind: 'act', line: 1, item: 1, slot: 0, action: 'E', delay: 0, force: false },
        { kind: 'act', line: 1, item: 2, slot: 0, action: '大招', delay: 0, force: false },
        { kind: 'switch', line: 2, item: 1, to: 1 },
        { kind: 'act', line: 3, item: 1, slot: 1, action: 'A1', delay: 0, force: false },
        { kind: 'act', line: 3, item: 2, slot: 1, action: 'A2', delay: 3, force: true },
        { kind: 'wait', line: 4, item: 1, frames: 10 },
      ],
    })
  })
  test('错误一次报全，按行排序', () => {
    const r = compileRotation(['乙 E', '甲 QTE', 'switch 甲', '甲 X', '丁 E'], fake, 0)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map(i => `${i.line}: ${i.message}`)).toEqual([
      '1: 乙 不在前台（前台是 甲）；先写 switch 乙',
      '2: 甲 QTE 是变奏，由切人自动触发（协奏满时），不能单独写',
      '3: switch 甲：甲 已经在前台',
      '4: 甲 没有动作"X"（别名：R）',
      '5: 丁 不在队伍里（队伍：甲、乙、丙）',
    ])
  })
  test('名字按自有键查：toString 之类不会误认成动作；切人写错时不连带报前台', () => {
    const r = compileRotation(['甲 toString', 'switch 丁', '乙 E'], fake, 0)
    expect(r.ok ? [] : r.issues.map(i => `${i.line}: ${i.message}`)).toEqual([
      '1: 甲 没有动作"toString"（别名：R）',
      '2: 丁 不在队伍里（队伍：甲、乙、丙）',
    ])
  })
  test('循环：第 2 轮从第 1 轮结束时的前台开始', () => {
    const lines = ['甲 E', 'switch 乙', '乙 E']
    expect(compileRotation(lines, fake, 0, 1).ok).toBe(true)
    const r = compileRotation(lines, fake, 0, 2)
    expect(r.ok ? [] : r.issues.map(i => i.message)).toEqual(['循环第 2 轮：甲 不在前台（前台是 乙）；循环的轴，末尾要让前台回到 甲'])
    expect(compileRotation([...lines, 'switch 甲'], fake, 0, 2).ok).toBe(true)
  })
})

const common = hasData ? block('通用-中@女') : {}
const sh = hasData ? { ...common, ...block('散华') } : {}
const SH = [sh, sh, sh]
const shRun = (cmds: Cmd[], o = {}) => run(SH, cmds, { names: ['散华', '乙', '丙'], ...o })

dataDescribe('T09-3 最早合法帧与等待记录：散华', () => {
  test('E → A1：A1（2）要等 E 的优先级从 4 降到 2（第 60 帧），记一段"优先级"等待', () => {
    const r = shRun([{ act: 0, action: 'E' }, { act: 0, action: 'A1' }])
    expect(starts(r)).toEqual(['E@0', 'A1@60'])
    expect(waits(r)).toEqual(['2:priority 0+60'])
  })
  test('A1 → E：默认等 A1 的判定出手（第 14 帧）；强制则第 1 帧（同一角色一个 tick 只能开始一个动作）', () => {
    expect(waits(shRun([{ act: 0, action: 'A1' }, { act: 0, action: 'E' }]))).toEqual(['2:settled 0+14'])
    const f = shRun([{ act: 0, action: 'A1' }, { act: 0, action: 'E', force: true }])
    expect(starts(f)).toEqual(['A1@0', 'E@1'])
    expect(waits(f)).toEqual(['2:started 0+1'])
  })
  test('+N：A2 最早第 26 帧（等 A1 的派生窗口），+3 → 第 29 帧', () => {
    const r = shRun([{ act: 0, action: 'A1' }, { act: 0, action: 'A2', delay: 3 }])
    expect(starts(r)).toEqual(['A1@0', 'A2@29'])
    expect(waits(r)).toEqual(['2:combo 0+26', '2:delay 26+3'])
  })
  test('+N 把连段等断：A2 +40 → 窗口关闭时（第 55 帧）报"连段中断"', () => {
    const e = thrown(() => shRun([{ act: 0, action: 'A1' }, { act: 0, action: 'A2', delay: 40 }]))
    expect([e.code, e.frame, e.cmd]).toEqual(['comboBroken', 55, { line: 2, item: 1, loop: 1 }])
    expect(e.message).toBe('第 2 条 散华 A2：A1 的派生窗口已过，连段中断')
  })
})

describe('T09-4 人造动作：+N 从"全部满足"起算；只有等待开头的轮次', () => {
  test('A1 E! +3：E 最早第 1 帧（本 tick 已出过招），再等 3 帧 → 第 4 帧', () => {
    const r = run([acts, acts, acts], [{ act: 0, action: 'A1' }, { act: 0, action: 'E', force: true, delay: 3 }])
    expect(starts(r)).toEqual(['A1@0', 'E@4'])
    expect(waits(r)).toEqual(['2:started 0+1', '2:delay 1+3'])
  })
  test('wait 10、E × 3：轮次边界在每轮的 E 起手时（第 10 / 40 / 70 帧），不在开始等待时', () => {
    const r = run([acts, acts, acts], [{ wait: 10 }, { act: 0, action: 'E' }], { repeat: 3 })
    expect(starts(r)).toEqual(['E@10', 'E@40', 'E@70'])
    expect(eventsOf(r, 'loop').map(e => e.f)).toEqual([10, 40, 70])
  })
  test('空的指令表：直接结束', () => {
    expect(run([acts, acts, acts], [], { repeat: 2 }).frames).toBe(0)
  })
})

dataDescribe('T09-5 wait N 与 +N 按战斗帧：散华', () => {
  test('A1、wait 60、E：E 在第 60 帧', () => {
    const r = shRun([{ act: 0, action: 'A1' }, { wait: 60 }, { act: 0, action: 'E' }])
    expect(starts(r)).toEqual(['A1@0', 'E@60'])
    expect(waits(r)).toEqual(['2:wait 0+60'])
  })
  test('大招的全局时停里 wait 30：战斗帧 30，世界帧 120', () => {
    const r = shRun([{ act: 0, action: '大招' }, { wait: 30 }])
    expect(eventsOf(r, 'wait').map(e => [e.frames, e.battleFrames])).toEqual([[120, 30]])
  })
})

describe('T09-6 切人（§3.5）', () => {
  test('切人冷却 60 帧', () => {
    const r = run([acts, acts, acts], [{ switch: 1 }, { switch: 0 }])
    expect(eventsOf(r, 'switch').map(e => `${e.to}@${e.f}`)).toEqual(['乙@0', '甲@60'])
    expect(waits(r)).toEqual(['2:switchCd 0+60'])
  })
  dataDescribe('真实数据', () => {
    test('切人不打断动作：A1 同帧切走，A1 在后台第 13 帧照常命中', () => {
      const r = shRun([{ act: 0, action: 'A1' }, { switch: 1 }])
      expect(eventsOf(r, 'switch').map(e => e.f)).toEqual([0])
      expect(r.hits.map(h => `${h.judgment}@${h.f}`)).toEqual(['A1@13'])
    })
    test('切人锁越过结束帧：散华 QTE 结束帧 63，"第70F前不能切人" → 第 70 帧才能切', () => {
      const r = shRun([{ act: 0, action: 'QTE' }, { switch: 1 }])
      expect(eventsOf(r, 'switch').map(e => e.f)).toEqual([70])
      expect(waits(r)).toEqual(['2:switchLock 0+70'])
    })
  })
})

describe('T09-7 技能冷却按战斗时钟（§3.2）', () => {
  const X = A('X', { cooldown: 100 })
  const Y = A('Y', { endFrame: 60, dilations: [{ type: '全局时停', anchor: 'action', start: 1, ally: { rate: 0, duration: 50 } }] })
  const T: Record<string, ActionDef>[] = [{ X, Y }, {}, {}]
  test('X 冷却 100：第二次 X 先等 X 结束（30），再等冷却到第 100 帧', () => {
    const r = run(T, [{ act: 0, action: 'X' }, { act: 0, action: 'X' }])
    expect(starts(r)).toEqual(['X@0', 'X@100'])
    expect(waits(r)).toEqual(['2:derive 0+30', '2:cooldown 30+70'])
  })
  test('中间插一个 50 帧的全局时停：冷却停走，第二次 X 推迟到第 150 帧', () => {
    const r = run(T, [{ act: 0, action: 'X' }, { act: 0, action: 'Y' }, { act: 0, action: 'X' }])
    expect(starts(r)).toEqual(['X@0', 'Y@30', 'X@150'])
  })
})

describe('T09-8 等不来：超时与报错位置（§3.3）', () => {
  test('冷却 1000、maxWait 300：第 2 条等满 300 帧报错', () => {
    const T: Record<string, ActionDef>[] = [{ X: A('X', { cooldown: 1000 }) }, {}, {}]
    const e = thrown(() => run(T, [{ act: 0, action: 'X' }, { act: 0, action: 'X' }], { maxWait: 300 }))
    expect([e.code, e.frame, e.cmd?.line]).toEqual(['timeout', 300, 2])
    expect(e.message).toBe('第 2 条等了 300 帧仍不能执行：X 冷却还剩 700 帧')
  })
  test('报错前先把正在等的那一段写进日志；一行多个动作时报到"第几个"', () => {
    const T: Record<string, ActionDef>[] = [{ X: A('X', { cooldown: 1000 }) }, {}, {}]
    const t = tryRun(T, [{ act: 0, action: 'X' }, { act: 0, action: 'X' }], { maxWait: 300 })
    expect([t.error?.code, waits(t)]).toEqual(['timeout', ['2:derive 0+30', '2:cooldown 30+270']])
    const c = compileRotation(['甲 A1 A2 +40'], fake, 0)
    const e = thrown(() => run([acts, acts, acts], c.ok ? c.commands : []))
    expect([e.code, e.frame, e.message]).toEqual(['comboBroken', 40, '第 1 条第 2 个 甲 A2：A1 的派生窗口已过，连段中断'])
  })
  test('帧数上限：还有指令没执行 → 报错并指出下一条；只剩判定 → 停下记警告', () => {
    const e = thrown(() => run([acts, acts, acts], [{ act: 0, action: 'E' }], { repeat: 3, maxFrames: 50 }))
    expect([e.code, e.message]).toEqual(['maxFrames', '超过 50 帧，第 3 轮第 1 条还没执行；调大 options.maxFrames'])
    const long = A('L', { judgments: [judgment({ name: 'L', spawnFrame: 5, lifeFrames: 400, ticks: 4, tickInterval: 100 })] })
    const r = run([{ L: long }, {}, {}], [{ act: 0, action: 'L' }], { maxFrames: 100 })
    expect(eventsOf(r, 'warning').map(w => w.code)).toEqual(['maxFrames'])
  })
  test('+N 与 wait 是写轴的人要的等待，不计入 maxWait', () => {
    const r = run([acts, acts, acts], [{ wait: 500 }, { act: 0, action: 'E', delay: 400 }], { maxWait: 300 })
    expect(starts(r)).toEqual(['E@900'])
  })
})

dataDescribe('T09-9 循环（§3.7）：散华 E A1 × 3', () => {
  const r = shRun([{ act: 0, action: 'E' }, { act: 0, action: 'A1' }], { repeat: 3 })
  test('每轮第一条指令生效时记 loop 事件；第 1 轮从空闲开始，比稳态短 5 帧', () => {
    expect(eventsOf(r, 'loop').map(e => `${e.loop}@${e.f}`)).toEqual(['1@0', '2@74', '3@153'])
    expect(starts(r)).toEqual(['E@0', 'A1@60', 'E@74', 'A1@139', 'E@153', 'A1@218'])
  })
  test('等待记录带轮次', () => {
    expect(eventsOf(r, 'wait').map(e => `${e.cmd.loop}.${e.cmd.line}:${e.code} ${e.frames}`))
      .toEqual(['1.2:priority 60', '2.1:settled 14', '2.2:priority 65', '3.1:settled 14', '3.2:priority 65'])
  })
})

dataDescribe('T09-10 编译 + 运行：M0 队伍（椿 0 链、散华 6 链、维里奈 3 链）', () => {
  const team = hasData ? [member(椿, 0), member(散华, 6), member(维里奈, 3)] : []
  const go = (lines: string[], onField: 0 | 1 | 2, repeat = 1) => {
    const c = compileRotation(lines, team, onField, repeat)
    if (!c.ok) throw new Error(c.issues.map(i => i.message).join('；'))
    return run(team.map(m => m.actions), c.commands, { names: ['椿', '散华', '维里奈'], onField, repeat, maxWait: 600 })
  }
  test('散华 E A1…A5 R：大招默认等 A5 出手，第 230 帧', () => {
    const r = go(['散华 E A1 A2 A3 A4 A5 R'], 1)
    expect(starts(r)).toEqual(['E@0', 'A1@60', 'A2@86', 'A3@121', 'A4@158', 'A5@196', '大招@230'])
    expect(eventsOf(r, 'wait').map(e => `${e.cmd.item}:${e.code} ${e.frames}`))
      .toEqual(['2:priority 60', '3:combo 26', '4:combo 35', '5:combo 36', '5:settled 1', '6:combo 38', '7:settled 34'])
  })
  test('椿 A1…A5：默认等 A4 的 20 段打完，A5 在第 265 帧；强制 A5 在第 169 帧，A4 只打出 5 段', () => {
    const d = go(['椿 A1 A2 A3 A4 A5'], 0)
    const f = go(['椿 A1 A2 A3 A4 A5!'], 0)
    expect([starts(d).at(-1), starts(f).at(-1)]).toEqual(['A5@265', 'A5@169'])
    const a4 = (r: RunResult) => r.hits.filter(h => h.judgment.startsWith('A4-')).length
    expect([a4(d), a4(f)]).toEqual([20, 5])
  })
  test('三人各放一次 E 轮换两轮：切人不打断动作；第 2 轮等散华 E（10 秒）与维里奈 E（12 秒）的冷却', () => {
    const r = go(['散华 E', 'switch 椿', '椿 E', 'switch 维里奈', '维里奈 E', 'switch 散华'], 1, 2)
    expect(eventsOf(r, 'switch').map(e => e.f)).toEqual([0, 60, 120, 600, 660, 780])
    expect(eventsOf(r, 'loop').map(e => e.f)).toEqual([0, 600])
    expect(starts(r)).toEqual(['E@0', 'E1@0', 'E@60', 'E@600', 'E1@600', 'E@780'])
    expect(eventsOf(r, 'wait').filter(e => e.code === 'cooldown').map(e => `${e.cmd.loop}.${e.cmd.line} ${e.frames}`)).toEqual(['2.1 480', '2.5 120'])
  })
  test('椿的 E1 / E2 共用 4 秒冷却，E1 后接 E2 要等到第 240 帧；一日花 E3 单独 25 秒，不受 E1 影响', () => {
    const r = go(['椿 E1 E2'], 0)
    expect(starts(r)).toEqual(['E1@0', 'E2@240'])
    expect(waits(r)).toEqual(['1:derive 0+85', '1:cooldown 85+155'])
    const e3 = go(['椿 E1 E3'], 0)
    expect(starts(e3)).toEqual(['E1@0', 'E3@36'])      // 一日花优先级 8 > E1 的 4：E1 第 2 段出手后即可接，不等 E1 的冷却
    const b = e3.s.battleFrames                          // 两个冷却各算各的：E 从第 0 帧、E3 从第 36 帧起算
    expect(e3.s.chars[0].cooldowns).toEqual({ E: 240 - b, E3: 1500 - (b - 36) })
  })
})

dataDescribe('T09-11 全量：每条普攻连段按默认与强制各连按一遍（§8）', () => {
  const dir = new URL('../data/generated/', import.meta.url)
  const chars = JSON.parse(readFileSync(new URL('characters.json', dir), 'utf8')) as Record<string, { commonBlock: string | null }>
  let chains = 0, slower = 0, maxGap = 0
  const broken: string[] = [], noWindow: string[] = []
  for (const f of readdirSync(new URL('actions/', dir))) {
    const key = f.replace(/\.json$/, '')
    if (key.startsWith('通用')) continue
    const cb = chars[key]?.commonBlock
    const b = { ...(cb ? block(cb) : {}), ...block(key) }
    for (const [id, d] of Object.entries(b)) {
      if (d.flags.includes('comboNoWindow')) noWindow.push(`${key} ${id}`)
      if (!d.comboFrom?.length || Object.values(b).some(x => x.comboFrom?.includes(id))) continue   // 只从链尾往回找
      const chain = [id]
      for (let cur = d; cur.comboFrom?.length && b[cur.comboFrom[0]!]; cur = b[cur.comboFrom[0]!]!) chain.unshift(cur.comboFrom[0]!)
      chains++
      const last = (force: boolean) => {
        const r = run([b, b, b], chain.map(a => ({ act: 0 as const, action: a, force })), { maxFrames: 5000 })
        return eventsOf(r, 'actionStart').at(-1)!.f
      }
      try {
        const gap = last(false) - last(true)
        if (gap > 0) { slower++; maxGap = Math.max(maxGap, gap) }
      } catch { broken.push(`${key} ${chain.join('→')}`) }
    }
  }
  test('119 条连段，默认策略没有把任何一条等断；断的只有凌阳 A3 → A4（A4 起手优先级 2 低于 A3 的 3，数据问题）', () => {
    expect(chains).toBe(119)
    expect(broken).toEqual(['凌阳 A1→A2→A3→A4→A5'])
  })
  test('前置动作没有派生窗口的 7 组不设连段前置（comboNoWindow）', () => {
    expect(noWindow.sort()).toEqual(['布兰特 空中A2', '布兰特 空中A4', '洛瑟菈 强化A4', '陆·赫斯 空中A3', '陆·赫斯 空中A4', '露西 A2', '鉴心 A4'].sort())
  })
  test('默认比强制慢的 7 条，最多慢 96 帧（椿 A4 → A5）', () => { expect([slower, maxGap]).toEqual([7, 96]) })
})
