"""敌对属性列表 → enemies.json（TD-01 §9）。白条（Rage）与韧性（Tough）分开存（§9.2）。

白条另存一份按削韧值计的 whiteBarTough（TD-06 §13.2）：敌人表的"白条"按生命值的等级成长放大过，不能直接拿削韧值去减；
取 prop（游戏原型）的 RageMax ÷ 100（与韧性 = ToughMax ÷ 100 同单位）× base 页 PropExtraRate.Tough&Rage（按原型的
PropExtraRateId，缺省 1）。prop 按（名称，类型）对上敌人表的行（20260707 版 1402 行全部对上）。"""
from __future__ import annotations

import re

from parse import Issues, as_num, blank

RES_ORDER = ['物理', '冷凝', '热熔', '导电', '气动', '衍射', '湮灭']   # H–N：物抗、冰抗、火抗、雷抗、风抗、光抗、暗抗
COUNT = re.compile(r'^(.+?)\s*\*\s*(\d+)$')


def _num(v, default=None):
    if blank(v):
        return default
    try:
        return as_num(float(v))
    except (TypeError, ValueError):
        return default


def rage_index(prop_rows: list, base_rows: list, col) -> dict:
    """prop 第 1 行表头起 → {(名称, 类型): 白条（削韧值）}；base_rows：base 页第 56 行起，col：base 页的列（BaseCols）
    （PropExtraRateId 与 PropExtraRate.Tough&Rage 两列）"""
    i_id, i_rate = col('PropExtraRateId'), col('PropExtraRate.Tough&Rage')
    extra = {}
    for r in base_rows:
        r = list(r) + [None] * (i_rate + 1)
        if r[i_id] is not None and isinstance(r[i_rate], (int, float)):
            extra[r[i_id]] = r[i_rate] / 10000
    if not prop_rows:
        return {}
    head = [str(h).strip() if h is not None else '' for h in prop_rows[0]]
    col = {h: i for i, h in enumerate(head)}
    i_rage, i_rate = col.get('Proto_RageMax'), col.get('Entity_PropExtraRateId')
    if i_rage is None:
        return {}
    out = {}
    for r in prop_rows[1:]:
        if blank(r[0]):
            continue
        key = (str(r[0]).strip(), '' if blank(r[1]) else str(r[1]).strip())
        rage = _num(r[i_rage], 0)
        rate = extra.get(r[i_rate], 1) if i_rate is not None and r[i_rate] not in (0, None) else 1
        out.setdefault(key, as_num(rage / 100 * rate))
    return out


def build_enemies(rows: list, issues: Issues, rage: dict | None = None) -> list[dict]:
    """rows：第 2 行起（第 1 行表头）；A 列为空的行跳过。id = 类型/名称，重名按出现顺序加 #2、#3…
    rage：rage_index 的结果（缺省不算 whiteBarTough）"""
    out: list[dict] = []
    ids: dict[str, int] = {}
    rage = rage or {}
    for n, r in enumerate(rows, start=2):
        r = list(r) + [None] * 24
        if blank(r[0]):
            continue
        raw = str(r[0]).strip()
        m = COUNT.match(raw)
        name, count = (m.group(1).strip(), int(m.group(2))) if m else (raw, None)
        tag = '' if blank(r[1]) else str(r[1]).strip()
        cost = _num(r[2])
        if cost not in (1, 3, 4):
            issues.add('warn', '敌人 COST 不认识', f'敌对属性列表 R{n} {raw}：{r[2]!r}')
            continue
        hp = _num(r[4], 0)
        if not hp or hp <= 0:
            issues.add('warn', '敌人没有生命值', f'敌对属性列表 R{n} {raw}')
            continue
        base_id = f'{tag}/{name}'
        tough = rage.get((raw, tag), rage.get((name, tag)))
        if rage and tough is None:
            issues.add('warn', '敌人在 prop 里找不到', f'敌对属性列表 R{n} {raw}（{tag}）')
        ids[base_id] = ids.get(base_id, 0) + 1
        eid = base_id if ids[base_id] == 1 else f'{base_id}#{ids[base_id]}'
        out.append({
            'id': eid, 'name': name, 'count': count, 'tag': tag, 'cost': cost, 'level': int(_num(r[3], 1)),
            'hp': hp, 'atk': _num(r[5], 0), 'def': _num(r[6], 0),
            'res': {e: _num(r[7 + i], 0) for i, e in enumerate(RES_ORDER)},
            'whiteBar': {'max': _num(r[14], 0), 'recover': _num(r[15], 0), 'reduce': _num(r[16], 0)},
            'whiteBarTough': tough,
            'poise': {'max': _num(r[17], 0), 'recover': _num(r[18], 0), 'reduce': _num(r[19], 0)},
            'tunabilityMax': _num(r[20], 0),
            'vulnerableSec': _num(r[21]), 'paralysisSec': _num(r[22]),
            'row': n,
        })
    return out
