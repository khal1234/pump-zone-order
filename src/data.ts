import type { CurrentPointer, PublicContract } from "./types";

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
    return { contract, state: "live" };
  } catch (error) {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) throw error;
    const contract = JSON.parse(cached) as PublicContract;
    validateContract(contract);
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
