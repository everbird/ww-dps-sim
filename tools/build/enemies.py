"""敌对属性列表 → enemies.json（TD-01 §9）。白条（Rage）与韧性（Tough）分开存（§9.2）。"""
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


def build_enemies(rows: list, issues: Issues) -> list[dict]:
    """rows：第 2 行起（第 1 行表头）；A 列为空的行跳过。id = 类型/名称，重名按出现顺序加 #2、#3…"""
    out: list[dict] = []
    ids: dict[str, int] = {}
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
        ids[base_id] = ids.get(base_id, 0) + 1
        eid = base_id if ids[base_id] == 1 else f'{base_id}#{ids[base_id]}'
        out.append({
            'id': eid, 'name': name, 'count': count, 'tag': tag, 'cost': cost, 'level': int(_num(r[3], 1)),
            'hp': hp, 'atk': _num(r[5], 0), 'def': _num(r[6], 0),
            'res': {e: _num(r[7 + i], 0) for i, e in enumerate(RES_ORDER)},
            'whiteBar': {'max': _num(r[14], 0), 'recover': _num(r[15], 0), 'reduce': _num(r[16], 0)},
            'poise': {'max': _num(r[17], 0), 'recover': _num(r[18], 0), 'reduce': _num(r[19], 0)},
            'tunabilityMax': _num(r[20], 0),
            'vulnerableSec': _num(r[21]), 'paralysisSec': _num(r[22]),
            'row': n,
        })
    return out
