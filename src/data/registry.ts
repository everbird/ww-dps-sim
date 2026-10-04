// src/data/registry.ts —— 注册层：生成数据 + 手写模块 → GameData（总设计 §2 ②、TD-02 §4）
// 纯函数，不读文件：Node 侧由 load.ts 读盘后调用，网页将来 fetch 之后调用同一个函数。
// 只有写了角色模块（data/curated/characters/<角色>.ts）的角色进 GameData：武器类型、别名、buff、技能树属性都在模块里，
// 没有模块的角色算不对（总设计 T10：一次一支队伍）。
import { STAT_BY_PROP_ID, type BlockKey, type StatKey } from './common'
import { assembleBlock } from './assemble-action'
import { assembleEchoActions } from './assemble-echo'
import {
  BuffDefSchema, ResourceEffectSchema, type BuffDef, type BuffDefInput, type ResourceEffect, type ResourceEffectInput,
} from './buff.schema'
import type { CharacterModuleDef, EchoModule, EchoSetModule, WeaponModule } from './define'
import type { GenActionFile, GenCharacter, GenEcho, GenEnemy, GenMeta, GenWeapon } from './generated.schema'
import {
  DEFAULT_RULES, type ActionDef, type CharacterDef, type EchoDef, type EchoSetDef, type EnemyPreset, type GameData, type WeaponDef,
} from './gamedata'
import { parseOrThrow } from './validate'

export interface GeneratedFiles {
  meta: GenMeta
  characters: Record<string, GenCharacter>
  actions: Record<BlockKey, GenActionFile>          // 块键 → 动作文件（角色块与通用块）
  weapons: GenWeapon[]
  echoes: GenEcho[]                                 // echoes.json（TD-01 §8）；没有时为空
  enemies: GenEnemy[]
}

export interface CuratedModules {
  characters: CharacterModuleDef[]
  weapons: WeaponModule[]
  echoes: EchoModule[]                              // data/curated/echoes.ts
  echoSets: EchoSetModule[]
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
      whiteBar: e.whiteBar, poise: e.poise, tunabilityMax: e.tunabilityMax,
    }
  }

  return {
    version: /(\d{8})/.exec(gen.meta.xlsxFile)?.[1] ?? gen.meta.xlsxFile,
    meta: gen.meta,
    characters, commonActions, weapons,
    echoes, echoSets, enemies,
    effects: {}, abnormalBaseByLevel: [],           // M4
    tuneBreak: { variants: [], baseByLevel: [], costFactor: { 1: 0, 3: 0, 4: 0 } },   // M4
    envBuffs: Object.fromEntries(cur.envBuffs.map(b => [b.id, buff(b, '场景 buff')])),
    rules: DEFAULT_RULES,
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
  const opts = { element: g.element, charNames }
  let actions = assembleBlock(file, mod.actionOverrides, opts)
  for (const key of mod.mergeBlocks ?? []) {                  // 并入其他动作块（TD-01 Q2）
    const extra = gen.actions[key]
    if (!extra) throw new Error(`${mod.name} 的 mergeBlocks 写了不存在的块"${key}"`)
    const more = assembleBlock(extra, {}, opts)
    for (const id of Object.keys(more)) if (actions[id]) throw new Error(`${mod.name} 并入 ${key} 时动作重名：${id}`)
    actions = { ...actions, ...more }
  }
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
  return {
    name: mod.name, element: g.element, weaponType: mod.weaponType, bodyType: mod.bodyType ?? g.bodyType,
    commonBlock: g.commonBlock, base: g.base90, energyCost: g.energyCost,
    coreResources: g.coreResources.map(c => ({
      slot: c.slot as 1 | 2 | 3 | 4 | 5, name: c.name, cap: mod.coreCaps?.[c.slot as 1 | 2 | 3 | 4 | 5] ?? c.cap,
    })),
    tunabilityRate: g.tunabilityRate, harmonyBreakBoost: g.harmonyBreakBoost,
    treeStats: mod.treeStats ?? {},
    actions, aliases: mod.aliases ?? {},
    buffs: (mod.buffs ?? []).map(b => buff(b, mod.name)),
    resourceEffects: (mod.resourceEffects ?? []).map(e => effect(e, mod.name)),
    ...(mod.hooks ? { hooks: mod.hooks } : {}),
    flags,
  }
}

/** 一个声骸：装配动作、登记 echoes.ts 的效果；echoes.ts 处理过的声骸级 flag 去掉（check:data 也用它） */
export function buildEcho(e: GenEcho, mod: EchoModule | undefined): EchoDef {
  const { actions, q } = assembleEchoActions(e, mod?.actionOverrides)
  // echoes.ts 写了的就算处理过：COST、Q 的冷却（cooldownText）、按次数充能（charges）
  const ov = mod?.actionOverrides?.[q]
  const handled = new Set([
    ...(mod?.cost !== undefined ? ['costMissing'] : []),
    ...(ov?.cooldown !== undefined ? ['cooldownText'] : []),
    ...(ov?.charges !== undefined ? ['charges'] : []),
  ])
  return {
    key: e.key, cost: mod?.cost ?? e.cost, actions, q, description: e.description,
    mainSlotBuffs: (mod?.mainSlotBuffs ?? []).map(b => buff(b, `声骸 ${e.key}`)),
    resourceEffects: (mod?.resourceEffects ?? []).map(x => effect(x, `声骸 ${e.key}`)),
    curated: mod !== undefined,
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
  }
}
