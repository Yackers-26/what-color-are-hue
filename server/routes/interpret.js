import { Router } from "express";
import { GoogleGenAI, Type } from "@google/genai";

const router = Router();
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const locationSchema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING, description: "Short name of what is boxed, for example 'pink pen' or 'Box B'" },
    role: { type: Type.STRING, description: "target (the thing to find or move), destination (where it goes), or other" },
    box_2d: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
      description: "Bounding box [ymin, xmin, ymax, xmax] with each value from 0 to 1000"
    },
    description: { type: Type.STRING, description: "Where it is in plain words, without relying on color" }
  },
  required: ["label", "role", "box_2d"]
};

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
    targetColor: { type: Type.STRING, description: "The color of the object to act on, as the user said it (for example pink, green, navy) if the instruction names or shows one; otherwise empty" },
    targetObject: { type: Type.STRING, description: "The target object if one is stated; otherwise empty" },
    action: { type: Type.STRING, description: "The main requested action, if identifiable" },
    destination: { type: Type.STRING, description: "Where the object should end up, exactly as described (for example Box B, the top shelf); empty if there is none" },
    relation: { type: Type.STRING, description: "How the object relates to the destination: into, onto, next to, under, and so on; empty if there is no destination" },
    completionHint: { type: Type.STRING, description: "How the user can tell the task is complete" },
    answer: { type: Type.STRING, description: "One or two short sentences telling the user where the target is in the picture, using position words such as left, right, top, or in someone's hand. Empty if there is no picture." },
    locations: {
      type: Type.ARRAY,
      items: locationSchema,
      description: "Boxes around the target and destination as they appear in the picture. Empty if there is no picture or they are not visible."
    }
  },
  required: ["summary", "steps", "visualCues"]
};

const checkSchema = {
  type: Type.OBJECT,
  properties: {
    done: { type: Type.BOOLEAN, description: "True only if the picture clearly shows the task is complete" },
    message: { type: Type.STRING, description: "One short sentence for the user: what you see and, if not done, what is still needed" },
    locations: { type: Type.ARRAY, items: locationSchema, description: "Boxes around the target and destination in this picture" }
  },
  required: ["done", "message"]
};

let ai = null;

function geminiReady(res) {
  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      error: "Gemini is not configured. Add GEMINI_API_KEY to .env and restart the server."
    });
    return false;
  }
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return true;
}

// Returns { part } for a valid { mimeType, data } image, or { error } to send back.
function readImage(image) {
  if (!image) return { part: null };
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(image.mimeType) || typeof image.data !== "string") {
    return { error: "Use a JPG, PNG, WEBP, or GIF picture.", status: 400 };
  }
  if (image.data.length > 10_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
    return { error: "The picture is too large or invalid.", status: 413 };
  }
  return { part: { inlineData: { mimeType: image.mimeType, data: image.data } } };
}

function cleanLocations(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 6).map((item) => {
    const box = Array.isArray(item?.box_2d) ? item.box_2d.map((value) => Math.min(1000, Math.max(0, Number(value) || 0))) : [];
    if (box.length !== 4) return null;
    const [y1, x1, y2, x2] = box;
    if (y2 <= y1 || x2 <= x1) return null;
    return {
      label: String(item.label || "").trim().slice(0, 60),
      role: ["target", "destination"].includes(String(item.role).toLowerCase()) ? String(item.role).toLowerCase() : "other",
      box: { x: x1 / 1000, y: y1 / 1000, width: (x2 - x1) / 1000, height: (y2 - y1) / 1000 },
      description: String(item.description || "").trim().slice(0, 200)
    };
  }).filter(Boolean);
}

async function askGemini(parts, schema) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", responseSchema: schema }
  });
  return JSON.parse(response.text || "{}");
}

// Gemini's object-detection style request: works better than asking for boxes inside a bigger answer.
function parseJsonList(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.locations)) return parsed.locations;
    if (Array.isArray(parsed?.objects)) return parsed.objects;
    return parsed && typeof parsed === "object" ? [parsed] : [];
  } catch {
    return [];
  }
}

async function detectObjects(imagePart, target, destination) {
  const things = [target && `the ${target} (role "target")`, destination && `${destination} (role "destination")`].filter(Boolean);
  if (!things.length) return [];
  const prompt = [
    `Detect ${things.join(" and ")} in this image.`,
    "Output a JSON list. Each entry has \"box_2d\" as [ymin, xmin, ymax, xmax] normalized to 0-1000, a short \"label\", and \"role\".",
    "Box the whole object. Match the color carefully. Leave out anything that is not visible. Output only the JSON list."
  ].join("\n");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }],
    config: { responseMimeType: "application/json", temperature: 0.2 }
  });
  const locations = cleanLocations(parseJsonList(response.text));
  console.log(`HueDo found ${locations.length} location(s) for "${things.join(", ")}":`, JSON.stringify(locations));
  return locations;
}

router.post("/", async (req, res) => {
  if (!geminiReady(res)) return;

  const { text = "", image = null } = req.body ?? {};
  const instruction = typeof text === "string" ? text.trim() : "";
  if (!instruction && !image) {
    return res.status(400).json({ error: "Enter an instruction or attach a picture." });
  }

  const { part: imagePart, error, status } = readImage(image);
  if (error) return res.status(status).json({ error });

  try {
    const prompt = [
      "You are the task interpreter for an accessibility app for people who cannot rely on color.",
      "Interpret the complete instruction, whatever its subject or action. Do not assume it is a color-sorting task or that it has a destination.",
      "Split the instruction into its parts: targetColor (the color of the thing to act on, as the user said it), targetObject (the thing, without the color word), action (one verb such as place, put, find, press), destination, and relation.",
      "Example: 'Place the green block into Box B.' -> targetColor green, targetObject block, action place, destination Box B, relation into.",
      "Example: 'Where is the pink pen?' -> targetColor pink, targetObject pen, action find, no destination.",
      "Steps must break the task down for someone who cannot rely on color. Never just repeat the instruction as one step.",
      imagePart
        ? "A picture of the user's surroundings is attached. Find the target object (and the destination, if any) in it. For each one you can actually see, add a location with box_2d as [ymin, xmin, ymax, xmax] scaled 0 to 1000. Look carefully at colors: do not box skin, lips, or clothing unless that is what was asked for. If the target is not visible, return no target location and say so in answer. If there is no instruction text, the picture may contain written instructions: read them."
        : "No picture is attached, so return empty locations and an empty answer.",
      "Do not invent objects, destinations, or directions. Leave unknown optional fields empty.",
      instruction ? `Instruction text: ${instruction}` : "Read and interpret the instruction from the attached picture."
    ].join("\n");

    const parts = [{ text: prompt }];
    if (imagePart) parts.push(imagePart);
    const parsed = await askGemini(parts, taskSchema);

    if (!parsed.summary) {
      return res.status(422).json({ error: "Gemini could not interpret a usable task. Try rephrasing the instruction." });
    }

    let locations = imagePart ? cleanLocations(parsed.locations) : [];
    if (imagePart) {
      const target = [parsed.targetColor, parsed.targetObject].filter(Boolean).join(" ").trim() || String(parsed.summary);
      try {
        const detected = await detectObjects(imagePart, target, String(parsed.destination || "").trim());
        if (detected.length) locations = detected;
      } catch (error) {
        console.error("Gemini detection error:", error.message);
      }
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
      targetColor: String(parsed.targetColor || "").trim().toLowerCase(),
      targetObject: String(parsed.targetObject || "").trim(),
      action: String(parsed.action || "").trim().toLowerCase(),
      destination: String(parsed.destination || "").trim(),
      relation: String(parsed.relation || "").trim().toLowerCase(),
      completionHint: String(parsed.completionHint || "").trim(),
      answer: imagePart ? String(parsed.answer || "").trim() : "",
      locations
    });
  } catch (error) {
    console.error("Gemini error:", error);
    res.status(502).json({ error: "Gemini could not interpret this instruction. Try again." });
  }
});

// Checks a new picture to see whether the task is finished.
router.post("/check", async (req, res) => {
  if (!geminiReady(res)) return;

  const { image = null, task = {} } = req.body ?? {};
  if (!image) return res.status(400).json({ error: "Take a new picture to check the task." });
  const { part: imagePart, error, status } = readImage(image);
  if (error) return res.status(status).json({ error });

  const summary = String(task.summary || "").slice(0, 300);
  const target = String(task.target || "").slice(0, 100);
  const destination = String(task.destination || "").slice(0, 100);

  try {
    const prompt = [
      "You check whether a simple physical task has been completed, for a user who cannot rely on color.",
      `Task: ${summary}`,
      target ? `Target object: ${target}` : "",
      destination ? `Destination: ${destination}` : "",
      "Look at the attached picture. Set done to true only if it clearly shows the task is complete (for example the target object is inside or on the destination).",
      "Add locations with box_2d as [ymin, xmin, ymax, xmax] scaled 0 to 1000 for the target and destination if you can see them.",
      "Write message as one short sentence, without relying on color alone."
    ].filter(Boolean).join("\n");

    const parsed = await askGemini([{ text: prompt }, imagePart], checkSchema);
    let locations = cleanLocations(parsed.locations);
    try {
      const detected = await detectObjects(imagePart, target, destination);
      if (detected.length) locations = detected;
    } catch (error) {
      console.error("Gemini detection error:", error.message);
    }
    res.json({
      done: parsed.done === true,
      message: String(parsed.message || "").trim(),
      locations
    });
  } catch (error) {
    console.error("Gemini check error:", error);
    res.status(502).json({ error: "Gemini could not check this picture. Try again." });
  }
});

export default router;
