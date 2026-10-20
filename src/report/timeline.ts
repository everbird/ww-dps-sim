// src/report/timeline.ts —— 时间轴网页的数据模型与嵌入（TD-10 §5.1）：纯函数，CLI（pnpm timeline）与网页（web/app）共用
import { basename, extname } from './path'
import type { Scenario } from '../data/scenario.schema'
import { actionGains, compareMarks, gainSteps, hitCauses, loopSpan, loopsOf, resourceSel, resourceTracks, traceCommands, traceLedger, traceSegments, type HitTrigger } from '../engine/trace'
import type { ResolvedScenario, SimEvent, SimResult } from '../engine/types'

export type TimelineModel = ReturnType<typeof timelineModel>

export const DATA_TAG = '<script id="timeline-data" type="application/json">null</script>'

/** 网页要的数据：仿真结果，加上画图用的队伍、敌人、排轴原文与各动作的类别（事件日志里没有的） */
export function timelineModel(file: string, sc: Scenario, r: ResolvedScenario, res: SimResult) {
  const e = r.enemy
  const steps = gainSteps(res.log, r)
  return {
    title: basename(file, extname(file)),
    scenario: file,
    data: r.data.version,
    team: r.team.map(m => ({
      name: m.def.name, element: m.def.element, energyCap: m.def.energyCost, chain: m.chain, weapon: m.weapon.def.key, rank: m.weapon.rank,
    })),
    enemy: {
      id: e.id, level: e.level, tunabilityMax: e.tunabilityMax, whiteBarTough: e.whiteBarTough, paralysisSec: e.paralysisFrames / 60,
    },
    concertoMax: r.rules.concertoMax,
    rotation: sc.rotation,
    opening: sc.opening,
    options: { repeat: r.options.repeat, tuneBreak: r.options.tuneBreak },
    kinds: Object.fromEntries(r.team.map(m => [m.def.name, Object.fromEntries(Object.values(m.actions).map(a => [a.id, a.kind]))])),
    summary: res.summary,
    // buff 是谁登记的（给的人）：声骸、武器、套装算穿戴者；场景 buff 记 env
    buffOwners: Object.fromEntries(r.buffs.map(b => [b.def.id, b.owner === 'env' ? 'env' : r.team[b.owner]!.def.name])),
    // buff 加了什么（每层的值已按谐振阶取好）：检查器里显示"攻击 +20%"这类说明；标记型 buff 没有 zone
    buffInfo: Object.fromEntries(r.buffs.map(b => [b.def.id, {
      ...(b.def.zone ? { zone: b.def.zone, value: b.value } : {}), maxStacks: b.def.maxStacks, source: b.def.source,
      ...(b.def.filter ? { filter: b.def.filter } : {}),
    }])),
    // 每个动作给的协奏、能量，各从哪来（视图 D 的检查器、动作条的提示）；资源型效果的原文；能量的分配比例（出伤者 / 队友）
    gains: actionGains(steps),
    // 视图 D 的检查器：光标那一帧每人的能量、协奏与共鸣回路（核心资源，只列有变化的槽）的值，与钩子给的共鸣回路状态说明（同一帧取最后的值）
    resources: resourceTracks(steps, r),
    forte: res.forte,
    // 视图 E 的帧画面：技能冷却（"什么时候好"，战斗帧）
    cooldowns: res.cooldowns,
    effectInfo: Object.fromEntries(r.effects.map(e => [e.def.id, { source: e.def.source }])),
    energyShare: r.rules.energyShare,
    trace: traceModel(r, res),
    video: videoModel(sc, r, res),
    ...(res.error ? { error: res.error } : {}),
    log: withCauses(res.log.filter(ev => ev.type !== 'judgmentSpawn'), hitCauses(res.log, r)),   // 判定生成网页不用，省体积
  }
}

/** 命中带上归到的动作与引出原因（"谁引发的算谁"，TD-10 §5.1、TD-12 §2.1）：owner = 那个动作开始的实例号（归到延奏、归不到动作的不写）；
 *  钩子生成的判定再带上 trigger（触发它的命中：维里奈的协同攻击由谁的命中触发）、via（钩子在什么之后生成的："散华.冰棱 到时"）、
 *  note（钩子附的说明："5 链：冰到时自爆"）。网页里动作的伤害按 owner 合计；汇总的"分动作"仍按判定所在的动作 */
function withCauses(log: SimEvent[], causes: ReturnType<typeof hitCauses>): (SimEvent & { owner?: number; trigger?: HitTrigger; via?: string; note?: string })[] {
  return log.map(ev => {
    const c = ev.type === 'hit' ? causes.get(ev) : undefined
    if (!c) return ev
    const extra = {
      ...(c.owner && !c.owner.outro && c.owner.instance !== null ? { owner: c.owner.instance } : {}),
      ...(c.trigger ? { trigger: c.trigger } : {}),
      ...(c.origin?.via ? { via: c.origin.via } : {}),
      ...(c.origin?.note ? { note: c.origin.note } : {}),
    }
    return Object.keys(extra).length ? { ...ev, ...extra } : ev
  })
}

/** 调试表（TD-11 §3、§6 P3）：每轮的分段、逐条与资源逐步（协奏、能量、各核心资源），网页按轮次显示 */
function traceModel(r: ResolvedScenario, res: SimResult) {
  const names = ['协奏', '能量', ...r.team.flatMap(m => m.def.coreResources.map(c => c.name)).filter(Boolean)]
  return loopsOf(res.log).map(loop => ({
    loop,
    span: loopSpan(res.log, loop)!,
    segments: traceSegments(res.log, r, loop),
    commands: traceCommands(res.log, r, loop),
    ledgers: names.flatMap(n => {
      const sel = resourceSel(r, n)
      return typeof sel === 'string' ? [] : [{ name: sel.label, rows: traceLedger(res.log, r, loop, sel) }]
    }),
  }))
}

/** 视频时间点（TD-11 §6 P2）：每个时间点带上仿真里那条开始的世界帧 f，以及按视频推算的世界帧 vf（从最早那条起算） */
function videoModel(sc: Scenario, r: ResolvedScenario, res: SimResult) {
  if (!sc.video) return null
  const cmds = traceCommands(res.log, r, sc.video.loop)
  const cmp = compareMarks(cmds, sc.video.marks)
  const fOf = (line: number) => cmds.find(c => c.line === line)!.f
  const f0 = cmp.rows[0] ? fOf(cmp.rows[0].line) : 0
  return {
    ...(sc.video.url ? { url: sc.video.url } : {}),
    loop: sc.video.loop, missing: cmp.missing,
    marks: cmp.rows.map(x => ({ ...x, f: fOf(x.line), vf: f0 + x.video * 60 })),
  }
}

/** 把模型嵌进模板：替换数据占位与标题；"<" 转义成 <，免得数据里的 "</script>" 提前结束脚本 */
export function renderTimeline(template: string, model: ReturnType<typeof timelineModel>, fragment = false): string {
  if (!template.includes(DATA_TAG)) throw new Error('web/timeline.html 里找不到数据占位')
  const json = JSON.stringify(model).replace(/</g, '\\u003c')
  const names = model.team.map(t => t.name).join('·')
  const body = template
    .replace(/<title>[^<]*<\/title>/, `<title>${names} 时间轴</title>`)
    .replace(DATA_TAG, () => `<script id="timeline-data" type="application/json">${json}</script>`)
  if (fragment) return body
  // 独立的网页：模板里 <div class="wrap"> 之前是标题、字体与样式，放进 <head>
  const cut = body.indexOf('<div class="wrap">')
  if (cut < 0) throw new Error('web/timeline.html 里找不到 <div class="wrap">')
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + body.slice(0, cut) + '</head>\n<body>\n' + body.slice(cut) + '</body>\n</html>\n'
}


/** 时间轴的几种视图（TD-12 §2.1；E 是 2026-10-19 加的播放器式原型）：键是 pnpm timeline --view 的写法，值是 web/designs/ 里的模板 */
export const TIMELINE_VIEWS: Readonly<Record<string, string>> = { a: 'a-lanes.html', b: 'b-volumes.html', c: 'c-ledger.html', d: 'd-lens.html', e: 'e-player.html' }

/** 视图 A–D（web/designs/*.html，2026-10）：模板里 /*@shared*\/ 换成 shared.js，数据占位换成模型；模板本身是完整的网页 */
export function renderDesign(template: string, shared: string, model: ReturnType<typeof timelineModel>): string {
  if (!template.includes(DATA_TAG)) throw new Error('设计模板里找不到数据占位')
  const json = JSON.stringify(model).replace(/</g, '\\u003c')
  return template.replace('/*@shared*/', () => shared).replace(DATA_TAG, () => `<script id="timeline-data" type="application/json">${json}</script>`)
}
