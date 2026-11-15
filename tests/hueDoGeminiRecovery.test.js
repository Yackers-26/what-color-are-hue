import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeInstructionText, parseInstruction, buildGuideSteps } from "../public/js/hueDoParser.js";
import { DEFAULT_GEMINI_MODEL, geminiModelCandidates } from "../server/geminiModelPolicy.js";

const src = async (path) => readFile(new URL(path, import.meta.url), "utf8");

test("recovery includes known models if ListModels is blocked or empty", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
  assert.deepEqual(geminiModelCandidates("unknown-model", "gemini-3.5-flash-lite").slice(0, 2),
    ["unknown-model", "gemini-3.5-flash-lite"]);
  assert.ok(geminiModelCandidates("unavailable-model").includes("gemini-flash-lite-latest"));
  assert.equal(new Set(geminiModelCandidates("gemini-3.5-flash-lite")).size,
    geminiModelCandidates("gemini-3.5-flash-lite").length);
});

test("fused help meput instruction keeps socks and notebook separate", () => {
  const input = "Help meput the purple socks on the blue notebook";
  assert.equal(normalizeInstructionText(input), "Help me put the purple socks on the blue notebook");
  const parsed = parseInstruction(input);
  assert.equal(parsed.color, "purple");
  assert.equal(parsed.object, "socks");
  assert.equal(parsed.action, "put");
  assert.equal(parsed.destination, "blue notebook");
  assert.deepEqual(buildGuideSteps(parsed).map(s => s.kind), ["find", "place"]);
  assert.doesNotMatch(buildGuideSteps(parsed)[0].text, /Help meput/i);
});

test("Gemini failure hides all fake confirmation and doesn't create an offline guide", async () => {
  const [client, route] = await Promise.all([src("../public/script.js"), src("../server/routes/interpret.js")]);
  const failure = client.match(/} catch \(error\) \{\s*\/\/ Fail closed:[\s\S]+?\n  } finally \{/);
  assert.ok(failure, "HueDo interpret failure handler should fail closed");
  assert.match(failure[0], /pendingTaskDraft = null/);
  assert.match(failure[0], /parsedTask.hidden = true/);
  assert.doesNotMatch(failure[0], /showDraft\(/);
  assert.match(route, /geminiModelCandidates\(MODEL, process.env.GEMINI_FALLBACK_MODELS\)/);
  assert.doesNotMatch(route, /ai.models.list\(/);
  assert.match(route, /normalizeInstructionText\(text\)/);
});
