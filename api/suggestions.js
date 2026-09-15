import { randomUUID } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { isAdmin, json } from "./_auth.js";

const PREFIX = "suggestions/";
const MAX_LENGTH = 800;
const recent = new Map();

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
  if (body.website) return json(response, 400, { ok: false, error: "건의를 접수하지 못했어." });
  if (!message || message.length > MAX_LENGTH) return json(response, 400, { ok: false, error: "건의 내용을 1~800자로 적어줘." });
  if ((message.match(/https?:\/\//gi) || []).length > 2) return json(response, 400, { ok: false, error: "링크는 두 개까지만 넣을 수 있어." });
  const client = String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0];
  if ((recent.get(client) || 0) > Date.now() - 60_000) return json(response, 429, { ok: false, error: "건의는 1분에 한 번 등록할 수 있어." });
  recent.set(client, Date.now());
  const createdAt = new Date().toISOString();
  const id = randomUUID();
  const pathname = `${PREFIX}open/${Date.now()}-${id}.json`;
  await put(pathname, JSON.stringify({ id, message, createdAt, status: "open" }), { access: "private", contentType: "application/json", addRandomSuffix: false });
  return json(response, 201, { ok: true });
}

async function updateSuggestion(request, response) {
  if (!isAdmin(request)) return json(response, 401, { ok: false, error: "관리자 로그인이 필요해." });
  const { pathname, status } = request.body || {};
  if (!validPath(pathname) || !["open", "done"].includes(status)) return json(response, 400, { ok: false, error: "잘못된 건의 상태야." });
  const row = await readSuggestion(pathname);
  if (!row) return json(response, 404, { ok: false, error: "건의를 찾지 못했어." });
  const nextPath = `${PREFIX}${status}/${pathname.split("/").at(-1)}`;
  await put(nextPath, JSON.stringify({ ...row, status, updatedAt: new Date().toISOString() }), { access: "private", contentType: "application/json", addRandomSuffix: false });
  if (nextPath !== pathname) await del(pathname);
  return json(response, 200, { ok: true });
}

export default async function handler(request, response) {
  try {
    if (request.method === "POST") return await createSuggestion(request, response);
    if (request.method === "GET") {
      if (!isAdmin(request)) return json(response, 401, { ok: false, error: "관리자 로그인이 필요해." });
      return json(response, 200, { ok: true, suggestions: await loadSuggestions() });
    }
    if (request.method === "PATCH") return await updateSuggestion(request, response);
    if (request.method === "DELETE") {
      if (!isAdmin(request)) return json(response, 401, { ok: false, error: "관리자 로그인이 필요해." });
      const pathname = request.body?.pathname;
      if (!validPath(pathname)) return json(response, 400, { ok: false, error: "잘못된 건의 경로야." });
      await del(pathname);
      return json(response, 200, { ok: true });
    }
    return json(response, 405, { ok: false, error: "지원하지 않는 요청이야." });
  } catch (error) {
    console.error("suggestions", error);
    return json(response, 500, { ok: false, error: "건의함 처리 중 오류가 발생했어." });
  }
}
