// tests/web.test.ts —— 网页（web/app，TD-12）的 Worker 处理：浏览器里装配的 GameData 与 Node 侧相同；各种请求都能跑通。
// vitest 认 Vite 的 import.meta.glob 与 ?raw，所以直接调用 handlers；依赖 data/generated（缺数据时跳过）。
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { loadGameData as nodeLoad } from '../src/data/load'
import { loadGameData as webLoad } from '../web/app/src/gamedata'
import { changedLines } from '../src/report/diff-timeline'
import { handlers } from '../web/app/src/handlers'
import { setsOf, teamOf } from '../web/app/src/peek'
import { dataDescribe } from './helpers/kernel-harness'

const src = (f: string) => ({ name: f.replace(/^.*\//, ''), text: readFileSync(f, 'utf8') })

dataDescribe('网页的 Worker', () => {
  test('浏览器侧装配的 GameData 与 Node 侧一致', async () => {
    const [a, b] = await Promise.all([webLoad(), nodeLoad()])
    expect(Object.keys(a.characters).sort()).toEqual(Object.keys(b.characters).sort())
    expect(JSON.stringify(a.characters['椿']!.actions)).toBe(JSON.stringify(b.characters['椿']!.actions))
    expect(Object.keys(a.echoes).length).toBe(Object.keys(b.echoes).length)
    expect(a.echoStats).toEqual(b.echoStats)
  })
  test('运行、对比、择优；场景写错时报出位置', async () => {
    const run = await handlers.run({ scenario: src('scenarios/m0-team.yaml') })
    // 2026-10-19 大招"不响应输入"挡切人（假设 ult-no-switch）后 31,023 → 30,242；2026-10-20 散华重击爆裂先按住半秒（m0-confirm §13 P1、P5）后 → 29,735
    // 2026-10-22 椿 E2 补上落地段后 29,735 → 28,170；2026-10-24 维里奈 E 第一段、强化空中A3 改成 3 下后（docs/engine-quality-plan.md §5）
    // 2026-10-25 声骸起手能打断后摇（假设 echo-input-priority）后 28,197 → 29,877
    expect(Math.round(run.steady!)).toBe(29877)
    expect(run.html.startsWith('<!doctype html>')).toBe(true)
    const cmp = await handlers.compare({ base: src('scenarios/m0-team.yaml'), other: src('scenarios/m0-team.yaml') })
    expect(cmp.delta).toBe(0)
    const opt = await handlers.optimize({
      scenario: src('scenarios/m0-team.yaml'), inventory: src('inventory/m0-equipped.yaml'), char: '椿', top: 1, keep: 8, set: null, includeTeam: false,
    })
    expect(Math.round(opt.builds[0]!.dps!)).toBe(29877)
    expect(opt.yaml).toContain('梦魇·无冠者')
    await expect(handlers.run({ scenario: { name: 'x.yaml', text: 'team: 1' } })).rejects.toThrow(/x\.yaml/)
  }, 60000)
  test('对比带时间轴对照：改过的那几条描边，累计伤害差到窗口末尾是正的', async () => {
    const cmp = await handlers.compare({ base: src('scenarios/m0-video-eq.yaml'), other: src('scenarios/m0-video-eq-维里奈Q后移.yaml') })
    const tl = cmp.timeline
    expect(tl.other.actions.filter(a => a.changed).map(a => a.char)).toContain('维里奈')
    expect(tl.other.actions.some(a => a.changed && a.char === '椿')).toBe(false)
    expect(tl.base.loops.map(l => l.loop)).toEqual([0, 1, 2, 3, 4])
    expect(tl.diff.at(-1)![1]).toBeGreaterThan(0)
  }, 60000)
  test('轴搜索（TD-10 §6.1）：只回前 top 条，另给原轴排第几；插入写错时报错', async () => {
    const req = { scenario: src('scenarios/m0-team.yaml'), move: null, drop: [], swap: false, insert: [], chars: ['维里奈'], rounds: 1, beam: 3, maxRuns: 100, top: 3 }
    const x = await handlers.search(req)
    expect(x.results).toHaveLength(3)
    expect(x.results[0]!.dps!).toBeGreaterThan(x.base.dps!)
    expect(x.results[0]!.steps[0]).toMatch(/^维里奈 Q：/)
    expect(x.rankOfBase).toBeGreaterThan(1)
    expect(x.label).toMatch(/稳态/)
    await expect(handlers.search({ ...req, insert: ['不存在'] })).rejects.toThrow(/没有人有动作/)
  }, 60000)
  test('按套路排轴（TD-10 §6.2 ④′）：循环轴 / 启动轴两种，结果带原轴排第几', async () => {
    const req = { scenario: src('scenarios/m0-video-eq.yaml'), opening: false, width: 2, vary: 0, gen: false }
    const x = await handlers.plan(req)
    expect(x.mode).toBe('rotation')
    expect(x.result.refRank).toBeLessThanOrEqual(2)                      // 2026-10-25 起两段出场技对调高 0.21%（plan.test）
    const y = await handlers.plan({ ...req, opening: true })
    expect(y.mode).toBe('opening')
    expect(y.result.leaves.some(l => l.isRef)).toBe(true)
    await expect(handlers.plan({ ...req, scenario: { name: 'x.yaml', text: src('scenarios/m0-video-eq.yaml').text + 'search:\n  routines: [心 E]\n' } })).rejects.toThrow(/不在队伍里/)
  }, 120000)
  test('设计备选 A–E 都能生成：共用脚本内联、数据带上 buff 的给予者', async () => {
    for (const file of ['a-lanes.html', 'b-volumes.html', 'c-ledger.html', 'd-lens.html', 'e-player.html']) {
      const { html } = await handlers.design({ scenario: src('scenarios/m0-team.yaml'), file })
      expect(html).toContain('window.WW')
      expect(html).not.toContain('/*@shared*/')
      expect(html).toContain('"buffOwners":{')
    }
    await expect(handlers.design({ scenario: src('scenarios/m0-team.yaml'), file: 'x.html' })).rejects.toThrow(/没有设计模板/)
  }, 60000)
})

describe('时间轴对照：哪几条改过', () => {
  test('逐行比；行数不同时从第一处不同起往后都算', () => {
    expect([...changedLines(['a', 'b', 'c'], ['a', 'B', 'c'])]).toEqual([2])
    expect([...changedLines(['a', 'b', 'c'], ['a', 'c'])]).toEqual([2, 3])
    expect([...changedLines(['a'], ['a  '])]).toEqual([])
  })
})

describe('网页：从 YAML 原文读候选', () => {
  test('队伍：块写法、行内写法都认；写到一半解析不了时粗读', () => {
    expect(teamOf('team:\n  - char: 椿\n    chain: 0\n  - { char: 散华, chain: 6 }\n  - char: 维里奈\n')).toEqual(['椿', '散华', '维里奈'])
    expect(teamOf('team:\n  - char: 椿\n  - { char: 散华, chain: [\n')).toEqual(['椿', '散华'])
  })
  test('库存里的套装：去重', () => {
    expect(setsOf('echoes:\n  - { name: a, set: 沉日劫明 }\n  - { name: b, set: 轻云出月 }\n  - { name: c, set: 沉日劫明 }\n')).toEqual(['沉日劫明', '轻云出月'])
  })
})
