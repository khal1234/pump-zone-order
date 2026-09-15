import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const pointer = JSON.parse(await readFile(resolve("public/data/current.json"), "utf8"));
const contractPath = resolve("public", pointer.dataUrl.replace(/^\//, ""));
const contractText = (await readFile(contractPath, "utf8")).trimEnd();
const contract = JSON.parse(contractText);
const searchBytes = await readFile(resolve("public/data/nav_search.js"));
const appSource = await readFile(resolve("src/App.tsx"), "utf8");
const dataSource = await readFile(resolve("src/data.ts"), "utf8");
const feedbackSource = await readFile(resolve("src/Feedback.tsx"), "utf8");
const reminderSource = await readFile(resolve("api/suggestion-reminder.js"), "utf8");

const checks = [];
const check = (name, condition) => {
  if (!condition) throw new Error(`FAIL ${name}`);
  checks.push(name);
};
check("pointer and contract schema", pointer.schemaVersion === 1 && contract.schemaVersion === 1);
check("pointer hash matches contract", pointer.contentHash === contract.contentHash);
const bodyText = contractText.replace(/^\{"contentHash":"[0-9a-f]{64}",/, "{");
check("contentHash covers canonical body", bodyText !== contractText && sha(Buffer.from(bodyText)) === contract.contentHash);
check("shared search hash", sha(searchBytes) === contract.search.sha256);
check("all song IDs are unique", contract.songs.length === new Set(contract.songs.map((song) => song.id)).size);
check("all song titles are unique", contract.songs.length === new Set(contract.songs.map((song) => song.title)).size);
check("site consumes common search", appSource.includes("NAV_SEARCH.rankTitles") && !appSource.includes("function normalize"));
check("offline cache is explicit", dataSource.includes('state: "cached"') && appSource.includes("오프라인 저장본"));
check("no personal/local markers", !/c:\\users|d:\\xsanity|play_history|my_records|credential/i.test(JSON.stringify(contract)));
const s17 = contract.finder.levelSongs.S17;
check("level positions preserve RANDOM slot", s17[0].f.all === 2 && contract.navIndex.levelTotals.S17.all === Math.max(...s17.map((row) => row.f.all)));
check("UI explains screen number convention", appSource.includes("난이도존 1번은 RANDOM") && appSource.includes("기기 화면 번호 그대로"));
check("default credit is normal four hearts", appSource.includes('useState<CreditMode>("normal")') && appSource.includes("useState(MODE_MAX.normal)"));
check("hearts derive available song filter", appSource.includes('if (hearts >= 4) return mode === "premium" ? "all" : "normal"') && appSource.includes('if (hearts === 3) return "nofull"') && appSource.includes('return "onlyshort"'));
check("zone and song routes use compact groups", appSource.includes('className="zone-tabs"') && appSource.includes('className="route-groups"') && appSource.includes('{ label: "싱글"') && appSource.includes('{ label: "카테고리"'));
check("category tab includes arcade and special channels", appSource.includes("finder.catSongs[tile.name]") && appSource.includes("finder.channelSongs[channelKey]") && appSource.includes('title: "카테고리"'));
check("one heart does not fall back to all songs", appSource.includes("return set[filter]") && !appSource.includes("set.onlyshort"));
check("filtered positions never fall back to premium all", appSource.includes("return set[filter]") && !appSource.includes("set[filter] ?? set.all"));
check("premium-only song explains normal unavailability", appSource.includes('title={filter === "normal" ? "노말 이용 불가"') && appSource.includes("프리미엄 크레딧에서만"));
check("premium-only song cannot leak through static categories", appSource.includes("titleSeries?.pos.all && !pos(titleSeries.pos, filter)") && !contract.navIndex.series["콰투오룩스"].pos.normal);
check("NEW TUNES mirrors latest series", contract.finder.categoryMirrors?.["NEW TUNES"] === "PHOENIX 2" && appSource.includes("finder.categoryMirrors"));
const p2 = contract.finder.seriesSongs["PHOENIX 2"];
const expectedP2 = (filter) => p2.filter((entry) => entry.f[filter]).map((entry) => `${entry.f[filter]}:${entry.t}`);
check("NEW TUNES normal equals PHOENIX 2 normal", expectedP2("normal").length === 22 && expectedP2("normal").at(-1) === "22:슈퍼☆하라구로☆팝");
check("NEW TUNES premium equals PHOENIX 2 premium", expectedP2("all").length === 25 && expectedP2("all").at(-1) === "25:슈퍼☆하라구로☆팝");
check("sparse category positions stay absolute", appSource.includes("function categoryEntries") && appSource.includes("position: category.pos") && appSource.includes("곳 확인 · 전체"));
check("difficulty browser uses physical folded channels", appSource.includes('finder.subs["DIFFICULTY ZONE SINGLE"]') && appSource.includes("function levelLabel") && appSource.includes("seenLevelChannels"));
const physicalLevels = new Set([
  ...(contract.finder.subs["DIFFICULTY ZONE SINGLE"] ?? []),
  ...(contract.finder.subs["DIFFICULTY ZONE DOUBLE"] ?? []),
]);
const exposedLevels = Object.keys(contract.finder.levelSongs);
check("finder exposes only physical difficulty channels", exposedLevels.length === physicalLevels.size && exposedLevels.every((level) => physicalLevels.has(level)) && !contract.finder.levelSongs.S26 && !contract.finder.levelSongs.D28);
check("search results fold chart aliases into OVER labels", appSource.includes("function chartLabels") && appSource.includes("levelLabel(folds[chart] ?? chart, folds)"));
check("typing from any tab opens search results", appSource.includes('if (value.trim()) setTab("search")'));
check("song selection aligns viewport to search", appSource.includes('searchRef.current?.scrollIntoView({ block: "start"'));
check("leaving song detail clears shared URL state", appSource.includes('url.searchParams.delete("song")') && appSource.includes('if (next !== "search") clearSongFromUrl()'));
check("browser back restores search state", appSource.includes('history.pushState(null, "", `?song=${encodeURIComponent(title)}`)') && appSource.includes('window.addEventListener("popstate", restoreUrlState)'));
check("suggestions are described as private", feedbackSource.includes("건의 내용은 공개되지 않아") && feedbackSource.includes("관리자만 확인"));
check("private inbox supports done and delete", feedbackSource.includes('status === "open" ? "done" : "open"') && feedbackSource.includes('method: "DELETE"'));
check("daily reminder omits suggestion body", reminderSource.includes("확인하지 않은 익명 건의") && !reminderSource.includes("blob.message"));
check("admin can test Discord without exposing webhook", feedbackSource.includes("Discord 알림 테스트") && reminderSource.includes('request.method === "POST" && isAdmin(request)'));

await import("../public/data/nav_search.js");
const search = globalThis.NAV_SEARCH;
check("search module schema", search?.schemaVersion === 1);
const titles = contract.songs.map((song) => song.title);
const first = (query) => search.rankTitles(query, titles)[0]?.title;
check("노 exact prefix", first("노") === "노스텔지어");
check("놋 pending consonant", first("놋") === "노스텔지어");
check("노ㅅ pending consonant", first("노ㅅ") === "노스텔지어");
check("네읻 typo", first("네읻") === "네이드 네이드");
check("punctuation fallback", first("클!")?.startsWith("클") === true);

console.log(`OK ${checks.length} checks · ${contract.contentHash.slice(0, 12)} · ${contract.songs.length}곡`);
