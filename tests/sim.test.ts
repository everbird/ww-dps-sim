// tests/sim.test.ts —— M2 单人仿真（总设计 §12：单人轴的 DPS 与手算一致）
// 依赖 data/generated（pnpm build:data）；没有时整组跳过。
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { GenActionFileSchema, GoldenDamageSchema, GoldenZonesSchema, type GoldenZone } from '../src/data/generated.schema'
import { ScenarioSchema, type ScenarioInput } from '../src/data/scenario.schema'
import { AMPLIFY_ZONES, FINAL_ZONES } from '../src/data/common'
import { computeHit, emptyAccumulator } from '../src/engine/formula'
import { ResolveError, resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { HitEvent } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

let gd: GameData
const M0: ScenarioInput['team'] = [
  { char: '椿', chain: 0, weapon: { name: '千古洑流', rank: 5 } },
  { char: '散华', chain: 6, weapon: { name: '行进序曲', rank: 5 } },
  { char: '维里奈', chain: 3, weapon: { name: '奇幻变奏', rank: 5 } },
]
const scenario = (o: Partial<ScenarioInput> = {}) => ScenarioSchema.parse({
  team: M0, enemy: { preset: '全息6/朔雷之鳞' }, initial: { onField: 1 }, rotation: ['散华 E'], ...o,
})
const run = (o: Partial<ScenarioInput> = {}) => simulate(resolveScenario(scenario(o), gd))
const hitsOf = (log: ReturnType<typeof run>['log']) => log.filter((e): e is HitEvent => e.type === 'hit' && e.dmg !== null)

dataDescribe('M2 单人仿真', () => {
  beforeAll(async () => { gd = await loadGameData() })

  test('M2-1 静态面板：角色 90 级 + 武器主副属性 + 技能树（总设计 §3.3 第 2 步、TD-03 §3.2）', () => {
    const r = resolveScenario(scenario(), gd)
    const [椿, 散华] = r.team
    // 散华：攻击 275 + 行进序曲 337 = 612，技能树攻击 12%；共鸣效率 1 + 0.5184；冷凝加成 12% 是带过滤的常驻 buff
    expect(散华.panel).toMatchObject({ atk: { base: 612, pct: 0.12, flat: 0 }, critRate: 0.05, critDamage: 1.5, energyRegen: 1.5184 })
    expect(r.buffs.filter(b => b.owner === 1 && b.def.trigger === 'always').map(b => [b.def.id, b.value, b.def.filter])).toEqual([
      ['散华.技能树.冷凝伤害加成', 0.12, { elements: ['冷凝'] }],
      ['散华.共鸣链5', 1, { judgments: ['E-引爆冰棱', 'QTE-引爆冰棘', '大招-引爆冰川'] }],
    ])
    // 椿：千古洑流副属性暴击 24.3%，技能树暴伤 16%；R5 被动"共鸣效率提升"取第 5 阶 25.6%
    expect(椿.panel).toMatchObject({ critRate: 0.05 + 0.243, critDamage: 1.66, energyRegen: 1 })
    expect(r.buffs.find(b => b.def.id === '千古洑流.共鸣效率')!.value).toBe(0.256)
  })

  test('M2-2 单人轴 DPS 与手算一致：散华 E A1 A2 A3 A4 A5 R（TD-09 §2.5 的第 1 条）', () => {
    const out = run({ rotation: ['散华 E A1 A2 A3 A4 A5 R'] })
    const starts = out.log.flatMap(e => (e.type === 'actionStart' ? [`${e.action}@${e.f}`] : []))
    expect(starts).toEqual(['E@0', 'A1@60', 'A2@86', 'A3@121', 'A4@158', 'A5@196', '大招@230'])   // 与 TD-09 §2.5 相同

    // 手算：攻击 floor(612 × 1.12) = 685；90 级打 1512 防御；冷凝抗 10%；冷凝加成 12%；暴击 5%、暴伤 150%
    // 6 链：共鸣链1"施放第5段普攻时暴击 +15%"（M3 起生效），A5 与之后的大招按暴击 20% 算
    const atk = 685, def = 1 / (1512 / 1520 + 1), bonus = 1.12, res = 0.9
    const hand = (rate: number, p = 0.05) => {
      const nc = Math.ceil(rate * atk * 1 * def * bonus * res)
      const cr = Math.ceil(rate * atk * 1.5 * def * bonus * res)
      return { nonCrit: nc, crit: cr, expected: (1 - p) * nc + p * cr }
    }
    // 倍率（dmg RateLv_10）：E 3.5985、A1 0.4871、A2 0.7376、A3 0.2158 × 4 段、A4 0.3967 × 2、A5 2.3381、大招 8.0948
    const rates = [3.5985, 0.4871, 0.7376, 0.2158, 0.2158, 0.2158, 0.2158, 0.3967, 0.3967, 2.3381, 8.0948]
    const crit = rates.map((_, i) => (i >= 9 ? 0.2 : 0.05))
    expect(hitsOf(out.log).map(h => h.dmg)).toEqual(rates.map((x, i) => hand(x, crit[i])))

    // 窗口（战斗帧）：大招第 230 帧出手。A5 第 229 帧命中登记的自身顿帧（0.05 倍速 11 帧）挂在散华身上，取消 A5 不撤
    // （TD-04 §3.3，只有极限闪避的减速随取消撤掉），所以大招第 230–240 帧只走 0.55 帧；第 241 帧走过局部第 1 帧，
    // 登记 90 帧全局时停，第 242–331 帧战斗时钟停走；第 312 帧走过局部第 72 帧出伤，随后自身顿帧 0.2 倍速 11 帧，
    // 局部到第 324 帧才 74.75，再走 47 帧到 121.75 ≥ 结束帧 121 → 第 371 帧结束，战斗帧 371 − 90 = 281
    const total = rates.map((x, i) => hand(x, crit[i])).reduce((a, h) => a + h.expected, 0)
    expect(out.log.filter(e => e.type === 'hit').map(e => e.f).at(-1)).toBe(312)
    expect(out.summary.windowFrames).toBe(281)
    expect(out.summary.totalDamage).toBeCloseTo(total, 9)
    expect(out.summary.dps).toBeCloseTo(total / (281 / 60), 9)
    expect(out.summary.overflowDamage).toBe(0)
    expect(out.summary.byChar['散华']!.share).toBe(1)
  })

  test('M2-3 声骸词条：固定值与百分比进面板，元素 / 类型加成转成带过滤的常驻 buff（TD-02 §7.1）', () => {
    const team = structuredClone(M0)
    team[1] = { ...team[1]!, echoes: [{ name: '无常凶鹭', set: '凝夜白霜', main: { 攻击: 150, 冷凝伤害加成: 0.3 }, subs: { 普攻伤害加成: 0.1, '攻击%': 0.05 } }] }
    const r = resolveScenario(scenario({ team, rotation: ['散华 E A1'] }), gd)
    expect(r.team[1].panel.atk).toMatchObject({ base: 612, flat: 150 })
    expect(r.team[1].panel.atk.pct).toBeCloseTo(0.17, 12)
    const res = simulate(r)
    const [e, a1] = hitsOf(res.log)
    const atk = Math.floor(612 * (1 + 0.12 + 0.05)) + 150, def = 1 / (1512 / 1520 + 1)
    expect(e!.dmg!.nonCrit).toBe(Math.ceil(3.5985 * atk * 1 * def * (1 + 0.12 + 0.3) * 0.9))          // 共鸣技能不吃普攻加成
    expect(a1!.dmg!.nonCrit).toBe(Math.ceil(0.4871 * atk * 1 * def * (1 + 0.12 + 0.3 + 0.1) * 0.9))
    expect(a1!.buffs).toEqual(['散华.技能树.冷凝伤害加成', '散华.声骸.冷凝伤害加成', '散华.声骸.普攻伤害加成'])
    // 无常凶鹭写进了 echoes.ts、倍率都连上了；1 件不提示套装：没有声骸 / 套装的提示
    expect(res.summary.warnings.map(w => w.message).filter(m => m.includes('声骸') || m.includes('套装'))).toEqual([])
  })

  test('M2-4 场景里的错一次报全', () => {
    const team = structuredClone(M0)
    team[0] = { char: '长离', chain: 0, weapon: { name: '千古洑流', rank: 1 } }
    team[2] = { ...team[2]!, weapon: { name: '千古洑流', rank: 1 } }
    let err: unknown
    try { resolveScenario(scenario({ team, enemy: { preset: '朔雷之鳞' }, rotation: ['散华 E', '散华 X'] }), gd) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ResolveError)
    const issues = (err as ResolveError).issues
    expect(issues).toHaveLength(3)
    expect(issues[0]).toContain('长离')
    expect(issues[1]).toContain('维里奈 用音感仪，千古洑流 是迅刀')
    expect(issues[2]).toContain('敌人预设"朔雷之鳞"不存在')
  })

  test('M2-5 自定义敌人：防御缺省 8 × 等级 + 792，抗性缺省 10%；options.endAt 截断窗口，窗口外单列', () => {
    const res = run({ enemy: { custom: { level: 90, res: { 冷凝: 0.2 } } }, rotation: ['散华 E A1'], options: { endAt: 60 } })
    const [e, a1] = hitsOf(res.log)
    const def = 1 / (1512 / 1520 + 1)
    expect(e!.dmg!.nonCrit).toBe(Math.ceil(3.5985 * 685 * 1 * def * 1.12 * 0.8))
    expect(res.summary.windowFrames).toBe(60)
    expect(res.summary.totalDamage).toBeCloseTo(e!.dmg!.expected, 9)       // E 第 19 帧在窗口内，A1 第 73 帧在窗口外
    expect(res.summary.overflowDamage).toBeCloseTo(a1!.dmg!.expected, 9)
  })

  test('M2-6 判定倍率与标准答案一致：M0 三人连上 dmg 的伤害判定，用 xlsx 当前配置的乘区重算 golden（TD-01 §11.1）', () => {
    const gold = GoldenDamageSchema.parse(JSON.parse(readFileSync(new URL('../data/generated/fixtures/golden-damage.json', import.meta.url), 'utf8')))
    const zones = GoldenZonesSchema.parse(JSON.parse(readFileSync(new URL('../data/generated/fixtures/golden-zones.json', import.meta.url), 'utf8')))
    const byCell = new Map(zones.map(z => [z.cell, z]))
    const colOf = (start: string, k: 2 | 3) => String.fromCharCode(start.charCodeAt(0) + k)
    let checked = 0
    const bad: string[] = []
    for (const name of ['椿', '散华', '维里奈']) {
      const file = GenActionFileSchema.parse(JSON.parse(readFileSync(new URL(`../data/generated/actions/${name}.json`, import.meta.url), 'utf8')))
      const skillOfRow = new Map(file.groups.flatMap(g => g.rows.flatMap(r => (r.dmg ? [[r.row, r.dmg.skillName] as const] : []))))
      const judgments = Object.values(gd.characters[name]!.actions).flatMap(a => a.judgments)
      for (const e of gold.entries.filter(x => x.char === name && x.dmgKey)) {
        const js = judgments.filter(j => skillOfRow.get(j.row) === e.dmgKey![1] && j.multiplier > 0 && !j.formula)
        for (const [k, br] of [[2, 'nc'], [3, 'cr']] as const) {
          const z = byCell.get(`${colOf(e.col, k)}${e.row}`)
          if (!z || z.formula !== 'hurt' || z.table !== 'dmg!AH') continue
          for (const j of js) {
            const got = hurtWith(z, j.multiplier, 1928)          // xlsx 当前配置：秧秧·玄翎 攻击 1928
            checked++
            if (got !== z.expected) bad.push(`${name} ${e.label}（${j.name}，${br}）：${got} ≠ ${z.expected}`)
          }
        }
      }
    }
    expect(bad).toEqual([])
    expect(checked).toBeGreaterThan(40)
  })
})

/** 用 golden 乘区与判定倍率重算（同 td03.test.ts T03-9 的 evaluate，只把基础项换成 倍率 × 攻击） */
function hurtWith(g: GoldenZone, rate: number, atk: number): number {
  const z = g.z, a = emptyAccumulator(), Z = a.zones
  Z.DamageChange = z.bonus ?? 0
  Z.TargetDefRate = z.def?.defRate ?? 0; Z.RoleIgnoreDefRate = z.def?.ignore ?? 0
  Z.TargetDamageReduce = z.dr ?? 0; Z.TargetElementDamageReduce = z.dre ?? 0; Z.SpecialDamageChange = z.special ?? 0
  Z.DamageAmplify0 = z.amp0 ?? 0; Z.DamageAmplify1002 = z.amp1002 ?? 0; Z.FinalDamage1001 = z.fin1001 ?? 0
  z.amp?.forEach((v, i) => { Z[AMPLIFY_ZONES[i + 1]!] = v })
  z.fin?.forEach((v, i) => { Z[FINAL_ZONES[i]!] = v })
  const r = computeHit({
    rate, attr: 'atk', extraFlat: 0, level: z.def?.level ?? 90, enemy: { def: z.def?.targetDef ?? 0, res: z.res ?? 0 },
    panel: {
      hp: { base: 0, pct: 0, flat: 0 }, atk: { base: atk, pct: 0, flat: 0 }, def: { base: 0, pct: 0, flat: 0 },
      critRate: 0, critDamage: z.crit ?? 1, energyRegen: 1, healBonus: 0, tunabilityRate: 1, harmonyBreakBoost: 0,
    },
  }, a, { critRateCap: 1, defFactorCap: 2, highResThreshold: 0.8 })
  return g.branch === 'nc' ? r.nonCrit : r.crit
}
