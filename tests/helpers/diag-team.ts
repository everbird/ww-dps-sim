// tests/helpers/diag-team.ts —— DD-05 用例共用的人造队伍：一条轴里同时有同帧多个到期、钩子生成的判定、取消留下的尾部、延奏的尾部、
// 变奏切人（切出者有切走即移除的 buff、切入者有挂起的 nextIn buff）、召唤类声骸；另有截断、轴失败、钩子抛错几种变体。不依赖 data/generated。
//
// 主轴（diagBase）上的时刻：
//   第 0 帧 甲 X 开始，挂上 甲.一、甲.二（各 20 帧）与 甲.切走即清；第 5 帧 a 命中，钩子随即生成 c
//   第 6 帧 甲 Y 取消 X（等 a 出手），X 的 b（出现帧 2、发生帧 30）转成尾部；Y 开始时挂起给下一位的 甲.下一位
//   第 19 帧 甲.一、甲.二 同帧到期：钩子各给 1 点核心资源、1 点协奏（日志里是 到期一、到期二、资源一、资源二）
//   第 30 帧 尾部的 b 命中；第 66 帧 switch 乙 变奏：切走清掉 甲.切走即清、给乙 甲.下一位、乙 QTE 开始
//   第 71 帧 QTE 的延奏触发：甲 的延奏动作以尾部开始，第 81 帧 o 命中；之后 乙 Z、乙 声骸（召唤）
import type { BuffDefInput } from '../../src/data/buff.schema'
import type { GameData } from '../../src/data/gamedata'
import { ScenarioSchema, type ScenarioInput } from '../../src/data/scenario.schema'
import { prepareRun } from '../../src/engine/run'
import type { PreparedRun, RunOverrides } from '../../src/engine/run-types'
import { action, judgment } from './kernel-harness'
import { synthData, type SynthChar } from './synth'

const buff = (o: Partial<BuffDefInput> & { id: string }): BuffDefInput =>
  ({ source: 't', zone: 'atkPct', value: 0.5, target: 'self', duration: 600, trigger: { on: 'actionStart' }, ...o }) as BuffDefInput

export interface DiagTeamOptions {
  throwOn?: string                          // 钩子在这个判定命中时抛错（engineError 的变体）
}

export function diagTeam(o: DiagTeamOptions = {}): [SynthChar, SynthChar, SynthChar] {
  const 甲: SynthChar = {
    name: '甲',
    core: [{ slot: 1, name: '甲核', cap: 10 }],
    actions: [
      action({
        id: 'X', kind: 'skill', endFrame: 40, judgments: [
          judgment({ name: 'a', spawnFrame: 5 }),
          judgment({ name: 'b', spawnFrame: 30, birthFrame: 2 }),
          judgment({ name: 'c', spawnFrame: null }),                 // 钩子生成（a 命中后）
        ],
      }),
      action({ id: 'Y', kind: 'skill', endFrame: 20, priority: [{ fromFrame: 0, value: 4 }], judgments: [judgment({ name: 'y', spawnFrame: 3 })] }),
      action({ id: 'W', kind: 'skill', endFrame: 60, cooldown: 600 }),
      action({ id: 'L', kind: 'skill', endFrame: 200, judgments: [judgment({ name: 'l', spawnFrame: 150 })] }),
      action({ id: '延奏', kind: 'outro', endFrame: 30, judgments: [judgment({ name: 'o', spawnFrame: 10 })] }),
    ],
    buffs: [
      buff({ id: '甲.一', duration: 20, trigger: { on: 'actionStart', where: { actions: ['X'] } } }),
      buff({ id: '甲.二', zone: 'DamageChange', value: 0.1, duration: 20, trigger: { on: 'actionStart', where: { actions: ['X'] } } }),
      buff({ id: '甲.切走即清', duration: 'inf', onSwitchOut: 'clear', trigger: { on: 'actionStart', where: { actions: ['X'] } } }),
      buff({ id: '甲.下一位', target: 'nextIn', duration: 120, trigger: { on: 'actionStart', where: { actions: ['Y'] } } }),
    ],
    hooks: {
      onEvent(ctx, ev) {
        if (ev.type === 'hit' && ev.char === '甲' && ev.judgment === 'a') ctx.spawnJudgment('c', { note: '命中 a 后' })
        if (ev.type === 'buffExpire' && ev.buff === '甲.一') ctx.addResource('core1', 1, ctx.self, '甲.一 到时')
        if (ev.type === 'buffExpire' && ev.buff === '甲.二') ctx.addResource('concerto', 1, ctx.self, '甲.二 到时')
      },
    },
  }
  const 乙: SynthChar = {
    name: '乙',
    aliases: { Q: '声骸' },
    actions: [
      action({ id: 'QTE', kind: 'intro', endFrame: 30, outroTriggerFrame: 5, judgments: [judgment({ name: 'q', spawnFrame: 8 })] }),
      action({ id: 'Z', kind: 'skill', endFrame: 20, judgments: [judgment({ name: 'z', spawnFrame: 2 })] }),
      action({ id: '声骸', kind: 'echo', summon: true, endFrame: 30, judgments: [judgment({ name: '召唤物', spawnFrame: 40, lifeFrames: 1 })] }),
    ],
  }
  const 丙: SynthChar = {
    name: '丙', actions: [],
    ...(o.throwOn ? { hooks: { onEvent(_ctx, ev) { if (ev.type === 'hit' && ev.judgment === o.throwOn) throw new Error(`钩子在 ${o.throwOn} 命中时出错`) } } } : {}),
  }
  return [甲, 乙, 丙]
}

export const DIAG_ROTATION = ['甲 X', '甲 Y', 'wait 60', 'switch 乙 变奏', '乙 Z', '乙 Q']

/** 合成场景的 PreparedRun（敌人：90 级自定义）；sc 覆盖场景的其余字段 */
export function preparedSynth(chars: [SynthChar, SynthChar, SynthChar], sc: Partial<ScenarioInput>, overrides: RunOverrides = {}, data?: GameData): PreparedRun {
  const p = prepareRun(ScenarioSchema.parse({
    team: chars.map(c => ({ char: c.name, weapon: { name: '测试武器' } })),
    enemy: { custom: { level: 90 } }, ...sc,
  }), data ?? synthData(chars), overrides)
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('\n'))
  return p.run
}

/** 主轴：甲 开局协奏 99（甲.二 到时补满，第 66 帧变奏切人） */
export const diagBase = (o: DiagTeamOptions = {}, sc: Partial<ScenarioInput> = {}, overrides: RunOverrides = {}): PreparedRun =>
  preparedSynth(diagTeam(o), { rotation: DIAG_ROTATION, initial: { concerto: [99, 0, 0] }, ...sc }, overrides)
