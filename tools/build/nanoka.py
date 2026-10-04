"""nanoka 静态数据：角色技能冷却、技能文本与技能树属性节点（m0-confirm §5、TD-01 §12.5）。

来源 https://static.nanoka.cc：
  manifest.json                     → ww.live / ww.latest 版本号
  ww/<版本>/character.json          → 角色 ID 表（按中文名 zh 对上 xlsx 的块名）
  ww/<版本>/zh/character/<ID>.json  → skill_trees[].skill：类型、名字、描述、level 参数（含"冷却时间"）；
                                      node_type 4 的节点是属性加成（"攻击提升 1.80%"），按名字求和成 treeStats
  ww/<版本>/echo.json               → 声骸 ID 表（按中文名对上 xlsx 声骸表的 A 列；异相·X 取 X）
  ww/<版本>/zh/echo/<ID>.json       → skill：说明与各级参数、damage（各伤害条目的倍率、削韧、能量…）；group：所属套装与件数效果

下载的原文件缓存在 data/raw/nanoka/<版本>/（不进 git），有缓存就不再联网。
只在构建时用，运行时不依赖外网（总设计 §13）。

单独运行：python3 tools/build/nanoka.py [--version 3.7]   → 只重写 data/generated/nanoka.json
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

BASE = 'https://static.nanoka.cc'
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'data' / 'raw' / 'nanoka'
SKILL_LEVEL = 10          # 技能等级 10（满级）；冷却各级相同，不同时报出来
ECHO_LEVEL = 5            # 声骸技能满级 5（TD-01 §4.3）
_TAG = re.compile(r'<[^>]*>')
_COOLDOWN = re.compile(r'冷却时间$')


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'ww-dps-sim build'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _cached(rel: str, version_dir: Path) -> dict:
    path = version_dir / rel
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_get(f'{BASE}/ww/{version_dir.name}/{rel}'))
    return json.loads(path.read_text('utf-8'))


def resolve_version(requested: str) -> str:
    """'live' / 'latest' 查 manifest；连不上时退回缓存里最新的版本目录"""
    if requested not in ('live', 'latest'):
        return requested
    try:
        return json.loads(_get(f'{BASE}/manifest.json'))['ww'][requested]
    except Exception as e:  # noqa: BLE001 —— 网络失败都一样处理
        have = sorted((p.name for p in CACHE.glob('*') if p.is_dir()), key=_ver_key)
        if not have:
            raise RuntimeError(f'连不上 nanoka（{e}），本地也没有缓存') from e
        return have[-1]


def _ver_key(v: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 0 for x in v.split('.'))


def fill(desc: str, params: list) -> str:
    """去掉富文本标签，把 {0} {1} … 换成参数"""
    text = _TAG.sub('', desc or '')
    return re.sub(r'\{(\d+)\}', lambda m: str(params[int(m.group(1))]) if int(m.group(1)) < len(params) else m.group(0), text)


def _percent(p) -> float | None:
    """'1.80%' → 0.018（按十进制算，免得浮点尾巴）"""
    from decimal import Decimal, InvalidOperation
    try:
        return float(Decimal(str(p).strip().rstrip('%')) / 100)
    except (InvalidOperation, ValueError):
        return None


def tree_stats(raw: dict) -> dict[str, float]:
    """技能树属性节点（node_type 4）：名字 → 全部点亮后的合计"""
    from decimal import Decimal
    tot: dict[str, Decimal] = {}
    for node in (raw.get('skill_trees') or {}).values():
        if str(node.get('node_type')) != '4':
            continue
        s = node.get('skill') or {}
        v = _percent((s.get('param') or [None])[0])
        if v is None or not s.get('name'):
            continue
        tot[s['name']] = tot.get(s['name'], Decimal(0)) + Decimal(str(v))
    return {k: float(v) for k, v in tot.items()}


def extract_character(raw: dict) -> dict:
    """一个角色文件 → {id, skills, chains, treeStats}；skills 只留有类型的技能节点（属性加成节点没有 type）"""
    skills = []
    for key in sorted(raw.get('skill_trees', {}), key=int):
        s = raw['skill_trees'][key].get('skill') or {}
        if not s.get('type'):
            continue
        cooldowns = []
        for item in (s.get('level') or {}).values():
            if not _COOLDOWN.search(item.get('name', '')):
                continue
            row = (item.get('param') or [[]])[0]
            if not row:
                continue
            vals = {float(v) for v in row}
            sec = float(row[min(SKILL_LEVEL, len(row)) - 1])
            cd = {'name': item['name'], 'seconds': sec, 'frames': round(sec * 60)}
            if len(vals) > 1:
                cd['variesByLevel'] = True
            cooldowns.append(cd)
        skills.append({'type': s['type'], 'name': s.get('name', ''), 'desc': fill(s.get('desc', ''), s.get('param') or []),
                       'cooldowns': cooldowns})
    chains = [{'n': int(k), 'name': c.get('name', ''), 'desc': fill(c.get('desc', ''), c.get('param') or [])}
              for k, c in sorted((raw.get('chains') or {}).items(), key=lambda kv: int(kv[0]))]
    return {'id': raw['id'], 'name': raw.get('name', ''), 'skills': skills, 'chains': chains, 'treeStats': tree_stats(raw)}


def extract_echo(raw: dict) -> dict:
    """一个声骸文件 → {id, name, desc, cooldown, damage, sets}：说明按 5 级填参数，伤害条目留各级倍率原值（× 10000）"""
    s = raw.get('skill') or {}
    params = s.get('param') or []
    lv = params[min(ECHO_LEVEL, len(params)) - 1] if params else []
    desc = fill(s.get('desc', ''), lv)
    m = re.findall(r'技能冷却[：:]\s*([\d.]+)\s*秒', desc)
    damage = [{'id': str(k), 'element': int(v.get('element') or 0), 'relatedProperty': v.get('related_property') or '',
               'type': int(v.get('type') or 0), 'rateLv': [_num(x) for x in v.get('rate_lv') or []],
               'energy': _num(v.get('energy')), 'toughLv': _num(v.get('tough_lv')),
               'weaknessLvl': _num(v.get('weakness_lvl')), 'hardnessLv': _num(v.get('hardness_lv'))}
              for k, v in sorted((s.get('damage') or {}).items())]
    sets = [g.get('name', '') for _, g in sorted((raw.get('group') or {}).items(), key=lambda kv: int(kv[0]))]
    return {'id': raw['id'], 'name': raw.get('name', ''), 'desc': desc, 'cooldown': float(m[-1]) if m else None,
            'damage': damage, 'sets': sets}


def extract_sets(raw: dict) -> dict:
    """声骸文件里的套装：名字 → {id, pieces: {件数: 说明}}"""
    out = {}
    for g in (raw.get('group') or {}).values():
        pieces = {str(n): fill(p.get('desc', ''), p.get('param') or []) for n, p in sorted((g.get('set') or {}).items())}
        out[g.get('name', '')] = {'id': int(g.get('id') or 0), 'pieces': pieces}
    return out


def _num(x):
    v = float(x or 0)
    return int(v) if v.is_integer() else v


def build(names: list[str], requested: str, name_map: dict[str, str | None],
          echo_names: list[str] = (), echo_map: dict[str, str | None] | None = None) -> tuple[dict, list[str]]:
    """xlsx 的角色名、声骸名 → nanoka 数据。name_map / echo_map 把 xlsx 名换成 nanoka 的中文名（null = 不取）。
    返回 (nanoka.json, 提示)"""
    version = resolve_version(requested)
    vdir = CACHE / version
    index = _cached('character.json', vdir)
    by_zh: dict[str, str] = {}
    for cid, v in sorted(index.items(), key=lambda kv: int(kv[0])):
        by_zh.setdefault(v.get('zh', ''), cid)            # 漂泊者男女两个 ID 技能相同，取小的
    out, notes = {}, []
    for name in names:
        zh = name_map.get(name, name)
        if zh is None:
            continue
        cid = by_zh.get(zh)
        if cid is None:
            notes.append(f'{name}：nanoka 里没有"{zh}"，在 data/curated/nanoka-names.json 里写对应名')
            continue
        out[name] = extract_character(_cached(f'zh/character/{cid}.json', vdir))
    echoes, sets = {}, {}
    if echo_names:
        eindex = _cached('echo.json', vdir)
        by_zh = {}
        for eid, v in sorted(eindex.items(), key=lambda kv: int(kv[0])):
            by_zh.setdefault(v.get('zh', ''), eid)
        missing = []
        for name in echo_names:
            zh = (echo_map or {}).get(name, name)
            if zh is None:
                continue
            eid = by_zh.get(zh) or by_zh.get(zh.removeprefix('异相·'))   # 异相是同一个声骸换了外观
            if eid is None:
                missing.append(name)
                continue
            raw = _cached(f'zh/echo/{eid}.json', vdir)
            echoes[name] = extract_echo(raw)
            sets.update(extract_sets(raw))
        if missing:
            notes.append(f"声骸 nanoka 里没有（在 nanoka-names.json 的「声骸」里写对应名）：{'、'.join(missing)}")
    return {'source': BASE, 'version': version, 'skillLevel': SKILL_LEVEL, 'characters': out,
            'echoes': echoes, 'echoSets': dict(sorted(sets.items()))}, notes


def load_name_map(curated: Path) -> dict:
    """角色名对应：nanoka-names.json 顶层的字符串 / null（"声骸"一节见 load_echo_name_map）"""
    p = curated / 'nanoka-names.json'
    if not p.exists():
        return {}
    return {k: v for k, v in json.loads(p.read_text('utf-8')).items() if not k.startswith('$') and not isinstance(v, dict)}


def load_echo_name_map(curated: Path) -> dict:
    """声骸名对应：nanoka-names.json 的"声骸"一节"""
    p = curated / 'nanoka-names.json'
    if not p.exists():
        return {}
    sec = json.loads(p.read_text('utf-8')).get('声骸') or {}
    return {k: v for k, v in sec.items() if not k.startswith('$')}


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description='nanoka → data/generated/nanoka.json')
    ap.add_argument('--version', default='live')
    argv = sys.argv[1:]
    if argv[:1] == ['--']:
        argv = argv[1:]
    args = ap.parse_args(argv)
    gen = ROOT / 'data' / 'generated'
    names = list(json.loads((gen / 'characters.json').read_text('utf-8')))
    echo_file = gen / 'echoes.json'
    echo_names = [e['key'] for e in json.loads(echo_file.read_text('utf-8'))] if echo_file.exists() else []
    cur = ROOT / 'data' / 'curated'
    data, notes = build(names, args.version, load_name_map(cur), echo_names, load_echo_name_map(cur))
    (gen / 'nanoka.json').write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    for n in notes:
        print(n, file=sys.stderr)
    print(f"nanoka {data['version']}：{len(data['characters'])} 个角色、{len(data['echoes'])} 个声骸 → {gen / 'nanoka.json'}"
          '（声骸倍率要重新 pnpm build:data 才会连上）', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
