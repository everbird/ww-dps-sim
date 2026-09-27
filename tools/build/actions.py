"""动作表（角色-女 / 角色-男）→ 块、组、行（TD-01 §3）。"""
from __future__ import annotations

import re

from parse import (Issues, as_num, blank, extract_birth_frame, extract_hints, name_tags, parse_flag, parse_gain,
                   parse_list, parse_num)

ROVERS = {'光主', '暗主', '风主', '雷主'}
NAV_LABELS = {'技能类型', '伤害计算', '输入缓存', '牵引', '快速反应', '偏谐机制'}   # §3.2：块内的跳转链接标签
DILATION_TYPES = {'攻击顿帧', '时停', '全局时停', '极限闪避顿帧', '弹反顿帧'}
ENEMY_TARGETS = {'目标', '目标子弹', '指定目标', '弹刀目标'}                      # §13.2：命中敌方

# 列号（0 起）：A 名称 … AM 命中类型（§3.1）
C_NAME, C_ID, C_ACTION, C_NOTE, C_SPAWN, C_LIFE, C_HS_SELF, C_HS_ENEMY = 0, 1, 2, 3, 4, 5, 6, 7
C_PRIO_CHANGE, C_DERIVE, C_DERIVE_DUR, C_END, C_PARRY, C_PERSIST, C_FOLLOW = 10, 11, 12, 13, 14, 15, 16
C_TOUGH, C_TUNE = 17, 18
GAIN_COLS = [('energy', 19), ('concerto', 20), ('core0', 21), ('core1', 22), ('core2', 23)]
C_PRIORITY, C_POSITION, C_POS_CHANGE, C_DIL_TYPE = 25, 26, 27, 28
DIL_SIDES = [('self', 29), ('enemy', 32), ('ally', 35)]
C_HIT_TARGET = 38


def _id_text(v) -> str:
    """B 列：1 → '1'，7.1 → '7.1'，'15#' 原样"""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def block_key(name: str, gender: str) -> str:
    """§2：漂泊者加 ·性别；通用块加 @性别"""
    if name in ROVERS:
        return f'{name}·{gender}'
    if name.startswith('通用'):
        return f'{name}@{gender}'
    return name


def parse_action_sheet(sheet: str, gender: str, values: list, formulas: list, merges: dict, issues: Issues) -> list[dict]:
    """values / formulas：按行的单元格值列表（1 起行号 = 下标 + 1）；merges：{(行, 列1起): (首行, 末行)}"""
    blocks: list[dict] = []
    cur: dict | None = None
    for i in range(2, len(values) + 1):
        r = list(values[i - 1]) + [None] * 46
        f = list(formulas[i - 1] if i - 1 < len(formulas) else []) + [None] * 46
        a, b, c = r[C_NAME], r[C_ID], r[C_ACTION]
        where = f'{sheet} R{i}'
        if not blank(a) and not blank(b) and _id_text(b) == '1':
            name = str(a).strip()
            cur = {'key': block_key(name, gender), 'sheet': sheet, 'sheetName': name, 'startRow': i, 'ignoredRows': 0,
                   'groups': []}
            blocks.append(cur)
        elif not blank(a) and cur is not None and str(a).strip() not in NAV_LABELS:
            issues.add('warn', 'A 列未知文本', f'{where}: {a}')
        if cur is None:
            continue
        if blank(c):                                                # §3.4：动作名为空 → 不是数据行
            if any(not blank(x) for x in r[3:39]):
                cur['ignoredRows'] += 1
            continue
        if not blank(b):
            raw = _id_text(b)
            m = re.match(r'^(\d+)(.*)$', raw)
            cur['groups'].append({'id': None, 'rawId': raw, 'idNum': int(m.group(1)) if m else None,
                                  'idSuffix': m.group(2) if m else raw, 'rows': []})
        if not cur['groups']:
            issues.add('warn', '组外行', where)
            continue
        cur['groups'][-1]['rows'].append(parse_row(i, r, f, values, merges, sheet, issues))
    for blk in blocks:
        name_groups(blk)
    return blocks


def parse_row(i: int, r: list, f: list, values: list, merges: dict, sheet: str, issues: Issues) -> dict:
    where = f'{sheet} R{i}'
    flags: list[str] = []
    c = r[C_ACTION]
    if isinstance(c, (int, float)) and not isinstance(c, bool):
        issues.add('warn', '动作名为数字', f'{where}: {c}')
        flags.append('numericName')
        name = str(as_num(float(c)))
    else:
        name = str(c).strip()

    note, note_merged = r[C_NOTE], False                            # §1.5：备注合并区复制到每一行
    if blank(note) and (i, C_NOTE + 1) in merges:
        top = merges[(i, C_NOTE + 1)][0]
        note, note_merged = values[top - 1][C_NOTE], True
    note = None if blank(note) else str(note).strip()

    spawn = parse_num(r[C_SPAWN], where + ' 发生帧', issues)
    life = parse_num(r[C_LIFE], where + ' 持续帧', issues)
    gains = {}
    for key, col in GAIN_COLS:                                      # §3.7 + §1.5：合并区的值只归首行
        cell = (i, col + 1)
        if cell in merges and merges[cell][0] != i:
            gains[key] = None
            continue
        g = parse_gain(r[col], f[col], f'{where} {key}', issues)
        if g is not None and cell in merges:
            g['sharedRows'] = list(merges[cell])
        if g is not None and g.get('complex'):
            flags.append('gainComplex')
        gains[key] = g

    dil_type = None if blank(r[C_DIL_TYPE]) else str(r[C_DIL_TYPE]).strip()
    if dil_type is not None and dil_type not in DILATION_TYPES:
        issues.add('warn', '未知膨胀类型', f'{where}: {dil_type}')
        dil_type = None
    sides = {}
    for side, col in DIL_SIDES:
        rate = parse_num(r[col], f'{where} 膨胀系数-{side}', issues)
        start = parse_num(r[col + 1], f'{where} 膨胀发生-{side}', issues)
        dur = parse_num(r[col + 2], f'{where} 膨胀持续-{side}', issues)
        if rate is not None or dur is not None:
            sides[side] = {'rate': rate, 'start': start, 'duration': dur}
    dilation = ({'type': dil_type, **sides}) if (dil_type is not None or sides) else None

    hit_target = None if blank(r[C_HIT_TARGET]) else str(r[C_HIT_TARGET]).strip()
    toughness = parse_num(r[C_TOUGH], where + ' 削韧值', issues)
    tunability = parse_num(r[C_TUNE], where + ' 偏谐值', issues)
    persists = parse_flag(r[C_PERSIST], where + ' 可脱手', issues)

    # §3.6 行分类
    any_gain = any(g is not None for g in gains.values()) or toughness is not None or tunability is not None
    if hit_target is not None or (spawn is not None and life is not None):
        kind = 'hit'
    elif any_gain:
        kind = 'gain'
    elif dil_type is not None:
        kind = 'dilation'
    else:
        kind = 'marker'
    if life == -1 and persists is True:
        flags.append('lifeMinus1Persists')

    return {
        'row': i, 'name': name, 'kind': kind, 'eventSpawned': kind == 'hit' and spawn is None,
        'spawnFrame': spawn,
        'birthFrame': extract_birth_frame(f[C_SPAWN], spawn),
        'lifeFrames': life,
        'hitstop': {'self': parse_num(r[C_HS_SELF], where, issues), 'enemy': parse_num(r[C_HS_ENEMY], where, issues)},
        'deriveFrame': parse_num(r[C_DERIVE], where + ' 派生帧', issues),
        'deriveDuration': parse_num(r[C_DERIVE_DUR], where + ' 派生持续帧', issues),
        'endFrame': parse_num(r[C_END], where + ' 动作结束帧', issues),
        'priority': parse_list(r[C_PRIORITY], where + ' 中断优先级', issues),
        'priorityChange': parse_list(r[C_PRIO_CHANGE], where + ' 优先级改变', issues),
        'parry': parse_flag(r[C_PARRY], where + ' 可弹刀', issues),
        'persists': persists,
        'followHitstop': parse_flag(r[C_FOLLOW], where + ' 跟随顿帧', issues),
        'toughness': toughness, 'tunability': tunability,
        'gains': {'energy': gains['energy'], 'concerto': gains['concerto'],
                  'core': [gains['core0'], gains['core1'], gains['core2']]},
        'position': None if blank(r[C_POSITION]) else str(r[C_POSITION]).strip(),
        'positionChange': parse_list(r[C_POS_CHANGE], where + ' 状态转换时间', issues),
        'dilation': dilation,
        'hitTarget': hit_target,
        'note': note, 'noteMerged': note_merged,
        'hints': extract_hints(note),
        'nameTags': name_tags(name),
        'flags': flags,
    }


def name_groups(blk: dict) -> None:
    """§3.5：组名 = 首行名去掉最后一个 -后缀；冲突用全名；仍冲突加 #n"""
    used: set[str] = set()
    for g in blk['groups']:
        first = g['rows'][0]['name']
        cand = first if (len(g['rows']) == 1 or '-' not in first) else first.rsplit('-', 1)[0]
        if cand in used and cand != first:
            cand = first
        if cand in used:
            k = 2
            while f'{cand}#{k}' in used:
                k += 1
            cand = f'{cand}#{k}'
        used.add(cand)
        g['id'] = cand


def is_enemy_target(row: dict) -> bool:
    return row['hitTarget'] is None or row['hitTarget'] in ENEMY_TARGETS
