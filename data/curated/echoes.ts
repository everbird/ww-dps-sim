// data/curated/echoes.ts —— 声骸技能的附加效果与覆盖（TD-01 §8、§13.3；AGENTS.md 差异 1、2）
// 声骸技能只能从首位施放，所以这里的 buff 与资源型效果只在该声骸装在首位时登记，持有者是装备它的角色。
// 动作 ID 是 'Q·<组名>'（pnpm check:data -- --flags <声骸名> 列出各组、各判定的倍率来源与 nanoka 说明）。
// 乘区按 xlsx「伤害配置」buff 库的分区（TD-07 §10）。异相只换配色、数值同本体（2026-10-04 用户确认），写本体。
import { defineEcho, type EchoModule } from '../../src/data/define'

const echoes: EchoModule[] = [
  defineEcho({
    name: '无妄者',                         // 椿的首位（异相·无妄者，docs/test-echos-setup.md）
    actionOverrides: {
      // 斩击5 的结束帧 60 是前 5 段没命中就收手；命中后接斩击6（第 123 帧，也是它的结束帧）。打单体默认都命中
      'Q·斩击': { endFrame: 123 },
    },
    // "漂泊者·湮灭在施放临渊死寂后 5 秒内，该声骸技能伤害提升 50%"只对漂泊者，不写
  }),

  defineEcho({
    name: '无常凶鹭',                       // 散华的首位
    mainSlotBuffs: [
      {
        // 备注"变身立即获得15秒BUFF监听"：15 秒内放延奏才给下一位变奏登场的角色增伤
        id: '无常凶鹭.监听', source: '幻形后……在此后15秒内，若自身施放延奏技能，则可使下一个变奏登场的角色伤害提升12%',
        target: 'self', duration: 900, trigger: { on: 'actionStart', where: { actions: ['Q·砸地', 'Q·喷火'] } },
      },
      {
        // xlsx buff 库"变奏出场角色伤害加成+12%"，分区"造成伤害15" = 通用伤害加成
        id: '无常凶鹭.伤害提升', source: '在此后15秒内，若自身施放延奏技能，则可使下一个变奏登场的角色伤害提升12%，持续15秒。',
        zone: 'DamageChange', value: 0.12, target: 'nextIn', duration: 900,
        trigger: { on: 'outro', where: { ownerHas: '无常凶鹭.监听' } },
      },
    ],
    resourceEffects: [
      {
        // "首次"：长按喷火最多 13 段，只回一次；内置冷却取技能冷却 20 秒，下一次施放前一定过了
        id: '无常凶鹭.回能', source: '幻形后首次命中敌人，回复自身10点共鸣能量',
        resource: 'energy', amount: 10, icd: 1200, trigger: { on: 'judgmentSettle', where: { actions: ['Q·砸地', 'Q·喷火'] } },
      },
    ],
  }),

  defineEcho({
    name: '无归的谬误',                     // 维里奈的首位（异相·无归的谬误）
    actionOverrides: {
      // 点按只有"爆气"一击（第 43 帧，结束帧 100）；拳击循环与两种终结是长按版，同在一个「类型」格里，点按不打。长按版不建
      'Q·爆气': { dropRows: ['拳击循环-1', '拳击循环-2', '拳击循环-3', '拳击循环-4', '拳击循环-5', '拳击循环-6', '拳击循环-7', '连续拳击终结', '终结拳'] },
    },
    mainSlotBuffs: [
      {
        // 备注"召唤立即获得BUFF"；xlsx buff 库"全队攻击加成+10%"，分区"攻击 · F声骸技能"
        id: '无归的谬误.攻击', source: '使用声骸技能……使自身共鸣效率提升10%，全队角色攻击提升10%，持续20秒。',
        zone: 'atkPct', value: 0.1, target: 'team', duration: 1200, trigger: { on: 'actionStart', where: { actions: ['Q·爆气'] } },
      },
      {
        id: '无归的谬误.共鸣效率', source: '使用声骸技能……使自身共鸣效率提升10%，全队角色攻击提升10%，持续20秒。',
        zone: 'energyRegen', value: 0.1, target: 'self', duration: 1200, trigger: { on: 'actionStart', where: { actions: ['Q·爆气'] } },
      },
    ],
  }),

  defineEcho({
    name: '梦魇·无冠者',
    actionOverrides: {
      // 以 nanoka 为准（2026-10-04 用户确认）："初始拥有3次可使用次数，每12秒可使用次数增加1次，可使用次数上限3次"；xlsx「冷却」列写 20 秒
      'Q·斩击': { cooldown: 720, charges: 3 },
    },
    mainSlotBuffs: [
      {
        id: '梦魇·无冠者.首位湮灭', source: '在首位装配该声骸技能时，自身湮灭伤害加成提升12.00%，普攻伤害加成提升12.00%。',
        zone: 'DamageChangeElement', value: 0.12, filter: { elements: ['湮灭'] }, target: 'self', duration: 'inf', trigger: 'always',
      },
      {
        id: '梦魇·无冠者.首位普攻', source: '在首位装配该声骸技能时，自身湮灭伤害加成提升12.00%，普攻伤害加成提升12.00%。',
        zone: 'DamageChangeType', value: 0.12, filter: { tags: ['普攻'] }, target: 'self', duration: 'inf', trigger: 'always',
      },
      {
        // xlsx buff 库"梦魇·无冠者声骸技能伤害加成+20%"，分区"造成伤害15"；命中的那一段自己不吃（同帧"xxx 后"）
        id: '梦魇·无冠者.命中后', source: '梦魇·无冠者命中目标后，该声骸技能造成的伤害提升20.00%，持续2秒，不可叠加。',
        zone: 'DamageChange', value: 0.2, filter: { actions: ['Q·斩击'] }, target: 'self', duration: 120,
        trigger: { on: 'judgmentSettle', where: { actions: ['Q·斩击'] } },
      },
    ],
  }),
]

export default echoes
