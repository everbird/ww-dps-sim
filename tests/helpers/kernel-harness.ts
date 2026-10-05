// tests/kernel-harness.ts —— TD-04 / TD-09 用例的测试台：最小状态、指令序列、动作构造器
// 指令直接写成已解析的形式（槽位 + 动作 ID），交给正式的调度器（src/engine/scheduler.ts，TD-09）执行；
// 另有测试专用的 at（等到某世界帧），排轴语法写不出来。
import { existsSync, readFileSync } from 'node:fs'
import type { ActionId, Slot } from '../../src/data/common'
import { assembleBlock, forChain } from '../../src/data/assemble-action'
import type { CharacterModuleDef } from '../../src/data/define'
import { DEFAULT_RULES } from '../../src/data/gamedata'
import type { ActionDef, DilationDef, JudgmentDef } from '../../src/data/gamedata'
import { GenActionFileSchema, type GenActionFile } from '../../src/data/generated.schema'
import type { Command } from '../../src/data/scenario.schema'
import { describe } from 'vitest'
import type { Kernel } from '../../src/engine/kernel'
import { createScheduler, newQueue, runLoop, ScheduleError, type CompileMember, type SchedulerOptions } from '../../src/engine/scheduler'
import type { CharRuntime, SimEvent, SimState } from '../../src/engine/types'

export type Cmd =
  | { act: Slot; action: ActionId; force?: boolean; delay?: number; optional?: true; filler?: true }
  | { switch: Slot }
  | { wait: number }
  | { at: number }

export interface Hit { f: number; char: string; judgment: string; tick: number }
export interface RunResult { s: SimState; hits: Hit[]; outros: { f: number; char: string }[]; frames: number; error?: ScheduleError }

const char = (slot: Slot, name: string): CharRuntime => ({
  slot, name, action: null, last: null, startedThisTick: false, energy: 0, concerto: 0, core: [0, 0, 0, 0, 0], cooldowns: {}, charges: {}, flags: {},
})

export function newState(names: [string, string, string], onField: Slot = 0): SimState {
  return {
    frame: 0, battleFrames: 0, onField, switchCd: 0,
    chars: [char(0, names[0]), char(1, names[1]), char(2, names[2])],
    judgments: [], tails: [], buffs: [], dilations: [], log: [], nextId: 1,
    enemy: {} as SimState['enemy'],                  // 内核不读敌人状态（TD-06）
    queue: newQueue([]),
    outroLinks: [], pendingNextIn: [], lastTrigger: {},
  }
}

/** Cmd → Command：第 i 条（从 1 起），每条一个动作 */
export function toCommands(team: Record<ActionId, ActionDef>[], cmds: Cmd[]): Command[] {
  return cmds.map((c, i): Command => {
    const ref = { line: i + 1, item: 1 }
    if ('at' in c) return { kind: 'at', ...ref, frame: c.at }
    if ('wait' in c) return { kind: 'wait', ...ref, frames: c.wait }
    if ('switch' in c) return { kind: 'switch', ...ref, to: c.switch }
    if (!team[c.act]?.[c.action]) throw new Error(`没有动作 ${c.action}`)
    return {
      kind: 'act', ...ref, slot: c.act, action: c.action, delay: c.delay ?? 0, force: c.force ?? false,
      ...(c.optional ? { optional: true as const } : {}), ...(c.filler ? { filler: true as const } : {}),
    }
  })
}

export interface RunOptions extends Partial<SchedulerOptions> {
  maxFrames?: number; names?: [string, string, string]; onField?: Slot; repeat?: number
}

/** 跑一条指令序列（team[slot] 是该槽位可用的动作表）；也可以直接给编译好的 Command[]。调度报错直接抛出 */
export function run(team: Record<ActionId, ActionDef>[], cmds: Cmd[] | Command[], opts: RunOptions = {}): RunResult {
  const r = tryRun(team, cmds, opts)
  if (r.error) throw r.error
  return r
}

/** 同 run，但调度报错不抛出，而是连同报错前的状态与日志一起返回（TD-09 §3.3：日志保留到出错为止） */
export function tryRun(team: Record<ActionId, ActionDef>[], cmds: Cmd[] | Command[], opts: RunOptions = {}): RunResult {
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
  const commands = cmds.length > 0 && 'kind' in cmds[0]! ? (cmds as Command[]) : toCommands(team, cmds as Cmd[])
  s.queue = newQueue(commands, opts.repeat ?? 1)
  const schedule = createScheduler(k, team, { maxWait: Infinity, ...opts })   // TD-04 的用例不设等待上限
  try {
    runLoop(s, k, schedule, opts.maxFrames ?? 3000)
  } catch (e) {
    if (e instanceof ScheduleError) return { s, hits, outros, frames: s.frame, error: e }
    throw e
  }
  return { s, hits, outros, frames: s.frame }
}

/** 取某类事件（按 type 收窄） */
export const eventsOf = <T extends SimEvent['type']>(r: RunResult, type: T): Extract<SimEvent, { type: T }>[] =>
  r.s.log.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)

// ---------------------------------------------------------------------------
// 动作构造：真实数据（从生成的动作文件装配）与人造动作

/** 生成数据是否在本地（公开仓库不带 data/generated，需先 pnpm build:data）；没有时依赖真实数据的用例跳过 */
export const hasData = existsSync(new URL('../../data/generated/actions/散华.json', import.meta.url))
/** 依赖生成数据的用例组：没有数据时整组记为跳过，且不执行组内代码 */
export function dataDescribe(name: string, fn: () => void): void {
  if (hasData) describe(name, fn)
  else describe.skip(`${name}（缺 data/generated，已跳过）`, () => {})
}

/** 读一个块的生成数据（zod 校验过） */
export function genFile(key: string): GenActionFile {
  return GenActionFileSchema.parse(JSON.parse(readFileSync(new URL(`../../data/generated/actions/${key}.json`, import.meta.url), 'utf8')))
}

const blocks = new Map<string, Record<string, ActionDef>>()
/** 按默认规则装配（不带角色模块的覆盖、不按链数挑判定）——TD-04 用例用的就是它 */
export function block(key: string): Record<string, ActionDef> {
  let b = blocks.get(key)
  if (!b) {
    b = assembleBlock(genFile(key))
    blocks.set(key, b)
  }
  return b
}

/** 场景里的角色动作表：默认规则 + 角色模块的 actionOverrides + 按链数挑判定（总设计 §3.3 第 4 步） */
export function character(mod: CharacterModuleDef, chain: number): Record<string, ActionDef> {
  return forChain(assembleBlock(genFile(mod.name), mod.actionOverrides), chain)
}

/** 编译排轴用的队员：角色动作 + 体型通用动作（闪避、极限闪避…）+ 角色模块的别名（总设计 §3.3 第 4、7 步；声骸 Q 待 M2） */
export function member(mod: CharacterModuleDef, chain: number): CompileMember {
  const chars = JSON.parse(readFileSync(new URL('../../data/generated/characters.json', import.meta.url), 'utf8')) as Record<string, { commonBlock: string | null }>
  const cb = chars[mod.name]?.commonBlock
  return { name: mod.name, actions: { ...(cb ? block(cb) : {}), ...character(mod, chain) }, aliases: mod.aliases ?? {} }
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
