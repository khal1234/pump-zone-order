import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { loadContract, type LoadState } from "./data";
import type {
  EvidenceRow,
  FilterKey,
  LocationItem,
  PositionSet,
  PublicContract,
  TabKey,
  ZoneSelection,
} from "./types";

const FILTERS: Array<{ key: FilterKey; label: string; short: string }> = [
  { key: "all", label: "프리미엄 전체 곡", short: "전체" },
  { key: "normal", label: "노말에서 고를 수 있는 곡", short: "노말" },
  { key: "nofull", label: "풀송 제외", short: "풀송 제외" },
  { key: "nofullremix", label: "풀송·리믹스 제외", short: "둘 다 제외" },
  { key: "onlyshort", label: "숏컷만", short: "숏컷만" },
];
type CreditMode = "normal" | "premium";
type ZoneGroupKey = "single" | "double" | "series" | "channel";
const MODE_MAX: Record<CreditMode, number> = { normal: 4, premium: 6 };
const QUICK_TITLES = ["노스텔지어", "네이드 네이드", "클리너 - SHORT CUT -", "알테일"];
const RECENT_KEY = "pump-zone-recent-v1";

function pos(set: PositionSet | undefined, filter: FilterKey): number | undefined {
  if (!set) return undefined;
  return set[filter] ?? set.all;
}

function heartsToFilter(mode: CreditMode, hearts: number): FilterKey {
  if (hearts >= 4) return mode === "premium" ? "all" : "normal";
  if (hearts === 3) return "nofull";
  if (hearts === 2) return "nofullremix";
  return "onlyshort";
}

function locationsFor(contract: PublicContract, title: string, filter: FilterKey): LocationItem[] {
  const nav = contract.navIndex;
  const items: LocationItem[] = [];
  for (const chart of nav.chartsOf[title] ?? []) {
    const positions = nav.levels[`${title}|${chart}`];
    const position = pos(positions, filter);
    const total = pos(nav.levelTotals[chart], filter);
    if (position && total) {
      items.push({ id: `level:${chart}`, kind: "level", label: `${chart} 난이도존`, sublabel: chart.startsWith("S") ? "싱글" : "더블", position, total, listKey: chart });
    }
  }
  const series = nav.series[title];
  const seriesPosition = pos(series?.pos, filter);
  const seriesTotal = pos(series ? nav.seriesTotals[series.zone] : undefined, filter);
  if (series && seriesPosition && seriesTotal) {
    items.push({ id: `series:${series.zone}`, kind: "series", label: series.zone, sublabel: "시리즈존", position: seriesPosition, total: seriesTotal, listKey: series.zone });
  }
  const channel = nav.channel[title];
  if (channel) {
    items.push({ id: `channel:${channel.kind}`, kind: "channel", label: `${channel.kind} 채널`, sublabel: "전용 채널", position: channel.pos, total: channel.total, listKey: channel.kind });
  }
  for (const category of nav.cats[title] ?? []) {
    items.push({ id: `category:${category.tile}`, kind: "category", label: category.tile, sublabel: "카테고리", position: category.pos, total: category.total, listKey: category.tile });
  }
  return items;
}

function listFor(contract: PublicContract, location: LocationItem, filter: FilterKey): Array<{ title: string; position: number }> {
  const finder = contract.finder;
  if (location.kind === "level") {
    return (finder.levelSongs[location.listKey] ?? [])
      .map((entry) => ({ title: entry.t, position: pos(entry.f, filter) ?? 0 }))
      .filter((entry) => entry.position > 0)
      .sort((a, b) => a.position - b.position);
  }
  if (location.kind === "series") {
    return (finder.seriesSongs[location.listKey] ?? [])
      .map((entry) => ({ title: entry.t, position: pos(entry.f, filter) ?? 0 }))
      .filter((entry) => entry.position > 0)
      .sort((a, b) => a.position - b.position);
  }
  if (location.kind === "channel") {
    return (finder.channelSongs[location.listKey] ?? []).map((title, index) => ({ title, position: index + 1 }));
  }
  return (finder.catSongs[location.listKey] ?? []).map((title, index) => ({ title, position: index + 1 }));
}

function confidenceClass(grade: string): "solid" | "estimated" | "unknown" {
  if (!grade) return "unknown";
  if (/미검증|추정|추측|구간/.test(grade)) return "estimated";
  if (/직독|눈판독|곁칸|확정|실측/.test(grade)) return "solid";
  return "unknown";
}

function Icon({ name }: { name: "search" | "zones" | "recent" | "sun" | "moon" | "back" | "share" | "close" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    zones: <><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v5H4zM14 15h6v5h-6z"/></>,
    recent: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>,
    back: <path d="m15 18-6-6 6-6"/>,
    share: <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function App() {
  const [contract, setContract] = useState<PublicContract | null>(null);
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("search");
  const [creditMode, setCreditMode] = useState<CreditMode>("normal");
  const [hearts, setHearts] = useState(MODE_MAX.normal);
  const filter = heartsToFilter(creditMode, hearts);
  const [zone, setZone] = useState<ZoneSelection | null>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
  });
  const [light, setLight] = useState(() => localStorage.getItem("pump-zone-theme") === "light");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    localStorage.setItem("pump-zone-theme", light ? "light" : "dark");
  }, [light]);

  useEffect(() => {
    loadContract().then(({ contract: loaded, state }) => {
      setContract(loaded);
      setLoadState(state);
      const title = new URLSearchParams(location.search).get("song");
      if (title && loaded.songs.some((song) => song.title === title)) setSelectedTitle(title);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "위치 데이터를 불러오지 못했어"));
  }, []);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setTab("search");
      setSelectedTitle(null);
      setZone(null);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const titles = useMemo(() => contract?.songs.map((song) => song.title) ?? [], [contract]);
  const inverseAliases = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!contract) return map;
    for (const [alias, canonical] of Object.entries(contract.navIndex.alias)) (map[canonical] ??= []).push(alias);
    return map;
  }, [contract]);
  const results = useMemo(() => {
    if (!query.trim() || !window.NAV_SEARCH) return [];
    return window.NAV_SEARCH.rankTitles(query, titles, (title) => inverseAliases[title] ?? []).slice(0, 24);
  }, [query, titles, inverseAliases]);

  function chooseTitle(title: string) {
    setSelectedTitle(title);
    setQuery(title);
    setTab("search");
    setZone(null);
    const next = [title, ...recent.filter((item) => item !== title)].slice(0, 12);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    history.replaceState(null, "", `?song=${encodeURIComponent(title)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearSearch() {
    setQuery("");
    setSelectedTitle(null);
    history.replaceState(null, "", location.pathname);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function changeTab(next: TabKey) {
    setTab(next);
    setSelectedTitle(null);
    setZone(null);
    if (next === "search") requestAnimationFrame(() => searchRef.current?.focus());
  }

  if (error) return <FatalState message={error} />;
  if (!contract) return <LoadingState />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span>↖</span><b>P</b><span>↗</span></div>
          <div><strong>ZONE FINDER</strong><small>PUMP IT UP</small></div>
        </div>
        <div className="top-actions">
          <div className={`sync-pill ${loadState === "cached" ? "cached" : ""}`}>
            <span></span>{loadState === "cached" ? "오프라인 저장본" : "데이터 연결됨"}
          </div>
          <button className="icon-button" onClick={() => setLight((value) => !value)} aria-label={light ? "어두운 테마" : "밝은 테마"}>
            <Icon name={light ? "moon" : "sun"} />
          </button>
        </div>
      </header>

      {loadState === "cached" && <div className="offline-banner">네트워크에 연결되지 않아 마지막으로 검증한 저장 데이터를 보여 주고 있어.</div>}

      <main>
        <section className="hero">
          <p className="eyebrow">{contract.game.contentThrough} ARCADE ORDER</p>
          <h1>곡은 기억났는데,<br/><em>어디 있었지?</em></h1>
          <p className="hero-copy">곡 이름만 입력하면 시리즈존과 난이도존 위치를 바로 찾아줘.</p>
          <SearchBox ref={searchRef} query={query} setQuery={(value) => { setQuery(value); setSelectedTitle(null); }} clear={clearSearch} />
          <CreditControl mode={creditMode} hearts={hearts} filter={filter} onModeChange={(next) => { setCreditMode(next); setHearts(MODE_MAX[next]); }} onHeartsChange={setHearts} />
        </section>

        <section className="content" aria-live="polite">
          {tab === "search" && selectedTitle && <SongDetail contract={contract} title={selectedTitle} filter={filter} onBack={() => setSelectedTitle(null)} />}
          {tab === "search" && !selectedTitle && query.trim() && <SearchResults query={query} results={results} contract={contract} filter={filter} onChoose={chooseTitle} />}
          {tab === "search" && !selectedTitle && !query.trim() && <SearchLanding onChoose={chooseTitle} recent={recent} />}
          {tab === "zones" && <ZoneBrowser contract={contract} filter={filter} zone={zone} setZone={setZone} onChoose={chooseTitle} />}
          {tab === "recent" && <RecentView recent={recent} onChoose={chooseTitle} onClear={() => { setRecent([]); localStorage.removeItem(RECENT_KEY); }} />}
        </section>
      </main>

      <footer className="data-footer">
        <span>{contract.game.contentThrough}</span><span>계약 {contract.contentHash.slice(0, 12)}</span><span>{contract.songs.length}곡</span>
      </footer>
      <nav className="bottom-nav" aria-label="주요 메뉴">
        <NavButton active={tab === "search"} icon="search" label="검색" onClick={() => changeTab("search")} />
        <NavButton active={tab === "zones"} icon="zones" label="존 목록" onClick={() => changeTab("zones")} />
        <NavButton active={tab === "recent"} icon="recent" label="최근 찾기" onClick={() => changeTab("recent")} />
      </nav>
    </div>
  );
}

const SearchBox = forwardRef<HTMLInputElement, { query: string; setQuery(value: string): void; clear(): void }>(function SearchBox({ query, setQuery, clear }, ref) {
  return <div className="search-box">
    <Icon name="search" />
    <input ref={ref} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="곡 이름을 입력해봐" aria-label="곡 이름 검색" autoComplete="off" />
    {query && <button onClick={clear} aria-label="검색어 지우기"><Icon name="close" /></button>}
    <kbd>⌘ K</kbd>
  </div>;
});

function CreditControl({ mode, hearts, filter, onModeChange, onHeartsChange }: { mode: CreditMode; hearts: number; filter: FilterKey; onModeChange(value: CreditMode): void; onHeartsChange(value: number): void }) {
  const max = MODE_MAX[mode];
  const filterLabel = FILTERS.find((item) => item.key === filter)?.label;
  return <div className="credit-control">
    <div className="mode-control" aria-label="크레딧 종류">
      <button className={mode === "normal" ? "active" : ""} onClick={() => onModeChange("normal")}><b>노말</b><small>4♥</small></button>
      <button className={mode === "premium" ? "active" : ""} onClick={() => onModeChange("premium")}><b>프리미엄</b><small>6♥</small></button>
    </div>
    <div className="heart-control">
      <span className="heart-title">남은 하트</span>
      <div className="heart-buttons" role="group" aria-label={`남은 하트 ${hearts}개`}>
        {Array.from({ length: max }, (_, index) => index + 1).map((value) => <button key={value} className={value <= hearts ? "filled" : ""} onClick={() => onHeartsChange(value)} aria-label={`하트 ${value}개로 설정`} aria-pressed={value === hearts}>♥</button>)}
      </div>
      <b className="heart-count">{hearts}/{max}</b>
      <small className="heart-result">{filterLabel}</small>
    </div>
  </div>;
}

function SearchLanding({ onChoose, recent }: { onChoose(title: string): void; recent: string[] }) {
  return <>
    <div className="section-heading"><div><span>빠른 시작</span><h2>이렇게 찾아봐</h2></div><p>오락실에서 한 손으로 누르기 좋은 예시야.</p></div>
    <div className="quick-grid">{QUICK_TITLES.map((title, index) => <button key={title} onClick={() => onChoose(title)}><small>0{index + 1}</small><strong>{title}</strong><span>위치 보기 →</span></button>)}</div>
    {recent.length > 0 && <div className="inline-recents"><b>최근</b>{recent.slice(0, 5).map((title) => <button key={title} onClick={() => onChoose(title)}>{title}</button>)}</div>}
  </>;
}

function SearchResults({ query, results, contract, filter, onChoose }: { query: string; results: NavSearchHit[]; contract: PublicContract; filter: FilterKey; onChoose(title: string): void }) {
  return <>
    <div className="section-heading"><div><span>검색 결과</span><h2>“{query}”</h2></div><p>{results.length}곡을 가까운 순서로 찾았어.</p></div>
    {results.length === 0 ? <EmptyState title="가까운 곡을 찾지 못했어" copy="문장부호를 빼거나 제목의 앞부분만 입력해봐." /> :
      <div className="result-list">{results.map((result, index) => {
        const locations = locationsFor(contract, result.title, filter);
        const charts = contract.navIndex.chartsOf[result.title] ?? [];
        return <button className="result-card" key={result.title} onClick={() => onChoose(result.title)}>
          <span className="result-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="result-main"><strong>{result.title}</strong><small>{charts.slice(0, 7).join(" · ") || "전용 채널 곡"}</small></span>
          <span className="result-route">{locations[0] ? <><b>{locations[0].position}</b><small>/ {locations[0].total}</small></> : <small>위치 확인</small>}</span>
          <span className="arrow">→</span>
        </button>;
      })}</div>}
  </>;
}

function SongDetail({ contract, title, filter, onBack }: { contract: PublicContract; title: string; filter: FilterKey; onBack(): void }) {
  const locations = locationsFor(contract, title, filter);
  const [activeId, setActiveId] = useState(locations[0]?.id ?? "");
  useEffect(() => setActiveId(locations[0]?.id ?? ""), [title, filter]);
  const active = locations.find((item) => item.id === activeId) ?? locations[0];
  const neighbors = active ? neighborTriplet(contract, active, title, filter) : [];
  const evidence = evidenceFor(contract, title);
  const songId = contract.songs.find((song) => song.title === title)?.id;
  const routeGroups = [
    { label: "싱글", items: locations.filter((item) => item.kind === "level" && item.sublabel === "싱글") },
    { label: "더블", items: locations.filter((item) => item.kind === "level" && item.sublabel === "더블") },
    { label: "시리즈존", items: locations.filter((item) => item.kind === "series") },
    { label: "카테고리", items: locations.filter((item) => item.kind === "category" || item.kind === "channel") },
  ].filter((group) => group.items.length > 0);

  async function share() {
    const url = `${location.origin}${location.pathname}?song=${encodeURIComponent(title)}`;
    if (navigator.share) await navigator.share({ title: `${title} 위치`, url });
    else await navigator.clipboard.writeText(url);
  }

  return <article className="detail-view">
    <div className="detail-top">
      <button className="back-button" onClick={onBack}><Icon name="back" /> 결과로</button>
      <button className="share-button" onClick={() => void share()}><Icon name="share" /> 공유</button>
    </div>
    <div className="title-block"><p>SONG LOCATION</p><h2>{title}</h2><span>{songId}</span></div>
    {locations.length ? <>
      <div className="route-groups">{routeGroups.map((group) => <div className="route-row" key={group.label}>
        <h3>{group.label}</h3>
        <div className="route-options">{group.items.map((location) => <button key={location.id} onClick={() => setActiveId(location.id)} className={active?.id === location.id ? "active" : ""}>
          <strong>{location.kind === "level" ? location.listKey : location.label.replace(" 채널", "")}</strong>
          <span><b>{location.position}</b>/{location.total}</span>
        </button>)}</div>
      </div>)}</div>
      {active && <div className="neighbor-panel">
        <div className="neighbor-head"><span>기기에서 이렇게 보여</span><b>{active.label} · {FILTERS.find((item) => item.key === filter)?.label}</b></div>
        <div className="neighbor-strip">{neighbors.map((item) => <div key={`${item.position}:${item.title}`} className={item.current ? "current" : ""}><span>{item.position}</span><strong>{item.title}</strong><small>{item.current ? "찾는 곡" : item.side}</small></div>)}</div>
        <p className="wrap-note">첫 곡과 마지막 곡은 서로 이어져. 난이도존 1번은 RANDOM이고, 곡 위치는 기기 화면 번호 그대로 보여줘.</p>
      </div>}
    </> : <EmptyState title="공개 위치가 아직 없어" copy="곡은 목록에 있지만 현재 기기 위치 근거가 연결되지 않았어." />}
    <EvidencePanel rows={evidence} />
  </article>;
}

function neighborTriplet(contract: PublicContract, location: LocationItem, title: string, filter: FilterKey) {
  const rows = listFor(contract, location, filter);
  const index = rows.findIndex((row) => row.title === title && row.position === location.position);
  if (index < 0 || rows.length < 2) {
    const current = rows.find((row) => row.title === title);
    return current ? [{ ...current, current: true, side: "" }] : [];
  }
  const previous = rows[(index - 1 + rows.length) % rows.length];
  const current = rows[index];
  const next = rows[(index + 1) % rows.length];
  return [{ ...previous, current: false, side: "앞 곡" }, { ...current, current: true, side: "찾는 곡" }, { ...next, current: false, side: "뒤 곡" }];
}

function evidenceFor(contract: PublicContract, title: string): EvidenceRow[] {
  const seen = new Set<string>();
  return Object.values(contract.evidence).flat().filter((row) => row.title === title).filter((row) => {
    const key = `${row.zone}|${row.position}|${row.grade}|${row.source ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 8);
}

function EvidencePanel({ rows }: { rows: EvidenceRow[] }) {
  return <section className="evidence-panel"><div className="section-heading compact"><div><span>위치 근거</span><h3>확인 정도</h3></div></div>
    {rows.length ? <div className="evidence-list">{rows.map((row, index) => <div key={`${row.zone}:${row.position}:${index}`}>
      <span className={`confidence-dot ${confidenceClass(row.grade)}`}></span>
      <p><strong>{row.zone || "위치 자료"} {row.position && `#${row.position}`}</strong><small>{row.grade || "등급 미기록"}{row.source && row.source !== row.grade ? ` · ${row.source}` : ""}</small></p>
    </div>)}</div> : <p className="muted-box">이 곡의 공개 근거 설명은 아직 연결되지 않았어. 위치 번호와 근거 완성도는 별도로 관리돼.</p>}
  </section>;
}

function ZoneBrowser({ contract, filter, zone, setZone, onChoose }: { contract: PublicContract; filter: FilterKey; zone: ZoneSelection | null; setZone(value: ZoneSelection | null): void; onChoose(title: string): void }) {
  const [group, setGroup] = useState<ZoneGroupKey>("single");
  if (zone) {
    const rows = zoneRows(contract, zone, filter);
    return <div className="zone-detail"><button className="back-button" onClick={() => setZone(null)}><Icon name="back" /> 존 목록</button>
      <div className="section-heading"><div><span>{zone.kind.toUpperCase()}</span><h2>{zone.label}</h2></div><p>{rows.length}곡 · {FILTERS.find((item) => item.key === filter)?.label}</p></div>
      <div className="zone-song-list">{rows.map((row) => <button key={`${row.position}:${row.title}`} onClick={() => onChoose(row.title)}><b>{row.position}</b><span>{row.title}</span><em>→</em></button>)}</div>
    </div>;
  }
  const single = Object.keys(contract.finder.levelSongs).filter((key) => key.startsWith("S"));
  const double = Object.keys(contract.finder.levelSongs).filter((key) => key.startsWith("D"));
  const numericSort = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));
  const groups: Record<ZoneGroupKey, { title: string; color: string; items: Array<{ key: string; count: number }>; choose(key: string): void }> = {
    single: { title: "싱글 난이도존", color: "mint", items: single.sort(numericSort).map((key) => ({ key, count: zoneRows(contract, { kind: "level", key, label: key }, filter).length })), choose: (key) => setZone({ kind: "level", key, label: `${key} 난이도존` }) },
    double: { title: "더블 난이도존", color: "coral", items: double.sort(numericSort).map((key) => ({ key, count: zoneRows(contract, { kind: "level", key, label: key }, filter).length })), choose: (key) => setZone({ kind: "level", key, label: `${key} 난이도존` }) },
    series: { title: "시리즈존", color: "gold", items: contract.finder.seriesOrder.map((key) => ({ key, count: zoneRows(contract, { kind: "series", key, label: key }, filter).length })), choose: (key) => setZone({ kind: "series", key, label: key }) },
    channel: { title: "전용 채널", color: "blue", items: Object.entries(contract.finder.channelSongs).map(([key, rows]) => ({ key, count: rows.length })), choose: (key) => setZone({ kind: "channel", key, label: `${key} 채널` }) },
  };
  const activeGroup = groups[group];
  return <>
    <div className="section-heading"><div><span>ZONE BROWSER</span><h2>존으로 둘러보기</h2></div><p>기기에서 들어갈 메뉴를 먼저 골라도 돼.</p></div>
    <div className="zone-tabs" role="tablist" aria-label="존 종류">
      {(["single", "double", "series", "channel"] as ZoneGroupKey[]).map((key) => <button key={key} role="tab" aria-selected={group === key} className={group === key ? "active" : ""} onClick={() => setGroup(key)}>{groups[key].title.replace(" 난이도존", "")}</button>)}
    </div>
    <ZoneGroup title={activeGroup.title} color={activeGroup.color} items={activeGroup.items} choose={activeGroup.choose} />
  </>;
}

function zoneRows(contract: PublicContract, zone: ZoneSelection, filter: FilterKey) {
  const fake: LocationItem = { id: "", kind: zone.kind, label: zone.label, sublabel: "", position: 0, total: 0, listKey: zone.key };
  return listFor(contract, fake, filter);
}

function ZoneGroup({ title, color, items, choose }: { title: string; color: string; items: Array<{ key: string; count: number }>; choose(key: string): void }) {
  return <section className="zone-group"><div className="zone-group-title"><span className={color}></span><h3>{title}</h3><small>{items.length}개</small></div>
    <div className="zone-grid">{items.map((item) => <button key={item.key} onClick={() => choose(item.key)}><strong>{item.key}</strong><span>{item.count}곡</span><em>→</em></button>)}</div>
  </section>;
}

function RecentView({ recent, onChoose, onClear }: { recent: string[]; onChoose(title: string): void; onClear(): void }) {
  return <><div className="section-heading"><div><span>ON THIS DEVICE</span><h2>최근 찾은 곡</h2></div>{recent.length > 0 && <button className="text-button" onClick={onClear}>기록 지우기</button>}</div>
    {recent.length ? <div className="result-list">{recent.map((title, index) => <button className="result-card" key={title} onClick={() => onChoose(title)}><span className="result-index">{String(index + 1).padStart(2, "0")}</span><span className="result-main"><strong>{title}</strong><small>이 기기에만 저장됨</small></span><span className="arrow">→</span></button>)}</div> : <EmptyState title="아직 찾은 곡이 없어" copy="검색한 곡을 열면 이 기기에만 최근 기록이 남아." />}
  </>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: "search" | "zones" | "recent"; label: string; onClick(): void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><Icon name={icon} /><span>{label}</span></button>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><div>↗</div><h3>{title}</h3><p>{copy}</p></div>;
}

function LoadingState() {
  return <div className="state-screen"><div className="brand-mark"><span>↖</span><b>P</b><span>↗</span></div><div className="loader"></div><p>위치 데이터를 맞추고 있어…</p></div>;
}

function FatalState({ message }: { message: string }) {
  return <div className="state-screen error"><div className="brand-mark"><span>↖</span><b>!</b><span>↗</span></div><h1>데이터를 열지 못했어</h1><p>{message}</p><button onClick={() => location.reload()}>다시 불러오기</button></div>;
}
