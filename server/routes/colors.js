import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

const router = Router();
const colors = () => getDb().collection("colors");
const owner = (req) => req.user.id; // Never trust a sessionId supplied by the browser.

router.post("/", async (req, res) => {
  const { colorName, shade, hex, rgb } = req.body ?? {};
  if (typeof colorName !== "string" || !colorName.trim() || colorName.length > 60 || typeof shade !== "string" || !shade.trim() || shade.length > 120)
    return res.status(400).json({ error: "A valid color name and shade are required." });
  const cleanHex = typeof hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : null;
  const cleanRgb = rgb && ["r", "g", "b"].every(k => Number.isInteger(rgb[k]) && rgb[k] >= 0 && rgb[k] <= 255) ? { r: rgb.r, g: rgb.g, b: rgb.b } : null;
  const result = await colors().findOneAndUpdate(
    { sessionId: owner(req), shade },
    { $set: { colorName, hex: cleanHex, rgb: cleanRgb, lastIdentified: new Date() }, $inc: { timesSaved: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  res.status(201).json(result);
});
router.get("/stats", async (req, res) => {
  const stats = await colors().aggregate([
    { $match: { sessionId: owner(req) } },
    { $group: { _id: "$colorName", shades: { $sum: 1 }, timesSaved: { $sum: "$timesSaved" }, lastIdentified: { $max: "$lastIdentified" } } },
    { $sort: { timesSaved: -1 } },
    { $project: { _id: 0, colorName: "$_id", shades: 1, timesSaved: 1, lastIdentified: 1 } }
  ]).toArray();
  res.json(stats);
});
router.get("/", async (req, res) => {
  res.json(await colors().find({ sessionId: owner(req) }).sort({ lastIdentified: -1 }).toArray());
});
router.delete("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid color id" });
  const result = await colors().deleteOne({ _id: new ObjectId(req.params.id), sessionId: owner(req) });
  if (!result.deletedCount) return res.status(404).json({ error: "Color not found" });
  res.json({ deleted: 1 });
});
router.delete("/", async (req, res) => {
  const result = await colors().deleteMany({ sessionId: owner(req) });
  res.json({ deleted: result.deletedCount });
});
export default router;
