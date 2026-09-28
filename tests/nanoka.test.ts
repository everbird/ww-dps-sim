// tests/nanoka.test.ts —— 手填冷却与 nanoka 的核对（src/data/nanoka-check.ts；m0-confirm §5）
// 人造数据的用例总能跑；M0 队伍的用例依赖 data/generated/nanoka.json（pnpm build:data 联网取到后才有），没有时跳过。
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { NanokaFileSchema, type NanokaCharacter } from '../src/data/generated.schema'
import { checkCooldowns } from '../src/data/nanoka-check'
import 椿 from '../data/curated/characters/椿'
import 散华 from '../data/curated/characters/散华'
import 维里奈 from '../data/curated/characters/维里奈'
import { action, character, hasData } from './helpers/kernel-harness'

const skill = (type: string, name: string, cds: [string, number][]): NanokaCharacter['skills'][number] =>
  ({ type, name, desc: '', cooldowns: cds.map(([n, s]) => ({ name: n, seconds: s, frames: s * 60 })) })
const nk: NanokaCharacter = {
  id: 1, name: '甲', chains: [],
  skills: [skill('共鸣技能', '技', [['冷却时间', 4]]), skill('共鸣解放', '解', [['冷却时间', 25]]), skill('共鸣回路', '回', [['一日花冷却时间', 25]])],
}
const aliases = { E: 'E1', R: '大招' }

describe('nanoka 冷却核对', () => {
  test('都对得上：不报', () => {
    const acts = { E1: action({ id: 'E1', cooldown: 240 }), 大招: action({ id: '大招', cooldown: 1500 }), E3: action({ id: 'E3', cooldown: 1500 }) }
    expect(checkCooldowns(acts, aliases, nk)).toEqual([])
  })
  test('别名指向的动作缺冷却、数不同；别的动作的冷却 nanoka 里没有；声骸不管', () => {
    const acts = {
      E1: action({ id: 'E1', cooldown: 300 }), 大招: action({ id: '大招' }),
      X: action({ id: 'X', cooldown: 60 }), 声骸: action({ id: '声骸', kind: 'echo', cooldown: 999 }),
    }
    expect(checkCooldowns(acts, aliases, nk)).toEqual([
      'E1（E）冷却 5 秒（300 帧），nanoka 共鸣技能「技」是 4 秒（240 帧）',
      '大招（R）没有冷却；nanoka 共鸣解放「解」冷却时间 25 秒（1500 帧）',
      'E1 冷却 5 秒（300 帧），nanoka 里没有这个数（有：共鸣技能·冷却时间 4 秒、共鸣解放·冷却时间 25 秒、共鸣回路·一日花冷却时间 25 秒）',
      'X 冷却 1 秒（60 帧），nanoka 里没有这个数（有：共鸣技能·冷却时间 4 秒、共鸣解放·冷却时间 25 秒、共鸣回路·一日花冷却时间 25 秒）',
    ])
  })
})

const NANOKA = new URL('../data/generated/nanoka.json', import.meta.url)
const m0 = hasData && existsSync(NANOKA) ? describe : describe.skip
m0('M0 队伍的冷却与 nanoka 一致（椿 E1 / E2 4 秒、E3 25 秒、大招 25 秒；散华 E 10 秒、大招 16 秒；维里奈 E 12 秒、大招 25 秒）', () => {
  const file = () => NanokaFileSchema.parse(JSON.parse(readFileSync(NANOKA, 'utf8')))
  for (const [mod, chain] of [[椿, 0], [散华, 6], [维里奈, 3]] as const) {
    test(mod.name, () => {
      expect(checkCooldowns(character(mod, chain), mod.aliases ?? {}, file().characters[mod.name]!)).toEqual([])
    })
  }
})
