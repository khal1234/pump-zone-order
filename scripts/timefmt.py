"""초 단위 시각을 mm:ss 문자열로 바꾸는 유틸리티."""
from __future__ import annotations
HOUR = 3600

def hms(sec) -> str:
    try:
        t = int(float(sec))
    except (TypeError, ValueError):
        return ''
    sign = '-' if t < 0 else ''
    t = abs(t)
    if t >= HOUR:
        return '%s%d:%02d:%02d' % (sign, t // HOUR, t % HOUR // 60, t % 60)
    return '%s%d:%02d' % (sign, t // 60, t % 60)

def to_sec(text) -> int | None:
    if text is None:
        return None
    s = str(text).strip()
    if not s:
        return None
    neg = s.startswith('-')
    s = s.lstrip('-')
    if s.isdigit():
        return -int(s) if neg else int(s)
    part = s.split(':')
    if not all((p.strip().isdigit() for p in part)) or not 2 <= len(part) <= 3:
        return None
    v = 0
    for p in part:
        v = v * 60 + int(p)
    return -v if neg else v
