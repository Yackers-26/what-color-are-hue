import { Router } from "express";
import { GoogleGenAI, Type } from "@google/genai";

const router = Router();
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const visualCueSchema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING, description: "Short label to show in a camera overlay chip" },
    role: { type: Type.STRING, description: "One of target, destination, reference, or action" },
    color: { type: Type.STRING, description: "Color only when the instruction explicitly identifies one" },
    object: { type: Type.STRING, description: "Object or visual subject, when stated" },
    location: { type: Type.STRING, description: "Natural-language location or landmark, when stated" },
    direction: { type: Type.STRING, description: "Explicit relative direction such as left, right, above, below, or center; otherwise empty" },
    relation: { type: Type.STRING, description: "Spatial relationship such as beside, inside, behind, or on top of" }
  },
  required: ["label", "role"]
};

const taskSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "Concise plain-language description of the complete task" },
    steps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Short, ordered actions the user can follow"
    },
    visualCues: {
      type: Type.ARRAY,
      items: visualCueSchema,
      description: "Useful target, destination, reference, or action cues for a camera overlay"
    },
    targetColor: { type: Type.STRING, description: "A target color if the instruction explicitly names one; otherwise empty" },
    targetObject: { type: Type.STRING, description: "The target object if one is stated; otherwise empty" },
    action: { type: Type.STRING, description: "The main requested action, if identifiable" },
    destination: { type: Type.STRING, description: "Any destination or landmark exactly as described; never constrain to predefined boxes" },
    completionHint: { type: Type.STRING, description: "How the user can tell the task is complete, without claiming the camera can verify unsupported actions" }
  },
  required: ["summary", "steps", "visualCues"]
};

let ai = null;

router.post("/", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: "Gemini is not configured. Add GEMINI_API_KEY to .env and restart the server."
    });
  }

  const { text = "", image = null } = req.body ?? {};
  const instruction = typeof text === "string" ? text.trim() : "";

  if (!instruction && !image) {
    return res.status(400).json({ error: "Enter an instruction or attach an image." });
  }

  let imagePart = null;
  if (image) {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(image.mimeType) || typeof image.data !== "string") {
      return res.status(400).json({ error: "Use a JPG, PNG, WEBP, or GIF instruction image." });
    }
    if (image.data.length > 10_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
      return res.status(413).json({ error: "The instruction image is too large or invalid." });
    }
    imagePart = { inlineData: { mimeType: image.mimeType, data: image.data } };
  }

  try {
    ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = [
      "You are the task interpreter for an accessibility camera assistant.",
      "Interpret the complete instruction, whatever its subject or action. Do not assume it is a color-sorting task, does not require a box, and does not always have a destination.",
      "Return a concise summary and practical ordered steps that preserve the user's actual intent.",
      "Extract only visual cues that are explicitly stated or clearly visible in the instruction: target, destination, reference, or action.",
      "For each visual cue, provide a short label and role. Include color, object, location, direction, and spatial relation only when supported by the instruction or image.",
      "Do not invent colors, objects, destinations, landmarks, or directions. Leave unknown optional fields empty.",
      "If a cue can be matched to a color region in a camera image, include its color. If the instruction is not visually trackable, still provide useful human-readable steps and a completion hint.",
      "Never claim that the camera can verify arbitrary object identity or complex actions. The camera can only provide approximate color-region guidance in this prototype.",
      instruction ? `Instruction text: ${instruction}` : "Read and interpret the instruction from the attached image."
    ].join("\n");

    const parts = [{ text: prompt }];
    if (imagePart) parts.push(imagePart);

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: taskSchema
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    if (!parsed.summary) {
      return res.status(422).json({ error: "Gemini could not interpret a usable task. Try rephrasing the instruction." });
    }

    const visualCues = Array.isArray(parsed.visualCues)
      ? parsed.visualCues.slice(0, 8).map((cue) => ({
          label: String(cue?.label || cue?.object || cue?.role || "Guide").trim().slice(0, 90),
          role: String(cue?.role || "reference").trim().toLowerCase(),
          color: String(cue?.color || "").trim().slice(0, 50),
          object: String(cue?.object || "").trim().slice(0, 90),
          location: String(cue?.location || "").trim().slice(0, 120),
          direction: String(cue?.direction || "").trim().slice(0, 40),
          relation: String(cue?.relation || "").trim().slice(0, 90)
        }))
      : [];

    res.json({
      summary: String(parsed.summary).trim(),
      steps: Array.isArray(parsed.steps) ? parsed.steps.map((step) => String(step).trim()).filter(Boolean).slice(0, 8) : [],
      visualCues,
      targetColor: String(parsed.targetColor || "").trim(),
      targetObject: String(parsed.targetObject || "").trim(),
      action: String(parsed.action || "").trim(),
      destination: String(parsed.destination || "").trim(),
      completionHint: String(parsed.completionHint || "").trim()
    });
  } catch (error) {
    console.error("Gemini error:", error);
    res.status(502).json({ error: "Gemini could not interpret this instruction. Try again or save it as a manual guide." });
  }
});

export default router;
