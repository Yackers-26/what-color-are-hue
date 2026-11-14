// Gemini reads color-dependent instructions (typed text and/or a photo) and turns them
// into structured tasks, e.g. "Put the red marker in container A" ->
// { color: "red", object: "marker", action: "move", destination: "A" }.
// Only called on request (never per webcam frame). Live color detection stays in JavaScript.
// Works as soon as GEMINI_API_KEY is in .env. Until then it returns a clear 503 error.
import { Router } from "express";
import { GoogleGenAI, Type } from "@google/genai";

const router = Router();
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const taskSchema = {
  type: Type.OBJECT,
  properties: {
    color: { type: Type.STRING, description: "The color the task depends on, e.g. red" },
    object: { type: Type.STRING, description: "The item, e.g. marker" },
    action: { type: Type.STRING, description: "What to do, e.g. move, sort, pick up, find" },
    destination: { type: Type.STRING, description: "Where it goes, e.g. container A. Empty string if none." }
  },
  required: ["color", "object", "action", "destination"]
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    tasks: { type: Type.ARRAY, items: taskSchema },
    summary: { type: Type.STRING, description: "One short sentence describing what the user should do" }
  },
  required: ["tasks", "summary"]
};

const INSTRUCTIONS = `You help a color-blind user follow color-dependent instructions.
Read the instruction text and/or the photo (it may show written instructions, a worksheet,
or items that need sorting by color). Return one task per color-dependent step, in order.
Use simple lowercase color names (red, orange, yellow, green, blue, purple, pink, brown, black, white, gray).
If the photo shows items to sort but no written rule, create one "sort" task per distinct color you see.
If there is nothing color-related, return an empty tasks list and explain in summary.`;

// Accepts "data:image/jpeg;base64,...." or plain base64 plus a mimeType.
function parseImage(image, mimeType) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(image);
  const type = match ? match[1] : mimeType || "image/jpeg";
  const data = match ? match[2] : image;
  if (!IMAGE_TYPES.includes(type)) throw new Error(`Unsupported image type: ${type}`);
  return { mimeType: type, data };
}

let ai = null;

router.post("/", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: "Gemini is not set up yet. Add GEMINI_API_KEY to .env and restart the server."
    });
  }

  const { text, image, mimeType } = req.body ?? {};
  if (!text && !image) return res.status(400).json({ error: "Send text, image, or both" });

  const parts = [];
  if (image) {
    try {
      parts.push({ inlineData: parseImage(image, mimeType) });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  parts.push({ text: text ? `${INSTRUCTIONS}\n\nInstruction text: "${text}"` : INSTRUCTIONS });

  try {
    ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema
      }
    });

    const result = JSON.parse(response.text);
    // Turn "" destinations into null so they match the tasks collection.
    result.tasks = (result.tasks ?? []).map(task => ({ ...task, destination: task.destination || null }));
    res.json(result);
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(502).json({ error: "Gemini request failed", details: err.message });
  }
});

export default router;
