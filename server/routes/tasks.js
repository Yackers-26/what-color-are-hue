// Accessible task library: tasks like "put the red shirt in the blue bin".
import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

const router = Router();
const tasks = () => getDb().collection("tasks");

// Create a task. The fields match what Gemini returns from /api/interpret.
router.post("/", async (req, res) => {
  const { color, object, action, destination, sessionId } = req.body ?? {};

  if (!color || !object || !action) {
    return res.status(400).json({ error: "color, object and action are required" });
  }

  const task = {
    color,
    object,
    action,
    destination: destination ?? null,
    sessionId: sessionId ?? null,
    completed: false,
    createdAt: new Date()
  };

  const result = await tasks().insertOne(task);
  res.status(201).json({ _id: result.insertedId, ...task });
});

// List tasks, newest first. Optional filters: ?sessionId=...&completed=true|false
router.get("/", async (req, res) => {
  const filter = {};
  if (req.query.sessionId) filter.sessionId = req.query.sessionId;
  if (req.query.completed !== undefined) filter.completed = req.query.completed === "true";

  const list = await tasks().find(filter).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

// Update a task, e.g. { "completed": true }.
router.patch("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid id" });

  const allowed = ["color", "object", "action", "destination", "completed"];
  const updates = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: `Send at least one of: ${allowed.join(", ")}` });
  }
  if (updates.completed === true) updates.completedAt = new Date();

  const result = await tasks().findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: updates },
    { returnDocument: "after" }
  );

  if (!result) return res.status(404).json({ error: "Task not found" });
  res.json(result);
});

export default router;
