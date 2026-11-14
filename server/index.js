import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToDatabase, isDatabaseConnected } from "./db.js";
import colorsRouter from "./routes/colors.js";
import tasksRouter from "./routes/tasks.js";
import interpretRouter from "./routes/interpret.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));

app.use(express.static(path.join(rootDir, "public")));
app.use("/src", express.static(path.join(rootDir, "src")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mongodb: isDatabaseConnected(),
    gemini: Boolean(process.env.GEMINI_API_KEY)
  });
});

app.use("/api/colors", colorsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/interpret", interpretRouter);

app.use((err, req, res, next) => {
  console.error(err);
  const unavailable = /MongoDB is not connected/i.test(err.message || "");
  res.status(unavailable ? 503 : 500).json({
    error: unavailable ? err.message : "Server error",
    ...(process.env.NODE_ENV === "development" ? { details: err.message } : {})
  });
});

try {
  if (process.env.MONGODB_URI) {
    await connectToDatabase();
  } else {
    console.warn("MONGODB_URI is not set. Camera features will run; HueMemory and task storage need MongoDB.");
  }
} catch (error) {
  console.error("MongoDB connection failed. The camera app will still start:", error.message);
}

app.listen(PORT, () => {
  console.log(`WhatColorAreHue running at http://localhost:${PORT}`);
});
