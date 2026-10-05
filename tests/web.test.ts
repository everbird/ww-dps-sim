// tests/web.test.ts —— 网页（web/app，TD-12）的 Worker 处理：浏览器里装配的 GameData 与 Node 侧相同；四种请求都能跑通。
// vitest 认 Vite 的 import.meta.glob 与 ?raw，所以直接调用 handlers；依赖 data/generated（缺数据时跳过）。
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadGameData as nodeLoad } from '../src/data/load'
import { loadGameData as webLoad } from '../web/app/src/gamedata'
import { handlers } from '../web/app/src/handlers'
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
    expect(Math.round(run.steady!)).toBe(31023)
    expect(run.html.startsWith('<!doctype html>')).toBe(true)
    const cmp = await handlers.compare({ base: src('scenarios/m0-team.yaml'), other: src('scenarios/m0-team.yaml') })
    expect(cmp.delta).toBe(0)
    const opt = await handlers.optimize({
      scenario: src('scenarios/m0-team.yaml'), inventory: src('inventory/m0-equipped.yaml'), char: '椿', top: 1, keep: 8, set: null, includeTeam: false,
    })
    expect(Math.round(opt.builds[0]!.dps!)).toBe(31023)
    expect(opt.yaml).toContain('梦魇·无冠者')
    await expect(handlers.run({ scenario: { name: 'x.yaml', text: 'team: 1' } })).rejects.toThrow(/x\.yaml/)
  }, 60000)
})
