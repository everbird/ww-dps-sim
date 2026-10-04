"""base 表的声骸属性（TD-01 §5.4）→ echo-stats.json：主词条满级值、固定副主属性、副词条各档。

第 55 行表头，56 行起是数据；列按表头名找（base_cols.py，括号里是 20260707 版的位置）：
  PhantomBase.MainProp（AY–BC）：主词条（属性 ID、AddType、StandardProperty、说明、COST），说明是满级值，如"暴击22%""冷凝30%"
  PhantomBase.SubProp（BD–BH）：固定副主属性（4C 攻击 150、3C 攻击 100、1C 生命 2280）
  PhantomModel.SubAttribute.Rand…（BR–CK）：副词条各档，每种两列（显示值、精确值 .Calcu），取显示值（游戏里看到的、场景里写的都是它）
暴击、暴伤两列的表头都叫 Rand901：按出现顺序，第一个是暴击，第二个是暴伤。
"""
from __future__ import annotations

import re
from decimal import Decimal

from base_cols import BaseCols
from parse import Issues, as_num, blank

# 副词条：显示值那一列的（表头名, 第几个）→ 属性（一张表可以给几种属性用：普攻 / 重击 / 共鸣技能 / 共鸣解放伤害加成共用 RandSkillType01）
_R = 'PhantomModel.SubAttribute.Rand'
SUB_COLS = {
    (_R + '1000701', 1): ['攻击'], (_R + '1000201', 1): ['生命'], (_R + '1001001', 1): ['防御'],
    (_R + '1000702', 1): ['攻击%'], (_R + '1000202', 1): ['生命%'], (_R + '1001002', 1): ['防御%'],
    (_R + 'SkillType01', 1): ['普攻伤害加成', '重击伤害加成', '共鸣技能伤害加成', '共鸣解放伤害加成'],
    (_R + '901', 1): ['暴击率'], (_R + '901', 2): ['暴击伤害'], (_R + '1101', 1): ['共鸣效率'],
}
_ELEMENTS = {'冷凝', '热熔', '导电', '气动', '衍射', '湮灭'}
_PCT = {'攻击': '攻击%', '生命': '生命%', '防御': '防御%', '暴击': '暴击率', '暴伤': '暴击伤害', '治疗': '治疗效果加成', '共鸣效率': '共鸣效率'}
_FLAT = {'攻击': '攻击', '生命': '生命', '防御': '防御'}


def stat_of_desc(desc: str) -> tuple[str, float] | None:
    """'暴击22%' → ('暴击率', 0.22)，'冷凝30%' → ('冷凝伤害加成', 0.3)，'攻击150' → ('攻击', 150)；认不出为 None"""
    m = re.fullmatch(r'(\D+?)([\d.]+)(%?)', desc.strip())
    if not m:
        return None
    name, num, pct = m.group(1), Decimal(m.group(2)), m.group(3) == '%'
    if pct:
        key = f'{name}伤害加成' if name in _ELEMENTS else _PCT.get(name)
        return (key, float(num / 100)) if key else None
    key = _FLAT.get(name)
    return (key, as_num(float(num))) if key else None


def build_echo_stats(rows: list, issues: Issues) -> dict:
    """rows：base 表第 55 行起、A 列起的各行（values_only）"""
    def cell(r, i):
        return r[i] if i < len(r) else None

    col = BaseCols(rows[0])
    i_main, i_main_cost = col('PhantomBase.MainProp.Desc'), col('PhantomBase.MainProp.Cost')
    i_sub, i_sub_cost = col('PhantomBase.SubProp.Desc'), col('PhantomBase.SubProp.Cost')
    mains, fixed = [], []
    for n, r in enumerate(rows[1:], start=56):
        r = list(r)
        desc, cost = cell(r, i_main), cell(r, i_main_cost)
        if isinstance(desc, str) and isinstance(cost, (int, float)) and cost in (1, 3, 4):
            st = stat_of_desc(desc)
            if st:
                mains.append({'cost': int(cost), 'stat': st[0], 'value': st[1]})
            elif not desc.startswith('—') and desc != '空':
                issues.add('warn', '声骸主词条认不出', f'base 第 {n} 行：{desc}')
        desc, cost = cell(r, i_sub), cell(r, i_sub_cost)
        if isinstance(desc, str) and isinstance(cost, (int, float)) and cost in (1, 3, 4):
            st = stat_of_desc(desc)
            if st:
                fixed.append({'cost': int(cost), 'stat': st[0], 'value': st[1]})
    tiers: dict[str, list] = {}
    for (name, nth), keys in SUB_COLS.items():
        i = col(name, nth)
        vals = []
        for r in rows[1:]:
            v = cell(list(r), i)
            if blank(v):
                break
            vals.append(as_num(float(v)))
        for k in keys:
            tiers[k] = vals
    return {'mains': mains, 'fixedSubs': fixed, 'subTiers': tiers}
