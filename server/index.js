import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToDatabase, isDatabaseConnected } from "./db.js";
import { mountAuth, prepareAuthCollections, requireAuth, requireSameOrigin, resolveSession } from "./auth.js";
import colorsRouter from "./routes/colors.js";
import tasksRouter from "./routes/tasks.js";
import interpretRouter from "./routes/interpret.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
const app = express();
const PORT = Number(process.env.PORT || 3000);

// Temporary local preview only. It never grants access to account-owned APIs.
const DEMO_COOKIE = "hue_local_demo";
const isLocalDemo = (req) => process.env.NODE_ENV !== "production"
  && ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
const hasDemoCookie = (req) => (req.headers.cookie || "")
  .split(";").some(part => part.trim() === `${DEMO_COOKIE}=1`);

app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(resolveSession);
app.use((req, res, next) => {
  req.demo = isLocalDemo(req) && hasDemoCookie(req);
  next();
});
app.use(requireSameOrigin);

app.get("/api/health", (req, res) => res.json({ ok: true, mongodb: isDatabaseConnected(), gemini: Boolean(process.env.GEMINI_API_KEY), google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) }));
mountAuth(app);

app.get("/login", (req, res) => req.user ? res.redirect("/app") : res.sendFile(path.join(publicDir, "login.html")));
app.get("/demo", (req, res) => {
  if (!isLocalDemo(req)) return res.sendStatus(404);
  res.cookie(DEMO_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 4 * 60 * 60 * 1000 });
  res.redirect("/app");
});
app.get("/exit-demo", (req, res) => {
  res.clearCookie(DEMO_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
  res.redirect("/login");
});
app.get("/login.css", (req, res) => res.sendFile(path.join(publicDir, "login.css")));
app.get("/login.js", (req, res) => res.sendFile(path.join(publicDir, "login.js")));
app.get("/", (req, res) => res.redirect(req.user ? "/app" : "/login"));
app.get("/app", (req, res) => req.user || req.demo ? res.sendFile(path.join(publicDir, "index.html")) : res.redirect("/login"));

// Demo users can view app assets, but account APIs still require real authentication.
app.use("/api/colors", requireAuth, colorsRouter);
app.use("/api/tasks", requireAuth, tasksRouter);
// Signed-in users can use Gemini normally. For an in-person laptop demo only,
// allow interpretation after choosing "Continue without signing in". Account-owned
// HueMemory/colors/tasks routes above ALWAYS require a real signed-in account.
function requireAuthOrLocalDemo(req, res, next) {
  const ip = String(req.socket.remoteAddress || "");
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (req.user || (req.demo && isLocalDemo(req) && loopback)) return next();
  return res.status(401).json({ error: "Sign in to use Gemini outside the local demo." });
}
app.use("/api/interpret", requireAuthOrLocalDemo, interpretRouter);
app.use((req, res, next) => req.user || req.demo ? next() : requireAuth(req, res, next));
app.use(express.static(publicDir, { index: false }));
app.use("/src", express.static(path.join(rootDir, "src")));

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  const unavailable = /MongoDB is not connected/i.test(err.message || "");
  res.status(unavailable ? 503 : 500).json({ error: unavailable ? err.message : "Server error" });
});

try {
  if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes("<")) {
    await connectToDatabase();
    await prepareAuthCollections();
  } else {
    console.warn("MONGODB_URI is not set. Configure MongoDB to enable account sign-in and stored colors/tasks.");
  }
} catch (error) {
  console.error("MongoDB connection failed. The login page remains available:", error.message);
}

app.listen(PORT, () => console.log(`WhatColorAreHue running at http://localhost:${PORT}`));
