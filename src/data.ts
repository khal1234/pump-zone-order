import type { CurrentPointer, FinderEntry, PositionSet, PublicContract } from "./types";

// 프리미엄 하트 3·2·1 위치 — 자료의 nofull 등은 노말 기준(프리미엄 전용곡 없음)이라, 전체 곡 순서에서 다시 센다.
// 프리미엄 전용곡(all 만 있고 normal 이 없는 곡)은 일반(아케이드) 곡으로 본다: 풀송·리믹스 제외에는 남고 숏컷만에는 빠진다.
// 못 보는 것: 프리미엄 전용 숏컷·풀송이 생기면 이 가정이 틀린다.
const PREMIUM_FILTERS = [["p_nofull", "nofull"], ["p_nofullremix", "nofullremix"], ["p_onlyshort", "onlyshort"]] as const;

function premiumKeeps(f: PositionSet, base: "nofull" | "nofullremix" | "onlyshort"): boolean {
  if (f[base] !== undefined) return true;
  return f.all !== undefined && f.normal === undefined && base !== "onlyshort";
}

function addPremiumList(entries: FinderEntry[], total: PositionSet | undefined): void {
  const sorted = entries.filter((e) => e.f.all !== undefined).sort((a, b) => a.f.all! - b.f.all!);
  for (const [key, base] of PREMIUM_FILTERS) {
    let dropped = 0;
    for (const e of sorted) {
      if (premiumKeeps(e.f, base)) e.f[key] = e.f.all! - dropped;
      else dropped += 1;
    }
    if (total?.all !== undefined) total[key] = total.all - dropped;
  }
}

function copyPremium(from: PositionSet | undefined, to: PositionSet | undefined): void {
  if (!from || !to) return;
  for (const [key] of PREMIUM_FILTERS) if (from[key] !== undefined) to[key] = from[key];
}

function addPremiumPositions(contract: PublicContract): void {
  const { finder, navIndex } = contract;
  for (const [lvl, entries] of Object.entries(finder.levelSongs)) {
    addPremiumList(entries, finder.levelTotals[lvl]);
    copyPremium(finder.levelTotals[lvl], navIndex.levelTotals[lvl]);
  }
  for (const [zone, entries] of Object.entries(finder.seriesSongs)) {
    addPremiumList(entries, finder.seriesTotals[zone]);
    copyPremium(finder.seriesTotals[zone], navIndex.seriesTotals[zone]);
  }
  for (const [key, set] of Object.entries(navIndex.levels)) {
    const [title, lvl] = [key.slice(0, key.lastIndexOf("|")), key.slice(key.lastIndexOf("|") + 1)];
    const list = finder.levelSongs[navIndex.levelFold?.[lvl] ?? lvl] ?? finder.levelSongs[lvl];
    copyPremium(list?.find((e) => e.t === title)?.f, set);
  }
  for (const [title, info] of Object.entries(navIndex.series)) {
    copyPremium(finder.seriesSongs[info.zone]?.find((e) => e.t === title)?.f, info.pos);
  }
}

const CACHE_KEY = "pump-zone-contract-v1";

export type LoadState = "live" | "cached";

export async function loadContract(): Promise<{ contract: PublicContract; state: LoadState }> {
  try {
    const pointerResponse = await fetch("/data/current.json", { cache: "no-store" });
    if (!pointerResponse.ok) throw new Error(`current.json ${pointerResponse.status}`);
    const pointer = (await pointerResponse.json()) as CurrentPointer;
    if (pointer.schemaVersion !== 1 || !pointer.dataUrl || !pointer.contentHash) {
      throw new Error("지원하지 않는 데이터 포인터");
    }
    const dataResponse = await fetch(pointer.dataUrl, { cache: "no-store" });
    if (!dataResponse.ok) throw new Error(`contract ${dataResponse.status}`);
    const contract = (await dataResponse.json()) as PublicContract;
    validateContract(contract, pointer);
    localStorage.setItem(CACHE_KEY, JSON.stringify(contract));
    addPremiumPositions(contract);
    return { contract, state: "live" };
  } catch (error) {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) throw error;
    const contract = JSON.parse(cached) as PublicContract;
    validateContract(contract);
    addPremiumPositions(contract);
    return { contract, state: "cached" };
  }
}

function validateContract(contract: PublicContract, pointer?: CurrentPointer): void {
  if (contract.schemaVersion !== 1) throw new Error("지원하지 않는 데이터 버전");
  if (!contract.contentHash || !contract.songs?.length || !contract.navIndex || !contract.finder) {
    throw new Error("위치 데이터가 불완전함");
  }
  if (pointer && contract.contentHash !== pointer.contentHash) {
    throw new Error("데이터 버전이 서로 다름");
  }
  if (!window.NAV_SEARCH || window.NAV_SEARCH.schemaVersion !== contract.search.schemaVersion) {
    throw new Error("검색 모듈 버전이 데이터와 다름");
  }
}
