import { Router } from "express";
import { GoogleGenAI, Type } from "@google/genai";
import { parseInstruction, describeTarget, taskTypeOf, isMultiObjectTask, normalizeInstructionText } from "../../public/js/hueDoParser.js";
import { DEFAULT_GEMINI_MODEL, geminiModelCandidates } from "../geminiModelPolicy.js";
import { normalizeHueDoVerification } from "../../src/vision/hueDoVerification.js";
import { requestedHueDoColor } from "../../src/vision/hueDoLanguage.js";

const router = Router();
const MODEL = String(process.env.GEMINI_MODEL || "").trim() || DEFAULT_GEMINI_MODEL;

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
  if (!fallbackModels) {
    // Build a safe list immediately. Do not depend on models.list() succeeding:
    // it sometimes fails even while generateContent works with this API key.
    fallbackModels = geminiModelCandidates(MODEL, process.env.GEMINI_FALLBACK_MODELS).slice(1);
    console.log("Gemini fallback models:", fallbackModels.join(", "));
  }
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
  if (status === 404) return "None of the configured Gemini models accepted this request (404). Check GEMINI_MODEL and your key's available models in Google AI Studio. Try gemini-3.5-flash-lite, then restart the server.";
  if (status === 403 || status === 401) return "Gemini refused access. Check GEMINI_API_KEY and model permissions in Google AI Studio.";
  if (status === 400) return "Gemini rejected this request. Check the server terminal for the detailed model/API error.";
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
      description: "Short, ordered actions the user can follow; never collapse a complex task into one generic instruction"
    },
    taskType: { type: Type.STRING, description: "One of find, place, sort, group, match, compare, sequence, identify, inspect, other" },
    stepPlan: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "One concrete, short, color-accessible user action" },
          kind: { type: Type.STRING, description: "find for visual identification, manual for an action, check for optional after-photo verification" }
        },
        required: ["text", "kind"]
      },
      description: "Actionable order of steps. Preserve every meaningful operation, including sorting multiple groups, comparisons and sequences. Include a check step for physical changes."
    },
    groups: {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: {
        name: { type: Type.STRING, description: "Color group name or visible matched category" },
        color: { type: Type.STRING, description: "Color word when a color is specified" }
      }, required: ["name"] },
      description: "All grouping labels required by the user's instruction. Empty for a non-grouping task."
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
async function sortItems(imagePart, instruction, things, destination) {
  const prompt = [
    `User instruction: ${instruction}`,
    `Find the relevant ${things || "objects"} visible in this image. Help a user who cannot reliably distinguish colors carry out THAT exact grouping, matching or sorting instruction.`,
    `For each relevant item return "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000, role "target", and "group": a short consistent label using the user's actual grouping rule (color/shade when requested, not an arbitrary category).`,
    "If the instruction matches items from different object types (e.g. pens with matching-color caps), label both items with the same group name. Different groups must have distinct names.",
    "Items that should be grouped together must have identical group strings. Never invent items or count occluded objects.",
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
  const instruction = typeof text === "string" ? normalizeInstructionText(text) : "";
  if (!instruction && !image) {
    return res.status(400).json({ error: "Enter an instruction or attach a picture." });
  }

  const { part: imagePart, error, status } = readImage(image);
  if (error) return res.status(status).json({ error });

  try {
    // Interpret the entire instruction before attempting object localization.
    // Never use the local one-object parser as a shortcut for camera tasks:
    // that silently destroys sorting, matching, comparison and multi-step plans.
    const quick = instruction ? parseInstruction(instruction) : null;
    const originalColor = instruction ? requestedHueDoColor(instruction) : "";

    const prompt = [
      "You are HueDo, a color-dependent task assistant for people who cannot reliably distinguish colors.",
      "Understand and honor the WHOLE instruction. It may request sorting items by color, matching similarly colored items, grouping shades, arranging an order or pattern, comparing colors, identifying a particular colored object, reading a colored label, or several sequential actions.",
      "Do not reduce a multi-item task to one target and destination. Do not infer that every task involves physically moving an object.",
      "Color-family requests are inclusive: a dusty lavender object is purple, a navy pen is blue, and a sage object is green. If a camera image supports a more specific shade, name that observed shade as an additional hint without replacing the user's requested color or inventing certainty.",
      "Do not confuse near-neighbor shades or assert that a colored object is outlined unless the actual camera color region is verified.",
      "Return an honest taskType and stepPlan. For each step, use kind=find for looking at an object, kind=manual for actions/comparisons, kind=check for checking a physical result from a new picture. Include multiple concrete steps if needed, typically 2-6.",
      "Your steps must be actionable without distinguishing colors unaided. Use visible positions, object types, group labels and approximate counts when supported by the image. Never claim an object is circled or verified until it has a visible location.",
      "For sorting/grouping/matching, describe every requested group and the rule for membership. In targetObject, use the plural items involved (like pens, socks, cards, blocks). Put only ONE most important color in targetColor; leave it empty when multiple colors are involved. The groups array should list all groups if known.",
      "For sequences, preserve the specified order. For finding/comparing, answer the question and guide the user without inventing a physical movement.",
      "The completionHint must describe observable evidence for THE ORIGINAL INSTRUCTION, not merely locating the target. If a result cannot be checked from one photo, say what remains uncertain.",
      imagePart
        ? "A picture of the user's surroundings is attached. Identify only visible, relevant objects, their locations, counts and distinguishing landmarks. Provide location boxes for visible targets and destinations when you can; never invent bounding boxes. If the requested object is missing, say so and leave locations empty. If there is no instruction text, interpret visible written instructions."
        : "No picture is attached. Interpret the text into steps now, but do not claim any object is visible. Return empty locations and an empty answer.",
      "Do not invent objects, completed actions, exact colors under uncertain lighting, or directions.",
      instruction ? `Full instruction (follow exactly): ${instruction}` : "Read and interpret any instructions visible in the attached picture."
    ].join("\n");

    const parts = [{ text: prompt }];
    if (imagePart) parts.push(imagePart);
    const parsed = await askGemini(parts, taskSchema);

    if (!parsed.summary) {
      return res.status(422).json({ error: "Gemini could not interpret a usable task. Try rephrasing the instruction." });
    }

    let locations = imagePart ? cleanLocations(parsed.locations, String(parsed.destination || ""), 16) : [];
    let locateBusy = false;
    let groups = Array.isArray(parsed.groups)
      ? parsed.groups.slice(0, 12).map((group) => ({ name: String(group?.name || "").trim(), color: String(group?.color || "").trim() })).filter((group) => group.name)
      : [];
    const taskType = taskTypeOf({ taskType: parsed.taskType, action: parsed.action });
    const multiItemTask = isMultiObjectTask({ taskType, action: parsed.action, groups });
    if (imagePart) {
      const target = [parsed.targetColor, parsed.targetObject].filter(Boolean).join(" ").trim();
      try {
        if (multiItemTask) {
          const detected = await sortItems(imagePart, instruction || parsed.summary, parsed.targetObject || "items", String(parsed.destination || "").trim());
          if (detected.locations.length) {
            locations = detected.locations;
            groups = detected.groups;
            if (detected.answer) parsed.answer = detected.answer;
          }
        } else if (target || parsed.destination) {
          const detected = await detectObjects(imagePart, target || "requested object", String(parsed.destination || "").trim());
          if (detected.length) locations = detected;
        }
      } catch (error) {
        console.error("Gemini object localization error:", error.message);
        locateBusy = true;
        // Keep boxes obtained in the first structured request when possible.
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
      // Always preserve the exact user instruction for the guide and final check.
      // Gemini's short summary can accidentally omit a color, quantity or step.
      summary: instruction || String(parsed.summary).trim(),
      steps: Array.isArray(parsed.steps) ? parsed.steps.map((step) => String(step).trim()).filter(Boolean).slice(0, 12) : [],
      planSteps: Array.isArray(parsed.stepPlan) ? parsed.stepPlan.slice(0, 12).map((step) => ({
        text: String(step?.text || "").trim().slice(0, 350),
        kind: String(step?.kind || "manual").trim().toLowerCase()
      })).filter((step) => step.text) : [],
      planSource: "gemini",
      taskType,
      groups,
      visualCues,
      // Preserve the explicit requested shade ("purple" remains "purple") even
      // if Gemini calls the observed surface "dusty lavender" in its answer.
      targetColor: multiItemTask ? "" : (originalColor || String(parsed.targetColor || "").trim().toLowerCase()),
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

  const { image = null, beforeImage = null, task = {} } = req.body ?? {};
  if (!image) return res.status(400).json({ error: "Take a new picture to check the task." });
  const { part: imagePart, error, status } = readImage(image);
  if (error) return res.status(status).json({ error });
  const reference = beforeImage ? readImage(beforeImage) : { part: null };
  if (reference.error) return res.status(reference.status).json({ error: reference.error });

  const summary = String(task.summary || "").slice(0, 300);
  const target = String(task.target || "").slice(0, 100);
  const destination = String(task.destination || "").slice(0, 100);
  const taskType = taskTypeOf(task);
  const groups = Array.isArray(task.groups) ? task.groups.slice(0, 16).map((group) => String(group?.name || "")).filter(Boolean) : [];

  try {
    const prompt = [
      "You evaluate completion of a COLOR-DEPENDENT instruction for someone who cannot distinguish colors reliably.",
      `Original task: ${summary}`,
      `Task kind: ${taskType}`,
      target ? `Target objects: ${target}` : "",
      destination ? `Destination: ${destination}` : "",
      groups.length ? `Requested/identified groups: ${groups.join(", ")}` : "",
      task.completionHint ? `Expected visible result: ${String(task.completionHint).slice(0, 250)}` : "",
      "Evaluate the ENTIRE instruction. For sorting or matching, each relevant object must be in the correct group/pair. For sequences, the end state must support the claimed result; do not claim unseen actions happened.",
      reference.part ? "The FIRST image is the starting situation, the SECOND image is the current result. Use both to assess the change. Do not assume success merely because a target is visible." : "The attached image is the current result.",
      "If some items are hidden, the lighting makes colors ambiguous, or completion cannot be established visually, return done=false and explain what to show or change next. Avoid false confidence.",
      "A broad color request may match a more specific shade (for example dusty lavender is a purple shade). Judge the actual pixels and distinguish similar neighboring shades when the instruction requires it.",
      "Classify outcome as complete, incorrect (wrong objects or colors), incomplete (remaining work), or uncertain (insufficient evidence). For every false result name the specific mistake or missing evidence, not a vague failure.",
      'Return JSON: {"done":boolean,"outcome":"complete|incorrect|incomplete|uncertain","message":"one actionable sentence","issues":["specific mismatch or missing evidence"],"objects":[{"label":"...","role":"target","box_2d":[0,0,1000,1000]}]}.' 
    ].filter(Boolean).join("\n");

    const imageParts = reference.part ? [reference.part, imagePart] : [imagePart];
    const response = await generateWithRetry({
      contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
      config: { responseMimeType: "application/json", temperature: 0.1 }
    });
    let parsed = {};
    try {
      parsed = JSON.parse(String(response.text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      parsed = {};
    }
    res.json({
      ...normalizeHueDoVerification(parsed),
      locations: cleanLocations(parsed.objects || parsed.locations, destination, 16)
    });
  } catch (error) {
    console.error("Gemini check error:", error);
    res.status(502).json({ error: geminiErrorMessage(error, "Gemini could not check this picture. Try again.") });
  }
});

export default router;