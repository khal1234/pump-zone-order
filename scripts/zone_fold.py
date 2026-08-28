"""레벨 상한 등 존 이름 정규화 유틸리티."""
from __future__ import annotations
import csv
import io
import os
import re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP_CSV = os.path.join(ROOT, 'arcade_level_cap.csv')
_LV = re.compile('^([SD])(\\d+)$')
_CACHE: dict | None = None

def _load() -> dict:
    global _CACHE
    if _CACHE is None:
        if not os.path.isfile(CAP_CSV):
            raise SystemExit('FAIL: 없음 -> %s (난이도 채널 상한 정본)' % CAP_CSV)
        out = {}
        for r in csv.DictReader(io.open(CAP_CSV, encoding='utf-8-sig')):
            side = (r.get('갈래') or '').strip().upper()
            cap = (r.get('상한') or '').strip()
            if side in ('S', 'D') and cap.isdigit():
                out[side] = (int(cap), (r.get('화면라벨') or '').strip())
        if not out:
            raise SystemExit('FAIL: %s 에 쓸 수 있는 줄이 없다' % CAP_CSV)
        _CACHE = out
    return _CACHE

def caps() -> dict:
    return {k: v[0] for k, v in _load().items()}

def fold(level: str) -> str:
    m = _LV.match((level or '').strip())
    if not m:
        return level
    side, n = (m.group(1).upper(), int(m.group(2)))
    c = _load().get(side)
    if not c:
        return level
    return '%s%d' % (side, c[0]) if n > c[0] else level

def fold_map(levels) -> dict:
    out = {}
    for lv in levels:
        f = fold(lv)
        if f != lv:
            out[lv] = f
    return out

def is_channel(level: str) -> bool:
    return fold(level) == level

def screen_label(channel: str) -> str:
    m = _LV.match((channel or '').strip())
    if not m:
        return ''
    side, n = (m.group(1).upper(), int(m.group(2)))
    c = _load().get(side)
    return c[1] if c and n == c[0] else ''
if __name__ == '__main__':
    import sys
    from xsio import force_utf8
    force_utf8()
    print('상한: %s' % caps())
    for lv in ('S24', 'S25', 'S26', 'S30', 'D26', 'D27', 'D28', 'D29', 'XX'):
        print('  %-4s -> %-4s  %s' % (lv, fold(lv), screen_label(fold(lv))))
    sys.exit(0)
