import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Runtime-free guardrails for the cross-version HueDo and protected task API contracts.
test("merged HueDo frontend markup and imports are consistent", async () => {
  const read = (file) => readFile(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const [html, script, memory, parser] = await Promise.all([
    read("../public/index.html"), read("../public/script.js"),
    read("../public/js/huememory.js"), read("../public/js/hueDoParser.js")
  ]);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) {
    assert.ok(ids.has(id), `Missing HTML element #${id}`);
  }
  for (const id of ["snapshotBtn", "clearSceneBtn", "checkPictureBtn", "guideStepCard", "taskSourceNote", "taskReadback", "soundToggle", "signOutBtn", "cameraDeviceSelect"]) {
    assert.ok(ids.has(id), `Critical feature #${id} was lost`);
  }
  assert.match(script, /function renderScene\(/);
  assert.match(script, /function drawSmoothTargetContour\(/);
  assert.match(script, /showHueSeeRegionLabels/);
  assert.match(memory, /export function deleteTask\(/);
  assert.match(parser, /export function isSortTask\(/);
});

test("task save/read/complete/remove API is always account-scoped", async () => {
  const filename = fileURLToPath(new URL("../server/routes/tasks.js", import.meta.url));
  let source = await readFile(filename, "utf8");
  const replacements = [
    ['import { Router } from "express";', 'const Router = () => ({ handlers: new Map(), post(path, handler) { this.handlers.set(`POST ${path}`, handler); }, get(path, handler) { this.handlers.set(`GET ${path}`, handler); }, patch(path, handler) { this.handlers.set(`PATCH ${path}`, handler); }, delete(path, handler) { this.handlers.set(`DELETE ${path}`, handler); } });'],
    ['import { ObjectId } from "mongodb";', 'const ObjectId = class { constructor(id) { this.id = id; } toString() { return this.id; } static isValid(id) { return /^[0-9a-f]{24}$/.test(id); } };'],
    ['import { getDb } from "../db.js";', 'const getDb = () => globalThis.__hueTasksTestDb;']
  ];
  for (const [before, after] of replacements) {
    assert.ok(source.includes(before)); source = source.replace(before, after);
  }
  const router = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
  const rows = [];
  let n = 0;
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
  const collection = {
    async findOneAndUpdate(filter, update) {
      const row = rows.find((row) => match(row, filter));
      if (!row) return null;
      Object.assign(row, update.$set);
      if (update.$unset) for (const key of Object.keys(update.$unset)) delete row[key];
      return structuredClone(row);
    },
    async insertOne(record) { const insertedId = (++n).toString(16).padStart(24, "0"); rows.push({ ...record, _id: insertedId }); return { insertedId }; },
    find(filter) {
      return { sort() { return this; }, async toArray() { return structuredClone(rows.filter((row) => match(row, filter))); } };
    },
    async deleteOne(filter) {
      const index = rows.findIndex((row) => match(row, filter));
      if (index < 0) return { deletedCount: 0 };
      rows.splice(index, 1); return { deletedCount: 1 };
    }
  };
  globalThis.__hueTasksTestDb = { collection: () => collection };
  async function call(method, route, user, body = {}, params = {}, query = {}) {
    const fn = router.handlers.get(`${method} ${route}`);
    assert.ok(fn, `Route ${method} ${route} missing`);
    const result = { code: 200, body: null };
    const res = { status(code) { result.code = code; return this; }, json(data) { result.body = data; return this; } };
    await fn({ user: { id: user }, body, params, query }, res);
    return result;
  }
  try {
    const image = { mimeType: "image/jpeg", data: "aGVsbG8=" };
    const created = await call("POST", "/", "user-a", { summary: "Find pen", color: "pink", object: "pen", sceneImage: image,
      locations: [{ label: "pen", role: "target", box: { x: 0.2, y: 0.1, width: 0.2, height: 0.3 } }], relation: "into" });
    assert.equal(created.code, 201);
    assert.equal(created.body.sessionId, "user-a");
    assert.deepEqual(created.body.sceneImage, image);
    const id = created.body._id;
    const other = await call("GET", "/", "user-b", {}, {}, { sessionId: "user-a" });
    assert.equal(other.body.length, 0, "Query string must not override account owner");
    assert.equal((await call("PATCH", "/:id", "user-b", { completed: true, sessionId: "user-a" }, { id })).code, 404);
    assert.equal((await call("DELETE", "/:id", "user-b", {}, { id }, { sessionId: "user-a" })).code, 404);
    assert.equal((await call("PATCH", "/:id", "user-a", { completed: true }, { id })).body.completed, true);
    assert.equal((await call("DELETE", "/:id", "user-a", {}, { id })).body.deleted, true);
    assert.equal((await call("GET", "/", "user-a")).body.length, 0);
  } finally { delete globalThis.__hueTasksTestDb; }
});
