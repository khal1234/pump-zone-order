"""잘린 곡 제목을 정식 제목으로 펴는 유틸리티."""
from __future__ import annotations
import csv
import io
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SRC = ((ROOT / 'out' / 'arcadestat_p2.csv', 'title'), (ROOT / 'out' / 'arcade_series_zone_order.csv', '곡'))
CUT = re.compile('(…|\\.\\.\\.)\\s*\\)?\\s*$')
_CANON: set | None = None

def canon() -> set:
    global _CANON
    if _CANON is not None:
        return _CANON
    out: set = set()
    for p, col in SRC:
        if not p.is_file():
            continue
        for r in csv.DictReader(io.open(p, encoding='utf-8-sig')):
            t = (r.get(col) or '').strip()
            if t:
                out.add(t)
    _CANON = out
    return out

def looks_cut(name: str) -> bool:
    n = (name or '').strip()
    return bool(n) and (bool(CUT.search(n)) or n not in canon())

def expand(name: str) -> str:
    n = (name or '').strip()
    if not n or n in canon():
        return n
    stem = CUT.sub('', n).rstrip(' (').strip()
    if not stem:
        return n
    hit = sorted((c for c in canon() if c.startswith(stem)))
    if len(hit) == 1:
        return hit[0]
    base = [c for c in hit if ' - ' not in c]
    if len(base) == 1:
        return base[0]
    return n
