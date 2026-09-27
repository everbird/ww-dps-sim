"""构建报告 build-report.md（TD-01 §12.4）。"""
from __future__ import annotations

from collections import Counter, defaultdict

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
