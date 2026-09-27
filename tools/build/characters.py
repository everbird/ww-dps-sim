"""base 表角色主表 + 成长表 + 索引页体型 → characters.json（TD-01 §5.2、§5.3、第 6 节）。"""
from __future__ import annotations

import math
import re

from openpyxl.utils import column_index_from_string as ci

from parse import Issues, as_num, blank

ELEMENTS = {0: '物理', 1: '冷凝', 2: '热熔', 3: '导电', 4: '气动', 5: '衍射', 6: '湮灭'}
COMMON_BLOCK = {'女-大': '通用-大@女', '女-中': '通用-中@女', '女-中小': '通用-中小@女', '女-小': '通用-小@女',
                '女-特殊': None, '男-大': '通用-大@男', '男-中': '通用-中@男', '男-小': '通用-小@男'}
ROVERS = {'光主', '暗主', '风主', '雷主'}


def _c(col: str) -> int:
    """列字母 → 0 起下标"""
    return ci(col) - 1


def body_types(index_rows: list) -> dict[str, str]:
    """索引页：A 列是体型标签，其后各行 C–W 列是角色名"""
    out: dict[str, str] = {}
    cur = None
    for r in index_rows:
        r = list(r) + [None] * 23
        a = r[0]
        if isinstance(a, str) and re.fullmatch(r'\s*[女男]\s*-\s*(大|中|中小|小|特殊)\s*', a):
            cur = re.sub(r'\s+', '', a)
        if cur is None:
            continue
        gender = cur[0]
        for v in r[2:23]:
            if blank(v):
                continue
            name = str(v).strip()
            out[f'{name}·{gender}' if name in ROVERS else name] = cur
    return out


def growth90(base_rows: list) -> tuple[int, int, int]:
    """成长表 AP–AT：Level = 90 且 BreachLevel 最大的一行"""
    best = None
    for r in base_rows:
        lv, br = r[_c('AP')], r[_c('AQ')]
        if lv == 90 or (isinstance(lv, str) and lv.strip() == '90'):
            if best is None or (br or 0) > (best[0] or 0):
                best = (br, r[_c('AR')], r[_c('AS')], r[_c('AT')])
    if best is None:
        raise ValueError('成长表里没有 90 级')
    return int(best[1]), int(best[2]), int(best[3])


def build_characters(base_rows: list, index_rows: list, blocks: dict[str, dict], issues: Issues) -> dict:
    """base_rows：base 表第 56 行起的行（0 起下标对应 A 列起）；blocks：块键 → 动作块"""
    hp_r, atk_r, def_r = growth90(base_rows)
    bodies = body_types(index_rows)
    out: dict = {}
    for n, r in enumerate(base_rows, start=56):
        r = list(r) + [None] * 200
        name = r[_c('EM')]
        if blank(name) or isinstance(name, (int, float)) or str(name).strip().startswith('——'):
            continue
        key = str(name).strip()
        blk = blocks.get(key)
        if blk is None:
            issues.add('warn', '主表角色没有动作块', f'base R{n}: {key}')
            continue
        l1 = {'hp': int(r[_c('EN')]), 'atk': int(r[_c('EO')]), 'def': int(r[_c('EP')])}
        cores = []
        for k in range(5):
            cap = r[_c('ER') + k]
            if blank(cap) or float(cap) <= 0:
                continue
            nm = r[_c('EZ') + k]
            cores.append({'slot': k + 1, 'name': '' if blank(nm) else str(nm).strip(), 'cap': as_num(float(cap))})
            if float(cap) >= 1000:
                issues.add('warn', '核心资源上限 ≥ 1000（单位待确认，Q22）', f'{key} 槽 {k + 1}: {cap}')
        body = bodies.get(key)
        if body is None:
            issues.add('warn', '索引页没有体型', key)
        texts = {'chain': {}, 'passive': {}}
        for k in range(6):
            t = r[_c('FE') + k]
            if not blank(t):
                texts['chain'][str(k + 1)] = str(t).strip()
        for k in range(2):
            t = r[_c('FK') + k]
            if not blank(t):
                texts['passive'][str(k + 1)] = str(t).strip()
        out[key] = {
            'key': key, 'sheet': blk['sheet'], 'sheetName': blk['sheetName'],
            'dmgCharaId': blk['sheetName'],                          # 漂泊者不分性别（§2）；陆·赫斯这类名字本身带点
            'element': ELEMENTS[int(r[_c('EW')])],
            'bodyType': body, 'commonBlock': COMMON_BLOCK.get(body) if body else None,
            'baseL1': l1,
            'base90': {'hp': math.floor(l1['hp'] * hp_r / 10000), 'atk': math.floor(l1['atk'] * atk_r / 10000),
                       'def': math.floor(l1['def'] * def_r / 10000)},
            'energyCost': as_num(float(r[_c('EQ')] or 0) / 100),
            'coreResources': cores,
            'tunabilityRate': as_num(float(r[_c('EX')] or 0) / 10000),
            'harmonyBreakBoost': as_num(float(r[_c('EY')] or 0)),
            'texts': texts,
            'actionsFile': f'actions/{key}.json',
        }
    return out
