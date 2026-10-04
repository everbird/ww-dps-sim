"""base 表的声骸属性（TD-01 §5.4）→ echo-stats.json：主词条满级值、固定副主属性、副词条各档。

第 55 行表头，56 行起是数据：
  AY–BC  PhantomBase.MainProp：主词条（属性 ID、AddType、StandardProperty、说明、COST），说明是满级值，如"暴击22%""冷凝30%"
  BD–BH  PhantomBase.SubProp：固定副主属性（4C 攻击 150、3C 攻击 100、1C 生命 2280）
  BR–CK  PhantomModel.SubAttribute.Rand…：副词条各档，每种两列（显示值、精确值 .Calcu），取显示值（游戏里看到的、场景里写的都是它）
副词条按列对应属性：表头的名字不全可靠（暴击、暴伤两列都写 Rand901），所以按列写死，表头只用来核对。
"""
from __future__ import annotations

import re
from decimal import Decimal

from openpyxl.utils import column_index_from_string as ci

from parse import Issues, as_num, blank

# 副词条：显示值所在列 → 属性（一张表可以给几种属性用：普攻 / 重击 / 共鸣技能 / 共鸣解放伤害加成共用 RandSkillType01）
SUB_COLS = {
    'BR': ['攻击'], 'BT': ['生命'], 'BV': ['防御'],
    'BX': ['攻击%'], 'BZ': ['生命%'], 'CB': ['防御%'],
    'CD': ['普攻伤害加成', '重击伤害加成', '共鸣技能伤害加成', '共鸣解放伤害加成'],
    'CF': ['暴击率'], 'CH': ['暴击伤害'], 'CJ': ['共鸣效率'],
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
    def cell(r, col):
        i = ci(col) - 1
        return r[i] if i < len(r) else None

    head = rows[0]
    for col in SUB_COLS:
        h = cell(head, col)
        if not (isinstance(h, str) and h.startswith('PhantomModel.SubAttribute.Rand')):
            issues.add('warn', '声骸副词条表头不符', f'base {col}55: {h!r}')
    mains, fixed = [], []
    for n, r in enumerate(rows[1:], start=56):
        r = list(r)
        desc, cost = cell(r, 'BB'), cell(r, 'BC')
        if isinstance(desc, str) and isinstance(cost, (int, float)) and cost in (1, 3, 4):
            st = stat_of_desc(desc)
            if st:
                mains.append({'cost': int(cost), 'stat': st[0], 'value': st[1]})
            elif not desc.startswith('—') and desc != '空':
                issues.add('warn', '声骸主词条认不出', f'base BB{n}: {desc}')
        desc, cost = cell(r, 'BG'), cell(r, 'BH')
        if isinstance(desc, str) and isinstance(cost, (int, float)) and cost in (1, 3, 4):
            st = stat_of_desc(desc)
            if st:
                fixed.append({'cost': int(cost), 'stat': st[0], 'value': st[1]})
    tiers: dict[str, list] = {}
    for col, keys in SUB_COLS.items():
        vals = []
        for r in rows[1:]:
            v = cell(list(r), col)
            if blank(v):
                break
            vals.append(as_num(float(v)))
        for k in keys:
            tiers[k] = vals
    return {'mains': mains, 'fixedSubs': fixed, 'subTiers': tiers}
