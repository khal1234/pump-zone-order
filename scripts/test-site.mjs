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
