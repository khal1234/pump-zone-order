"""ORIGINAL 채널의 확인된 위치 사이를 순서 규칙으로 채운다."""
import csv
import io
import os
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'out')
sys.path.insert(0, HERE)
SCREEN_SIZE = 331

def anchors():
    p = os.path.join(OUT, 'arcade_category_reads.csv')
    if not os.path.isfile(p):
        return []
    out = []
    for r in csv.DictReader(io.open(p, encoding='utf-8-sig')):
        if r.get('채널') == 'ORIGINAL' and r.get('등급') == '프레임직독':
            if r.get('위치', '').isdigit() and r.get('곡'):
                out.append((int(r['위치']), r['곡']))
    return sorted(out)

def measure():
    import make_checkpoints as mc
    pred = mc.original_prediction()
    if not pred:
        return ([], [], [])
    norm = lambda s: ''.join(s.split()).lower()
    idx = {}
    for i, t in enumerate(pred, 1):
        idx.setdefault(norm(t), i)
    pinned = []
    for pos, name in anchors():
        j = idx.get(norm(name))
        if j:
            pinned.append((pos, name, j))
    spans = []
    for (p1, n1, j1), (p2, n2, j2) in zip(pinned, pinned[1:]):
        if j1 - p1 == j2 - p2:
            spans.append((p1, p2, j1 - p1, '닻 %d·%d 의 밀림이 둘 다 +%d' % (p1, p2, j1 - p1)))
    if pinned:
        lp, ln, lj = pinned[-1]
        if lj - lp == len(pred) - SCREEN_SIZE:
            spans.append((lp, SCREEN_SIZE, lj - lp, '마지막 닻의 밀림 +%d 이 총 차이(%d−%d)와 같아 뒤로 더 빠질 것이 없다' % (lj - lp, len(pred), SCREEN_SIZE)))
    return (pred, pinned, spans)

def open_gaps():
    pred, pinned, spans = measure()
    if not pred:
        return []
    locked = set()
    for a, b, _, _ in spans:
        locked.update(range(a, b + 1))
    gaps, run = ([], None)
    for n in range(1, SCREEN_SIZE + 1):
        if n in locked:
            if run:
                gaps.append(run)
                run = None
        else:
            run = (run[0], n) if run else (n, n)
    if run:
        gaps.append(run)
    return gaps

def main() -> int:
    pred, pinned, spans = measure()
    if not pred:
        print('FAIL 유도 ORIGINAL 순서가 없다 — nav_index.json 을 먼저 만든다')
        return 1
    an = anchors()
    print('닻 %d칸 · 유도목록에서 찾음 %d · 못 찾음 %d' % (len(an), len(pinned), len(an) - len(pinned)))
    got = {p for p, _, _ in pinned}
    for pos, name in an:
        if pos not in got:
            print('   ?? 화면 %-4d %s — 유도 목록에 없다' % (pos, name))
    if len(pinned) < 2:
        print('FAIL 닻이 2개 미만이라 구간을 못 잠근다')
        return 1
    print('\n 화면번호  곡                                유도위치  밀림')
    for pos, name, j in pinned:
        print('   %-8d %-32s %-8d +%d' % (pos, name, j, j - pos))
    rows = []
    for a, b, sh, why in spans:
        for pos in range(a, b + 1):
            j = pos + sh
            if 1 <= j <= len(pred):
                rows.append(['ORIGINAL', pos, pred[j - 1], why, '구간확정'])
    seen, uniq = (set(), [])
    for r in rows:
        if r[1] in seen:
            continue
        seen.add(r[1])
        uniq.append(r)
    uniq.sort(key=lambda r: r[1])
    p = os.path.join(OUT, 'arcade_original_fill.csv')
    with io.open(p, 'w', encoding='utf-8-sig', newline='\n') as fh:
        w = csv.writer(fh, lineterminator='\n')
        w.writerow(['채널', '위치', '곡', '근거', '등급'])
        w.writerows(uniq)
    print('\n잠근 구간 %d개:' % len(spans))
    for a, b, sh, _ in spans:
        print('   %3d~%-4d (+%d) — %d칸' % (a, b, sh, b - a + 1))
    print('확정 %d칸 / 화면 %d칸 (%.0f%%) -> out/arcade_original_fill.csv' % (len(uniq), SCREEN_SIZE, 100.0 * len(uniq) / SCREEN_SIZE))
    return 0
if __name__ == '__main__':
    sys.exit(main())
