import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

// Exercise the production authentication route functions against an in-memory
// MongoDB-shaped collection. No OAuth secrets, network, or MongoDB daemon are needed.
// Only the db.js import is replaced; the login/OAuth handlers are unchanged.
class Collection {
  constructor() { this.rows = []; this.nextId = 0; }
  async createIndex() { return "created"; }
  async insertOne(record) {
    if (this.rows.some((row) => (record.email && row.email === record.email)
      || (record.googleSub && row.googleSub === record.googleSub))) {
      const error = new Error("duplicate"); error.code = 11000; throw error;
    }
    const _id = `record-${++this.nextId}`;
    this.rows.push({ ...record, _id });
    return { insertedId: _id };
  }
  async findOne(query) { return this.rows.find((row) => matches(row, query)) || null; }
  async findOneAndDelete(query) {
    const i = this.rows.findIndex((row) => matches(row, query));
    return i < 0 ? null : this.rows.splice(i, 1)[0];
  }
  async deleteOne(query) {
    const i = this.rows.findIndex((row) => matches(row, query));
    if (i < 0) return { deletedCount: 0 };
    this.rows.splice(i, 1);
    return { deletedCount: 1 };
  }
}
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => value && typeof value === "object" && "$gt" in value
    ? row[key] > value.$gt : row[key] === value);
}
class TestApp {
  constructor() { this.routes = new Map(); }
  get(path, ...handlers) { this.routes.set(`GET ${path}`, handlers); }
  post(path, ...handlers) { this.routes.set(`POST ${path}`, handlers); }
  async call(method, path, body = {}, cookie = "", query = {}) {
    const handlers = this.routes.get(`${method} ${path}`);
    assert.ok(handlers, `Missing ${method} ${path}`);
    const req = { body, query, path, ip: "127.0.0.1", headers: {
      cookie, ...(method === "POST" ? { origin: process.env.APP_ORIGIN } : {})
    } };
    if (this.before) await this.before(req);
    const result = { status: 200, json: null, location: null, cookies: [] };
    const res = {
      status(n) { result.status = n; return this; },
      json(data) { result.json = data; return this; },
      redirect(where) { result.status = 302; result.location = where; return this; },
      append(name, val) { if (name.toLowerCase() === "set-cookie") result.cookies.push(val); return this; }
    };
    for (const handler of handlers) {
      await new Promise((resolve, reject) => {
        try {
          const next = (error) => error ? reject(error) : resolve();
          const returned = handler(req, res, next);
          Promise.resolve(returned).then(() => resolve(), reject);
        } catch (error) { reject(error); }
      });
      if (result.json !== null || result.location) break;
    }
    result.cookie = result.cookies.find((c) => c.startsWith("hue_session="))?.split(";")[0] || "";
    return { ...result, req };
  }
}

const exampleOrigin = "http://localhost:3000";
test("Mongo-backed password accounts, sessions and Google PKCE OAuth", async () => {
  process.env.APP_ORIGIN = exampleOrigin;
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "client-test-secret";
  const stores = new Map();
  globalThis.__hueAuthTestDb = {
    collection(name) {
      if (!stores.has(name)) stores.set(name, new Collection());
      return stores.get(name);
    }
  };
  const authPath = fileURLToPath(new URL("../server/auth.js", import.meta.url));
  const source = await readFile(authPath, "utf8");
  const substituted = source.replace('import { getDb, isDatabaseConnected } from "./db.js";',
    'const getDb = () => globalThis.__hueAuthTestDb; const isDatabaseConnected = () => Boolean(getDb());');
  assert.notEqual(source, substituted, "Authentication test must load the actual production route handlers");
  const auth = await import(`data:text/javascript;base64,${Buffer.from(substituted).toString("base64")}`);
  await auth.prepareAuthCollections();
  const app = new TestApp();
  auth.mountAuth(app);
  app.before = async (req) => auth.resolveSession(req, {}, () => {});
  const noName = await app.call("POST", "/api/auth/signup", { email: "x@example.org", password: "verystrongpass" });
  assert.equal(noName.status, 400);
  const signup = await app.call("POST", "/api/auth/signup", { name: "Jane", email: " JANE@Example.ORG ", password: "correct horse battery staple" });
  assert.equal(signup.status, 201);
  assert.equal(signup.json.user.email, "jane@example.org");
  assert.ok(signup.cookie);
  assert.match(signup.cookies[0], /HttpOnly; SameSite=Lax/);
  const duplicate = await app.call("POST", "/api/auth/signup", { name: "Jane", email: "jane@example.org", password: "correct horse battery staple" });
  assert.equal(duplicate.status, 409);
  const wrong = await app.call("POST", "/api/auth/login", { email: "jane@example.org", password: "this is not the password" });
  assert.equal(wrong.status, 401);
  const login = await app.call("POST", "/api/auth/login", { email: "jane@example.org", password: "correct horse battery staple" });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);
  let sessionReq = { headers: { cookie: login.cookie } };
  await auth.resolveSession(sessionReq, {}, () => {});
  assert.equal(sessionReq.user.email, "jane@example.org");
  assert.equal(sessionReq.user.provider, "password");
  const csrfResponse = { code: 200, status(n) { this.code = n; return this; }, json() {} };
  auth.requireSameOrigin({ method: "POST", headers: { origin: "https://malicious.example" } }, csrfResponse, () => assert.fail("Cross-site POST must be rejected"));
  assert.equal(csrfResponse.code, 403);
  const logout = await app.call("POST", "/api/auth/logout", {}, login.cookie);
  assert.equal(logout.status, 200);
  const signedOutReq = { headers: { cookie: login.cookie } };
  await auth.resolveSession(signedOutReq, {}, () => {});
  assert.equal(signedOutReq.user, null, "Logging out invalidates the previous database session");
  const anotherSession = { headers: { cookie: signup.cookie } };
  await auth.resolveSession(anotherSession, {}, () => {});
  assert.equal(anotherSession.user.email, "jane@example.org", "Other devices retain their own sessions");

  const oauthStart = await app.call("GET", "/api/auth/google");
  assert.equal(oauthStart.status, 302);
  const authUrl = new URL(oauthStart.location);
  assert.equal(authUrl.hostname, "accounts.google.com");
  assert.equal(authUrl.searchParams.get("client_id"), process.env.GOOGLE_CLIENT_ID);
  assert.equal(authUrl.searchParams.get("redirect_uri"), `${exampleOrigin}/api/auth/google/callback`);
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  const state = authUrl.searchParams.get("state");
  const flowCookie = oauthStart.cookies.find((cookie) => cookie.startsWith("hue_oauth_flow="))?.split(";")[0];
  assert.ok(flowCookie && state);
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url, options) => {
    fetched.push({ url: String(url), options });
    if (String(url).endsWith("/token")) return new Response(JSON.stringify({ access_token: "mock-oauth-token" }), { status: 200 });
    if (String(url).endsWith("/userinfo")) return new Response(JSON.stringify({ sub: "google-user-1", email: "google@example.org", email_verified: true, name: "Google Person" }), { status: 200 });
    throw new Error("Unexpected OAuth endpoint");
  };
  try {
    const callback = await app.call("GET", "/api/auth/google/callback", {}, flowCookie, { code: "mock-auth-code", state });
    assert.equal(callback.status, 302);
    assert.equal(callback.location, "/app");
    assert.ok(callback.cookie);
    assert.equal(fetched.length, 2);
    assert.equal(new URLSearchParams(fetched[0].options.body).get("code_verifier")?.length > 30, true);
    assert.match(fetched[1].options.headers.Authorization, /^Bearer /);
    sessionReq = { headers: { cookie: callback.cookie } };
    await auth.resolveSession(sessionReq, {}, () => {});
    assert.equal(sessionReq.user.provider, "google");
    assert.equal(sessionReq.user.email, "google@example.org");
    const replay = await app.call("GET", "/api/auth/google/callback", {}, flowCookie, { code: "mock-auth-code", state });
    assert.equal(replay.location, "/login?error=google");
    const badFlow = await app.call("GET", "/api/auth/google/callback", {}, "hue_oauth_flow=wrong", { code: "abc", state });
    assert.equal(badFlow.location, "/login?error=google");
    const googleWithPassword = await app.call("POST", "/api/auth/login", { email: "google@example.org", password: "correct horse battery staple" });
    assert.equal(googleWithPassword.status, 401);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.__hueAuthTestDb;
  }
});
