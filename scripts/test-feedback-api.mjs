process.env.ADMIN_SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.SUGGESTION_ADMIN_PASSWORD = "test-password";

const { default: adminSession } = await import("../api/admin-session.js");
const { default: suggestions } = await import("../api/suggestions.js");
const { default: reminder } = await import("../api/suggestion-reminder.js");

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    status(value) { this.statusCode = value; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}

const checks = [];
const check = (name, condition) => {
  if (!condition) throw new Error(`FAIL ${name}`);
  checks.push(name);
};

let res = response();
await adminSession({ method: "POST", headers: {}, body: { password: "wrong" } }, res);
check("wrong admin password rejected", res.statusCode === 401 && !res.headers["Set-Cookie"]);

res = response();
await adminSession({ method: "POST", headers: {}, body: { password: "test-password" } }, res);
const cookie = res.headers["Set-Cookie"]?.split(";")[0];
check("valid admin login issues secure cookie", res.statusCode === 200 && cookie?.startsWith("zone_feedback_admin=") && res.headers["Set-Cookie"].includes("HttpOnly") && res.headers["Set-Cookie"].includes("SameSite=Strict"));

res = response();
await adminSession({ method: "GET", headers: { cookie } }, res);
check("signed admin cookie authenticates", res.payload.authenticated === true);

res = response();
await suggestions({ method: "POST", headers: {}, socket: {}, body: { message: "짧음", openedAt: Date.now() - 5000 } }, res);
check("invalid anonymous suggestion rejected before storage", res.statusCode === 400);

res = response();
await reminder({ method: "GET", headers: {} }, res);
check("cron endpoint requires secret", res.statusCode === 401);

console.log(`OK ${checks.length} feedback API checks`);
