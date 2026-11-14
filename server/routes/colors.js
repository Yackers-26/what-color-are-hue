// HueMemory palette: colors a user saved from the camera.
import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

const router = Router();
const colors = () => getDb().collection("colors");

// Save a color. Saving the same shade again in the same session bumps timesSaved.
router.post("/", async (req, res) => {
  const { colorName, shade, hex, rgb, sessionId } = req.body ?? {};

  if (!colorName || !shade || !sessionId) {
    return res.status(400).json({ error: "colorName, shade and sessionId are required" });
  }

  const result = await colors().findOneAndUpdate(
    { sessionId, shade },
    {
      $set: { colorName, hex, rgb, lastIdentified: new Date() },
      $inc: { timesSaved: 1 }
    },
    { upsert: true, returnDocument: "after" }
  );

  res.status(201).json(result);
});

// Stats: how many colors were saved per color category (Red, Blue, ...).
// Must be declared before "/:id" style routes.
router.get("/stats", async (req, res) => {
  const match = req.query.sessionId ? { sessionId: req.query.sessionId } : {};

  const stats = await colors().aggregate([
    { $match: match },
    {
      $group: {
        _id: "$colorName",
        shades: { $sum: 1 },
        timesSaved: { $sum: "$timesSaved" },
        lastIdentified: { $max: "$lastIdentified" }
      }
    },
    { $sort: { timesSaved: -1 } },
    { $project: { _id: 0, colorName: "$_id", shades: 1, timesSaved: 1, lastIdentified: 1 } }
  ]).toArray();

  res.json(stats);
});

// List the palette for one session, most recent first.
router.get("/", async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "sessionId query param is required" });

  const list = await colors().find({ sessionId }).sort({ lastIdentified: -1 }).toArray();
  res.json(list);
});

// Delete one saved color.
router.delete("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid id" });

  const result = await colors().deleteOne({ _id: new ObjectId(req.params.id) });
  if (result.deletedCount === 0) return res.status(404).json({ error: "Color not found" });
  res.json({ deleted: 1 });
});

// Reset the whole palette for one session.
router.delete("/", async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "sessionId query param is required" });

  const result = await colors().deleteMany({ sessionId });
  res.json({ deleted: result.deletedCount });
});

export default router;
