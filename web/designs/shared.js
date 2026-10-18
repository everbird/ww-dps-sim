// web/designs/shared.js —— 时间轴设计备选（A–D）共用的数据处理：读嵌入的模型，整理成动作区间、命中、buff 区间、
// 前台段与时钟换算。各方案的 HTML 里留一个 shared 占位注释，生成时把本文件内联进去（src/report/timeline.ts 的 renderDesign）。
// 移植自 web/timeline.html 的 normalize / clockOf / build。
window.WW = (() => {
  'use strict'
  const ELEMENT_VAR = { 湮灭: '--el-havoc', 冷凝: '--el-glacio', 衍射: '--el-spectro', 热熔: '--el-fusion', 导电: '--el-electro', 气动: '--el-aero', 物理: '--el-physical' }
  const KIND_NAME = { normal: '普攻', heavy: '重击', skill: '共鸣技能', liberation: '共鸣解放', intro: '变奏', outro: '延奏', echo: '声骸技能', dodge: '闪避', tuneBreak: '谐度破坏', other: '其他' }
  const INTENDED = new Set(['delay', 'wait', 'at', 'input'])   // input：操作延迟（options.inputDelay）
  /** 正常出招节奏里的等待（派生窗口、优先级、连段、同一 tick、写轴要求的），不算"卡住" */
  const RHYTHM = new Set(['derive', 'priority', 'combo', 'started', 'delay', 'wait', 'at', 'input'])
  const ENEMY_CHANGE = { disharmony: '失谐', harmonyBreak: '谐度破坏命中', break: '破盾', breakEnd: '瘫痪结束', poiseBreak: '破韧', shift: '偏移', interference: '干涉', effectApplied: '异常效应' }
  const fmt = x => Math.round(x).toLocaleString('en-US')
  const pct = x => (x * 100).toFixed(1) + '%'
  const sec = f => (f / 60).toFixed(2)
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const loopName = k => (k === 0 ? '启动' : `第 ${k} 轮`)

  function clockOf(log) {
    const F = [0], T = [0]
    for (const e of log) {
      if (e.f < F[F.length - 1]) continue
      if (e.f === F[F.length - 1]) { T[T.length - 1] = Math.max(T[T.length - 1], e.t); continue }
      F.push(e.f); T.push(Math.max(e.t, T[T.length - 1]))
    }
    const stops = []
    for (let i = 1; i < F.length; i++) {
      if (T[i] === T[i - 1] && F[i] - F[i - 1] >= 2) {
        const last = stops[stops.length - 1]
        if (last && last[1] === F[i - 1]) last[1] = F[i]
        else stops.push([F[i - 1], F[i]])
      }
    }
    const frameAt = s => {
      let lo = 0, hi = T.length - 1
      if (s <= 0) return 0
      if (s > T[hi]) return F[hi] + (s - T[hi]) * 60
      while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] >= s) hi = mid; else lo = mid + 1 }
      if (lo === 0) return F[0]
      return Math.max(F[lo - 1], F[lo] - (T[lo] - s) * 60)
    }
    const secAt = f => {
      let lo = 0, hi = F.length - 1
      if (f >= F[hi]) return T[hi] + (f - F[hi]) / 60
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (F[mid] <= f) lo = mid; else hi = mid - 1 }
      return Math.min(T[lo + 1] ?? Infinity, T[lo] + (T[lo + 1] > T[lo] ? (f - F[lo]) / 60 : 0))
    }
    return { stops, frameAt, secAt, end: F[F.length - 1] }
  }

  function load() {
    let raw = null
    try { raw = JSON.parse(document.getElementById('timeline-data').textContent) } catch (_) { raw = null }
    if (!raw || !Array.isArray(raw.log)) return null
    const m = {
      title: raw.title || '', scenario: raw.scenario || '', data: raw.data || '', team: raw.team || [], enemy: raw.enemy || null,
      concertoMax: raw.concertoMax || 100, rotation: raw.rotation || [], opening: raw.opening || [], options: raw.options || {},
      kinds: raw.kinds || {}, buffOwners: raw.buffOwners || {}, buffInfo: raw.buffInfo || {}, summary: raw.summary, trace: raw.trace || [], video: raw.video || null, error: raw.error || null,
      effectInfo: raw.effectInfo || {}, energyShare: raw.energyShare || null,
      log: raw.log.filter(e => e.type !== 'judgmentSpawn'),
    }
    const slot = new Map(m.team.map((t, i) => [t.name, i]))
    // 每个动作给的资源（src/engine/trace.ts 的 actionGains），按动作开始的实例号挂到动作上；延奏动作（outro）没有动作条，不挂
    const gainsOf = new Map((raw.gains || []).filter(g => !g.outro).map(g => [g.instance, g]))
    const actions = [], open = new Map(), byInst = new Map(), hits = [], waits = [], skips = [], loops = [], enemy = [], switches = [], alerts = []
    const buffRows = new Map(), always = new Set(), damaging = new Set()
    for (const e of m.log) {
      switch (e.type) {
        case 'actionStart': {
          const a = { i: slot.get(e.char), char: e.char, id: e.action, start: e.f, end: null, how: '', cmd: e.cmd || null, t0: e.t, t1: null,
            kind: (m.kinds[e.char] || {})[e.action] || 'other', damage: 0, hits: 0, dmg: [], gains: gainsOf.get(e.instance) || null }
          open.set(e.instance, a); byInst.set(e.instance, a); actions.push(a); break
        }
        case 'actionEnd': case 'actionCancel': {
          const a = open.get(e.instance)
          if (a) { a.end = e.f; a.t1 = e.t; a.how = e.type === 'actionCancel' ? `被 ${e.by} 取消` : '自然结束'; open.delete(e.instance) }
          break
        }
        case 'hit':
          if (e.dmg || e.enemy) hits.push(e)
          for (const b of e.buffs || []) damaging.add(b.replace(/×\d+$/, ''))
          break
        case 'switch': switches.push(e); break
        case 'warning': if (e.code === 'introMissed') alerts.push(e); break   // 轴可能有问题：写了"变奏"的切人没变奏（TD-12 §2.1）
        case 'wait': waits.push(e); break
        case 'skip': skips.push(e); break
        case 'loop': loops.push(e); break
        case 'enemyState': enemy.push(e); break
        case 'buffApply': case 'buffExpire': {
          if (e.type === 'buffApply' && e.remaining === 'inf') { always.add(`${e.buff}→${e.target}`); break }
          const key = `${e.buff}→${e.target}`
          let row = buffRows.get(key)
          if (e.type === 'buffApply') {
            if (!row) { row = { key, buff: e.buff, target: e.target, spans: [], cur: null }; buffRows.set(key, row) }
            if (!row.cur) { row.cur = { start: e.f, end: null, stacks: e.stacks }; row.spans.push(row.cur) } else row.cur.stacks = Math.max(row.cur.stacks, e.stacks)
          } else if (row && row.cur) { row.cur.end = e.f; row.cur.reason = e.reason; row.cur = null }
          break
        }
      }
    }
    const clock = clockOf(m.log)
    const lastF = Math.max(clock.end, ...(m.summary.resourceTimeline || []).map(s => s.f))
    for (const a of actions) if (a.end === null) { a.end = lastF; a.t1 = clock.secAt(lastF); a.how = '日志结束时仍在进行' }
    for (const r of buffRows.values()) for (const s of r.spans) if (s.end === null) { s.end = lastF; s.reason = 'end' }
    // 命中归到引发它的动作（"谁引发的算谁"，同资源的出处；src/engine/trace.ts 的 hitOwners，命中的 owner 是那个动作开始的实例号）：
    // 动作条的伤害、C 的伤害列与本轮按动作、D 的检查器与每秒伤害都按它；判定在别的组里的（重击居合引爆的"E-引爆冰棱"）逐条记下。
    // ownerAct：归到的动作名（归到延奏、归不到动作的，按判定所在的动作）。汇总的"分动作"仍按判定所在的动作（TD-10 §1、TD-12 §2.1）
    for (const h of hits) {
      if (!h.dmg) continue
      const a = h.owner != null ? byInst.get(h.owner) : null
      h.ownerAct = a ? a.id : h.action
      if (!a) continue
      a.damage += h.dmg.expected; a.hits++
      const of = h.action !== a.id ? h.action : undefined
      let it = a.dmg.find(x => x.judgment === h.judgment && x.of === of && x.note === h.note)
      if (!it) a.dmg.push(it = { judgment: h.judgment, ...(of ? { of } : {}), ...(h.note ? { note: h.note } : {}), n: 0, v: 0, by: {} })
      it.n++; it.v += h.dmg.expected
      if (h.trigger) it.by[h.trigger.char] = (it.by[h.trigger.char] || 0) + 1   // 由谁的命中触发（维里奈的协同攻击可能是队友触发的）
    }
    const onField = []
    let who = switches.length ? switches[0].from : (actions[0] ? actions[0].char : null), from = 0
    for (const s of switches) { onField.push({ i: slot.get(who), char: who, start: from, end: s.f, intro: false }); who = s.to; from = s.f }
    if (who != null) onField.push({ i: slot.get(who), char: who, start: from, end: lastF })
    const loopSpans = loops.map((l, k) => ({ loop: l.loop, f: l.f, end: k + 1 < loops.length ? loops[k + 1].f : lastF }))
    const buffs = [...buffRows.values()].map(r => ({
      ...r, damage: damaging.has(r.buff), short: r.buff.startsWith(r.target + '.') ? r.buff.slice(r.target.length + 1) : r.buff,
      owner: m.buffOwners[r.buff] || (r.buff.includes('.') ? r.buff.slice(0, r.buff.indexOf('.')) : r.buff),
      uptime: (m.summary.buffUptime || {})[r.key] ?? null,
    })).sort((a, b) => (slot.has(a.target) ? slot.get(a.target) : 9) - (slot.has(b.target) ? slot.get(b.target) : 9) || a.spans[0].start - b.spans[0].start)
    m.D = { slot, actions, hits, waits, skips, loops: loopSpans, enemy, switches, alerts, onField, buffs, always, clock, lastF,
      maxHit: Math.max(1, ...hits.map(h => (h.dmg ? h.dmg.expected : 0))) }
    return m
  }

  // 乘区的中文名（src/data/common.ts 的 ZONE_IDS）；固定值的乘区不写百分号
  const ZONE_NAME = {
    hpPct: '生命', hpFlat: '生命', atkPct: '攻击', atkFlat: '攻击', defPct: '防御', defFlat: '防御', critRate: '暴击率', critDamage: '暴击伤害',
    energyRegen: '共鸣效率', healBonus: '治疗效果', tunabilityRate: '偏谐效率', harmonyBreakBoost: '谐度破坏增幅', RateBonus: '倍率提升',
    ExtraEffect9: '附加伤害', DamageChange: '伤害加成', DamageChangeElement: '属性伤害加成', DamageChangeType: '伤害加成',
    RoleIgnoreDefRate: '无视防御', TargetDefRate: '目标防御', RoleIgnoreResistance: '无视抗性', TargetElementResistant: '目标抗性',
    TargetDamageReduce: '目标伤害减免', TargetElementDamageReduce: '目标伤害减免（二）', SpecialDamageChange: '特殊伤害加成',
    DamageAmplify0: '伤害加深', DamageAmplify1002: '霜冻伤害加深', FinalDamage1001: '最终伤害（集谐）',
  }
  const FLAT = new Set(['hpFlat', 'atkFlat', 'defFlat', 'ExtraEffect9', 'harmonyBreakBoost'])
  const zoneName = z => ZONE_NAME[z] || (/^DamageAmplify(\d)$/.test(z) ? `${z.slice(-1)} 类加深` : /^FinalDamage(\d)$/.test(z) ? `${z.slice(-1)} 类最终伤害` : z)
  /** buff 的数值拆开：乘区名、条件、数值（× 层数）、是否固定值；标记型返回 null。汇总时按 key（乘区 + 条件）合计 */
  function buffParts(m, id, stacks = 1) {
    const b = m.buffInfo[id]
    if (!b || !b.zone) return null
    const f = b.filter || {}
    const cond = [...(f.elements || []), ...(f.tags || []), ...(f.actions || []), ...(f.judgments || []), f.critOnly ? '只算暴击' : ''].filter(Boolean).join('、')
    const name = zoneName(b.zone)
    return { key: `${name}|${cond}`, name, cond, v: b.value * stacks, flat: FLAT.has(b.zone) }
  }
  const signedVal = (v, flat) => (flat ? `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v))}` : `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(Math.abs(v) * 100 % 1 ? 1 : 0)}%`)
  /** buff 加了什么："攻击 +20%（普攻）"；stacks 层；标记型返回 null */
  function buffEffect(m, id, stacks = 1) {
    const p = buffParts(m, id, stacks)
    return p ? `${p.name} ${signedVal(p.v, p.flat)}${p.cond ? `（${p.cond}）` : ''}` : null
  }
  // ---- 动作给的资源：出处的名字、数值、合计、一行概括、提示 ----
  const RES_NAME = { concerto: '协奏', energy: '能量' }
  /** 带符号的资源数：+15、+7.2、−125（10 以下留两位小数，去掉末尾的 0） */
  const signedNum = v => { const a = Math.abs(v); return `${v < 0 ? '−' : '+'}${+a.toFixed(a >= 10 ? 1 : 2)}` }
  /** 引出原因写成一句（同 src/engine/trace.ts 的 causeText）："5 链：冰到时自爆（散华.冰棱 到时）" */
  const causeText = (note, via) => (note && via ? `${note}（${via}）` : note || via || '')
  /** 一条出处叫什么："E-引爆冰棱 命中 2 段""E-引爆冰棱 命中（5 链：冰到时自爆）""行进序曲.协奏""起手即得" */
  function gainName(it) {
    const n = it.n > 1 ? (it.how === 'hit' ? ` ${it.n} 段` : ` ×${it.n}`) : ''
    if (it.how === 'hit') return `${it.what} 命中${it.note ? `（${it.note}）` : ''}${n}`
    if (it.how === 'effect') return it.what + n
    return ({ cast: '起手即得', cost: '施放扣除', hook: it.what || '角色钩子', break: '破盾回能' })[it.how] + n
  }
  /** [角色, 值] 按队伍顺序排（出现的先后会变，固定顺序好对着看） */
  const byTeam = (m, d) => {
    const at = n => { const i = m.team.findIndex(t => t.name === n); return i < 0 ? 9 : i }
    return Object.entries(d).sort(([a], [b]) => at(a) - at(b))
  }
  /** 合计：资源 → 角色 → 变化量（角色按队伍顺序） */
  function gainTotals(m, g) {
    const t = {}
    for (const it of g.items) { const x = (t[it.resource] ||= {}); for (const [n, v] of Object.entries(it.deltas)) x[n] = (x[n] || 0) + v }
    for (const res of Object.keys(t)) t[res] = Object.fromEntries(byTeam(m, t[res]))
    return t
  }
  /** 谁拿了多少："椿 +3.6、散华 +7.2"；只有动作本人拿时省掉名字 */
  const whoGot = (m, deltas, self) => {
    const xs = byTeam(m, deltas)
    return xs.length === 1 && xs[0][0] === self ? signedNum(xs[0][1]) : xs.map(([n, v]) => `${n} ${signedNum(v)}`).join('、')
  }
  /** 一行概括（动作条的提示）："协奏 +38；能量 椿 +4.1、散华 +8.2、维里奈 +4.4"；没有资源变化时为空 */
  function gainLine(m, g) {
    if (!g || !g.items.length) return ''
    return Object.entries(gainTotals(m, g)).map(([res, d]) => `${RES_NAME[res] || res} ${whoGot(m, d, g.char)}`).join('；')
  }
  /** 一条出处的提示：怎么来的、原文、每段多少、什么时候 */
  function gainTip(m, g, it) {
    const lines = [`<b>${esc(gainName(it))}</b>`]
    const share = m.energyShare
    if (it.how === 'hit') {
      if (it.of) lines.push(`判定在「${esc(it.of)}」组里，由 ${esc(g.action)} 引发（钩子生成），所以算在这里`)
      if (it.note || it.via) lines.push(`引出：${esc(causeText(it.note, it.via))}`)
      if (it.base !== undefined && it.resource === 'energy') {
        lines.push(`每段基础能量 ${+it.base.toFixed(4)}${share ? `：出伤者拿 ${share.dealer * 100}%、队友各拿 ${share.others * 100}%` : ''}，再乘各自的共鸣效率`)
      } else if (it.base !== undefined) lines.push(`每段 ${+it.base.toFixed(4)}`)
    } else if (it.how === 'effect') {
      const src = (m.effectInfo[it.what] || {}).source
      if (src) lines.push(attr(src))
    } else lines.push(esc(({ cast: '动作一开始就给的固定量，不看打没打中。出处：xlsx 资源公式"按段算的部分 + 常数"里的常数（原作者说明"进入该动作就获得"，以前叫"进入即得"；TD-01 §3.7）', cost: '施放共鸣解放扣除的大招能量', hook: `${g.char} 的角色模块按规则给的${it.what ? `：${it.what}` : ''}`, break: '破盾（白条打空）时全队回能' })[it.how] || ''))
    lines.push(it.dt > 0 ? `第一次在动作开始后 ${it.dt.toFixed(2)} 秒（战斗秒）` : '动作开始那一刻')
    lines.push('满了的部分不计（数值是实际加上的）')
    return lines.join('<br>')
  }
  // ---- 动作打出的伤害（"谁引发的算谁"，TD-12 §2.1）----
  /** 动作条提示里的一行："伤害 28,258（14 段，含它引发的 E-引爆冰棱 3,275、QTE-引爆冰棘 2,547）"；没有伤害时为空 */
  function dmgLine(a) {
    if (!a.damage) return ''
    const other = a.dmg.filter(it => it.of)
    return `伤害 ${fmt(a.damage)}（${a.hits} 段${other.length ? `，含它引发的 ${other.map(it => `${it.judgment} ${fmt(it.v)}`).join('、')}` : ''}）`
  }
  /** 一个判定由谁的命中触发："椿 6 段、散华 1 段、维里奈 1 段"；都是动作本人触发的不写（那就是这个动作自己的命中引出的） */
  const dmgTriggers = (a, it) => {
    const xs = Object.entries(it.by || {}).sort((p, q) => q[1] - p[1])   // 段数多的在前
    return xs.some(([c]) => c !== a.char) ? xs.map(([c, n]) => `${c} ${n} 段`).join('、') : ''
  }
  /** 逐个判定（C 的伤害列的提示、D 的检查器）：判定名、段数、伤害；判定在别的组里的、由队友命中触发的注明 */
  const dmgItemNote = (a, it) => [it.of ? `判定在「${it.of}」组里，由 ${a.id} 引发` : '', dmgTriggers(a, it) ? `触发：${dmgTriggers(a, it)}` : ''].filter(Boolean).join('；')
  const dmgItemText = (a, it) => `${it.judgment}${it.note ? `（${it.note}）` : ''}${it.n > 1 ? ` ${it.n} 段` : ''} ${fmt(it.v)}${dmgItemNote(a, it) ? `（${dmgItemNote(a, it)}）` : ''}`
  const DMG_NOTE = '按引发它的动作算（谁引发的算谁，同资源的出处）；汇总的"分动作"按判定所在的动作'
  function dmgTip(a) {
    return [`<b>${esc(`${a.char} ${a.id}`)} 打出的伤害 ${fmt(a.damage)}</b>`, ...a.dmg.map(it => esc(dmgItemText(a, it))), esc(DMG_NOTE)].join('<br>')
  }
  /** 这一段怎么来的："由 椿 盛绽·A3 命中触发"（钩子在命中后生成的，如维里奈的协同攻击；本人触发的不写角色名）；
   *  其余钩子生成的写引出原因，归到的动作与判定所在的动作不同时前面加"由 X 引发"：
   *  "由 重击居合 引发：重击爆裂引爆（散华.引爆计时 到时）""5 链：冰到时自爆（散华.冰棱 到时）"；都没有时为空 */
  const hitBy = h => {
    if (h.trigger) return `由 ${h.trigger.char === h.char ? '' : `${h.trigger.char} `}${h.trigger.action} 命中触发${h.note ? `（${h.note}）` : ''}`
    const by = h.ownerAct && h.ownerAct !== h.action ? `由 ${h.ownerAct} 引发` : '', why = causeText(h.note, h.via)
    return by && why ? `${by}：${why}` : by || why
  }
  const cmdText = (m, c) => ((c.loop === 0 ? m.opening : m.rotation) || [])[c.line - 1] || ''
  const cmdWhere = c => `${c.loop === 0 ? '启动' : `第 ${c.loop} 轮`}第 ${c.line} 条`
  /** 每个角色的颜色：--c0..--c2 指向元素色 */
  function paint(m) { m.team.forEach((t, i) => document.documentElement.style.setProperty(`--c${i}`, `var(${ELEMENT_VAR[t.element] || '--el-physical'})`)) }
  // ---- 轴可能有问题（TD-09 §3.5、TD-12 §2.1）：写了"变奏"（switch <角色> 变奏）的切人，切出者协奏没满、没变奏。
  // 引擎记成 warning 事件（code introMissed，带指令出处 cmd）；各视图顶上一条提示条（点一条跳过去），切人处画标记 ----
  /** 警告正文：去掉开头的"启动第 11 条 switch 椿 变奏："（行号、指令各视图自己写） */
  const alertBody = a => a.message.slice(a.message.indexOf('：') + 1)
  /** 这次切人有没有警告：按指令出处对上 */
  const alertOf = (m, sw) => (sw.cmd && m.D.alerts.find(a => a.cmd && a.f === sw.f && a.cmd.loop === sw.cmd.loop && a.cmd.line === sw.cmd.line && a.cmd.item === sw.cmd.item)) || null
  const ALERT_CSS = `.ww-alerts{flex-basis:100%;border:1px solid var(--alert);border-left-width:4px;border-radius:6px;padding:8px 12px;background:var(--panel);color:var(--ink);font-size:13px;line-height:1.6}
.ww-alerts>b{color:var(--alert)}.ww-alerts ul{margin:2px 0 0;padding-left:1.2em}
.ww-alerts button{font:inherit;color:var(--alert);background:none;border:0;padding:0;text-decoration:underline;cursor:pointer}
tr.ww-alert>td{background:color-mix(in srgb,var(--alert) 10%,transparent)}.ww-alert-text{color:var(--alert)}`
  /** 提示条：放进 host 的末尾（before 给了就插在它前面）；点一条调 onPick(警告) 跳过去。没有警告时什么都不做 */
  function mountAlerts(m, host, onPick, before = null) {
    if (!m.D.alerts.length || !host) return
    if (!document.getElementById('ww-alert-css')) {
      const st = document.createElement('style'); st.id = 'ww-alert-css'; st.textContent = ALERT_CSS; document.head.appendChild(st)
    }
    const el = document.createElement('section')
    el.className = 'ww-alerts'; el.setAttribute('role', 'alert')
    el.innerHTML = `<b>轴可能有问题（${m.D.alerts.length} 处）：写了"变奏"的切人没变奏</b><ul>` + m.D.alerts.map((a, k) =>
      `<li><button type="button" data-k="${k}">战斗 ${a.t.toFixed(2)} 秒</button>　${esc(a.message)}</li>`).join('') + '</ul>'
    el.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) onPick(m.D.alerts[+b.dataset.k]) })
    host.insertBefore(el, before)
  }
  /** 默认看的那一轮：稳态第一轮，没有稳态时第 1 轮 */
  const defaultLoop = m => (m.summary.steady ? m.summary.steady.from : m.D.loops.some(l => l.loop === 1) ? 1 : (m.D.loops[0] ? m.D.loops[0].loop : null))
  /** 浮动提示：元素带 data-tip（HTML）。鼠标悬停显示；触摸屏点一下显示（放在手指上方），点别处或滚动收起。
   *  [data-own-tap] 里的点按归页面自己处理（如 D 的导航图），不弹提示。返回 { hide } */
  function tips(root = document.body) {
    const el = document.createElement('div')
    el.className = 'ww-tip'; el.hidden = true; document.body.appendChild(el)
    const hide = () => { el.hidden = true }
    const show = (t, x, y, touch) => {
      el.innerHTML = t.getAttribute('data-tip'); el.hidden = false
      const w = el.offsetWidth, h = el.offsetHeight
      let left = x + 14, top = y + 14
      if (touch) { left = x - w / 2; top = y - h - 18; if (top < 8) top = y + 26 }
      else { if (left + w > innerWidth - 8) left = x - w - 14; if (top + h > innerHeight - 8) top = y - h - 14 }
      el.style.left = Math.max(8, Math.min(innerWidth - w - 8, left)) + 'px'; el.style.top = Math.max(8, Math.min(innerHeight - h - 8, top)) + 'px'
    }
    root.addEventListener('pointermove', ev => {
      if (ev.pointerType !== 'mouse') return
      const t = ev.target.closest('[data-tip]')
      if (t) show(t, ev.clientX, ev.clientY, false); else hide()
    })
    root.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') hide() })
    // 触摸：按下到抬起没怎么动、也没变成滚动（滚动时浏览器发 pointercancel）才算点按
    let down = null
    document.addEventListener('pointerdown', ev => { down = ev.pointerType === 'mouse' ? null : { id: ev.pointerId, x: ev.clientX, y: ev.clientY } })
    document.addEventListener('pointercancel', () => { down = null })
    document.addEventListener('pointerup', ev => {
      if (!down || ev.pointerId !== down.id) return
      const tap = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 10
      down = null
      if (!tap) return
      const t = ev.target.closest && !ev.target.closest('[data-own-tap]') && ev.target.closest('[data-tip]')
      if (t && root.contains(t)) show(t, ev.clientX, ev.clientY, true); else hide()
    })
    document.addEventListener('scroll', hide, { capture: true, passive: true })
    return { hide }
  }
  /** 触摸屏（没有悬停）：说明文字改写"点"而不是"悬停" */
  const touchOnly = () => matchMedia('(hover: none)').matches
  /** 文字宽度（粗估）：中文 1em，其余 0.58em */
  const textWidth = (s, px) => [...s].reduce((w, ch) => w + (/[⺀-￿]/.test(ch) ? px : px * 0.58), 0)
  const attr = s => esc(s).replace(/\n/g, '<br>')
  return { causeText, dmgLine, dmgItemNote, dmgItemText, dmgTip, DMG_NOTE, hitBy, alertBody, alertOf, mountAlerts, RES_NAME, signedNum, byTeam, gainName, gainTotals, whoGot, gainLine, gainTip, buffEffect, buffParts, signedVal, zoneName, ELEMENT_VAR, KIND_NAME, INTENDED, RHYTHM, ENEMY_CHANGE, fmt, pct, sec, esc, attr, loopName, load, cmdText, cmdWhere, paint, defaultLoop, tips, touchOnly, textWidth }
})()
