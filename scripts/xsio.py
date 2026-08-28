"""표준출력 UTF-8 강제 등 자잘한 IO 유틸리티."""
from __future__ import annotations
import sys
MARKER = 'force_utf8'
LEGACY = 'reconfigure(encoding="utf-8"'

def force_utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
