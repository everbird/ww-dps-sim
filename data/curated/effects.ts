// data/curated/effects.ts —— 异常效应的规则（TD-06 §18）：「伤害计算」页各效应的说明文字写成数据。
// 只写用到的效应。层数、持续、结算周期按原文；逐层倍率以后从 dmg 的「异常伤害」行构建（结算还没接，假设 later-damage）。
import { defineEffect, type EffectModule } from '../../src/data/define'

const effects: EffectModule[] = [
  defineEffect({
    name: '电磁效应', element: '导电',
    source: '伤害计算 R1117（20261019 版）：每层持续15秒，重复获得刷新持续时间，常规上限10层。每5秒结算1次对应层数倍率异常伤害、'
      + '移除当前层数50%的异常层数。层数达到上限后，可额外叠加至多10层电磁爆发层数，下次结算电磁效应伤害时，额外附加当前电磁爆发层数倍率。'
      + '处于无敌状态时不生效。',
    maxStacks: 10, burstMax: 10, duration: 900, tickInterval: 300,
  }),
]

export default effects
