import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { loadContract, type LoadState } from "./data";
import { FeedbackAdmin, FeedbackDialog } from "./Feedback";
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
type ZoneGroupKey = "single" | "double" | "series" | "category";
const MODE_MAX: Record<CreditMode, number> = { normal: 4, premium: 6 };
const QUICK_TITLES = ["노스텔지어", "네이드 네이드", "클리너 - SHORT CUT -", "알테일"];
const RECENT_KEY = "pump-zone-recent-v1";

function pos(set: PositionSet | undefined, filter: FilterKey): number | undefined {
  if (!set) return undefined;
  return set[filter];
}

function channelAvailable(kind: string, filter: FilterKey): boolean {
  if (kind === "숏컷") return true;
  if (kind === "리믹스") return filter !== "nofullremix" && filter !== "onlyshort";
  if (kind === "풀송") return filter === "all" || filter === "normal";
  return filter !== "onlyshort";
}

function heartsToFilter(mode: CreditMode, hearts: number): FilterKey {
  if (hearts >= 4) return mode === "premium" ? "all" : "normal";
  if (hearts === 3) return "nofull";
  if (hearts === 2) return "nofullremix";
  return "onlyshort";
}

function levelLabel(channel: string, folds: Record<string, string>): string {
  return Object.values(folds).includes(channel) ? `${channel} OVER` : channel;
}

function chartLabels(charts: string[], folds: Record<string, string>): string[] {
  return [...new Set(charts.map((chart) => levelLabel(folds[chart] ?? chart, folds)))];
}

function locationsFor(contract: PublicContract, title: string, filter: FilterKey): LocationItem[] {
  const nav = contract.navIndex;
  const items: LocationItem[] = [];
  // 시리즈 위치가 전체에는 있지만 선택 필터에는 없으면 프리미엄 전용곡이다.
  // 이때 필터 구분이 없는 옛 카테고리 판독으로 우회 노출하면 안 된다.
  const titleSeries = nav.series[title];
  if (titleSeries?.pos.all && !pos(titleSeries.pos, filter)) return items;
  const seenLevelChannels = new Set<string>();
  for (const chart of nav.chartsOf[title] ?? []) {
    const channel = nav.levelFold?.[chart] ?? chart;
    if (seenLevelChannels.has(channel)) continue;
    const positions = nav.levels[`${title}|${channel}`] ?? nav.levels[`${title}|${chart}`];
    const position = pos(positions, filter);
    const total = pos(nav.levelTotals[channel], filter);
    if (position && total) {
      seenLevelChannels.add(channel);
      items.push({ id: `level:${channel}`, kind: "level", label: levelLabel(channel, nav.levelFold ?? {}), sublabel: channel.startsWith("S") ? "싱글" : "더블", position, total, listKey: channel });
    }
  }
  const series = nav.series[title];
  const seriesPosition = pos(series?.pos, filter);
  const seriesTotal = pos(series ? nav.seriesTotals[series.zone] : undefined, filter);
  if (series && seriesPosition && seriesTotal) {
    items.push({ id: `series:${series.zone}`, kind: "series", label: series.zone, sublabel: "시리즈존", position: seriesPosition, total: seriesTotal, listKey: series.zone });
    for (const [category, mirrorZone] of Object.entries(contract.finder.categoryMirrors ?? {})) {
      if (mirrorZone === series.zone && filter !== "onlyshort") {
        items.push({ id: `category:${category}`, kind: "category", label: category, sublabel: "카테고리", position: seriesPosition, total: seriesTotal, listKey: category });
      }
    }
  }
  const channel = nav.channel[title];
  if (channel && channelAvailable(channel.kind, filter)) {
    items.push({ id: `channel:${channel.kind}`, kind: "channel", label: `${channel.kind} 채널`, sublabel: "전용 채널", position: channel.pos, total: channel.total, listKey: channel.kind });
  }
  for (const [mode, list] of Object.entries(contract.finder.modeSongs ?? {})) {
    const index = list.indexOf(title);
    if (index >= 0) items.push({ id: `mode:${mode}`, kind: "channel", label: mode, sublabel: "게임 모드", position: index + 1, total: list.length, listKey: mode });
  }
  if (filter !== "onlyshort") {
    for (const category of nav.cats[title] ?? []) {
      items.push({ id: `category:${category.tile}`, kind: "category", label: category.tile, sublabel: "카테고리", position: category.pos, total: category.total, listKey: category.tile });
    }
  }
  return items;
}

function categoryEntries(contract: PublicContract, key: string, filter: FilterKey): Array<{ title: string; position: number; total: number }> {
  const mirrorZone = contract.finder.categoryMirrors?.[key];
  if (mirrorZone) {
    const total = pos(contract.finder.seriesTotals[mirrorZone], filter) ?? 0;
    return (contract.finder.seriesSongs[mirrorZone] ?? [])
      .map((entry) => ({ title: entry.t, position: pos(entry.f, filter) ?? 0, total }))
      .filter((entry) => entry.position > 0)
      .sort((a, b) => a.position - b.position);
  }
  const rows: Array<{ title: string; position: number; total: number }> = [];
  for (const [title, categories] of Object.entries(contract.navIndex.cats)) {
    for (const category of categories) {
      if (category.tile === key) rows.push({ title, position: category.pos, total: category.total });
    }
  }
  return rows.sort((a, b) => a.position - b.position);
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
    return (finder.channelSongs[location.listKey] ?? finder.modeSongs?.[location.listKey] ?? finder.modeRows?.[location.listKey] ?? []).map((title, index) => ({ title, position: index + 1 }));
  }
  return categoryEntries(contract, location.listKey, filter).map(({ title, position }) => ({ title, position }));
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  // 새 배포·새 위치 자료 알림 — 화면이 열려 있는 동안 1분마다, 그리고 화면으로 돌아올 때 확인한다(10-16 사용자 «내용물 바꼈는데 새로고침 하라 안뜨는거 불편»).
  useEffect(() => {
    if (!contract) return;
    let stopped = false;
    async function check() {
      try {
        const [v, c] = await Promise.all([
          fetch("/version.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
          fetch("/data/current.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        ]);
        if (stopped) return;
        if ((v?.build && v.build !== __BUILD_ID__) || (c?.contentHash && c.contentHash !== contract!.contentHash)) setUpdateReady(true);
      } catch { /* 오프라인이면 다음 확인 때 */ }
    }
    const timer = window.setInterval(check, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [contract]);
  const [adminOpen, setAdminOpen] = useState(() => new URLSearchParams(location.search).get("admin") === "feedback");
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
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "위치 데이터를 불러오지 못했습니다"));
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

  useEffect(() => {
    function restoreUrlState() {
      const title = new URLSearchParams(location.search).get("song");
      setSelectedTitle(title);
      if (title) {
        setQuery(title);
        setTab("search");
        setZone(null);
      }
    }
    window.addEventListener("popstate", restoreUrlState);
    return () => window.removeEventListener("popstate", restoreUrlState);
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

  function scrollToSearch() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (searchRef.current?.closest(".search-box") ?? searchRef.current)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }));
  }

  function scrollToSearchSoon() {
    scrollToSearch();
    window.setTimeout(scrollToSearch, 350);
  }

  function clearSongFromUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("song");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function openAdmin() {
    const url = new URL(location.href);
    url.searchParams.set("admin", "feedback");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setAdminOpen(true);
  }

  function closeAdmin() {
    const url = new URL(location.href);
    url.searchParams.delete("admin");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setAdminOpen(false);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setSelectedTitle(null);
    setZone(null);
    if (value.trim()) setTab("search");
  }

  function chooseTitle(title: string) {
    setSelectedTitle(title);
    setQuery(title);
    setTab("search");
    setZone(null);
    const next = [title, ...recent.filter((item) => item !== title)].slice(0, 12);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    history.pushState(null, "", `?song=${encodeURIComponent(title)}`);
    scrollToSearch();
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
    if (next !== "search") clearSongFromUrl();
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

      {updateReady && <div className="update-banner"><span>새 버전이 있습니다</span><button onClick={() => location.reload()}>새로고침</button></div>}
      {loadState === "cached" && <div className="offline-banner">네트워크에 연결되지 않아 마지막으로 검증한 저장 데이터를 보여 드립니다.</div>}

      <main>
        <section className="hero">
          <p className="eyebrow">{contract.game.contentThrough} ARCADE ORDER</p>
                    <CreditControl mode={creditMode} hearts={hearts} filter={filter} onModeChange={(next) => { setCreditMode(next); setHearts(MODE_MAX[next]); }} onHeartsChange={setHearts} />
          <SearchBox ref={searchRef} query={query} setQuery={updateQuery} clear={clearSearch} onFocus={scrollToSearchSoon} />
        </section>

        <section className={tab === "search" && query.trim() && !selectedTitle ? "content searching" : "content"} aria-live="polite">
          {tab === "search" && selectedTitle && <SongDetail contract={contract} title={selectedTitle} filter={filter} onBack={() => { setSelectedTitle(null); clearSongFromUrl(); }} />}
          {tab === "search" && !selectedTitle && query.trim() && <SearchResults query={query} results={results} contract={contract} filter={filter} onChoose={chooseTitle} />}
          {tab === "search" && !selectedTitle && !query.trim() && <SearchLanding onChoose={chooseTitle} recent={recent} onMore={() => changeTab("recent")} />}
          {tab === "zones" && <ZoneBrowser contract={contract} filter={filter} zone={zone} setZone={setZone} onChoose={chooseTitle} />}
          {tab === "recent" && <RecentView recent={recent} onChoose={chooseTitle} onClear={() => { setRecent([]); localStorage.removeItem(RECENT_KEY); }} />}
        </section>
      </main>

      <footer className="data-footer">
        <span>{contract.game.contentThrough}</span><span>계약 {contract.contentHash.slice(0, 12)}</span><span>{contract.songs.length}곡</span>
        <button onClick={() => setFeedbackOpen(true)}>익명 건의</button><button onClick={openAdmin}>관리</button>
      </footer>
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {adminOpen && <FeedbackAdmin onClose={closeAdmin} />}
      <nav className="bottom-nav" aria-label="주요 메뉴">
        <NavButton active={tab === "search"} icon="search" label="검색" onClick={() => changeTab("search")} />
        <NavButton active={tab === "zones"} icon="zones" label="존 목록" onClick={() => changeTab("zones")} />
      </nav>
    </div>
  );
}

const SearchBox = forwardRef<HTMLInputElement, { query: string; setQuery(value: string): void; clear(): void; onFocus(): void }>(function SearchBox({ query, setQuery, clear, onFocus }, ref) {
  return <form className="search-box" role="search" onSubmit={(event) => { event.preventDefault(); (event.currentTarget.querySelector("input") as HTMLInputElement | null)?.blur(); }}>
    <Icon name="search" />
    <input ref={ref} type="search" name="song-search" inputMode="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} onFocus={onFocus} placeholder="곡 이름을 입력하세요" aria-label="곡 이름 검색" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true" />
    {query && <button onClick={clear} aria-label="검색어 지우기"><Icon name="close" /></button>}
    <kbd>⌘ K</kbd>
  </form>;
});

function CreditControl({ mode, hearts, filter, onModeChange, onHeartsChange }: { mode: CreditMode; hearts: number; filter: FilterKey; onModeChange(value: CreditMode): void; onHeartsChange(value: number): void }) {
  const max = MODE_MAX[mode];
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
    </div>
  </div>;
}

const RECENT_SHOWN = 5;   // 검색 밑에 바로 보이는 최근 기록 수 — 폰 한 화면에 두 줄 안쪽

function SearchLanding({ onChoose, recent, onMore }: { onChoose(title: string): void; recent: string[]; onMore(): void }) {
  // 최근 찾기는 검색 바로 밑에 RECENT_SHOWN 개 — 더 있으면 «더보기» 로 전체 목록(10-16 사용자 «최근 찾기 날리고 검색 바로 밑에 … 더보기 같이 버튼 눌러서 이동»)
  return <>
    {recent.length > 0 && <div className="recent-strip"><div className="recent-head"><b>최근 찾기</b>{recent.length > RECENT_SHOWN && <button className="text-button" onClick={onMore}>더보기</button>}</div>
      <div className="recent-chips">{recent.slice(0, RECENT_SHOWN).map((title) => <button key={title} onClick={() => onChoose(title)}>{title}</button>)}</div></div>}
    <div className="section-heading"><div><span>빠른 시작</span><h2>이렇게 찾아보세요</h2></div></div>
    <div className="quick-grid">{QUICK_TITLES.map((title, index) => <button key={title} onClick={() => onChoose(title)}><small>0{index + 1}</small><strong>{title}</strong></button>)}</div>
  </>;
}

function SearchResults({ query, results, contract, filter, onChoose }: { query: string; results: NavSearchHit[]; contract: PublicContract; filter: FilterKey; onChoose(title: string): void }) {
  return <>
    {results.length === 0 ? <EmptyState title="가까운 곡을 찾지 못했습니다" copy="문장부호를 빼거나 제목의 앞부분만 입력해 보세요." /> :
      <div className="result-list tight">{results.map((result, index) => {
        const locations = locationsFor(contract, result.title, filter);
        const charts = chartLabels(contract.navIndex.chartsOf[result.title] ?? [], contract.navIndex.levelFold ?? {});
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
    { label: "카테고리", items: locations.filter((item) => (item.kind === "category" || item.kind === "channel") && item.sublabel !== "게임 모드") },
    { label: "모드", items: locations.filter((item) => item.sublabel === "게임 모드") },
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
          <strong>{location.kind === "level" ? location.label : location.label.replace(" 채널", "")}</strong>
          <span><b>{location.position}</b>/{location.total}</span>
        </button>)}</div>
      </div>)}</div>
      {active && <div className="neighbor-panel">
        <div className="neighbor-head"><span>기기에서 이렇게 보입니다</span><b>{active.label} · {FILTERS.find((item) => item.key === filter)?.label}</b></div>
        <div className="neighbor-strip">{neighbors.map((item) => <div key={`${item.position}:${item.title}`} className={item.current ? "current" : ""}><span>{item.position}</span><strong>{item.title}</strong><small>{item.current ? "찾는 곡" : item.side}</small></div>)}</div>
        <p className="wrap-note">첫 곡과 마지막 곡은 서로 이어집니다. 난이도존 1번은 RANDOM이고, 곡 위치는 기기 화면 번호 그대로 보여 드립니다.</p>
      </div>}
    </> : <EmptyState
      title={filter === "normal" ? "노말 이용 불가" : "이 조건에서는 이용 불가"}
      copy={filter === "normal" ? "이 곡은 프리미엄 크레딧에서만 고를 수 있습니다." : "현재 선택한 하트 조건에서는 이 곡을 고를 수 없습니다."}
    />}
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
  const original = (contract.navIndex.cats[title] ?? [])
    .filter((row) => row.tile === "ORIGINAL" && row.src)
    .map((row) => ({
      title, zone: "ORIGINAL", position: String(row.pos), grade: row.src ?? "",
      source: row.seen === "닻 밀림" ? "인접 확인 지점에서 계산한 위치" : "",
    }));
  return [...original, ...Object.values(contract.evidence).flat().filter((row) => row.title === title)].filter((row) => {
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
    </div>)}</div> : <p className="muted-box">이 곡의 공개 근거 설명은 아직 연결되지 않았습니다. 위치 번호와 근거 완성도는 별도로 관리됩니다.</p>}
  </section>;
}

function ZoneBrowser({ contract, filter, zone, setZone, onChoose }: { contract: PublicContract; filter: FilterKey; zone: ZoneSelection | null; setZone(value: ZoneSelection | null): void; onChoose(title: string): void }) {
  if (zone) {
    const rows = zoneRows(contract, zone, filter);
    const category = zone.kind === "category" ? categoryEntries(contract, zone.key, filter) : [];
    const categoryTotal = category.reduce((max, row) => Math.max(max, row.total), 0);
    const countLabel = categoryTotal > rows.length ? `${rows.length}곳 확인 · 전체 ${categoryTotal}칸` : contract.finder.modeRows?.[zone.key] ? `${rows.length}칸` : `${rows.length}곡`;
    return <div className="zone-detail"><button className="back-button" onClick={() => setZone(null)}><Icon name="back" /> 존 목록</button>
      <div className="section-heading"><div><span>{contract.finder.modeSongs?.[zone.key] || contract.finder.modeRows?.[zone.key] ? "MODE" : zone.kind.toUpperCase()}</span><h2>{zone.label}</h2></div><p>{countLabel} · {FILTERS.find((item) => item.key === filter)?.label}</p></div>
      {contract.finder.modeRows?.[zone.key] ? <div className="zone-song-list">{rows.map((row) => <div className="zone-row-static" key={`${row.position}:${row.title}`}><b>{row.position}</b><span>{row.title}</span></div>)}<p className="zone-note">곡은 매칭된 상대와 함께 정해져서 목록이 없습니다.</p></div> :
      <div className="zone-song-list">{rows.map((row) => <button key={`${row.position}:${row.title}`} onClick={() => onChoose(row.title)}><b>{row.position}</b><span>{row.title}</span></button>)}</div>}
    </div>;
  }
  const single = contract.finder.subs["DIFFICULTY ZONE SINGLE"] ?? [];
  const double = contract.finder.subs["DIFFICULTY ZONE DOUBLE"] ?? [];
  const numericSort = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));
  const categoryItems = contract.finder.tiles.flatMap((tile) => {
    const categoryRows = contract.finder.catSongs[tile.name];
    const mirroredCategory = contract.finder.categoryMirrors?.[tile.name];
    if ((categoryRows || mirroredCategory) && filter !== "onlyshort") {
      const entries = categoryEntries(contract, tile.name, filter);
      const total = entries.reduce((max, row) => Math.max(max, row.total), 0);
      return [{ key: tile.name, count: entries.length, countLabel: total > entries.length ? `${entries.length}/${total} 확인` : `${total}곡` }];
    }
    const modeKey = tile.name === "ONLINE MATCHING" ? "온라인 매칭" : "";
    const modeRows = modeKey ? contract.finder.modeRows?.[modeKey] : undefined;
    if (modeRows) return [{ key: modeKey, count: modeRows.length, countLabel: `${modeRows.length}칸` }];
    const channelKey = tile.ch.replace(/ 채널$/, "");
    const channelRows = contract.finder.channelSongs[channelKey];
    if (channelRows && channelAvailable(channelKey, filter)) return [{ key: channelKey, count: channelRows.length, countLabel: `${channelRows.length}곡` }];
    return [];
  });
  for (const [mode, list] of Object.entries(contract.finder.modeSongs ?? {})) categoryItems.push({ key: mode, count: list.length, countLabel: `${list.length}곡` });
  const isMode = (key: string) => Boolean(contract.finder.modeSongs?.[key] || contract.finder.modeRows?.[key]);
  const groups: Record<ZoneGroupKey, { title: string; color: string; items: Array<{ key: string; label?: string; count: number; countLabel?: string }>; choose(key: string): void }> = {
    single: { title: "싱글 난이도존", color: "mint", items: single.sort(numericSort).map((key) => ({ key, count: zoneRows(contract, { kind: "level", key, label: key }, filter).length, label: levelLabel(key, contract.navIndex.levelFold ?? {}) })), choose: (key) => setZone({ kind: "level", key, label: levelLabel(key, contract.navIndex.levelFold ?? {}) }) },
    double: { title: "더블 난이도존", color: "coral", items: double.sort(numericSort).map((key) => ({ key, count: zoneRows(contract, { kind: "level", key, label: key }, filter).length, label: levelLabel(key, contract.navIndex.levelFold ?? {}) })), choose: (key) => setZone({ kind: "level", key, label: levelLabel(key, contract.navIndex.levelFold ?? {}) }) },
    series: { title: "시리즈존", color: "gold", items: contract.finder.seriesOrder.map((key) => ({ key, count: zoneRows(contract, { kind: "series", key, label: key }, filter).length })), choose: (key) => setZone({ kind: "series", key, label: key }) },
    category: { title: "카테고리", color: "blue", items: categoryItems, choose: (key) => setZone((contract.finder.catSongs[key] || contract.finder.categoryMirrors?.[key]) ? { kind: "category", key, label: key } : { kind: "channel", key, label: isMode(key) ? key : `${key} 채널` }) },
  };
  const shown: ZoneGroupKey[] = ["single", "double", "series", "category"];   // 10-16 사용자 «위의 버튼 3개 없애고 그냥 하나로» — 탭 없이 한 화면에 차례로
  return <>
    <div className="section-heading"><div><span>ZONE BROWSER</span><h2>존으로 둘러보기</h2></div><p>기기에서 들어갈 메뉴를 먼저 골라도 됩니다.</p></div>
    {shown.map((key) => <ZoneGroup key={key} title={groups[key].title} color={groups[key].color} items={groups[key].items} choose={groups[key].choose} wide={key === "series" || key === "category"} hideCount />)}
  </>;
}

function zoneRows(contract: PublicContract, zone: ZoneSelection, filter: FilterKey) {
  const fake: LocationItem = { id: "", kind: zone.kind, label: zone.label, sublabel: "", position: 0, total: 0, listKey: zone.key };
  return listFor(contract, fake, filter);
}

function ZoneGroup({ title, color, items, choose, wide, hideCount }: { title: string; color: string; items: Array<{ key: string; count: number; countLabel?: string; label?: string }>; choose(key: string): void; wide?: boolean; hideCount?: boolean }) {
  return <section className="zone-group"><div className="zone-group-title"><span className={color}></span><h3>{title}</h3>{!hideCount && <small>{items.length}개</small>}</div>
    <div className={wide ? "zone-grid wide" : "zone-grid names"}>{items.map((item) => <button key={item.key} className={!wide && (item.label ?? item.key).length > 4 ? "span2" : undefined} onClick={() => choose(item.key)}><strong>{item.label ?? item.key}</strong>{!hideCount && <span>{item.countLabel ?? `${item.count}곡`}</span>}</button>)}</div>
  </section>;
}

function RecentView({ recent, onChoose, onClear }: { recent: string[]; onChoose(title: string): void; onClear(): void }) {
  return <><div className="section-heading"><div><span>ON THIS DEVICE</span><h2>최근 찾은 곡</h2></div>{recent.length > 0 && <button className="text-button" onClick={onClear}>기록 지우기</button>}</div>
    {recent.length ? <div className="result-list tight">{recent.map((title, index) => <button className="result-card" key={title} onClick={() => onChoose(title)}><span className="result-index">{String(index + 1).padStart(2, "0")}</span><span className="result-main"><strong>{title}</strong></span></button>)}</div> : <EmptyState title="아직 찾은 곡이 없습니다" copy="검색한 곡을 열면 이 기기에만 최근 기록이 남습니다." />}
  </>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: "search" | "zones" | "recent"; label: string; onClick(): void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><Icon name={icon} /><span>{label}</span></button>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><div>↗</div><h3>{title}</h3><p>{copy}</p></div>;
}

function LoadingState() {
  return <div className="state-screen"><div className="brand-mark"><span>↖</span><b>P</b><span>↗</span></div><div className="loader"></div><p>위치 데이터를 맞추고 있습니다…</p></div>;
}

function FatalState({ message }: { message: string }) {
  return <div className="state-screen error"><div className="brand-mark"><span>↖</span><b>!</b><span>↗</span></div><h1>데이터를 열지 못했습니다</h1><p>{message}</p><button onClick={() => location.reload()}>다시 불러오기</button></div>;
}
