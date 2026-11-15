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
  "tap", "where", "show", "open", "close", "sort", "match", "connect", "plug", "turn", "flip", "cut", "fold", "color", "draw"
];

const DESTINATION_WORDS = /\b(into|inside of|inside|in|onto|on top of|on|to|next to|beside|under|below|above|behind|in front of)\b/i;
const FILLER = /\b(the|a|an|your|my|this|that|please)\b/gi;

function clean(value = "") {
  return String(value).replace(FILLER, " ").replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ").trim();
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

// Rule-based reading used when Gemini is unavailable.
// "Place the green block into Box B." -> { color: "green", object: "block", action: "place", destination: "Box B" }
export function parseInstruction(text = "") {
  const sentence = String(text).replace(/\s+/g, " ").trim();
  const lower = sentence.toLowerCase();

  const action = ACTION_WORDS.find((word) => new RegExp(`\\b${word}\\b`).test(lower)) || "";

  let colorWord = "";
  let colorIndex = -1;
  for (const match of lower.matchAll(/[a-z]+/g)) {
    if (COLOR_WORDS[match[0]]) {
      colorWord = match[0];
      colorIndex = match.index;
      break;
    }
  }
  const color = colorWord; // keep the user's word ("pink"); normalizeColorName() maps it when needed

  // Split into "what" and "where" at the first destination word after the color/action.
  const searchFrom = Math.max(colorIndex, 0);
  const tail = sentence.slice(searchFrom);
  const destMatch = tail.match(DESTINATION_WORDS);
  let objectPart = tail;
  let destination = "";
  let relation = "";
  if (destMatch && destMatch.index > 0) {
    objectPart = tail.slice(0, destMatch.index);
    destination = clean(tail.slice(destMatch.index + destMatch[0].length));
    relation = normalizeRelation(destMatch[0]);
  }

  let object = objectPart;
  if (colorWord) object = object.replace(new RegExp(`^${colorWord}\\b`, "i"), "");
  else if (action) object = object.replace(new RegExp(`^.*?\\b${action}\\b`, "i"), "");
  object = clean(object);

  // Capitalise box letters/numbers: "box b" -> "Box B".
  destination = destination.replace(/\b(box|bin|zone|area|container|tray|cup|bowl)\s+([a-z0-9])\b/i,
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

// The thing to look for, e.g. "pink pen" (falls back to "pink item").
export function describeTarget({ color = "", object = "" } = {}) {
  const colorName = String(color || "").trim().toLowerCase();
  return [colorName, object || (colorName ? "item" : "")].filter(Boolean).join(" ").trim();
}

const FIND_ACTIONS = ["find", "locate", "identify", "where", "point to", "show"];

// Build the guided steps for a picture. Each step has a kind the app knows how to handle:
// find   - the target is circled in the picture
// place  - user moves the target, then takes a new picture to check
// manual - user presses Next / Done
export function buildGuideSteps(task = {}) {
  const target = describeTarget({ color: task.color, object: task.object });
  const destination = String(task.destination || "").trim();
  const action = String(task.action || "").trim().toLowerCase();
  const relation = normalizeRelation(task.relation);
  const steps = [];

  if (target) {
    steps.push({ kind: "find", text: `Look at the picture: ${article(target)} is circled.` });
  }

  if (target && destination) {
    const verb = action && !FIND_ACTIONS.includes(action) ? action : "place";
    steps.push({
      kind: "place",
      text: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${article(target)} ${relation} ${destination}. Then press "Check with a new picture".`
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
  return `${verb} ${article(target)}${destination ? ` ${normalizeRelation(relation)} ${destination}` : ""}.`.replace(/\s+/g, " ");
}
