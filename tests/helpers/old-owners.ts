// tests/helpers/old-owners.ts —— DD-05 T05-8 从 src/engine/trace.ts 删掉的旧算法（walkOwners：按日志里的先后推"谁引出的"），原样搬来。
// 只给用例对照用：DD-05 §9 要求路线图 §4.2 末尾说的两种错归（同帧多个到期、队列交错）"各有用例，并断言了旧算法在该用例上是错的"。
// 生产代码一律按记录下来的事件来源（diag.eventMeta）推出处（src/engine/trace.ts 的 walkCauses），不要在别处用它。
import type { CharName, ResourceKind } from '../../src/data/common'
import { causeText, type GainHow, type GainOwner, type GainStep, type HitCause, type HitOrigin, type HitTrigger } from '../../src/analysis/trace'
import { outroOf } from '../../src/engine/switch'
import type { ResolvedScenario, SimEvent } from '../../src/engine/types'

const CAUSES = new Set(['cast', 'cost', 'hook', 'break', 'outro'])
type HitEvent = Extract<SimEvent, { type: 'hit' }>
type ResourceEvent = Extract<SimEvent, { type: 'resource' }>

/** 按日志顺序推出处（一条事件引出的事件紧跟在它后面，TD-07 §5），"谁引发的算谁"；命中交给 hit，资源变化交给 resource：
 *  - 起因：最近一条动作开始、命中或延奏所归的动作；buff 到时结束时，起因是挂上这个 buff 时的那个动作（散华重击居合挂的"引爆计时"到时 →
 *    重击居合；E 命中时挂的冰棱到时 → E）；切人、loop 之后（下一个起因之前）没有起因；
 *  - 命中：钩子生成的判定（没有发生帧，如散华"E-引爆冰棱""大招-引爆冰川"）归生成那一刻的起因，起因是别人的动作时（维里奈的协同攻击由
 *    队友命中触发）改归它所在动作最近的实例；其余判定归生成那一刻出伤者同名动作最近的实例；都找不到时归出伤者最近开始的动作；
 *  - 施放资源、扣除归本人最近开始的动作（含延奏动作）；效果、钩子、破盾回能归起因；延奏清零不归动作；
 *  - 钩子生成的判定记下引出原因，交给 hit：起因是一次命中时记那次命中（trigger，维里奈的协同攻击由谁的命中触发）；
 *    via 是钩子在什么之后生成的（"散华.冰棱 到时""丁 Q 开始""椿 盛绽·A3 命中"），note 是钩子附的说明（"5 链：冰到时自爆"）。
 *  局限：同一帧有几个 buff 一起到时，它们引出的事件都排在后面，会全算到最后一个到时的 buff 的起因上 */
export function walkOwners(log: readonly SimEvent[], r: ResolvedScenario, visit: {
  hit(e: HitEvent, owner: GainOwner | null, trigger: HitTrigger | null, origin: HitOrigin | null): void
  resource(e: ResourceEvent, how: GainHow, owner: GainOwner | null, label: string): void
}): void {
  const members = new Map(r.team.map(m => [m.def.name, m]))
  const last = new Map<CharName, GainOwner>()                 // 每人最近开始的动作
  const latest = new Map<string, GainOwner>()                 // "角色|动作" 最近的实例
  const spawned = new Map<number, GainOwner | null>()         // 判定 id → 生成时归到的动作
  const applied = new Map<string, GainOwner | null>()         // "buff→目标" → 最近一次挂上时的起因
  let anchor: { owner: GainOwner | null; label: string; hit?: HitEvent } = { owner: null, label: '' }   // hit：起因是一次命中时
  const triggers = new Map<number, HitTrigger>()              // 钩子生成的判定 id → 触发它的命中
  const origins = new Map<number, HitOrigin>()                // 钩子生成的判定 id → 引出原因
  const started = (o: GainOwner) => (o.outro ? `${o.char} 延奏` : `${o.char} ${o.action} 开始`)
  for (const e of log) {
    switch (e.type) {
      case 'actionStart': case 'outro': {
        const o: GainOwner = e.type === 'actionStart'
          ? { char: e.char, action: e.action, instance: e.instance, f: e.f, t: e.t }
          : { char: e.char, action: outroOf(members.get(e.char)!)?.id ?? '延奏', instance: e.instance ?? null, f: e.f, t: e.t, outro: true }
        last.set(e.char, o)
        latest.set(`${e.char}|${o.action}`, o)
        anchor = { owner: o, label: started(o) }
        break
      }
      case 'judgmentSpawn': {
        const byHook = members.get(e.char)?.actions[e.action]?.judgments.find(j => j.name === e.judgment)?.spawnFrame === null
        const cause = byHook && anchor.owner?.char === e.char ? anchor.owner : null
        spawned.set(e.id, cause ?? latest.get(`${e.char}|${e.action}`) ?? last.get(e.char) ?? null)
        if (byHook) {
          if (anchor.hit) triggers.set(e.id, { char: anchor.hit.char, action: anchor.hit.action, judgment: anchor.hit.judgment })
          const via = anchor.hit ? `${anchor.hit.char} ${anchor.hit.action} 命中` : anchor.label || null
          if (via || e.note) origins.set(e.id, { via, note: e.note ?? null })
        }
        break
      }
      case 'switch': case 'loop':
        anchor = { owner: null, label: '' }
        break
      case 'buffApply':
        applied.set(`${e.buff}→${e.target}`, anchor.owner)
        break
      case 'buffExpire':
        if (e.reason === 'timeout') anchor = { owner: applied.get(`${e.buff}→${e.target}`) ?? null, label: `${e.buff} 到时` }
        break
      case 'hit': {
        const owner = spawned.get(e.id) ?? latest.get(`${e.char}|${e.action}`) ?? last.get(e.char) ?? null
        anchor = { owner, label: `${e.char} ${e.action} 命中后`, hit: e }
        visit.hit(e, owner, triggers.get(e.id) ?? null, origins.get(e.id) ?? null)
        break
      }
      case 'resource': {
        const how = (CAUSES.has(e.cause) ? e.cause : 'effect') as GainHow
        const own = how === 'cast' || how === 'cost' ? last.get(e.char) ?? null : null
        const owner = how === 'outro' ? null : own ?? (how === 'cast' || how === 'cost' ? null : anchor.owner)
        visit.resource(e, how, owner, how === 'outro' ? `${e.char} 延奏` : own ? started(own) : anchor.label || e.char)
        break
      }
    }
  }
}

/** 旧的 gainSteps：资源变化逐步，每步按 walkOwners 归到动作 */
export function oldGainSteps(log: readonly SimEvent[], r: ResolvedScenario): GainStep[] {
  const members = new Map(r.team.map(m => [m.def.name, m]))
  const out: GainStep[] = []
  walkOwners(log, r, {
    hit(e, owner, _trigger, origin) {
      const of = owner && owner.action !== e.action ? { of: e.action } : {}
      const why = origin ? { ...(origin.note ? { note: origin.note } : {}), ...(origin.via ? { via: origin.via } : {}) } : {}
      const g = members.get(e.char)?.actions[e.action]?.judgments.find(j => j.name === e.judgment)?.gains
      const c = origin ? causeText(origin.note, origin.via) : ''
      const label = `${e.char} ${e.action} 命中（${e.judgment}${c ? `；${c}` : ''}）`
      const step = (resource: ResourceKind, deltas: Partial<Record<CharName, number>>, base: number | undefined) =>
        out.push({ f: e.f, t: e.t, resource, deltas, how: 'hit', what: e.judgment, ...(base !== undefined ? { base } : {}), ...of, ...why, label, owner })
      const energy = Object.entries(e.gains.energy).filter(([, v]) => v)
      if (energy.length) step('energy', Object.fromEntries(energy), g?.energy)
      if (e.gains.concerto) step('concerto', { [e.char]: e.gains.concerto }, g?.concerto)
      e.gains.core.forEach((v, k) => { if (v) step(`core${k + 1}` as ResourceKind, { [e.char]: v }, g?.core[k]) })
    },
    resource(e, how, owner, label) {
      const what = how === 'effect' ? e.cause : how === 'hook' ? e.note ?? '' : ''
      out.push({ f: e.f, t: e.t, resource: e.resource, deltas: { [e.char]: e.delta }, value: e.value, how, what, label, owner })
    },
  })
  return out
}


export function oldHitCauses(log: readonly SimEvent[], r: ResolvedScenario): Map<SimEvent, HitCause> {
  const out = new Map<SimEvent, HitCause>()
  walkOwners(log, r, { hit: (e, owner, trigger, origin) => out.set(e, { owner, trigger, origin }), resource: () => {} })
  return out
}
