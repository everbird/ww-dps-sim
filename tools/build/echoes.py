"""声骸表 → echoes.json（TD-01 §8、§13.3）。

块：A 列非空开始一个声骸；B 列（动作名）为空的行不是数据行（有数据的计入 ignoredRows）。
分组（一组 = 一个动作）：
  - 「类型」列（Q）每个合并区是一个技能版本：无常凶鹭的点按（砸地）/ 长按（喷火）、鸣钟之龟每种体型一行；
    「类型」为空的行（合并区外的追加判定，如辉萤军势"A1-融冰"）归前一个版本。
  - 版本里有「单段冷却 / 接续时限」（S / T）的是多段声骸，按行名 "-" 前的前缀分段（无冠者 A1、A2、A3-1/A3-2、A4-1…），
    每段一组；本段的 S / T 记成下一段可接的窗口（本段局部帧）。分段是按名字猜的（燎照之骑的"刹车"其实是长按版），打 stagesGuess。
  - 只有鸣钟之龟按体型分行（成女-召唤…）：组上记 body，组名去掉体型前缀。
  - 组名：各行名的公共前缀（无妄者 斩击1…6 → 斩击），没有公共前缀时同动作表 §3.5。
脱手与否（2026-10-04 用户说明）：说明里是"召唤…"的脱手释放，"幻形…"的不脱手（但可以切人合轴）。textKind 取说明里先出现的那个词，
与第一个技能版本的「类型」列不同时打 kindText（装配以说明为准，其余版本看「类型」列）。
异相·X 只是换了配色、数值与 X 相同（2026-10-04 用户确认）：本体在表里的不单独产出（drop_phantoms），装配时取本体。
行的解析同动作表（字段与 actions.parse_row 一致），声骸表没有的列（派生帧、命中类型、偏谐值、核心回收…）记空。
倍率（§8）：dmg-join.json → dmg（RateLv_5）→ nanoka 声骸的伤害条目（削韧值、大招回收都对得上、倍率唯一时）。
"""
from __future__ import annotations

import os
import re

from actions import DILATION_TYPES
from dmg import dmg_view, level_index, rates_of
from parse import (Issues, as_num, blank, extract_birth_frame, extract_hints, name_tags, parse_flag, parse_gain,
                   parse_list, parse_num, sec_to_frames)

# 列号（0 起），见 TD-01 §8
E_NAME, E_ACTION, E_SPAWN, E_LIFE, E_HS_SELF, E_HS_ENEMY = 0, 1, 2, 3, 4, 5
E_END, E_PARRY, E_PERSIST, E_TOUGH, E_ENERGY, E_CONCERTO, E_PRIORITY = 8, 9, 10, 11, 12, 13, 15
E_KIND, E_CD, E_STAGE_CD, E_STAGE_WIN, E_POSITION, E_POS_CHANGE, E_NOTE, E_DESC, E_DIL_TYPE = (
    16, 17, 18, 19, 20, 21, 22, 23, 24)
DIL_SIDES = [('self', 25), ('enemy', 28), ('ally', 31)]
NCOLS = 34
BODIES = ('成女', '少女', '萝莉', '男大', '男中', '男小')
KINDS = ('召唤', '变身')
REL_PROP = {'攻击': 7, '生命': 2, '防御': 10}       # nanoka related_property → dmg RelatedProperty（§4.2）
_DESC_CD = re.compile(r'技能冷却[：:]\s*([\d.]+)\s*秒')


def build_costs(rows: list) -> dict[str, int]:
    """`索引` 页 48 行起：B 列 COST4 / COST3 / COST1 标出档位，其后各行 C 列起是声骸名，延续到下一个档位标签（§6）"""
    out, cost = {}, None
    for r in rows:
        r = list(r) + [None] * 23
        m = re.fullmatch(r'COST(\d)', str(r[1] or '').strip())
        if m:
            cost = int(m.group(1))
        if cost is None:
            continue
        for v in r[2:23]:
            name = None if blank(v) else str(v).strip()
            if name and name != '梦魇':                  # 49 行只标出有梦魇版本的声骸
                out.setdefault(name, cost)
    return out


def cost_of(name: str, costs: dict) -> int | None:
    """按名字精确查，查不到再去掉 梦魇· / 异相· 前缀查（§6）"""
    if name in costs:
        return costs[name]
    for p in ('梦魇·', '异相·'):
        if name.startswith(p) and name[len(p):] in costs:
            return costs[name[len(p):]]
    return None


def _pad(row) -> list:
    return list(row or []) + [None] * NCOLS


def _merged(values: list, merges: dict, i: int, col: int):
    """单元格的值；在多行合并区里取首行的值"""
    if (i, col + 1) in merges:
        return values[merges[(i, col + 1)][0] - 1][col]
    return values[i - 1][col]


def _cd_frames(sec) -> int | None:
    """冷却：秒 → 帧（§1.6）；0 秒就是没有冷却"""
    if sec is None:
        return None
    return 0 if sec == 0 else sec_to_frames(sec)


def parse_echo_sheet(values: list, formulas: list, merges: dict, costs: dict, issues: Issues) -> list[dict]:
    """values / formulas：按行的单元格值（1 起行号 = 下标 + 1）；merges：{(行, 列1起): (首行, 末行)}；costs：build_costs 的结果"""
    blocks, cur = [], None
    for i in range(2, len(values) + 1):
        r = _pad(values[i - 1])
        f = _pad(formulas[i - 1] if i - 1 < len(formulas) else [])
        if not blank(r[E_NAME]):
            cur = {'key': str(r[E_NAME]).strip(), 'startRow': i, 'rows': [], 'ignoredRows': 0}
            blocks.append(cur)
        if cur is None:
            continue
        if blank(r[E_ACTION]):
            if any(not blank(x) for x in r[2:NCOLS]):
                cur['ignoredRows'] += 1
            continue
        cur['rows'].append((i, r, f))
    return [build_echo(b, values, merges, costs, issues) for b in blocks if b['rows']]


def build_echo(b: dict, values: list, merges: dict, costs: dict, issues: Issues) -> dict:
    key, start = b['key'], b['startRow']
    desc = _merged(values, merges, start, E_DESC)
    desc = None if blank(desc) else str(desc).strip()
    m = _DESC_CD.findall(desc or '')
    desc_cd = _cd_frames(float(m[-1])) if m else None

    variants: list[list] = []
    for item in b['rows']:
        if not variants or not blank(item[1][E_KIND]):
            variants.append([])
        variants[-1].append(item)

    groups, flags = [], []
    for vi, items in enumerate(variants, 1):
        i0, r0, _ = items[0]
        kind = None if blank(r0[E_KIND]) else str(r0[E_KIND]).strip()
        if kind is not None and kind not in KINDS:
            issues.add('warn', '声骸类型未知', f'声骸 R{i0}: {kind}')
            kind = None
        cooldown = _cd_frames(parse_num(_merged(values, merges, i0, E_CD), f'声骸 R{i0} 冷却', issues))
        rows = [(parse_echo_row(i, r, f, values, merges, issues), i) for i, r, f in items]
        stage_of = {i: (_merged(values, merges, i, E_STAGE_CD), _merged(values, merges, i, E_STAGE_WIN)) for i, _, _ in items}
        stages: dict[str, list] = {}
        if any(s is not None or t is not None for s, t in stage_of.values()):
            for row, i in rows:
                stages.setdefault(row['name'].split('-', 1)[0], []).append((row, i))
        if len(stages) > 1:
            flags.append('stagesGuess')
            names = list(stages)
            for k, prefix in enumerate(names, 1):
                st = stages[prefix]
                nxt = None
                if k < len(names):
                    win = next(((s, t) for _, i in st for s, t in [stage_of[i]] if s is not None or t is not None), None)
                    if win and win[0] is not None and win[1] is not None:
                        nxt = {'from': sec_to_frames(win[0]), 'until': sec_to_frames(win[1])}
                    else:
                        issues.add('warn', '声骸分段缺单段冷却 / 接续时限', f'{key} {prefix}')
                groups.append(_group(prefix, vi, k, None, kind, cooldown if k == 1 else None, nxt, [r for r, _ in st]))
        else:
            names = [r['name'] for r, _ in rows]
            body = next((p for p in BODIES if names[0].startswith(p + '-')), None)
            if body:
                names = [n.removeprefix(body + '-') for n in names]
            groups.append(_group(group_id(names), vi, None, body, kind, cooldown, None, [r for r, _ in rows]))
    _dedupe(groups)

    cost = cost_of(key, costs)
    if cost is None:
        flags.append('costMissing')
    if desc_cd is not None and groups[0]['cooldown'] is not None and desc_cd != groups[0]['cooldown']:
        flags.append('cooldownText')
    if desc and '可使用次数' in desc:
        flags.append('charges')
    tk = text_kind(desc)
    if tk is not None and groups[0]['kind'] is not None and tk != groups[0]['kind']:
        flags.append('kindText')
    return {'key': key, 'startRow': start, 'cost': cost, 'description': desc, 'descCooldown': desc_cd, 'textKind': tk,
            'ignoredRows': b['ignoredRows'], 'groups': groups, 'flags': flags}


def text_kind(desc: str | None) -> str | None:
    """说明里先出现的"幻形"（→ 变身，不脱手）或"召唤"（→ 召唤，脱手）；都没有为 None"""
    hits = [(desc.find(w), k) for w, k in (('幻形', '变身'), ('召唤', '召唤'))] if desc else []
    hits = [h for h in hits if h[0] >= 0]
    return min(hits)[1] if hits else None


def group_id(names: list[str]) -> str:
    """组名：各行名的公共前缀去掉末尾的 - 与数字（斩击1…斩击6 → 斩击，转圈-1…4 → 转圈）；
    没有公共前缀时同动作表 §3.5（首行名去掉最后一个 -后缀）"""
    if len(names) > 1:
        p = os.path.commonprefix(names).rstrip('-0123456789')
        if p:
            return p
    first = names[0]
    return first if (len(names) == 1 or '-' not in first) else first.rsplit('-', 1)[0]


def drop_phantoms(echoes: list[dict]) -> tuple[list[dict], list[tuple[str, bool]]]:
    """异相·X：本体 X 在表里的不单独产出（装配时取本体）。返回 (留下的, [(异相名, 表里数值是否与本体不同)])"""
    by = {e['key']: e for e in echoes}
    kept, dropped = [], []
    for e in echoes:
        base = by.get(e['key'].removeprefix('异相·')) if e['key'].startswith('异相·') else None
        if base is None:
            kept.append(e)
            continue
        dropped.append((e['key'], _numbers(e) != _numbers(base)))
    return kept, dropped


def _numbers(e: dict) -> list:
    """比较用：各行的帧、削韧、能量，加技能说明"""
    return [e['description']] + [(r['name'], r['spawnFrame'], r['lifeFrames'], r['endFrame'], r['toughness'],
                                  (r['gains']['energy'] or {}).get('total')) for g in e['groups'] for r in g['rows']]


def _group(gid, variant, stage, body, kind, cooldown, nxt, rows) -> dict:
    return {'id': gid, 'variant': variant, 'stage': stage, 'body': body, 'kind': kind, 'cooldown': cooldown,
            'next': nxt, 'rows': rows}


def _dedupe(groups: list) -> None:
    """组名在声骸内唯一（体型分组同名不算）：冲突的用首行全名，仍冲突加 #n（同动作表 §3.5）"""
    used: set = set()
    for g in groups:
        k = (g['id'], g['body'])
        if k in used:
            g['id'] = g['rows'][0]['name']
            n = 2
            while (g['id'], g['body']) in used:
                g['id'] = f"{g['rows'][0]['name']}#{n}"
                n += 1
        used.add((g['id'], g['body']))


def parse_echo_row(i: int, r: list, f: list, values: list, merges: dict, issues: Issues) -> dict:
    """一行 → 与动作表行相同的结构（GenRowSchema）"""
    where = f'声骸 R{i}'
    flags: list[str] = []
    c = r[E_ACTION]
    name = str(as_num(float(c))) if isinstance(c, (int, float)) and not isinstance(c, bool) else str(c).strip()
    note, note_merged = r[E_NOTE], False
    if blank(note) and (i, E_NOTE + 1) in merges:
        note, note_merged = values[merges[(i, E_NOTE + 1)][0] - 1][E_NOTE], True
    note = None if blank(note) else str(note).strip()

    spawn = parse_num(r[E_SPAWN], where + ' 发生帧', issues)
    life = parse_num(r[E_LIFE], where + ' 持续帧', issues)
    energy = parse_gain(r[E_ENERGY], f[E_ENERGY], where + ' energy', issues)
    concerto = parse_gain(r[E_CONCERTO], f[E_CONCERTO], where + ' concerto', issues)
    if any(g is not None and g.get('complex') for g in (energy, concerto)):
        flags.append('gainComplex')
    toughness = parse_num(r[E_TOUGH], where + ' 削韧值', issues)
    persists = parse_flag(r[E_PERSIST], where + ' 可脱手', issues)

    dil_type = None if blank(r[E_DIL_TYPE]) else str(r[E_DIL_TYPE]).strip()
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

    # 行分类（§3.6）：声骸表没有命中类型列，有持续帧的就是判定（发生帧为空 = 事件生成，如标枪爆炸）
    any_gain = energy is not None or concerto is not None or toughness is not None
    if life is not None or (spawn is not None and any_gain):
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
        'birthFrame': extract_birth_frame(f[E_SPAWN], spawn),
        'lifeFrames': life,
        'hitstop': {'self': parse_num(r[E_HS_SELF], where, issues), 'enemy': parse_num(r[E_HS_ENEMY], where, issues)},
        'deriveFrame': None, 'deriveDuration': None,
        'endFrame': parse_num(r[E_END], where + ' 结束帧', issues),
        'priority': parse_list(r[E_PRIORITY], where + ' 中断优先级', issues),
        'priorityChange': None,
        'parry': parse_flag(r[E_PARRY], where + ' 可弹刀', issues),
        'persists': persists,
        'followHitstop': None,
        'toughness': toughness, 'tunability': None,
        'gains': {'energy': energy, 'concerto': concerto, 'core': [None, None, None]},
        'position': None if blank(r[E_POSITION]) else str(r[E_POSITION]).strip(),
        'positionChange': parse_list(r[E_POS_CHANGE], where + ' 状态转换时间', issues),
        'dilation': dilation,
        'hitTarget': None,
        'note': note, 'noteMerged': note_merged,
        'hints': extract_hints(note),
        'nameTags': name_tags(name),
        'flags': flags,
    }


# ---------------------------------------------------------------------------
# 倍率（§8、§13.3）

def nanoka_view(echo: str, e: dict) -> dict:
    """nanoka 声骸的伤害条目 → 与 dmg_view 相同的结构（via = 'nanoka'）"""
    rates = [as_num(float(x)) for x in e['rateLv']][:20]
    rates += [0] * (20 - len(rates))
    lv = level_index(echo, '', rates, echo=True)
    return {
        'via': 'nanoka', 'charaId': echo, 'skillName': f"nanoka::{e['id']}", 'dmgCalc': None,
        'skillId': int(e['id']) if str(e['id']).isdigit() else None, 'skillType': None, 'calcType': 0,
        'element': e['element'], 'damageType': e['type'], 'subType': None,
        'relatedProperty': REL_PROP.get(e['relatedProperty'], 0), 'multiplier': rates[lv - 1] / 10000, 'rates': rates,
        'energy': e['energy'], 'toughLv': e['toughLv'], 'weaknessLvl': e['weaknessLvl'], 'hardnessLv': e['hardnessLv'],
        'formulaType': 0,
    }


def _nanoka_match(row: dict, entries: list) -> tuple[dict | None, list]:
    """按削韧值、大招回收（× 100，容差 1）找 nanoka 条目；候选的倍率都相同才算连上。返回 (条目, 候选)"""
    tough = row['toughness'] or 0
    energy = (row['gains']['energy'] or {}).get('total') or 0
    if not tough and not energy:
        return None, []
    cands = [e for e in entries
             if abs(e['toughLv'] - round(tough * 100)) <= 1 and abs(e['energy'] - round(energy * 100)) <= 1]
    if len({tuple(e['rateLv']) for e in cands}) == 1:
        return cands[0], cands
    return None, cands


def join_echo(echo: dict, dmg: dict, dmg_join: dict, nk: dict | None, issues: Issues, gaps: list) -> None:
    """给声骸的判定行挂倍率：dmg-join.json（行名 → dmg 行名 / 'nanoka::<条目>' / null）→ dmg 同名行（倍率全 0 的不算）
    → nanoka 条目（削韧值、大招回收对得上）。都没有的伤害型判定打 noDmg，记入 gaps（报告列出 nanoka 的候选）"""
    key = echo['key']
    aliases = dmg_join.get(key, {})
    entries = (nk or {}).get('damage', [])
    for g in echo['groups']:
        for row in g['rows']:
            if row['kind'] != 'hit':
                continue
            name = row['name']
            if name in aliases:
                target = aliases[name]
                if target is None:
                    continue                                           # 明确无伤害
                if target.startswith('nanoka::'):
                    e = next((x for x in entries if str(x['id']) == target[len('nanoka::'):]), None)
                    if e is None:
                        issues.add('error', 'dmgJoin 指向不存在的 nanoka 条目', f'{key} {name} → {target}')
                    else:
                        row['dmg'] = nanoka_view(key, e)
                    continue
                c2, n2 = target.split('::', 1) if '::' in target else (key, target)
                entry = dmg.get((c2, n2))
                if entry is None:
                    issues.add('error', 'dmgJoin 指向不存在的 dmg 行', f'{key} {name} → {target}')
                elif entry['noConfig']:
                    row['flags'].append('dmgNoConfig')
                else:
                    row['dmg'] = dmg_view(entry, 'alias', echo=True)
                continue
            entry = dmg.get((key, name))
            if entry is not None and entry['noConfig']:
                row['flags'].append('dmgNoConfig')
                continue
            if entry is not None and any(rates_of(entry)):
                row['dmg'] = dmg_view(entry, 'direct', echo=True)
                continue
            e, cands = _nanoka_match(row, entries)
            if e is not None:
                row['dmg'] = nanoka_view(key, e)
                continue
            if not row['hints'].get('noDamage'):
                row['flags'].append('noDmg')
                gaps.append({'block': key, 'group': g['id'], 'row': row['row'], 'name': name,
                             'suggest': [f"nanoka::{x['id']}（{x['rateLv'][-1] / 100:g}%）" for x in (cands or entries)]})
