"""곡 순서 데이터로 인터랙티브 존 지도 HTML을 만든다.

    python make_zone_map.py
    -> out/zone_map.html"""
from __future__ import annotations
import collections
import csv
import io
import json
import os
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from xsio import force_utf8
from timefmt import hms
import zone_fold
force_utf8()
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out' / 'zone_map.html'
BROADCAST = {'nolja_0803': '놀08-03', 'nolja_0808': '놀08-08', 'nolja_0810': '놀08-10', 'nolja_0814': '놀08-14', 'sngl_0810': '싱08-10', 'sngl_0811': '싱08-11'}

def rows(p):
    p = ROOT / p
    if not p.exists():
        return []
    lines = [ln for ln in io.open(p, encoding='utf-8-sig')]
    while lines and lines[0].lstrip().startswith('#'):
        lines.pop(0)
    return list(csv.DictReader(lines))

def mmss(sec):
    return hms(sec)

def blabel(tgt):
    return BROADCAST.get(tgt, tgt)

def frame_reads():
    out = {}
    for r in rows('frame_verify.csv'):
        z = (r.get('존') or '').strip()
        off = (r.get('밀림') or '').strip()
        if not z or not off:
            continue
        num = (r.get('번호') or '').strip()
        one = '화면 %s: %s' % (num, off) if num else off
        if one not in out.setdefault(z, []):
            out[z].append(one)
    return {z: '영상 프레임 판독 — 밀림 %s' % ' · '.join(v) for z, v in out.items()}

def video_links():
    seen = {}
    for r in _vod_rows():
        nm, vid = ((r.get('이름') or '').strip(), (r.get('영상') or '').strip())
        if nm and vid and (nm not in seen):
            seen[nm] = vid
    order = sorted(seen, key=lambda n: (re.sub('[^0-9]', '', n), n))
    return [(blabel(nm), seen[nm]) for nm in order]

def _vod_rows():
    p = ROOT / 'vod_targets.csv'
    if not p.exists():
        return []
    return list(csv.DictReader((l for l in io.open(p, encoding='utf-8-sig') if not l.startswith('#'))))
zart_all = json.load(io.open(ROOT / 'out' / 'zones_from_artifact.json', encoding='utf-8')) if (ROOT / 'out' / 'zones_from_artifact.json').exists() else []
GRADE_RANK = {'직독': 90, '알확정': 90, '눈판독': 90, '플레이': 95, '곁칸': 70, '표지확정': 60, '확인': 50, '구간확정': 40, '구간확정(미검증)': 20, '표지확정(크기전용)': 30, '이어받음': 30, '보간': 10, '': 1}
FILL_EV: dict = {}
CATR_EV: dict = {}

def _load_category_reads():
    from check_channel_size import norm as _chnorm
    out = {}
    for r in rows('out/arcade_category_reads.csv'):
        try:
            n = int(r.get('위치') or 0)
        except ValueError:
            continue
        z = _chnorm(r.get('채널') or '')
        if not z or not n:
            continue
        g = (r.get('등급') or '').strip()
        if g == '프레임직독':
            g = '직독'
        if not g:
            continue
        out[z, n] = ((r.get('근거') or '').split('·')[0].strip()[:60], g)
    return out

def zone_size_obs():
    out = {}
    for r in rows('zone_size_obs.csv'):
        try:
            n = int(r['화면총수'])
        except (KeyError, ValueError):
            continue
        z, d = ((r.get('존') or '').strip(), (r.get('관측일') or '').strip())
        if not z:
            continue
        tg = (r.get('방송') or '').strip()
        out.setdefault(z, []).append((tg, n))
    fin = {}
    for z, v in out.items():
        v = sorted(set(v))
        tg, n = v[-1]
        fin[z] = (n, tg, [x for x in v[:-1] if x[1] != n])
    return fin
SIZE_OBS: dict = {}

def _load_fill():
    out = {}
    for path, zc, nc in (('out/arcade_confirm_fill.csv', '존', '번호'), ('out/arcade_original_fill.csv', '채널', '위치')):
        for r in rows(path):
            try:
                k = ((r.get(zc) or '').strip(), int(r.get(nc) or 0))
            except ValueError:
                continue
            if k[0] and k[1]:
                out.setdefault(k, ((r.get('근거') or '')[:46], r.get('등급') or '구간확정'))
    return out

def _seen_src(name, num, song_ev, song_ev_alt, song_ev_grade, sev):
    k = (name, num)
    cand = []
    if k in song_ev:
        cand.append((mmss(song_ev[k]), song_ev_grade.get(k, '')))
    if k in song_ev_alt:
        cand.append(('08-08 ' + mmss(song_ev_alt[k]), song_ev_grade.get(k, '확인')))
    if k in sev:
        first, grade = sev[k]
        cand.append((first, grade or '표지확정'))
    if k in CATR_EV:
        first, grade = CATR_EV[k]
        cand.append((first, grade))
    if k in FILL_EV:
        first, grade = FILL_EV[k]
        short = '확인에서 이어짐' if '사용자 오락실 확인' in first else '영상 판독 존' if '밀림 0' in first else '닻 밀림' if '닻' in first else first[:14] + '…' if len(first) > 15 else first
        cand.append((short, grade or '구간확정'))
    if not cand:
        return {'seen': '', 'src': song_ev_grade.get(k, '')}
    best = max(cand, key=lambda c: GRADE_RANK.get(c[1], 0))
    return {'seen': best[0], 'src': best[1]}

def channel_positions(size, d, song_ev, sev, guess, name):
    if size <= 150:
        return list(range(1, size + 1))
    return [p for p in range(1, size + 1) if p in d or (name, p) in song_ev or (name, p) in sev or (p in guess)]

def channel_song(p, name, d, sev_title, song_ev, song_ev_alt, song_ev_grade, sev, guess):
    has_title = bool(d.get(p) or sev_title.get((name, p)))
    s = dict(zip(('n', 't', 'zone'), (str(p), d.get(p) or sev_title.get((name, p), ''), '')), **_seen_src(name, p, song_ev, song_ev_alt, song_ev_grade, sev))
    if not has_title and p in guess:
        s['t'] = guess[p] + ' (추측)'
    if not s.get('t'):
        s['t'] = '(곡명 미판독)'
    if not s.get('seen') and p in guess:
        s['seen'] = '추측 — 확인 안 됨(닻 밀림을 그대로 밀어 짐작)'
        s['src'] = '추측'
    return s
PREMIUM_ONLY_INSERT = {'pos': 8, 'title': '레전더리 도미니언'}

def _compute_channel_guess(name):
    guess = {}
    if name != 'ORIGINAL':
        return guess
    try:
        import original_fill as _of2
        pred, pinned, _spans = _of2.measure()
        gaps = _of2.open_gaps()
        ins = PREMIUM_ONLY_INSERT['pos']
        normal_pred = [t for i, t in enumerate(pred, 1) if i != ins]
        if pred and pinned:
            for a, b in gaps:
                cand = [j - p for p, _n, j in pinned if p <= a]
                sh = cand[-1] if cand else pinned[0][2] - pinned[0][0]
                for p in range(a, b + 1):
                    j = p + sh
                    if 1 <= j <= len(normal_pred):
                        guess[p] = normal_pred[j - 1]
    except Exception as _e:
        print('   (ORIGINAL 추측 계산 실패 — 건너뜀: %s)' % _e)
    return guess

def premium_songs_from_normal(normal_songs, insert=PREMIUM_ONLY_INSERT):
    out = []
    for s in normal_songs:
        try:
            n = int(s.get('n') or 0)
        except ValueError:
            continue
        if n >= insert['pos']:
            n += 1
        out.append(dict(s, n=str(n)))
    out.append({'n': str(insert['pos']), 't': insert['title'] + ' (프리미엄 전용)', 'zone': '', 'seen': '계산값(미검증) — 5key premium 대조로 위치만 추정', 'src': '추측'})
    out.sort(key=lambda s: int(s['n']))
    return out

def apply_user_confirmations(cats, uc_zones, uc_songs, uc_maybe, uc_unseen, alias, gapw_map):
    for _zs in cats.values():
        for _z in _zs:
            keys = [k for k in (_z.get('name'), _z.get('label')) if k]
            keys += [alias[k] for k in list(keys) if k in alias]
            if any((k in uc_unseen for k in keys)):
                _z['unseen'] = True
            _maybe = any((k in uc_maybe for k in keys))
            if any((k in uc_zones for k in keys)):
                _z['uc'] = 'ok'
                for _s in _z.get('songs', []):
                    _s.setdefault('uc', 'ok')
                    if not (_s.get('seen') or '').strip():
                        _s['seen'], _s['src'] = ('사용자 확인', '눈판독(사용자)')
            g = next((gapw_map[k] for k in keys if k in gapw_map), None)
            if g:
                GAPW[_z['name']] = g
            _size = _z.get('size') or 0
            if _size:
                for k in list(keys):
                    for (_k, _n), _v in list(uc_songs.items()):
                        if _k == k and _n.startswith('-'):
                            try:
                                _abs = _size + 2 + int(_n)
                            except ValueError:
                                continue
                            if 2 <= _abs <= _size + 1:
                                uc_songs.setdefault((k, str(_abs)), _v)
            for _s in _z.get('songs', []):
                n = str(_s.get('n') or '').strip().lstrip('0') or '0'
                for k in keys:
                    if (k, n) in uc_songs:
                        _s['uc'], _ = uc_songs[k, n]
                        if GRADE_RANK.get(_s.get('src', ''), 0) < GRADE_RANK.get('눈판독(사용자)', 90):
                            _s['seen'], _s['src'] = ('사용자 확인', '눈판독(사용자)')
                        break
            if _maybe:
                for _s in _z.get('songs', []):
                    if not _s.get('uc'):
                        _s['uc'] = 'maybe'
    return cats

def build_zones():
    lz = rows('out/level_zone_order.csv')
    ser = rows('out/arcade_series_zone_order.csv')
    fverify = frame_reads()
    zart = json.load(io.open(ROOT / 'out' / 'zones_from_artifact.json', encoding='utf-8')) if (ROOT / 'out' / 'zones_from_artifact.json').exists() else []
    ze = rows('out/zone_entry.csv')
    egg = rows('out/zone_egg_scan.csv')
    xval = rows('out/arcade_0814_egg_xval.csv')
    egg = rows('out/zone_egg_scan.csv')

    def norm(n):
        n = (n or '').strip()
        n = n.replace(' 채널', '')
        n = {'D27이상': 'D27', '온라인채널': '온라인'}.get(n, n)
        return n
    ev = collections.defaultdict(list)
    for r in ze:
        z = norm(r.get('존이름'))
        if z and (not z.startswith('(')):
            ev[z].append((r['표적'], int(float(r['시작초']))))

    def to_sec(hms):
        parts = [int(x) for x in re.findall('\\d+', hms or '')]
        if not parts:
            return None
        s = 0
        for p in parts:
            s = s * 60 + p
        return s
    for r in ser:
        t = to_sec(r.get('VOD시각'))
        if (r.get('곡') or '').strip() and t is not None:
            ev[r['시리즈존']].append(('nolja_0803', t))
    fine = rows('out/arcade_0814_fine_reads.csv')
    e14 = sorted(set([(int(float(x['초'])), int(x['알'])) for x in egg if x['표적'] == 'nolja_0814' and x['종류'] == '난이도존' and x.get('알')] + [(int(float(x['초'])), int(x['알'])) for x in fine if x.get('알')]))
    MIN_SIDE = 5
    split_t = None
    if len(e14) > 2 * MIN_SIDE:
        cand = [(e14[i + 1][0] - e14[i][0], (e14[i + 1][0] + e14[i][0]) // 2) for i in range(MIN_SIDE, len(e14) - MIN_SIDE)]
        if cand:
            split_t = max(cand)[1]
    for t, lv in e14:
        side = 'S' if split_t is None or t < split_t else 'D'
        ev[side + str(lv)].append(('nolja_0814', t))
    counter_pos = {}
    for r in rows('out/counter_ledger2.csv'):
        if r.get('표적') == 'nolja_0814':
            try:
                counter_pos[int(r['시각'])] = int(r['현재'])
            except (KeyError, ValueError):
                continue
    for r in rows('out/arcade_0814_channel_visits.csv'):
        try:
            a, b = (int(r['시작초']), int(r['끝초']))
        except (KeyError, ValueError):
            continue
        for t in range(a, b + 1):
            if t in counter_pos:
                ev[norm(r['채널'])].append(('nolja_0814', t))

    def ev_of(name):
        got = ev.get(norm(name), [])
        by = collections.defaultdict(list)
        for tgt, s in got:
            by[tgt].append(s)
        out = []
        for tgt in sorted(by, key=lambda t: (t != 'nolja_0814', t)):
            ts = sorted(by[tgt])
            out.append({'b': blabel(tgt), 'n': len(ts), 't': [mmss(x) for x in ts[:3]]})
        return out
    cats = collections.OrderedDict()
    song_ev, song_ev_grade = ({}, {})
    for r in rows('out/arcade_0814_song_ev.csv'):
        try:
            k = (r['존'], int(r['위치']))
            song_ev[k] = int(r['시각'])
            song_ev_grade[k] = (r.get('등급') or '보간').strip()
        except (KeyError, ValueError):
            continue
    sev = {}
    sev_title = {}
    for r in rows('out/song_evidence.csv'):
        try:
            k = ((r.get('존') or '').strip(), int(r.get('화면번호') or 0))
        except ValueError:
            continue
        first = (r.get('근거') or '').split('·')[0].strip()
        if k[0] and k[1] and first:
            sev[k] = (first, (r.get('크기기준') or '').strip())
            t = (r.get('곡') or '').strip()
            if t:
                sev_title[k] = t
    song_ev_alt = {}
    for r in rows('out/arcade_0808_song_ev.csv'):
        try:
            k = (r['존'], int(r['위치']))
            if k not in song_ev:
                song_ev_alt[k] = int(r['시각'])
        except (KeyError, ValueError):
            continue
    dfx_rm = collections.defaultdict(set)
    dfx_ins = collections.defaultdict(list)
    dfx_left = collections.defaultdict(list)
    for r in rows('out/arcade_zone_diff_0814.csv'):
        zn, kind, song, pos = (r['존'], r['종류'], (r['곡'] or '').strip(), (r['화면위치'] or '').strip())
        if kind == '제거' and (not song.startswith('(')):
            dfx_rm[zn].add(song)
        elif kind == '삽입':
            m = re.findall('\\d+', pos)
            if m:
                a = int(m[0])
                n = int(m[1]) - a + 1 if len(m) > 1 else 1
                if song.startswith('(') and n > 2:
                    dfx_left[zn].append(('삽입(구간 너무 넓음)', '%s (%s칸)' % (song, n)))
                else:
                    for k in range(n):
                        dfx_ins[zn].append((a + k, song))
            else:
                dfx_left[zn].append(('삽입', song))
        elif kind in ('잔여',) or (kind == '제거' and song.startswith('(')):
            dfx_left[zn].append((kind, song))

    def arcade_order(lv, tab_rows):
        seq = [{'t': s['곡'], 'zone': s.get('존', ''), 'kind': '표'} for s in tab_rows if s['곡'] not in dfx_rm.get(lv, ())]
        for pos, label in sorted(dfx_ins.get(lv, [])):
            i = max(0, min(len(seq), pos - 2))
            seq.insert(i, {'t': label, 'zone': '', 'kind': '삽입'})
        for i, s in enumerate(seq):
            s['n'] = str(i + 2)
        return seq
    by_lv = collections.defaultdict(list)
    for r in lz:
        by_lv[r['레벨']].append(r)

    def lv_key(l):
        return (0 if l.startswith('S') else 1, int(l[1:]))
    ARCADE_MAX = zone_fold.caps()
    FOLD = zone_fold.fold_map(by_lv)
    for side, cat in (('S', '싱글'), ('D', '더블')):
        zs = []
        for lv in sorted((l for l in by_lv if l.startswith(side)), key=lv_key):
            if lv in FOLD or int(lv[1:]) > ARCADE_MAX[side]:
                continue
            rows_lv = list(by_lv[lv]) + [r for src, dst in FOLD.items() if dst == lv for r in by_lv.get(src, [])]
            seen_pos = {}
            for r in rows_lv:
                seen_pos.setdefault((int(r['화면번호'] or 0), r['곡'].strip()), r)
            songs = sorted(seen_pos.values(), key=lambda r: int(r['화면번호'] or 0))
            e = ev_of(lv)
            note = '실제 라벨 «RANDOM SINGLE 25 OVER» — 25 이상을 묶은 존 (S26 포함)' if lv == 'S25' else '실제 라벨 «RANDOM DOUBLE 27 OVER» — 27 이상을 묶은 존 (D28·D29 포함)' if lv == 'D27' else ''
            label = '%s OVER' % lv if zone_fold.screen_label(lv) else ''
            seq = arcade_order(lv, songs)
            for s in seq:
                d = _seen_src(lv, int(s['n']), song_ev, song_ev_alt, song_ev_grade, sev)
                s['seen'] = d['seen']
                s['src'] = '삽입' if s['kind'] == '삽입' else d['src'] or '보간' if s['seen'] else '유도'
            nd = len(dfx_rm.get(lv, ())) + len(dfx_ins.get(lv, []))
            if nd or dfx_left.get(lv):
                extra = ' · 잔여 %s' % '·'.join((x[1][:14] for x in dfx_left[lv])) if dfx_left.get(lv) else ''
                note = (note + ' · ' if note else '') + '오락실 8/14 판 — 제거 %d · 삽입 %d 반영%s' % (len(dfx_rm.get(lv, ())), len(dfx_ins.get(lv, [])), extra)
            if fverify.get(lv):
                note = (note + ' · ' if note else '') + fverify[lv]
            if len(seq) > 3:
                seq = seq[-3:] + seq[:-3]
            zs.append({'name': lv, 'size': len(seq), 'songs': seq, 'ev': e, 'covered': bool(e), 'note': note, 'label': label})

        def has814(z):
            return z and any((e['b'] == '놀08-14' for e in z['ev']))
        by_num = {int(z['name'][1:]): z for z in zs}
        for z in zs:
            n = int(z['name'][1:])
            if not z['ev'] and has814(by_num.get(n - 1)) and has814(by_num.get(n + 1)):
                z['cont'] = '%s%d↔%s%d 사이 (순서 순회 · 판독 프레임 없음)' % (side, n - 1, side, n + 1)
                z['covered'] = True
        cats[cat] = zs
    zs = []
    for r in ser and []:
        pass
    SER_ORDER = [z[0] for z in zart if z[1] == '시리즈존']
    ser_by = collections.defaultdict(list)
    for r in ser:
        ser_by[r['시리즈존']].append(r)
    for zname in sorted(ser_by, key=lambda z: (SER_ORDER.index(z) if z in SER_ORDER else 10 ** 6, z)):
        srows = sorted(ser_by[zname], key=lambda r: int(r['번호'] or 0))
        e = ev_of(zname)

        def _ser(s):
            v = (s.get('VOD시각') or '').strip() if (s.get('곡') or '').strip() else ''
            if v:
                return {'seen': v, 'src': '직독'}
            return _seen_src(zname, int(s['번호'] or 0), song_ev, song_ev_alt, song_ev_grade, sev)
        zs.append({'name': zname, 'size': len(srows), 'songs': [dict(zip(('n', 't', 'zone'), (s['번호'], s['곡'] or '(미확인)', '')), **_ser(s)) for s in srows], 'ev': e, 'covered': bool(e)})
    if zs:
        cats['시리즈존'] = zs

    def _observed_orders():
        src = {}
        raw = {}
        obs = ROOT / 'arcade_channel_obs.csv'
        if obs.exists():
            for r in csv.DictReader(io.open(obs, encoding='utf-8-sig')):
                if (r.get('위치') or '').strip().isdigit():
                    raw.setdefault(r['채널'].strip() + ' 채널', {})[int(r['위치'])] = r['곡'].strip()
        cat = os.path.join(OUT, 'arcade_category_reads.csv')
        if os.path.exists(cat):
            for r in csv.DictReader(io.open(cat, encoding='utf-8-sig')):
                if (r.get('위치') or '').strip().isdigit() and r.get('채널', '').strip() == 'NEW TUNES':
                    raw.setdefault('뉴튠즈', {})[int(r['위치'])] = r['곡'].strip()
        for name, d in raw.items():
            if sorted(d) == list(range(1, len(d) + 1)) and len(d) >= 2:
                src[name] = [d[i] for i in range(1, len(d) + 1)]
        return src
    OBS_ORDER = _observed_orders()
    from titles import expand as _expand

    def _fix_names(zlist):
        for zz in zlist:
            for s in zz.get('songs', []):
                s['t'] = _expand(s.get('t', ''))
        return zlist
    zs = []
    for z in zart:
        name, kind, songs = (z[0], z[1], z[2])
        if kind not in ('전용채널', '뉴튠즈'):
            continue
        songs = OBS_ORDER.get(name, songs)
        e = ev_of(name)
        zs.append({'name': name, 'size': len(songs), 'songs': [dict(zip(('n', 't', 'zone'), (str(i + 1), s, '')), **_seen_src(name, i + 1, song_ev, song_ev_alt, song_ev_grade, sev)) for i, s in enumerate(songs)], 'ev': e, 'covered': bool(e), 'kind': kind})
    menu_ev = collections.defaultdict(list)
    for m in rows('out/arcade_0814_menu.csv'):
        try:
            menu_ev[m['타일']].append(('nolja_0814', int(m['초'])))
        except (KeyError, ValueError):
            continue
    cat_song = collections.defaultdict(list)
    CAT = {'K-POP': 'KPOP', 'ORIGINAL': 'ORIGINAL', 'WORLD MUSIC': 'WORLDMUSIC', 'XROSS': 'XROSS'}
    for r in lz:
        cat_song[r['카테고리']].append(r)
    for name in ('K-POP', 'WORLD MUSIC', 'XROSS', 'CO-OP', 'ORIGINAL'):
        for tgt, t in menu_ev.get(name, []):
            ev[norm(name)].append((tgt, t))
        e = ev_of(name)
        srcs = sorted(cat_song.get(CAT.get(name, ''), []), key=lambda r: int(r['화면번호'] or 0))
        is_coop = name == 'CO-OP'
        if is_coop:
            coop = list(rows('out/arcade_coop_channel.csv'))
            zs.append({'name': name, 'size': 135, 'songs': [dict(zip(('n', 't', 'zone'), (c['위치'], c['곡'] + ('' if c['확신'] != '△' else ' (±1 미확정)'), 'x%s' % c['인원'] if c['인원'] else '')), **_seen_src(name, int(c['위치']), song_ev, song_ev_alt, song_ev_grade, sev)) for c in coop], 'ev': e, 'covered': bool(e), 'kind': '전용채널', 'note': '협동 채널 135칸 — 11:50~13:06 전체 순회로 판독 (미기재 위치 %d칸은 곡명 미판독)' % (135 - len(coop))})
            continue
        cread_by = {}
        try:
            import original_fill as _of
            _of.main()
        except Exception as _e:
            print('   (채움 재생성 실패 — 옛 판을 쓴다: %s)' % _e)
        for c in rows('out/arcade_original_fill.csv'):
            cread_by.setdefault(c['채널'], {})[int(c['위치'])] = c['곡']
        for c in rows('out/arcade_category_reads.csv'):
            cread_by.setdefault(c['채널'], {})[int(c['위치'])] = c['곡']
        CH_SIZE = {'WORLD MUSIC': 127, 'XROSS': 45, 'K-POP': 17, 'ORIGINAL': 331}
        if name in CH_SIZE:
            d = cread_by.get(name, {})
            size = CH_SIZE[name]
            guess = _compute_channel_guess(name)
            note = '채널 %d칸 — 곡명 판독 %d' % (size, len(d))
            if name == 'ORIGINAL':
                note += ' · 프레임 닻 5칸(37·74·112·261·298)의 밀림이 +1·+3·+3·+3·+4 라 밀림이 같은 구간은 번호가 잠긴다 — 74~112 · 112~261 · 298~331. 유도 순서 자체는 다섯 다 맞았고 틀린 것은 오프셋이었다. 1~37 · 37~74 · 261~298 은 밀림이 바뀌므로 안 붙인다 (그 구간도 앞 닻의 밀림으로 민 **추측**은 표에 낸다)'
            ps = channel_positions(size, d, song_ev, sev, guess, name)
            zs.append({'name': name, 'size': size, 'songs': [channel_song(p, name, d, sev_title, song_ev, song_ev_alt, song_ev_grade, sev, guess) for p in ps], 'ev': e, 'covered': bool(e), 'kind': '전용채널', 'note': note})
            continue
        zs.append({'name': name, 'size': len(srcs), 'songs': [{'n': s['화면번호'], 't': s['곡'], 'zone': s.get('존', ''), 'seen': ''} for s in srcs], 'ev': e, 'covered': bool(e), 'kind': '미확인채널', 'note': '' if srcs else '메뉴에서 봄 · 이 영상엔 진입 자료 없음'})
    cats['전용 채널 · 기타'] = zs

    def summary(label, note):
        total = sum((z['size'] for z in cats.get(label, [])))
        got = collections.defaultdict(list)
        for z in cats.get(label, []):
            for tgt in ev.get(norm(z['name']), []):
                got[tgt[0]].append(tgt[1])
        e = [{'b': blabel(t), 'n': len(v), 't': [mmss(x) for x in sorted(v)[:3]]} for t, v in sorted(got.items())]
        return {'name': label, 'size': total, 'songs': [], 'ev': e, 'covered': bool(e), 'kind': '요약', 'note': note}
    AGG = {'시리즈존': '8개 버전존', '싱글': 'S1~S26', '더블': 'D5~D27'}
    by_name = {}
    for zl in cats.values():
        for z in zl:
            by_name[z['name']] = z
    menu = []
    for m in sorted(rows('out/arcade_0814_menu.csv'), key=lambda r: int(r.get('순서') or 0)):
        tile = m['타일']
        ch = (m.get('채널') or '').strip()
        locked = (m.get('잠김') or '').strip() == 'Y'
        pan = int(m['초']) if (m.get('초') or '').isdigit() else None
        panchip = [{'b': '놀08-14', 'n': 1, 't': [mmss(pan)]}] if pan else []

        def add_pan(evlist):
            if any((e['b'] == '놀08-14' for e in evlist)):
                return evlist
            return evlist + panchip
        if ch in AGG:
            base = summary(ch, AGG[ch])
            base['ev'] = add_pan(base['ev'])
            base['covered'] = bool(base['ev'])
            base['kind'] = '요약'
        elif ch in by_name:
            src = by_name[ch]
            base = {'name': tile, 'size': src['size'], 'songs': src['songs'], 'ev': add_pan(src['ev']), 'covered': True, 'kind': src.get('kind', ''), 'note': '메뉴명 %s = %s' % (tile, ch) if tile != ch else ''}
        else:
            base = {'name': tile, 'size': 0, 'songs': [], 'ev': [] if locked else panchip, 'covered': not locked and bool(panchip), 'kind': '잠김' if locked else '미확인채널', 'note': '이 기기에서 잠김 — 못 들어감' if locked else '협동 모드 — 곡 목록 없음' if tile == 'CO-OP' else '메뉴에만 확인 (안에 안 들어감)'}
        base['name'] = tile
        menu.append(base)
    cats['최상위 메뉴 · 첫 화면 배치'] = menu
    return cats
HTML = '<title>오락실 존 지도</title>\n<style>\n:root{\n  color-scheme:light;\n  --bg:#f7f5f1; --panel:#ffffff; --card:#ffffff; --card2:#f2efe9;\n  --ink:#1c1a24; --mut:#6b6660; --line:#e0dbd3;\n  --ok:#2f7d55; --ok-bg:#e6f2ea; --part:#9a6a1a; --part-bg:#f7eeda; --none:#b8b2a8;\n  --uc:#1d5fbf; --uc-bg:#e2ecfb; --uf:#a3316b; --uf-bg:#fbe3ef;\n  --pb:#6c4fbb; --pb-bg:#eee9fb;\n  --wk:#c2701c; --wk-bg:#fbeeda;\n  --acc:#2d5c9e; --s:#c0364b; --d:#2f7d55;\n}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--bg);color:var(--ink);\n  font-family:"Pretendard","Malgun Gothic",system-ui,sans-serif;line-height:1.5}\n.wrap{padding:20px 24px 80px}\nh1{font-size:1.5rem;margin:0 0 2px}\n.sub{color:var(--mut);font-size:.85rem;margin:0 0 20px}\n.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:.78rem;color:var(--mut);margin:0 0 18px}\n.legend b{color:var(--ink)}\n.vids{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 20px}\n.vids .vlab{font-size:.78rem;color:var(--mut)}\n.vids a{font-size:.82rem;color:var(--acc);text-decoration:none;background:var(--card);\n  border:1px solid var(--line);border-radius:6px;padding:4px 10px}\n.vids a:hover{border-color:var(--acc)}\n.dot{display:inline-block;width:10px;height:10px;border-radius:3px;vertical-align:-1px;margin-right:4px}\n.catrow{margin:0 0 26px}\n.cathd{font-size:.95rem;font-weight:700;margin:0 0 9px;display:flex;align-items:baseline;gap:9px}\n.cathd .cnt{color:var(--mut);font-weight:400;font-size:.8rem}\n.slider{display:flex;gap:9px;overflow-x:auto;padding:2px 2px 12px;scroll-snap-type:x proximity}\n.slider::-webkit-scrollbar{height:9px}\n.slider::-webkit-scrollbar-thumb{background:#3a3b44;border-radius:5px}\n/* 난이도존 — 슬라이더 말고 줄바꿈 그리드. 26개가 한 화면에 2~3줄로 다 보인다 */\n.grid{display:flex;flex-wrap:wrap;gap:9px;padding:2px 2px 4px}\n.zcard{flex:0 0 auto;width:132px;background:var(--card);border:1px solid var(--line);\n  border-radius:10px;padding:10px 11px;cursor:pointer;scroll-snap-align:start;\n  transition:border-color .12s,transform .12s;position:relative}\n.zcard:hover{border-color:var(--acc);transform:translateY(-2px)}\n.zcard.sel{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc)}\n.zcard .zn{font-size:1.15rem;font-weight:800;letter-spacing:-.02em}\n.zcard .zn.s{color:var(--s)} .zcard .zn.d{color:var(--d)}\n.zcard .zsz{color:var(--mut);font-size:.72rem;margin-bottom:7px}\n.evwrap{display:flex;flex-direction:column;gap:3px;min-height:34px}\n.evchip{font-size:.66rem;background:var(--ok-bg);color:var(--ok);\n  border-radius:4px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.evchip.none{background:transparent;color:var(--none);border:1px dashed var(--line)}\n.evchip.tour{background:var(--part-bg);color:var(--part)}\n.badge{position:absolute;top:8px;right:9px;width:9px;height:9px;border-radius:50%}\n.badge.ok{background:var(--ok)} .badge.no{background:var(--none)}\n/* 상세 패널 */\n#detail{margin-top:8px;background:var(--panel);border:1px solid var(--line);\n  border-radius:12px;padding:0;display:none;overflow:hidden}\n#detail.open{display:block}\n.dhd{display:flex;align-items:baseline;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);\n  background:var(--card2)}\n.dhd .dn{font-size:1.5rem;font-weight:800}\n.dhd .dn.s{color:var(--s)} .dhd .dn.d{color:var(--d)}\n.dhd .dsz{color:var(--mut);font-size:.85rem}\n.dhd .close{margin-left:auto;color:var(--mut);cursor:pointer;font-size:1.3rem;\n  background:none;border:none;padding:0 4px}\n.modetoggle{padding:8px 18px;border-bottom:1px solid var(--line);background:var(--card2);\n  display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.mtbtn{border:1px solid var(--line);background:var(--card);border-radius:6px;\n  padding:4px 10px;font-size:.8rem;cursor:pointer;color:var(--mut)}\n.mtbtn.on{border-color:var(--acc);color:var(--acc);font-weight:700;background:var(--card2)}\n.mtwarn{color:var(--wk);font-size:.72rem}\n.dev{padding:11px 18px;border-bottom:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;\n  align-items:center}\n.dev .lab{color:var(--mut);font-size:.78rem;margin-right:2px}\n.dev .b{background:var(--card);border:1px solid var(--line);border-radius:6px;\n  padding:3px 9px;font-size:.78rem}\n.dev .b i{color:var(--acc);font-style:normal}\n.dev .b .tm{color:var(--mut);font-size:.72rem;margin-left:5px}\n.dev.empty{color:var(--none)}\n.songs{max-height:min(60vh,620px);overflow-y:auto;padding:6px 0}\n.srow{display:grid;grid-template-columns:46px 1fr auto;gap:10px;align-items:center;\n  padding:5px 18px;border-bottom:1px solid #23242b}\n.srow:hover{background:var(--card)}\n.srow .num{color:var(--mut);font-variant-numeric:tabular-nums;text-align:right;font-size:.82rem}\n.srow .nm{font-size:.92rem}\n.srow .src{font-size:.68rem;color:var(--mut);border:1px solid var(--line);\n  border-radius:4px;padding:1px 6px}\n.srow .src.pred{color:var(--part)} .srow .src.real{color:var(--ok)}\n.srow .src.blank{color:var(--none)}\n.srow .src.fill{color:var(--part);border-color:var(--part);background:var(--part-bg)}\n.srow .src i{font-style:normal;opacity:.65;font-size:.9em}\n.hint{color:var(--mut);font-size:.8rem;margin:22px 0 0}\n.empty-note{padding:20px 18px;color:var(--mut);font-size:.9rem}\n.znote{padding:8px 18px;color:var(--part);background:var(--part-bg);font-size:.82rem;line-height:1.5;border-bottom:1px solid var(--line)}\n.zcard.blank,.zcard.summary{border-style:dashed;background:var(--card2)}\n.zcard.likely{background:var(--pb-bg);border-color:var(--pb)}\n.zcard.likely .zn{color:var(--pb)}\n.srow.maybe{background:var(--pb-bg)}\n.srow.maybe .nm{color:var(--pb)}\n.srow.maybe .ucb{background:var(--pb);color:#fff}\n.zcard.hasuc{box-shadow:inset 5px 0 0 var(--uc)}\n.zcard.weakfull{background:var(--wk-bg);border-color:var(--wk)}\n.zcard.weakfull .zn{color:var(--wk)}\n.zcard.closed{background:var(--uc-bg);border-color:var(--uc)}\n.zcard.closed .zn{color:var(--uc)}\n.zcard.uconf{background:var(--uc-bg);border:2px solid var(--uc)}\n.zcard.uconf .zn{color:var(--uc)}\n.zcard .ucard{position:absolute;top:7px;left:8px;font-size:.58rem;\n  background:var(--uc);color:#fff;border-radius:4px;padding:1px 5px}\n.srow.uconf{background:var(--uc-bg)}\n.srow.uconf .nm{color:var(--uc);font-weight:600}\n.srow.ufix{background:var(--uf-bg)}\n.srow.ufix .nm{color:var(--uf);font-weight:700}\n.srow .ucb{font-size:.66rem;border-radius:4px;padding:1px 6px;margin-left:6px}\n.srow.uconf .ucb{background:var(--uc);color:#fff}\n.srow.lockok{background:var(--pb-bg)}\n.srow.lockok .nm{color:var(--pb)}\n.srow.lockweak{background:var(--wk-bg)}\n.srow.lockweak .nm{color:var(--wk)}\n.srow .lkb{margin-left:6px;font-size:.58rem;border-radius:4px;padding:1px 5px;\n  background:var(--pb);color:#fff}\n.srow .lkb.wk{background:var(--wk)}\n.srow.ufix .ucb{background:var(--uf);color:#fff}\n</style>\n<div class="wrap">\n<h1>오락실 존 지도</h1>\n<p class="sub">{{SUB}}</p>\n<div class="legend">\n  <span><span class="dot" style="background:var(--ok)"></span><b>근거 있음</b> — VOD 에서 본 존</span>\n  <span><span class="dot" style="background:var(--none)"></span>근거 없음 — 아직 못 본 존</span>\n  <span><span class="dot" style="background:var(--s)"></span>싱글 <span class="dot" style="background:var(--d)"></span>더블</span>\n  <span>존을 누르면 아래에 곡 순서가 세로로 펼쳐집니다</span>\n  <span><b style="color:var(--part)">주황 (못 봄)</b> = 그 자리를 <b>화면에서 못 읽은 것</b>입니다.\n    시각을 안 적습니다 — 숫자가 붙으면 직독과 구별이 안 되기 때문입니다.\n    줄에 마우스를 올리면 왜 못 봤는지 나옵니다</span>\n  <span><b>크기만 N</b> = 표지 <b>크기로만</b> 맞춘 자리입니다. 곡을 읽은 것이 아니라\n    <b>본 것에 안 셉니다</b></span>\n  <span><b>본 것</b>에는 <b style="color:var(--uc)">내가 확인해 준 칸</b>도 들어갑니다 —\n    확인은 영상 판독보다 강한 근거입니다</span>\n  <span><b style="color:var(--uc)">남은 판독 N</b> = 영상에 <b>곡선택 화면이 있는</b> 자리라\n    채울 수 있습니다 · <b style="color:var(--none)">못 여는 N</b> = 그 시각이 플레이·메뉴라\n    영상으로는 못 채웁니다 (2026-08-25 실측 · 창 118개)</span>\n  <span><span class="dot" style="background:var(--uc)"></span><b style="color:var(--uc)">왼쪽 파란 띠</b>\n    = 그 존에 <b>확인해 주신 칸이 있습니다</b>. 배경색은 «얼마나 찼나»이고\n    띠는 «여기 확인해 주셨다»라 서로 다른 정보입니다</span>\n  <span><span class="dot" style="background:var(--uc)"></span><b style="color:var(--uc)">파랑 배경</b>\n    = <b>채팅으로 직접 말씀해 주신 것</b>만입니다. 제가 영상에서 읽은 것은 여기 안 들어갑니다\n    </span>\n  <span><span class="dot" style="background:var(--pb)"></span><b style="color:var(--pb)">보라 — 거의 확실</b>\n    = 확인은 안 하셨지만 <b>제가 영상 프레임으로 그 존의 밀림 0 을 확인</b>했거나\n    확인해 주신 자리에서 이어진 구간입니다. <b>거의 틀릴 일이 없습니다</b></span>\n  <span><span class="dot" style="background:var(--wk)"></span><b style="color:var(--wk)">주황 — 틀릴 여지</b>\n    = 같은 «구간확정» 이지만 <b>닻이 아직 영상으로 확인 안 된</b> 존입니다.\n    ORIGINAL 이 그랬듯 통째로 밀려 있을 수 있습니다</span>\n  <span><span class="dot" style="background:var(--uc)"></span><b style="color:var(--uc)">파란 바탕</b>\n    = <b>다 본 존(100%)</b> — <b>다시 안 봐도 됩니다</b>.\n    그중 테두리가 진하고 <b>확인함</b> 칩이 붙은 것은\n    실제로 확인된 존입니다</span>\n  <span><span class="dot" style="background:var(--uf)"></span><b style="color:var(--uf)">자홍 바탕</b>\n    = <b>내 지적으로 고친 것</b> — 고친 자리가 맞는지만 보면 됩니다</span>\n  <span><b style="color:var(--ok)">곡 옆 시각</b> = 그 곡 자리에 <b>커서가 지난 때</b>(= 확인)</span>\n  <span><b>본 것 n/m</b> = <b>8/14 기준</b>, 화면에서 <b>실제로 본</b> 자리입니다 —\n    <b>직독</b>(카운터를 그 자리에서 읽음) · <b>곁칸</b>(읽은 자리의 ±2, 한 화면에 5칸이 보입니다) ·\n    <b>플레이</b>(그 곡을 실제로 침). <b>보간</b>은 두 판독 <b>사이</b>를 «커서는 단조로 움직인다»로\n    채운 것이라 <b>본 것이 아닙니다</b>.\n    옛 화면은 이 넷을 다 «확인»으로 찍어 S1 을 18/18 100% 로 냈습니다(실제 직독 1 · 곁칸 4 · 보간 14).</span>\n  <span><b>(옛 설명)</b> 곡별 확인율은 <b>8/14 기준</b>입니다. 곡별 시각은 8/14 판독에만 있어, 다른 방송에서만 본 존은 <b>«8/14 미진입»</b>으로 적습니다 — 0% 로 찍으면 못 본 것과 구별이 안 됩니다</span>\n  <span><b>규칙 유도</b> = 아직 못 본 자리. 배열은 <b>규칙</b>으로 유도한 것입니다 —\n    카테고리(메뉴 순) → 시리즈 최신→구판 → 시리즈 안 번호. 독립 표본에서 전순서 성립·상대 순서 98.3%</span>\n</div>\n<div class="vids"><span class="vlab">근거 영상</span>{{VIDS}}</div>\n{{ROWS}}\n<p class="hint">가로로 밀어 존을 넘기세요. 근거 칩은 어느 영상 몇 분에 확인했는지를 보여줍니다.</p>\n</div>\n<script>\nconst ZONES = {{DATA}};\nconst detail = document.getElementById(\'detail\');\nlet selEl = null;\nfunction side(n){ return n[0]===\'S\'?\'s\':(n[0]===\'D\'?\'d\':\'\'); }\nlet originalMode = \'normal\'; function open(key){\n  const z = ZONES[key];\n  if(!z){ return; }\n  const sd = side(z.name);\n  const disp = z.label || z.name;\n  const zSongs = (z.songs_premium && originalMode === \'premium\') ? z.songs_premium : z.songs;\n  const zSize = (z.songs_premium && originalMode === \'premium\') ? z.premium_size : z.size;\n  let ev = \'\';\n  if(z.ev && z.ev.length){\n    ev = \'<span class="lab">시간대별 근거</span>\' + z.ev.map(e=>\n      `<span class="b"><i>${e.b}</i>${e.t.map(t=>`<span class="tm">${t}</span>`).join(\'\')}${e.n>3?`<span class="tm">+${e.n-3}</span>`:\'\'}</span>`).join(\'\');\n    if(z.tour){ ev += `<span class="b" style="color:var(--part)">8/14 전수 순회</span>`; }\n  } else if(z.cont){\n    ev = `<span class="lab">근거</span> <span class="b" style="color:var(--part)">연속 추정 — ${esc(z.cont)}</span>`;\n  } else if(z.tour){\n    ev = \'<span class="lab">근거</span> <span class="b" style="color:var(--part)">8/14 전수 순회에서 확인</span> — 자동 판독은 아직 이 존의 곡을 못 읽었습니다\';\n  } else {\n    ev = \'<span class="lab">근거</span> 아직 확인 안 됨\';\n  }\n  let songs;\n  if(zSongs && zSongs.length){\n    songs = zSongs.map(s=>{\n      // ★ 근거 = 커서가 그 곡 자리를 지난 시각(seen). 있으면 초록 시각, 없으면 빈칸.\n      const zn = s.zone?` <span class="tm" style="color:var(--mut);font-size:.68rem">${s.zone}</span>`:\'\';\n      // ★ 자리는 «규칙 유도»(마스터 고리에서 그 레벨만 남긴 것)이고, 시각은 «확인»이다.\n      // ★ 2026-08-25 — 등급을 적고, **못 본 자리에서는 시각을 뺀다.**\n      //   보간·크기전용·이어받음은 «그 자리에 이 곡이 있다»를 본 것이 아니다.\n      const WEAK = [\'보간\',\'표지확정(크기전용)\',\'이어받음\'];\n      const weak = WEAK.indexOf(s.src) >= 0;\n      const why = s.src===\'보간\' ? \'보간 — 커서가 지났을 뿐, 화면에서 이 자리를 못 읽었습니다\'\n                : s.src===\'표지확정(크기전용)\' ? \'표지 크기로만 맞춤 — 곡을 읽은 것이 아닙니다\'\n                : s.src===\'이어받음\' ? \'옆 판독에서 이어받음 — 이 자리를 직접 못 읽었습니다\'\n                : \'\';\n      const seen = weak ? `<div class="src fill" title="${why}">${s.src} · 못 봄</div>`\n                 : (s.seen ? `<div class="src real">${s.seen}${s.src?` <i>${s.src}</i>`:\'\'}</div>`\n                 : (s.src===\'삽입\' ? `<div class="src pred">8/14 삽입</div>`\n                                   : `<div class="src blank">규칙 유도 — 아직 못 봤습니다</div>`));\n      const lock = s.src===\'구간확정\' ? \' lockok\'\n                 : (s.src===\'구간확정(미검증)\' ? \' lockweak\'\n                 : (s.src===\'추측\' ? \' lockweak\' : \'\'));\n      const uc = s.uc===\'fix\' ? \' ufix\'\n               : (s.uc===\'ok\' ? \' uconf\' : (s.uc===\'maybe\' ? \' maybe\' : lock));\n      const ucb = s.uc===\'fix\' ? \'<span class="ucb">내 지적으로 고침</span>\'\n                : (s.uc===\'ok\' ? \'<span class="ucb">내가 확인함</span>\'\n                : (s.uc===\'maybe\' ? \'<span class="ucb">아마 맞음</span>\'\n                : (s.src===\'구간확정\' ? \'<span class="lkb">거의 확실</span>\'\n                : (s.src===\'구간확정(미검증)\' ? \'<span class="lkb wk">틀릴 여지</span>\'\n                : (s.src===\'추측\' ? \'<span class="lkb wk">추측</span>\' : \'\')))));\n      const dim = (s.seen || s.uc) ? \'\' : \' style="opacity:.55"\';\n      return `<div class="srow${uc}"${dim}><div class="num">${s.n}</div><div class="nm">${esc(s.t)}${zn}${ucb}</div>${seen}</div>`;\n    }).join(\'\');\n  } else {\n    songs = `<div class="empty-note">${z.note?esc(z.note):\'곡 자료가 아직 없습니다\'}</div>`;\n  }\n  const modeToggle = z.songs_premium ? (\n    `<div class="modetoggle">`+\n    `<button class="mtbtn${originalMode===\'normal\'?\' on\':\'\'}" data-mode-key="${key}" data-mode-val="normal">노말 ${z.size}</button>`+\n    `<button class="mtbtn${originalMode===\'premium\'?\' on\':\'\'}" data-mode-key="${key}" data-mode-val="premium">프리미엄 ${z.premium_size}</button>`+\n    (originalMode===\'premium\' ? `<span class="mtwarn">프리미엄 번호는 계산값입니다 — 실제로 프리미엄 크레딧에서 확인 전입니다</span>` : \'\')+\n    `</div>`\n  ) : \'\';\n  detail.innerHTML =\n    `<div class="dhd"><span class="dn ${sd}">${disp}</span>`+\n    `<span class="dsz">곡 ${zSize}개</span>`+\n    `<button class="close" data-close="1">×</button></div>`+\n    modeToggle+\n    `<div class="dev ${z.ev&&z.ev.length?\'\':\'empty\'}">${ev}</div>`+\n    // ★ 존 단위 메모(8/14 판 반영 · **영상 프레임 판독의 밀림**)는 곡목록 위에.\n    //   전에는 «곡이 하나도 없을 때»만 보여서, 곡이 있는 존의 판독 결과가 화면에 안 떴다.\n    (z.note && zSongs && zSongs.length ? `<div class="znote">${esc(z.note)}</div>` : \'\')+\n    `<div class="songs">${songs}</div>`;\n  detail.classList.add(\'open\');\n  detail.scrollIntoView({behavior:\'smooth\',block:\'nearest\'});\n}\nfunction closeD(){ detail.classList.remove(\'open\'); if(selEl){selEl.classList.remove(\'sel\');selEl=null;} }\nfunction pick(el,key){ if(selEl)selEl.classList.remove(\'sel\'); selEl=el; el.classList.add(\'sel\'); open(key); }\nfunction esc(s){ return (s||\'\').replace(/[&<>]/g,c=>({\'&\':\'&amp;\',\'<\':\'&lt;\',\'>\':\'&gt;\'}[c])); }\n// ★ 인라인 onclick 은 아티팩트 CSP 가 막는다 — 이벤트 위임으로 붙인다 (2026-08-19).\ndocument.addEventListener(\'click\',function(e){\n  const close = e.target.closest(\'[data-close]\');\n  if(close){ closeD(); return; }\n  const mtbtn = e.target.closest(\'[data-mode-key]\');\n  if(mtbtn){\n    originalMode = mtbtn.getAttribute(\'data-mode-val\');\n    open(mtbtn.getAttribute(\'data-mode-key\'));\n    return;\n  }\n  const card = e.target.closest(\'.zcard[data-key]\');\n  if(card){ pick(card, card.getAttribute(\'data-key\')); }\n});\n</script>\n'

def card(z):
    sd = 's' if z['name'].startswith('S') else 'd' if z['name'].startswith('D') else ''
    if z['ev']:
        chips = ''.join(('<div class="evchip">%s <b style="color:var(--ok)">%s</b></div>' % (e['b'], '·'.join(e['t']) + (' +%d' % (e['n'] - 3) if e['n'] > 3 else '')) for e in z['ev'][:3]))
        if z.get('tour'):
            chips += '<div class="evchip tour">8/14 순회</div>'
    elif z.get('cont'):
        chips = '<div class="evchip tour">연속 추정</div>'
    elif z.get('tour'):
        chips = '<div class="evchip tour">8/14 순회 확인</div>'
    else:
        chips = '<div class="evchip none">근거 없음</div>'
    badge = 'ok' if z['covered'] else 'no'
    import html as _h
    extra = {'빈자리': ' blank', '요약': ' summary'}.get(z.get('kind', ''), '')
    if z.get('uc'):
        extra += ' uconf'
    szt = '곡 %d' % z['size'] if z['size'] else '빈 자리' if z.get('kind') == '빈자리' else '협동 모드' if z.get('kind') == '모드' else '곡 미확인'
    SEEN_G = ('직독', '곁칸', '플레이', '확인', '알확정', '눈판독', '표지확정', '눈판독(사용자)')
    WEAK_G = ('표지확정(크기전용)', '이어받음')
    ns = [s for s in z.get('songs', []) if s.get('uc') == 'ok' or ((s.get('seen') or '').strip() and s.get('src') in SEEN_G)]
    nfill = [s for s in z.get('songs', []) if s.get('uc') not in ('ok', 'maybe') and (s.get('seen') or '').strip() and (s.get('src') == '보간')]
    nweak = [s for s in z.get('songs', []) if s.get('uc') not in ('ok', 'maybe') and (s.get('seen') or '').strip() and (s.get('src') in WEAK_G)]
    nlock = [s for s in z.get('songs', []) if s.get('uc') not in ('ok', 'maybe') and s.get('src') == '구간확정']
    nweakfill = [s for s in z.get('songs', []) if s.get('uc') not in ('ok', 'maybe') and s.get('src') == '구간확정(미검증)']
    nmaybe = [s for s in z.get('songs', []) if s.get('uc') == 'maybe']
    if z.get('songs') and z['size']:
        _den = max(len(z['songs']), z['size'] or 0)
        _uc_n = [s for s in z.get('songs', []) if s.get('uc') == 'ok']
        _cov_blue = len({id(s) for s in ns} | {id(s) for s in _uc_n})
        _cov_pb = _cov_blue + len(nlock) + len(nmaybe)
        _cov_wk = _cov_pb + len(nweakfill)
        if _uc_n:
            extra += ' hasuc'
        _blocked = bool(z.get('unseen')) and (not _uc_n)
        if _cov_blue >= _den and (not _blocked):
            extra += ' closed'
        elif _cov_blue >= _den:
            extra += ' likely'
        elif _cov_pb >= _den:
            extra += ' likely'
        elif _cov_wk >= _den:
            extra += ' weakfull'
        has14 = any((e.get('b') == '놀08-14' for e in z.get('ev') or []))
        if not ns and (not has14):
            szt += ' <span style="color:var(--mut)">· 8/14 미진입(곡별 시각 없음)</span>'
        else:
            den = max(len(z['songs']), z['size'] or 0)
            cov = 100.0 * len(ns) / max(1, den)
            if z.get('unseen'):
                _nuc = sum((1 for _s in z.get('songs', []) if _s.get('uc') == 'ok'))
                if _nuc:
                    szt += ' <span style="color:var(--uc)">확인해 주신 칸 %d</span><span style="color:var(--mut)"> · 판독 %d/%d · </span><span style="color:var(--part)">존 전체는 아직</span>' % (_nuc, len(ns), den)
                else:
                    szt += ' <span style="color:var(--mut)">판독 %d/%d · </span><span style="color:var(--part)">사용자 미확인</span>' % (len(ns), den)
            else:
                _nuc = sum((1 for _s in z.get('songs', []) if _s.get('uc') == 'ok'))
                if _nuc:
                    szt += ' <span style="color:var(--uc)">확인해 주신 칸 %d</span> ·' % _nuc
                szt += ' <span style="color:var(--%s)">본 것 %d/%d · %.0f%%</span>' % ('ok' if cov >= 99.5 else 'part', len(ns), den, cov)
                if nmaybe:
                    szt += ' <span style="color:var(--pb)">· 아마 %d</span>' % len(nmaybe)
            if nlock:
                szt += ' <span style="color:var(--pb)">· 거의 확실 %d</span>' % len(nlock)
            if nweakfill:
                szt += ' <span style="color:var(--wk)">· 틀릴 여지 %d</span>' % len(nweakfill)
            if nfill:
                szt += ' <span style="color:var(--part)">· 못 본 자리 %d</span>' % len(nfill)
            if nweak:
                szt += ' <span style="color:var(--part)">· 크기만 %d</span>' % len(nweak)
    _g = GAPW.get(z['name'])
    if _g:

        def _k(v):
            v = str(v or '').strip()
            return v.lstrip('0') or '0'
        _seen_n = {_k(s.get('n')) for s in ns}
        _todo = [p for p in _g[0] if _k(p) not in _seen_n]
        _shut = [p for p in _g[1] if _k(p) not in _seen_n]
        if _todo:
            szt += ' <span style="color:var(--uc)">· 남은 판독 %d</span>' % len(_todo)
        if _shut:
            szt += ' <span style="color:var(--none)">· 못 여는 %d</span>' % len(_shut)
    _is_lv = bool(re.match('^[SD]\\d+$', z['name']))
    _o = SIZE_OBS.get(z['name'])
    if _o and z.get('size') and (_o[0] - (1 if _is_lv else 0) != z['size']):
        _hist = '' if not _o[2] else ' · <b>전에는 %s</b>' % ', '.join(('%d(%s)' % (n, tg.split('_')[-1]) for tg, n in _o[2]))
        _songn = ' · 곡 %d' % (_o[0] - 1) if _is_lv else ''
        szt = '<span style="color:var(--uf)"><b>화면 실측 %d칸</b>(%s%s)%s · 우리 표 %d</span>' % (_o[0], _o[1].split('_')[-1] if _o[1] else '영상', _songn, _hist, z['size']) + szt
    disp = z.get('label') or z['name']
    ucard = '<span class="ucard">내가 확인함</span>' if z.get('uc') else ''
    return '<div class="zcard%s" data-key="%s">%s<span class="badge %s"></span><div class="zn %s">%s</div><div class="zsz">%s</div><div class="evwrap">%s</div></div>' % (extra, _h.escape(z['name'], quote=True), ucard, badge, sd, _h.escape(disp), szt, chips)

def _lvnum(name):
    m = re.match('[SD](\\d+)$', name)
    return int(m.group(1)) if m else 10 ** 6
DIFFICULTY = ('싱글', '더블')
GRIDCATS = DIFFICULTY + ('최상위 메뉴 · 첫 화면 배치',)
GAPW = {}

def gap_windows():
    seen_win = {}
    for r in rows('out/ev_gap_windows.csv'):
        seen_win[r.get('방송'), r.get('존'), r.get('창시각')] = r.get('화면') or ''
    ok, no = ({}, {})
    for r in rows('out/ev_gap_plan.csv'):
        zn = (r.get('존') or '').strip()
        if not zn:
            continue
        kind = seen_win.get((r.get('방송'), zn, r.get('창시각')), '')
        tgt = ok if kind.startswith('곡선택') else no
        tgt.setdefault(zn, set()).update((p for p in (r.get('위치들') or '').split() if p.isdigit()))
    return {z: (ok.get(z, set()), no.get(z, set())) for z in set(ok) | set(no)}

def user_confirmations():
    zones, songs, unseen, zone_ev = (set(), {}, set(), {})
    maybe_zones = set()
    for r in rows('user_confirmations.csv'):
        zn = (r.get('존') or '').strip()
        if not zn:
            continue
        if '안 봤' in (r.get('판정') or ''):
            unseen.add(zn)
            continue
        _v = r.get('판정') or ''
        if '참고' in _v:
            continue
        kind = 'fix' if '틀림' in _v else 'maybe' if '아마' in _v else 'ok'
        ev = (r.get('근거') or '').strip()
        nums = expand_nums(r.get('번호') or '')
        if not nums:
            if kind == 'maybe':
                maybe_zones.add(zn)
            elif kind == 'ok':
                zones.add(zn)
                zone_ev[zn] = ev
            continue
        for n in nums:
            songs[zn, n] = (kind, ev)
    return (zones, songs, unseen, zone_ev, maybe_zones)

def expand_nums(text):
    out = []
    import re as _re
    for part in _re.split('[;,]', text or ''):
        part = part.strip()
        if not part:
            continue
        m = _re.match('^(-?\\d+)\\s*[~]\\s*(-?\\d+)$', part) or _re.match('^(\\d+)\\s*-\\s*(\\d+)$', part)
        if m:
            a, b = (int(m.group(1)), int(m.group(2)))
            if a > b:
                a, b = (b, a)
            out += [str(n) for n in range(a, b + 1)]
            continue
        try:
            out.append(str(int(part)))
        except ValueError:
            continue
    return out

def _one_place_only():
    text = io.open(__file__, encoding='utf-8').read()
    body = text[text.index('def _seen_src'):text.index('def build_zones')]
    mark = 'song_ev_grade' + '.get('
    outside = text.count(mark) - body.count(mark) - 1
    if outside > 0:
        raise SystemExit('FAIL 근거를 붙이는 자리가 `_seen_src` 밖에 %d곳 있다.\n     거기만 고치면 나머지 자리는 조용히 옛 근거를 쓴다 — 곡 목록을 만드는 자리는 다섯이다.\n     고치는 법: 그 자리도 `_seen_src(...)` 를 부르게 한다.' % outside)

def main():
    _one_place_only()
    try:
        import confirm_fill as _cf
        if _cf.LEDGER.is_file():
            _cf.build()
        else:
            print('   (user_confirmations.csv 없음 — out/arcade_confirm_fill.csv 를 그대로 쓴다)')
    except Exception as _e:
        print('   (확인 채움 재생성 실패 — 옛 판을 쓴다: %s)' % _e)
    FILL_EV.update(_load_fill())
    CATR_EV.update(_load_category_reads())
    SIZE_OBS.update(zone_size_obs())
    print('   화면 실측 총수 %d존' % len(SIZE_OBS))
    print('   채움 근거 %d칸을 지도에 싣는다' % len(FILL_EV))
    print('   category_reads 등급 %d칸' % len(CATR_EV))
    cats = build_zones()
    from titles import expand as _expand
    for _cat, _zs in cats.items():
        for _z in _zs:
            for _s in _z.get('songs', []):
                _s['t'] = _expand(_s.get('t', ''))
    uc_zones, uc_songs, uc_unseen, uc_zone_ev, uc_maybe = user_confirmations()
    gapw = gap_windows()
    alias = {}
    for _m in rows('out/arcade_0814_menu.csv'):
        t, c = ((_m.get('타일') or '').strip(), (_m.get('채널') or '').strip())
        if t and c:
            alias[t] = c
            alias[c] = t
    apply_user_confirmations(cats, uc_zones, uc_songs, uc_maybe, uc_unseen, alias, gapw)
    for _zs in cats.values():
        for _z in _zs:
            if _z.get('name') == 'ORIGINAL':
                _z['songs_premium'] = premium_songs_from_normal(_z['songs'])
                _z['premium_size'] = 332
    data = {}
    parts = []
    ntot = ncov = 0
    for cat, zs in cats.items():
        if cat in DIFFICULTY:
            zs = sorted(zs, key=lambda z: _lvnum(z['name']))
            layout = 'grid'
        elif cat in GRIDCATS:
            layout = 'grid'
        elif cat == '시리즈존':
            layout = 'slider'
        else:
            zs = sorted(zs, key=lambda z: (0 if z['covered'] else 1, z['name']))
            layout = 'slider'
        cov = sum((1 for z in zs if z['covered']))
        ntot += len(zs)
        ncov += cov
        cards = ''.join((card(z) for z in zs))
        parts.append('<div class="catrow"><div class="cathd">%s <span class="cnt">%d개 · 근거 %d</span></div><div class="%s">%s</div></div>' % (cat, len(zs), cov, layout, cards))
        if cat == '싱글':
            parts.append('<div id="detail"></div>')
        for z in zs:
            data[z['name']] = z
    sub = '존 %d개 · 근거 있는 존 %d (%d%%) · 8/14 알 판독 포함 · PC 가로 슬라이더' % (ntot, ncov, round(100 * ncov / max(ntot, 1)))
    vids = ''.join(('<a href="https://www.youtube.com/watch?v=%s" target="_blank" rel="noopener">%s</a>' % (vid, lab) for lab, vid in video_links()))
    html = HTML.replace('{{SUB}}', sub).replace('{{VIDS}}', vids).replace('{{ROWS}}', '\n'.join(parts)).replace('{{DATA}}', json.dumps(data, ensure_ascii=False))
    OUT.parent.mkdir(exist_ok=True)
    _ser = [z[0] for z in zart_all if z[1] == '시리즈존']
    _got = [k for k in re.findall('data-key="([^"]+)"', html) if k in set(_ser)]
    if _ser and _got != _ser:
        raise SystemExit('FAIL 시리즈존 순서가 정본과 다르다 · 정본 %s · 지도 %s' % (' → '.join(_ser), ' → '.join(_got)))
    io.open(OUT, 'w', encoding='utf-8').write(html)
    print('존 %d · 근거 %d (%d%%) -> %s' % (ntot, ncov, round(100 * ncov / max(ntot, 1)), os.path.relpath(OUT, ROOT)))
    return 0
if __name__ == '__main__':
    sys.exit(main())
