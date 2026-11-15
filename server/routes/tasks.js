import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

const router = Router();
const tasks = () => getDb().collection("tasks");
const owner = (req) => req.user.id;

router.post("/", async (req, res) => {
  const { summary = "", steps = [], visualCues = [], color = "", object = "", action = "", destination = "" } = req.body ?? {};
  const taskSummary = String(summary || [action, color, object, destination].filter(Boolean).join(" ")).trim().slice(0, 500);
  if (!taskSummary) return res.status(400).json({ error: "A task summary is required" });
  const task = {
    summary: taskSummary,
    steps: Array.isArray(steps) ? steps.map(s => String(s).slice(0, 300)).slice(0, 8) : [],
    visualCues: Array.isArray(visualCues) ? visualCues.slice(0, 8) : [],
    color: String(color).slice(0, 60), object: String(object).slice(0, 80), action: String(action).slice(0, 80), destination: String(destination).slice(0, 100),
    sessionId: owner(req), completed: false, createdAt: new Date()
  };
  const result = await tasks().insertOne(task);
  res.status(201).json({ _id: result.insertedId, ...task });
});
router.get("/", async (req, res) => {
  const filter = { sessionId: owner(req) };
  if (req.query.completed !== undefined) filter.completed = req.query.completed === "true";
  res.json(await tasks().find(filter).sort({ createdAt: -1 }).toArray());
});
router.patch("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid task id" });
  const allowed = ["summary", "steps", "visualCues", "color", "object", "action", "destination", "completed"];
  const updates = {};
  for (const field of allowed) {
    if (req.body?.[field] === undefined) continue;
    if (field === "completed") { if (typeof req.body[field] !== "boolean") return res.status(400).json({ error: "completed must be a boolean" }); updates.completed = req.body[field]; }
    else if (field === "steps") { if (!Array.isArray(req.body.steps)) return res.status(400).json({ error: "steps must be a list" }); updates.steps = req.body.steps.map(x => String(x).slice(0, 300)).slice(0, 8); }
    else if (field === "visualCues") { if (!Array.isArray(req.body.visualCues)) return res.status(400).json({ error: "visualCues must be a list" }); updates.visualCues = req.body.visualCues.slice(0, 8); }
    else updates[field] = String(req.body[field]).slice(0, field === "summary" ? 500 : 100);
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: "No task changes supplied" });
  const update = { $set: updates };
  if (updates.completed === true) update.$set.completedAt = new Date();
  if (updates.completed === false) update.$unset = { completedAt: "" };
  const result = await tasks().findOneAndUpdate({ _id: new ObjectId(req.params.id), sessionId: owner(req) }, update, { returnDocument: "after" });
  if (!result) return res.status(404).json({ error: "Task not found" });
  res.json(result);
});
export default router;
