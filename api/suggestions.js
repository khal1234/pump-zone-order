import { randomUUID } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { isAdmin, json } from "./_auth.js";

const PREFIX = "suggestions/";
const MAX_LENGTH = 800;
const recent = new Map();
const MAX_OPEN = 300;          // 미처리 건의 상한 — 관리 목록(loadSuggestions limit 200)을 넘치기 전에 멈추되, 한 번 몰려도 정상 건의가 막히지 않을 만큼
const GLOBAL_GAP_MS = 10_000;  // 누가 보냈든 두 건 사이 최소 간격 — 사람이 글을 쓰는 데 10초보다 오래 걸린다

function validPath(pathname) {
  return typeof pathname === "string" && /^suggestions\/(open|done)\/\d{13}-[0-9a-f-]{36}\.json$/.test(pathname);
}

async function readSuggestion(pathname) {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result?.stream) return null;
  return new Response(result.stream).json();
}

async function loadSuggestions() {
  const { blobs } = await list({ prefix: PREFIX, limit: 200 });
  const rows = await Promise.all(blobs.filter((blob) => validPath(blob.pathname)).map(async (blob) => ({ ...(await readSuggestion(blob.pathname)), pathname: blob.pathname })));
  return rows.filter((row) => row.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function createSuggestion(request, response) {
  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {});
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (body.website) return json(response, 400, { ok: false, error: "건의를 접수하지 못했습니다." });
  if (!message || message.length > MAX_LENGTH) return json(response, 400, { ok: false, error: "건의 내용을 1~800자로 적어 주세요." });
  if ((message.match(/https?:\/\//gi) || []).length > 2) return json(response, 400, { ok: false, error: "링크는 두 개까지만 넣을 수 있습니다." });
  const client = String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0];
  if ((recent.get(client) || 0) > Date.now() - 60_000) return json(response, 429, { ok: false, error: "건의는 1분에 한 번 등록할 수 있습니다." });
  // 11-14 점검 — 위 Map 은 함수가 새로 뜨면 비어 도배를 못 막는다. 저장소에 남은 미처리 건의로 다시 잰다:
  //   미처리 MAX_OPEN 건이 차면 받지 않고, 마지막 건의가 GLOBAL_GAP_MS 안이면 누가 보냈든 잠깐 막는다(경로 앞 13자리가 접수 시각).
  const { blobs: open } = await list({ prefix: `${PREFIX}open/`, limit: MAX_OPEN });
  if (open.length >= MAX_OPEN) return json(response, 429, { ok: false, error: "건의함이 가득 찼습니다. 나중에 다시 보내 주세요." });
  const newest = Math.max(0, ...open.map((blob) => Number(blob.pathname.split("/").at(-1).slice(0, 13)) || 0));
  if (newest > Date.now() - GLOBAL_GAP_MS) return json(response, 429, { ok: false, error: "잠시 뒤 다시 보내 주세요." });
  recent.set(client, Date.now());
  const createdAt = new Date().toISOString();
  const id = randomUUID();
  const pathname = `${PREFIX}open/${Date.now()}-${id}.json`;
  await put(pathname, JSON.stringify({ id, message, createdAt, status: "open" }), { access: "private", contentType: "application/json", addRandomSuffix: false });
  return json(response, 201, { ok: true });
}

async function updateSuggestion(request, response) {
  if (!isAdmin(request)) return json(response, 401, { ok: false, error: "관리자 로그인이 필요합니다." });
  const { pathname, status } = request.body || {};
  if (!validPath(pathname) || !["open", "done"].includes(status)) return json(response, 400, { ok: false, error: "잘못된 건의 상태입니다." });
  const row = await readSuggestion(pathname);
  if (!row) return json(response, 404, { ok: false, error: "건의를 찾지 못했습니다." });
  const nextPath = `${PREFIX}${status}/${pathname.split("/").at(-1)}`;
  await put(nextPath, JSON.stringify({ ...row, status, updatedAt: new Date().toISOString() }), { access: "private", contentType: "application/json", addRandomSuffix: false });
  if (nextPath !== pathname) await del(pathname);
  return json(response, 200, { ok: true });
}

export default async function handler(request, response) {
  try {
    if (request.method === "POST") return await createSuggestion(request, response);
    if (request.method === "GET") {
      if (!isAdmin(request)) return json(response, 401, { ok: false, error: "관리자 로그인이 필요합니다." });
      return json(response, 200, { ok: true, suggestions: await loadSuggestions() });
    }
    if (request.method === "PATCH") return await updateSuggestion(request, response);
    if (request.method === "DELETE") {
      if (!isAdmin(request)) return json(response, 401, { ok: false, error: "관리자 로그인이 필요합니다." });
      const pathname = request.body?.pathname;
      if (!validPath(pathname)) return json(response, 400, { ok: false, error: "잘못된 건의 경로입니다." });
      await del(pathname);
      return json(response, 200, { ok: true });
    }
    return json(response, 405, { ok: false, error: "지원하지 않는 요청입니다." });
  } catch (error) {
    console.error("suggestions", error);
    return json(response, 500, { ok: false, error: "건의함 처리 중 오류가 발생했습니다." });
  }
}
