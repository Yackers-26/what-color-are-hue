import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

const router = Router();
const tasks = () => getDb().collection("tasks");
// Session ownership comes exclusively from the authenticated cookie, not user-controlled JSON/query fields.
const owner = (req) => req.user.id;
const cleanString = (value, max) => String(value ?? "").trim().slice(0, max);

function cleanLocations(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 16).flatMap((location) => {
    const box = location?.box;
    if (!box || !["x", "y", "width", "height"].every((key) => Number.isFinite(box[key]))) return [];
    const { x, y, width, height } = box;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return [];
    return [{
      label: cleanString(location.label, 60),
      role: ["target", "destination"].includes(location.role) ? location.role : "other",
      description: cleanString(location.description, 200),
      box: { x, y, width, height }
    }];
  });
}
function cleanImage(image) {
  if (image == null) return null;
  if (image.mimeType !== "image/jpeg" || typeof image.data !== "string"
    || image.data.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return undefined;
  return { mimeType: "image/jpeg", data: image.data };
}
function cleanSteps(steps) {
  return Array.isArray(steps) ? steps.slice(0, 12).map((step) => cleanString(step, 350)) : [];
}
function cleanVisualCues(cues) {
  return Array.isArray(cues) ? cues.slice(0, 12).map((cue) => ({
    label: cleanString(cue?.label, 90), role: cleanString(cue?.role, 24),
    color: cleanString(cue?.color, 50), object: cleanString(cue?.object, 90),
    location: cleanString(cue?.location, 120), direction: cleanString(cue?.direction, 40),
    relation: cleanString(cue?.relation, 90)
  })) : [];
}
function cleanGroups(groups) {
  return Array.isArray(groups) ? groups.slice(0, 16).map((group) => ({
    name: cleanString(group?.name, 70), count: Math.min(1000, Math.max(0, Math.floor(Number(group?.count) || 0)))
  })).filter((group) => group.name) : [];
}

router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const summary = cleanString(body.summary || [body.action, body.color, body.object, body.destination].filter(Boolean).join(" "), 500);
  if (!summary) return res.status(400).json({ error: "A task summary is required" });
  const sceneImage = cleanImage(body.sceneImage);
  if (sceneImage === undefined) return res.status(400).json({ error: "Saved guide photo must be a JPEG under 6MB." });
  const task = {
    summary, steps: cleanSteps(body.steps), visualCues: cleanVisualCues(body.visualCues),
    color: cleanString(body.color, 60), object: cleanString(body.object, 80),
    action: cleanString(body.action, 80), destination: cleanString(body.destination, 100),
    relation: cleanString(body.relation, 80), answer: cleanString(body.answer, 800),
    groups: cleanGroups(body.groups), locations: cleanLocations(body.locations), sceneImage,
    sessionId: owner(req), completed: false, createdAt: new Date()
  };
  // Re-running an unfinished guide replaces its saved details rather than creating duplicates.
  const { createdAt, completed, ...details } = task;
  const existing = await tasks().findOneAndUpdate(
    { sessionId: owner(req), summary, completed: false },
    { $set: { ...details, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (existing) return res.json(existing);
  const result = await tasks().insertOne(task);
  return res.status(201).json({ _id: result.insertedId, ...task });
});

router.get("/", async (req, res) => {
  const filter = { sessionId: owner(req) };
  if (req.query.completed !== undefined) filter.completed = req.query.completed === "true";
  res.json(await tasks().find(filter).sort({ createdAt: -1 }).toArray());
});

router.patch("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid task id" });
  const body = req.body ?? {};
  const fields = ["summary", "steps", "visualCues", "color", "object", "action", "destination", "relation", "answer", "groups", "locations", "completed"];
  const updates = {};
  for (const field of fields) {
    if (body[field] === undefined) continue;
    if (field === "completed") {
      if (typeof body.completed !== "boolean") return res.status(400).json({ error: "completed must be a boolean" });
      updates.completed = body.completed;
    } else if (["steps", "visualCues", "groups", "locations"].includes(field)) {
      if (!Array.isArray(body[field])) return res.status(400).json({ error: `${field} must be a list` });
      updates[field] = ({ steps: cleanSteps, visualCues: cleanVisualCues, groups: cleanGroups, locations: cleanLocations })[field](body[field]);
    } else {
      updates[field] = cleanString(body[field], { summary: 500, color: 60, object: 80, action: 80, destination: 100, relation: 80, answer: 800 }[field]);
    }
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: "No task changes supplied" });
  if (updates.completed === true) updates.completedAt = new Date();
  const update = { $set: updates };
  if (updates.completed === false) update.$unset = { completedAt: "" };
  const result = await tasks().findOneAndUpdate(
    { _id: new ObjectId(req.params.id), sessionId: owner(req) }, update, { returnDocument: "after" }
  );
  if (!result) return res.status(404).json({ error: "Task not found" });
  res.json(result);
});

router.delete("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid task id" });
  const result = await tasks().deleteOne({ _id: new ObjectId(req.params.id), sessionId: owner(req) });
  if (!result.deletedCount) return res.status(404).json({ error: "Task not found" });
  res.json({ deleted: true });
});

export default router;
