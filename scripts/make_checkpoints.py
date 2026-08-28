"""존별 확인 위치 자료를 모아 seen_by_zone() 등 조회 함수를 제공한다."""
from __future__ import annotations
import csv
import io
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from xsio import force_utf8
force_utf8()
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'out'
SEEN = ('직독', '곁칸', '플레이')
SCREEN_TILES = 5
ORIG_PROBES = 8
ZORDER = ['1st~ZERO', 'NX~NXA', 'FIESTA~FIESTA 2', 'PRIME', 'PRIME 2', 'XX', 'PHOENIX', 'PHOENIX 2']
EXCL_TILE = {'WORLD MUSIC', 'XROSS', 'K-POP'}

def _rd(p):
    return csv.DictReader(io.open(p, encoding='utf-8-sig'))

def zname(name: str) -> str:
    try:
        from check_channel_size import norm as _norm
        return _norm(name)
    except Exception:
        return (name or '').strip()

def sizes_from_nav() -> dict:
    p = OUT / 'nav_index.json'
    if not p.is_file():
        return {}
    idx = json.loads(io.open(p, encoding='utf-8').read())
    out: dict = {}
    for _t, v in (idx.get('channel') or {}).items():
        k, n = (zname(v.get('kind') or ''), v.get('total'))
        if k and n:
            out[k] = max(out.get(k, 0), int(n))
    for _t, ps in (idx.get('cats') or {}).items():
        for q in ps:
            k, n = (zname(q.get('tile') or ''), q.get('pos'))
            if k and n:
                out[k] = max(out.get(k, 0), int(n))
    return out

def seen_by_zone(with_fill: bool=True) -> tuple[dict, dict]:
    seen: dict = defaultdict(set)
    mx: dict = defaultdict(int)
    p = OUT / 'arcade_0814_song_ev.csv'
    if not p.is_file():
        return ({}, {})
    for r in _rd(p):
        try:
            n = int(r['위치'])
        except (KeyError, ValueError):
            continue
        z = r['존']
        mx[z] = max(mx[z], n)
        if (r.get('등급') or '').strip() in SEEN:
            seen[z].add(n)
    for path, zcol, ncol in (('arcade_channel_obs.csv', '채널', '위치'), ('out/arcade_category_reads.csv', '채널', '위치')):
        q = ROOT / path if not path.startswith('out/') else OUT / path[4:]
        if not q.is_file():
            continue
        for r in _rd(q):
            try:
                n = int(r[ncol])
            except (KeyError, ValueError):
                continue
            z = zname(r.get(zcol) or '')
            if not z:
                continue
            seen[z].add(n)
            mx[z] = max(mx[z], n)
    for z, n in sizes_from_nav().items():
        if not mx.get(z):
            mx[z] = n
    if not with_fill:
        return (seen, mx)
    try:
        import confirm_fill as _cf
        _cf.build()
    except Exception as _e:
        print('   (확인 채움 재생성 실패 — 옛 판을 쓴다: %s)' % _e)
    q = OUT / 'arcade_confirm_fill.csv'
    if q.is_file():
        for r in _rd(q):
            try:
                seen[r['존']].add(int(r['번호']))
            except (KeyError, ValueError):
                continue
    o = OUT / 'arcade_original_fill.csv'
    if o.is_file():
        for r in _rd(o):
            try:
                seen[r['채널']].add(int(r['위치']))
                mx[r['채널']] = max(mx[r['채널']], int(r['위치']))
            except (KeyError, ValueError):
                continue
    return (seen, mx)

def name_index() -> dict:
    p = OUT / 'nav_index.json'
    if not p.is_file():
        return {}
    idx = json.loads(io.open(p, encoding='utf-8').read())
    out = {}
    for t, v in (idx.get('series') or {}).items():
        pos = (v.get('pos') or {}).get('all')
        if pos:
            out[v['zone'], pos] = t
    for k, n in (idx.get('levels') or {}).items():
        title, _, lv = k.rpartition('|')
        if isinstance(n, dict):
            n = n.get('all')
        if lv and n:
            out[lv, n] = title
    for t, v in (idx.get('channel') or {}).items():
        out[v['kind'] + ' 채널', v['pos']] = t
    for t, ps in (idx.get('cats') or {}).items():
        for q in ps:
            out[q['tile'], q['pos']] = t
            out[zname(q['tile']), q['pos']] = t
    return out

def capture_wanted() -> dict:
    p = ROOT / 'capture_wanted.csv'
    if not p.is_file():
        return {}
    body = [l for l in io.open(p, encoding='utf-8-sig') if not l.startswith('#')]
    out = {}
    for r in csv.DictReader(io.StringIO(''.join(body))):
        z = (r.get('존') or '').strip()
        if z and (r.get('상태') or '').strip() != '담아옴':
            out[z] = (r.get('사유') or '').strip()
    return out

def premium_only() -> dict:
    p = OUT / 'nav_index.json'
    if not p.is_file():
        return {}
    idx = json.loads(io.open(p, encoding='utf-8').read())
    out: dict = defaultdict(list)
    for k, v in (idx.get('levels') or {}).items():
        if not isinstance(v, dict) or not v.get('all'):
            continue
        _t, _, lvl = k.rpartition('|')
        if lvl and (not v.get('normal')):
            out[lvl].append(int(v['all']))
    return {k: sorted(v) for k, v in out.items()}

def normal_no(zone: str, n: int, prem: dict):
    ahead = sum((1 for p in prem.get(zone, ()) if p <= n))
    return n - ahead if ahead else None

def zone_size() -> dict:
    _seen, mx = seen_by_zone()
    return dict(mx)

def gaps(seen: set, total: int) -> list:
    out, run = ([], None)
    for n in range(1, total + 1):
        if n in seen:
            if run:
                out.append((run, n - 1))
                run = None
        else:
            run = run or n
    if run:
        out.append((run, total))
    return out

def original_prediction() -> list:
    p = OUT / 'nav_index.json'
    if not p.is_file():
        return []
    idx = json.loads(io.open(p, encoding='utf-8').read())
    series, cats, chan = (idx['series'], idx.get('cats') or {}, idx.get('channel') or {})
    excl = {t for t, ps in cats.items() if any((q['tile'] in EXCL_TILE for q in ps))}
    rest = [t for t in series if t not in excl and t not in chan]
    rest.sort(key=lambda t: (-ZORDER.index(series[t]['zone']), series[t]['pos']['all']))
    return rest

def _seen_txt(o: int, lock: int, total: int) -> str:
    return '%d%s/%d' % (o, '+잠금 %d' % lock if lock else '', total)

def main() -> int:
    raw, _mx0 = seen_by_zone(with_fill=False)
    seen, mx = seen_by_zone()
    names = name_index()
    rows = []
    for z, total in sorted(mx.items()):
        if z == 'ORIGINAL':
            continue
        got = seen.get(z, set())
        gs = [(a, b) for a, b in gaps(got, total) if b - a + 1 >= SCREEN_TILES]
        if not gs:
            continue
        a, b = max(gs, key=lambda g: g[1] - g[0])
        mid = (a + b) // 2
        rows.append({'존': z, '번호': mid, '예측곡': names.get((z, mid), ''), '구멍': b - a + 1, '구간': '%d~%d' % (a, b), '본것': _seen_txt(len(raw.get(z, ())), len(got) - len(raw.get(z, ())), total), '사유': '못 본 구간이 가장 긴 자리. 여기가 맞으면 %d~%d 의 번호가 같이 고정된다' % (a, b)})
    pred = original_prediction()
    if pred:
        import original_fill as of
        og = of.open_gaps()
        total = of.SCREEN_SIZE
        shifts = {p: j - p for p, _, j in of.measure()[1]}
        got = len(raw.get('ORIGINAL', set()))
        lock = len(seen.get('ORIGINAL', set())) - got
        for a, b in og:
            width = b - a + 1
            k = max(1, min(ORIG_PROBES, int(round(width / 40.0))))
            for i in range(1, k + 1):
                n = a + int(round(width * i / (k + 1.0))) - 1
                if not a <= n <= b:
                    continue
                sh = shifts.get(a, 0)
                j = n + sh
                rows.append({'존': 'ORIGINAL', '번호': n, '예측곡': pred[j - 1] if 1 <= j <= len(pred) else '', '구멍': width, '구간': '%d~%d' % (a, b), '본것': _seen_txt(got, lock, total), '사유': '아직 번호가 안 잠긴 구간 %d~%d 의 %d/%d 지점. 앞 닻(%d번)의 밀림 +%d 을 그대로 밀어 짐작한 곡이다 — 맞으면 여기까지 빠진 곡이 없고, 어긋나면 «밀린 칸 수 = 그 앞에서 빠진 곡 수»다' % (a, b, i, k, a, sh)})
    want = capture_wanted()
    have = {r['존'] for r in rows}
    for z, why in sorted(want.items()):
        if z in have:
            for r in rows:
                if r['존'] == z and '사용자 요청' not in r['사유']:
                    r['사유'] = '**사용자 요청** — %s · (자동으로도 뽑힌 자리: %s)' % (why or '담아 와 달라고 하셨다', r['사유'])
            continue
        total = mx.get(z) or 0
        if not total:
            continue
        rg = [(a, b) for a, b in gaps(raw.get(z, set()), total)]
        a, b = max(rg, key=lambda g: g[1] - g[0]) if rg else (1, total)
        mid = (a + b) // 2
        rows.append({'존': z, '번호': mid, '예측곡': names.get((z, mid), ''), '구멍': b - a + 1, '구간': '%d~%d' % (a, b), '본것': _seen_txt(len(raw.get(z, ())), 0, total), '사유': '**사용자 요청** — %s' % (why or '담아 와 달라고 하셨다')})
    rows.sort(key=lambda r: (r['존'] != 'ORIGINAL', -r['구멍'], r['존'], r['번호']))
    prem = premium_only()
    for r in rows:
        r['노말번호'] = normal_no(r['존'], int(r['번호']), prem) or ''
    p = OUT / 'check_points.csv'
    with io.open(p, 'w', encoding='utf-8-sig', newline='\n') as fh:
        w = csv.DictWriter(fh, ['존', '번호', '노말번호', '예측곡', '구멍', '구간', '본것', '사유'])
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print('확인 지점 %d개 -> %s' % (len(rows), os.path.relpath(p, ROOT.parent)))
    print('   ORIGINAL %d점 · 존 %d곳' % (sum((1 for r in rows if r['존'] == 'ORIGINAL')), len({r['존'] for r in rows if r['존'] != 'ORIGINAL'})))
    return 0
if __name__ == '__main__':
    sys.exit(main())
