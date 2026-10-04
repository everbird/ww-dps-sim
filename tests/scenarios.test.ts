// tests/scenarios.test.ts —— 场景回归快照（总设计 §11 第 5 条、TD-08 §6）
// scenarios/ 下每个场景跑一遍，汇总存成快照。数据或引擎改动导致数值变化时，人工确认后用 `pnpm test -- -u` 更新快照。
// 依赖 data/generated（缺数据时跳过）。
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { parse } from 'yaml'
import type { GameData } from '../src/data/gamedata'
import { loadGameData } from '../src/data/load'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import type { Summary } from '../src/engine/types'
import { dataDescribe } from './helpers/kernel-harness'

const DIR = new URL('../scenarios/', import.meta.url)
const files = readdirSync(DIR).filter(f => f.endsWith('.yaml')).sort()
let gd: GameData

/** 快照里只放看得懂的数：伤害取到 0.01，占比取到 0.01%，动作、每一轮写成一行 */
function view(s: Summary) {
  const r2 = (x: number) => Math.round(x * 100) / 100
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`
  return {
    windowFrames: s.windowFrames,
    totalDamage: r2(s.totalDamage),
    dps: r2(s.dps),
    overflowDamage: r2(s.overflowDamage),
    ...(s.steady ? { steady: `第 ${s.steady.from}–${s.steady.to} 轮：${s.steady.frames} 帧，DPS ${r2(s.steady.dps)}` } : {}),
    ...(s.perLoop ? {
      perLoop: s.perLoop.map(p => `第 ${p.loop} 轮：第 ${p.start} 帧起 ${p.frames} 帧，DPS ${r2(p.dps)}，能量 ${p.energyDelta.join(' / ')}，协奏 ${p.concertoDelta.join(' / ')}`),
    } : {}),
    byChar: Object.fromEntries(Object.entries(s.byChar).map(([k, v]) => [k, `${r2(v.damage)}（${pct(v.share)}）`])),
    byAction: s.byAction.map(a => `${a.char} ${a.action}：${r2(a.damage)}（${pct(a.share)}，${a.hits} 段）`),
    warnings: s.warnings.map(w => w.message),
  }
}

dataDescribe('场景回归快照', () => {
  beforeAll(async () => { gd = await loadGameData() })

  for (const f of files) {
    test(f, () => {
      const sc = ScenarioSchema.parse(parse(readFileSync(new URL(f, DIR), 'utf8')))
      const out = simulate(resolveScenario(sc, gd))
      expect(out.error).toBeUndefined()
      expect(view(out.summary)).toMatchSnapshot()
    })
  }
})
