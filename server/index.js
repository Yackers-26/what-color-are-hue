// Express server: serves the frontend and the /api routes.
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToDatabase } from "./db.js";
import colorsRouter from "./routes/colors.js";
import tasksRouter from "./routes/tasks.js";
import interpretRouter from "./routes/interpret.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const PORT = process.env.PORT || 3000;

// 10mb so photos (base64) fit in a request.
app.use(express.json({ limit: "10mb" }));

// Frontend: put index.html etc. in /public. /src is served so the browser can import src/vision modules.
app.use(express.static(path.join(rootDir, "public")));
app.use("/src", express.static(path.join(rootDir, "src")));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/colors", colorsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/interpret", interpretRouter);

// Any error in a route ends up here instead of crashing the server.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error", details: err.message });
});

await connectToDatabase();
app.listen(PORT, () => console.log(`WhatColorAreHue running at http://localhost:${PORT}`));
