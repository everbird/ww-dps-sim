"""dmg 表：索引、与判定行连接、交叉校验（TD-01 §4）。"""
from __future__ import annotations

from parse import Issues, as_num, blank

# 列号（0 起），见 TD-01 §4.1
D_CHARA, D_NAME, D_CALC_NAME, D_SKILL_ID, D_SKILL_TYPE = 0, 1, 2, 3, 6
D_CALC_TYPE, D_ELEMENT, D_TYPE, D_SUBTYPE = 7, 8, 9, 10
D_CURE_BASE = 12            # CureBaseValue_1…20：M–AF
D_RELATED = 32              # AG
D_RATE = 33                 # RateLv_1…20：AH–BA
D_HARDNESS, D_TOUGH, D_ENERGY = 53, 54, 55
D_FORMULA_TYPE = 63         # BL
D_FORMULA_P5 = 68           # FormulaParam5_1…20：BQ–CJ
D_PERCENT0 = 103            # CZ：Damage.Percent0，按比例削白条（共振度）× 10000
D_WEAKNESS = 107            # DD


def _v(x):
    if blank(x) or (isinstance(x, str) and x.strip().upper() == 'NULL'):
        return None
    return x


def index_dmg(rows: list, issues: Issues) -> dict:
    """(charaId, 行名) → dmg 行；重复键取第一行；Damage.* 全空的行标 noConfig"""
    out: dict = {}
    for n, r in enumerate(rows, start=3):
        r = list(r) + [None] * 110
        if blank(r[D_CHARA]) or blank(r[D_NAME]):
            continue
        key = (str(r[D_CHARA]).strip(), str(r[D_NAME]).strip())
        if key in out:
            issues.add('warn', 'dmg 重复键', f'dmg R{n}: {key[0]} / {key[1]}')
            continue
        out[key] = {'row': n, 'cells': r, 'noConfig': all(_v(x) is None for x in r[D_CALC_TYPE:D_WEAKNESS + 1])}
    return out


def level_index(chara: str, name: str, rates: list | None = None, echo: bool = False) -> int:
    """§4.3：角色技能取 10 级，声骸技能取 5 级（满级声骸）；通用块的谐度破坏只有 1 级。
    只有第 1 级有倍率、其余各级都是 0 的（延奏等不随技能等级成长的技能，全表 43 行）取 1 级——
    原先一律取 10 级，这些行的倍率被读成 0（2026-10-03，椿延奏 3.2924 / 4.5902 与 nanoka 3.7 一致）"""
    if chara == '通用' and name.startswith('谐度破坏'):
        return 1
    if rates and rates[0] and not any(rates[1:]):
        return 1
    return 5 if echo else 10


def rates_of(entry: dict) -> list:
    return [as_num(float(_v(x) or 0)) for x in entry['cells'][D_RATE:D_RATE + 20]]


def dmg_view(entry: dict, via: str, echo: bool = False) -> dict:
    r = entry['cells']
    chara, name = str(r[D_CHARA]).strip(), str(r[D_NAME]).strip()
    rates = rates_of(entry)
    lv = level_index(chara, name, rates, echo)
    calc_type = int(_v(r[D_CALC_TYPE]) or 0)
    formula_type = int(_v(r[D_FORMULA_TYPE]) or 0)
    out = {
        'via': via, 'charaId': chara, 'skillName': name,
        'dmgCalc': None if _v(r[D_CALC_NAME]) is None else str(r[D_CALC_NAME]).strip(),
        'skillId': _int(r[D_SKILL_ID]), 'skillType': _int(r[D_SKILL_TYPE]),
        'calcType': calc_type, 'element': int(_v(r[D_ELEMENT]) or 0), 'damageType': int(_v(r[D_TYPE]) or 0),
        'subType': _int(r[D_SUBTYPE]), 'relatedProperty': int(_v(r[D_RELATED]) or 0),
        'multiplier': rates[lv - 1] / 10000, 'rates': rates,
        'energy': _num(r[D_ENERGY]), 'toughLv': _num(r[D_TOUGH]), 'weaknessLvl': _num(r[D_WEAKNESS]),
        'hardnessLv': _num(r[D_HARDNESS]), 'formulaType': formula_type,
    }
    # 按比例削白条（谐度破坏各段合计 12.5%，渊武"延奏-削白条"7.5%…，m0-confirm §10 H3）：只在不为 0 时写
    pct = _num(r[D_PERCENT0])
    if pct:
        out['whiteBarRatio'] = pct / 10000
    if formula_type != 0:
        out['formulaRate'] = float(_v(r[D_FORMULA_P5 + lv - 1]) or 0) / 10000
    if calc_type == 1:
        out['cureBase'] = as_num(float(_v(r[D_CURE_BASE + lv - 1]) or 0))
    return out


def _int(x):
    """整数字段；'1411001/1411060' 这类复合写法记 null（只作附加信息）"""
    x = _v(x)
    if x is None:
        return None
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


def _num(x):
    x = _v(x)
    return None if x is None else as_num(float(x))


def suggest(chara: str, name: str, dmg: dict) -> list[str]:
    """连不上时的候选（只写进报告，不自动采用，§4.4）"""
    cands = []
    if '-' in name:
        cands.append(name.rsplit('-', 1)[0])
    if name.endswith('D'):
        cands.append(name[:-1])
    for sep in ('-', '·'):
        if sep in name:
            cands.append(name.split(sep, 1)[1])
    return [c for c in dict.fromkeys(cands) if (chara, c) in dmg]


def join_block(blk: dict, dmg: dict, dmg_join: dict, issues: Issues, gaps: list, cross_bad: list) -> None:
    """给块内每个判定行挂 dmg；连不上的伤害型判定打 noDmg（§4.4、§13.2）"""
    from actions import is_enemy_target
    common = blk['sheetName'].startswith('通用')
    chara = '通用' if common else blk['sheetName']
    aliases = dmg_join.get(chara, {})
    for g in blk['groups']:
        for row in g['rows']:
            if row['kind'] != 'hit':
                continue
            entry, via, explicit_null = None, 'direct', False
            if row['name'] in aliases:
                target = aliases[row['name']]
                if target is None:
                    explicit_null = True
                else:
                    c2, n2 = target.split('::', 1) if '::' in target else (chara, target)
                    entry, via = dmg.get((c2, n2)), 'alias'
                    if entry is None:
                        issues.add('error', 'dmgJoin 指向不存在的 dmg 行', f'{blk["key"]} {row["name"]} → {target}')
            else:
                entry = dmg.get((chara, row['name']))
            if entry is not None and entry['noConfig']:
                row['flags'].append('dmgNoConfig')
                continue
            if entry is not None:
                row['dmg'] = dmg_view(entry, via)
                cross_check(blk, row, cross_bad)
                continue
            damaging = is_enemy_target(row) and not row['hints'].get('noDamage') and not explicit_null
            if damaging:
                row['flags'].append('noDmg')
                gaps.append({'block': blk['key'], 'group': g['id'], 'row': row['row'], 'name': row['name'],
                             'suggest': suggest(chara, row['name'], dmg)})


def cross_check(blk: dict, row: dict, cross_bad: list) -> None:
    """§4.4 第 5 步：大招回收 / 削韧 / 偏谐 × 100 与 dmg 对照，容差 1；不符只报告"""
    d = row['dmg']
    e = row['gains']['energy']
    pairs = [('energy', e['total'] if e else None, d['energy']),
             ('toughness', row['toughness'], d['toughLv']),
             ('tunability', row['tunability'], d['weaknessLvl'])]
    for kind, mine, theirs in pairs:
        if mine is None or theirs is None:
            continue
        ok = abs(mine * 100 - theirs) <= 1
        cross_bad.append((kind, ok, blk['key'], row['row'], row['name'], mine, theirs))
        if not ok and kind == 'energy' and 'energyMismatch' not in row['flags']:
            row['flags'].append('energyMismatch')
