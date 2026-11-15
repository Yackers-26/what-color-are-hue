// HueDo helpers: read a color-based instruction and turn it into guided steps.
// Works in the browser and in Node (tests), with no dependencies.

// Colors the camera detector can track (see src/vision/colorDetector.js).
export const TRACKABLE_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "black"];

const COLOR_WORDS = {
  red: "red", crimson: "red", scarlet: "red", maroon: "red", pink: "red", magenta: "red",
  orange: "orange", brown: "orange", tan: "orange",
  yellow: "yellow", gold: "yellow", golden: "yellow",
  green: "green", lime: "green", olive: "green", mint: "green",
  cyan: "cyan", teal: "cyan", turquoise: "cyan", aqua: "cyan",
  blue: "blue", navy: "blue", azure: "blue",
  purple: "purple", violet: "purple", lavender: "purple", indigo: "purple",
  black: "black",
  white: "white", gray: "gray", grey: "gray", silver: "gray"
};

const ACTION_WORDS = [
  "place", "put", "move", "drop", "insert", "set", "stack", "slide", "push", "pull", "bring", "take",
  "pick up", "pick", "grab", "find", "locate", "identify", "point to", "touch", "press", "click",
  "tap", "where", "show", "open", "close", "sort", "organize", "organise", "group", "separate", "match",
  "connect", "plug", "turn", "flip", "cut", "fold", "color", "draw",
  "compare", "choose", "select", "count", "arrange", "pair", "classify", "label", "read", "rank", "order"
];

// Actions that mean "put things into groups by color".
export const SORT_ACTIONS = ["sort", "organize", "organise", "group", "separate", "match"];

export function isSortTask(task = {}) {
  return SORT_ACTIONS.includes(String(task.action || "").trim().toLowerCase());
}

// Longer phrases first so "in front of" wins over "in".
const DESTINATION_WORDS = /\b(in front of|inside of|on top of|next to|into|inside|onto|beside|under|below|above|behind|in|on|to)\b/i;
const FILLER = /\b(the|a|an|your|my|this|that|these|those|please|all)\b/gi;
// Words about the photo itself, not the task: "in this picture", "from the photo", "by color".
const PICTURE_WORDS = /\b(in|from|on|of)\s+(the|this|that|my|a|an)\s+(picture|photo|image|pic|camera)\b|\bby\s+(their\s+)?(colou?rs?|shades?)\b/gi;
const POLITE_START = /^\s*(can|could|would|will)\s+you\s+(please\s+)?(help\s+me\s+)?|^\s*(please|help\s+me)\s+/i;

function clean(value = "") {
  return String(value).replace(FILLER, " ").replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();
}

// Map any color word ("Navy", "dark green", "Teal") to a basic color name, or "".
export function normalizeColorName(value = "") {
  const words = String(value).toLowerCase().match(/[a-z]+/g) || [];
  for (const word of words) {
    if (COLOR_WORDS[word]) return COLOR_WORDS[word];
  }
  return "";
}

export function isTrackableColor(color = "") {
  return TRACKABLE_COLORS.includes(normalizeColorName(color));
}

// The action word that appears first in the sentence ("can you put..." -> "put").
function findAction(lower) {
  let best = null;
  for (const word of ACTION_WORDS) {
    const match = new RegExp(`\\b${word}\\b`).exec(lower);
    if (match && (!best || match.index < best.index || (match.index === best.index && word.length > best.word.length))) {
      best = { word, index: match.index };
    }
  }
  return best;
}

// Correct only common fused command words; do not rewrite the user's task.
// E.g. "Help meput the purple socks on the blue notebook" is a placement request.
export function normalizeInstructionText(text = "") {
  return String(text).replace(/\b(help\s+me)(put|place|move|find|sort|match|group|arrange|pick)\b/gi,
    (_, prefix, action) => `${prefix} ${action}`).replace(/\s+/g, " ").trim();
}

// Rule-based reading, used for the fast path and when Gemini is unavailable.
// "Place the green block into Box B." -> { color: "green", object: "block", action: "place", destination: "Box B" }
// "Put the pens in the green box."    -> { color: "", object: "pens", action: "put", destination: "green box" }
export function parseInstruction(text = "") {
  const sentence = normalizeInstructionText(text);
  const working = sentence.replace(POLITE_START, "").replace(PICTURE_WORDS, " ").replace(/\s+/g, " ").trim();
  const lower = working.toLowerCase();

  const found = findAction(lower);
  const action = found?.word || "";
  // Everything after the action word: "the pens in the green box".
  let tail = found ? working.slice(found.index + found.word.length) : working;
  if (action === "where") tail = tail.replace(/^\s*(is|are)\b/i, "");

  // Split into "what" and "where" at the first destination word.
  let objectPart = tail;
  let destination = "";
  let relation = "";
  const destMatch = tail.match(DESTINATION_WORDS);
  if (destMatch && clean(tail.slice(0, destMatch.index))) {
    objectPart = tail.slice(0, destMatch.index);
    destination = clean(tail.slice(destMatch.index + destMatch[0].length));
    relation = destination ? normalizeRelation(destMatch[0]) : "";
  }

  // The color belongs to the object ("pink pen"), not to the destination ("green box").
  let color = "";
  let object = clean(objectPart);
  const colorMatch = [...object.toLowerCase().matchAll(/[a-z]+/g)].find((match) => COLOR_WORDS[match[0]]);
  if (colorMatch) {
    color = colorMatch[0];
    object = clean(`${object.slice(0, colorMatch.index)} ${object.slice(colorMatch.index + color.length)}`);
  }
  object = object.replace(/^(colou?red|colou?r)\s+/i, "").trim();
  // "Sort the red and blue blocks" is about the blocks, not one color.
  if (SORT_ACTIONS.includes(action)) {
    color = "";
    object = clean(objectPart).split(" ").filter((word) => !COLOR_WORDS[word.toLowerCase()] && !/^(and|or)$/i.test(word)).join(" ");
  }

  // Capitalise box letters/numbers: "box b" -> "Box B".
  destination = destination.replace(/\b(box|bin|zone|area|container|tray|cup|bowl|basket|drawer|shelf)\s+([a-z0-9])\b/i,
    (_, noun, id) => `${noun.charAt(0).toUpperCase()}${noun.slice(1).toLowerCase()} ${id.toUpperCase()}`);

  return {
    summary: sentence,
    color,
    object,
    action,
    destination,
    relation
  };
}

// "in" / "inside" -> "into", "on" -> "onto"; other words kept as written.
export function normalizeRelation(value = "") {
  const word = String(value).trim().toLowerCase();
  if (!word || ["in", "into", "inside", "inside of", "to"].includes(word)) return "into";
  if (["on", "onto", "on top of"].includes(word)) return "onto";
  return word;
}

function article(phrase) {
  return phrase ? `the ${phrase}` : "";
}

// "Box B" stays as is; "green box" becomes "the green box".
function place(destination) {
  const value = String(destination || "").trim();
  if (!value) return "";
  return /^[A-Z0-9]/.test(value) ? value : `the ${value}`;
}

// "pens" and "socks" are plural; "glass" is not.
export function isPlural(object = "") {
  const last = String(object).trim().toLowerCase().split(/\s+/).pop() || "";
  return /[^s]s$/.test(last) || ["people", "children", "mice", "feet", "teeth"].includes(last);
}

// The thing to look for, e.g. "pink pen" (falls back to "pink item").
export function describeTarget({ color = "", object = "" } = {}) {
  const colorName = String(color || "").trim().toLowerCase();
  let objectName = String(object || "").trim();
  // Gemini sometimes returns color="dark blue", object="dark pen" or
  // object="dark blue pen". Don't tell the user to find a "dark blue dark pen".
  const tokens = colorName.split(/\s+/).filter(Boolean);
  const words = objectName.split(/\s+/).filter(Boolean);
  while (words.length > 1 && tokens.includes(words[0].toLowerCase())) words.shift();
  objectName = words.join(" ");
  return [colorName, objectName || (colorName ? "item" : "")].filter(Boolean).join(" ").trim();
}

// Keep Gemini's summary when possible, but remove duplicate color words
// introduced by splitting "dark blue pen" into color + object fields.
export function cleanTaskSummary(task = {}) {
  const summary = String(task.summary || "").trim();
  if (!summary) return describeTask(task);
  const rawTarget = [String(task.color || "").trim(), String(task.object || "").trim()]
    .filter(Boolean).join(" ");
  const cleanTarget = describeTarget(task);
  if (!rawTarget || rawTarget.toLowerCase() === cleanTarget.toLowerCase()) return summary;
  const escaped = rawTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Use direct case-insensitive replacement, preserving the rest of the task.
  return summary.replace(new RegExp(escaped, "gi"), cleanTarget);
}


// The old single-target object parser is a useful offline fallback. Gemini's
// multi-step plan takes priority when available; do not rewrite "sort", "compare",
// or multi-target instructions into a single "put X into Y" action.
export const TASK_TYPES = ["find", "place", "sort", "group", "match", "compare", "sequence", "identify", "inspect", "other"];

export function taskTypeOf(task = {}) {
  const explicit = String(task.taskType || "").trim().toLowerCase();
  if (TASK_TYPES.includes(explicit) && explicit !== "other") return explicit;
  const action = String(task.action || "").trim().toLowerCase();
  if (["sort", "organize", "organise", "separate"].includes(action)) return "sort";
  if (action === "group") return "group";
  if (["match", "pair"].includes(action)) return "match";
  if (action === "classify") return "group";
  if (["compare", "choose", "pick", "select", "tell"].includes(action)) return "compare";
  if (["find", "locate", "where", "identify", "show", "point to"].includes(action)) return "find";
  if (["put", "place", "move", "insert", "stack", "drop", "set"].includes(action)) return "place";
  return explicit === "other" ? "other" : "sequence";
}

export function isMultiObjectTask(task = {}) {
  return ["sort", "group", "match"].includes(taskTypeOf(task)) ||
    (Array.isArray(task.groups) && task.groups.length > 1);
}

function safePlanKind(kind = "", text = "") {
  const requested = String(kind).trim().toLowerCase();
  if (["find", "locate", "identify", "observe"].includes(requested)) return "find";
  if (["check", "verify", "review", "confirm", "place"].includes(requested)) return "place";
  if (["act", "action", "manual", "perform", "move", "sort", "group", "compare"].includes(requested)) return "manual";
  const sentence = String(text).toLowerCase();
  if (/^(locate|find|identify|look for|look at|inspect|notice)\b/.test(sentence)) return "find";
  if (/\b(check with a (new )?picture|verify with a (new )?picture|take (a )?new picture)\b/.test(sentence)) return "place";
  return "manual";
}

function mentionsGroup(text = "", name = "") {
  const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(String(text));
}

export function normalizeGeminiStepPlan(plan = []) {
  if (!Array.isArray(plan)) return [];
  return plan.slice(0, 12).flatMap((part) => {
    const text = String(typeof part === "string" ? part : part?.text || "").trim().slice(0, 350);
    if (!text) return [];
    return [{ kind: safePlanKind(part?.kind || "", text), text }];
  });
}

const FIND_ACTIONS = ["find", "locate", "identify", "where", "point to", "show"];

// Build the guided steps for a picture. Each step has a kind the app knows how to handle:
// find   - the target is circled in the picture
// place  - user does the task, then takes a new picture to check
// manual - user presses Next / Done
export function buildGuideSteps(task = {}) {
  if (task.planSource === "gemini") {
    const planned = normalizeGeminiStepPlan(task.planSteps?.length ? task.planSteps : task.steps);
    if (planned.length) {
      const groups = Array.isArray(task.groups) ? task.groups.filter((group) => group?.name) : [];
      // A camera-identified sorting task gains explicit group instructions, not
      // just "put colors together". Never invent counts without image evidence.
      if (isMultiObjectTask(task) && groups.length &&
          !groups.every((group) => planned.some((step) => mentionsGroup(step.text, group.name)))) {
        const lastIsCheck = planned.at(-1)?.kind === "place";
        const insertAt = lastIsCheck ? planned.length - 1 : planned.length;
        const unique = groups.slice(0, 8).filter((group) =>
          !planned.some((step) => mentionsGroup(step.text, group.name)))
          .map((group) => ({ kind: "manual", text: `Group the ${group.name} items together${Number(group.count) > 0 ? ` (${group.count} identified)` : ""}.` }));
        planned.splice(insertAt, 0, ...unique);
      }
      // Physical color arrangements can be assessed from a fresh image.
      // Nonphysical tasks (such as comparisons and questions) should not
      // imply a photographic completion check.
      const taskKind = taskTypeOf(task);
      const physicallyRearranges = /\b(put|place|move|sort|group|arrange|stack|insert|drop)\b/i.test(String(task.summary || ""));
      const physical = ["place", "sort", "group", "match"].includes(taskKind) ||
        (taskKind === "sequence" && physicallyRearranges);
      if (physical && !planned.some((step) => step.kind === "place")) {
        planned.push({ kind: "place", text: "When finished, press Check with a new picture to review the arrangement." });
      }
      return planned.slice(0, 12);
    }
  }
  const target = describeTarget({ color: task.color, object: task.object });
  const destination = String(task.destination || "").trim();
  const action = String(task.action || "").trim().toLowerCase();
  const relation = normalizeRelation(task.relation);
  const steps = [];

  if (isSortTask(task)) {
    const things = target || "items";
    steps.push({ kind: "find", text: `Look for ${things} in the camera view. Check any outlines or labels before sorting.` });
    const groups = Array.isArray(task.groups) ? task.groups.filter((group) => group?.name) : [];
    groups.forEach((group) => {
      const count = Number(group.count) > 0 ? ` (${group.count})` : "";
      steps.push({ kind: "manual", text: `Put the ones labeled "${group.name}" together${count}.` });
    });
    if (!groups.length) steps.push({ kind: "manual", text: `Put the ${things} with the same label together.` });
    steps.push({ kind: "place", text: `When the ${things} are sorted, press "Check with a new picture".` });
    return steps;
  }

  const isAre = isPlural(task.object) ? "are" : "is";

  if (target) {
    steps.push({ kind: "find", text: `Find ${article(target)} in the camera view. Follow the outline when a matching region appears.` });
  }

  if (target && destination) {
    const verb = action && !FIND_ACTIONS.includes(action) ? action : "place";
    steps.push({
      kind: "place",
      text: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${article(target)} ${relation} ${place(destination)}. Then press "Check with a new picture".`
    });
    return steps;
  }

  if (target) {
    steps.push({ kind: "manual", text: `When you have found ${article(target)}, press Done.` });
    return steps;
  }

  // No clear target: use the given steps, or the instruction itself.
  const extra = Array.isArray(task.steps) ? task.steps.map((step) => String(step).trim()).filter(Boolean) : [];
  const manual = extra.length ? extra : [task.summary || "Follow the instruction."];
  manual.forEach((text) => steps.push({ kind: "manual", text }));
  return steps;
}

// One sentence the user can confirm, e.g. "Place the green block into Box B." or "Find the pink pen."
export function describeTask({ action = "", color = "", object = "", destination = "", relation = "", summary = "" } = {}) {
  const target = describeTarget({ color, object });
  if (!target && !action) return summary;
  const word = String(action || "").toLowerCase();
  const verb = !word || FIND_ACTIONS.includes(word) ? "Find" : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  return `${verb} ${article(target)}${destination ? ` ${normalizeRelation(relation)} ${place(destination)}` : ""}.`.replace(/\s+/g, " ");
}
