// tests/td02.test.ts —— TD-02 §9 的测试用例（Vitest 写法）
import { describe, expect, test } from 'vitest'
import { ScenarioSchema, parseRotationLine, type ScenarioInput } from '../src/data/scenario.schema'
import { GenActionFileSchema, GenRowSchema } from '../src/data/generated.schema'
import { BuffDefSchema, type BuffDefInput } from '../src/data/buff.schema'
import { defineCharacter } from '../src/data/define'
import type { SimEvent } from '../src/engine/types'
import 散华 from '../data/curated/characters/散华'
import { parseOrThrow } from '../src/data/validate'

/** 取第一条错误的路径与信息，断言用 */
function firstIssue(r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string; code: string }[] } }) {
  const i = r.error?.issues[0]
  return { path: i?.path.map(String).join('.'), message: i?.message ?? '', code: i?.code }
}

const demo: ScenarioInput = {
  team: [
    { char: '散华', chain: 6, weapon: { name: '千古洑流' },
      echoes: [{ name: '角', set: '凝夜白霜', main: { 暴击率: 0.22, 攻击: 150 }, subs: { 暴击伤害: 0.174, '攻击%': 0.071 } }] },
    { char: '长离', weapon: { name: '赤霄' } },
    { char: '维里奈', weapon: { name: '奇幻变奏', rank: 5 } },
  ],
  enemy: { preset: '全息6/朔雷之鳞' },
  rotation: ['散华 E', '散华 A1', '散华 A2 +3', 'switch 长离', '长离 R', 'wait 20'],
}

describe('T02-1 场景：合法输入与默认值', () => {
  test('解析成功并补齐默认值', () => {
    const r = ScenarioSchema.safeParse(demo)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.team[1]!.chain).toBe(0)
    expect(r.data.team[1]!.weapon.rank).toBe(1)
    expect(r.data.team[1]!.echoes).toEqual([])
    expect(r.data.team[0]!.echoes[0]!.subs).toEqual({ 暴击伤害: 0.174, '攻击%': 0.071 })
    expect(r.data.initial).toEqual({ energy: 'full', concerto: 0, onField: 0 })
    expect(r.data.options).toEqual({ repeat: 1, maxFrames: 3600, maxWait: 600, tuneBreak: 'auto' })
    expect(r.data.environment).toEqual([])
  })
})

describe('T02-2 场景：错误要指出位置', () => {
  const bad = (patch: (s: ScenarioInput) => void) => {
    const s = structuredClone(demo); patch(s); return firstIssue(ScenarioSchema.safeParse(s))
  }
  test('队伍不是 3 人', () => {
    expect(bad(s => { s.team.pop() }).path).toBe('team')
  })
  test('比例写成百分数', () => {
    const i = bad(s => { s.team[0]!.echoes![0]!.main = { 暴击率: 22 } })
    expect(i.path).toBe('team.0.echoes.0.main.暴击率')
    expect(i.message).toContain('请写小数')
  })
  test('谐振阶越界', () => {
    expect(bad(s => { s.team[2]!.weapon.rank = 6 }).path).toBe('team.2.weapon.rank')
  })
  test('拼错字段名（strict）', () => {
    const i = bad(s => { (s.team[0] as Record<string, unknown>)['chains'] = 6 })
    expect(i.code).toBe('unrecognized_keys')
    expect(i.path).toBe('team.0')
  })
  test('排轴语法错误', () => {
    const i = bad(s => { s.rotation.push('wait abc') })
    expect(i.path).toBe('rotation.6')
    expect(i.message).toContain('格式不对')
  })
  test('排轴引用队伍外角色', () => {
    const i = bad(s => { s.rotation.push('今汐 E') })
    expect(i.message).toContain('今汐 不在队伍里')
  })
})

describe('T02-3 排轴行解析（语法见 TD-09 §2）', () => {
  test('三种指令', () => {
    expect(parseRotationLine('散华 A2 +3')).toEqual([{ kind: 'act', char: '散华', action: 'A2', delay: 3, force: false }])
    expect(parseRotationLine('  雷主·女 大招 ')).toEqual([{ kind: 'act', char: '雷主·女', action: '大招', delay: 0, force: false }])
    expect(parseRotationLine('switch 长离')).toEqual([{ kind: 'switch', char: '长离' }])
    expect(parseRotationLine('wait 20')).toEqual([{ kind: 'wait', frames: 20 }])
  })
  test('错误', () => {
    expect('error' in parseRotationLine('散华')).toBe(true)
    expect('error' in parseRotationLine('散华 A2 3')).toBe(true)      // 延迟必须写 +N
    expect('error' in parseRotationLine('switch')).toBe(true)
  })
})

// TD-01 §12.2 的散华 E 行（完整字段）
const eRow = {
  row: 1322, name: 'E', kind: 'hit', eventSpawned: false,
  spawnFrame: 19, birthFrame: null, lifeFrames: 12, hitstop: { self: null, enemy: 5 },
  deriveFrame: 60, deriveDuration: null, endFrame: 96,
  priority: [4, 2], priorityChange: null,
  parry: true, persists: true, followHitstop: null,
  toughness: 100, tunability: 80,
  gains: { energy: { total: 10 }, concerto: { total: 15 }, core: [{ total: 1 }, null, null] },
  position: '地面', positionChange: null,
  dilation: { type: '攻击顿帧', enemy: { rate: 0.05, start: null, duration: 6 } },
  hitTarget: '目标', note: null, noteMerged: false, hints: {}, nameTags: {},
  dmg: {
    via: 'direct', charaId: '散华', skillName: 'E', dmgCalc: '朔雪永冻', skillId: 1102020, skillType: 2,
    calcType: 0, element: 1, damageType: 4, subType: null, relatedProperty: 7, multiplier: 3.5985,
    rates: [18100, 19585, 21069, 23147, 24631, 26338, 28713, 31087, 33462, 35985,
      38954, 41922, 44890, 47859, 50827, 53796, 56764, 59732, 62701, 65669],   // dmg RateLv_1…20 原值
    energy: 1000, toughLv: 10000, weaknessLvl: 8000, hardnessLv: 10000, formulaType: 0,
  },
  flags: [],
}

describe('T02-4 生成数据 schema', () => {
  test('散华 E 行通过', () => {
    expect(GenRowSchema.safeParse(eRow).success).toBe(true)
  })
  test('持续帧只允许 ≥ -1', () => {
    expect(firstIssue(GenRowSchema.safeParse({ ...eRow, lifeFrames: -2 })).path).toBe('lifeFrames')
  })
  test('行类别只能是四种之一', () => {
    expect(firstIssue(GenRowSchema.safeParse({ ...eRow, kind: 'foo' })).path).toBe('kind')
  })
  test('核心回收必须是三槽', () => {
    const r = GenRowSchema.safeParse({ ...eRow, gains: { ...eRow.gains, core: [{ total: 1 }, null] } })
    expect(r.success).toBe(false)
    expect(firstIssue(r).path).toContain('gains.core')               // 路径指到 core（zod 4 的新旧版本分别报 core 与 core.2）
  })
  test('组名块内唯一', () => {
    const g = { id: 'E', rawId: '12', idNum: 12, idSuffix: '', rows: [eRow] }
    const f = { key: '散华', sheet: '角色-女', sheetName: '散华', startRow: 1304, ignoredRows: 0, groups: [g, g] }
    const i = firstIssue(GenActionFileSchema.safeParse(f))
    expect(i.path).toBe('groups.1.id')
    expect(i.message).toContain('组名重复')
  })
})

describe('T02-5 BuffDef', () => {
  const outro: BuffDefInput = 散华.buffs!.find(b => b.id === '散华.延奏')!
  test('合法定义补齐默认值', () => {
    const r = BuffDefSchema.safeParse(outro)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toMatchObject({ maxStacks: 1, stackGain: 1, refresh: 'refresh', onSwitchOut: 'clear' })
  })
  test('加深类别写在乘区名里', () => {
    expect(BuffDefSchema.safeParse({ ...outro, zone: 'DamageAmplify3' }).success).toBe(true)
    expect(firstIssue(BuffDefSchema.safeParse({ ...outro, zone: 'DamageAmplify10' })).path).toBe('zone')
  })
  test('谐振阶数值必须 5 个', () => {
    expect(firstIssue(BuffDefSchema.safeParse({ ...outro, value: [0.1, 0.2, 0.3, 0.4] })).path).toBe('value')
  })
  test('常驻 buff 必须无限时长', () => {
    const i = firstIssue(BuffDefSchema.safeParse({ ...outro, trigger: 'always', duration: 600 }))
    expect(i.path).toBe('duration')
  })
  test('散华模块的全部 buff 都通过校验', () => {
    for (const b of 散华.buffs ?? []) expect(BuffDefSchema.safeParse(b).success).toBe(true)
  })
})

describe('T02-6 编译期约束（tsc 通过即成立）', () => {
  test('拼错的乘区、武器类型、事件类型都是类型错误', () => {
    defineCharacter('测试', {
      // @ts-expect-error 武器类型只能是五种之一
      weaponType: '大剑',
      buffs: [{
        id: 'x', source: 'x', value: 0.1, target: 'self', duration: 60, trigger: { on: 'intro' },
        // @ts-expect-error 乘区 ID 拼错
        zone: 'atkPercent',
      }],
    })
    expect(true).toBe(true)
  })
  test('SimEvent 按 type 收窄且穷尽', () => {
    const label = (ev: SimEvent): string => {
      switch (ev.type) {
        case 'hit': return `${ev.char}/${ev.judgment}: ${ev.dmg?.expected ?? 0}`
        case 'actionStart': case 'actionEnd': case 'actionCancel': return `${ev.char} ${ev.action}`
        case 'judgmentSpawn': return ev.judgment
        case 'switch': return `${ev.from}→${ev.to}`
        case 'intro': case 'outro': return ev.char
        case 'buffApply': case 'buffExpire': return ev.buff
        case 'resource': return `${ev.char} ${ev.resource} ${ev.delta}`
        case 'resourceFull': return `${ev.char} ${ev.resource} 满`
        case 'heal': return `${ev.char} 治疗（${ev.source}）`
        case 'enemyState': return ev.change
        case 'effectTick': return ev.effect
        case 'wait': return `等待 ${ev.frames}`
        case 'skip': return `跳过 ${ev.reason}`
        case 'loop': return `第 ${ev.loop} 轮`
        case 'warning': return ev.message
        default: { const never: never = ev; return never }
      }
    }
    expect(label({
      f: 13, t: 0.2, type: 'wait', cmd: { line: 3, item: 1, loop: 1 }, code: 'resource', reason: '能量 97 / 125', from: 1, frames: 12, battleFrames: 12,
    })).toBe('等待 12')
  })
})

describe('T02-7 报错格式', () => {
  test('parseOrThrow 给出文件名、中文信息与路径', () => {
    const s = structuredClone(demo)
    s.team[0]!.echoes![0]!.main = { 暴击率: 22 }
    let msg = ''
    try { parseOrThrow(ScenarioSchema, s, 'scenarios/demo.yaml') } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('scenarios/demo.yaml 校验失败')
    expect(msg).toContain('暴击率 是比例，请写小数')
    expect(msg).toContain('team[0].echoes[0].main["暴击率"]')
  })
})
