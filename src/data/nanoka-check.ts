// src/data/nanoka-check.ts —— 拿 nanoka 核对角色模块手填的冷却与技能树属性（m0-confirm §5、TD-01 §12.5）
// 只提示、不自动填：共用冷却（椿 E1 / E2）、跟随动作（散华 大招-引爆冰川）这些没法从 nanoka 推出来，由人写进角色模块。
import { STAT_KEYS, type ActionId, type StatKey } from './common'
import type { ActionDef } from './gamedata'
import type { NanokaCharacter } from './generated.schema'

/** nanoka 技能类型 → 排轴别名：这个别名指向的动作应当有该技能的"冷却时间" */
const TYPE_ALIAS: Record<string, string> = { 共鸣技能: 'E', 共鸣解放: 'R' }

const sec = (f: number): string => `${f / 60} 秒（${f} 帧）`

export function checkCooldowns(
  acts: Record<ActionId, ActionDef>, aliases: Record<string, ActionId>, nk: NanokaCharacter,
): string[] {
  const out: string[] = []
  for (const s of nk.skills) {
    const alias = TYPE_ALIAS[s.type]
    const cd = s.cooldowns.find(c => c.name === '冷却时间')
    const id = alias && aliases[alias]
    if (!cd || !id || !acts[id]) continue
    const have = acts[id].cooldown
    if (have === undefined) out.push(`${id}（${alias}）没有冷却；nanoka ${s.type}「${s.name}」冷却时间 ${sec(cd.frames)}`)
    else if (have !== cd.frames) out.push(`${id}（${alias}）冷却 ${sec(have)}，nanoka ${s.type}「${s.name}」是 ${sec(cd.frames)}`)
  }
  const known = new Set(nk.skills.flatMap(s => s.cooldowns.map(c => c.frames)))
  for (const a of Object.values(acts)) {
    if (a.kind === 'echo' || a.cooldown === undefined || known.has(a.cooldown)) continue
    const list = nk.skills.flatMap(s => s.cooldowns.map(c => `${s.type}·${c.name} ${c.seconds} 秒`)).join('、') || '无'
    out.push(`${a.id} 冷却 ${sec(a.cooldown)}，nanoka 里没有这个数（有：${list}）`)
  }
  return out
}

/** nanoka 技能树节点名 → 属性键："攻击提升" → 攻击%，"冷凝伤害加成提升" → 冷凝伤害加成 */
export function treeStatKey(name: string): StatKey | undefined {
  const base = name.replace(/提升$/, '')
  const pct: Record<string, StatKey> = { 攻击: '攻击%', 生命: '生命%', 防御: '防御%', 暴击: '暴击率' }
  if (pct[base]) return pct[base]
  return (STAT_KEYS as readonly string[]).includes(base) ? (base as StatKey) : undefined
}

/** 角色模块的 treeStats 与 nanoka 技能树属性节点对不上的地方 */
export function checkTreeStats(have: Partial<Record<StatKey, number>>, nk: NanokaCharacter): string[] {
  const out: string[] = []
  const want: Partial<Record<StatKey, number>> = {}
  for (const [name, v] of Object.entries(nk.treeStats)) {
    const k = treeStatKey(name)
    if (!k) { out.push(`nanoka 技能树节点"${name}"认不出是哪个属性`); continue }
    want[k] = (want[k] ?? 0) + v
  }
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9
  for (const k of new Set([...Object.keys(want), ...Object.keys(have)] as StatKey[])) {
    const a = have[k] ?? 0, b = want[k] ?? 0
    if (!close(a, b)) out.push(`技能树 ${k}：角色模块 ${a}，nanoka ${b}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// 倍率的段数、协奏、大招能量（docs/engine-quality-plan.md P5）。
// 倍率本身是 dmg 表连上的、和解包对过；这里查的是"连到哪个动作、几下"：漏掉的判定（椿 E2 第 4 下那种）、
// 多出来的判定、技能的协奏合计与 nanoka 写的不同。只提示，由人判断是不是同一个技能

/** "25.58%*2+71.58%" → 倍率（小数）→ 下数；认不出（治疗量"950+23.80%"等）返回 null */
export function parseParts(text: string): Map<number, number> | null {
  const out = new Map<number, number>()
  for (const part of text.split('+')) {
    const m = /^\s*([\d.]+)%(?:\*(\d+))?\s*$/.exec(part)
    if (!m) return null
    const v = Math.round(Number(m[1]) * 100) / 10000
    out.set(v, (out.get(v) ?? 0) + Number(m[2] ?? 1))
  }
  return out
}

const pct = (v: number): string => `${Math.round(v * 1e6) / 1e4}%`
const atChain0 = (j: { chainRange?: { min: number; max: number } }): boolean => !j.chainRange || j.chainRange.min === 0
/** 动作在 0 链时各倍率的下数（判定结算次数合计；不造成伤害的不算） */
function hitsOf(a: ActionDef): Map<number, number> {
  const out = new Map<number, number>()
  for (const j of a.judgments) {
    if (j.calc !== 'damage' || j.multiplier === 0 || !atChain0(j)) continue
    const v = Math.round(j.multiplier * 10000) / 10000
    out.set(v, (out.get(v) ?? 0) + j.ticks)
  }
  return out
}
/** 动作在 0 链时起手即得的协奏 */
const castConcerto = (a: ActionDef): number =>
  a.castGains.filter(g => g.resource === 'concerto' && (!g.chainRange || g.chainRange.min === 0)).reduce((s, g) => s + g.amount, 0)
/** 动作在 0 链时的协奏合计：起手即得 + 各判定每次结算 × 次数 */
export const concertoOf = (a: ActionDef): number =>
  castConcerto(a) + a.judgments.filter(atChain0).reduce((s, j) => s + j.gains.concerto * j.ticks, 0)

interface Entry { type: string; name: string; text: string; want: Map<number, number> }
interface Match { entry: Entry; best: ActionDef | null; partner: ActionDef | null; matched: number; total: number }

function damageEntries(nk: NanokaCharacter): Entry[] {
  return nk.skills.flatMap(s => s.values.flatMap(v => {
    if (!v.name.endsWith('伤害')) return []
    const want = parseParts(v.text)
    return want ? [{ type: s.type, name: v.name, text: v.text, want }] : []
  }))
}

/** nanoka 技能类型 → 动作类别：倍率相同时优先类别对得上的动作（维里奈变奏与强化重击的冲撞都是 99.41%） */
const TYPE_KINDS: Record<string, string[]> = {
  常态攻击: ['normal', 'heavy'], 共鸣技能: ['skill'], 共鸣解放: ['liberation'], 变奏技能: ['intro'],
}
/** nanoka 不列倍率的类别：延奏、谐度破坏的伤害写在说明里或在通用块 */
const UNLISTED = new Set(['outro', 'tuneBreak', 'echo'])

/** 每个伤害条目找下数对上最多的动作；一个动作对不全时，看剩下的能不能由另一个动作补齐（雷主地面短E 自动派生剑止万律2） */
function matchEntries(acts: ActionDef[], nk: NanokaCharacter): Match[] {
  const hits = new Map(acts.map(a => [a, hitsOf(a)]))
  const count = (want: Map<number, number>, h: Map<number, number>) => [...want].reduce((m, [v, n]) => m + Math.min(n, h.get(v) ?? 0), 0)
  return damageEntries(nk).map(entry => {
    const total = [...entry.want.values()].reduce((s, n) => s + n, 0)
    const kinds = TYPE_KINDS[entry.type]
    let best: ActionDef | null = null, matched = 0, score = 0
    for (const a of acts) {
      const m = count(entry.want, hits.get(a)!)
      const sc = m * 2 + (kinds?.includes(a.kind) ? 1 : 0)
      if (m > 0 && sc > score) { best = a; matched = m; score = sc }
    }
    let partner: ActionDef | null = null
    if (best && matched < total) {
      const h = hits.get(best)!
      const rest = new Map([...entry.want].map(([v, n]) => [v, n - Math.min(n, h.get(v) ?? 0)] as const).filter(([, n]) => n > 0))
      const restTotal = [...rest.values()].reduce((s, n) => s + n, 0)
      partner = acts.find(a => a !== best && count(rest, hits.get(a)!) === restTotal) ?? null
      if (partner) matched = total
    }
    return { entry, best, partner, matched, total }
  })
}

/** 伤害条目的段数：nanoka 写了 n 下，最接近的动作只有 k 下；反过来，我们的判定倍率 nanoka 哪个条目都没有 */
export function checkHits(acts: Record<ActionId, ActionDef>, nk: NanokaCharacter): string[] {
  const list = Object.values(acts).filter(a => !UNLISTED.has(a.kind))
  const out: string[] = []
  for (const { entry, best, matched, total } of matchEntries(list, nk)) {
    if (matched === total) continue
    const label = `nanoka ${entry.type}「${entry.name}」${entry.text}`
    if (!best) { out.push(`${label}：没有哪个动作的判定是这些倍率`); continue }
    const h = hitsOf(best)
    const miss = [...entry.want].filter(([v, n]) => (h.get(v) ?? 0) < n).map(([v, n]) => `${pct(v)} 少 ${n - (h.get(v) ?? 0)} 下`)
    out.push(`${label}：最接近的是 ${best.id}，${matched}/${total} 下（${miss.join('、')}）`)
  }
  const known = new Set(damageEntries(nk).flatMap(e => [...e.want.keys()]))
  for (const a of list) {
    for (const [v] of hitsOf(a)) {
      if (known.has(v)) continue
      const js = a.judgments.filter(j => j.calc === 'damage' && Math.round(j.multiplier * 10000) / 10000 === v).map(j => j.name)
      out.push(`${a.id}「${js.join('、')}」倍率 ${pct(v)}：nanoka 的伤害条目里没有`)
    }
  }
  return out
}

/** 协奏："X回复协奏能量"对应同一技能的"X伤害"（X 为空时是"技能伤害"或该技能唯一的伤害条目）下数对上的动作；
 *  对不上倍率的（维里奈变奏本身不出伤害、冲撞是派生动作）按别名找：共鸣技能 E、共鸣解放 R、变奏技能 intro 类的动作。
 *  nanoka 的数是施放时给的那部分：动作的起手即得或合计（含命中给的）任一相等就算对上 */
export function checkConcerto(acts: Record<ActionId, ActionDef>, aliases: Record<string, ActionId>, nk: NanokaCharacter): string[] {
  const list = Object.values(acts).filter(a => !UNLISTED.has(a.kind))
  const matches = matchEntries(list, nk).filter(m => m.matched === m.total && m.best)
  const out: string[] = []
  const r2 = (x: number) => Math.round(x * 100) / 100
  for (const s of nk.skills) {
    for (const v of s.values) {
      if (!v.name.endsWith('回复协奏能量')) continue
      const want = Number(v.text)
      const prefix = v.name.slice(0, -'回复协奏能量'.length)
      const own = matches.filter(m => m.entry.type === s.type)
      const m = own.find(x => x.entry.name === `${prefix}伤害`)
        ?? (prefix === '' ? own.find(x => x.entry.name === '技能伤害') ?? (own.length === 1 ? own[0] : undefined) : undefined)
      // 倍率相同的动作都算候选（散华冰川爆炸与变奏都是 139.17%）
      const full = m ? list.filter(a => [...m.entry.want].every(([x, n]) => (hitsOf(a).get(x) ?? 0) >= n)) : []
      const cands = new Set<ActionDef>(m ? [m.best!, ...(m.partner ? [m.partner] : []), ...full] : [])
      if (prefix === '' || !m) {
        const alias = TYPE_ALIAS[s.type]
        if (alias && aliases[alias] && acts[aliases[alias]]) cands.add(acts[aliases[alias]]!)
        if (s.type === '变奏技能') list.filter(a => a.kind === 'intro').forEach(a => cands.add(a))
      }
      const label = `nanoka ${s.type}「${v.name}」${want}`
      if (cands.size === 0) { out.push(`${label}：找不到对应的动作，没核对`); continue }
      const sums = [...cands].map(a => ({ a, cast: castConcerto(a), total: concertoOf(a) }))
      if (sums.some(x => Math.abs(x.cast - want) < 0.01 || Math.abs(x.total - want) < 0.01)) continue
      out.push(`${label}：${sums.map(x => `${x.a.id} 起手 ${r2(x.cast)}、合计 ${r2(x.total)}`).join('；')}`)
    }
  }
  return out
}

/** 大招能量："消耗共鸣能量"（心有两种大招时任一对上即可） */
export function checkEnergyCost(cost: number, nk: NanokaCharacter): string[] {
  const want = nk.skills.flatMap(s => s.values.filter(v => v.name.endsWith('消耗共鸣能量')).map(v => ({ s, v, n: Number(v.text) })))
  if (want.length === 0 || want.some(w => w.n === cost)) return []
  return [`大招能量 ${cost}，nanoka ${want.map(w => `${w.s.type}「${w.v.name}」${w.n}`).join('、')}`]
}
