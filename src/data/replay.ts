// src/data/replay.ts —— 录像输入（DD-09 §3）：三种时段的填法怎么插进轴、填法组合怎么展开、同一项读数不能两用的检查，
// 以及录像读数行（video.*）的拆法。纯函数，只看场景的数据；装配（resolve.ts）、归一入口（run.ts）、贴合度（fit.ts）与命令行共用。
//
// 写法（DD-09 §11 实施记录）：
// - 时段写视频秒，replay.videoOffset 把它换成世界秒（at 写的那种）：世界秒 = 视频秒 − videoOffset；
// - 时段要落在相邻两个 at 之间：结束处是轴里第一个时刻不早于 to 的 at（"闭合的 at"），它前面那个 at 不能晚于 from——
//   中间有 at 就是跨过了已观测（钉了时刻）的动作；没有闭合的 at 时时段在最后一个 at 之后，填法接在轴末尾；
// - 未观测时段的填法插在闭合的 at 之前；填法的行编成第 N + 1 条起的指令（N 是 rotation 的条数），按时段先后、行先后编号，
//   rotation 原有各条的条号不变（video.marks、notation 照旧指得对）；
// - 每个未观测时段只剩一种填法时才能跑；有几种的先展开成各个组合（expandReplayCombos），组合超过 16 个要指定跑哪几个。
import { parseRotationLine, videoTime, type ReplaySegment, type Scenario } from './scenario.schema'

/** 填法组合的上限（DD09-Q5） */
export const MAX_FILL_COMBOS = 16

/** 时刻比较的余量（秒）：视频读数到 0.01 秒，at 也写到 0.01 秒 */
const EPS = 0.005

// ---------------------------------------------------------------------------
// 录像读数行

/** 读数的用途（DD-09 §4.1）：score 参与贴合度的评分；given 被用作输入（同步的依据，§3.2）；display 只展示 */
export type VideoPurpose = 'score' | 'given' | 'display'

/** 一行读数：时刻（视频秒）、其余各段、行末写的用途 */
export interface VideoLine { readonly t: number; readonly tokens: readonly string[]; readonly purpose: VideoPurpose }

export function splitVideoLine(line: string): VideoLine {
  const tok = line.trim().split(/\s+/)
  let purpose: VideoPurpose = 'score'
  const last = tok.at(-1)
  if (last === '!given' || last === '!display') { purpose = last === '!given' ? 'given' : 'display'; tok.pop() }
  return { t: videoTime(tok[0]!), tokens: tok.slice(1), purpose }
}

// ---------------------------------------------------------------------------
// 时段与填法

/** 轴里的一个 at：第几条（从 1 起）、世界秒 */
export interface AtMark { readonly line: number; readonly seconds: number }

/** rotation 里的 at，按出现的先后 */
export function atMarks(rotation: readonly string[]): AtMark[] {
  const out: AtMark[] = []
  rotation.forEach((text, i) => {
    const p = parseRotationLine(text)
    if (!Array.isArray(p)) return
    for (const it of p) if (it.kind === 'at') out.push({ line: i + 1, seconds: it.seconds })
  })
  return out
}

/** 一处要插进轴的填法：beforeLine 是闭合的 at 所在的条（null = 接在末尾）；firstLine 是填法第一行编成的条号 */
export interface ReplayInsert {
  readonly segment: number                  // replay.segments 的下标
  readonly fill: string                     // 填法的名字
  readonly beforeLine: number | null
  readonly firstLine: number
  readonly lines: readonly string[]
}

export interface ReplayIssue { readonly path: readonly (string | number)[]; readonly message: string }

const fmt = (x: number) => String(Math.round(x * 1000) / 1000)

/** 时段落在哪两个 at 之间（DD-09 §3.1 的编译期检查）。返回闭合的 at（没有为 null）或问题 */
function placeSegment(g: ReplaySegment, i: number, ats: readonly AtMark[], offset: number): { closing: AtMark | null } | ReplayIssue {
  const from = videoTime(g.from) - offset, to = videoTime(g.to) - offset
  const k = ats.findIndex(a => a.seconds >= to - EPS)
  const prev = k < 0 ? ats.at(-1) : ats[k - 1]
  if (prev && prev.seconds > from + EPS) {
    return {
      path: ['replay', 'segments', i],
      message: `第 ${i + 1} 个时段（视频 ${fmt(videoTime(g.from))}–${fmt(videoTime(g.to))}，世界秒 ${fmt(from)}–${fmt(to)}）跨过了第 ${prev.line} 条 at ${fmt(prev.seconds)}：`
        + '时段要落在相邻两个 at 之间，不能跨过已观测的动作',
    }
  }
  return { closing: k < 0 ? null : ats[k]! }
}

/** 填法怎么插进轴（只认每个未观测时段只剩一种填法的场景）；时段放不下的、还有几种填法没选的报问题 */
export function replayInserts(sc: Pick<Scenario, 'rotation' | 'replay'>): { inserts: ReplayInsert[]; issues: ReplayIssue[] } {
  const segs = sc.replay?.segments ?? []
  if (segs.length === 0) return { inserts: [], issues: [] }
  const offset = sc.replay!.videoOffset ?? 0
  const ats = atMarks(sc.rotation)
  const issues: ReplayIssue[] = []
  const order = segs.map((g, i) => ({ g, i })).sort((a, b) => videoTime(a.g.from) - videoTime(b.g.from) || a.i - b.i)
  const inserts: ReplayInsert[] = []
  let next = sc.rotation.length + 1
  for (const { g, i } of order) {
    const placed = placeSegment(g, i, ats, offset)
    if ('message' in placed) { issues.push(placed); continue }
    if (g.kind !== 'unobserved') continue
    if (g.fills.length !== 1) {
      issues.push({ path: ['replay', 'segments', i, 'fills'], message: `第 ${i + 1} 个时段有 ${g.fills.length} 种填法：先展开成各个组合分别跑（expandReplayCombos；命令行写 --fill <组合名>，DD-09 §3.1）` })
      continue
    }
    const f = g.fills[0]!
    inserts.push({ segment: i, fill: f.name, beforeLine: placed.closing?.line ?? null, firstLine: next, lines: f.lines })
    next += f.lines.length
  }
  return { inserts, issues }
}

/** 实际执行的轴的各条原文：rotation 之后接各填法的行（与 replayInserts 的条号一致）。时间轴、调试表按条号找原文用 */
export function replayRotationText(sc: Pick<Scenario, 'rotation' | 'replay'>): string[] {
  const { inserts } = replayInserts(sc)
  return [...sc.rotation, ...inserts.flatMap(x => x.lines)]
}

// ---------------------------------------------------------------------------
// 填法组合（DD-09 §3.1）：k 个未观测时段、各有若干填法，展开成每个组合一次运行；各组合分别运行、分别报告，不当上下界

export interface FillCombo {
  /** 组合的名字：有几种填法的时段，各写"<from 视频秒>=<填法名>"，用"；"连起来；都只有一种填法时为空串 */
  readonly name: string
  readonly picks: readonly number[]         // 各时段选的填法下标（idle 的记 -1）
}

/** 全部组合（按时段在列表里的先后、填法的先后排） */
export function fillCombos(sc: Pick<Scenario, 'replay'>): FillCombo[] {
  const segs = sc.replay?.segments ?? []
  let combos: number[][] = [[]]
  for (const g of segs) {
    const n = g.kind === 'unobserved' ? g.fills.length : 0
    combos = n === 0 ? combos.map(c => [...c, -1]) : combos.flatMap(c => Array.from({ length: n }, (_, k) => [...c, k]))
    if (combos.length > 4096) break                           // 再多也只是报"太多"，不必算全
  }
  return combos.map(picks => ({ name: comboName(segs, picks), picks }))
}

function comboName(segs: readonly ReplaySegment[], picks: readonly number[]): string {
  return segs.flatMap((g, i) => (g.kind === 'unobserved' && g.fills.length > 1 ? [`${String(g.from)}=${g.fills[picks[i]!]!.name}`] : [])).join('；')
}

/** 每个未观测时段只留选中的那一种填法（选择进场景内容，所以进运行身份：scenarioDigest 不同） */
export function narrowReplay<T extends Pick<Scenario, 'replay'>>(sc: T, picks: readonly number[]): T {
  if (!sc.replay) return sc
  return {
    ...sc,
    replay: {
      ...sc.replay,
      segments: sc.replay.segments.map((g, i) => (g.kind === 'unobserved' ? { ...g, fills: [g.fills[picks[i]!]!] } : g)),
    },
  }
}

/** 展开成各个组合（DD-09 §3.1）。select：要跑的组合名；不给时全跑，超过 MAX_FILL_COMBOS 个报错、要求指定 */
export function expandReplayCombos<T extends Pick<Scenario, 'replay'>>(sc: T, select?: readonly string[]):
  { ok: true; combos: { name: string; scenario: T }[] } | { ok: false; message: string } {
  const all = fillCombos(sc)
  if (select && select.length > 0) {
    const unknown = select.filter(n => !all.some(c => c.name === n))
    if (unknown.length) return { ok: false, message: `没有这些填法组合：${unknown.join('、')}（有：${all.slice(0, 20).map(c => c.name || '（唯一）').join('、')}${all.length > 20 ? '…' : ''}）` }
    return { ok: true, combos: all.filter(c => select.includes(c.name)).map(c => ({ name: c.name, scenario: narrowReplay(sc, c.picks) })) }
  }
  if (all.length > MAX_FILL_COMBOS)
    return { ok: false, message: `填法组合有 ${all.length >= 4096 ? '4096 个以上' : `${all.length} 个`}，超过 ${MAX_FILL_COMBOS} 个：指定要跑哪几个（--fill <组合名>，DD09-Q5）` }
  return { ok: true, combos: all.map(c => ({ name: c.name, scenario: narrowReplay(sc, c.picks) })) }
}

// ---------------------------------------------------------------------------
// 同一项读数不能两用（DD-09 §3.2；路线图 §6.1）

/** 同步与读数相差不到这么多秒算"同一时刻" */
export const GIVEN_WINDOW = 0.5

/** 轴里的同步：第几条、角色、资源（原文）、时刻（前面最近一个 at 的世界秒；没有 at 记 0） */
function syncsOf(rotation: readonly string[]): { line: number; char: string; resource: string; seconds: number }[] {
  const out: { line: number; char: string; resource: string; seconds: number }[] = []
  let at = 0
  rotation.forEach((text, i) => {
    const p = parseRotationLine(text)
    if (!Array.isArray(p)) return
    for (const it of p) {
      if (it.kind === 'at') at = it.seconds
      else if (it.kind === 'sync') out.push({ line: i + 1, char: it.char, resource: it.resource, seconds: at })
    }
  })
  return out
}

const isConcerto = (r: string) => r === '协奏' || r === 'concerto'

/** 同一角色、同一资源、时刻相差不到 GIVEN_WINDOW 秒的同步与读数同时存在时，读数要标 !given（编译期检查，C09-5）。
 *  同步的时刻取它前面最近的 at，按 replay.videoOffset 换成视频秒；资源对应的读数：协奏 ↔ video.concerto，核心资源 ↔ video.core（同名）；
 *  能量没有读数通道 */
export function givenConflicts(sc: Pick<Scenario, 'rotation' | 'video' | 'replay'>): ReplayIssue[] {
  const syncs = syncsOf(sc.rotation)
  if (syncs.length === 0 || !sc.video) return []
  const readings = [
    ...(sc.video.concerto ?? []).map((line, i) => ({ list: 'concerto', i, ...splitVideoLine(line) })),
    ...(sc.video.core ?? []).map((line, i) => ({ list: 'core', i, ...splitVideoLine(line) })),
  ]
  if (readings.length === 0) return []
  const offset = sc.replay?.videoOffset
  if (offset === undefined)
    return [{ path: ['replay', 'videoOffset'], message: '轴里有同步、video 里有协奏环或回路条读数：要给 replay.videoOffset，才查得了"同一项读数不能两用"（DD-09 §3.2）' }]
  const out: ReplayIssue[] = []
  for (const s of syncs) {
    const v = s.seconds + offset
    for (const r of readings) {
      const same = r.tokens[0] === s.char && (r.list === 'concerto' ? isConcerto(s.resource) : r.tokens[1] === s.resource)
      if (!same || Math.abs(r.t - v) >= GIVEN_WINDOW || r.purpose === 'given') continue
      out.push({
        path: ['video', r.list, r.i],
        message: `video.${r.list} 第 ${r.i + 1} 条（${fmt(r.t)} 秒）与 rotation 第 ${s.line} 条的同步（${s.char} ${s.resource}，视频 ${fmt(v)} 秒）是同一项读数：`
          + '被用来写同步的读数要标 !given，不能再进贴合度的评分（DD-09 §3.2）',
      })
    }
  }
  return out
}
