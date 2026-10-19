// data/curated/echo-sets.ts —— 声骸套装的件数效果（总设计 §3.2、TD-07 §10）
// 文本取 nanoka 3.7（nanoka.json 的 echoSets）；乘区按 xlsx「伤害配置」buff 库的分区。持有者是穿这套的角色。
import type { TriggerSpec } from '../../src/data/buff.schema'
import { defineEchoSet, type EchoSetModule } from '../../src/data/define'

/** 穿这套的角色为目标附加电磁效应时（TD-06 §18；"获得同奏、响应同奏"是同奏模态的，没写） */
const ELECTRO: TriggerSpec = { on: 'enemyState', where: { by: 'self', enemyState: 'effectApplied', effect: '电磁效应' } }
const 导电 = { elements: ['导电' as const] }

const sets: EchoSetModule[] = [
  defineEchoSet({
    name: '沉日劫明',                       // 椿（docs/test-echos-setup.md）
    pieces: {
      2: [{
        id: '沉日劫明.2', source: '湮灭伤害提升10%',
        zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['湮灭'] }, target: 'self', duration: 'inf', trigger: 'always',
      }],
      5: [{
        // xlsx 暗套·5"暗伤加成+7.5%,上限4层"（分区"暗 · C声骸套装"）；"使用"= 施放普攻 / 重击类动作（技能归类，TD-07 §4.3）
        id: '沉日劫明.5', source: '使用普攻或重击时，湮灭伤害提升7.5%，该效果可叠加四层，持续15秒',
        zone: 'DamageChangeElement', value: 0.075, filter: { elements: ['湮灭'] }, target: 'self', maxStacks: 4, duration: 900,
        trigger: { on: 'actionStart', where: { actionKinds: ['normal', 'heavy'] } },
      }],
    },
  }),

  defineEchoSet({
    name: '轻云出月',                       // 散华
    pieces: {
      2: [{ id: '轻云出月.2', source: '共鸣效率提升10%', zone: 'energyRegen', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [{
        // xlsx 轻云套·5"变奏出场角色攻击加成+22.5%"（分区"攻击 · F声骸套装"）
        id: '轻云出月.5', source: '使用延奏技能后，下一个登场的共鸣者攻击提升22.5%，持续15秒',
        zone: 'atkPct', value: 0.225, target: 'nextIn', duration: 900, trigger: { on: 'outro' },
      }],
    },
  }),

  defineEchoSet({
    name: '隐世回光',                       // 维里奈
    pieces: {
      2: [{ id: '隐世回光.2', source: '治疗效果提升10%', zone: 'healBonus', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [{
        // xlsx 奶套·5"全队攻击+15%"（分区"攻击 · F声骸套装"）。"提供治疗"= 治疗事件：角色模块给带治疗的判定标 heals、
        // 持续回复由钩子每跳记一次（维里奈，m0-confirm §7）；治疗量不建模
        id: '隐世回光.5', source: '自身为友方提供治疗时，全队共鸣者攻击提升15%，持续30秒',
        zone: 'atkPct', value: 0.15, target: 'team', duration: 1800, trigger: { on: 'heal' },
      }],
    },
  }),

  defineEchoSet({
    name: '衔梦照世之心',                   // 心（xlsx 伤害配置 R164、R165"心锁套"）
    pieces: {
      2: [{ id: '衔梦照世之心.2', source: '导电伤害提升10%', zone: 'DamageChangeElement', value: 0.1, filter: 导电, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [
        {
          id: '衔梦照世之心.5暴击', source: '角色为敌人添加【电磁效应】时，或自身获得同奏、响应同奏时，自身暴击提升15%，导电伤害提升22.5%，持续30秒。',
          zone: 'critRate', value: 0.15, target: 'self', duration: 1800, trigger: ELECTRO,
        },
        {
          id: '衔梦照世之心.5导电', source: '角色为敌人添加【电磁效应】时，或自身获得同奏、响应同奏时，自身暴击提升15%，导电伤害提升22.5%，持续30秒。',
          zone: 'DamageChangeElement', value: 0.225, filter: 导电, target: 'self', duration: 1800, trigger: ELECTRO,
        },
      ],
    },
  }),

  defineEchoSet({
    name: '镜影流电之瞬',                   // 雷主（xlsx 伤害配置 R166–R168"电磁套"）
    pieces: {
      2: [{ id: '镜影流电之瞬.2', source: '导电伤害提升10%', zone: 'DamageChangeElement', value: 0.1, filter: 导电, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [
        {
          id: '镜影流电之瞬.5', source: '角色为敌人添加【电磁效应】时，自身获得下述效果：导电伤害提升10%，持续15秒。',
          zone: 'DamageChangeElement', value: 0.1, filter: 导电, target: 'self', duration: 900, trigger: ELECTRO,
        },
        {
          // xlsx R168"上述效果持续期间,触发装备者延奏技能的变奏出场角色雷伤加成+25%,持续15秒"
          id: '镜影流电之瞬.5延奏', source: '持续期间内施放延奏技能后，下一个变奏技能登场的角色导电伤害提升25%，持续15秒。',
          zone: 'DamageChangeElement', value: 0.25, filter: 导电, target: 'nextIn', duration: 900,
          trigger: { on: 'outro', where: { ownerHas: '镜影流电之瞬.5' } },
        },
      ],
    },
  }),
]

export default sets
