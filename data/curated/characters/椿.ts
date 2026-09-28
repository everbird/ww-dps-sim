// data/curated/characters/椿.ts —— 角色模块（M0 只填 xlsx 没有的信息；buff 与钩子在 M2 / M3 按 TD-07 / TD-08 补）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('椿', {
  weaponType: '迅刀',
  aliases: { E: 'E1', R: '大招', QTE: 'QTE' },
  actionOverrides: {
    // 共鸣技能（2026-09-27 用户说明，出处：nanoka 的共鸣技能与共鸣回路描述）：
    //   白椿状态 E1 → 变红椿（盛绽）；红椿状态 E2 → 变回白椿；E1 / E2 共用 4 秒冷却
    //   红椿状态且协奏满时 E3 放一日花，放完仍是红椿；一日花单独 15 秒冷却
    //   状态与协奏条件由角色钩子 canStart 判断（TD-08），这里只写冷却
    E1: { cooldown: 240, cooldownGroup: 'E' },
    E2: { cooldown: 240, cooldownGroup: 'E' },
    E3: { cooldown: 900 },
  },
})
