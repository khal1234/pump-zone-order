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

def trash(path: str) -> bool:
    import os as _os
    import sys as _sys
    if not _os.path.exists(path):
        return False
    if _sys.platform != 'win32':
        return False
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [('hwnd', wintypes.HWND), ('wFunc', wintypes.UINT), ('pFrom', wintypes.LPCWSTR), ('pTo', wintypes.LPCWSTR), ('fFlags', ctypes.c_uint16), ('fAnyOperationsAborted', wintypes.BOOL), ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', wintypes.LPCWSTR)]
    FO_DELETE = 3
    FOF_ALLOWUNDO = 64
    FOF_NOCONFIRMATION = 16
    FOF_SILENT = 4
    FOF_NOERRORUI = 1024
    op = SHFILEOPSTRUCTW()
    op.wFunc = FO_DELETE
    op.pFrom = _os.path.abspath(path) + chr(0) * 2
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    return rc == 0 and (not _os.path.exists(path))
