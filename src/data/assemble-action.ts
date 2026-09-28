// src/data/assemble-action.ts —— 生成数据的动作组 → ActionDef（TD-01 §13.1 / §13.2，按 TD-04 §7 修订）
// 原型只装配内核用到的时间字段；倍率、元素、资源、castGains 在正式实现里按 TD-01 §13 补齐（这里给占位值）。
// 另有两步：角色模块的 actionOverrides（TD-01 §13.4），按共鸣链数挑判定 forChain（总设计 §3.3 第 4 步）。
import type { ActionId, ActionKind, DilationSide } from './common'
import type { ActionOverride } from './define'
import type { GenActionFile, GenGroup, GenRow } from './generated.schema'
import type { ActionDef, CancelWindow, ChainRange, DilationDef, DilationWindow, InputLock, JudgmentDef, PriorityStep } from './gamedata'

const SIDES: DilationSide[] = ['self', 'enemy', 'ally']

/** 装配一个块。overrides = 角色模块的 actionOverrides；写了块里不存在的动作 / 行 / 判定直接报错 */
export function assembleBlock(file: GenActionFile, overrides: Record<ActionId, ActionOverride> = {}): Record<string, ActionDef> {
  const ids = new Set(file.groups.map(g => g.id))
  for (const id of Object.keys(overrides))
    if (!ids.has(id)) throw new Error(`${file.key} 的 actionOverrides 写了不存在的动作"${id}"`)
  const out: Record<string, ActionDef> = {}
  for (const g of file.groups) {
    const ov = overrides[g.id]
    const def = assembleGroup(file, g, ids, ov?.dropRows)
    out[g.id] = ov ? applyOverride(def, ov) : def
  }
  // 前置动作一个派生窗口都没有时，连段永远接不上：不设连段前置，打 flag 交给 curated（TD-09 §8 全量检查发现 7 组）
  for (const def of Object.values(out)) {
    if (overrides[def.id]?.comboFrom) continue                        // 手写的连段前置照用
    const pre = def.comboFrom?.map(id => out[id]).filter(d => d !== undefined) ?? []
    if (pre.length > 0 && pre.every(p => p.cancelWindows.length === 0)) {
      delete def.comboFrom
      def.flags = [...def.flags, 'comboNoWindow']
    }
  }
  return out
}

/** 按共鸣链数挑判定（总设计 §3.3 第 4 步）：chainRange 不含该链数的判定去掉；动作的时间字段不受影响 */
export function forChain(actions: Record<ActionId, ActionDef>, chain: number): Record<ActionId, ActionDef> {
  const out: Record<ActionId, ActionDef> = {}
  for (const [id, a] of Object.entries(actions)) {
    const keep = a.judgments.filter(j => !j.chainRange || (chain >= j.chainRange.min && chain <= j.chainRange.max))
    out[id] = keep.length === a.judgments.length ? a : { ...a, judgments: keep }
  }
  return out
}

function assembleGroup(file: GenActionFile, g: GenGroup, ids: Set<string>, dropRows: string[] = []): ActionDef {
  const flags = new Set<string>()                           // 组级 flag，同名只记一次
  for (const n of dropRows)
    if (!g.rows.some(r => r.name === n)) throw new Error(`${file.key} ${g.id} 的 dropRows 写了不存在的行"${n}"`)
  const kept = g.rows.filter(r => !dropRows.includes(r.name))
  // 方向变体（-前 / -后）是二选一：默认只取 -前 行（TD-04 §7 ⑤）
  const hasFront = kept.some(r => r.nameTags.dir === '前')
  const rows = kept.filter(r => !(hasFront && r.nameTags.dir === '后'))
  if (rows.length < kept.length) flags.add('dirVariant')
  // 带链标记的非判定行（膨胀 / 资源 / 标记）暂不按链筛选，交给 TD-06 / TD-08
  if (rows.some(r => r.kind !== 'hit' && r.nameTags.chain !== undefined)) flags.add('chainNonHit')

  // 结束帧：第一个有值的行；都没有则 max(发生帧 + 持续帧, 派生帧)
  let endFrame = rows.find(r => r.endFrame !== null)?.endFrame ?? null
  if (endFrame === null) {
    const cands = rows.flatMap(r => [
      r.spawnFrame !== null && r.lifeFrames !== null && r.lifeFrames > 0 ? r.spawnFrame + r.lifeFrames : 0,
      r.deriveFrame ?? 0,
    ])
    endFrame = Math.max(0, ...cands)
    flags.add('noEnd')
  }
  if (new Set(rows.map(r => r.endFrame).filter(e => e !== null)).size > 1) flags.add('multiEnd')   // 几行的结束帧不一样才算

  const cancelWindows: CancelWindow[] = rows.filter(r => r.deriveFrame !== null).map(r => ({
    from: r.deriveFrame!,
    until: r.deriveDuration === null || r.deriveDuration === -1 ? endFrame! : r.deriveFrame! + r.deriveDuration,
    row: r.row,
  }))

  const priority = assemblePriority(rows, flags)
  const kind = kindOf(g.id)

  // 连段前置：A{n} ← A{n−1}（同前缀、块内存在）；闪避反击 ← 极限闪避（TD-04 §6.2）
  let comboFrom: string[] | undefined
  const m = /^(.*)A(\d+)$/.exec(g.id)
  if (m && Number(m[2]) >= 2 && ids.has(`${m[1]}A${Number(m[2]) - 1}`)) comboFrom = [`${m[1]}A${Number(m[2]) - 1}`]
  if (g.id === '闪避反击') comboFrom = ['极限闪避']

  const inputLocks: InputLock[] = []
  const maxHint = (k: 'noInputBefore' | 'noDodgeBefore' | 'noSwitchBefore') =>
    rows.reduce<number | null>((acc, r) => (r.hints[k] !== undefined ? Math.max(acc ?? 0, r.hints[k]!) : acc), null)
  const noInput = maxHint('noInputBefore')
  const noDodge = maxHint('noDodgeBefore')
  if (noInput !== null) inputLocks.push({ until: noInput, kinds: 'all' })
  if (noDodge !== null) inputLocks.push({ until: noDodge, kinds: ['dodge'] })

  // 膨胀：每行每侧按锚点拆开——膨胀发生有值 → 按动作局部帧登记；为空且是判定行 → 挂在判定上逐次命中登记（TD-04 §3.2）
  const dilations: DilationDef[] = []
  const hitstopOf = new Map<GenRow, DilationDef>()
  for (const r of rows) {
    const d = r.dilation
    if (!d?.type) continue
    const byStart = new Map<number, DilationDef>()
    for (const side of SIDES) {
      const w = d[side]
      if (!w) continue
      if (w.rate === null || w.duration === null) { flags.add('dilationIncomplete'); continue }
      const win: DilationWindow = { rate: w.rate, duration: w.duration }
      if (w.start === null && r.kind === 'hit') {
        const h = hitstopOf.get(r) ?? { type: d.type, anchor: 'hit', start: 0 }
        h[side] = win
        hitstopOf.set(r, h)
        continue
      }
      const start = w.start ?? 1
      if (w.start === null) flags.add('dilationStartGuess')
      const a = byStart.get(start) ?? { type: d.type, anchor: 'action', start }
      a[side] = win
      byStart.set(start, a)
    }
    dilations.push(...byStart.values())
  }

  const names = new Map<string, number>()
  const hitRows = rows.filter(r => r.kind === 'hit')
  const chains = chainRanges(hitRows)
  const judgments: JudgmentDef[] = hitRows.map(r => {
    const n = (names.get(r.name) ?? 0) + 1
    names.set(r.name, n)
    const life = r.lifeFrames ?? 1
    const iv = r.hints.tickInterval ?? null
    const ticks = r.hints.maxTicks ?? (iv !== null && life > 0 ? Math.ceil(life / iv) : 1)
    const jf: string[] = []
    if (r.lifeFrames === null) jf.push('noLife')
    if (r.hints.maxTicks === undefined && iv !== null) jf.push('ticksGuess')
    if (iv !== null && life > 0 && (ticks - 1) * iv >= life) jf.push('ticksCapped')   // 寿命内放不下全部次数（TD-04 §5.2）
    if (r.persists === null && life !== -1) jf.push('persistsGuess')
    const ch = chains.get(r)
    if (ch?.additive) jf.push('chainAdditive')
    return {
      name: n > 1 ? `${r.name}#${n}` : r.name,
      row: r.row,
      spawnFrame: r.eventSpawned ? null : r.spawnFrame,
      birthFrame: r.birthFrame,
      lifeFrames: life,
      ticks,
      tickInterval: iv,
      persistsOnCancel: life === -1 ? false : (r.persists ?? true),
      followHitstop: r.followHitstop === true,
      target: 'enemy', calc: 'damage', multiplier: 1, relatedAttr: 'atk', element: '物理', tags: [],   // 占位（原型不连 dmg）
      gains: { energy: 0, concerto: 0, core: [0, 0, 0] },
      gauges: { toughness: 0, tunability: 0 },
      hitstop: hitstopOf.get(r) ?? null,
      ...(ch ? { chainRange: ch.range } : {}),
      flags: jf,
    }
  })
  judgments.sort((a, b) => (a.spawnFrame ?? Infinity) - (b.spawnFrame ?? Infinity))
  if (judgments.some(j => j.lifeFrames === -1 && j.spawnFrame !== null && j.spawnFrame >= endFrame!)) flags.add('minusOneAfterEnd')   // 动作停了才出现，永远不会生成（TD-04 §4.3）

  const outro = rows.find(r => r.hints.outroTriggerFrame !== undefined)?.hints.outroTriggerFrame
  const switchLock = maxHint('noSwitchBefore')
  return {
    id: g.id, owner: file.key, kind, endFrame, cancelWindows, priority,
    ...(comboFrom ? { comboFrom } : {}),
    inputLocks, judgments, dilations, castGains: [],
    ...(outro !== undefined ? { outroTriggerFrame: outro } : {}),
    ...(switchLock !== null ? { switchLockUntil: switchLock } : {}),
    source: { file: file.key, rows: g.rows.map(r => r.row) },
    flags: [...flags],
  }
}

/** 优先级：取值最多的一行；变化帧依次取 K 列 → 组内备注 → （仅两段）不能闪避 / 不响应输入 → 该行派生帧（TD-01 §13.1） */
function assemblePriority(rows: GenRow[], flags: Set<string>): PriorityStep[] {
  const withP = rows.filter(r => r.priority !== null)
  if (withP.length === 0) { flags.add('noPriority'); return [{ fromFrame: 0, value: 0 }] }
  const row = withP.reduce((best, r) => (r.priority!.length > best.priority!.length ? r : best))
  const values = row.priority!
  if (values.length === 1) return [{ fromFrame: 0, value: values[0]! }]
  const hint = (k: 'noDodgeBefore' | 'noInputBefore') => rows.find(r => r.hints[k] !== undefined)?.hints[k]
  let frames: number[] | undefined = row.priorityChange ?? rows.find(r => r.hints.priorityChangeFrames)?.hints.priorityChangeFrames
  if (!frames && values.length === 2) {
    const guess = hint('noDodgeBefore') ?? hint('noInputBefore') ?? row.deriveFrame ?? undefined
    if (guess !== undefined) { frames = [guess]; flags.add('priorityChangeGuess') }
  } else if (!frames && row.deriveFrame !== null) {
    frames = [row.deriveFrame]
    flags.add('priorityChangeGuess')
  }
  frames ??= []
  if (frames.length < values.length - 1) flags.add('priorityChangeMissing')
  const steps: PriorityStep[] = [{ fromFrame: 0, value: values[0]! }]
  for (let i = 1; i < values.length && i - 1 < frames.length; i++) steps.push({ fromFrame: frames[i - 1]!, value: values[i]! })
  return steps
}

const CHAIN_TOKEN = /(?<![A-Za-z])C\d(?!\d)/                // 与构建脚本 name_tags 的 chain 规则相同（TD-01 §3.9）

/** 共鸣链版本（TD-01 §13.2）：行名去掉 C\d 后相同的判定行，是同一判定在不同链数下的版本（无标记算 0），
 *  链数 c 取"标记 ≤ c"里最大的那个版本——椿 大招-C0 / C3 / C5 伤害 → [0, 2]、[3, 4]、[5, 6]。
 *  只有一种标记 n > 0、没有别的版本 → 从 n 链起额外出现（chainAdditive，要人确认不是替换某个判定）。 */
function chainRanges(hits: GenRow[]): Map<GenRow, { range: ChainRange; additive: boolean }> {
  const families = new Map<string, GenRow[]>()
  for (const r of hits) {
    const k = r.name.replace(CHAIN_TOKEN, '')
    families.set(k, [...(families.get(k) ?? []), r])
  }
  const out = new Map<GenRow, { range: ChainRange; additive: boolean }>()
  for (const rs of families.values()) {
    if (!rs.some(r => r.nameTags.chain !== undefined)) continue
    const tags = [...new Set(rs.map(r => r.nameTags.chain ?? 0))].sort((a, b) => a - b)
    if (tags.length === 1 && tags[0] === 0) continue                 // 只有 C0 版本 = 任何链数
    for (const r of rs) {
      const t = r.nameTags.chain ?? 0
      const next = tags[tags.indexOf(t) + 1]
      out.set(r, { range: { min: t, max: next === undefined ? 6 : next - 1 }, additive: tags.length === 1 })
    }
  }
  return out
}

/** 覆盖字段 → 视为已处理的 flag（TD-01 §13.4） */
const HANDLED: Partial<Record<keyof ActionOverride, string[]>> = {
  kind: ['kindGuess'], endFrame: ['multiEnd', 'noEnd'], priority: ['priorityChangeGuess', 'priorityChangeMissing', 'noPriority'],
  cancelWindows: ['deriveMinus1'], outroTriggerFrame: ['noOutroFrame'],
}
const J_HANDLED: Record<string, string[]> = {
  lifeFrames: ['noLife'], ticks: ['ticksGuess', 'ticksCapped'], persistsOnCancel: ['persistsGuess'], multiplier: ['noDmg'],
  chainRange: ['chainAdditive'],
}

function applyOverride(def: ActionDef, ov: ActionOverride): ActionDef {
  const accepted = new Set(ov.accept ?? [])
  for (const [field, fl] of Object.entries(HANDLED)) if (ov[field as keyof ActionOverride] !== undefined) fl.forEach(f => accepted.add(f))
  const out: ActionDef = { ...def }
  if (ov.kind !== undefined) out.kind = ov.kind
  if (ov.endFrame !== undefined) out.endFrame = ov.endFrame
  if (ov.priority !== undefined) out.priority = ov.priority
  if (ov.cancelWindows !== undefined) out.cancelWindows = ov.cancelWindows.map(w => ({ ...w, row: 0 }))   // row 0 = 手写
  if (ov.outroTriggerFrame !== undefined) out.outroTriggerFrame = ov.outroTriggerFrame
  if (ov.switchLockUntil !== undefined) out.switchLockUntil = ov.switchLockUntil
  if (ov.comboFrom !== undefined) out.comboFrom = ov.comboFrom
  if (ov.cooldown !== undefined) out.cooldown = ov.cooldown
  if (ov.cooldownGroup !== undefined) out.cooldownGroup = ov.cooldownGroup
  const jov = ov.judgments ?? {}
  for (const n of Object.keys(jov))
    if (!def.judgments.some(j => j.name === n)) throw new Error(`${def.owner} ${def.id} 的 judgments 覆盖写了不存在的判定"${n}"`)
  out.judgments = def.judgments.map(j => {
    const o = jov[j.name]
    const handled = new Set(accepted)
    for (const k of Object.keys(o ?? {})) (J_HANDLED[k] ?? []).forEach(f => handled.add(f))
    return { ...j, ...o, flags: j.flags.filter(f => !handled.has(f)) }
  })
  out.judgments.sort((a, b) => (a.spawnFrame ?? Infinity) - (b.spawnFrame ?? Infinity))
  out.flags = def.flags.filter(f => !accepted.has(f))
  return out
}

/** 原型用组名推 kind；正式实现先看 dmg 的 Damage.Type（TD-01 §13.1） */
function kindOf(id: string): ActionKind {
  if (id.includes('闪避反击')) return 'normal'
  if (id.includes('闪避')) return 'dodge'
  if (id.startsWith('QTE')) return 'intro'
  if (id.startsWith('延奏')) return 'outro'
  if (id.startsWith('大招')) return 'liberation'
  if (id.startsWith('E')) return 'skill'
  if (id.includes('重击')) return 'heavy'
  if (/A\d/.test(id) || id.includes('普攻')) return 'normal'
  return 'other'
}
