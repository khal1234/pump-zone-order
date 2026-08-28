"""확인 대장에서 채움 산출물(out/arcade_confirm_fill.csv)을 만든다."""
from __future__ import annotations
import csv
import io
import os
import re
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from xsio import force_utf8
force_utf8()
ROOT = HERE.parent
OUT = ROOT / 'out'
LEDGER = ROOT / 'user_confirmations.csv'
VERIFY = ROOT / 'frame_verify.csv'
DEST = OUT / 'arcade_confirm_fill.csv'
PROMOTE = ('맞음',)
_RANGE = re.compile('^(-?\\d+)\\s*[~-]\\s*(-?\\d+)$')

def parse_nums(cell: str):
    out = set()
    for tok in (cell or '').replace(',', ';').split(';'):
        tok = tok.strip()
        if not tok:
            continue
        m = _RANGE.match(tok)
        if m:
            lo, hi = (int(m.group(1)), int(m.group(2)))
            if '-' in tok[1:] and '~' not in tok and (lo < 0 or hi < 0):
                continue
            if lo <= hi and hi - lo < 5000:
                out.update(range(lo, hi + 1))
            continue
        try:
            out.add(int(tok))
        except ValueError:
            continue
    return out

def resolve(nums, size: int):
    out = set()
    for n in nums:
        if n > 0:
            out.add(n)
        elif n < 0 and size:
            a = size + 1 + n
            if 1 <= a <= size:
                out.add(a)
    return out

def confirmed():
    if not LEDGER.is_file():
        return ({}, set())
    body = [l for l in io.open(LEDGER, encoding='utf-8-sig') if not l.startswith('#')]
    out, whole = ({}, set())
    for r in csv.DictReader(io.StringIO(''.join(body))):
        if (r.get('판정') or '').strip() not in PROMOTE:
            continue
        z = (r.get('존') or '').strip()
        if not z:
            continue
        ns = parse_nums(r.get('번호') or '')
        if ns:
            out.setdefault(z, set()).update(ns)
        else:
            whole.add(z)
    return (out, whole)

def verified_zones():
    if not VERIFY.is_file():
        return set()
    body = [l for l in io.open(VERIFY, encoding='utf-8-sig') if not l.startswith('#')]
    zero, nonzero = (set(), set())
    for r in csv.DictReader(io.StringIO(''.join(body))):
        z = (r.get('존') or '').strip()
        if not z:
            continue
        (zero if (r.get('밀림') or '').strip() in ('0', '밀림 0') else nonzero).add(z)
    return zero - nonzero

def plan(seen, mx, names, conf, whole, verified=None):
    rows, tally, skipped = ([], [], [])
    zs = sorted(set(conf) | set(whole))
    for z in zs:
        total = mx.get(z) or 0
        nums = resolve(conf.get(z, ()), total)
        if any((n < 0 for n in conf.get(z, ()))) and (not total):
            skipped.append((z, sorted(conf[z]), '«-1» 표기인데 존 크기를 몰라 절대 번호로 못 바꾼다'))
        if z in whole and total:
            nums |= {n for n in range(1, total + 1)}
        if not nums:
            skipped.append((z, [], '확인은 있는데 번호도 없고 존 크기도 모른다'))
            continue
        if not total:
            skipped.append((z, sorted(nums), '그 존의 크기를 모른다(근거 파일에 행이 없다)'))
            continue
        import make_checkpoints as _mc
        gs = _mc.gaps(seen.get(z, set()), total)
        opened: dict = {}
        for n in sorted(nums):
            if n > total:
                skipped.append((z, [n], '존 크기 %d 를 넘는 번호' % total))
                continue
            for a, b in gs:
                if a <= n <= b:
                    opened.setdefault((a, b), []).append(n)
                    break
        if not opened:
            continue
        cnt = 0
        for (a, b), src in sorted(opened.items()):
            if z in whole:
                why = '사용자 확인 — **%s 존 전체**를 봤다고 하셨다 (번호 없이 존 단위). 못 본 구간 %d~%d 을 연다' % (z, a, b)
            else:
                head = '·'.join((str(x) for x in src[:6]))
                why = '사용자 확인(대부분 8/14 영상 눈판독) — %s 의 %s%s 번이 맞았다. 번호는 단조라 그 점이 맞으면 못 본 구간 %d~%d 전체의 밀림이 없다' % (z, head, ' 외 %d' % (len(src) - 6) if len(src) > 6 else '', a, b)
            grade = '구간확정' if verified and z in verified else '구간확정(미검증)'
            for n in range(a, b + 1):
                rows.append([z, n, names.get((z, n), ''), why, grade])
                cnt += 1
        tally.append((z, cnt, len(nums)))
    have = {(r[0], r[1]) for r in rows}
    for z in sorted(verified or ()):
        total = mx.get(z) or 0
        if not total:
            continue
        got = seen.get(z, set())
        add = 0
        for n in range(1, total + 1):
            if n in got or (z, n) in have:
                continue
            rows.append([z, n, names.get((z, n), ''), '영상 프레임 판독으로 **%s 의 밀림 0** 을 확인했다 — 우리 표가 이 존에서 맞다(frame_verify.csv)' % z, '구간확정'])
            add += 1
        if add:
            tally.append((z + ' (밀림0 존 전체)', add, 0))
    rows.sort(key=lambda r: (r[0], r[1]))
    return (rows, tally, skipped)

def build(quiet: bool=True):
    import make_checkpoints as mc
    seen, mx = mc.seen_by_zone(with_fill=False)
    conf, whole = confirmed()
    rows, tally, skipped = plan(seen, mx, mc.name_index(), conf, whole, verified_zones())
    with io.open(DEST, 'w', encoding='utf-8-sig', newline='\n') as fh:
        w = csv.writer(fh, lineterminator='\n')
        w.writerow(['존', '번호', '곡', '근거', '등급'])
        w.writerows(rows)
    if not quiet:
        named = sum((1 for r in rows if r[2]))
        print('확인 대장에서 승격 가능한 존 %d개 · 잠근 칸 **%d** (곡명이 붙은 것 %d)' % (len(tally), len(rows), named))
        for z, n, k in sorted(tally, key=lambda t: -t[1]):
            print('   %-12s %4d칸  (확인 %d곳)' % (z, n, k))
        for z, ns, why in skipped:
            print('   -- %-12s %s — %s' % (z, ns, why))
        print('-> %s' % DEST)
    return (rows, tally, skipped)

def selftest():
    bad = 0

    def eq(got, want, name):
        nonlocal bad
        if got != want:
            bad += 1
            print('  FAIL %s: %r != %r' % (name, got, want))
    eq(parse_nums('1-3;7'), {1, 2, 3, 7}, '파서-범위와낱개')
    eq(parse_nums('40;41'), {40, 41}, '파서-낱개둘')
    eq(parse_nums(''), set(), '파서-빈칸')
    eq(parse_nums('3-1'), set(), '파서-거꾸로범위')
    N = {}
    rows, tally, skip = plan({'S18': {1, 2, 3, 4, 11}}, {'S18': 11}, N, {'S18': {7}}, set())
    eq(sorted((r[1] for r in rows)), [5, 6, 7, 8, 9, 10], '구간전체잠금')
    eq([r[4] for r in rows][:1], ['구간확정(미검증)'], '등급-미검증존')
    rows2, _, _ = plan({'S18': {1, 2, 3, 4, 11}}, {'S18': 11}, N, {'S18': {7}}, set(), {'S18'})
    eq([r[4] for r in rows2][:1], ['구간확정'], '등급-확인된존')
    eq(plan({'S18': {1, 2, 3}}, {'S18': 3}, N, {'S18': {2}}, set())[0], [], '이미봄')
    rows, _, _ = plan({'CO-OP': {1}}, {'CO-OP': 5}, N, {}, {'CO-OP'})
    eq(sorted((r[1] for r in rows)), [2, 3, 4, 5], '존전체확인')
    rows, _, skip = plan({}, {}, N, {'뉴튠즈': {18}}, set())
    eq(rows, [], '크기모름-잠금없음')
    eq(len(skip), 1, '크기모름-사유남김')
    eq(PROMOTE, ('맞음',), '승격판정')
    rows, _, _ = plan({'S1': {1, 5, 9}}, {'S1': 9}, N, {'S1': {3, 7}}, set())
    eq(sorted((r[1] for r in rows)), [2, 3, 4, 6, 7, 8], '두구간')
    eq(parse_nums('-3~-1'), {-3, -2, -1}, '파서-음수범위')
    eq(parse_nums('-1'), {-1}, '파서-음수하나')
    eq(parse_nums('2~8;-2~-1'), {2, 3, 4, 5, 6, 7, 8, -2, -1}, '파서-섞임')
    eq(parse_nums('-3--1'), set(), '파서-모호한음수범위는 버린다')
    eq(resolve({-3, -2, -1}, 79), {77, 78, 79}, 'resolve-음수')
    eq(resolve({5, -1}, 79), {5, 79}, 'resolve-섞임')
    eq(resolve({-1}, 0), set(), 'resolve-크기모르면 버린다')
    eq(resolve({-99}, 10), set(), 'resolve-범위밖')
    rows, _, _ = plan({'S1': {1, 2, 3}}, {'S1': 9}, N, {'S1': {-1}}, set())
    eq(sorted((r[1] for r in rows)), [4, 5, 6, 7, 8, 9], '음수확인이 구간을 연다')
    print('selftest %d problem(s)' % bad)
    return 1 if bad else 0

def main() -> int:
    if '--selftest' in sys.argv:
        return selftest()
    build(quiet=False)
    return 0
if __name__ == '__main__':
    sys.exit(main())
