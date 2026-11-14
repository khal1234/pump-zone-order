import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import { clearSession, isAdmin, json, setSession, verifyPassword } from "./_auth.js";

const failedLogins = new Map();
const WINDOW_MS = 15 * 60_000;

// 11-14 점검 — Map 만으로는 함수가 새로 뜰 때마다 실패 횟수가 0 으로 돌아간다. 실패 시각을 저장소에도 남긴다
//   (주소는 해시로만). 저장소를 못 쓰면(로컬 시험) Map 만 쓴다.
function failKey(client) {
  return `auth-fail/${createHash("sha256").update(client).digest("hex").slice(0, 32)}.json`;
}

async function storedFailures(client) {
  try {
    const result = await get(failKey(client), { access: "private", useCache: false });
    return result?.stream ? await new Response(result.stream).json() : [];
  } catch { return []; }
}

async function storeFailures(client, times) {
  try { await put(failKey(client), JSON.stringify(times), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true }); } catch { /* 저장소 없음 — Map 만 */ }
}

export default async function handler(request, response) {
  if (request.method === "GET") return json(response, 200, { ok: true, authenticated: isAdmin(request) });
  if (request.method === "DELETE") {
    clearSession(response);
    return json(response, 200, { ok: true });
  }
  if (request.method !== "POST") return json(response, 405, { ok: false, error: "지원하지 않는 요청입니다." });
  const client = String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0];
  const failures = [...(failedLogins.get(client) || []), ...(await storedFailures(client))]
    .filter((time, index, all) => time > Date.now() - WINDOW_MS && all.indexOf(time) === index);
  if (failures.length >= 5) return json(response, 429, { ok: false, error: "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요." });
  if (!verifyPassword(request.body?.password)) {
    const next = [...failures, Date.now()];
    failedLogins.set(client, next);
    await storeFailures(client, next);
    return json(response, 401, { ok: false, error: "관리자 암호가 맞지 않습니다." });
  }
  failedLogins.delete(client);
  if (failures.length) await storeFailures(client, []);
  setSession(response);
  return json(response, 200, { ok: true, authenticated: true });
}
