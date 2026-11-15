// Explicit text-and-image Gemini candidates: the configured model is always
// preferred, then known general-purpose models. Never send API keys to clients.
// ListModels can itself fail, so it must not be a prerequisite for recovery.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const KNOWN_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash"
];

export function geminiModelCandidates(primary, extraModels = "") {
  const extras = String(extraModels).split(",").map(value => value.trim()).filter(Boolean);
  return [...new Set([
    String(primary || "").trim() || DEFAULT_GEMINI_MODEL,
    ...extras,
    ...KNOWN_GEMINI_MODELS
  ])];
}
