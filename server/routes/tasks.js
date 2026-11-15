import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

const router = Router();
const tasks = () => getDb().collection("tasks");

router.post("/", async (req, res) => {
  const {
    summary = "",
    steps = [],
    visualCues = [],
    color = "",
    object = "",
    action = "",
    destination = "",
    relation = "",
    sessionId
  } = req.body ?? {};

  const taskSummary = String(summary || [action, color, object, destination].filter(Boolean).join(" ")).trim();
  if (!taskSummary || !sessionId) {
    return res.status(400).json({ error: "A task summary and sessionId are required" });
  }

  const task = {
    summary: taskSummary,
    steps: Array.isArray(steps) ? steps.map((step) => String(step).slice(0, 300)).slice(0, 8) : [],
    visualCues: Array.isArray(visualCues) ? visualCues.slice(0, 8) : [],
    color: String(color || "").trim(),
    object: String(object || "").trim(),
    action: String(action || "").trim(),
    destination: String(destination || "").trim(),
    relation: String(relation || "").trim(),
    sessionId: String(sessionId),
    completed: false,
    createdAt: new Date()
  };

  // Starting the same guide again reuses the open saved guide instead of adding a copy.
  const { createdAt, completed, ...latest } = task;
  const existing = await tasks().findOneAndUpdate(
    { sessionId: task.sessionId, summary: task.summary, completed: false },
    { $set: { ...latest, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (existing) return res.json(existing);

  const result = await tasks().insertOne(task);
  res.status(201).json({ _id: result.insertedId, ...task });
});

router.get("/", async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "sessionId query param is required" });

  const filter = { sessionId };
  if (req.query.completed !== undefined) filter.completed = req.query.completed === "true";

  const list = await tasks().find(filter).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

router.patch("/:id", async (req, res) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid id" });

  const allowed = ["summary", "steps", "visualCues", "color", "object", "action", "destination", "relation", "completed"];
  const updates = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: `Send at least one of: ${allowed.join(", ")}` });
  }

  const update = { $set: updates };
  if (updates.completed === true) update.$set.completedAt = new Date();
  if (updates.completed === false) update.$unset = { completedAt: "" };

  const result = await tasks().findOneAndUpdate(
    { _id: new ObjectId(req.params.id), sessionId },
    update,
    { returnDocument: "after" }
  );

  if (!result) return res.status(404).json({ error: "Task not found" });
  res.json(result);
});

router.delete("/:id", async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "sessionId query param is required" });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid id" });

  const result = await tasks().deleteOne({ _id: new ObjectId(req.params.id), sessionId: String(sessionId) });
  if (!result.deletedCount) return res.status(404).json({ error: "Task not found" });
  res.json({ deleted: true });
});

export default router;
