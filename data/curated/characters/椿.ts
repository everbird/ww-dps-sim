// data/curated/characters/椿.ts —— 角色模块（M0 只填 xlsx 没有的信息；buff 与钩子在 M2 / M3 按 TD-07 / TD-08 补）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('椿', {
  weaponType: '迅刀',
  aliases: { E: 'E1', R: '大招', QTE: 'QTE' },
  actionOverrides: {
    // 共鸣技能冷却 4 秒，E1 / E2 / E3 共用一个冷却，不是各算各的（2026-09-27 用户提供；查证：nanoka.cc、库街区 wiki）
    E1: { cooldown: 240, cooldownGroup: 'E' },
    E2: { cooldown: 240, cooldownGroup: 'E' },
    E3: { cooldown: 240, cooldownGroup: 'E' },
  },
})
