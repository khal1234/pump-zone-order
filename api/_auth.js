import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "zone_feedback_admin";
const SESSION_AGE = 60 * 60 * 24 * 30;

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function equal(left, right) {
  const a = digest(left);
  const b = digest(right);
  return timingSafeEqual(a, b);
}

function signature(expires) {
  return createHmac("sha256", process.env.ADMIN_SESSION_SECRET || "").update(expires).digest("base64url");
}

export function isAdmin(request) {
  if (!process.env.ADMIN_SESSION_SECRET) return false;
  const cookies = Object.fromEntries((request.headers.cookie || "").split(";").map((row) => row.trim().split(/=(.*)/s).slice(0, 2)));
  const [expires, supplied] = (cookies[COOKIE_NAME] || "").split(".");
  return Boolean(expires && supplied && Number(expires) > Date.now() && equal(supplied, signature(expires)));
}

export function verifyPassword(password) {
  return Boolean(process.env.SUGGESTION_ADMIN_PASSWORD && equal(String(password || ""), process.env.SUGGESTION_ADMIN_PASSWORD));
}

export function setSession(response) {
  const expires = String(Date.now() + SESSION_AGE * 1000);
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${expires}.${signature(expires)}; Max-Age=${SESSION_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`);
}

export function clearSession(response) {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
}

export function json(response, status, body) {
  response.status(status).setHeader("Cache-Control", "private, no-store").json(body);
}
