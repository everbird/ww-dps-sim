"""构建报告 build-report.md（TD-01 §12.4）。"""
from __future__ import annotations

from collections import Counter, defaultdict

from golden import recompute
from parse import Issues


def render(meta: dict, counts: dict, blocking: list[str], strict: dict, gaps: list, cross: list, issues: Issues,
           blocks: list, flags: Counter) -> str:
    out = ['# 构建报告', '',
           f"xlsx：{meta['xlsxFile']}（sha256 {meta['xlsxSha256'][:12]}）· 资源版本 {meta['resourceVersion']} · {meta['builtAt']}", '']

    out += ['## 概览', '', '| 项 | 数 |', '|---|---|']
    out += [f'| {k} | {v} |' for k, v in counts.items()]
    out.append('')

    out += ['## 阻断（构建失败）', '']
    out += [f'- {b}' for b in blocking] if blocking else ['无。']
    out.append('')

    out += ['## 严格名单的连接缺口', '']
    if not strict:
        out += ['本次构建没有指定 `--strict`。', '']
    for name, rows in strict.items():
        out += [f'### {name}（{len(rows)}）', '']
        if rows:
            out += ['| 行 | 动作 | 判定 | 建议 |', '|---|---|---|---|']
            out += [f"| R{g['row']} | {g['group']} | {g['name']} | {'、'.join(g['suggest']) or '—'} |" for g in rows]
        else:
            out.append('全部连上，或已在 `dmg-join.json` 里明确处理。')
        out.append('')

    out += ['## 全量连接缺口（按块：缺口数 / 前 5 个）', '', '| 块 | 缺口 | 前 5 个 |', '|---|---|---|']
    by_block: dict[str, list] = defaultdict(list)
    for g in gaps:
        by_block[g['block']].append(g['name'])
    for k, names in sorted(by_block.items(), key=lambda kv: -len(kv[1])):
        out.append(f"| {k} | {len(names)} | {'、'.join(names[:5])} |")
    out.append('')

    out += ['## 交叉校验', '', '| 项 | 一致 | 不符 |', '|---|---|---|']
    for kind in ('energy', 'toughness', 'tunability'):
        ok = sum(1 for c in cross if c[0] == kind and c[1])
        bad = [c for c in cross if c[0] == kind and not c[1]]
        out.append(f'| {kind} | {ok} | {len(bad)} |')
    bad_rows = [c for c in cross if not c[1]]
    if bad_rows:
        out += ['', '| 项 | 块 | 行 | 判定 | 动作表 × 100 | dmg |', '|---|---|---|---|---|---|']
        out += [f'| {c[0]} | {c[2]} | R{c[3]} | {c[4]} | {c[5] * 100:g} | {c[6]:g} |' for c in bad_rows]
    out.append('')

    out += ['## 解析问题（按类型，每类最多列 20 条）', '']
    if not issues.items:
        out.append('无。')
    for (level, kind), items in sorted(issues.items.items()):
        out.append(f'- **{level} · {kind}**（{len(items)}）')
        out += [f'  - {x}' for x in items[:20]]
    out.append('')

    out += ['## 忽略的行（按块）', '']
    ign = [(b['key'], b['ignoredRows']) for b in blocks if b['ignoredRows']]
    out += [f'- {k}：{n}' for k, n in ign] if ign else ['无。']
    out.append('')

    out += ['## 行级 flag', '', '| flag | 行数 |', '|---|---|']
    out += [f'| `{k}` | {v} |' for k, v in flags.most_common()]
    out.append('')
    return '\n'.join(out)


def render_echoes(echoes: list, gaps: list, has_nanoka: bool, phantoms: list) -> str:
    """声骸一节（TD-01 §8）：倍率来源、声骸级 flag、不单独产出的异相、连不上的判定（附 nanoka 候选，写进 dmg-join.json 才采用）"""
    hits = [r for e in echoes for g in e['groups'] for r in g['rows'] if r['kind'] == 'hit']
    via = Counter(r['dmg']['via'] for r in hits if 'dmg' in r)
    out = ['', '## 声骸', '',
           f"{len(echoes)} 个声骸、{sum(len(e['groups']) for e in echoes)} 组（动作）、{len(hits)} 个判定行 → `echoes.json`。"
           f"倍率：dmg 直接 {via['direct']}、dmg 别名 {via['alias']}、nanoka {via['nanoka']}，没连上（noDmg）{len(gaps)}。"
           + ('' if has_nanoka else '（没有 nanoka 声骸数据，倍率只来自 dmg）'), '']
    if phantoms:
        out.append('- 异相只换配色、数值同本体（2026-10-04 确认），不单独产出、装配时取本体：'
                   + '、'.join(f"{k}{'（表里数值与本体不同，不用）' if diff else ''}" for k, diff in phantoms))
    names = {
        'cooldownText': '「冷却」列与技能说明的"技能冷却"不同（取「冷却」列）',
        'charges': '按次数充能（说明里有"可使用次数"；仿真按普通冷却算）',
        'stagesGuess': '多段声骸（按行名前缀分段，要核对）',
        'costMissing': '`索引` 页查不到 COST',
        'kindText': '「类型」列与说明的"召唤 / 幻形"不同（脱手与否以说明为准）',
    }
    for flag, label in names.items():
        es = [e for e in echoes if flag in e['flags']]
        if not es:
            continue
        if flag == 'cooldownText':
            items = [f"{e['key']}（{e['groups'][0]['cooldown']} / {e['descCooldown']} 帧）" for e in es]
        elif flag == 'kindText':
            items = [f"{e['key']}（列 {e['groups'][0]['kind']} / 说明 {e['textKind']}）" for e in es]
        elif flag == 'stagesGuess':
            items = [f"{e['key']}（{' → '.join(g['id'] for g in e['groups'] if g['stage'])}）" for e in es]
        else:
            items = [e['key'] for e in es]
        out.append(f"- {label}：{'、'.join(items)}")
    if gaps:
        out += ['', '没连上的伤害型判定（按声骸；候选只是提示，确认后写进 `dmg-join.json`："行名": "nanoka::条目" 或 null）：', '',
                '| 声骸 | 缺口 | 判定 | nanoka 候选 |', '|---|---|---|---|']
        by: dict[str, list] = defaultdict(list)
        for g in gaps:
            by[g['block']].append(g)
        for k, gs in sorted(by.items(), key=lambda kv: -len(kv[1])):
            sug = '、'.join(dict.fromkeys(x for g in gs for x in g['suggest'])) or '—'
            out.append(f"| {k} | {len(gs)} | {'、'.join(g['name'] for g in gs[:5])}{' …' if len(gs) > 5 else ''} | {sug} |")
    out.append('')
    return '\n'.join(out)


def render_golden(gd: dict, zones: list, info: dict) -> str:
    """golden 一节（TD-01 §11.1、TD-03 §10.1 第 5 步）：计数、未纳入的格、重算不等或有未归类因子的格"""
    by_formula = Counter(g['formula'] for g in zones)
    bad = [(g, recompute(g)) for g in zones]
    bad = [(g, v) for g, v in bad if v != g['expected']]
    other = [g for g in zones if 'other' in g['z']]
    keyed = sum(1 for e in gd['entries'] if 'dmgKey' in e)
    skipped = '、'.join(f'{k} {v}' for k, v in info['skipped'].items()) or '无'
    out = ['', '## golden', '',
           f"标准答案 {len(gd['entries'])} 条（带 dmgKey {keyed}）→ `fixtures/golden-damage.json`；"
           f"计算器当前配置：{gd['context']['char']} 打 {gd['context']['target'].get('类型', '?')}。", '',
           f"逐格乘区 {len(zones)} 格 → `fixtures/golden-zones.json`："
           + '、'.join(f'{k} {by_formula[k]}' for k in ('hurt', 'abnormal', 'tune', 'heal')) + f'；未纳入：{skipped}。', '',
           f'按 TD-03 公式重算：不等 {len(bad)} 格，有未归类因子 {len(other)} 格。', '']
    out += [f"- 不等：{g['cell']} {g['name']}：重算 {v:g}，缓存 {g['expected']:g}" for g, v in bad[:20]]
    out += [f"- 未归类因子：{g['cell']} {g['name']}" for g in other[:20]]
    if info['problems']:
        by_note: dict[str, list[str]] = defaultdict(list)
        for coord, name, note in info['problems']:
            by_note[note].append(f'{coord} {name}')
        out += ['拆分时的提示（提示：格数，前 3 格）：', '']
        out += [f"- {note}：{len(cells)}（{'、'.join(cells[:3])}）" for note, cells in by_note.items()]
    out.append('')
    return '\n'.join(out)
