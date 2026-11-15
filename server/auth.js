import crypto from "node:crypto";
import { promisify } from "node:util";
import { getDb, isDatabaseConnected } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "hue_session";
const FLOW_COOKIE = "hue_oauth_flow";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
// OWASP scrypt-recommended 64 MiB / 2-pass option for password storage.
const SCRYPT_OPTIONS = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
const FLOW_MS = 10 * 60 * 1000;
const APP_ORIGIN = (process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
const SHA256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");
const isSecure = () => APP_ORIGIN.startsWith("https://");
const cookieOptions = (maxAge) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}${isSecure() ? "; Secure" : ""}`;
const clearCookie = () => `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure() ? "; Secure" : ""}`;
const users = () => getDb().collection("users");
const sessions = () => getDb().collection("auth_sessions");
const oauthStates = () => getDb().collection("oauth_states");

function getCookie(req, name) {
  const input = req.headers.cookie || "";
  const item = input.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return item ? item.slice(name.length + 1) : null;
}
function jsonError(res, status, error) { return res.status(status).json({ error }); }
function normalizedEmail(email) {
  return typeof email === "string" && email.length <= 254 ? email.trim().toLowerCase() : "";
}
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function publicUser(user) { return { id: String(user._id), email: user.email, name: user.name || "", provider: user.provider }; }

export async function prepareAuthCollections() {
  await users().createIndex({ email: 1 }, { unique: true });
  await users().createIndex({ googleSub: 1 }, { unique: true, sparse: true });
  await sessions().createIndex({ tokenHash: 1 }, { unique: true });
  await sessions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await oauthStates().createIndex({ stateHash: 1 }, { unique: true });
  await oauthStates().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function resolveSession(req, res, next) {
  req.user = null;
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || !isDatabaseConnected()) return next();
  try {
    const session = await sessions().findOne({ tokenHash: SHA256(token), expiresAt: { $gt: new Date() } });
    if (session) {
      const user = await users().findOne({ _id: session.userId });
      if (user) { req.user = publicUser(user); req.authTokenHash = session.tokenHash; }
    }
    next();
  } catch (error) { next(error); }
}

export function requireAuth(req, res, next) {
  if (!req.user) return jsonError(res, 401, "Sign in to continue.");
  next();
}

async function createSession(res, user) {
  const token = randomToken();
  await sessions().insertOne({ tokenHash: SHA256(token), userId: user._id, createdAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MS) });
  res.append("Set-Cookie", `${SESSION_COOKIE}=${token}; ${cookieOptions(SESSION_MS)}`);
}

// IP-limited login attempts; use an upstream shared rate limiter before wide public deployment.
const attempts = new Map();
function attemptLimiter(req, res, next) {
  const now = Date.now();
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  const key = `${ip}:${req.path}`;
  let entry = attempts.get(key);
  if (!entry || entry.until <= now) entry = { count: 0, until: now + 15 * 60_000 };
  entry.count++;
  attempts.set(key, entry);
  if (attempts.size > 1000) for (const [item, value] of attempts) if (value.until < now) attempts.delete(item);
  if (entry.count > 12) return jsonError(res, 429, "Too many attempts. Try again later.");
  next();
}

export function mountAuth(app) {
  app.get("/api/auth/config", (req, res) => res.json({ googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && isDatabaseConnected()), databaseReady: isDatabaseConnected() }));
  app.get("/api/auth/me", (req, res) => res.json({ user: req.user || null, demo: Boolean(req.demo && !req.user) }));

  app.post("/api/auth/signup", attemptLimiter, async (req, res, next) => {
    try {
      if (!isDatabaseConnected()) return jsonError(res, 503, "Sign-in storage is not connected. Configure MONGODB_URI.");
      const email = normalizedEmail(req.body?.email);
      const password = req.body?.password;
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 70) : "";
      if (!validEmail(email) || !name || typeof password !== "string" || password.length < 12 || password.length > 128)
        return jsonError(res, 400, "Enter your name, a valid email, and a password of 12–128 characters.");
      const salt = crypto.randomBytes(16).toString("hex");
      const derived = await scrypt(password, Buffer.from(salt, "hex"), 64, SCRYPT_OPTIONS);
      let user;
      try {
        const record = { email, name, provider: "password", passwordHash: derived.toString("hex"), passwordSalt: salt, createdAt: new Date() };
        const result = await users().insertOne(record);
        user = { ...record, _id: result.insertedId };
      } catch (error) {
        if (error.code === 11000) return jsonError(res, 409, "An account with this email already exists.");
        throw error;
      }
      await createSession(res, user);
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/login", attemptLimiter, async (req, res, next) => {
    try {
      if (!isDatabaseConnected()) return jsonError(res, 503, "Sign-in storage is not connected. Configure MONGODB_URI.");
      const email = normalizedEmail(req.body?.email);
      const password = req.body?.password;
      if (!validEmail(email) || typeof password !== "string" || password.length > 128)
        return jsonError(res, 401, "Incorrect email or password.");
      const user = await users().findOne({ email, provider: "password" });
      if (!user) return jsonError(res, 401, "Incorrect email or password.");
      const derived = await scrypt(password, Buffer.from(user.passwordSalt, "hex"), 64, SCRYPT_OPTIONS);
      const expected = Buffer.from(user.passwordHash, "hex");
      if (derived.length !== expected.length || !crypto.timingSafeEqual(derived, expected))
        return jsonError(res, 401, "Incorrect email or password.");
      await createSession(res, user);
      res.json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      if (req.authTokenHash && isDatabaseConnected()) await sessions().deleteOne({ tokenHash: req.authTokenHash });
      res.append("Set-Cookie", `${SESSION_COOKIE}=; ${clearCookie()}`);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get("/api/auth/google", attemptLimiter, async (req, res, next) => {
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !isDatabaseConnected())
        return res.redirect("/login?error=not-configured");
      const state = randomToken(), browserFlow = randomToken(), verifier = randomToken();
      await oauthStates().insertOne({ stateHash: SHA256(state), browserHash: SHA256(browserFlow), codeVerifier: verifier, createdAt: new Date(), expiresAt: new Date(Date.now() + FLOW_MS) });
      res.append("Set-Cookie", `${FLOW_COOKIE}=${browserFlow}; ${cookieOptions(FLOW_MS)}`);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({ response_type: "code", client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${APP_ORIGIN}/api/auth/google/callback`, scope: "openid email profile", prompt: "select_account", state, code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
      res.redirect(url.href);
    } catch (error) { next(error); }
  });

  app.get("/api/auth/google/callback", async (req, res, next) => {
    try {
      const { code, state } = req.query;
      const browserFlow = getCookie(req, FLOW_COOKIE);
      res.append("Set-Cookie", `${FLOW_COOKIE}=; ${clearCookie()}`);
      if (typeof code !== "string" || typeof state !== "string" || !browserFlow || !isDatabaseConnected())
        return res.redirect("/login?error=google");
      const flow = await oauthStates().findOneAndDelete({ stateHash: SHA256(state), browserHash: SHA256(browserFlow), expiresAt: { $gt: new Date() } });
      if (!flow) return res.redirect("/login?error=google");
      const exchange = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: `${APP_ORIGIN}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: flow.codeVerifier }), signal: AbortSignal.timeout(12000) });
      if (!exchange.ok) return res.redirect("/login?error=google");
      const tokens = await exchange.json();
      const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(12000) });
      if (!infoRes.ok) return res.redirect("/login?error=google");
      const profile = await infoRes.json();
      const email = normalizedEmail(profile.email);
      if (!profile.sub || !profile.email_verified || !validEmail(email)) return res.redirect("/login?error=google");
      let user = await users().findOne({ googleSub: profile.sub });
      if (!user) {
        const existing = await users().findOne({ email });
        if (existing) return res.redirect("/login?error=existing-email");
        const record = { email, name: String(profile.name || email.split("@")[0]).slice(0, 70), provider: "google", googleSub: profile.sub, createdAt: new Date() };
        try {
          const result = await users().insertOne(record);
          user = { ...record, _id: result.insertedId };
        } catch (error) {
          if (error.code === 11000) return res.redirect("/login?error=existing-email");
          throw error;
        }
      }
      await createSession(res, user);
      res.redirect("/app");
    } catch (error) { next(error); }
  });
}

export function requireSameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin !== APP_ORIGIN && !(origin === undefined && typeof referer === "string" && referer.startsWith(APP_ORIGIN + "/")))
    return jsonError(res, 403, "Unrecognized request origin.");
  next();
}
