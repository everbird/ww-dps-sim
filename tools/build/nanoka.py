"""nanoka 静态数据：角色技能冷却与技能文本（m0-confirm §5；AGENTS.md 差异 4）。

来源 https://static.nanoka.cc：
  manifest.json                     → ww.live / ww.latest 版本号
  ww/<版本>/character.json          → 角色 ID 表（按中文名 zh 对上 xlsx 的块名）
  ww/<版本>/zh/character/<ID>.json  → skill_trees[].skill：类型、名字、描述、level 参数（含"冷却时间"）

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


def extract_character(raw: dict) -> dict:
    """一个角色文件 → {id, skills, chains}；只留有类型的技能节点（属性加成节点没有 type）"""
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
    return {'id': raw['id'], 'name': raw.get('name', ''), 'skills': skills, 'chains': chains}


def build(names: list[str], requested: str, name_map: dict[str, str | None]) -> tuple[dict, list[str]]:
    """xlsx 的角色名 → nanoka 数据。name_map 把 xlsx 名换成 nanoka 的中文名（null = 不取）。返回 (nanoka.json, 提示)"""
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
    return {'source': BASE, 'version': version, 'skillLevel': SKILL_LEVEL, 'characters': out}, notes


def load_name_map(curated: Path) -> dict:
    p = curated / 'nanoka-names.json'
    if not p.exists():
        return {}
    return {k: v for k, v in json.loads(p.read_text('utf-8')).items() if not k.startswith('$')}


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
    data, notes = build(names, args.version, load_name_map(ROOT / 'data' / 'curated'))
    (gen / 'nanoka.json').write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    for n in notes:
        print(n, file=sys.stderr)
    print(f"nanoka {data['version']}：{len(data['characters'])} 个角色 → {gen / 'nanoka.json'}", file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
