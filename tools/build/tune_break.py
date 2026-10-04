"""谐度破坏表 → tune-break.json（TD-01 §5.4、§11.3；公式见 TD-03 §6）。

- 变体：dmg「通用」块的"谐度破坏-<武器><段>"行，倍率取 RateLv_1 × 0.0001（TD-01 §4.3：谐度破坏只有 1 级）。
- 结算次数与对照值：「伤害计算」谐度破坏表（R1095 表头起，B 名称、D 倍率、E 对失谐伤害、F 对常态伤害、G 结算次数），
  按名字对上变体（"迅刀-1" ↔ "谐度破坏-迅刀1"、"佩枪" ↔ "谐度破坏-佩枪"）；"对COST1/3/4通用"三行原样存 costRows。
- 基础值：base 页 AO 列 WeaknessDamageBaseValue，按 AM 列等级（第 56–155 行），下标 = 等级 − 1。基础值按**角色**等级取
  （xlsx 公式用「伤害配置」C3 的角色等级，2026-10-04 核对，m0-confirm §9.1）。
- COST 系数：base 页第 56–58 行 R 列 COST、T 列 WeaknessDamageMinus、U 列 WeaknessDamageMinusRatio，系数 = T × U。
- 规则：「附页2」"偏谐机制·通用"那段文字（20260707 版在 B227）里的谐破冷却（按 COST1/3/4/红名，秒）与谐度破坏
  按钮亮多久（"交互按键持续n秒"）。只有说明文字，没有数表，按原句抽；写法变了认不出就警告、记 null（m0-confirm §10 H2、H4）。
"""
from __future__ import annotations

import re

from openpyxl.utils import column_index_from_string as ci

from parse import Issues, as_num, blank

WEAPONS = ('长刃', '迅刀', '佩枪', '臂铠', '音感仪')
TABLE_ROWS = (1095, 1106)                     # 「伤害计算」谐度破坏表：表头 + 3 行 COST 通用 + 8 行武器
_VARIANT = re.compile(r'^谐度破坏-(长刃|迅刀|佩枪|臂铠|音感仪)(\d*)$')
_TABLE_NAME = re.compile(r'^(长刃|迅刀|佩枪|臂铠|音感仪)(?:-(\d+))?$')
_LOCK = re.compile(r'COST1/3/4/红名目标分别冷却([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)秒')
_BUTTON = re.compile(r'交互按键持续([\d.]+)秒')


def _num(v):
    return None if blank(v) else as_num(float(v))


def parse_tune_rules(notes: list, issues: Issues) -> dict | None:
    """notes：「附页2」的 (坐标, 文本)。找"谐破冷却"那一格，抽谐破冷却（秒，按 COST 与红名）与按钮时长（秒）"""
    for coord, text in notes:
        if '谐破冷却' not in text:
            continue
        lock, button = _LOCK.search(text), _BUTTON.search(text)
        if not lock or not button:
            issues.add('warn', '附页2 偏谐机制的写法变了，谐破冷却或按钮时长认不出', f'附页2 {coord}')
            return None
        c1, c3, c4, red = (as_num(float(x)) for x in lock.groups())
        return {'lockSec': {'1': c1, '3': c3, '4': c4}, 'lockSecRedName': red,
                'buttonSec': as_num(float(button.group(1))), 'source': f'附页2 {coord}'}
    issues.add('warn', '附页2 里找不到偏谐机制·通用（谐破冷却）', '附页2')
    return None


def build_tune_break(dmg: dict, table_rows: list, base_rows: list, issues: Issues, notes: list = ()) -> dict:
    """dmg：index_dmg 的结果；table_rows：「伤害计算」R1095–R1106 的 A–G 列（values_only）；base_rows：base 页第 56 行起；
    notes：「附页2」的 (坐标, 文本)，抽规则用"""
    table = {}
    cost_rows = []
    for n, r in enumerate(table_rows, start=TABLE_ROWS[0]):
        r = list(r) + [None] * 7
        name = r[1]
        if not isinstance(name, str) or name.strip() == '谐度破坏':
            continue
        name = name.strip()
        row = {'multiplier': _num(r[3]), 'vsDisharmony': _num(r[4]), 'vsNormal': _num(r[5]), 'ticks': _num(r[6])}
        if name.startswith('对COST'):
            if None in row.values():
                issues.add('warn', '谐度破坏表缺数', f'伤害计算 R{n} {name}')
                continue
            cost_rows.append({'label': name, **row, 'ticks': int(row['ticks'])})
            continue
        m = _TABLE_NAME.match(name)
        if not m:
            issues.add('warn', '谐度破坏表的行名认不出', f'伤害计算 R{n} {name}')
            continue
        table[f'谐度破坏-{m.group(1)}{m.group(2) or ""}'] = row

    variants = []
    for (chara, name), entry in dmg.items():
        if chara != '通用':
            continue
        m = _VARIANT.match(name)
        if not m:
            continue
        rate = _num(entry['cells'][33])                    # RateLv_1（AH）
        t = table.get(name)
        if t is None:
            issues.add('warn', '谐度破坏变体在伤害计算表里找不到', f'dmg R{entry["row"]} {name}')
        variants.append({
            'key': name, 'weaponType': m.group(1), 'seq': int(m.group(2)) if m.group(2) else None,
            'multiplier': (rate or 0) / 10000,
            'ticks': int(t['ticks']) if t and t['ticks'] is not None else None,
            'golden': {'vsDisharmony': t['vsDisharmony'], 'vsNormal': t['vsNormal']}
            if t and t['vsDisharmony'] is not None and t['vsNormal'] is not None else None,
        })
    for w in WEAPONS:
        if not any(v['weaponType'] == w for v in variants):
            issues.add('warn', '谐度破坏缺武器类型', w)

    def cell(r, col):
        i = ci(col) - 1
        return r[i] if i < len(r) else None

    base = [0.0] * 100
    for r in base_rows[:100]:
        lv, v = cell(r, 'AM'), cell(r, 'AO')
        if isinstance(lv, (int, float)) and 1 <= lv <= 100 and isinstance(v, (int, float)):
            base[int(lv) - 1] = as_num(float(v))
    if not all(base):
        issues.add('warn', '谐度破坏基础值缺等级', f'{sum(1 for x in base if not x)} 级没有值')
    factors = []
    for r in base_rows[:3]:
        cost, t, u = cell(r, 'R'), cell(r, 'T'), cell(r, 'U')
        if cost in (1, 3, 4) and isinstance(t, (int, float)) and isinstance(u, (int, float)):
            factors.append({'cost': int(cost), 'factor': float(t) * float(u)})
    if sorted(f['cost'] for f in factors) != [1, 3, 4]:
        issues.add('warn', '谐度破坏 COST 系数不全', str(factors))
    return {'variants': variants, 'costRows': cost_rows, 'baseByLevel': base, 'costFactors': factors,
            'rules': parse_tune_rules(list(notes), issues)}
