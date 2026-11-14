// Turns a spoken/typed request into a structured task using Gemini.
// Works as soon as GEMINI_API_KEY is in .env. Until then it returns a clear 503 error.
import { Router } from "express";
import { GoogleGenAI, Type } from "@google/genai";

const router = Router();
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const taskSchema = {
  type: Type.OBJECT,
  properties: {
    color: { type: Type.STRING, description: "The color the user cares about, e.g. red" },
    object: { type: Type.STRING, description: "The object, e.g. shirt" },
    action: { type: Type.STRING, description: "What to do, e.g. find, sort, put" },
    destination: { type: Type.STRING, description: "Where it goes, if mentioned, e.g. blue bin" }
  },
  required: ["color", "object", "action"]
};

let ai = null;

router.post("/", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: "Gemini is not set up yet. Add GEMINI_API_KEY to .env and restart the server."
    });
  }

  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `Extract the color task from this request from a color-blind user: "${text}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: taskSchema
      }
    });

    res.json(JSON.parse(response.text));
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(502).json({ error: "Gemini request failed", details: err.message });
  }
});

export default router;
