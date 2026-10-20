"""异常效应 → effects.json（TD-01 §4.3、§5.4、§11.2；公式见 TD-03 §5）。

- 逐层倍率：dmg「异常伤害」块各效应行的 RateLv_k × 0.0001 = k 层时的倍率，到最后一个非零的为止（TD-01 §4.3）。
  电磁效应有 16 层：常规上限 10 层，11–16 层给提高了上限的情况（心的疾霆"至多可附加至16层"）；常规上限、持续、结算周期
  这些规则在 data/curated/effects.ts，这里的 maxStacks 只是表有几层。
- 元素按 dmg 的 Element 列（1 冷凝 … 6 湮灭），subType 取 dmg 的 SubType 列。
- 说明：「伤害计算」"异常伤害 / 效果描述"表头下各行（20261019 版 R1116–R1122），"霜冻效应（替换霜渐）"按霜冻效应。
- 基础值：base 页 AbnomalDamage 列，按 AbnormalDamageLv 列的等级（第 56–155 行），下标 = 等级 − 1（90 级 3674）。
  base 页的列都按第 55 行表头名找（base_cols.py）。
逐层伤害的标准答案在 golden-zones.json（formula = abnormal，抽的就是伤害计算页的逐层表），这里不重复。
"""
from __future__ import annotations

import re

from characters import ELEMENTS
from dmg import D_ELEMENT, D_SUBTYPE, rates_of
from parse import Issues, as_num, blank

CHARA = '异常伤害'
_PAREN = re.compile(r'（[^）]*）$')


def find_descs(calc_rows: list) -> dict:
    """「伤害计算」里 B 列"异常伤害"、D 列"效果描述"的表头之下，到 B 列为空为止：效应名 → 说明。calc_rows：第 1 行起的 A–D 列"""
    for i, r in enumerate(calc_rows):
        r = list(r) + [None] * 4
        if r[1] == CHARA and r[3] == '效果描述':
            out = {}
            for x in calc_rows[i + 1:]:
                x = list(x) + [None] * 4
                if blank(x[1]):
                    break
                if isinstance(x[3], str):
                    out[_PAREN.sub('', str(x[1]).strip())] = x[3].strip()
            return out
    return {}


def build_effects(dmg: dict, calc_rows: list, base_rows: list, col, issues: Issues) -> dict:
    """dmg：index_dmg 的结果；calc_rows：「伤害计算」第 1 行起的 A–D 列；base_rows：base 页第 56 行起；col：base 页的列（BaseCols）"""
    descs = find_descs(calc_rows)
    if not descs:
        issues.add('warn', '「伤害计算」里找不到异常伤害的效果描述表', '伤害计算')
    effects = []
    for (chara, name), entry in dmg.items():
        if chara != CHARA:
            continue
        rates = rates_of(entry)
        last = max((k for k, x in enumerate(rates) if x), default=-1)
        if last < 0:
            issues.add('warn', '异常效应没有倍率', f'dmg R{entry["row"]} {name}')
            continue
        cells = entry['cells']
        element = ELEMENTS.get(int(cells[D_ELEMENT] or 0))
        if element is None or element == '物理':
            issues.add('warn', '异常效应的元素认不出', f'dmg R{entry["row"]} {name}：{cells[D_ELEMENT]}')
            continue
        effects.append({
            'name': name, 'element': element, 'subType': int(cells[D_SUBTYPE] or 0),
            'multipliers': [as_num(x / 10000) for x in rates[:last + 1]], 'maxStacks': last + 1,
            'desc': descs.get(name),
        })
    if not effects:
        issues.add('warn', 'dmg 里找不到异常伤害的行', CHARA)

    i_lv, i_base = col('AbnormalDamageLv'), col('AbnomalDamage')
    base = [0.0] * 100
    for r in base_rows[:100]:
        lv = r[i_lv] if i_lv < len(r) else None
        v = r[i_base] if i_base < len(r) else None
        if isinstance(lv, (int, float)) and 1 <= lv <= 100 and isinstance(v, (int, float)):
            base[int(lv) - 1] = as_num(float(v))
    if not all(base):
        issues.add('warn', '异常伤害基础值缺等级', f'{sum(1 for x in base if not x)} 级没有值')
    return {'effects': effects, 'abnormalBaseByLevel': base}
