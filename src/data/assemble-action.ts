// src/data/assemble-action.ts —— 生成数据的动作组 → ActionDef（TD-01 §13.1 / §13.2，按 TD-04 §7 修订）
// 时间字段（结束帧、派生窗口、优先级、膨胀…）与伤害 / 资源字段（倍率、元素、标签、资源、削韧、castGains）都按 TD-01 §13 装配。
// 另有两步：角色模块的 actionOverrides（TD-01 §13.4），按共鸣链数挑判定 forChain（总设计 §3.3 第 4 步）。
import { DAMAGE_TAG_BY_TYPE, ELEMENT_BY_CODE } from './common'
import type { ActionId, ActionKind, DamageTag, DilationSide, Element, ResourceKind } from './common'
import type { ActionOverride } from './define'
import type { GainCell, GenActionFile, GenGroup, GenRow } from './generated.schema'
import type {
  ActionDef, CancelWindow, CastGain, ChainRange, DilationDef, DilationWindow, InputLock, JudgmentDef, PriorityStep,
} from './gamedata'

const SIDES: DilationSide[] = ['self', 'enemy', 'ally']

export interface AssembleOptions {
  element?: Element                         // 没连上 dmg 的判定用角色元素（TD-01 §13.2）；缺省物理
  charNames?: ReadonlySet<string>           // 命中类型写成角色名的判定算友方
  kind?: ActionKind                         // 指定动作类别，不推断（声骸动作一律 'echo'，TD-01 §13.3）
  tuneTicks?: Readonly<Record<string, number>>   // 谐度破坏变体的结算次数（tune-break.json：'谐度破坏-迅刀1' → 4，TD-06 §13.3）
}

/** 装配一个块。overrides = 角色模块的 actionOverrides；写了块里不存在的动作 / 行 / 判定直接报错 */
export function assembleBlock(
  file: GenActionFile, overrides: Record<ActionId, ActionOverride> = {}, opts: AssembleOptions = {},
): Record<string, ActionDef> {
  const ids = new Set(file.groups.map(g => g.id))
  // splitRows：拆出的行自成一个动作，动作 ID 就是行名（维里奈 A3 组里的"A3-地面出场技"）；copyAs：整组另存为新动作（椿的地面出场技 = A2）。
  // 先登记新动作，它们也能写覆盖
  const fresh = (g: GenGroup, field: string, n: string) => {
    if (ids.has(n)) throw new Error(`${file.key} ${g.id} 的 ${field}："${n}"与已有的动作重名`)
    ids.add(n)
  }
  for (const g of file.groups) {
    for (const n of overrides[g.id]?.splitRows ?? []) {
      if (!g.rows.some(r => r.name === n)) throw new Error(`${file.key} ${g.id} 的 splitRows 写了不存在的行"${n}"`)
      fresh(g, 'splitRows', n)
    }
    for (const n of overrides[g.id]?.copyAs ?? []) fresh(g, 'copyAs', n)
    for (const n of Object.keys(overrides[g.id]?.shiftRows ?? {}))
      if (!g.rows.some(r => r.name === n)) throw new Error(`${file.key} ${g.id} 的 shiftRows 写了不存在的行"${n}"`)
  }
  for (const id of Object.keys(overrides))
    if (!ids.has(id)) throw new Error(`${file.key} 的 actionOverrides 写了不存在的动作"${id}"`)
  const out: Record<string, ActionDef> = {}
  const put = (def: ActionDef) => { const ov = overrides[def.id]; out[def.id] = ov ? applyOverride(def, ov) : def }
  for (const g0 of file.groups) {
    const shift = overrides[g0.id]?.shiftRows
    const g = shift ? { ...g0, rows: g0.rows.map(r => (shift[r.name] !== undefined ? shiftRow(r, shift[r.name]!) : r)) } : g0
    const split = overrides[g.id]?.splitRows ?? []
    const drop = [...(overrides[g.id]?.dropRows ?? []), ...split]
    const later = shift !== undefined
    put(assembleGroup(file, g, ids, opts, drop, later))
    for (const n of split) put(assembleGroup(file, { id: n, rows: g.rows.filter(r => r.name === n) }, ids, opts, [], later))
    for (const n of overrides[g.id]?.copyAs ?? []) put(assembleGroup(file, { id: n, rows: g.rows }, ids, opts, drop, later))
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
  const ok = (r?: ChainRange) => !r || (chain >= r.min && chain <= r.max)
  const out: Record<ActionId, ActionDef> = {}
  for (const [id, a] of Object.entries(actions)) {
    const keep = a.judgments.filter(j => ok(j.chainRange))
    const gains = a.castGains.filter(g => ok(g.chainRange))      // 施放资源跟随判定行的版本（TD-06 §1）
    out[id] = keep.length === a.judgments.length && gains.length === a.castGains.length ? a : { ...a, judgments: keep, castGains: gains }
  }
  return out
}

/** 落地段的一行（ActionOverride.shiftRows）：帧数从落地起算，整体后移 offset 帧 */
function shiftRow(r: GenRow, offset: number): GenRow {
  const add = (x: number | null): number | null => (x === null ? null : x + offset)
  const hints = { ...r.hints }
  for (const k of ['outroTriggerFrame', 'endOnSwitchAfter', 'noDodgeBefore', 'noInputBefore', 'noSwitchBefore'] as const)
    if (hints[k] !== undefined) hints[k] = hints[k]! + offset
  if (hints.priorityChangeFrames) hints.priorityChangeFrames = hints.priorityChangeFrames.map(f => f + offset)
  const d = r.dilation
  const side = (w: NonNullable<GenRow['dilation']>['self']) => (w ? { ...w, start: add(w.start) } : w)
  return {
    ...r, spawnFrame: add(r.spawnFrame), birthFrame: add(r.birthFrame), endFrame: add(r.endFrame), deriveFrame: add(r.deriveFrame),
    priorityChange: r.priorityChange?.map(f => f + offset) ?? null, hints,
    dilation: d && { ...d, ...(d.self ? { self: side(d.self) } : {}), ...(d.enemy ? { enemy: side(d.enemy) } : {}), ...(d.ally ? { ally: side(d.ally) } : {}) },
  }
}

/** 一组 → 一个动作（TD-01 §13.1）。file 只用 key（报错与来源）；ids 是块内全部组名（推连段前置用）；
 *  laterEnd：有落地段（shiftRows）时结束帧取各行的最大值，而不是第一个有值的行 */
export function assembleGroup(
  file: Pick<GenActionFile, 'key'>, g: Pick<GenGroup, 'id' | 'rows'>, ids: ReadonlySet<string>, opts: AssembleOptions, dropRows: string[] = [],
  laterEnd = false,
): ActionDef {
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

  // 结束帧：第一个有值的行（有落地段时取最大值）；都没有则 max(发生帧 + 持续帧, 派生帧)
  const ends = rows.flatMap(r => (r.endFrame !== null ? [r.endFrame] : []))
  let endFrame = laterEnd && ends.length > 0 ? Math.max(...ends) : ends[0] ?? null
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
  const kind = opts.kind ?? kindOfGroup(g.id, rows, flags)

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
    const d0 = r.dilation
    if (!d0) continue
    // 类型那一格空着、但各侧系数都是 0（雷主·男 / 女、穗穗、秧秧·玄翎的"大招-全局时停""大招-前置"）：行名带"全局时停"的按全局时停，
    // 其余按时停；推断，记 dilationTypeGuess（2026-10-22 发现：雷主大招 224 帧的全局时停原来整个丢了，WuwaLAB 也记 time_stop 224）。
    // 系数不是 0 的（洛可可 强化空中A1-下落 0.1）认不出，跳过、记 dilationTypeMissing
    let d = d0
    if (!d0.type) {
      const ws = SIDES.map(s => d0[s]).filter(w => !!w)
      if (ws.length === 0) continue
      if (!ws.every(w => w!.rate === 0)) { flags.add('dilationTypeMissing'); continue }
      d = { ...d0, type: r.name.includes('全局时停') ? '全局时停' : '时停' }
      flags.add('dilationTypeGuess')
    }
    if (!d.type) continue
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
    // 谐度破坏：连到通用块变体的判定按谐度破坏表的结算次数（迅刀第一段 × 4），在寿命内均分（TD-06 §13.3）
    const tuneTicks = r.dmg?.charaId === '通用' ? opts.tuneTicks?.[r.dmg.skillName] : undefined
    const ticks = tuneTicks !== undefined && tuneTicks > 1 ? tuneTicks : r.hints.maxTicks ?? (iv !== null && life > 0 ? Math.ceil(life / iv) : 1)
    const jf: string[] = []
    if (r.lifeFrames === null) jf.push('noLife')
    if (r.hints.maxTicks === undefined && iv !== null) jf.push('ticksGuess')
    if (iv !== null && life > 0 && (ticks - 1) * iv >= life) jf.push('ticksCapped')   // 寿命内放不下全部次数（TD-04 §5.2）
    if (r.persists === null && life !== -1) jf.push('persistsGuess')
    const ch = chains.get(r)
    if (ch?.additive) jf.push('chainAdditive')
    const dmgFields = judgmentDamage(r, kind, opts, jf)
    return {
      name: n > 1 ? `${r.name}#${n}` : r.name,
      row: r.row,
      spawnFrame: r.eventSpawned ? null : r.spawnFrame,
      birthFrame: r.birthFrame,
      lifeFrames: life,
      ...(r.delayFrames ? { delayFrames: r.delayFrames } : {}),   // 生成后过这么多帧才第一次结算（附页1"延迟"）
      ticks,
      tickInterval: iv,
      persistsOnCancel: life === -1 ? false : (r.persists ?? true),
      // 谐度破坏在自己的全局时停里打完：判定随施放者的时钟走（战斗时钟停着，迅刀第一段的 4 次结算也在演出里，TD-06 §13.3）
      followHitstop: r.followHitstop === true || kind === 'tuneBreak',
      ...dmgFields,
      hitstop: hitstopOf.get(r) ?? null,
      ...(ch ? { chainRange: ch.range } : {}),
      flags: jf,
    }
  })
  judgments.sort((a, b) => (a.spawnFrame ?? Infinity) - (b.spawnFrame ?? Infinity))
  if (judgments.some(j => j.lifeFrames === -1 && j.spawnFrame !== null && j.spawnFrame >= endFrame!)) flags.add('minusOneAfterEnd')   // 动作停了才出现，永远不会生成（TD-04 §4.3）

  const outroRow = rows.find(r => r.hints.outroTriggerFrame !== undefined)
  const outro = outroRow?.hints.outroTriggerFrame
  if (outroRow?.hints.outroRange) flags.add('outroRange')        // 区间写法取了起点（TD-05 §4.1）
  // 谐度破坏的备注"无敌期间不能切人"：按整个动作算（TD-06 §13.3）。
  // 大招没写"第nF前不能切人"时，"第nF前不响应输入"也挡切人：大招出招阶段不能切人（2026-10-19 用户的实战体感，待实机验证，
  // 假设 ult-no-switch）。写了的照写的（仇远"不能切人"200 早于"不响应输入"230，凌阳 210 晚于 180）；变奏另有"不能切人"，不套
  // 2026-10-21：没写帧数的"无敌期间不能切人"（不是谐度破坏的），锁到无敌结束 = 无敌启动帧 + 无敌持续帧（取组内最大）；
  // 无敌持续帧是空的（心 转相）记 invincibleNoFrames，由角色模块写 switchLockUntil。
  // 其余没写帧数的"不能切人"（noSwitchUnframed：布兰特、菲比大招"不响应输入，不能切人"…）同样处理，没有无敌帧的到动作结束；
  // 都是推断，记 noSwitchUnframed（假设 switch-no-lock）
  const invRows = kind === 'tuneBreak' ? [] : rows.filter(r => r.hints.noSwitchWhileInvincible || r.hints.noSwitchUnframed)
  if (invRows.some(r => r.hints.noSwitchUnframed)) flags.add('noSwitchUnframed')
  // 无敌持续帧 −1 = 到动作结束（奥古斯塔大招、珂莱塔 E…）
  const invEnds = invRows.flatMap(r => {
    const v = r.invincible
    if (v?.start == null || v.duration == null) return []
    if (v.duration === -1) return endFrame !== null ? [endFrame] : []
    return [v.start + v.duration]
  })
  if (invRows.length > 0 && invEnds.length === 0) {
    if (invRows.every(r => r.hints.noSwitchUnframed) && endFrame !== null) invEnds.push(endFrame)
    else flags.add('invincibleNoFrames')
  }
  const noSwitch = maxHint('noSwitchBefore') ?? (invEnds.length ? Math.max(...invEnds) : null)
  const lockFromInput = noSwitch === null && kind === 'liberation' && noInput !== null && invRows.length === 0
  const switchLock = noSwitch ?? (kind === 'tuneBreak' ? endFrame : lockFromInput ? noInput : null)
  // 全局时停（大招动画、隐藏 HUD）：按动作局部帧登记的那段结束前，什么都按不了，也切不了人（调度器单独挡，不受切人锁开关影响）
  const stopEnds = dilations.filter(x => x.type === '全局时停' && x.anchor === 'action')
    .map(x => x.start + Math.max(...SIDES.map(s => x[s]?.duration ?? 0)))
  const globalStop = stopEnds.length ? Math.max(...stopEnds) : null
  const endOnSwitch = rows.find(r => r.hints.endOnSwitchAfter !== undefined)?.hints.endOnSwitchAfter
  const air = airOf(rows, endFrame, flags)
  return {
    id: g.id, owner: file.key, kind, endFrame, cancelWindows, priority,
    ...(comboFrom ? { comboFrom } : {}),
    inputLocks, judgments, dilations, castGains: castGainsOf(rows, chains),
    ...(outro !== undefined ? { outroTriggerFrame: outro } : {}),
    ...(switchLock !== null ? { switchLockUntil: switchLock } : {}),
    ...(lockFromInput ? { switchLockFromInput: true as const } : {}),
    ...(globalStop !== null ? { globalStopUntil: globalStop } : {}),
    ...(invRows.length > 0 && maxHint('noSwitchBefore') === null ? { switchLockFromInvincible: true as const } : {}),
    ...(g.id.endsWith('出场技') ? { entrySkill: true as const } : {}),
    ...(air ? { air } : {}),   // "A2-地面出场技"（散华单列一组，维里奈 splitRows、椿 copyAs 的也是）
    ...(endOnSwitch !== undefined ? { endOnSwitchOut: endOnSwitch } : {}),
    source: { file: file.key, rows: g.rows.map(r => r.row) },
    flags: [...flags],
  }
}

/** 在空中的局部帧（xlsx「位置状态」「状态转换时间」，2026-10-21，TD-09 §3.5 出场技要从地面切入）：
 *  第一行以"空"开头 → 从 0 起在空中；否则第一个"…转空 / 转漂浮"的行从它的状态转换时间起（没写取它的发生帧，打 airGuess），
 *  只有"空中"行接在地面行后面的，从那行的发生帧起（airGuess）。最后一行以"空中 / 转空 / 漂浮"结尾 → 结束时还在空中（until = null）；
 *  否则落地在"空转地"的最后一个转换时间；空中之后接地面行（"…落地"段，它的帧从落地算，xlsx 没给落地时刻）的按动作结束算；都没有打 airGuess */
function airOf(rows: GenRow[], endFrame: number, flags: Set<string>): ActionDef['air'] {
  const ps = rows.filter(r => r.position)
  if (!ps.some(r => /空|漂浮/.test(r.position!))) return undefined
  const at = (r: GenRow) => r.spawnFrame ?? r.birthFrame ?? 0
  let from = 0
  if (!ps[0]!.position!.startsWith('空')) {
    const up = ps.find(r => /转(空|漂浮)/.test(r.position!))
    const first = ps.find(r => r.position!.startsWith('空'))
    if (up?.positionChange?.length) from = up.positionChange[0]!
    else { from = at((up ?? first)!); flags.add('airGuess') }
  }
  const last = ps.at(-1)!.position!
  if (/(空中|转空|漂浮)$/.test(last)) return { from, until: null }
  const down = ps.find(r => /空转地/.test(r.position!))
  if (down?.positionChange?.length) return { from, until: down.positionChange.at(-1)! }
  if (!down && ps.at(-1)!.position === '地面') return { from, until: Math.max(from, endFrame) }
  flags.add('airGuess')
  return { from, until: Math.max(from, endFrame) }
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
  shiftRows: ['multiEnd'],                  // 落地段的结束帧本来就与下落段不同
  cancelWindows: ['deriveMinus1'], outroTriggerFrame: ['noOutroFrame', 'outroRange'], switchLockUntil: ['invincibleNoFrames', 'noSwitchUnframed'],
}
const J_HANDLED: Record<string, string[]> = {
  lifeFrames: ['noLife'], ticks: ['ticksGuess', 'ticksCapped'], persistsOnCancel: ['persistsGuess'], multiplier: ['noDmg'],
  chainRange: ['chainAdditive'], relatedAttr: ['relatedAttrOther'],
}

export function applyOverride(def: ActionDef, ov: ActionOverride): ActionDef {
  const accepted = new Set(ov.accept ?? [])
  for (const [field, fl] of Object.entries(HANDLED)) if (ov[field as keyof ActionOverride] !== undefined) fl.forEach(f => accepted.add(f))
  const out: ActionDef = { ...def }
  if (ov.kind !== undefined) out.kind = ov.kind
  if (ov.endFrame !== undefined) out.endFrame = ov.endFrame
  if (ov.priority !== undefined) out.priority = ov.priority
  if (ov.cancelWindows !== undefined) out.cancelWindows = ov.cancelWindows.map(w => ({ ...w, row: 0 }))   // row 0 = 手写
  if (ov.outroTriggerFrame !== undefined) out.outroTriggerFrame = ov.outroTriggerFrame
  if (ov.switchLockUntil !== undefined) { out.switchLockUntil = ov.switchLockUntil; delete out.switchLockFromInput }   // 手写的不再算推断
  if (ov.energyCost !== undefined) out.energyCost = ov.energyCost
  if (ov.endOnSwitchOut !== undefined) out.endOnSwitchOut = ov.endOnSwitchOut
  if (ov.followUp !== undefined) out.followUp = ov.followUp
  if (ov.comboFrom !== undefined) out.comboFrom = ov.comboFrom
  if (ov.cooldown !== undefined) out.cooldown = ov.cooldown
  if (ov.cooldownGroup !== undefined) out.cooldownGroup = ov.cooldownGroup
  if (ov.charges !== undefined) out.charges = ov.charges
  if (ov.summon !== undefined) out.summon = ov.summon
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

// ---------------------------------------------------------------------------
// 伤害与资源字段（TD-01 §13.1 kind / castGains，§13.2 判定）

/** dmg Skill.Type（技能归类）→ 动作类别（TD-07 §4.3 修订 TD-01 §13.1）：施放什么技能看技能归类，伤害标签才看 Damage.Type。
 *  椿的 E1 / E2 / E3 是共鸣技能（2），伤害类型却是普攻（0）。其余代码不决定类别、按组名推：延奏组散在 8 / 9 / 12 / 13 里，
 *  而 12 里也有赞妮"E1-精准反击前置"、丽贝卡"待机"这类非延奏的组 */
const KIND_BY_SKILL_TYPE: Readonly<Record<number, ActionKind>> = {
  0: 'normal', 1: 'heavy', 2: 'skill', 3: 'liberation', 4: 'intro', 5: 'normal', 14: 'tuneBreak',
}
/** 没连上 dmg 的判定按动作类别推标签 */
const TAG_BY_KIND: Readonly<Record<ActionKind, DamageTag>> = {
  normal: '普攻', heavy: '重击', skill: '共鸣技能', liberation: '共鸣解放', intro: '变奏', outro: '延奏', echo: '声骸技能',
  dodge: '其他', tuneBreak: '谐度破坏', other: '其他',
}
const ENEMY_TARGETS = new Set(['目标', '目标子弹', '指定目标', '弹刀目标'])
const ALLY_TARGETS = new Set(['友方', '队伍', '目标队友'])
const ATTR_BY_PROP: Readonly<Record<number, JudgmentDef['relatedAttr']>> = { 7: 'atk', 2: 'hp', 10: 'def', 11: 'energyRegen' }
const TUNE_BASE_PROP = 10000099                   // dmg RelatedProperty：谐度破坏基础值（TD-01 §4.1）
const CALC_BY_TYPE = ['damage', 'heal', 'hpCost'] as const

/** 组内第一个连上 dmg 的判定的技能归类决定类别；都没有则按组名前缀；再没有 → other，打 kindGuess */
function kindOfGroup(id: string, rows: GenRow[], flags: Set<string>): ActionKind {
  for (const r of rows) {
    const t = r.kind === 'hit' ? r.dmg?.skillType : undefined
    const k = t !== undefined && t !== null ? KIND_BY_SKILL_TYPE[t] : undefined
    if (k) return k
  }
  const k = kindOf(id)
  if (k === 'other') flags.add('kindGuess')
  return k
}

/** 按组名推类别（没有 dmg 可看时） */
function kindOf(id: string): ActionKind {
  if (id.startsWith('谐度破坏')) return 'tuneBreak'
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

function targetOf(r: GenRow, opts: AssembleOptions, jf: string[]): JudgmentDef['target'] {
  const t = r.hitTarget?.trim() ?? ''
  if (t === '' || ENEMY_TARGETS.has(t)) return 'enemy'
  if (ALLY_TARGETS.has(t) || opts.charNames?.has(t)) return 'ally'
  if (t === '无') return 'none'
  jf.push('targetOther')
  return 'other'
}

/** 每次结算发放的资源：普通数字取 total；公式按"逐段命中"项取（只有一项取它，多项取平均），起手即得的项（公式末项常数，原作者说"进入该动作就获得"）归 castGains。
 *  事件生成的判定（E-引爆冰棱…）不随动作施放，它的"起手即得"项在它结算时一起发（总设计 §6.7） */
function perHit(cell: GainCell | null, r: GenRow, jf: string[]): number {
  if (!cell) return 0
  const onSpawn = r.eventSpawned ? cell.onAction ?? 0 : 0
  if (!cell.perHit) return cell.onAction !== undefined ? onSpawn : cell.total
  if (cell.perHit.length > 1 && !jf.includes('gainTermsMulti')) jf.push('gainTermsMulti')
  return cell.perHit.reduce((a, b) => a + b, 0) / cell.perHit.length + onSpawn
}

type DamageFields = Pick<JudgmentDef,
  'target' | 'calc' | 'multiplier' | 'relatedAttr' | 'element' | 'tags' | 'gains' | 'gauges' | 'formula' | 'cureBase' | 'coreOncePerAction'>

/** 判定的伤害与资源字段（TD-01 §13.2）。没连上 dmg、明确无伤害（dmg-join 为 null、dmgNoConfig）、治疗 / 扣血、非敌方、
 *  备注"无伤害"的判定倍率为 0；伤害型判定没连上的，构建时已在行上打了 noDmg */
function judgmentDamage(r: GenRow, kind: ActionKind, opts: AssembleOptions, jf: string[]): DamageFields {
  const target = targetOf(r, opts, jf)
  const d = r.dmg
  if (r.flags.includes('noDmg')) jf.push('noDmg')
  let relatedAttr: JudgmentDef['relatedAttr'] = 'atk'
  if (d) {
    const a = ATTR_BY_PROP[d.relatedProperty]
    if (a) relatedAttr = a
    else if (d.relatedProperty !== TUNE_BASE_PROP) jf.push('relatedAttrOther')   // 谐度破坏基础值：走谐度破坏公式（TD-03 §6），不看属性
  }
  const calc = d ? CALC_BY_TYPE[d.calcType] : 'damage'
  const damaging = d !== undefined && d.calcType === 0 && target === 'enemy' && !r.hints.noDamage
  const core = r.gains.core
  const shared = core.map(c => c?.sharedRows !== undefined) as [boolean, boolean, boolean]
  // 连 nanoka 的声骸判定：能量、削韧也按 nanoka（xlsx 的声骸数值偏旧，两边不同时以 nanoka 为准，2026-10-04 用户确认）
  const nk = d?.via === 'nanoka' ? d : undefined
  return {
    target, calc, relatedAttr,
    multiplier: damaging ? d.multiplier : 0,
    element: d ? ELEMENT_BY_CODE[d.element] ?? '物理' : opts.element ?? '物理',
    tags: [d ? DAMAGE_TAG_BY_TYPE[d.damageType] ?? '其他' : TAG_BY_KIND[kind]],
    gains: {
      energy: nk ? (nk.energy ?? 0) / 100 : perHit(r.gains.energy, r, jf),
      concerto: perHit(r.gains.concerto, r, jf),
      core: [perHit(core[0], r, jf), perHit(core[1], r, jf), perHit(core[2], r, jf)],
    },
    gauges: {
      toughness: nk ? (nk.toughLv ?? 0) / 100 : r.toughness ?? 0, tunability: r.tunability ?? 0,
      ...(d?.whiteBarRatio ? { whiteBarRatio: d.whiteBarRatio } : {}),                 // 按比例削白条（m0-confirm §10 H3）
    },
    ...(d && d.formulaType !== 0 ? { formula: { type: d.formulaType, rate: d.formulaRate ?? 0 } } : {}),
    ...(d?.cureBase !== undefined ? { cureBase: d.cureBase } : {}),
    ...(shared.some(Boolean) ? { coreOncePerAction: shared } : {}),
  }
}

const RESOURCE_OF = { energy: 'energy', concerto: 'concerto' } as const
/** 施放类资源：组内资源行（gain）的合计，加上判定行资源公式里"进入动作即得"的项；都在进入动作的那一刻发放（TD-01 §13.1）。
 *  事件生成的判定不算在内（见 perHit）；带共鸣链版本的判定行，它的项单列并带上 chainRange，由 forChain 筛（TD-06 §1） */
function castGainsOf(rows: GenRow[], chains: Map<GenRow, { range: ChainRange }>): CastGain[] {
  const sums = new Map<string, CastGain>()
  const add = (k: ResourceKind, v: number | undefined, range?: ChainRange) => {
    if (!v) return
    const key = `${k}|${range ? `${range.min}-${range.max}` : ''}`
    const g = sums.get(key)
    if (g) g.amount += v
    else sums.set(key, { atFrame: 0, resource: k, amount: v, ...(range ? { chainRange: range } : {}) })
  }
  for (const r of rows) {
    const cells: [ResourceKind, GainCell | null][] = [
      [RESOURCE_OF.energy, r.gains.energy], [RESOURCE_OF.concerto, r.gains.concerto],
      ['core1', r.gains.core[0]], ['core2', r.gains.core[1]], ['core3', r.gains.core[2]],
    ]
    for (const [k, c] of cells) {
      if (!c) continue
      if (r.kind === 'gain') add(k, c.total)
      else if (r.kind === 'hit' && !r.eventSpawned) add(k, c.onAction, chains.get(r)?.range)
    }
  }
  return [...sums.values()]
}
