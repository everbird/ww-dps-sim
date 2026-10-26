// data/curated/echoes.ts —— 声骸技能的附加效果与覆盖（TD-01 §8、§13.3；TD-07 §4.1）
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
    name: '天演溯心',                       // 心、雷主的首位（雷主另有绝息魄在首位的对照场景 xin-team-r5-绝息魄.yaml）
    cost: 4,                                // `索引` 页查不到 COST（构建报告），扫描库存写 4
    qFor: { 心: 'Q·心召唤' },               // "若装配角色为心，则声骸技能将变为对更大范围内的敌人造成至多五段…和一段…的导电伤害"
    actionOverrides: { 'Q·心召唤': { accept: ['persistsGuess'] } },   // 召唤物的几段，脱手（同常规召唤）
    mainSlotBuffs: [
      {
        id: '天演溯心.首位', source: '在首位装配该声骸技能时，自身导电伤害加成提升10.00%',
        zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['导电'] }, target: 'self', duration: 'inf', trigger: 'always',
      },
      {
        // xlsx 伤害配置 R243"装备者赋予目标电磁效应、获得同奏/响应同奏后,雷伤加成+10%"；同奏的没写
        id: '天演溯心.附加后', source: '自身为目标附加【电磁效应】后，或自身获得同奏、响应同奏时，自身导电伤害加成额外提升10.00%，持续30秒。',
        zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['导电'] }, target: 'self', duration: 1800,
        trigger: { on: 'enemyState', where: { enemyState: 'effectApplied', effect: '电磁效应' } },
      },
    ],
  }),

  defineEcho({
    // 雷主特意放首位的 3 COST（2026-10-20 用户说明：延奏后给变奏登场的心导电伤害加成），对照场景 xin-team-r5-绝息魄.yaml；同无常凶鹭的写法
    name: '绝息魄',
    cost: 3,                                // `索引` 页查不到 COST（构建报告），扫描库存写 3
    // xlsx 没写结束帧，按最后一段推成 288 帧（noEnd）：召唤类，三段走独立时间线，角色自己这段优先级 0、什么都能打断，结束帧用不到
    actionOverrides: { 'Q·伤害': { accept: ['noEnd'] } },
    mainSlotBuffs: [
      {
        id: '绝息魄.监听', source: '使用声骸技能，召唤绝息魄……在此后15秒内，若自身施放延奏技能，使下一个变奏技能登场的角色导电伤害加成提升12.00%，持续15秒。',
        target: 'self', duration: 900, trigger: { on: 'actionStart', where: { actions: ['Q·伤害'] } },
      },
      {
        id: '绝息魄.导电', source: '在此后15秒内，若自身施放延奏技能，使下一个变奏技能登场的角色导电伤害加成提升12.00%，持续15秒。',
        zone: 'DamageChangeElement', value: 0.12, filter: { elements: ['导电'] }, target: 'nextIn', duration: 900,
        trigger: { on: 'outro', where: { ownerHas: '绝息魄.监听' } },
      },
    ],
  }),

  defineEcho({
    name: '梦魇·无冠者',
    actionOverrides: {
      // 以 nanoka 为准（2026-10-04 用户确认）："初始拥有3次可使用次数，每12秒可使用次数增加1次，可使用次数上限3次"；xlsx「冷却」列 20261003 版写 20 秒，20261019 版已改成 12 秒
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

  // 景燃 · 尤诺 · 守岸人（2026-10-24，docs/jys-confirm.md）
  defineEcho({
    name: '海之女',                         // 尤诺的首位
    mainSlotBuffs: [
      { id: '海之女.气动', source: '在首位装配该声骸技能时，自身气动伤害加成提升12.00%', zone: 'DamageChangeElement', value: 0.12, filter: { elements: ['气动'] }, target: 'self', duration: 'inf', trigger: 'always' },
      { id: '海之女.大招', source: '在首位装配该声骸技能时，……共鸣解放伤害加成提升12.00%', zone: 'DamageChangeType', value: 0.12, filter: { tags: ['共鸣解放'] }, target: 'self', duration: 'inf', trigger: 'always' },
    ],
    // 召唤类，走独立时间线（同天演溯心）。龙卷1、龙卷2 各"持续帧内每12F一次"、58 帧 → 各 5 次，合计"至多十段"；
    // 黑潮只聚怪不出伤害，"持续帧结束后生成爆炸"：爆炸在黑潮的第 60 帧（第 61 帧）生成
    actionOverrides: {
      'Q·龙卷1': { accept: ['noEnd'], judgments: { 龙卷1: { ticks: 5 }, 龙卷2: { ticks: 5 }, 黑潮爆炸: { spawnFrame: 61 } } },
    },
  }),
  defineEcho({
    name: '万囮牢',                         // 景燃的首位
    mainSlotBuffs: [
      { id: '万囮牢.热熔', source: '在首位装配该声骸技能时，自身热熔伤害加成提升12.00%', zone: 'DamageChangeElement', value: 0.12, filter: { elements: ['热熔'] }, target: 'self', duration: 'inf', trigger: 'always' },
      { id: '万囮牢.重击', source: '在首位装配该声骸技能时，……重击伤害加成提升12.00%', zone: 'DamageChangeType', value: 0.12, filter: { tags: ['重击'] }, target: 'self', duration: 'inf', trigger: 'always' },
    ],
    // 倍率按 nanoka（dmg-join.json）："首次……10.20%生命上限，……至多19次，每次……0.37%生命上限"：遛弯-2 每 6 帧一次、108 帧 → 18 次，取原文 19 次
    actionOverrides: { 'Q·遛弯': { judgments: { '遛弯-2': { ticks: 19, lifeFrames: 115 } } } },
  }),

  // 以下四个的「冷却」列与解包（Wuthery 3.7.15 PhantomSkill）、nanoka 3.7 不同，以后两者为准（docs/wuthery-data-crosscheck-2026-10-21.md）
  defineEcho({
    name: '梦魇·无常凶鹭',
    // xlsx「冷却」列与说明都写 20 秒（像照抄了无常凶鹭），解包与 nanoka 25 秒
    actionOverrides: { 'Q·大鸟转转转': { cooldown: 1500 } },
  }),
  defineEcho({
    name: '梦魇·赫卡忒',
    // xlsx「冷却」列 20 秒，说明、解包、nanoka 25 秒
    actionOverrides: { 'Q·跃起': { cooldown: 1500 } },
  }),
  defineEcho({
    name: '角鳄',
    // xlsx「冷却」列 20 秒，说明、解包、nanoka 15 秒
    actionOverrides: { 'Q·跳砸': { cooldown: 900 } },
  }),
  defineEcho({
    name: '霁息兽尊',
    // xlsx「冷却」列 15 秒，说明、解包、nanoka 20 秒
    actionOverrides: { 'Q·喷火': { cooldown: 1200 } },
  }),
  defineEcho({
    name: '辛吉勒姆',                       // 爱弥斯的首位（异相·辛吉勒姆）
    mainSlotBuffs: [{
      id: '辛吉勒姆.大招', source: '在首位装配该声骸技能时，若装配角色为爱弥斯，则自身共鸣解放伤害加成提升25.00%。',
      zone: 'DamageChangeType', value: 0.25, filter: { tags: ['共鸣解放'] }, target: 'self', duration: 'inf', trigger: 'always',
    }],
    // 召唤类（脱手）：xlsx 的优先级写 2（与普攻同级），普攻要等召唤物整段（80 帧）放完才接得上；
    // 用户确认放了声骸机兵 A3 照样接得上（2026-10-25），按其他召唤声骸（海之女、海维夏、万囮牢）写 0：放完立刻能接
    actionOverrides: { 'Q·A': { priority: [{ fromFrame: 0, value: 0 }] } },
  }),
  defineEcho({
    name: '梦魇·云闪之鳞',                  // 渊武的首位（视频 BV1o7kfBPE6y 的配装）
    mainSlotBuffs: [
      { id: '梦魇·云闪之鳞.导电', source: '在首位装配该声骸技能时，自身导电伤害加成提升12.00%，共鸣解放伤害加成提升12.00%。', zone: 'DamageChangeElement', value: 0.12, filter: { elements: ['导电'] }, target: 'self', duration: 'inf', trigger: 'always' },
      { id: '梦魇·云闪之鳞.大招', source: '在首位装配该声骸技能时，……共鸣解放伤害加成提升12.00%。', zone: 'DamageChangeType', value: 0.12, filter: { tags: ['共鸣解放'] }, target: 'self', duration: 'inf', trigger: 'always' },
    ],
  }),
  defineEcho({
    name: '异构武装',                       // 散华的首位（桃渊散录像 BV1o7kfBPE6y）；声骸表里没有，extra-echoes.json 补的（帧取 WuwaLAB）
    mainSlotBuffs: [
      { id: '异构武装.冷凝', source: '在首位装配该声骸技能时，自身获得12.00%冷凝伤害加成提升，12.00%共鸣技能伤害加成提升。', zone: 'DamageChangeElement', value: 0.12, filter: { elements: ['冷凝'] }, target: 'self', duration: 'inf', trigger: 'always' },
      { id: '异构武装.共鸣技能', source: '在首位装配该声骸技能时，……12.00%共鸣技能伤害加成提升。', zone: 'DamageChangeType', value: 0.12, filter: { tags: ['共鸣技能'] }, target: 'self', duration: 'inf', trigger: 'always' },
    ],
    // 一下近战命中：存在帧、命中后留不留都不影响（只打一下）
    actionOverrides: { 'Q·幻形': { accept: ['noLife', 'persistsGuess'] } },
    // "装配角色施放共鸣解放时，可持续提升「强袭功率」，升满时重置冷却、可放强化版"：每次大招加多少没有来源，没建
  }),
  defineEcho({
    name: '赫卡忒',                         // 莫特斐的首位（Evariste 账号，景莫守 jms-5r18z.yaml）
    // 协同攻击：现有角色里只有莫特斐的加强音（协同-加强音，1 / 5 链的额外加强音同名）
    mainSlotBuffs: [{
      id: '赫卡忒.协同', source: '在首位装配该声骸技能时，自身协同攻击造成的伤害提升40.00%。',
      zone: 'DamageChange', value: 0.4, filter: { judgments: ['协同-加强音'] }, target: 'self', duration: 'inf', trigger: 'always',
    }],
    // 召唤类（脱手），结束帧是推的；三个冥月侍女各 3 段（"逆势回击时重置存在时间"不建模）
    actionOverrides: { 'Q·冥月侍女': { accept: ['noEnd'] } },
  }),
  defineEcho({
    name: '炉芯机骸',                       // 莫宁的首位
    mainSlotBuffs: [{ id: '炉芯机骸.共鸣效率', source: '在首位装配该声骸技能时，自身共鸣效率提升10.00%。', zone: 'energyRegen', value: 0.1, target: 'self', duration: 'inf', trigger: 'always' }],
  }),
  defineEcho({
    name: '海维夏',                         // 琳奈的首位
    mainSlotBuffs: [{
      // "在此后15秒内，若自身施放延奏技能"：按 Q 之后 15 秒内的延奏算——Q 起手挂 15 秒标记，延奏时有标记才给下一位
      id: '海维夏.窗口', source: '使用声骸技能……在此后15秒内', target: 'self', duration: 900, trigger: { on: 'actionStart', where: { actionKinds: ['echo'] } },
    }, {
      id: '海维夏.全属性', source: '在此后15秒内，若自身施放延奏技能，使下一个变奏技能登场的角色全属性伤害加成提升10.00%，持续15秒。',
      zone: 'DamageChangeElement', value: 0.1, filter: { elements: ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] },
      target: 'nextIn', duration: 900, trigger: { on: 'outro', where: { ownerHas: '海维夏.窗口' } },
    }],
    // 十道激光：每个棱镜"持续帧结束后生成激光"（棱镜持续 132 帧，激光 27.36%）。按棱镜出现后延迟 132 帧出伤害写，倍率按 nanoka
    actionOverrides: {
      'Q·棱镜1': {
        accept: ['noEnd'],
        judgments: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`棱镜${i + 1}`, { multiplier: 0.2736, element: '衍射' as const, relatedAttr: 'atk' as const, delayFrames: 132 }])),
      },
    },
  }),
]

export default echoes
