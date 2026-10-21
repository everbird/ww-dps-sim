"""动作表（角色-女 / 角色-男）→ 块、组、行（TD-01 §3）。"""
from __future__ import annotations

import re

from parse import (Issues, as_num, blank, extract_birth_frame, extract_hints, name_tags, parse_flag, parse_gain,
                   parse_list, parse_num)

ROVERS = {'光主', '暗主', '风主', '雷主'}
NAV_LABELS = {'技能类型', '伤害计算', '输入缓存', '牵引', '快速反应', '偏谐机制', '同奏体系'}   # §3.2：块内的跳转链接标签
DILATION_TYPES = {'攻击顿帧', '时停', '全局时停', '极限闪避顿帧', '弹反顿帧'}
ENEMY_TARGETS = {'目标', '目标子弹', '指定目标', '弹刀目标'}                      # §13.2：命中敌方
# 主表（base）角色名与动作块名不同的（§5.2）：20261019 版的心分成两块，常态"应世心"用角色名，岁主形态"照世心"由角色模块并入
BLOCK_RENAME = {'应世心': '心'}
_MULTI_HIT = re.compile(r'^\s*(\d+)\s*F\s*/\s*(\d+)\s*次\s*$')
_NOTE_DELAY = re.compile(r'延迟\s*(\d+)\s*F\s*生效')


class ActionCols:
    """动作表第 1 行的表头 → 0 起列下标（§3.1），不写死列号。
    20261019 版在"持续帧"后插了"延迟"、"顿帧-敌"后插了"多判间隔/次"，其后各列右移两列，按列号读就全错了。
    同名表头（膨胀发生、膨胀持续：自、敌、友各一）按第几次出现区分；旧版没有的列（延迟、多判间隔/次）为 None。
    找不到必需的表头就报错（表头改名了，构建停下来，改这里或改解析）"""

    def __init__(self, header) -> None:
        names = [str(h).strip() if h is not None else '' for h in header]

        def col(name: str, nth: int = 1, required: bool = True) -> int | None:
            hits = [i for i, n in enumerate(names) if n == name]
            if len(hits) >= nth:
                return hits[nth - 1]
            if required:
                raise ValueError(f'动作表第 1 行找不到表头 {name}' + (f'（第 {nth} 个）' if nth > 1 else ''))
            return None

        self.name, self.id, self.action, self.note = col('名称'), col('ID'), col('动作'), col('备注')
        self.spawn, self.life, self.delay = col('发生帧'), col('持续帧'), col('延迟', required=False)
        self.hs_self, self.hs_enemy, self.multi_hit = col('顿帧-自'), col('顿帧-敌'), col('多判间隔/次', required=False)
        self.prio_change, self.derive, self.derive_dur, self.end = col('优先级改变'), col('派生帧'), col('派生持续帧'), col('动作结束帧')
        self.inv_start, self.inv_dur = col('无敌启动帧', required=False), col('无敌持续帧', required=False)
        self.parry, self.persist, self.follow = col('可弹刀'), col('可脱手'), col('跟随顿帧')
        self.tough, self.tune = col('削韧值'), col('偏谐值')
        self.gains = [('energy', col('大招回收')), ('concerto', col('协奏回收')),
                      ('core0', col('核心回收1')), ('core1', col('核心回收2')), ('core2', col('核心回收3'))]
        self.priority, self.position, self.pos_change = col('中断优先级'), col('位置状态'), col('状态转换时间')
        self.dil_type = col('时间膨胀类型')
        self.dil_sides = []
        for k, (side, head) in enumerate((('self', '自膨胀系数'), ('enemy', '敌膨胀系数'), ('ally', '友膨胀系数'))):
            rate, start, dur = col(head), col('膨胀发生', k + 1), col('膨胀持续', k + 1)
            if (start, dur) != (rate + 1, rate + 2):
                raise ValueError(f'动作表表头 {head} 后面不是"膨胀发生、膨胀持续"')
            self.dil_sides.append((side, rate))
        self.hit_target = col('命中类型')
        self.width = len(names)


def _id_text(v) -> str:
    """B 列：1 → '1'，7.1 → '7.1'，'15#' 原样"""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def block_key(name: str, gender: str) -> str:
    """§2：漂泊者加 ·性别；通用块加 @性别；与主表角色名不同的块改用角色名（BLOCK_RENAME）"""
    if name in ROVERS:
        return f'{name}·{gender}'
    if name.startswith('通用'):
        return f'{name}@{gender}'
    return BLOCK_RENAME.get(name, name)


def parse_action_sheet(sheet: str, gender: str, values: list, formulas: list, merges: dict, issues: Issues) -> list[dict]:
    """values / formulas：按行的单元格值列表（1 起行号 = 下标 + 1，第 1 行是表头）；merges：{(行, 列1起): (首行, 末行)}"""
    cols = ActionCols(values[0])
    pad = [None] * cols.width
    blocks: list[dict] = []
    cur: dict | None = None
    for i in range(2, len(values) + 1):
        r = list(values[i - 1]) + pad
        f = list(formulas[i - 1] if i - 1 < len(formulas) else []) + pad
        a, b, c = r[cols.name], r[cols.id], r[cols.action]
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
            if any(not blank(x) for x in r[cols.note:cols.hit_target + 1]):
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
        cur['groups'][-1]['rows'].append(parse_row(i, r, f, values, merges, sheet, issues, cols))
    for blk in blocks:
        name_groups(blk)
    return blocks


def multi_hit_hints(v, note_hints: dict, where: str, issues: Issues) -> dict:
    """「多判间隔/次」列（20261019 版起）："nF / m次"等同备注"持续帧内每nF进行一次判定，最多m次"（附页1）。
    备注也写了且对不上时以这一列为准并报告"""
    if blank(v):
        return {}
    m = _MULTI_HIT.match(str(v))
    if not m:
        issues.add('warn', '多判间隔/次无法解析', f'{where}: {v!r}')
        return {}
    h = {'tickInterval': int(m.group(1)), 'maxTicks': int(m.group(2))}
    old = {k: note_hints[k] for k in h if k in note_hints}
    if old and old != {k: h[k] for k in old}:
        issues.add('warn', '多判间隔/次与备注不同', f'{where}: 列 {v!r}，备注 {old}')
    return h


def parse_row(i: int, r: list, f: list, values: list, merges: dict, sheet: str, issues: Issues, cols: ActionCols) -> dict:
    where = f'{sheet} R{i}'
    flags: list[str] = []
    c = r[cols.action]
    if isinstance(c, (int, float)) and not isinstance(c, bool):
        issues.add('warn', '动作名为数字', f'{where}: {c}')
        flags.append('numericName')
        name = str(as_num(float(c)))
    else:
        name = str(c).strip()

    note, note_merged = r[cols.note], False                         # §1.5：备注合并区复制到每一行
    if blank(note) and (i, cols.note + 1) in merges:
        top = merges[(i, cols.note + 1)][0]
        note, note_merged = values[top - 1][cols.note], True
    note = None if blank(note) else str(note).strip()

    spawn = parse_num(r[cols.spawn], where + ' 发生帧', issues)
    life = parse_num(r[cols.life], where + ' 持续帧', issues)
    delay = None if cols.delay is None else parse_num(r[cols.delay], where + ' 延迟', issues)
    # 老角色把延迟写在备注里："脱手后延迟54F生效"（附页1：延迟 = 判定生成后到生效前要等的时长）；列空时按备注，两处都有对不上时以列为准并报告
    note_delay = _NOTE_DELAY.search(note) if note else None
    if note_delay and delay is None:
        delay = int(note_delay.group(1))
    elif note_delay and int(note_delay.group(1)) != delay:
        issues.add('warn', '延迟与备注不同', f'{where}: 列 {delay}，备注"{note_delay.group(0)}"')
    gains = {}
    for key, col in cols.gains:                                     # §3.7 + §1.5：合并区的值只归首行
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

    dil_type = None if blank(r[cols.dil_type]) else str(r[cols.dil_type]).strip()
    if dil_type is not None and dil_type not in DILATION_TYPES:
        issues.add('warn', '未知膨胀类型', f'{where}: {dil_type}')
        dil_type = None
    sides = {}
    for side, col in cols.dil_sides:
        rate = parse_num(r[col], f'{where} 膨胀系数-{side}', issues)
        start = parse_num(r[col + 1], f'{where} 膨胀发生-{side}', issues)
        dur = parse_num(r[col + 2], f'{where} 膨胀持续-{side}', issues)
        if rate is not None or dur is not None:
            sides[side] = {'rate': rate, 'start': start, 'duration': dur}
    dilation = ({'type': dil_type, **sides}) if (dil_type is not None or sides) else None

    hit_target = None if blank(r[cols.hit_target]) else str(r[cols.hit_target]).strip()
    toughness = parse_num(r[cols.tough], where + ' 削韧值', issues)
    tunability = parse_num(r[cols.tune], where + ' 偏谐值', issues)
    persists = parse_flag(r[cols.persist], where + ' 可脱手', issues)
    hints = extract_hints(note)
    if cols.multi_hit is not None:
        hints.update(multi_hit_hints(r[cols.multi_hit], hints, where, issues))

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
        'birthFrame': extract_birth_frame(f[cols.spawn], spawn),
        'lifeFrames': life,
        'delayFrames': delay,
        'hitstop': {'self': parse_num(r[cols.hs_self], where, issues), 'enemy': parse_num(r[cols.hs_enemy], where, issues)},
        'deriveFrame': parse_num(r[cols.derive], where + ' 派生帧', issues),
        'deriveDuration': parse_num(r[cols.derive_dur], where + ' 派生持续帧', issues),
        'endFrame': parse_num(r[cols.end], where + ' 动作结束帧', issues),
        'invincible': invincible(r, cols, where, issues),
        'priority': parse_list(r[cols.priority], where + ' 中断优先级', issues),
        'priorityChange': parse_list(r[cols.prio_change], where + ' 优先级改变', issues),
        'parry': parse_flag(r[cols.parry], where + ' 可弹刀', issues),
        'persists': persists,
        'followHitstop': parse_flag(r[cols.follow], where + ' 跟随顿帧', issues),
        'toughness': toughness, 'tunability': tunability,
        'gains': {'energy': gains['energy'], 'concerto': gains['concerto'],
                  'core': [gains['core0'], gains['core1'], gains['core2']]},
        'position': None if blank(r[cols.position]) else str(r[cols.position]).strip(),
        'positionChange': parse_list(r[cols.pos_change], where + ' 状态转换时间', issues),
        'dilation': dilation,
        'hitTarget': hit_target,
        'note': note, 'noteMerged': note_merged,
        'hints': hints,
        'nameTags': name_tags(name),
        'flags': flags,
    }


def invincible(r: list, cols: ActionCols, where: str, issues: Issues) -> dict | None:
    """「无敌启动帧」「无敌持续帧」两列（2026-10-21 起抽）：都空 → None；备注"无敌期间不能切人"的切人锁按它算（TD-05 §2）"""
    if cols.inv_start is None or cols.inv_dur is None:
        return None
    start = parse_num(r[cols.inv_start], where + ' 无敌启动帧', issues)
    dur = parse_num(r[cols.inv_dur], where + ' 无敌持续帧', issues)
    if start is None and dur is None:
        return None
    return {'start': start, 'duration': dur}


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
