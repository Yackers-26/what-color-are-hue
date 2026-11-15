// Shared pure helpers for Gemini and future shade-related API consumers.
import { sanitizeGeminiShade } from "./shadeNaming.js";
const FAMILIES = new Set(["red", "orange", "brown", "yellow", "olive", "green", "teal", "cyan", "blue", "purple", "pink", "beige", "gray", "black", "white"]);
export const validRgb = rgb => Boolean(rgb) && [rgb.r, rgb.g, rgb.b].every(n => Number.isInteger(n) && n >= 0 && n <= 255);
export function validImage(image) {
  return Boolean(image) && image.mimeType === "image/jpeg" && typeof image.data === "string" &&
    image.data.length > 100 && image.data.length <= 700_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data);
}
export function normalizeGeminiShadeResult(raw, { previousName = "", hasReference = false } = {}) {
  const safe = sanitizeGeminiShade(raw);
  if (!safe) return null;
  const family = String(raw.colorFamily || "").trim().toLowerCase();
  const conf = String(raw.confidence || "").trim().toLowerCase();
  const confidence = ["high", "medium", "low"].includes(conf) ? conf : "low";
  const same = String(raw.sameSurface || "").trim().toLowerCase();
  let sameSurface = ["yes", "no", "uncertain"].includes(same) ? same : "uncertain";
  if (!hasReference) sameSurface = "uncertain";
  const lighting = String(raw.lightingChanged || "").trim().toLowerCase();
  const lightingChanged = ["yes", "no", "uncertain"].includes(lighting) ? lighting : "uncertain";
  // Never silently replace the shade of an existing pin simply because a
  // shadowed image seems different. A clearly DIFFERENT surface is reported,
  // and an ambiguous photo retains the prior label with an uncertainty warning.
  const usablePrevious = hasReference ? sanitizeGeminiShade({ shadeName: previousName }) : null;
  const keepPrevious = usablePrevious && sameSurface !== "no";
  const verifiedHold = Boolean(keepPrevious && sameSurface === "yes" && confidence !== "low");
  return {
    name: keepPrevious ? usablePrevious.name : safe.name,
    suggestedName: safe.name,
    note: safe.note,
    family: FAMILIES.has(family) ? family : "unknown",
    confidence, sameSurface, lightingChanged,
    identityHeld: verifiedHold,
    provisionalHold: Boolean(keepPrevious && !verifiedHold),
    // True means user should not blindly trust the latest shade as the same object.
    needsConfirmation: sameSurface !== "yes" || confidence === "low"
  };
}
