"""xlsx 版本清单 data/xlsx-versions.json：每份 xlsx 的版本、文件名、sha256、资源版本，current 是构建缺省用的那份。

xlsx 不进 git（公开仓库不发布原作者的数据），清单进 git：凭哈希能确认用的是哪一份，换版本只改 current（总设计 T15）。
文件放在 data/raw/ 或它的子目录（如 archive/）都行，按文件名找。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pick_xlsx(arg: str | None, raw: Path, manifest: Path) -> tuple[Path | None, dict | None, list[tuple[str, str]]]:
    """返回 (xlsx 路径, 清单条目, 问题)；问题是 ('error' | 'warn', 说明)，有 error 时路径为 None。
    不传路径：取清单的 current，在 raw 下（含子目录）按文件名找，核对 sha256。
    传了路径：照用；清单里有同名文件就核对 sha256，没有就警告去登记。"""
    entries, current = [], None
    if manifest.exists():
        m = json.loads(manifest.read_text('utf-8'))
        entries, current = m.get('versions', []), m.get('current')
    elif arg is None:
        return None, None, [('error', f'没有 {manifest.name}：先登记 xlsx 版本，或直接传 xlsx 路径')]
    problems: list[tuple[str, str]] = []
    if arg is not None:
        path = Path(arg)
        if not path.exists():
            return None, None, [('error', f'找不到 {arg}')]
        entry = next((e for e in entries if e['file'] == path.name), None)
        if entry is None:
            problems.append(('warn', f'{path.name} 不在 {manifest.name} 里：确认要用的话登记版本、sha256 与资源版本'))
    else:
        entry = next((e for e in entries if e['version'] == current), None)
        if entry is None:
            return None, None, [('error', f'{manifest.name} 的 current（{current}）在 versions 里找不到')]
        path = next(iter(sorted(raw.rglob(entry['file']))), None)
        if path is None:
            return None, entry, [('error', f'data/raw/ 下找不到 {entry["file"]}（current = {current}）：放进 data/raw/ 或它的子目录')]
    if entry is not None:
        sha = sha256_of(path)
        if sha != entry['sha256']:
            return None, entry, [('error', f'{path.name} 的 sha256 与清单登记的不同：{sha[:12]}… ≠ {entry["sha256"][:12]}…')]
    return path, entry, problems
