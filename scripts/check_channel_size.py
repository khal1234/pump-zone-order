"""채널별 크기를 여러 자료에서 모아 하나로 맞춘다."""
from __future__ import annotations
import argparse
import csv
import io
import json
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from xsio import force_utf8
force_utf8()
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'out'
ALIAS = {'숏컷 채널': '숏컷', '풀송 채널': '풀송', '리믹스 채널': '리믹스', 'NEW TUNES': '뉴튠즈', 'SHORT CUT': '숏컷', 'FULL SONG': '풀송', 'REMIX': '리믹스'}

def norm(name: str) -> str:
    name = (name or '').strip()
    return ALIAS.get(name, name)

def sources() -> dict[str, dict[str, int]]:
    src: dict[str, dict[str, int]] = {}
    nav = OUT / 'nav_index.json'
    if nav.is_file():
        idx = json.loads(io.open(nav, encoding='utf-8').read())
        d: dict[str, int] = {}
        for _t, v in (idx.get('channel') or {}).items():
            k = norm(v.get('kind', ''))
            if k:
                d[k] = max(d.get(k, 0), int(v.get('total') or 0))
        src['nav_index(편성)'] = d
    ev = OUT / 'arcade_0814_song_ev.csv'
    if ev.is_file():
        cnt: dict[str, set] = defaultdict(set)
        for r in csv.DictReader(io.open(ev, encoding='utf-8-sig')):
            k = norm(r.get('존', ''))
            p = (r.get('위치') or '').strip()
            if k and p.isdigit():
                cnt[k].add(int(p))
        src['0814_song_ev(존 지도)'] = {k: max(v) for k, v in cnt.items() if v}
    za = OUT / 'zones_from_artifact.json'
    if za.is_file():
        d3: dict[str, int] = {}
        for z in json.loads(io.open(za, encoding='utf-8').read()):
            k = norm(z[0])
            if k in ('숏컷', '풀송', '리믹스', '뉴튠즈'):
                d3[k] = len(z[2])
        if d3:
            src['zones_from_artifact(존 지도 곡목록)'] = d3
    obs = ROOT / 'arcade_channel_obs.csv'
    if obs.is_file():
        cnt2: dict[str, set] = defaultdict(set)
        for r in csv.DictReader(io.open(obs, encoding='utf-8-sig')):
            k = norm(r.get('채널', ''))
            p = (r.get('위치') or '').strip()
            if k and p.isdigit():
                cnt2[k].add(int(p))
        src['channel_obs(프레임 판독)'] = {k: max(v) for k, v in cnt2.items() if v}
    return src

def orders() -> dict[str, dict[str, list]]:
    out: dict[str, dict[str, list]] = defaultdict(dict)
    obs = ROOT / 'arcade_channel_obs.csv'
    raw: dict[str, dict[int, str]] = defaultdict(dict)
    if obs.is_file():
        for r in csv.DictReader(io.open(obs, encoding='utf-8-sig')):
            if (r.get('위치') or '').strip().isdigit():
                raw[norm(r['채널'])][int(r['위치'])] = (r.get('곡') or '').strip()
    for ch, d in raw.items():
        if sorted(d) == list(range(1, len(d) + 1)) and len(d) >= 2:
            out[ch]['channel_obs(프레임 판독)'] = [d[i] for i in range(1, len(d) + 1)]
    za = OUT / 'zones_from_artifact.json'
    if za.is_file():
        for z in json.loads(io.open(za, encoding='utf-8').read()):
            k = norm(z[0])
            if k in out:
                out[k]['zones_from_artifact(존 지도 곡목록)'] = list(z[2])
    nav = OUT / 'nav_index.json'
    if nav.is_file():
        idx = json.loads(io.open(nav, encoding='utf-8').read())
        seq: dict[str, dict[int, str]] = defaultdict(dict)
        for title, v in (idx.get('channel') or {}).items():
            seq[norm(v.get('kind', ''))][int(v.get('pos') or 0)] = title
        for k, d in seq.items():
            if k in out and sorted(d) == list(range(1, len(d) + 1)):
                out[k]['nav_index(편성)'] = [d[i] for i in range(1, len(d) + 1)]
    return dict(out)

def survey() -> dict:
    src = sources()
    per: dict[str, dict[str, int]] = defaultdict(dict)
    for where, d in src.items():
        for ch, n in d.items():
            per[ch][where] = n
    split = {ch: d for ch, d in per.items() if len(set(d.values())) > 1}
    ordr = orders()
    oh: dict[str, list] = {}
    for ch, d in ordr.items():
        base = d.get('channel_obs(프레임 판독)')
        if not base:
            continue
        for where, seq in d.items():
            if where == 'channel_obs(프레임 판독)':
                continue
            bad = [i + 1 for i, (a, b) in enumerate(zip(base, seq)) if a != b]
            if bad:
                oh.setdefault(ch, []).append((where, bad[:6], len(bad)))
    return {'per': dict(per), 'split': split, 'sources': list(src), 'order': oh}

def lone_holes() -> dict[str, list[int]]:
    p = OUT / 'arcade_category_reads.csv'
    if not p.is_file():
        return {}
    seen: dict[str, set] = defaultdict(set)
    for r in csv.DictReader(io.open(p, encoding='utf-8-sig')):
        if (r.get('위치') or '').strip().isdigit():
            seen[norm(r['채널'])].add(int(r['위치']))
    bad: dict[str, list[int]] = {}
    for ch, got in seen.items():
        holes = [n for n in range(min(got) + 1, max(got)) if n not in got and n - 1 in got and (n + 1 in got)]
        if holes:
            bad[ch] = holes
    return bad

def main() -> int:
    ap = argparse.ArgumentParser(description='채널 총수가 갈렸는가')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    s = survey()
    if a.list:
        for ch, d in sorted(s['per'].items()):
            print('  %-8s %s' % (ch, ' · '.join(('%s=%d' % (w, n) for w, n in sorted(d.items())))))
    holes = lone_holes()
    if holes:
        print('FAIL 한 칸짜리 구멍 %d개 — **밀림의 자국이지 「못 읽은 칸」이 아니다.**' % sum((len(v) for v in holes.values())))
        for ch, ns in sorted(holes.items()):
            print('   - %s : %s' % (ch, ', '.join((str(n) for n in ns))))
        print('   고치는 법: 그 구간을 **정지 프레임**(곡 제목줄이 뜬 프레임)으로 다시 읽는다. 스크롤 중 카운터는 타일보다 한 칸 앞선다.')
        return 1
    if s['order']:
        print('FAIL 채널 **순서**가 관측과 다르다 %d개 — 크기가 같아 총수 검사로는 안 걸린다.' % len(s['order']))
        for ch, items in sorted(s['order'].items()):
            for where, bad, n in items:
                print('   - %s : %s 가 %d칸 어긋남 (%s…)' % (ch, where, n, ', '.join((str(b) for b in bad))))
        print('   고치는 법: 그 산출물이 `arcade_channel_obs.csv` 를 읽게 한다.')
        return 1
    if s['split']:
        print('FAIL 채널 총수가 갈렸다 %d개 — **어느 쪽으로 찾아도 「없다」가 나올 수 있다.**' % len(s['split']))
        for ch, d in sorted(s['split'].items()):
            print('   - %s : %s' % (ch, ' vs '.join(('%s=%d' % (w, n) for w, n in sorted(d.items())))))
        print('   고치는 법: 프레임으로 재고 `arcade_channel_obs.csv` 에 적는다. 유도한 수를 정답으로 쓰지 않는다.')
        return 1
    print('OK   채널 총수·순서 일치 — 자리 %d곳 · 채널 %d개 (%s)' % (len(s['sources']), len(s['per']), ' · '.join(('%s %d' % (c, list(d.values())[0]) for c, d in sorted(s['per'].items())))))
    return 0
if __name__ == '__main__':
    sys.exit(main())
