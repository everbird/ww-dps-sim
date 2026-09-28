// data/curated/characters/椿.ts —— 角色模块（M0 只填 xlsx 没有的信息；buff 与钩子在 M2 / M3 按 TD-07 / TD-08 补）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('椿', {
  weaponType: '迅刀',
  aliases: { E: 'E1', R: '大招', QTE: 'QTE' },
  actionOverrides: {
    // 共鸣技能（2026-09-27 用户说明，出处：nanoka 的共鸣技能与共鸣回路描述）：
    //   白椿状态 E1 → 变红椿（盛绽）；红椿状态 E2 → 变回白椿；E1 / E2 共用 4 秒冷却
    //   协奏满且一日花不在冷却时，E 替换为 E3 一日花（不限白椿 / 红椿），消耗 70 点协奏、进入含苞状态；
    //   一日花单独 25 秒冷却（nanoka 共鸣回路；6 链文本"独立冷却25秒的一日花"也印证）
    //   状态与协奏条件由角色钩子 canStart 判断（TD-08），协奏消耗归 TD-06，这里只写冷却
    E1: { cooldown: 240, cooldownGroup: 'E' },
    E2: { cooldown: 240, cooldownGroup: 'E' },
    E3: { cooldown: 1500 },
  },
})
