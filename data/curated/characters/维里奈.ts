// data/curated/characters/维里奈.ts —— 角色模块（M0 只填 xlsx 没有的信息；buff 与钩子在 M2 / M3 按 TD-07 / TD-08 补）
import { defineCharacter } from '../../../src/data/define'

export default defineCharacter('维里奈', {
  weaponType: '音感仪',
  treeStats: { '治疗效果加成': 0.12, '攻击%': 0.12 },   // 技能树属性节点合计（nanoka 3.7 skill_trees）
  aliases: { E: 'E', R: '大招', QTE: 'QTE' },
  actionOverrides: {
    // A3 的三行是同一段普攻的互斥情形（倍率相同）；打单体默认目标在 3m 内，另两行去掉，否则会算三次伤害（m0-confirm 2.1）
    A3: { dropRows: ['A3-无目标/3m外', 'A3-地面出场技'] },
    E: { cooldown: 720 },                  // 共鸣技能冷却 12 秒，不是按次数充能（2026-09-27 用户提供）
    大招: { cooldown: 1500 },              // 共鸣解放冷却 25 秒（nanoka 3.7）
  },
})
