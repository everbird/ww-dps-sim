// web/designs/shared.js —— 时间轴设计备选（A–D）共用的数据处理：读嵌入的模型，整理成动作区间、命中、buff 区间、
// 前台段与时钟换算。各方案的 HTML 里留一个 shared 占位注释，生成时把本文件内联进去（src/report/timeline.ts 的 renderDesign）。
// 移植自 web/timeline.html 的 normalize / clockOf / build。
window.WW = (() => {
  'use strict'
  const ELEMENT_VAR = { 湮灭: '--el-havoc', 冷凝: '--el-glacio', 衍射: '--el-spectro', 热熔: '--el-fusion', 导电: '--el-electro', 气动: '--el-aero', 物理: '--el-physical' }
  const KIND_NAME = { normal: '普攻', heavy: '重击', skill: '共鸣技能', liberation: '共鸣解放', intro: '变奏', outro: '延奏', echo: '声骸技能', dodge: '闪避', tuneBreak: '谐度破坏', other: '其他' }
  const INTENDED = new Set(['delay', 'wait', 'at'])
  /** 正常出招节奏里的等待（派生窗口、优先级、连段、同一 tick、写轴要求的），不算"卡住" */
  const RHYTHM = new Set(['derive', 'priority', 'combo', 'started', 'delay', 'wait', 'at'])
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
      log: raw.log.filter(e => e.type !== 'judgmentSpawn'),
    }
    const slot = new Map(m.team.map((t, i) => [t.name, i]))
    const actions = [], open = new Map(), hits = [], waits = [], skips = [], loops = [], enemy = [], switches = []
    const buffRows = new Map(), always = new Set(), damaging = new Set()
    for (const e of m.log) {
      switch (e.type) {
        case 'actionStart': {
          const a = { i: slot.get(e.char), char: e.char, id: e.action, start: e.f, end: null, how: '', cmd: e.cmd || null, t0: e.t, t1: null,
            kind: (m.kinds[e.char] || {})[e.action] || 'other', damage: 0, hits: 0 }
          open.set(e.instance, a); actions.push(a); break
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
    // 命中归到动作上（同一角色、同一动作名、命中时动作在进行或刚结束）：动作条的伤害
    const byChar = new Map()
    for (const a of actions) { if (!byChar.has(a.char)) byChar.set(a.char, []); byChar.get(a.char).push(a) }
    for (const h of hits) {
      if (!h.dmg) continue
      const list = byChar.get(h.char) || []
      let best = null
      for (const a of list) if (a.id === h.action && a.start <= h.f) best = a
      if (best) { best.damage += h.dmg.expected; best.hits++ }
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
    m.D = { slot, actions, hits, waits, skips, loops: loopSpans, enemy, switches, onField, buffs, always, clock, lastF,
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
  const cmdText = (m, c) => ((c.loop === 0 ? m.opening : m.rotation) || [])[c.line - 1] || ''
  const cmdWhere = c => `${c.loop === 0 ? '启动' : `第 ${c.loop} 轮`}第 ${c.line} 条`
  /** 每个角色的颜色：--c0..--c2 指向元素色 */
  function paint(m) { m.team.forEach((t, i) => document.documentElement.style.setProperty(`--c${i}`, `var(${ELEMENT_VAR[t.element] || '--el-physical'})`)) }
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
  return { buffEffect, buffParts, signedVal, zoneName, ELEMENT_VAR, KIND_NAME, INTENDED, RHYTHM, ENEMY_CHANGE, fmt, pct, sec, esc, attr, loopName, load, cmdText, cmdWhere, paint, defaultLoop, tips, touchOnly, textWidth }
})()
