// Pure, shared rules for a Gemini photo check. An uncertain response must
// never be treated as a successful completion or silently hidden by live video.
const OUTCOMES = new Set(["complete", "incorrect", "incomplete", "uncertain"]);

export function normalizeHueDoVerification(input = {}) {
  const parsed = input && typeof input === "object" ? input : {};
  const requestedOutcome = String(parsed.outcome || "").trim().toLowerCase();
  // Inconsistent outputs fail closed: done=true and outcome=incorrect is NOT verified.
  const done = parsed.done === true && (!requestedOutcome || requestedOutcome === "complete");
  const outcome = done ? "complete" : OUTCOMES.has(requestedOutcome) && requestedOutcome !== "complete"
    ? requestedOutcome : "uncertain";
  const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(x => typeof x === "string")
    .map(x => x.trim().slice(0, 220)).filter(Boolean).slice(0, 6) : [];
  const fallback = {
    complete: "The picture supports completion of the requested task.",
    incorrect: "The objects are not in the requested arrangement. Correct the mismatch and take another picture.",
    incomplete: "The task is not complete yet. Finish the remaining steps and take another picture.",
    uncertain: "I can't confirm this task from the picture. Show all relevant objects more clearly and try again."
  }[outcome];
  return { done, outcome, message: String(parsed.message || "").trim().slice(0, 400) || fallback, issues };
}
