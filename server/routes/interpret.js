import { Router } from "express";
import { GoogleGenAI, Type } from "@google/genai";
import { parseInstruction, describeTarget, describeTask, isSortTask } from "../../public/js/hueDoParser.js";

const router = Router();
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Free Gemini keys have a small per-minute limit for each model (error 429), and models can be busy (503).
// Strategy: never wait long. If a model is limited, rest it for a minute and go straight to the next model.
const BUSY = [429, 500, 503];
const SKIP = [400, 404]; // model missing or not allowed for this key: move on to the next one
const REQUEST_TIMEOUT_MS = 20000;
const isBusy = (error) => BUSY.includes(Number(error?.status)) || !Number(error?.status);
const restingUntil = new Map(); // model -> time it can be used again
let fallbackModels = null;
let lastGoodModel = null;

async function getFallbackModels() {
  if (fallbackModels) return fallbackModels;
  const fromEnv = String(process.env.GEMINI_FALLBACK_MODELS || "").split(",").map((name) => name.trim()).filter(Boolean);
  if (fromEnv.length) {
    fallbackModels = fromEnv;
  } else {
    // Ask Google which models this key can use, and keep the general "flash" ones.
    const names = [];
    try {
      const pager = await ai.models.list({ config: { pageSize: 100 } });
      for await (const model of pager) {
        const name = String(model.name || "").replace(/^models\//, "");
        const actions = model.supportedActions || [];
        if (!/flash/i.test(name) || /(image|tts|audio|live|embed|vision-only)/i.test(name)) continue;
        if (actions.length && !actions.includes("generateContent")) continue;
        names.push(name);
      }
    } catch (error) {
      console.warn("Could not list Gemini models:", error.message);
    }
    // Newest first, and "lite" models (fastest) ahead of the others.
    fallbackModels = names
      .filter((name) => name !== MODEL)
      .sort()
      .reverse()
      .sort((first, second) => Number(/lite/.test(second)) - Number(/lite/.test(first)))
      .slice(0, 6);
  }
  console.log("Gemini backup models:", fallbackModels.join(", ") || "(none found)");
  return fallbackModels;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateWithRetry(request, { avoidLite = false } = {}) {
  const backups = await getFallbackModels();
  let order = [...new Set([lastGoodModel, MODEL, ...backups].filter(Boolean))];
  if (avoidLite && order.some((model) => !/lite/.test(model))) order = order.filter((model) => !/lite/.test(model));
  const ready = order.filter((model) => (restingUntil.get(model) || 0) <= Date.now());
  let lastError = null;

  for (const model of ready.length ? ready : order) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      try {
        const response = await ai.models.generateContent({
          ...request,
          model,
          config: { ...request.config, httpOptions: { timeout: REQUEST_TIMEOUT_MS } }
        });
        if (model !== lastGoodModel) console.log(`Using Gemini model ${model}.`);
        console.log(`Gemini ${model} answered in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
        if (!avoidLite) lastGoodModel = model;
        response.modelUsed = model;
        return response;
      } catch (error) {
        lastError = error;
        const status = Number(error?.status);
        if (status === 429) {
          // Limit reached for this model: rest it for a minute and switch right away.
          restingUntil.set(model, Date.now() + 60_000);
          console.warn(`Gemini ${model} hit its rate limit (429). Switching models.`);
          break;
        }
        // A configured model may have been retired, be missing, or be unavailable
        // to this key; try the discovered alternatives instead of failing early.
        if (SKIP.includes(status)) {
          console.warn(`Gemini ${model} is unavailable (${status}). Trying an alternative model.`);
          break;
        }
        if (!isBusy(error)) throw error;
        if (attempt < 2 && status === 503) {
          console.warn(`Gemini ${model} is busy (503). Retrying once…`);
          await wait(800);
          continue;
        }
        console.warn(`Gemini ${model} failed (${status || error.message}). Switching models.`);
        break;
      }
    }
  }
  throw lastError;
}

function geminiErrorMessage(error, fallback) {
  const status = Number(error?.status);
  if (status === 429) return "Your Gemini key hit its free per-minute limit on every model. Wait about a minute and try again.";
  if (status === 503) return "Gemini is busy right now. Wait a few seconds and try again.";
  if (!status) return "Couldn't reach Gemini. Check your internet connection and try again.";
  if (status === 404) return "That Gemini model isn't available. Set GEMINI_MODEL in .env (for example gemini-3.8-flash) and restart the server.";
  if (status === 400 || status === 403) return "Gemini rejected the request. Check GEMINI_API_KEY in .env.";
  return fallback;
}

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

// Models word their boxes differently ("box_2d", "bbox", {ymin,...}, 0-1 or 0-1000). Accept all of them.
function readBox(item) {
  let raw = item?.box_2d ?? item?.box2d ?? item?.bbox ?? item?.box ?? item?.bounding_box ?? item?.boundingBox;
  if (raw && !Array.isArray(raw) && typeof raw === "object") {
    raw = [raw.ymin ?? raw.y_min ?? raw.top, raw.xmin ?? raw.x_min ?? raw.left, raw.ymax ?? raw.y_max ?? raw.bottom, raw.xmax ?? raw.x_max ?? raw.right];
  }
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  let values = raw.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (values.every((value) => value <= 1)) values = values.map((value) => value * 1000);
  const [y1, x1, y2, x2] = values.map((value) => Math.min(1000, Math.max(0, value)));
  if (y2 <= y1 || x2 <= x1) return null;
  return { x: x1 / 1000, y: y1 / 1000, width: (x2 - x1) / 1000, height: (y2 - y1) / 1000 };
}

function cleanLocations(list, destination = "", max = 6) {
  if (!Array.isArray(list)) return [];
  const locations = list.slice(0, max).map((item) => {
    const box = readBox(item);
    if (!box) return null;
    const label = String(item.label || item.name || "").trim().slice(0, 60);
    let role = String(item.role || "").toLowerCase();
    if (!["target", "destination"].includes(role)) {
      role = destination && label.toLowerCase().includes(destination.toLowerCase()) ? "destination" : "other";
    }
    return { label, role, box, description: String(item.description || "").trim().slice(0, 200) };
  }).filter(Boolean);
  // If the model forgot the roles, the first non-destination box is the target.
  if (!locations.some((location) => location.role === "target")) {
    const first = locations.find((location) => location.role !== "destination");
    if (first) first.role = "target";
  }
  return locations;
}

function parseJsonList(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    for (const key of ["objects", "locations", "detections", "boxes", "items", "results"]) {
      if (Array.isArray(parsed?.[key])) return parsed[key];
    }
    const anyList = parsed && typeof parsed === "object" ? Object.values(parsed).find(Array.isArray) : null;
    if (anyList) return anyList;
    return parsed && typeof parsed === "object" ? [parsed] : [];
  } catch {
    return [];
  }
}

async function askGemini(parts, schema) {
  const response = await generateWithRetry({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", responseSchema: schema }
  });
  return JSON.parse(response.text || "{}");
}

// Gemini's object-detection style request: works better than asking for boxes inside a bigger answer.

async function detectObjects(imagePart, target, destination) {
  const things = [target && `the ${target} (role "target")`, destination && `${destination} (role "destination")`].filter(Boolean);
  if (!things.length) return [];
  const prompt = [
    `Detect ${things.join(" and ")} in this image.`,
    "Output a JSON list. Each entry has \"box_2d\" as [ymin, xmin, ymax, xmax] normalized to 0-1000, a short \"label\", and \"role\".",
    "Box the whole object. Match the color carefully. Leave out anything that is not visible. Output only the JSON list."
  ].join("\n");
  const response = await generateWithRetry({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }],
    config: { responseMimeType: "application/json", temperature: 0.2 }
  });
  const locations = cleanLocations(parseJsonList(response.text), destination);
  console.log(`HueDo found ${locations.length} location(s) for "${things.join(", ")}":`, JSON.stringify(locations));
  return locations;
}

const locateSchema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING, description: "One short sentence saying where the target is, using position words, not color alone" },
    objects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: "[ymin, xmin, ymax, xmax] normalized to 0-1000" },
          label: { type: Type.STRING },
          role: { type: Type.STRING, enum: ["target", "destination"] }
        },
        required: ["box_2d", "label", "role"]
      }
    }
  },
  required: ["answer", "objects"]
};

// One request that both finds the object and says where it is. Used for simple "find / put X" instructions.
async function locateWithAnswer(imagePart, target, destination) {
  const things = [`the ${target} (role "target")`, destination && `${destination} (role "destination")`].filter(Boolean);
  const prompt = [
    `Find ${things.join(" and ")} in this image, for a user who is color blind.`,
    "Return JSON: {\"answer\": one short sentence saying where the target is using position words (left, right, top, in someone's hand) and not color alone, or saying it is not visible; \"objects\": a list where each entry has \"box_2d\" as [ymin, xmin, ymax, xmax] normalized to 0-1000, a short \"label\", and \"role\"}.",
    "If there is more than one matching target (for example \"pens\"), box every one of them.",
    "Box the whole object. Match the color carefully: do not box skin or lips unless asked. Leave out anything that is not visible."
  ].join("\n");
  const request = {
    contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }],
    config: { responseMimeType: "application/json", responseSchema: locateSchema, temperature: 0.2 }
  };

  const read = (response) => {
    let answer = "";
    try {
      answer = String(JSON.parse(String(response.text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")).answer || "").trim();
    } catch {
      answer = "";
    }
    return { answer, locations: cleanLocations(parseJsonList(response.text), destination) };
  };

  let response = await generateWithRetry(request);
  let result = read(response);
  if (!result.locations.length) {
    console.log(`Gemini's raw reply (${response.modelUsed}) was:`, String(response.text || "").slice(0, 500));
    // "Lite" models are fast but sometimes skip the boxes. Ask a full model once.
    if (/lite/.test(response.modelUsed || "")) {
      try {
        console.log("No box from the lite model. Asking a full model…");
        response = await generateWithRetry(request, { avoidLite: true });
        const second = read(response);
        if (second.locations.length) result = { answer: second.answer || result.answer, locations: second.locations };
      } catch (error) {
        console.error("Full model failed:", error.message);
      }
    }
  }
  console.log(`HueDo found ${result.locations.length} location(s) for "${things.join(", ")}":`, JSON.stringify(result.locations));
  return result;
}

const sortSchema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING, description: "One or two short sentences: how many items and which groups, with positions" },
    objects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: "[ymin, xmin, ymax, xmax] normalized to 0-1000" },
          group: { type: Type.STRING, description: "Short group name, usually the color, for example red, navy, white striped" },
          role: { type: Type.STRING, enum: ["target", "destination"] }
        },
        required: ["box_2d", "group", "role"]
      }
    }
  },
  required: ["answer", "objects"]
};

// Sorting: box every item and give it a group name (usually its color) so a color-blind user can sort by label.
async function sortItems(imagePart, things, destination) {
  const prompt = [
    `Find every one of the ${things} in this image, for a user who is color blind and wants to sort them by color.`,
    "For each item return \"box_2d\" as [ymin, xmin, ymax, xmax] normalized to 0-1000, role \"target\", and \"group\": a short, plain color name (for example red, navy blue, white striped).",
    "Items that should go together must have exactly the same group name. Use as few groups as make sense.",
    destination ? `Also box ${destination} with role "destination" and group set to its name.` : "",
    "\"answer\": one or two short sentences saying how many items there are and what the groups are.",
    "Leave out anything that is not visible. Do not box people, skin, or clothing being worn unless asked."
  ].filter(Boolean).join("\n");
  const request = {
    contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }],
    config: { responseMimeType: "application/json", responseSchema: sortSchema, temperature: 0.2 }
  };

  const read = (response) => {
    let parsed = {};
    try {
      parsed = JSON.parse(String(response.text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      parsed = {};
    }
    const list = (Array.isArray(parsed.objects) ? parsed.objects : parseJsonList(response.text))
      .map((item) => ({ ...item, label: String(item?.group || item?.label || "").trim().toLowerCase() }));
    const locations = cleanLocations(list, destination, 16).map((location) => (
      location.role === "destination" ? location : { ...location, role: "target" }
    ));
    return { answer: String(parsed.answer || "").trim(), locations };
  };

  let response = await generateWithRetry(request);
  let result = read(response);
  if (!result.locations.length && /lite/.test(response.modelUsed || "")) {
    console.log("No boxes from the lite model. Asking a full model…");
    try {
      response = await generateWithRetry(request, { avoidLite: true });
      result = read(response);
    } catch (error) {
      console.error("Full model failed:", error.message);
    }
  }

  const counts = new Map();
  result.locations.filter((location) => location.role === "target").forEach((location) => {
    const name = location.label || "other";
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  const groups = [...counts].map(([name, count]) => ({ name, count }));
  console.log(`HueDo sorted ${result.locations.length} item(s) into ${groups.length} group(s):`, JSON.stringify(groups));
  return { ...result, groups };
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
    // Fast path: for simple instructions like "where is the pink pen" or "put the green block in Box B",
    // read the words locally and make just one Gemini request to find the object.
    const quick = instruction ? parseInstruction(instruction) : null;
    const quickTarget = quick ? describeTarget(quick) : "";

    // Sorting: "sort the socks", "group the blocks by color".
    if (imagePart && quick && isSortTask(quick)) {
      const { locations, answer, groups } = await sortItems(imagePart, quickTarget || "items", quick.destination);
      return res.json({
        summary: describeTask(quick),
        steps: [],
        visualCues: [],
        targetColor: "",
        targetObject: quick.object || "items",
        action: quick.action,
        destination: quick.destination,
        relation: quick.relation,
        completionHint: "",
        answer,
        locations,
        groups,
        locateBusy: false
      });
    }

    if (imagePart && quickTarget) {
      const { locations, answer } = await locateWithAnswer(imagePart, quickTarget, quick.destination);
      return res.json({
        summary: describeTask(quick),
        steps: [],
        visualCues: [],
        targetColor: quick.color,
        targetObject: quick.object,
        action: quick.action,
        destination: quick.destination,
        relation: quick.relation,
        completionHint: "",
        answer,
        locations,
        locateBusy: false
      });
    }

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
    let locateBusy = false;
    if (imagePart) {
      {
        const target = [parsed.targetColor, parsed.targetObject].filter(Boolean).join(" ").trim() || String(parsed.summary);
        try {
          const detected = await detectObjects(imagePart, target, String(parsed.destination || "").trim());
          if (detected.length) locations = detected;
        } catch (error) {
          console.error("Gemini detection error:", error.message);
          locateBusy = true;
        }
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
      locations,
      locateBusy
    });
  } catch (error) {
    console.error("Gemini error:", error);
    res.status(502).json({ error: geminiErrorMessage(error, "Gemini could not interpret this instruction. Try again.") });
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
      "Look at the attached picture. Set done to true only if it clearly shows the task is complete (for example the target object is inside or on the destination, or for a sorting task every item is next to the items that match it).",
      "Return JSON: {\"done\": true or false, \"message\": one short sentence for the user without relying on color alone, \"objects\": a list where each entry has \"box_2d\" as [ymin, xmin, ymax, xmax] normalized to 0-1000, a short \"label\", and \"role\" (target or destination)}."
    ].filter(Boolean).join("\n");

    const response = await generateWithRetry({
      contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }],
      config: { responseMimeType: "application/json", temperature: 0.2 }
    });
    let parsed = {};
    try {
      parsed = JSON.parse(String(response.text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      parsed = {};
    }
    res.json({
      done: parsed.done === true,
      message: String(parsed.message || "").trim(),
      locations: cleanLocations(parsed.objects || parsed.locations, destination, 16)
    });
  } catch (error) {
    console.error("Gemini check error:", error);
    res.status(502).json({ error: geminiErrorMessage(error, "Gemini could not check this picture. Try again.") });
  }
});

export default router;