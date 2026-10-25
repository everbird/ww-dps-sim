// tests/core-check.test.ts —— 核心资源槽的核对（src/data/core-check.ts，docs/alm-confirm.md Y1）
import { describe, expect, test } from 'vitest'
import { checkCoreCaps } from '../src/data/core-check'
import { action, judgment } from './helpers/kernel-harness'

describe('核心资源槽：一次加 / 扣的量比上限大就提示', () => {
  // 爱弥斯那样：动作表"核心1"列加的是同步率（变奏 +40），主表把槽 1 叫"共鸣率"、上限 4
  const acts = {
    QTE: action({ id: 'QTE', kind: 'intro', castGains: [{ atFrame: 0, resource: 'core1', amount: 40 }] }),
    A1: action({ id: 'A1', judgments: [judgment({ name: 'a', gains: { energy: 0, concerto: 0, core: [3, 0, 0] } })] }),
  }
  test('上限比单次获得小：提示槽名或上限对不上', () => {
    expect(checkCoreCaps(acts, [{ slot: 1, name: '共鸣率', cap: 4 }])).toEqual([
      '槽 1「共鸣率」上限 4，QTE 起手 一次 +40：槽名或上限可能和动作表的列对不上（角色模块写 coreNames / coreCaps）',
    ])
    expect(checkCoreCaps(acts, [{ slot: 1, name: '同步率', cap: 200 }])).toEqual([])
  })
  test('用到了但上限 ≥ 1000：多半按百分数记的；没用到的占位槽不提示', () => {
    expect(checkCoreCaps(acts, [{ slot: 1, name: '静能', cap: 10000 }])).toHaveLength(1)
    expect(checkCoreCaps(acts, [{ slot: 4, name: '核心能量4', cap: 6000 }])).toEqual([])
  })
})
