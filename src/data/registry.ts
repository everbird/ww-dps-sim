// src/data/registry.ts —— 注册层：生成数据 + 手写模块 → GameData（总设计 §2 ②、TD-02 §4）
// 纯函数，不读文件：Node 侧由 load.ts 读盘后调用，网页将来 fetch 之后调用同一个函数。
// 只有写了角色模块（data/curated/characters/<角色>.ts）的角色进 GameData：武器类型、别名、buff、技能树属性都在模块里，
// 没有模块的角色算不对（总设计 T10：一次一支队伍）。
import { STAT_BY_PROP_ID, type ActionId, type BlockKey, type StatKey } from './common'
import { assembleBlock, type AssembleOptions } from './assemble-action'
import { assembleEchoActions } from './assemble-echo'
import {
  BuffDefSchema, ResourceEffectSchema, type BuffDef, type BuffDefInput, type ResourceEffect, type ResourceEffectInput,
} from './buff.schema'
import { mergeBlockKey, type ActionOverride, type CharacterModuleDef, type EchoModule, type EchoSetModule, type EffectModule, type WeaponModule } from './define'
import type { GenActionFile, GenCharacter, GenEcho, GenEchoStats, GenEffectsFile, GenEnemy, GenMeta, GenTuneBreak, GenWeapon } from './generated.schema'
import {
  DEFAULT_RULES, type ActionDef, type CharacterDef, type EchoDef, type EchoSetDef, type EffectDef, type EnemyPreset, type GameData, type WeaponDef,
} from './gamedata'
import { parseOrThrow } from './validate'
import { round } from '../engine/num'

export interface GeneratedFiles {
  meta: GenMeta
  characters: Record<string, GenCharacter>
  actions: Record<BlockKey, GenActionFile>          // 块键 → 动作文件（角色块与通用块）
  weapons: GenWeapon[]
  echoes: GenEcho[]                                 // echoes.json（TD-01 §8）；没有时为空
  echoStats?: GenEchoStats                          // echo-stats.json（TD-01 §5.4）
  enemies: GenEnemy[]
  tuneBreak?: GenTuneBreak                          // tune-break.json（TD-01 §11.3）；没有时谐度破坏伤害为 0
  effects?: GenEffectsFile                          // effects.json（TD-01 §11.2）：逐层倍率与异常伤害基础值；没有时异常效应伤害为 0
  rarity?: Record<string, number>                   // 角色名 → 星级（nanoka.json；没有时 CharacterDef.rarity 为 null）
}

export interface CuratedModules {
  characters: CharacterModuleDef[]
  weapons: WeaponModule[]
  echoes: EchoModule[]                              // data/curated/echoes.ts
  echoSets: EchoSetModule[]
  effects: EffectModule[]                           // data/curated/effects.ts：异常效应的规则（TD-06 §18）
  envBuffs: BuffDefInput[]
}

export function buildGameData(gen: GeneratedFiles, cur: CuratedModules): GameData {
  const charNames = new Set(Object.keys(gen.characters))
  const characters: Record<string, CharacterDef> = {}
  for (const mod of cur.characters) characters[mod.name] = buildCharacter(gen, mod, charNames)

  const commonActions: Record<BlockKey, Record<string, ActionDef>> = {}
  for (const [key, file] of Object.entries(gen.actions))
    if (key.startsWith('通用-')) commonActions[key] = assembleBlock(file, {}, { charNames })

  const passives = new Map(cur.weapons.map(w => [w.name, w]))
  const weapons: Record<string, WeaponDef> = {}
  for (const w of gen.weapons) weapons[w.key] = buildWeapon(w, passives.get(w.key))
  for (const name of passives.keys())
    if (!weapons[name]) throw new Error(`data/curated/weapons 写了不存在的武器"${name}"`)

  // 声骸：全部装配（不像角色那样要求有模块）；echoes.ts 只补首位加成、技能附带的效果与覆盖（TD-01 §13.3）
  const echoMods = new Map(cur.echoes.map(m => [m.name, m]))
  const echoes: Record<string, EchoDef> = {}
  for (const e of gen.echoes) echoes[e.key] = buildEcho(e, echoMods.get(e.key))
  for (const name of echoMods.keys())
    if (!echoes[name]) throw new Error(`data/curated/echoes 写了不存在的声骸"${name}"（名字照声骸表 A 列写）`)

  const echoSets: Record<string, EchoSetDef> = {}
  for (const s of cur.echoSets) {
    echoSets[s.name] = {
      name: s.name,
      pieces: Object.fromEntries(Object.entries(s.pieces).map(([n, bs]) => [n, bs.map(b => buff(b, `声骸套装 ${s.name}`))])),
    }
  }

  const enemies: Record<string, EnemyPreset> = {}
  for (const e of gen.enemies) {
    enemies[e.id] = {
      id: e.id, name: e.name, tag: e.tag, cost: e.cost, level: e.level, hp: e.hp, def: e.def, res: e.res,
      whiteBar: e.whiteBar, whiteBarTough: e.whiteBarTough ?? 0, paralysisFrames: round((e.paralysisSec ?? 0) * 60),
      poise: e.poise, tunabilityMax: e.tunabilityMax,
    }
  }

  return {
    version: /(\d{8})/.exec(gen.meta.xlsxFile)?.[1] ?? gen.meta.xlsxFile,
    meta: gen.meta,
    characters, commonActions, weapons,
    echoes, echoSets, echoStats: gen.echoStats ?? null, enemies,
    effects: Object.fromEntries(cur.effects.map(e => [e.name, effectDef(e, gen.effects)])),
    abnormalBaseByLevel: gen.effects?.abnormalBaseByLevel ?? [],   // 异常伤害基础值（base 页 AbnomalDamage，TD-03 §5）
    tuneBreak: tuneBreakTable(gen.tuneBreak),
    envBuffs: Object.fromEntries(cur.envBuffs.map(b => [b.id, buff(b, '场景 buff')])),
    rules: DEFAULT_RULES,
    // 钩子表（总设计 §10.1）：角色模块里唯一的代码，按角色名放在这里，CharacterDef 只留数据（含 vars 的初值）
    hooks: Object.fromEntries(cur.characters.flatMap(m => (m.hooks ? [[m.name, m.hooks]] : []))),
  }
}

const frames = (sec: number): number => round(sec * 60)

/** tune-break.json → 谐度破坏表（TD-03 §6）与规则（谐破冷却、按钮，秒 → 战斗帧）；没有文件时全 0：谐度破坏伤害为 0 */
function tuneBreakTable(t: GenTuneBreak | undefined): GameData['tuneBreak'] {
  if (!t) return { variants: [], baseByLevel: [], costFactor: { 1: 0, 3: 0, 4: 0 }, rules: null }
  const factor = (cost: 1 | 3 | 4) => t.costFactors.find(f => f.cost === cost)?.factor ?? 0
  return {
    variants: t.variants.map(v => ({ key: v.key, weaponType: v.weaponType, seq: v.seq, multiplier: v.multiplier, ticks: v.ticks })),
    baseByLevel: t.baseByLevel, costFactor: { 1: factor(1), 3: factor(3), 4: factor(4) },
    rules: t.rules && {
      lockFrames: { 1: frames(t.rules.lockSec[1]), 3: frames(t.rules.lockSec[3]), 4: frames(t.rules.lockSec[4]) },
      buttonFrames: frames(t.rules.buttonSec),
    },
  }
}

/** 异常效应：规则取手写的（data/curated/effects.ts，TD-06 §18），逐层倍率取 effects.json（dmg「异常伤害」行，TD-01 §4.3）；
 *  没有 effects.json 或里面没有这个效应时倍率为空，结算的伤害为 0 */
function effectDef(e: EffectModule, gen: GenEffectsFile | undefined): EffectDef {
  return {
    name: e.name, element: e.element, source: e.source, multipliers: gen?.effects.find(x => x.name === e.name)?.multipliers ?? [],
    maxStacks: e.maxStacks, burstMax: e.burstMax ?? 0, duration: e.duration, tickInterval: e.tickInterval, decay: e.decay ?? 0,
  }
}

/** 装载一条手写 buff：补默认值并校验（TD-02 §5.1） */
function buff(b: BuffDefInput, where: string): BuffDef {
  return parseOrThrow(BuffDefSchema, b, `${where} 的 buff ${b.id}`)
}

/** 装载一条资源型触发效果（TD-07 §9） */
function effect(e: ResourceEffectInput, where: string): ResourceEffect {
  return parseOrThrow(ResourceEffectSchema, e, `${where} 的资源型效果 ${e.id}`)
}

function buildCharacter(gen: GeneratedFiles, mod: CharacterModuleDef, charNames: ReadonlySet<string>): CharacterDef {
  const g = gen.characters[mod.name]
  if (!g) throw new Error(`角色模块 ${mod.name} 在 characters.json 里找不到（名字要与动作表块名一致）`)
  const file = gen.actions[mod.name]
  if (!file) throw new Error(`没有 ${mod.name} 的动作文件`)
  const tuneTicks = Object.fromEntries((gen.tuneBreak?.variants ?? []).filter(v => v.ticks !== null).map(v => [v.key, v.ticks!]))
  let actions = assembleCharacterActions(gen.actions, mod, { element: g.element, charNames, tuneTicks })
  for (const [alias, id] of Object.entries(mod.aliases ?? {}))
    if (!actions[id]) throw new Error(`${mod.name} 的别名 ${alias} 指向不存在的动作"${id}"`)
  // 别名 R 指向的动作收大招能量（TD-06 §2.3）；actionOverrides 里写了 energyCost（含 0）的以它为准
  const rId = mod.aliases?.R
  const r = rId !== undefined ? actions[rId] : undefined
  if (r && r.energyCost === undefined && g.energyCost > 0) actions = { ...actions, [r.id]: { ...r, energyCost: g.energyCost } }
  for (const a of Object.values(actions)) {
    const f = a.followUp
    if (!f) continue
    if (!actions[f.action]) throw new Error(`${mod.name} ${a.id} 的 followUp 指向不存在的动作"${f.action}"`)
    if (!a.judgments.some(j => j.name === f.after)) throw new Error(`${mod.name} ${a.id} 的 followUp 写的判定"${f.after}"不在这个动作里`)
  }
  const flags: string[] = []
  for (const a of Object.values(actions)) {
    for (const f of a.flags) flags.push(`${a.id}:${f}`)
    for (const j of a.judgments) for (const f of j.flags) flags.push(`${a.id}/${j.name}:${f}`)
  }
  const coreResources = g.coreResources.map(c => ({
    slot: c.slot as 1 | 2 | 3 | 4 | 5, name: mod.coreNames?.[c.slot as 1 | 2 | 3 | 4 | 5] ?? c.name, cap: mod.coreCaps?.[c.slot as 1 | 2 | 3 | 4 | 5] ?? c.cap,
  }))
  for (const k of Object.keys(mod.coreNames ?? {}))
    if (!coreResources.some(c => c.slot === Number(k))) throw new Error(`${mod.name} 的 coreNames 写了不存在的槽 ${k}`)
  const dup = coreResources.map(c => c.name).filter((n, i, a) => n && a.indexOf(n) !== i)
  if (dup.length) throw new Error(`${mod.name} 的核心资源槽名重复：${dup.join('、')}`)
  return {
    name: mod.name, element: g.element, weaponType: mod.weaponType, bodyType: mod.bodyType ?? g.bodyType,
    commonBlock: g.commonBlock, base: g.base90, energyCost: g.energyCost,
    coreResources,
    tunabilityRate: g.tunabilityRate, harmonyBreakBoost: g.harmonyBreakBoost,
    rarity: gen.rarity?.[mod.name] ?? null,
    treeStats: mod.treeStats ?? {},
    actions, aliases: mod.aliases ?? {},
    buffs: (mod.buffs ?? []).map(b => buff(b, mod.name)),
    resourceEffects: (mod.resourceEffects ?? []).map(e => effect(e, mod.name)),
    vars: { ...(mod.vars ?? {}) },
    ...(mod.effectRules ? { effectRules: mod.effectRules } : {}),
    flags,
  }
}

/** 角色的动作：本块 + 并入的块（TD-01 Q2），各自带上角色模块的覆盖（pnpm check:data --flags 也用它）。
 *  带前缀的块（心的照世心）：动作 ID 加前缀，它的覆盖按加了前缀的 ID 写，装配前去掉前缀 */
export function assembleCharacterActions(
  blocks: Readonly<Record<BlockKey, GenActionFile>>, mod: CharacterModuleDef, opts: AssembleOptions,
): Record<ActionId, ActionDef> {
  const file = blocks[mod.name]
  if (!file) throw new Error(`没有 ${mod.name} 的动作文件`)
  const merges = (mod.mergeBlocks ?? []).map(m => ({ key: mergeBlockKey(m), prefix: typeof m === 'string' ? '' : m.prefix }))
  const own: Record<ActionId, ActionOverride> = {}
  const merged = new Map<string, Record<ActionId, ActionOverride>>(merges.filter(m => m.prefix).map(m => [m.prefix, {}]))
  for (const [id, ov] of Object.entries(mod.actionOverrides ?? {})) {
    const m = merges.find(x => x.prefix && id.startsWith(x.prefix))
    if (m) merged.get(m.prefix)![id.slice(m.prefix.length)] = unprefixOverride(ov, m.prefix)
    else own[id] = ov
  }
  let actions = assembleBlock(file, own, opts)
  for (const { key, prefix } of merges) {
    const extra = blocks[key]
    if (!extra) throw new Error(`${mod.name} 的 mergeBlocks 写了不存在的块"${key}"`)
    const more = prefixActions(assembleBlock(extra, merged.get(prefix) ?? {}, opts), prefix)
    for (const id of Object.keys(more)) if (actions[id]) throw new Error(`${mod.name} 并入 ${key} 时动作重名：${id}`)
    actions = { ...actions, ...more }
  }
  return actions
}

/** 带前缀并入的块：覆盖里指向块内动作的 ID（连段前置、接续动作、另存为）去掉前缀，装配完再由 prefixActions 加回 */
function unprefixOverride(ov: ActionOverride, prefix: string): ActionOverride {
  const strip = (id: ActionId) => (id.startsWith(prefix) ? id.slice(prefix.length) : id)
  return {
    ...ov,
    ...(ov.comboFrom ? { comboFrom: ov.comboFrom.map(strip) } : {}),
    ...(ov.followUp ? { followUp: { ...ov.followUp, action: strip(ov.followUp.action) } } : {}),
    ...(ov.copyAs ? { copyAs: ov.copyAs.map(strip) } : {}),
  }
}

/** 动作 ID 与块内的引用（连段前置、接续动作）加前缀；判定名不变。连段前置只能指同一块里的动作 */
function prefixActions(actions: Record<ActionId, ActionDef>, prefix: string): Record<ActionId, ActionDef> {
  if (!prefix) return actions
  const out: Record<ActionId, ActionDef> = {}
  for (const a of Object.values(actions)) {
    out[prefix + a.id] = {
      ...a, id: prefix + a.id,
      ...(a.comboFrom ? { comboFrom: a.comboFrom.map(x => prefix + x) } : {}),
      ...(a.followUp ? { followUp: { ...a.followUp, action: prefix + a.followUp.action } } : {}),
    }
  }
  return out
}

/** 一个声骸：装配动作、登记 echoes.ts 的效果；echoes.ts 处理过的声骸级 flag 去掉（check:data 也用它） */
export function buildEcho(e: GenEcho, mod: EchoModule | undefined): EchoDef {
  const { actions, q } = assembleEchoActions(e, mod?.actionOverrides)
  // echoes.ts 写了的就算处理过：COST、Q 的冷却（cooldownText、cooldownNanoka）、按次数充能（charges）
  const ov = mod?.actionOverrides?.[q]
  const handled = new Set([
    ...(mod?.cost !== undefined ? ['costMissing'] : []),
    ...(ov?.cooldown !== undefined ? ['cooldownText', 'cooldownNanoka'] : []),
    ...(ov?.charges !== undefined ? ['charges'] : []),
  ])
  for (const [who, id] of Object.entries(mod?.qFor ?? {}))
    if (!actions[id]) throw new Error(`声骸 ${e.key} 的 qFor 给 ${who} 写了不存在的动作"${id}"（现有：${Object.keys(actions).join('、')}）`)
  return {
    key: e.key, cost: mod?.cost ?? e.cost, actions, q, qFor: { ...(mod?.qFor ?? {}) }, description: e.description,
    mainSlotBuffs: (mod?.mainSlotBuffs ?? []).map(b => buff(b, `声骸 ${e.key}`)),
    resourceEffects: (mod?.resourceEffects ?? []).map(x => effect(x, `声骸 ${e.key}`)),
    curated: (mod?.mainSlotBuffs?.length ?? 0) + (mod?.resourceEffects?.length ?? 0) > 0,
    flags: e.flags.filter(f => !handled.has(f)),
  }
}

function statOf(propId: number, where: string): StatKey {
  const s = STAT_BY_PROP_ID[propId]
  if (!s) throw new Error(`${where}：属性 ID ${propId} 不认识（TD-01 §4.2）`)
  return s
}

function buildWeapon(w: GenWeapon, mod: WeaponModule | undefined): WeaponDef {
  return {
    key: w.key, rarity: w.rarity, type: w.type,
    main: { stat: statOf(w.main.propId, `武器 ${w.key} 主属性`), value: w.main.value90 },
    sub: { stat: statOf(w.sub.propId, `武器 ${w.key} 副属性`), value: w.sub.value90 },
    effects: w.effects,
    passives: (mod?.passives ?? []).map(b => buff(b, `武器 ${w.key}`)),
    resourceEffects: (mod?.resourceEffects ?? []).map(e => effect(e, `武器 ${w.key}`)),
    curated: mod !== undefined,
  }
}
