import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const contractPath = valueAfter("--contract");
const searchPath = valueAfter("--search");
if (!contractPath || !searchPath) {
  console.error("사용법: node scripts/sync-site-data.mjs --contract <public_nav_contract.json> --search <nav_search.js>");
  process.exit(2);
}

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

const contractBytes = await readFile(resolve(contractPath));
const contractText = contractBytes.toString("utf8").trimEnd();
const contract = JSON.parse(contractText);
const searchBytes = await readFile(resolve(searchPath));
if (contract.schemaVersion !== 1 || contract.search?.schemaVersion !== 1) throw new Error("지원하지 않는 계약/검색 스키마");
if (contract.target?.repository !== "https://github.com/khal1234/pump-zone-order.git") throw new Error("계약의 공개 대상 저장소가 pump-zone-order가 아님");
const bodyText = contractText.replace(/^\{"contentHash":"[0-9a-f]{64}",/, "{");
if (bodyText === contractText || sha(Buffer.from(bodyText)) !== contract.contentHash) throw new Error("계약 contentHash 불일치");
if (sha(searchBytes) !== contract.search.sha256) throw new Error("검색 모듈 SHA-256 불일치");
if (/c:\\users|d:\\xsanity|play_history|my_records|credential/i.test(contractBytes.toString("utf8"))) throw new Error("공개 계약에 로컬/개인 표식이 있음");

const outDir = resolve("public", "data");
await mkdir(outDir, { recursive: true });
const versionName = `${contract.contentHash}.json`;
await writeFile(resolve(outDir, versionName), contractBytes);
await writeFile(resolve(outDir, "nav_search.js"), searchBytes);
const pointer = {
  schemaVersion: 1,
  contentHash: contract.contentHash,
  dataUrl: `/data/${versionName}`,
  searchUrl: "/data/nav_search.js",
  game: contract.game,
};
await writeFile(resolve(outDir, "current.json"), `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
console.log(`site data ${contract.contentHash.slice(0, 12)} · ${contract.songs.length}곡 · ${basename(contractPath)}`);
