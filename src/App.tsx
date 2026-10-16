import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadContract, type LoadState } from "./data";
import { FeedbackAdmin, FeedbackDialog } from "./Feedback";
import type {
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
  { key: "p_nofull", label: "프리미엄 · 풀송 제외", short: "풀송 제외" },
  { key: "p_nofullremix", label: "프리미엄 · 풀송·리믹스 제외", short: "둘 다 제외" },
  { key: "p_onlyshort", label: "프리미엄 · 숏컷만", short: "숏컷만" },
];
type CreditMode = "normal" | "premium";
type ZoneGroupKey = "single" | "double" | "series" | "category";
const MODE_MAX: Record<CreditMode, number> = { normal: 4, premium: 6 };
const CREDIT_KEY = "pump-zone-credit";
const HEARTS_KEY = "pump-zone-hearts";
const RECENT_KEY = "pump-zone-recent-v1";

function pos(set: PositionSet | undefined, filter: FilterKey): number | undefined {
  if (!set) return undefined;
  return set[filter];
}

// 프리미엄 하트 조건(p_*)도 채널 이용 가능 여부는 같은 하트의 노말 조건과 같다.
function baseFilter(filter: FilterKey): string {
  return filter.startsWith("p_") ? filter.slice(2) : filter;
}

function channelAvailable(kind: string, filter: FilterKey): boolean {
  if (kind === "숏컷") return true;
  if (kind === "리믹스") return baseFilter(filter) !== "nofullremix" && baseFilter(filter) !== "onlyshort";
  if (kind === "풀송") return filter === "all" || filter === "normal";
  return baseFilter(filter) !== "onlyshort";
}

function heartsToFilter(mode: CreditMode, hearts: number): FilterKey {
  if (hearts >= 4) return mode === "premium" ? "all" : "normal";
  // 10-16 사용자 «S19 프리미엄 3하트 총 152곡인데 왜 곡수가 안맞지» — 프리미엄은 하트가 줄어도 프리미엄 전용곡이 남는다.
  const premium = mode === "premium" ? "p_" : "";
  if (hearts === 3) return `${premium}nofull` as FilterKey;
  if (hearts === 2) return `${premium}nofullremix` as FilterKey;
  return `${premium}onlyshort` as FilterKey;
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
      if (mirrorZone === series.zone && baseFilter(filter) !== "onlyshort") {
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
  if (baseFilter(filter) !== "onlyshort") {
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
  rows.sort((a, b) => a.position - b.position);
  // 카테고리 번호는 프리미엄(전체 곡) 기준이다. 다른 하트 조건이면 그 조건에서 못 고르는 곡(시리즈 위치가 없는 곡)을 빼고 번호를 다시 센다.
  if (filter === "all") return rows;
  const kept = rows.filter((row) => {
    const series = contract.navIndex.series[row.title];
    return !series || pos(series.pos, filter) !== undefined;
  });
  return kept.map((row, index) => ({ ...row, position: index + 1, total: kept.length }));
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
  // 10-16 «새로고침해도 노말·프리미엄·하트 개수 유지» — 이 기기에만 기억한다.
  const [creditMode, setCreditMode] = useState<CreditMode>(() => {
    try { return localStorage.getItem(CREDIT_KEY) === "premium" ? "premium" : "normal"; } catch { return "normal"; }
  });
  const [hearts, setHearts] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(HEARTS_KEY));
      const max = MODE_MAX[localStorage.getItem(CREDIT_KEY) === "premium" ? "premium" : "normal"];
      return saved >= 1 && saved <= max ? saved : max;
    } catch { return MODE_MAX.normal; }
  });
  useEffect(() => {
    try { localStorage.setItem(CREDIT_KEY, creditMode); localStorage.setItem(HEARTS_KEY, String(hearts)); } catch { /* 저장 못 하는 브라우저면 기본값 */ }
  }, [creditMode, hearts]);
  const filter = heartsToFilter(creditMode, hearts);
  const [zone, setZone] = useState<ZoneSelection | null>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
  });
  const [light, setLight] = useState(() => localStorage.getItem("pump-zone-theme") === "light");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
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
        // 10-16 «새로고침 뜨는 게 아니라 강제 새로고침하면 안 돼? 굳이 유저한테 시킬 이유가 있나» — 알림 없이 바로 다시 불러온다.
        //   보던 곡은 주소(?song=)에, 크레딧·하트·싱글/더블은 기기 저장에 있어 그대로 이어진다(열어 둔 존 목록만 첫 화면으로).
        //   같은 새 판으로 30초 안에 또 다시 불러오지는 않는다 — 배포 직후 옛 화면이 한 번 더 오는 동안 되풀이 새로고침 방지.
        if ((v?.build && v.build !== __BUILD_ID__) || (c?.contentHash && c.contentHash !== contract!.contentHash)) {
          const target = `${v?.build ?? ""}|${c?.contentHash ?? ""}`;
          let last: { target?: string; at?: number } = {};
          try { last = JSON.parse(sessionStorage.getItem("pump-zone-reload") ?? "{}"); } catch { /* 없음 */ }
          if (last.target === target && Date.now() - (last.at ?? 0) < 30_000) return;
          try { sessionStorage.setItem("pump-zone-reload", JSON.stringify({ target, at: Date.now() })); } catch { /* 저장 못 해도 다시 불러온다 */ }
          location.reload();
        }
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
  const [returnZone, setReturnZone] = useState(false);
  // 10-16 «검색으로 들어가면 위치 좌우는 굳이 나올 필요 없어 · 존에서 눌러 들어가면 그 존과 관련시켜 좌우 곡» — 곡을 연 존
  const [songZone, setSongZone] = useState<ZoneSelection | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const pendingScroll = useRef<number | "first" | null>(null);
  const scrollTopNext = useRef(false);
  const pendingSongScroll = useRef<number | null>(null);
  useEffect(() => { history.scrollRestoration = "manual"; }, []);
  // 고정 검색 묶음 높이 — ResizeObserver 가 늦거나 안 도는 경우(숨은 탭)에도 그리기 직후 바로 맞춘다.
  useLayoutEffect(() => {
    const hero = document.querySelector<HTMLElement>(".hero");
    if (hero) document.documentElement.style.setProperty("--hero-h", `${hero.offsetHeight}px`);
  });
  // 10-16 «노말부터 곡 검색까지 고정 · 존은 돌아가기 버튼이랑 S1 까지» — 존 머리는 고정된 검색 묶음 바로 밑에 붙는다(그 높이를 잰다).
  useEffect(() => {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--hero-h", `${Math.ceil(hero.getBoundingClientRect().height)}px`));
    observer.observe(hero);
    return () => observer.disconnect();
  }, [contract]);
  useEffect(() => {
    if (pendingSongScroll.current !== null && selectedTitle) {
      window.scrollTo({ top: pendingSongScroll.current, behavior: "instant" });
      pendingSongScroll.current = null;
      return;
    }
    if (scrollTopNext.current) {
      scrollTopNext.current = false;
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    if (pendingScroll.current === null || !zone) return;
    const target = pendingScroll.current;
    pendingScroll.current = null;
    {
      let top = typeof target === "number" ? target : 0;
      // 10-16 «위에 번호로도 이동할 경우가 있어 … 스크롤을 위로 올려서 마지막 번호가 위에서도 보일 수 있게» —
      // 목록 뒤 절반을 위에 깔았으니, 처음 열 때는 첫 곡이 고정 머리 바로 밑에 오게 내려 둔다.
      if (target === "first") {
        const first = document.querySelector<HTMLElement>(".zone-song-list [data-first]");
        const head = document.querySelector<HTMLElement>(".zone-head");
        const hero = document.querySelector<HTMLElement>(".hero");
        // 10-16 «1번 위치가 처음에 들어갈 때 화면 상단에 있는데 중앙으로 · 위로 스크롤 해도 된다는거 인식할 수 있게» —
        // 고정 머리 밑 ~ 하단 메뉴 위 사이 가운데에 첫 곡을 둔다(위에 지난 번호들이 보인다).
        const headBottom = (hero?.offsetHeight ?? 0) + (head?.offsetHeight ?? 0);
        const navTop = document.querySelector<HTMLElement>(".bottom-nav")?.getBoundingClientRect().top ?? window.innerHeight;
        if (first) top = first.getBoundingClientRect().top + window.scrollY - (headBottom + (navTop - headBottom) / 2 - first.offsetHeight / 2);
      }
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    }
  }, [zone, tab, selectedTitle]);

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
      // 10-16 «존 목록에서 곡 누르고 뒤로가기 하면 존 목록으로» — 곡을 연 자리가 존이면 그 존과 목록 스크롤로 돌아간다.
      const back = history.state as { zone?: ZoneSelection; scroll?: number } | null;
      if (!title && back?.zone) {
        setQuery("");
        setTab("zones");
        setZone(back.zone);
        setReturnZone(false);
        pendingScroll.current = back.scroll ?? 0;
        return;
      }
      const searchBack = history.state as { origin?: string; query?: string } | null;
      if (!title && searchBack?.origin) {
        setQuery(searchBack.query ?? "");
        setTab("search");
        setZone(null);
        setReturnZone(false);
        scrollTopNext.current = true;
        return;
      }
      if (!title && (history.state as { tab?: string } | null)?.tab === "zones") {
        setQuery("");
        setTab("zones");
        setZone(null);
        scrollTopNext.current = true;
        return;
      }
      if (title) {
        setQuery(title);
        setTab("search");
        setZone(null);
        // 10-16 «S4 누르면 이동 후 본래로 돌아올 때 왜 스크롤 아래로 끌어당겨지냐» — 존 목록의 깊은 스크롤이 곡 화면에 남던 것.
        // 곡 화면을 떠날 때 적어 둔 자리(없으면 맨 위)로 돌린다.
        pendingSongScroll.current = (history.state as { songScroll?: number } | null)?.songScroll ?? 0;
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
    const fromZone = tab === "zones" && zone !== null;
    // 존에서 연 곡만 돌아갈 존을 기록한다 — 아니면 같은 기록 칸에 남은 옛 존으로 잘못 돌아간다.
    // 10-16 «최근 찾기 버튼 눌러 이동했으면 뒤로 가기 눌렀음 로비로 · 존 목록이랑 동일하게» — 검색 쪽도 연 자리(로비 / 입력한 결과)를 기록한다.
    const typed = tab === "search" && !selectedTitle && query.trim() ? query : "";
    history.replaceState(fromZone ? { zone, scroll: window.scrollY } : { origin: typed ? "results" : "lobby", query: typed }, "", location.href);
    setReturnZone(true);
    setSongZone(fromZone ? zone : null);
    setSelectedTitle(title);
    setQuery(title);
    setTab("search");
    setZone(null);
    const next = [title, ...recent.filter((item) => item !== title)].slice(0, 12);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    history.pushState(null, "", `?song=${encodeURIComponent(title)}`);
    // 10-16 «화면이 아래로 스크롤되네 … 맨 위로 스크롤 땡기는게 더 나아보이고» — 그린 뒤 맨 위로(아래 효과).
    scrollTopNext.current = true;
  }

  function clearSearch() {
    setQuery("");
    setSelectedTitle(null);
    history.replaceState(null, "", location.pathname);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  // 10-16 «S13 눌렀을 때 뒤로가기 해도 존으로 둘러보기가 안나오네» — 존을 여는 것도 기록 한 칸으로 쌓아 뒤로가기가 존 목록으로 온다.
  function openZone(next: ZoneSelection | null) {
    if (next) {
      history.replaceState({ tab: "zones" }, "", location.href);
      history.pushState({ zone: next, scroll: 0 }, "", location.href);
      pendingScroll.current = "first";
      setTab("zones");
      setZone(next);
      return;
    }
    if ((history.state as { zone?: ZoneSelection } | null)?.zone) history.back();
    else setZone(null);
  }

  // 10-16 «버튼 눌리는거 불 안 들어오게 · 버튼 누르면 그 레벨대 곡 목록으로 · 시리즈존 누르면 시리즈 존 가고» —
  // 곡 화면의 위치 단추는 그 존 목록을 연다. 곡 화면은 기록에 남아 뒤로가기로 돌아온다.
  function openZoneFromSong(next: ZoneSelection) {
    history.replaceState({ ...(history.state ?? {}), songScroll: window.scrollY }, "", location.href);
    history.pushState({ zone: next, scroll: 0 }, "", location.pathname);
    pendingScroll.current = "first";
    setSelectedTitle(null);
    setQuery("");
    setTab("zones");
    setZone(next);
  }

  // 안내 예시 곡 — 싱글 난이도존에 여러 번 나오는 곡(노스텔지어: S3·S5·S8 …)
  const TOUR_SONG = "노스텔지어";
  function tourHome() { goHome(); scrollTopNext.current = false; }
  function tourSteps(): TourStep[] {
    const songZone = (): ZoneSelection | null => {
      const first = locationsFor(contract!, TOUR_SONG, filter).find((item) => item.kind === "level");
      return first ? { kind: first.kind, key: first.listKey, label: first.label } : null;
    };
    // 10-16 «노스텔지어 예를 들 거면 실제 있는 걸 가지고 하던가 S3을 하지 왜 없는 S4를 하지» — 예시 곡의 실제 첫 존 이름을 쓴다
    // 같은 사용자 «그리고 S3(S4)만 가리켜» — ⑤ 는 상자 전체가 아니라 그 단추 하나만 밝힌다(첫 단추 = 예시 곡의 첫 싱글 존).
    const exampleZone = songZone()?.label ?? "S3";
    return [
      { target: ".mode-control", title: "① 크레딧 종류", body: "누를 때마다 노말 ↔ 프리미엄이 바뀝니다. 프리미엄에서만 나오는 곡까지 번호가 맞춰집니다.", do: () => tourHome() },
      { target: ".heart-buttons", title: "② 남은 하트", body: "지금 남은 하트를 누르세요. 하트가 줄면 풀송·리믹스가 빠져 기기 번호가 달라지는 것까지 맞춰 보여 드립니다. 오른쪽 숫자를 누르면 가득 찹니다." },
      { target: ".search-box", title: "③ 곡 검색", body: "곡 이름을 칩니다. (예: 노스텔지어)", do: () => tourHome() },
      { target: ".content.searching button", title: "④ 검색 결과", body: "결과에서 곡을 누르면 그 곡이 있는 모든 존이 나옵니다.", do: () => { setSelectedTitle(null); setTab("search"); setQuery(TOUR_SONG); } },
      { target: ".route-options button", title: "⑤ 곡이 있는 자리", body: `싱글·더블 난이도존, 시리즈존, 카테고리별 기기 번호입니다. ${exampleZone} 같은 단추를 누르면 그 존 목록으로 갑니다.`, do: () => { setZone(null); setTab("search"); setQuery(TOUR_SONG); setSelectedTitle(TOUR_SONG); } },  // 최근 찾기에 남기지 않게 chooseTitle 을 안 쓴다
      { target: () => { const rows = [...document.querySelectorAll(".zone-song-list button")].filter((row) => row.querySelector("span")?.textContent === TOUR_SONG); return rows[Math.floor(rows.length / 2)] ?? null; }, title: "⑥ 존 목록", body: "기기 화면 번호 그대로 곡 순서가 나옵니다. 위로 올리면 마지막 번호부터 이어집니다. 뒤로가기나 「존 목록」으로 돌아갑니다.", do: () => { const z = songZone(); if (z) { setSelectedTitle(TOUR_SONG); openZoneFromSong(z); pendingScroll.current = null; } } },
      { target: ".side-toggle", title: "⑦ 싱글 / 더블", body: "첫 화면의 난이도존 목록을 싱글과 더블 사이에서 바꿉니다.", do: () => tourHome() },
      { target: ".zone-grid", title: "⑧ 존 바로 고르기", body: "곡을 몰라도 존을 바로 눌러 순서를 볼 수 있습니다." },
      { target: ".recent-strip", title: "⑨ 최근 찾기", body: "최근에 본 곡이 여기 남습니다. 누르면 바로 그 곡으로 갑니다." },
      { target: "button.brand", title: "⑩ 처음으로", body: "어디서든 왼쪽 위 로고를 누르면 이 첫 화면으로 돌아옵니다." },
    ];
  }

  function goHome() {
    history.pushState(null, "", location.pathname);
    setQuery("");
    setSelectedTitle(null);
    setZone(null);
    setTab("search");
    scrollTopNext.current = true;
  }

  function changeTab(next: TabKey) {
    setTab(next);
    setSelectedTitle(null);
    setZone(null);
    if (next !== "search") clearSongFromUrl();
    // 10-16 «검색 누르면 키보드 뜨는거 안뜨게» — 탭 전환은 입력칸에 초점을 주지 않는다(입력은 사용자가 칸을 누를 때만).
  }

  if (error) return <FatalState message={error} />;
  if (!contract) return <LoadingState />;

  return (
    <div className={tab === "zones" && zone ? "app-shell zone-open" : "app-shell"}>
      <header className="topbar">
        {/* 10-16 «5key 생각하면 저거(로고) 눌러서 가는게 맞겠다» — 왼쪽 위 로고를 누르면 첫 화면 */}
        <button className="brand" onClick={goHome} aria-label="첫 화면으로">
          <div className="brand-mark" aria-hidden="true"><span>↖</span><b>P</b><span>↗</span></div>
          <div><strong>ZONE FINDER</strong><small>{contract.game.contentThrough}</small></div>
        </button>
        {/* 10-16 «존 파인더 우측에 ? 누르면 가이드 · 버튼 어떤 순서대로 누르면 어떻게 동작하는지 하이라이트 느낌으로 순차적으로» */}
        <button className="help-button" onClick={() => { tourHome(); setTourOpen(true); }} aria-label="사용 안내">?</button>
        <div className="top-actions">
          <div className={`sync-pill ${loadState === "cached" ? "cached" : ""}`}>
            <span></span>{loadState === "cached" ? "오프라인 저장본" : "데이터 연결됨"}
          </div>
          {/* 10-16 «맨 아래 PHOENIX 2·계약·총 곡수 필요없잖아 / 익명 건의 관리는 맨 우측 상단 다크 모드 왼쪽에 약간 띄워서» */}
          <div className="top-links"><button onClick={() => setFeedbackOpen(true)}>익명 건의</button></div>
          <button className="icon-button" onClick={() => setLight((value) => !value)} aria-label={light ? "어두운 테마" : "밝은 테마"}>
            <Icon name={light ? "moon" : "sun"} />
          </button>
        </div>
      </header>

      {tourOpen && <Tour steps={tourSteps()} onClose={() => { setTourOpen(false); goHome(); }} />}
      {loadState === "cached" && <div className="offline-banner">네트워크에 연결되지 않아 마지막으로 검증한 저장 데이터를 보여 드립니다.</div>}

      <main>
        <section className="hero">
                    <CreditControl mode={creditMode} hearts={hearts} filter={filter} onModeChange={(next) => { setCreditMode(next); setHearts(MODE_MAX[next]); }} onHeartsChange={setHearts} />
          <SearchBox ref={searchRef} query={query} setQuery={updateQuery} clear={clearSearch} />
        </section>

        <section className={tab === "search" && query.trim() && !selectedTitle ? "content searching" : "content"} aria-live="polite">
          {tab === "search" && selectedTitle && <SongDetail contract={contract} title={selectedTitle} filter={filter} onOpenZone={openZoneFromSong} fromZone={songZone} onBack={() => { if (returnZone) { history.back(); return; } setSelectedTitle(null); clearSongFromUrl(); }} />}
          {tab === "search" && !selectedTitle && query.trim() && <SearchResults query={query} results={results} contract={contract} filter={filter} onChoose={chooseTitle} />}
          {/* 10-16 «존목록 검색 둘 말고 하나로 합쳐 · 빠른 시작 다 빼고 · 최근 찾기를 맨 밑에» — 첫 화면 = 검색칸 밑에 존 목록, 맨 밑에 최근 찾기 */}
          {!selectedTitle && !query.trim() && (tab === "search" || (tab === "zones" && !zone)) && <>
            <ZoneBrowser contract={contract} filter={filter} zone={null} setZone={openZone} onChoose={chooseTitle} />
            <SearchLanding onChoose={chooseTitle} recent={recent} onMore={() => changeTab("recent")} />
          </>}
          {tab === "zones" && zone && <ZoneBrowser contract={contract} filter={filter} zone={zone} setZone={openZone} onChoose={chooseTitle} />}
          {tab === "recent" && <RecentView recent={recent} onChoose={chooseTitle} onClear={() => { setRecent([]); localStorage.removeItem(RECENT_KEY); }} />}
        </section>
      </main>
      {/* 10-16 «관리는 내가 필요한거니 유저가 잘 안보일 수 있게 맨 아래 하단으로» */}
      <footer className="admin-foot"><button onClick={openAdmin}>관리</button></footer>

      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {adminOpen && <FeedbackAdmin onClose={closeAdmin} />}
    </div>
  );
}

const SearchBox = forwardRef<HTMLInputElement, { query: string; setQuery(value: string): void; clear(): void }>(function SearchBox({ query, setQuery, clear }, ref) {
  return <form className="search-box" role="search" onSubmit={(event) => { event.preventDefault(); (event.currentTarget.querySelector("input") as HTMLInputElement | null)?.blur(); }}>
    <Icon name="search" />
    <input ref={ref} type="search" name="song-search" inputMode="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="곡 이름을 입력하세요" aria-label="곡 이름 검색" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true" />
    {query && <button onClick={clear} aria-label="검색어 지우기"><Icon name="close" /></button>}
    <kbd>⌘ K</kbd>
  </form>;
});

function CreditControl({ mode, hearts, filter, onModeChange, onHeartsChange }: { mode: CreditMode; hearts: number; filter: FilterKey; onModeChange(value: CreditMode): void; onHeartsChange(value: number): void }) {
  const max = MODE_MAX[mode];
  return <div className="credit-control">
    {/* 10-16 «노말/프리미엄 하나로 버튼 합치고 토글형으로 한번 누르면 다른 한쪽만 불 들어오게» */}
    <div className="mode-control single" aria-label="크레딧 종류">
      {/* 10-16 «노말/프리미엄 둘 다 하되 누른쪽만 불 들어오게 · 버튼은 1개로만» — 한 버튼 안에 두 칸, 누르면 반대쪽에 불 */}
      <button className={`duo ${mode === "normal" ? "first" : "second"}`} onClick={() => onModeChange(mode === "normal" ? "premium" : "normal")} aria-label={`지금 ${mode === "normal" ? "노말" : "프리미엄"} — 눌러서 바꾸기`}><span className={mode === "normal" ? "on" : ""}>노말</span><span className={mode === "premium" ? "on" : ""}>프리미엄</span></button>
    </div>
    <div className="heart-control">
      <span className="heart-title">남은 하트</span>
      <div className="heart-buttons" role="group" aria-label={`남은 하트 ${hearts}개`}>
        {/* 10-16 «노말도 하트 공간 자체는 6개 · 5, 6 눌러도 4개만 차게 · 옆에 /4 는 그대로» — 칸은 늘 6, 채우기는 그 크레딧 최대까지 */}
        {Array.from({ length: MODE_MAX.premium }, (_, index) => index + 1).map((value) => <button key={value} className={`${value <= hearts ? "filled" : ""}${value > max ? " locked" : ""}`} onClick={() => onHeartsChange(Math.min(value, max))} aria-label={`하트 ${Math.min(value, max)}개로 설정`} aria-pressed={value === hearts}>♥</button>)}
      </div>
      {/* 10-16 «초기화는 말고 그냥 하트 수 누르는게 나을 듯» — 3/6 을 누르면 가득 채운다 */}
      <button className="heart-count" onClick={() => onHeartsChange(max)} aria-label="하트 가득 채우기">{hearts}/{max}</button>
    </div>
  </div>;
}

const RECENT_SHOWN = 5;   // 검색 밑에 바로 보이는 최근 기록 수 — 폰 한 화면에 두 줄 안쪽

function SearchLanding({ onChoose, recent, onMore }: { onChoose(title: string): void; recent: string[]; onMore(): void }) {
  // 최근 찾기는 검색 바로 밑에 RECENT_SHOWN 개 — 더 있으면 «더보기» 로 전체 목록(10-16 사용자 «최근 찾기 날리고 검색 바로 밑에 … 더보기 같이 버튼 눌러서 이동»)
  return <>
    {recent.length > 0 && <div className="recent-strip"><div className="recent-head"><b>최근 찾기</b>{recent.length > RECENT_SHOWN && <button className="text-button" onClick={onMore}>더보기</button>}</div>
      <div className="recent-chips">{recent.slice(0, RECENT_SHOWN).map((title) => <button key={title} onClick={() => onChoose(title)}>{title}</button>)}</div></div>}
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
          {/* 10-16 «우측에 숫자 말고 시리즈랑 곡 위치만 · 총 곡수 말고 · 길이가 안 되면 2줄도 돼» */}
          {(() => { const series = locations.find((item) => item.kind === "series"); return <span className="result-route series">{series ? <><small>{series.label}</small><b>{series.position}</b></> : <small>위치 확인</small>}</span>; })()}
          <span className="arrow">→</span>
        </button>;
      })}</div>}
  </>;
}

function SongDetail({ contract, title, filter, onBack, onOpenZone, fromZone }: { contract: PublicContract; title: string; filter: FilterKey; onBack(): void; onOpenZone(zone: ZoneSelection): void; fromZone: ZoneSelection | null }) {
  const locations = locationsFor(contract, title, filter);
  const basis = fromZone ? locations.find((item) => item.kind === fromZone.kind && item.listKey === fromZone.key) : undefined;
  const neighbors = basis ? neighborTriplet(contract, basis, title, filter) : [];
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
    {/* 10-16 «결과로 공유도 스크롤 내리면 위에 고정 · piu-644 이건 왜 띄우는거야» — 버튼·곡 이름 한 줄을 검색 묶음 밑에 고정, 곡 번호는 뺀다 */}
    {/* 10-16 «14 15 16 찾는 곡 줄 빼 · 위아래 여백 최대한 줄이고 · 결과로 밑에 위치 · 그 밑에 싱글 더블» */}
    <div className="detail-head">
      <div className="detail-bar"><button className="back-button" onClick={onBack}><Icon name="back" /> 결과로</button><button className="share-button" onClick={() => void share()}><Icon name="share" /> 공유</button></div>
      <h2>{title}</h2>
    </div>
    {locations.length ? <>
      {/* 10-16 «14 15 16 을 빼라는거지 · 앞곡 뒷곡 나오는거 목록 빼라는건 아닌데 · 싱글 바로 위에» — 번호·«찾는 곡» 줄 없이 곡 이름만 */}
      {/* 10-16 «어떤거 기준으로 아포칼립스 앞이 추격인진 모르네 · 곡 이름 바로 밑 가운데에» — 앞뒤 곡의 기준 존·번호 */}
      {basis && neighbors.length > 0 && <p className="neighbor-basis">{basis.label} {basis.position}번 기준</p>}
      {neighbors.length > 0 && <div className="neighbor-strip compact">{neighbors.map((item) => <div key={`${item.position}:${item.title}`} className={item.current ? "current" : ""}><strong>{item.title}</strong></div>)}</div>}
      <div className="route-groups">{routeGroups.map((group) => <div className="route-row" key={group.label}>
        <h3>{group.label}</h3>
        <div className="route-options">{group.items.map((location) => <button key={location.id} onClick={() => onOpenZone({ kind: location.kind, key: location.listKey, label: location.label })}>
          <strong>{location.kind === "level" ? location.label : location.label.replace(" 채널", "")}</strong>
          <span><b>{location.position}</b>/{location.total}</span>
        </button>)}</div>
      </div>)}</div>
    </> : <EmptyState
      title={filter === "normal" ? "노말 이용 불가" : "이 조건에서는 이용 불가"}
      copy={filter === "normal" ? "이 곡은 프리미엄 크레딧에서만 고를 수 있습니다." : "현재 선택한 하트 조건에서는 이 곡을 고를 수 없습니다."}
    />}
    {/* 10-16 «위치 근거는 유저들한테 중요하지 않아 빼» */}
  </article>;
}

function ZoneBrowser({ contract, filter, zone, setZone, onChoose }: { contract: PublicContract; filter: FilterKey; zone: ZoneSelection | null; setZone(value: ZoneSelection | null): void; onChoose(title: string): void }) {
  // 10-16 «싱글 더블 난이도존은 버튼 눌러서 둘중 어떤거 뜰지로 · S1 이런게 그대로 D1로 바뀌면 되니까» — 이 기기에 기억한다.
  const [side, setSide] = useState<"single" | "double">(() => {
    try { return localStorage.getItem("pump-zone-side") === "double" ? "double" : "single"; } catch { return "single"; }
  });
  function pickSide(next: "single" | "double") {
    setSide(next);
    try { localStorage.setItem("pump-zone-side", next); } catch { /* 저장 못 해도 화면은 바뀐다 */ }
  }
  // 10-16 «시리즈존 카테고리는 4열로 · 가로 넘치면 글자 가로 폭 맞춤» — 칸보다 긴 이름만 가로로 줄인다(높이는 그대로).
  useLayoutEffect(() => {
    function fit() {
      for (const label of document.querySelectorAll<HTMLElement>(".zone-grid.wide strong")) {
        label.style.transform = "";
        const room = (label.parentElement?.clientWidth ?? 0) - 8;
        if (room > 0 && label.scrollWidth > room) label.style.transform = `scaleX(${room / label.scrollWidth})`;
      }
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });
  if (zone) {
    const rows = zoneRows(contract, zone, filter);
    const category = zone.kind === "category" ? categoryEntries(contract, zone.key, filter) : [];
    const categoryTotal = category.reduce((max, row) => Math.max(max, row.total), 0);
    const countLabel = categoryTotal > rows.length ? `${rows.length}곳 확인 · 전체 ${categoryTotal}칸` : contract.finder.modeRows?.[zone.key] ? `${rows.length}칸` : `${rows.length}곡`;
    return <div className="zone-detail"><div className="zone-head"><button className="back-button" onClick={() => setZone(null)}><Icon name="back" /> 존 목록</button>
      {/* 10-16 «124곡 · 프리미엄 전체 곡 이거 빼고 S20을 level 옆에 붙이고 level 을 존 목록 버튼 약간 옆으로» — 한 줄 머리 */}
      <div className="zone-title" title={`${countLabel} · ${FILTERS.find((item) => item.key === filter)?.label}`}>{/* 10-16 «LEVEL 빼고 S8만 · SERIES·CATEGORY 도 빼고» */}<h2>{zone.label}</h2></div></div>
      {contract.finder.modeRows?.[zone.key] ? <div className="zone-song-list">{rows.map((row) => <div className="zone-row-static" key={`${row.position}:${row.title}`}><b>{row.position}</b><span>{row.title}</span></div>)}<p className="zone-note">곡은 매칭된 상대와 함께 정해져서 목록이 없습니다.</p></div> :
      // 10-16 «무한 스크롤 하니까 오히려 불편하네 · 위아래로 1세트씩 · 1 바로 위에 xx 후 1까지» — 목록을 위·가운데·아래 세 벌만 깔고
      // 가운데 벌 첫 곡에서 시작한다. 위로 올리면 마지막 번호부터 거꾸로, 아래로 내리면 한 바퀴 더 나오고 끝난다.
      <div className="zone-song-list">{[0, 1, 2].flatMap((copy) => rows.map((row, i) => <button key={`${copy}:${row.position}:${row.title}`} data-first={copy === 1 && i === 0 ? "" : undefined} onClick={() => onChoose(row.title)}><b>{row.position}</b><span>{row.title}</span></button>))}</div>}
    </div>;
  }
  const single = contract.finder.subs["DIFFICULTY ZONE SINGLE"] ?? [];
  const double = contract.finder.subs["DIFFICULTY ZONE DOUBLE"] ?? [];
  const numericSort = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));
  const categoryItems = contract.finder.tiles.flatMap((tile) => {
    const categoryRows = contract.finder.catSongs[tile.name];
    const mirroredCategory = contract.finder.categoryMirrors?.[tile.name];
    if ((categoryRows || mirroredCategory) && baseFilter(filter) !== "onlyshort") {
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
  const shown: ZoneGroupKey[] = [side, "series", "category"];   // 10-16 사용자 «위의 버튼 3개 없애고 그냥 하나로» — 탭 없이 한 화면에 차례로
  // 10-16 «싱글/더블로 여기도 토글형으로» — 버튼 하나, 누르면 다른 쪽
  const sideToggle = <div className="side-toggle"><button className={`duo ${side === "single" ? "first" : "second"}`} onClick={() => pickSide(side === "single" ? "double" : "single")}><span className={side === "single" ? "on" : ""}>싱글</span><span className={side === "double" ? "on" : ""}>더블</span></button></div>;
  return <>
    {shown.map((key) => <ZoneGroup key={key} title={key === side ? "난이도존" : groups[key].title} color={groups[key].color} items={groups[key].items} choose={groups[key].choose} wide={key === "series" || key === "category"} hideCount extra={key === side ? sideToggle : undefined} />)}
  </>;
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

function zoneRows(contract: PublicContract, zone: ZoneSelection, filter: FilterKey) {
  const fake: LocationItem = { id: "", kind: zone.kind, label: zone.label, sublabel: "", position: 0, total: 0, listKey: zone.key };
  return listFor(contract, fake, filter);
}

function ZoneGroup({ title, color, items, choose, wide, hideCount, extra }: { title: string; color: string; items: Array<{ key: string; count: number; countLabel?: string; label?: string }>; choose(key: string): void; wide?: boolean; hideCount?: boolean; extra?: React.ReactNode }) {
  return <section className="zone-group"><div className="zone-group-title"><span className={color}></span><h3>{title}</h3>{extra}{!hideCount && <small>{items.length}개</small>}</div>
    <div className={wide ? "zone-grid wide" : "zone-grid names"}>{items.map((item) => <button key={item.key} className={!wide && (item.label ?? item.key).length > 4 ? "span2" : undefined} onClick={() => choose(item.key)}><strong>{item.label ?? item.key}</strong>{!hideCount && <span>{item.countLabel ?? `${item.count}곡`}</span>}</button>)}</div>
  </section>;
}

function RecentView({ recent, onChoose, onClear }: { recent: string[]; onChoose(title: string): void; onClear(): void }) {
  return <><div className="section-heading"><div><span>ON THIS DEVICE</span><h2>최근 찾은 곡</h2></div>{recent.length > 0 && <button className="text-button" onClick={onClear}>기록 지우기</button>}</div>
    {recent.length ? <div className="result-list tight">{recent.map((title, index) => <button className="result-card" key={title} onClick={() => onChoose(title)}><span className="result-index">{String(index + 1).padStart(2, "0")}</span><span className="result-main"><strong>{title}</strong></span></button>)}</div> : <EmptyState title="아직 찾은 곡이 없습니다" copy="검색한 곡을 열면 이 기기에만 최근 기록이 남습니다." />}
  </>;
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

// 사용 안내 — 실제로 누르는 순서대로 화면을 움직이며 하나씩 밝혀 보여 준다.
//   10-16 «검색 후에 곡 누르는 거랑 곡 눌러서 S4 누르면 이동되는 거까지도» — 단계마다 할 일(do)을 먼저 하고, 그린 뒤 목표를 찾는다.
//   목표가 없으면(예: 최근 찾기가 빈 사람) 그 단계는 건너뛴다.
type TourStep = { target: string | (() => Element | null); title: string; body: string; do?: () => void };

function Tour({ steps, onClose }: { steps: TourStep[]; onClose(): void }) {
  // 10-16 «닫았다 여는 그거 자체를 못 없애? 왜 의도적으로 틈을 만드는지 · 이동된 걸로 화면 확 바뀌어도 되잖아» —
  //   단계의 할 일(do)은 «다음» 을 누른 그 순간에 하고, 화면이 그려진 직후·칠하기 전(layout effect)에 재서 같은 장면에 띄운다.
  //   숨기는 틈도, 움직이는 효과도 없다. 앱 쪽 «맨 위로/첫 곡으로» 스크롤 예약은 안내가 지운다(do 안에서).
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[index];
  useEffect(() => {
    const block = (event: Event) => { if (!(event.target as Element)?.closest?.(".tour-card")) event.preventDefault(); };
    window.addEventListener("touchmove", block, { passive: false });
    window.addEventListener("wheel", block, { passive: false });
    return () => { window.removeEventListener("touchmove", block); window.removeEventListener("wheel", block); };
  }, []);
  function go(next: number, dir: number) {
    // 목표가 없는 단계(최근 찾기가 빈 사람 등)는 건너뛴다 — 할 일을 해 봐야 알 수 있는 것은 그린 뒤 다시 본다
    if (next < 0 || next >= steps.length) { onClose(); return; }
    steps[next].do?.();
    setIndex(next);
    setDirRef.current = dir;
  }
  const setDirRef = useRef(1);
  useLayoutEffect(() => {
    if (!step) return;
    const el = typeof step.target === "string" ? document.querySelector(step.target) : step.target();
    if (!el) { go(index + setDirRef.current, setDirRef.current); return; }
    const r = el.getBoundingClientRect();
    const headBottom = Math.max(0, ...[".hero", ".zone-head", ".detail-head"].map((sel) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0));
    if (r.top < headBottom || r.bottom > window.innerHeight - 200) {
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - headBottom - 12), behavior: "instant" });
    }
    setRect(el.getBoundingClientRect());
  }, [index]);
  if (!step || !rect) return null;
  const last = index === steps.length - 1;
  const pad = 6;
  const below = rect.bottom + 190 < window.innerHeight;
  return <div className="tour" role="dialog" aria-label="사용 안내">
    <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
    <div className="tour-card" style={below ? { top: rect.bottom + pad + 10 } : { top: Math.max(8, rect.top - pad - 10 - 170) }}>
      <small>{index + 1} / {steps.length}</small>
      <b>{step.title}</b>
      <p>{step.body}</p>
      <div className="tour-actions">
        <button onClick={onClose}>닫기</button>
        {index > 0 && <button onClick={() => go(index - 1, -1)}>이전</button>}
        <button className="primary" onClick={() => (last ? onClose() : go(index + 1, 1))}>{last ? "끝" : "다음"}</button>
      </div>
    </div>
  </div>;
}
