import { clearSession, isAdmin, json, setSession, verifyPassword } from "./_auth.js";

const failedLogins = new Map();

export default async function handler(request, response) {
  if (request.method === "GET") return json(response, 200, { ok: true, authenticated: isAdmin(request) });
  if (request.method === "DELETE") {
    clearSession(response);
    return json(response, 200, { ok: true });
  }
  if (request.method !== "POST") return json(response, 405, { ok: false, error: "지원하지 않는 요청이야." });
  const client = String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0];
  const failures = (failedLogins.get(client) || []).filter((time) => time > Date.now() - 15 * 60_000);
  if (failures.length >= 5) return json(response, 429, { ok: false, error: "로그인 시도가 너무 많아. 15분 뒤 다시 시도해줘." });
  if (!verifyPassword(request.body?.password)) {
    failedLogins.set(client, [...failures, Date.now()]);
    return json(response, 401, { ok: false, error: "관리자 암호가 맞지 않아." });
  }
  failedLogins.delete(client);
  setSession(response);
  return json(response, 200, { ok: true, authenticated: true });
}
