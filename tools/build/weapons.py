"""weapon 表 → weapons.json（TD-01 §7）。"""
from __future__ import annotations

import re

from openpyxl.utils import column_index_from_string as ci

from parse import Issues, as_num, blank

WEAPON_TYPES = {1: '长刃', 2: '迅刀', 3: '佩枪', 4: '臂铠', 5: '音感仪'}
NAME = re.compile(r'^\[(\d)\](.+?)(?:（(.+)）)?$')
EFFECT_COLS = [ci(c) - 1 for c in ('L', 'V', 'AF', 'AP', 'AZ')]   # 每组 10 列：L、R、StackLimit、Prop、Policy、Value_1…5


def _num(v) -> float | None:
    """数字或数字字符串（表里有 '190.00000000000001' 这种）"""
    if blank(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v) -> int | None:
    x = _num(v)
    return None if x is None else int(x)


def weapon_growth90(base_rows: list) -> tuple[int, int]:
    """base 表 WeaponGrowth（CL–CO）：Lv = 90 的一行的 Curve1 / Curve2（125000 / 45000）；base_rows 从第 56 行起"""
    lv, c1, c2 = ci('CL') - 1, ci('CM') - 1, ci('CN') - 1
    for r in base_rows:
        if len(r) > c2 and r[lv] == 90:
            return int(r[c1]), int(r[c2])
    raise ValueError('WeaponGrowth 里没有 90 级')


def parse_weapon(row: list, n: int, curve1: int, curve2: int, issues: Issues) -> dict | None:
    """一行 → 武器；分隔行、TEST、无武器返回 None"""
    row = list(row) + [None] * 62
    name = row[0]
    if blank(name):
        return None
    m = NAME.match(str(name).strip())
    if not m:
        return None                                  # —— 长刃 ——、TEST、无武器
    rarity, key, owner = int(m.group(1)), m.group(2).strip(), m.group(3)
    quality = _int(row[2])
    if quality is not None and quality != rarity:
        issues.add('warn', '武器稀有度与名字前缀不一致', f'weapon R{n} {key}：前缀 {rarity}，Quality {quality}')
    wtype = WEAPON_TYPES.get(_int(row[3]) or 0)
    if wtype is None:
        issues.add('error', '武器类型代码不认识', f'weapon R{n} {key}：{row[3]!r}')
        return None
    main_v = _num(row[6]) or 0.0
    sub_v = _num(row[9]) or 0.0
    sub_base = sub_v if _int(row[10]) == 1 else sub_v / 10000
    effects = []
    for c in EFFECT_COLS:
        left, right = row[c], row[c + 1]
        if blank(left):
            continue
        text = str(left).strip() if blank(right) else f'{str(left).strip()}{{v}}{str(right).strip()}'
        vals = [_num(x) for x in row[c + 5:c + 10]]
        values = None if all(v is None or v == 0 for v in vals) else [as_num(round((v or 0) / 10000, 10)) for v in vals]
        prop = _int(row[c + 3])
        effects.append({'text': text, 'stackLimit': _int(row[c + 2]), 'propId': prop if prop else None,
                        'policy': _int(row[c + 4]), 'values': values})
    return {
        'key': key, 'id': _int(row[1]) or 0, 'rarity': rarity, 'owner': owner, 'type': wtype,
        'main': {'propId': _int(row[5]) or 0, 'value90': int(main_v * curve1 // 10000)},
        'sub': {'propId': _int(row[8]) or 0, 'value90': as_num(round(sub_base * curve2 / 10000, 10))},
        'effects': effects, 'row': n,
    }


def build_weapons(rows: list, base_rows: list, issues: Issues) -> list[dict]:
    """rows：weapon 表第 4 行起（第 2、3 行是作者的辅助行）"""
    curve1, curve2 = weapon_growth90(base_rows)
    out, seen = [], set()
    for n, row in enumerate(rows, start=4):
        w = parse_weapon(list(row), n, curve1, curve2, issues)
        if w is None:
            continue
        if w['key'] in seen:
            issues.add('warn', '武器重名', f"weapon R{n} {w['key']}")
            continue
        seen.add(w['key'])
        out.append(w)
    return out
