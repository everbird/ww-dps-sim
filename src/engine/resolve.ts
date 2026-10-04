// src/engine/resolve.ts —— 装配：Scenario → ResolvedScenario（总设计 §3.3）
// 只做一次：校验名字、算静态面板、登记 buff、合并动作表、敌人、初始资源、编译排轴。静态能查出来的错一次报全。
// 纯函数：只读 GameData，不读文件。
import { STAT_TO_ZONE, type ActionId, type Chain, type Element, type Rank, type Slot, type StatKey } from '../data/common'
import { forChain } from '../data/assemble-action'
import { echoActionsFor } from '../data/assemble-echo'
import type { BuffDef } from '../data/buff.schema'
import { DEFAULT_RULES, type ActionDef, type EchoDef, type EnemyPreset, type GameData, type Rules } from '../data/gamedata'
import { parseRotationLine, type Scenario } from '../data/scenario.schema'
import { compileRotation, type CompileMember } from './scheduler'
import type { RegisteredBuff, RegisteredEffect, ResolvedMember, ResolvedScenario, StaticPanel, StatValues } from './types'

/** 角色的基础暴击、暴伤、共鸣效率：全员相同（xlsx 伤害配置 B2196 = 500 × 0.0001、B2204 = 1.5、B2218 = 1） */
export const CHAR_BASE = { critRate: 0.05, critDamage: 1.5, energyRegen: 1 } as const
/** 自定义敌人的缺省：防御 = 8 × 等级 + 792（enemies.json 1402 条里 1342 条如此）；各元素抗性 10%（表里最常见的基础值） */
export const enemyDefByLevel = (level: number): number => 8 * level + 792
const DEFAULT_RES = 0.1
const ELEMENTS_ALL: Element[] = ['物理', '冷凝', '热熔', '导电', '气动', '衍射', '湮灭']

export class ResolveError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`场景有 ${issues.length} 处错误：\n${issues.map(i => `  - ${i}`).join('\n')}`)
    this.name = 'ResolveError'
    this.issues = issues
  }
}

export function resolveScenario(sc: Scenario, data: GameData): ResolvedScenario {
  const issues: string[] = []
  const warnings: string[] = []
  if (sc.data !== undefined && sc.data !== data.version)
    warnings.push(`场景写的数据版本是 ${sc.data}，当前数据是 ${data.version}（只维护当前版本，总设计 T15）`)

  const built = sc.team.map((m, i) => resolveMember(m, i as Slot, data, issues, warnings))
  const enemy = resolveEnemy(sc.enemy, data, issues)
  const env: RegisteredBuff[] = []
  for (const id of sc.environment) {
    const def = data.envBuffs[id]
    if (def) env.push({ def, value: pick(def.value, 1), owner: 'env' })
    else issues.push(`environment 里的 ${id} 不存在（现有：${Object.keys(data.envBuffs).join('、') || '无'}）`)
  }
  const rules = resolveRules(sc.options.rules, issues)
  // 三名角色都找得到时照样编译排轴，错一起报（总设计 §3.3 第 7 步：一次报全）
  const onField = sc.initial.onField as Slot
  let commands: ResolvedScenario['commands'] = []
  if (built.every(b => b !== null)) {
    const team = built.map(b => b.member)
    const compiled = compileRotation(
      sc.rotation, team.map((m): CompileMember => ({ name: m.def.name, actions: m.actions, aliases: m.aliases })), onField, sc.options.repeat,
    )
    if (compiled.ok) commands = compiled.commands
    else {
      const many = (line: number) => { const p = parseRotationLine(sc.rotation[line - 1] ?? ''); return Array.isArray(p) && p.length > 1 }
      for (const i of compiled.issues)
        issues.push(`rotation 第 ${i.line} 条${i.item !== undefined && many(i.line) ? `第 ${i.item} 个` : ''}：${i.message}`)
    }
  }
  if (issues.length > 0) throw new ResolveError(issues)
  const members = built as Built[]
  const team = members.map(b => b.member) as [ResolvedMember, ResolvedMember, ResolvedMember]

  const buffs = [...members.flatMap(b => b.buffs), ...env]
  const effects = members.flatMap(b => b.effects)
  // 触发条件 ownerHas 指向的 buff 要是同一持有者登记过的，否则永远不会触发（拼错了也不报）
  for (const { def, owner } of [...buffs, ...effects]) {
    if (typeof def.trigger === 'string') continue
    for (const sp of Array.isArray(def.trigger) ? def.trigger : [def.trigger]) {
      const need = sp.where?.ownerHas
      if (need !== undefined && !buffs.some(b => b.def.id === need && b.owner === owner))
        issues.push(`${def.id} 的触发条件 ownerHas 写的 buff "${need}"，同一持有者没有登记`)
    }
  }
  if (issues.length > 0) throw new ResolveError(issues)
  // 共鸣效率不按伤害元素 / 标签过滤：写了 filter 的按无条件算（TD-06 §2.1）
  const regenFiltered = buffs.filter(b => b.def.zone === 'energyRegen' && b.def.filter).map(b => b.def.id)
  if (regenFiltered.length > 0) warnings.push(`共鸣效率 buff 不看 filter，按无条件算：${[...new Set(regenFiltered)].join('、')}`)
  for (const m of team) {
    if (m.def.flags.length > 0)
      warnings.push(`${m.def.name} 有 ${m.def.flags.length} 处装配时推断的值（pnpm check:data -- --flags ${m.def.name} 查看）`)
  }

  const trio = (x: 'full' | 'empty' | number | [number, number, number], f: (m: ResolvedMember) => number): [number, number, number] =>
    Array.isArray(x) ? x : (team.map(m => (x === 'full' || x === 'empty' ? f(m) : x)) as [number, number, number])
  const e = sc.initial.energy
  return {
    data, team, enemy, buffs, effects, commands,
    initial: {
      energy: trio(e, m => (e === 'full' ? m.def.energyCost : 0)),
      concerto: trio(sc.initial.concerto, () => 0),
      onField,
    },
    rules,
    options: {
      repeat: sc.options.repeat, maxFrames: sc.options.maxFrames, maxWait: sc.options.maxWait, tuneBreak: sc.options.tuneBreak,
      ...(sc.options.endAt !== undefined ? { endAt: sc.options.endAt } : {}),
    },
    warnings,
  }
}

// ---------------------------------------------------------------------------
// 队员：面板、buff、动作表

type MemberInput = Scenario['team'][number]
interface Built { member: ResolvedMember; buffs: RegisteredBuff[]; effects: RegisteredEffect[] }

function resolveMember(m: MemberInput, slot: Slot, data: GameData, issues: string[], warnings: string[]): Built | null {
  const where = `队伍第 ${slot + 1} 位 ${m.char}`
  const def = data.characters[m.char]
  if (!def) {
    issues.push(`${where}：没有这个角色的数据（要有 data/curated/characters/${m.char}.ts；现有：${Object.keys(data.characters).join('、')}）`)
    return null
  }
  const weapon = data.weapons[m.weapon.name]
  if (!weapon) { issues.push(`${where}：没有武器"${m.weapon.name}"`); return null }
  if (weapon.type !== def.weaponType) issues.push(`${where}：${m.char} 用${def.weaponType}，${weapon.key} 是${weapon.type}`)
  const chain = m.chain as Chain
  const rank = m.weapon.rank as Rank

  const panel: StaticPanel = {
    hp: { base: def.base.hp, pct: 0, flat: 0 },
    atk: { base: def.base.atk, pct: 0, flat: 0 },
    def: { base: def.base.def, pct: 0, flat: 0 },
    critRate: CHAR_BASE.critRate, critDamage: CHAR_BASE.critDamage, energyRegen: CHAR_BASE.energyRegen,
    healBonus: 0, tunabilityRate: def.tunabilityRate, harmonyBreakBoost: def.harmonyBreakBoost,
  }
  const buffs: RegisteredBuff[] = []
  const stat = statAdder(m.char, slot, panel, buffs)
  // 武器主属性是基础攻击，与角色基础攻击相加后再乘百分比（TD-03 §3.2：floor((角色基础 + 武器基础) × (1 + Σ%)) + Σ固定）
  if (weapon.main.stat === '攻击') panel.atk.base += weapon.main.value
  else stat('武器', weapon.main.stat, weapon.main.value)
  stat('武器', weapon.sub.stat, weapon.sub.value)
  for (const [k, v] of Object.entries(def.treeStats)) stat('技能树', k as StatKey, v)
  const echoes: ResolvedMember['echoes'] = []
  const sets = new Map<string, number>()
  for (const [i, e] of m.echoes.entries()) {
    // 首位声骸要放技能，必须在声骸表里；其余几件只计入词条与套装，表里没有（1C 小怪多半不在）也行
    const edef = echoOf(data, e.name)
    if (!edef && i === 0) {
      const hint = Object.keys(data.echoes).length > 0 ? '名字照声骸表 A 列写，如"梦魇·无冠者"' : '没有 echoes.json，先 pnpm build:data'
      issues.push(`${where}：首位声骸"${e.name}"不在声骸表里，放不了技能（${hint}）`)
    }
    for (const [k, v] of Object.entries(e.main)) stat('声骸', k as StatKey, v!)
    for (const [k, v] of Object.entries(e.subs)) stat('声骸', k as StatKey, v!)
    echoes.push({ def: edef, set: e.set, main: e.main as StatValues, subs: e.subs as StatValues })
    sets.set(e.set, (sets.get(e.set) ?? 0) + 1)
  }

  // 常驻与触发型 buff：角色（按共鸣链过滤）、武器被动（按谐振阶取值）、套装件数效果
  for (const b of def.buffs)
    if (!b.requires || chain >= b.requires.chain) buffs.push({ def: b, value: pick(b.value, rank), owner: slot })
  for (const b of weapon.passives) buffs.push({ def: b, value: pick(b.value, rank), owner: slot })
  // 资源型触发效果（TD-07 §9）：同样按共鸣链过滤、按谐振阶取值
  const effects: RegisteredEffect[] = []
  for (const e of def.resourceEffects)
    if (!e.requires || chain >= e.requires.chain) effects.push({ def: e, amount: pick(e.amount, rank), owner: slot })
  for (const e of weapon.resourceEffects) effects.push({ def: e, amount: pick(e.amount, rank), owner: slot })

  // 首位声骸（总设计 §3.3 第 4 步、TD-01 §13.3）：技能动作按体型挑好并入动作表、别名 Q；首位加成与技能附带的效果
  // 登记在武器之后、套装之前（TD-07 的登记顺序）
  let echoActions: Record<ActionId, ActionDef> = {}
  const aliases = { ...def.aliases }
  const main = echoes[0]?.def
  if (main) {
    const picked = echoActionsFor(main, def.bodyType)
    echoActions = picked.actions
    if (aliases.Q !== undefined) issues.push(`${where}：角色模块的别名 Q 与首位声骸技能冲突`)
    aliases.Q = picked.q
    if (picked.note) warnings.push(`${m.char}：首位声骸 ${main.key} ${picked.note}`)
    for (const b of main.mainSlotBuffs) buffs.push({ def: b, value: pick(b.value, 1), owner: slot })
    for (const e of main.resourceEffects) effects.push({ def: e, amount: pick(e.amount, 1), owner: slot })
    if (!main.curated)
      warnings.push(`${m.char}：首位声骸 ${main.key} 没写进 data/curated/echoes.ts，首位加成与技能附带的效果不计入，只算技能伤害`)
    const n = main.flags.length + Object.values(echoActions).reduce((a, x) => a + x.flags.length + x.judgments.reduce((b, j) => b + j.flags.length, 0), 0)
    if (n > 0) warnings.push(`${m.char}：首位声骸 ${main.key} 有 ${n} 处要核对的数据（pnpm check:data -- --flags ${main.key} 查看）`)
  }
  for (const [name, n] of sets) {
    const set = data.echoSets[name]
    if (!set) {
      if (n >= 2) warnings.push(`${m.char}：套装"${name}"（${n} 件）的效果还没写进 data/curated/echo-sets.ts，不计入`)
      continue
    }
    for (const [need, list] of Object.entries(set.pieces)) {
      if (n >= Number(need)) for (const b of list ?? []) buffs.push({ def: b, value: pick(b.value, rank), owner: slot })
    }
  }

  // 动作表：体型通用动作 + 角色动作（按共鸣链挑判定）+ 首位声骸动作（'Q·…'，不会与前两者重名）
  const common = def.commonBlock ? data.commonActions[def.commonBlock] ?? {} : {}
  const actions: Record<ActionId, ActionDef> = { ...common, ...forChain(def.actions, chain), ...echoActions }
  return {
    member: { slot, def, chain, weapon: { def: weapon, rank }, echoes, panel, actions, aliases },
    buffs, effects,
  }
}

/** 声骸名 → 定义：异相只换了配色、数值与本体相同（2026-10-04 用户确认），"异相·X"取 X */
function echoOf(data: GameData, name: string): EchoDef | null {
  return data.echoes[name] ?? (name.startsWith('异相·') ? data.echoes[name.slice('异相·'.length)] : undefined) ?? null
}

/** 数组值 = 武器 R1–R5，按谐振阶取；标记型 buff 没有数值，记 0 */
function pick(v: number | readonly number[] | undefined, rank: number): number {
  return Array.isArray(v) ? v[rank - 1]! : (v as number | undefined) ?? 0
}

/** 属性 → 面板（面板类乘区）或常驻 buff（带过滤条件的加成）。同一来源、同一属性合成一条 buff，日志里好认 */
function statAdder(char: string, slot: Slot, panel: StaticPanel, buffs: RegisteredBuff[]) {
  return (source: string, k: StatKey, v: number): void => {
    const z = STAT_TO_ZONE[k]
    switch (z.zone) {
      case 'hpPct': panel.hp.pct += v; return
      case 'hpFlat': panel.hp.flat += v; return
      case 'atkPct': panel.atk.pct += v; return
      case 'atkFlat': panel.atk.flat += v; return
      case 'defPct': panel.def.pct += v; return
      case 'defFlat': panel.def.flat += v; return
      case 'critRate': panel.critRate += v; return
      case 'critDamage': panel.critDamage += v; return
      case 'energyRegen': panel.energyRegen += v; return
      case 'healBonus': panel.healBonus += v; return
    }
    const id = `${char}.${source}.${k}`
    const had = buffs.find(b => b.def.id === id)
    if (had) { had.value += v; return }
    const filter = { ...(z.elements ? { elements: z.elements } : {}), ...(z.tags ? { tags: z.tags } : {}) }
    const def: BuffDef = {
      id, source: `${source}：${k}`, zone: z.zone, value: v, ...(Object.keys(filter).length ? { filter } : {}),
      target: 'self', maxStacks: 1, stackGain: 1, duration: 'inf', onSwitchOut: 'persist', refresh: 'refresh', trigger: 'always',
    }
    buffs.push({ def, value: v, owner: slot })
  }
}

// ---------------------------------------------------------------------------
// 敌人、规则

function resolveEnemy(e: Scenario['enemy'], data: GameData, issues: string[]): EnemyPreset {
  if ('preset' in e) {
    const p = data.enemies[e.preset]
    if (p) return p
    issues.push(`敌人预设"${e.preset}"不存在：写成"类型/名称"，如"全息6/朔雷之鳞"（enemies.json 的 id）`)
    return data.enemies[Object.keys(data.enemies)[0]!]!
  }
  const c = e.custom
  const res = Object.fromEntries(ELEMENTS_ALL.map(el => [el, c.res[el] ?? DEFAULT_RES])) as Record<Element, number>
  return {
    id: '自定义', name: '自定义', tag: '自定义', cost: c.cost, level: c.level, hp: c.hp ?? 1e12,   // 生命缺省不设上限
    def: c.def ?? enemyDefByLevel(c.level), res,
    whiteBar: { max: c.whiteBar ?? 0, recover: 0, reduce: 0 }, whiteBarTough: c.whiteBar ?? 0,
    paralysisFrames: Math.round((c.paralysisSec ?? 0) * 60), poise: { max: 0, recover: 0, reduce: 0 },
    tunabilityMax: c.tunabilityMax ?? 0,
  }
}

/** options.rules 覆盖 DEFAULT_RULES：只认已有的键，类型要一致；对象类的键按一层合并 */
function resolveRules(over: Record<string, unknown> | undefined, issues: string[]): Rules {
  const out: Rules = structuredClone(DEFAULT_RULES)
  for (const [k, v] of Object.entries(over ?? {})) {
    if (!(k in out)) { issues.push(`options.rules.${k}：没有这条规则（现有：${Object.keys(out).join('、')}）`); continue }
    const cur = (out as unknown as Record<string, unknown>)[k]
    if (typeof cur !== typeof v || Array.isArray(v)) { issues.push(`options.rules.${k}：应为 ${typeof cur}`); continue }
    ;(out as unknown as Record<string, unknown>)[k] = typeof v === 'object' && v !== null ? { ...(cur as object), ...v } : v
  }
  return out
}
