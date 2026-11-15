// tests/summary-boundaries.test.ts —— DD-03 §5–§7（C03-6 ~ C03-22）：覆盖率（按提供者与并集）、致死与溢出拆分、口径闸门与伤害口径声明
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { dpsBreakdown, tryCompareRuns } from '../src/engine/analysis'
import { basisOf, usableBasis } from '../src/engine/basis'
import { resolveScenario } from '../src/engine/resolve'
import { scorecards } from '../src/engine/scorecard'
import { sensitivityMatrix } from '../src/engine/sensitivity'
import { simulate } from '../src/engine/simulate'
import type { ResolvedScenario, SimResult } from '../src/engine/types'
import { action, dataDescribe, judgment } from './helpers/kernel-harness'
import { eventsOfLog, idle, synthData, synthRun, type SynthChar } from './helpers/synth'

const NO_CRIT_BUFF = {
  id: '必不暴',
  source: 'test',
  target: 'self' as const,
  trigger: 'always' as const,
  duration: 'inf' as const,
  zone: 'critRate' as const,
  value: -1,
}

const ZERO_DEF_ENEMY = { custom: { level: 90, hp: 1000, def: 0, res: { 物理: 0 } } }

function makeResolved(chars: [SynthChar, SynthChar, SynthChar], sc: Record<string, unknown>): ResolvedScenario {
  return resolveScenario(ScenarioSchema.parse({
    team: chars.map(c => ({ char: c.name, weapon: { name: '测试武器' } })),
    enemy: ZERO_DEF_ENEMY,
    ...sc,
  }), synthData(chars))
}

describe('DD-03 §5：buffUptimeBy 与并集（C03-6 / C03-7）', () => {
  test('C03-6：两人先后挂同名 buff，日记区分 owner/instanceId，并集覆盖率 = 0.75、分人各 0.5', () => {
    const buff = {
      id: '同名',
      source: 'test',
      target: 'enemy' as const,
      duration: 120,
      trigger: { on: 'actionStart' as const, where: { actions: ['挂'] } },
    }
    const act = action({ id: '挂', endFrame: 10 })
    const res = synthRun(
      [
        { name: '甲', actions: [act], buffs: [buff] },
        { name: '乙', actions: [act], buffs: [buff] },
        idle('丙'),
      ],
      {
        initial: { onField: 0 },
        rotation: ['甲 挂', 'switch 乙', 'wait 60', '乙 挂', 'wait 180'],
        options: { repeat: 1 },
      },
    )

    const applies = eventsOfLog(res.log, 'buffApply').filter(e => e.buff === '同名')
    expect(applies).toHaveLength(2)
    expect(applies.map(a => a.owner)).toEqual(['甲', '乙'])
    expect(new Set(applies.map(a => a.instanceId)).size).toBe(2)

    expect(res.summary.windowFrames).toBe(240)
    const rows = res.summary.buffUptimeBy.filter(r => r.buff === '同名' && r.target === 'enemy')
    expect(rows.map(r => [r.owner, r.uptime])).toEqual([['甲', 0.5], ['乙', 0.5]])
    // [0, 120) ∪ [60, 180) = [0, 180) → 180 / 240 = 0.75（基线只算到甲到期 ≈ 0.5）
    expect(res.summary.buffUptime['同名→enemy']).toBeCloseTo(0.75, 12)
    expect(res.summary.buffUptime['同名→enemy']).not.toBeCloseTo(0.5, 6)
  })

  test('C03-7：同一人 buff 到期当帧重挂，并集不重复计这一帧（≤ 1）', () => {
    const buff = {
      id: '同名',
      source: 'test',
      target: 'enemy' as const,
      duration: 120,
      trigger: { on: 'actionStart' as const, where: { actions: ['挂'] } },
    }
    const act = action({ id: '挂', endFrame: 1 })
    const res = synthRun(
      [{ name: '甲', actions: [act], buffs: [buff] }, idle('乙'), idle('丙')],
      {
        initial: { onField: 0 },
        // 第 0 帧挂（P6 倒数 120 帧，在 f=119 的 P6 timeout → 区间 [0, 120)）；wait 120 后 f=120 再挂（[120, 240)），总窗 240 帧
        rotation: ['甲 挂', 'wait 120', '甲 挂', 'wait 120'],
        options: { repeat: 1 },
      },
    )

    const applies = eventsOfLog(res.log, 'buffApply').filter(e => e.buff === '同名')
    const expires = eventsOfLog(res.log, 'buffExpire').filter(e => e.buff === '同名')
    expect(applies.map(a => a.f)).toEqual([0, 120])
    expect(expires.some(e => e.f === 119 && e.reason === 'timeout')).toBe(true)

    expect(res.summary.windowFrames).toBe(240)
    expect(res.summary.buffUptime['同名→enemy']).toBeCloseTo(1, 12)
    expect(res.summary.buffUptime['同名→enemy']).toBeLessThanOrEqual(1)
    expect(res.summary.buffUptimeBy.find(r => r.buff === '同名' && r.owner === '甲')!.uptime).toBeCloseTo(1, 12)

    // 同帧刷新（到期前 1 帧 f=119 再挂）也不超过 1
    const resRefresh = synthRun(
      [{ name: '甲', actions: [act], buffs: [buff] }, idle('乙'), idle('丙')],
      {
        initial: { onField: 0 },
        rotation: ['甲 挂', 'wait 119', '甲 挂', 'wait 120'],
        options: { repeat: 1 },
      },
    )
    expect(resRefresh.summary.buffUptime['同名→enemy']).toBeCloseTo(1, 12)
    expect(resRefresh.summary.buffUptime['同名→enemy']).toBeLessThanOrEqual(1)
  })
})

describe('DD-03 §6：致死与溢出拆分（C03-8 ~ C03-11）', () => {
  test('C03-8：一下 1500 在战斗帧 30 打死 1000 血敌人 → overflow 500、raw 1500、effective 1000、byChar 之和 = goal.dps', () => {
    const hit1500 = action({
      id: '重砍',
      endFrame: 60,
      judgments: [judgment({ name: '一刀', spawnFrame: 30, multiplier: 1.5 })],
    })
    const r = makeResolved(
      [{ name: '甲', actions: [hit1500], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, goal: { kill: 1 }, rotation: ['甲 重砍'], options: { repeat: 1 } },
    )
    const res = simulate(r)
    expect(res.summary.kill.frame).toBe(30)
    expect(res.summary.kill.overflow).toBeCloseTo(500, 9)
    expect(res.summary.goal?.lethal?.overflow).toBeCloseTo(500, 9)

    const br = dpsBreakdown(res, basisOf(res))
    expect(br.zeroDuration).toBe(false)
    expect(br.damageByChar.get('甲')).toBeCloseTo(1000, 9)
    expect(br.rawByChar?.get('甲')).toBeCloseTo(1500, 9)
    const sumByChar = [...br.byChar.values()].reduce((a, b) => a + b, 0)
    expect(sumByChar).toBeCloseTo(res.summary.goal!.dps, 9)
    expect(sumByChar).toBeCloseTo(2000, 9)
  })

  test('C03-9 & C03-9b：同一帧三下 / 四下各 400 打 1000 血，按 eventSeq 在第 3 下截断、第 4 下不计入', () => {
    const j = (name: string) => judgment({ name, spawnFrame: 30, persistsOnCancel: true, multiplier: 0.4 })
    // C03-9：同一帧三下各 400
    const three = action({ id: '三连', endFrame: 60, judgments: [j('d1'), j('d2'), j('d3')] })
    const r3 = makeResolved(
      [{ name: '甲', actions: [three], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, goal: { kill: 1 }, rotation: ['甲 三连'], options: { repeat: 1 } },
    )
    const res3 = simulate(r3)
    expect(res3.summary.kill.frame).toBe(30)
    expect(res3.summary.kill.overflow).toBeCloseTo(200, 9)
    const br3 = dpsBreakdown(res3, basisOf(res3))
    expect(br3.rawByChar?.get('甲')).toBeCloseTo(1200, 9)
    expect(br3.damageByChar.get('甲')).toBeCloseTo(1000, 9)

    // C03-9b：同一帧四下各 400（前三下在"第一招"，第 4 下在"第二招"），第 4 下不在击杀口径里
    const first3 = action({
      id: '第一招',
      endFrame: 10,
      cancelWindows: [{ from: 0, until: 10, row: 0 }],
      judgments: [j('a1'), j('a2'), j('a3')],
    })
    const fourth = action({ id: '第二招', kind: 'skill', endFrame: 60, judgments: [j('b1')] })
    const r4 = makeResolved(
      [{ name: '甲', actions: [first3, fourth], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, goal: { kill: 1 }, rotation: ['甲 第一招 第二招'], options: { repeat: 1 } },
    )
    const res4 = simulate(r4)
    expect(res4.summary.kill.frame).toBe(30)
    expect(res4.summary.kill.overflow).toBeCloseTo(200, 9)
    const br4 = dpsBreakdown(res4, basisOf(res4))
    expect(br4.damageByChar.get('甲')).toBeCloseTo(1000, 9)
    expect(br4.rawByChar?.get('甲')).toBeCloseTo(1200, 9)
    expect(br4.damageByAction.get('甲 第二招')).toBeUndefined()
  })

  test('C03-10：战斗帧 0 一下打死 → zeroDuration = true、damageByChar 有值、byChar 为空', () => {
    const instant = action({
      id: '瞬杀',
      endFrame: 30,
      judgments: [judgment({ name: '零帧', spawnFrame: 0, multiplier: 1.5 })],
    })
    const r = makeResolved(
      [{ name: '甲', actions: [instant], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, goal: { kill: 1 }, rotation: ['甲 瞬杀'], options: { repeat: 1 } },
    )
    const res = simulate(r)
    expect(res.summary.kill.frame).toBe(0)
    const br = dpsBreakdown(res, basisOf(res))
    expect(br.zeroDuration).toBe(true)
    expect(br.damageByChar.get('甲')).toBeCloseTo(1000, 9)
    expect(br.rawByChar?.get('甲')).toBeCloseTo(1500, 9)
    expect(br.byChar.size).toBe(0)
    expect(br.byAction.size).toBe(0)
  })

  test('C03-11：稳态口径正常场景的 dpsBreakdown 与汇总稳态 DPS 一致', () => {
    const act = action({ id: '砍', endFrame: 60, judgments: [judgment({ name: '一击', spawnFrame: 20, multiplier: 1.0 })] })
    const r = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, rotation: ['甲 砍'], options: { repeat: 3 } },
    )
    const res = simulate(r)
    const st = res.summary.steady!
    const br = dpsBreakdown(res, basisOf(res))
    expect(br.zeroDuration).toBe(false)
    expect(br.byChar.get('甲')).toBeCloseTo(st.dps, 9)
    expect(br.byAction.get('甲 砍')).toBeCloseTo(st.dps, 9)
  })
})

describe('DD-03 §7.1 & §7.3：usableBasis 口径闸门（C03-12 / C03-13 / C03-20a / C03-20b / C03-21 / C03-22 / C03-14）', () => {
  test('C03-12：repeat 4 被 maxFrames 截在第 2 轮中间（稳态第 2 轮未完）→ truncated、不可用于比较', () => {
    const act = action({ id: '砍', endFrame: 60, judgments: [judgment({ name: '一击', spawnFrame: 20, multiplier: 1.0 })] })
    const r = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, rotation: ['甲 砍'], options: { repeat: 4, maxFrames: 90 } },
    )
    const res = simulate(r)
    expect(res.completion.status).toBe('truncated')
    const u = usableBasis(res)
    expect(u.ok).toBe(false)
    if (!u.ok) expect(u.status).toBe('truncated')

    const rOk = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, rotation: ['甲 砍'], options: { repeat: 4 } },
    )
    const cmp = tryCompareRuns({ r, res }, { r: rOk, res: simulate(rOk) })
    expect(cmp.ok).toBe(false)
  })

  test('C03-13：repeat 4 末轮结束后仍有判定在途 → truncated(inFlightRemains)，但稳态 2–3 轮完整故 ok = true', () => {
    const act = action({
      id: '延斩',
      endFrame: 60,
      judgments: [judgment({ name: '尾斩', spawnFrame: 100, persistsOnCancel: true, multiplier: 1.0 })],
    })
    const r = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, rotation: ['甲 延斩'], options: { repeat: 4, maxFrames: 241 } },
    )
    const res = simulate(r)
    expect(res.completion.status).toBe('truncated')
    expect(res.completion.truncation?.kind).toBe('inFlightRemains')
    expect(res.completion.loops.started).toBe(4)
    expect(res.completion.loops.completed).toBe(3)
    expect(res.summary.steady).toMatchObject({ from: 2, to: 3 })
    const u = usableBasis(res)
    expect(u.ok).toBe(true)
  })

  test('C03-20a：repeat 2、稳态选第 2 轮，第 2 轮执行没走完就截断 → ok = false（执行不完整）', () => {
    const act = action({ id: '百帧', endFrame: 100, judgments: [judgment({ name: '尾', spawnFrame: 99, multiplier: 1.0 })] })
    const r = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, rotation: ['甲 百帧'], options: { repeat: 2, maxFrames: 150 } },
    )
    const res = simulate(r)
    expect(res.completion.loops.completed).toBe(1)
    const u = usableBasis(res)
    expect(u.ok).toBe(false)
    if (!u.ok) expect(u.reason).toContain('第 2 轮')
  })

  test('C03-20b & C03-21：执行完整但 endAt=150 裁剪了第 2 轮 → ok = false；endAt=200 → ok = true、窗口 [100, 200)', () => {
    const act = action({ id: '百帧', endFrame: 100, judgments: [judgment({ name: '尾', spawnFrame: 99, multiplier: 1.0 })] })
    const rCut = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, rotation: ['甲 百帧'], options: { repeat: 2, endAt: 150 } },
    )
    const resCut = simulate(rCut)
    expect(resCut.completion.status).toBe('completed')
    expect(resCut.completion.loops.completed).toBe(2)
    expect(resCut.completion.loops.roundEnds.find(x => x.loop === 2)?.endBattleFrame).toBe(200)
    const uCut = usableBasis(resCut)
    expect(uCut.ok).toBe(false)
    if (!uCut.ok) {
      expect(uCut.reason).toContain('第 2 轮')
      expect(uCut.reason).toContain('150')
    }

    const rFit = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      { initial: { onField: 0 }, rotation: ['甲 百帧'], options: { repeat: 2, endAt: 200 } },
    )
    const uFit = usableBasis(simulate(rFit))
    expect(uFit.ok).toBe(true)
    if (uFit.ok) {
      expect([uFit.basis.lo, uFit.basis.hi]).toEqual([100, 200])
    }
  })

  test('C03-22：自然完成但 kill 目标没打到 → ok = true，用估计值，有 goalNotReached 警告', () => {
    const act = action({ id: '轻打', endFrame: 60, judgments: [judgment({ name: '一', spawnFrame: 20, multiplier: 0.1 })] })
    const r = makeResolved(
      [{ name: '甲', actions: [act], buffs: [NO_CRIT_BUFF] }, idle('乙'), idle('丙')],
      {
        enemy: { custom: { level: 90, hp: 1_000_000, def: 0, res: { 物理: 0 } } },
        initial: { onField: 0 },
        goal: { kill: 1 },
        rotation: ['甲 轻打'],
        options: { repeat: 2 },
      },
    )
    const res = simulate(r)
    expect(res.completion.status).toBe('completed')
    expect(res.summary.goal?.reached).toBe(false)
    expect(res.summary.warnings.some(w => w.code === 'goalNotReached')).toBe(true)
    const u = usableBasis(res)
    expect(u.ok).toBe(true)
    if (u.ok) {
      expect(u.basis.dps).toBeCloseTo(res.summary.goal!.dps, 9)
      expect(u.basis.hi).toBeGreaterThan(res.summary.windowFrames)
    }
  })

  test('C03-14：敏感度矩阵里分别触发 axisFailed 与 engineError，两格 status 与文字各异', () => {
    const ult = action({
      id: '大招',
      kind: 'liberation',
      endFrame: 20,
      switchLockUntil: 10,
      switchLockFromInput: true,
      judgments: [judgment({ name: '斩', spawnFrame: 5, multiplier: 1.0 })],
    })
    const inv = action({
      id: '无敌招',
      endFrame: 30,
      air: { from: 0, until: 10 },
      switchLockUntil: 20,
      switchLockFromInvincible: true,
      judgments: [judgment({ name: '闪', spawnFrame: 5, multiplier: 1.0 })],
    })
    const entryAct = action({
      id: 'A2-地面出场技',
      entrySkill: true,
      endFrame: 10,
      judgments: [judgment({ name: '刺', spawnFrame: 5, multiplier: 1.0 })],
    })
    const r = makeResolved(
      [
        {
          name: '甲',
          energyCost: 0,
          actions: [ult, inv],
          hooks: {
            onEvent(ctx) {
              // ultInputLocksSwitch 翻成 false 时抛异常 → engineError
              if (!ctx.rules.ultInputLocksSwitch) throw new Error('模拟钩子崩溃')
            },
          },
        },
        { name: '乙', actions: [entryAct] },
        idle('丙'),
      ],
      {
        initial: { onField: 0, concerto: 0 },
        rotation: ['甲 大招', '甲 无敌招', 'switch 乙', '乙 A2-地面出场技'],
        options: { repeat: 1, maxWait: 30 },
      },
    )
    const m = sensitivityMatrix([{ name: 's', r }])
    const row = m.rows[0]!
    expect(row.base.dps).not.toBeNull()
    const iUlt = m.flips.findIndex(f => f.path === 'rules.ultInputLocksSwitch')
    const iInv = m.flips.findIndex(f => f.path === 'rules.invincibleLocksSwitch')
    expect(row.flips[iInv]!).toMatchObject({ status: 'axisFailed', dps: null })
    expect(row.flips[iUlt]!).toMatchObject({ status: 'engineError', dps: null })
    expect(row.flips[iInv]!.error).not.toBe(row.flips[iUlt]!.error)
  })
})

dataDescribe('DD-03 §7.4：谐度破坏口径不一致警示（C03-17 / C03-18 / C03-19）', () => {
  let gd: GameData
  beforeAll(async () => { gd = await loadGameData() })

  const parseM0 = (extra: Record<string, unknown>) => {
    const raw = parse(readFileSync(new URL('../scenarios/m0-team.yaml', import.meta.url), 'utf8')) as Record<string, unknown>
    const opts = (raw.options ?? {}) as Record<string, unknown>
    return ScenarioSchema.parse({ ...raw, ...extra, options: { ...opts, ...((extra.options as Record<string, unknown> | undefined) ?? {}) } })
  }

  test('C03-17 & C03-19：compare 检测 mode 与 gauge 差异；只差 omitted.reason 不报 scopeMismatch', () => {
    const runOf = (sc: ReturnType<typeof ScenarioSchema.parse>): { r: ResolvedScenario; res: SimResult } => {
      const r = resolveScenario(sc, gd)
      return { r, res: simulate(r) }
    }

    const rOff = runOf(parseM0({ options: { tuneBreak: 'off' }, tuneBreakOmitted: { reason: 'deliberate' } }))
    const rAuto = runOf(parseM0({ options: { tuneBreak: 'auto' } }))
    const cmp17 = tryCompareRuns(rOff, rAuto)
    expect(cmp17.ok).toBe(true)
    if (cmp17.ok) {
      expect(cmp17.value.scopeMismatch).toBeDefined()
      expect(cmp17.value.scopeMismatch!.base.tuneBreak.mode).toBe('omitted')
      expect(cmp17.value.scopeMismatch!.other.tuneBreak.mode).toBe('auto')
      expect(cmp17.value.scopeMismatch!.note).toMatch(/^口径提醒/)
    }

    // C03-19：off vs manual（rotation 无破招、都省略谐破伤害）→ differsIn: ['gauge']
    const rManual = runOf(parseM0({ options: { tuneBreak: 'manual' }, tuneBreakOmitted: { reason: 'sourceSilent' } }))
    const cmp19 = tryCompareRuns(rOff, rManual)
    expect(cmp19.ok).toBe(true)
    if (cmp19.ok) {
      expect(cmp19.value.scopeMismatch).toBeDefined()
      expect(cmp19.value.scopeMismatch!.differsIn).toEqual(['gauge'])
    }

    // 只差 reason、同为 omitted + gauge: off → 无 scopeMismatch
    const rOffSilent = runOf(parseM0({ options: { tuneBreak: 'off' }, tuneBreakOmitted: { reason: 'sourceSilent' } }))
    const cmpSame = tryCompareRuns(rOff, rOffSilent)
    expect(cmpSame.ok).toBe(true)
    if (cmpSame.ok) expect(cmpSame.value.scopeMismatch).toBeUndefined()
  }, 60_000)

  test('C03-18：scorecards 同时含未含谐破与自动谐破时列出谐破列标签与 † 差异标记', () => {
    const scOff = parseM0({ options: { tuneBreak: 'off' }, tuneBreakOmitted: { reason: 'deliberate' } })
    const scAuto = parseM0({ options: { tuneBreak: 'auto' } })
    const cards = scorecards([{ name: '未含组', sc: scOff }, { name: '自动组', sc: scAuto }], gd)
    expect(cards.find(c => c.name === '未含组')!.scopeLabel).toBe('未含')
    expect(cards.find(c => c.name === '自动组')!.scopeLabel).toBe('自动')
    expect(cards.find(c => c.name === '未含组')!.scopeDiffersFromTop).toBe(true)
    expect(cards.find(c => c.name === '自动组')!.scopeDiffersFromTop).toBe(false)
  }, 60_000)
})
