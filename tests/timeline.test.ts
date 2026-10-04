// tests/timeline.test.ts —— 时间轴网页的数据与嵌入（src/cli/timeline.ts；网页本身是 web/timeline.html，不在这里测）
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ScenarioSchema } from '../src/data/scenario.schema'
import { resolveScenario } from '../src/engine/resolve'
import { simulate } from '../src/engine/simulate'
import { renderTimeline, timelineModel } from '../src/cli/timeline'
import { action, judgment } from './helpers/kernel-harness'
import { idle, synthData } from './helpers/synth'

const 甲 = { name: '甲', actions: [action({ id: 'X', kind: 'skill', endFrame: 30, judgments: [judgment({ name: 'x', spawnFrame: 10, gauges: { toughness: 10, tunability: 10 } })] })] }
const sc = ScenarioSchema.parse({
  team: ['甲', '乙', '丙'].map(char => ({ char, weapon: { name: '测试武器' } })),
  enemy: { custom: { level: 90, tunabilityMax: 100, whiteBar: 50 } },
  rotation: ['甲 X X   # 注释里写 </script><b>', 'wait 10'],
})
const data = synthData([甲, idle('乙'), idle('丙')])
data.characters['甲']!.tunabilityRate = 1                          // 人造角色缺省偏谐效率 0
const r = resolveScenario(sc, data)
const res = simulate(r)
const template = readFileSync(new URL('../web/timeline.html', import.meta.url), 'utf8')

describe('时间轴网页', () => {
  test('模型：队伍的能量上限、敌人量表、排轴原文、各动作的类别；日志去掉判定生成', () => {
    const m = timelineModel('scenarios/demo.yaml', sc, r, res)
    expect(m.title).toBe('demo')
    expect(m.team.map(t => [t.name, t.energyCap])).toEqual([['甲', 100], ['乙', 100], ['丙', 100]])
    expect(m.enemy).toMatchObject({ tunabilityMax: 100, whiteBarTough: 50 })
    expect(m.kinds['甲']).toEqual({ X: 'skill' })
    expect(m.rotation[0]).toContain('</script>')
    expect((m.log as { type: string }[]).some(e => e.type === 'judgmentSpawn')).toBe(false)
    // 有量表的敌人：每次命中带上之后的偏谐值与白条
    expect(m.log.filter(e => e.type === 'hit').map(e => e.type === 'hit' && e.enemy)).toEqual([
      { tunability: 10, whiteBar: 40 }, { tunability: 20, whiteBar: 30 },
    ])
  })
  test('嵌入：数据里的 "<" 转义，取回来与原数据相同；标题换成队伍；独立网页带 doctype 与 charset，--fragment 不带', () => {
    const m = timelineModel('scenarios/demo.yaml', sc, r, res)
    const html = renderTimeline(template, m)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<title>甲·乙·丙 时间轴</title>')
    expect(html).not.toContain('</script><b>')
    const json = /<script id="timeline-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(m)))
    expect(html.indexOf('<title>')).toBeLessThan(html.indexOf('</head>'))
    const frag = renderTimeline(template, m, true)
    expect(frag.startsWith('<title>')).toBe(true)
    expect(frag).not.toContain('<!doctype')
  })
})
