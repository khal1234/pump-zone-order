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

const titles0 = new Set(contract.songs.map((song) => song.title));
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
const originalAnchorShift = contract.navIndex.cats["러브 이즈 어 데인저 존 2 (Try To B.P.M)"]?.find((row) => row.tile === "ORIGINAL");
check("ORIGINAL inferred positions retain their evidence grade", (originalAnchorShift?.pos ?? 0) > 0 && originalAnchorShift.src === "구간확정" && originalAnchorShift.seen === "닻 밀림");
check("ORIGINAL evidence is visible in song details", appSource.includes('row.tile === "ORIGINAL" && row.src') && appSource.includes("인접 확인 지점에서 계산한 위치"));
const s17 = contract.finder.levelSongs.S17;
check("level positions preserve RANDOM slot", s17[0].f.all === 2 && contract.navIndex.levelTotals.S17.all === Math.max(...s17.map((row) => row.f.all)));
check("UI explains screen number convention", appSource.includes("난이도존 1번은 RANDOM") && appSource.includes("기기 화면 번호 그대로"));
// 10-16 사용자 «새로고침해도 노말·프리미엄·하트 개수 유지» — 저장값이 없을 때만 노말 4하트.
check("default credit is normal four hearts", appSource.includes(': "normal"; } catch { return "normal"; }') && appSource.includes("catch { return MODE_MAX.normal; }") && appSource.includes("localStorage.setItem(CREDIT_KEY, creditMode)"));
// 10-16 «S19 프리미엄 3하트 총 152곡인데 왜 곡수가 안맞지» — 프리미엄은 하트가 줄어도 p_* 조건(프리미엄 전용곡 유지)을 쓴다.
check("hearts derive available song filter", appSource.includes('if (hearts >= 4) return mode === "premium" ? "all" : "normal"') && appSource.includes('const premium = mode === "premium" ? "p_" : ""') && appSource.includes('return `${premium}onlyshort`') && dataSource.includes("addPremiumPositions(contract)"));
check("zone and song routes use compact groups", !appSource.includes('className="zone-tabs"') && appSource.includes('["single", "double", "series", "category"]') && appSource.includes('className="route-groups"') && appSource.includes('{ label: "싱글"') && appSource.includes('{ label: "카테고리"'));
check("category tab includes arcade and special channels", appSource.includes("finder.catSongs[tile.name]") && appSource.includes("finder.channelSongs[channelKey]") && appSource.includes('title: "카테고리"'));
check("one heart does not fall back to all songs", appSource.includes("return set[filter]") && !appSource.includes("set.onlyshort"));
check("filtered positions never fall back to premium all", appSource.includes("return set[filter]") && !appSource.includes("set[filter] ?? set.all"));
check("premium-only song explains normal unavailability", appSource.includes('title={filter === "normal" ? "노말 이용 불가"') && appSource.includes("프리미엄 크레딧에서만"));
check("premium-only song cannot leak through static categories", appSource.includes("titleSeries?.pos.all && !pos(titleSeries.pos, filter)") && !contract.navIndex.series["콰투오룩스"].pos.normal);
check("NEW TUNES mirrors latest series", contract.finder.categoryMirrors?.["NEW TUNES"] === "PHOENIX 2" && appSource.includes("finder.categoryMirrors"));
const p2 = contract.finder.seriesSongs["PHOENIX 2"];
const expectedP2 = (filter) => p2.filter((entry) => entry.f[filter]).map((entry) => `${entry.f[filter]}:${entry.t}`);
// 2026-10-16 닉2 2차 신곡 6곡(그중 피살리스 프리미엄) — 노멀 22→27 · 프리미엄 25→31
check("NEW TUNES normal equals PHOENIX 2 normal", expectedP2("normal").length === 27 && expectedP2("normal").at(-1) === "27:슈퍼☆하라구로☆팝");
check("NEW TUNES premium equals PHOENIX 2 premium", expectedP2("all").length === 31 && expectedP2("all").at(-1) === "31:슈퍼☆하라구로☆팝");
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
check("song selection aligns viewport to search", appSource.includes('closest(".search-box") ?? searchRef.current)?.scrollIntoView({ block: "start"'));
check("search box sits under hearts and is a search field", appSource.indexOf("<CreditControl") < appSource.indexOf("<SearchBox ref") && appSource.includes('type="search"') && !appSource.includes("scrollToSearchSoon"));  // 10-16 «검색은 스크롤 안나오게» — 검색 묶음이 고정이라 입력 때 화면을 굴리지 않는다
check("search results start without a count header", !appSource.includes("곡을 가까운 순서로 찾았어"));
check("basic mode lists 33 official songs", contract.finder.modeSongs?.["베이직 모드"]?.length === 33 && contract.finder.modeSongs["베이직 모드"][0] === "고민중독" && contract.finder.modeSongs["베이직 모드"].every((title) => titles0.has(title)));
check("online matching lists 16 level bands without songs", contract.finder.modeRows?.["온라인 매칭"]?.length === 16 && contract.finder.modeRows["온라인 매칭"][15] === "더블 27 OVER");
check("leaving song detail clears shared URL state", appSource.includes('url.searchParams.delete("song")') && appSource.includes('if (next !== "search") clearSongFromUrl()'));
check("browser back restores search state", appSource.includes('history.pushState(null, "", `?song=${encodeURIComponent(title)}`)') && appSource.includes('window.addEventListener("popstate", restoreUrlState)'));
check("suggestions are described as private", feedbackSource.includes("건의 내용은 공개되지 않습니다") && feedbackSource.includes("관리자만 확인"));
check("short suggestions can be submitted immediately", feedbackSource.includes("짧게 적어도 됩니다") && !feedbackSource.includes("minLength={10}") && !feedbackSource.includes("openedAt"));
check("admin retries eventually consistent suggestion list", feedbackSource.includes("attempt < 3") && feedbackSource.includes("새 건의 반영을 확인하고 있습니다"));
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
