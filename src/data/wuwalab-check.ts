// src/data/wuwalab-check.ts —— 拿 WuwaLAB（社区站，api.wuwalab.com）的动作数据核对装配结果（docs/engine-quality-plan.md P5）。
// 它每个动作有总帧、最早取消、不能切人帧（no_swap）、时停（time_stop）、优先级时间线、冷却，每一击有帧、倍率、能量、协奏，
// 有的是作者实测（WU.DA.MAGE 等同类说明），不是原包真值：对不上的是线索，要回 xlsx 或进游戏查。
// 动作按"有伤害的各击倍率"配对（同一组倍率可能对上几个动作，取第一个，报告里注明）
import type { ActionDef } from './gamedata'

/** WuwaLAB /api/app/characters/<slug> 里用到的字段 */
export interface WlAbility {
  name: string
  total_frames: number; earliest_frame_cancel: number; no_swap: number; time_stop: number
  cooldown: number | null
  priority_timeline: number[][] | string | null
  on_cast_energy: number; on_cast_concerto: number
  hits: { frame: number; motion_value: number; energy: number; concerto: number }[]
}

export interface WlRow {
  ability: string
  action: string | null                 // 对上的动作 ID；null = 倍率没对上
  alternatives: number                  // 同一组倍率另外还对上几个动作
  diffs: string[]                       // 差在哪（空 = 比的几项都一致）
}

const key = (xs: number[]) => xs.map(x => x.toFixed(3)).sort().join(',')

/** 我们这边每一击：第一次结算 = 生成帧 + 延迟，之后按结算间隔（没有间隔时在寿命内均分）；只算有倍率、按帧生成的判定 */
function ourHits(a: ActionDef): { f: number; mv: number; energy: number; concerto: number }[] {
  const out: { f: number; mv: number; energy: number; concerto: number }[] = []
  for (const j of a.judgments) {
    if (j.spawnFrame === null || !(j.multiplier > 0)) continue
    const first = j.spawnFrame + (j.delayFrames ?? 0)
    const iv = j.tickInterval ?? (j.ticks > 1 && j.lifeFrames > 0 ? j.lifeFrames / j.ticks : 0)
    for (let t = 0; t < j.ticks; t++) out.push({ f: Math.round(first + t * iv), mv: j.multiplier, energy: j.gains.energy, concerto: j.gains.concerto })
  }
  return out.sort((x, y) => x.f - y.f)
}

const timeline = (p: WlAbility['priority_timeline']): number[][] => {
  const v = typeof p === 'string' ? JSON.parse(p) as unknown : p
  return Array.isArray(v) ? v as number[][] : []
}

/** tol：帧数差几帧以内算一致 */
export function crosscheckWuwalab(actions: Record<string, ActionDef>, abilities: readonly WlAbility[], tol = 2): WlRow[] {
  const ours = Object.values(actions).map(a => ({ a, hits: ourHits(a) })).filter(o => o.hits.length > 0)
  return abilities.flatMap((ab): WlRow[] => {
    const wh = ab.hits.filter(h => h.motion_value > 0).sort((x, y) => x.frame - y.frame)
    if (!wh.length) return []
    const k = key(wh.map(h => h.motion_value / 10000))
    const cands = ours.filter(o => key(o.hits.map(h => h.mv)) === k)
    if (!cands.length) return [{ ability: ab.name, action: null, alternatives: 0, diffs: [`倍率 ${k} 没对上`] }]
    const { a, hits } = cands[0]!
    const diffs: string[] = []
    const df = wh.map((h, i) => h.frame - hits[i]!.f)
    if (df.some(d => Math.abs(d) > tol)) diffs.push(`命中帧（WuwaLAB − 我们）${df.join(' / ')}`)
    const ts = ab.time_stop ?? 0, stop = a.globalStopUntil ?? 0
    if (Math.abs(ts - Math.max(0, stop - 1)) > tol && (ts > 0 || stop > 0)) diffs.push(`时停 WuwaLAB ${ts} / 我们全局时停到 ${stop || '—'}`)
    const swap = Math.max(ab.no_swap ?? 0, ts), lock = Math.max(a.switchLockUntil ?? 0, stop)
    if (Math.abs(swap - lock) > tol) diffs.push(`切人 WuwaLAB no_swap ${ab.no_swap}、时停 ${ts} / 我们锁到 ${lock || '—'}`)
    if (ab.cooldown && ab.cooldown !== a.cooldown) diffs.push(`冷却 WuwaLAB ${ab.cooldown} / 我们 ${a.cooldown ?? '—'}`)
    const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0)
    const wE = sum(wh.map(h => h.energy)) / 100, oE = sum(hits.map(h => h.energy))
    if (Math.abs(wE - oE) > 0.05) diffs.push(`各击能量 WuwaLAB ${wE} / 我们 ${Math.round(oE * 100) / 100}`)
    const wC = (sum(wh.map(h => h.concerto)) + (ab.on_cast_concerto ?? 0)) / 100
    const oC = sum(hits.map(h => h.concerto)) + sum(a.castGains.filter(g => g.resource === 'concerto').map(g => g.amount))
    if (Math.abs(wC - oC) > 0.05) diffs.push(`协奏 WuwaLAB ${wC} / 我们 ${Math.round(oC * 100) / 100}`)
    const wp = timeline(ab.priority_timeline).map(p => `${p[0]}:${p[1]}`).join(' ')
    const op = a.priority.map(p => `${p.fromFrame}:${p.value}`).join(' ')
    if (wp && wp !== op) diffs.push(`优先级 WuwaLAB ${wp} / 我们 ${op}`)
    return [{ ability: ab.name, action: a.id, alternatives: cands.length - 1, diffs }]
  })
}
