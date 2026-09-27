// tests/kernel-harness.ts —— TD-04 用例的测试台：最小状态、最小调度器、动作构造器
// 调度器只实现 TD-04 需要的三种指令（正式语义见 TD-09）：act（默认等"取消不丢东西"，force 跳过）、switch、at（测试专用：等到某世界帧）。
import { existsSync, readFileSync } from 'node:fs'
import type { ActionId, Slot } from '../../src/data/common'
import { assembleBlock } from '../../src/data/assemble-action'
import { DEFAULT_RULES } from '../../src/data/gamedata'
import type { ActionDef, DilationDef, JudgmentDef } from '../../src/data/gamedata'
import { GenActionFileSchema } from '../../src/data/generated.schema'
import { describe } from 'vitest'
import { gate, log, settled, startAction, tick } from '../../src/engine/kernel'
import type { Kernel } from '../../src/engine/kernel'
import type { CharRuntime, SimState } from '../../src/engine/types'

export type Cmd =
  | { act: Slot; action: ActionId; force?: boolean }
  | { switch: Slot }
  | { at: number }

export interface Hit { f: number; char: string; judgment: string; tick: number }
export interface RunResult { s: SimState; hits: Hit[]; outros: { f: number; char: string }[]; frames: number }

const char = (slot: Slot, name: string): CharRuntime => ({
  slot, name, action: null, last: null, startedThisTick: false, energy: 0, concerto: 0, core: [0, 0, 0, 0, 0], cooldowns: {}, flags: {},
})

export function newState(names: [string, string, string], onField: Slot = 0): SimState {
  return {
    frame: 0, battleFrames: 0, onField, switchCd: 0,
    chars: [char(0, names[0]), char(1, names[1]), char(2, names[2])],
    judgments: [], tails: [], buffs: [], dilations: [], log: [], nextId: 1,
    enemy: {} as SimState['enemy'],                  // 内核不读敌人状态（TD-06）
    queue: { commands: [], next: 0, waitingSince: null, loop: 0 },
  }
}

/** 跑一条指令序列。team[slot] 是该槽位可用的动作表 */
export function run(
  team: Record<ActionId, ActionDef>[], cmds: Cmd[],
  opts: { maxFrames?: number; names?: [string, string, string]; onField?: Slot } = {},
): RunResult {
  const s = newState(opts.names ?? ['甲', '乙', '丙'], opts.onField ?? 0)
  const hits: Hit[] = []
  const outros: { f: number; char: string }[] = []
  const k: Kernel = {
    rules: DEFAULT_RULES,
    hooks: {
      settle: (st, j, n) => { hits.push({ f: st.frame, char: st.chars[j.owner].name, judgment: j.def.name, tick: n }) },
      outroTrigger: (st, slot) => { outros.push({ f: st.frame, char: st.chars[slot].name }) },
    },
  }
  const queue = [...cmds]
  const schedule = (st: SimState): boolean => {
    while (queue.length > 0) {
      const c = queue[0]!
      if ('at' in c) { if (st.frame < c.at) break; queue.shift(); continue }
      if ('switch' in c) {
        const cur = st.chars[st.onField].action
        if (st.switchCd > 0 || c.switch === st.onField || (cur && cur.localFrame < (cur.def.switchLockUntil ?? 0))) break
        log(st, { type: 'switch', from: st.chars[st.onField].name, to: st.chars[c.switch].name, intro: false })
        st.onField = c.switch
        st.switchCd = k.rules.switchCooldown
        queue.shift()
        continue
      }
      if (c.act !== st.onField) throw new Error(`${st.chars[c.act].name} 不在前台`)
      const def = team[c.act]![c.action]
      if (!def) throw new Error(`没有动作 ${c.action}`)
      const g = gate(st.chars[c.act], def)
      if (!g.ok) { if (!g.wait) throw new Error(g.reason); break }
      if (!c.force && !settled(st, c.act)) break
      startAction(st, k, c.act, def)
      queue.shift()
    }
    return queue.length > 0
  }
  const max = opts.maxFrames ?? 3000
  while (s.frame < max && tick(s, k, schedule)) { /* 逐帧推进 */ }
  if (s.frame >= max) throw new Error(`超过 ${max} 帧仍未结束`)
  return { s, hits, outros, frames: s.frame }
}

// ---------------------------------------------------------------------------
// 动作构造：真实数据（从生成的动作文件装配）与人造动作

/** 生成数据是否在本地（公开仓库不带 data/generated，需先 pnpm build:data）；没有时依赖真实数据的用例跳过 */
export const hasData = existsSync(new URL('../../data/generated/actions/散华.json', import.meta.url))
/** 依赖生成数据的用例组：没有数据时整组记为跳过，且不执行组内代码 */
export function dataDescribe(name: string, fn: () => void): void {
  if (hasData) describe(name, fn)
  else describe.skip(`${name}（缺 data/generated，已跳过）`, () => {})
}

const blocks = new Map<string, Record<string, ActionDef>>()
export function block(key: string): Record<string, ActionDef> {
  let b = blocks.get(key)
  if (!b) {
    const file = GenActionFileSchema.parse(JSON.parse(readFileSync(new URL(`../../data/generated/actions/${key}.json`, import.meta.url), 'utf8')))
    b = assembleBlock(file)
    blocks.set(key, b)
  }
  return b
}

export function judgment(o: Partial<JudgmentDef> & { name: string }): JudgmentDef {
  return {
    row: 0, spawnFrame: 0, birthFrame: null, lifeFrames: 1, ticks: 1, tickInterval: null, persistsOnCancel: true,
    followHitstop: false, target: 'enemy', calc: 'damage', multiplier: 1, relatedAttr: 'atk', element: '物理', tags: [],
    gains: { energy: 0, concerto: 0, core: [0, 0, 0] }, gauges: { toughness: 0, tunability: 0 }, hitstop: null, flags: [], ...o,
  }
}

export function action(o: Partial<ActionDef> & { id: string }): ActionDef {
  return {
    owner: 'test', kind: 'other', endFrame: 60, cancelWindows: [], priority: [{ fromFrame: 0, value: 2 }], inputLocks: [],
    judgments: [], dilations: [], castGains: [], source: { file: 'test', rows: [] }, flags: [], ...o,
  }
}

export const hitstop = (self: [number, number] | null, enemy: [number, number] | null = null): DilationDef => ({
  type: '攻击顿帧', anchor: 'hit', start: 0,
  ...(self ? { self: { rate: self[0], duration: self[1] } } : {}),
  ...(enemy ? { enemy: { rate: enemy[0], duration: enemy[1] } } : {}),
})
