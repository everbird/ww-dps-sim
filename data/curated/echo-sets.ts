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
    name: '高天共奏之曲',                   // 莫特斐（Evariste 账号）。协同攻击 = 莫特斐的加强音（协同-加强音），现有角色只有他穿这套
    pieces: {
      2: [{ id: '高天共奏之曲.2', source: '共鸣效率提升10%', zone: 'energyRegen', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [
        {
          id: '高天共奏之曲.5', source: '当前角色协同攻击造成的伤害提升80%',
          zone: 'DamageChange', value: 0.8, filter: { judgments: ['协同-加强音'] }, target: 'self', duration: 'inf', trigger: 'always',
        },
        {
          // "且暴击时"按每发都触发：加强音每 0.38 秒一发、4 秒内十来发，几乎总有一发暴击（期望模式不分暴击，总设计 T4）
          id: '高天共奏之曲.5攻击', source: '协同攻击命中敌人且暴击时，队伍中登场角色攻击力提升20%，持续4秒。',
          zone: 'atkPct', value: 0.2, target: 'onField', duration: 240,
          trigger: { on: 'judgmentSettle', where: { judgments: ['协同-加强音'] } },
        },
      ],
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

  // 景燃 · 尤诺 · 守岸人（2026-10-24）。"获得护盾时"= shield 事件（护盾量不建模）
  defineEchoSet({
    name: '冥途夜行之灯',                   // 景燃。满 4 层时"热熔伤害提升15%"写在景燃的模块里（要看层数）
    pieces: {
      2: [{ id: '冥途夜行之灯.2', source: '生命提升10%', zone: 'hpPct', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [{
        id: '冥途夜行之灯.5', source: '角色获得护盾时，自身暴击提升5%，该效果可叠加4层，持续5秒，每0.5秒可触发一次。叠至满层时，自身造成的热熔伤害提升15%。',
        zone: 'critRate', value: 0.05, maxStacks: 4, icd: 30, target: 'self', duration: 300, trigger: { on: 'shield' },
      }],
    },
  }),
  defineEchoSet({
    name: '荣斗铸锋之冠',                   // 尤诺（三件套）
    pieces: {
      3: [
        {
          id: '荣斗铸锋之冠.3攻击', source: '角色获得护盾时，自身攻击提升6%，暴击伤害提升4%，该效果可叠加5层，持续4秒，每0.5秒可触发一次。',
          zone: 'atkPct', value: 0.06, maxStacks: 5, icd: 30, target: 'self', duration: 240, trigger: { on: 'shield' },
        },
        {
          id: '荣斗铸锋之冠.3暴伤', source: '角色获得护盾时，自身攻击提升6%，暴击伤害提升4%，该效果可叠加5层，持续4秒，每0.5秒可触发一次。',
          zone: 'critDamage', value: 0.04, maxStacks: 5, icd: 30, target: 'self', duration: 240, trigger: { on: 'shield' },
        },
      ],
    },
  }),
  defineEchoSet({
    name: '啸谷长风',                       // 尤诺（两件）
    pieces: {
      2: [{ id: '啸谷长风.2', source: '气动伤害提升10%', zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['气动'] }, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [{
        id: '啸谷长风.5', source: '使用变奏技能登场时，气动伤害提升30%，持续15秒',
        zone: 'DamageChangeElement', value: 0.3, filter: { elements: ['气动'] }, target: 'self', duration: 900, trigger: { on: 'intro' },
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
  defineEchoSet({
    name: '长路启航之星',                   // 爱弥斯
    pieces: {
      2: [{ id: '长路启航之星.2', source: '热熔伤害提升10%', zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['热熔'] }, target: 'self', duration: 'inf', trigger: 'always' }],
      // "为敌人添加【聚爆效应】或【震谐·偏移】时"：自己挂偏移（enemyState shift，TD-06 §19）
      5: [
        {
          id: '长路启航之星.5暴击', source: '角色为敌人添加【聚爆效应】或【震谐·偏移】时，自身暴击提升20%，热熔伤害提升20%，持续8秒。',
          zone: 'critRate', value: 0.2, target: 'self', duration: 480, trigger: { on: 'enemyState', where: { enemyState: 'shift' } },
        },
        {
          id: '长路启航之星.5热熔', source: '角色为敌人添加【聚爆效应】或【震谐·偏移】时，自身暴击提升20%，热熔伤害提升20%，持续8秒。',
          zone: 'DamageChangeElement', value: 0.2, filter: { elements: ['热熔'] }, target: 'self', duration: 480,
          trigger: { on: 'enemyState', where: { enemyState: 'shift' } },
        },
      ],
    },
  }),
  defineEchoSet({
    name: '逆光跃彩之约',                   // 琳奈
    pieces: {
      2: [{ id: '逆光跃彩之约.2', source: '衍射伤害提升10%', zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['衍射'] }, target: 'self', duration: 'inf', trigger: 'always' }],
      // "其每点谐度破坏增幅还会使攻击额外提升0.3%，上限15%"：按下一个登场角色的谐破增幅算，buff 定义里只能按持有者的属性换算——
      // 先只算前一半（攻击 +15%），后一半记在 docs/alm-confirm.md
      5: [{
        id: '逆光跃彩之约.5', source: '角色施放延奏技能后，下一个变奏技能登场的角色攻击提升15%，其每点谐度破坏增幅还会使攻击额外提升0.3%，上限15%，持续15秒，若切换至其他角色则该效果提前结束。',
        zone: 'atkPct', value: 0.15, target: 'nextIn', duration: 900, onSwitchOut: 'clear', trigger: { on: 'outro' },
      }],
    },
  }),
  defineEchoSet({
    name: '星构寻辉之环',                   // 莫宁
    pieces: {
      2: [{ id: '星构寻辉之环.2', source: '治疗效果提升10%', zone: 'healBonus', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' }],
      5: [{
        id: '星构寻辉之环.5', source: '为队伍中角色提供治疗时，自身每1%的偏谐值累积效率使队伍中角色攻击提升0.2%，上限25%，持续4秒，同名效果之间不可叠加。',
        zone: 'atkPct', value: 0.002, scale: { stat: 'tunabilityRate', per: 0.01, cap: 0.25 },
        target: 'team', duration: 240, trigger: { on: 'heal' },
      }],
    },
  }),
]

export default sets
