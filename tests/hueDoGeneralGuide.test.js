import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildGuideSteps, isMultiObjectTask, normalizeGeminiStepPlan, taskTypeOf
} from "../public/js/hueDoParser.js";

const source = path => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("Gemini sorting plan retains multiple colors and individual group guidance", () => {
  const result = buildGuideSteps({
    planSource: "gemini", taskType: "sort", summary: "Sort all the pens by their color.",
    action: "sort", object: "pens", groups: [{ name: "dark blue", count: 2 }, { name: "red", count: 3 }],
    planSteps: [
      { kind: "find", text: "Locate all five pens and note the position of each color." },
      { kind: "manual", text: "Move matching colored pens into separate groups." },
      { kind: "check", text: "Review the grouped pens in a new picture." }
    ]
  });
  assert.deepEqual(result.map(step => step.kind), ["find", "manual", "manual", "manual", "place"]);
  assert.match(result[2].text, /dark blue/i);
  assert.match(result[3].text, /red/i);
  assert.match(result.at(-1).text, /Review the grouped pens/);
});

test("Gemini matching plan does not collapse into a put-something-in-a-box task", () => {
  const steps = buildGuideSteps({
    planSource: "gemini", taskType: "match", summary: "Match each cap to a bottle with the same color.",
    planSteps: [
      { kind: "find", text: "Identify every cap and bottle." },
      { kind: "manual", text: "Pair each cap with the bottle matching its color." }
    ]
  });
  assert.equal(steps.length, 3);
  assert.match(steps[1].text, /Pair each cap/);
  assert.equal(steps.at(-1).kind, "place");
  assert.ok(!steps.some(step => /into (the )?box/i.test(step.text)));
});

test("Gemini comparison and identification plans remain nonphysical", () => {
  const steps = buildGuideSteps({
    planSource: "gemini", taskType: "compare", summary: "Which object is darker?",
    planSteps: [{ kind: "find", text: "Locate both objects." }, { kind: "manual", text: "Compare their visible shades and identify the darker one." }]
  });
  assert.deepEqual(steps.map(step => step.kind), ["find", "manual"]);
  assert.ok(!steps.some(step => /new picture/i.test(step.text)));
});

test("Gemini sequences retain order instead of defaulting to one target and destination", () => {
  const steps = buildGuideSteps({
    planSource: "gemini", taskType: "sequence", summary: "Mark the green line, then read the blue label, then press the red button.",
    planSteps: [
      { kind: "find", text: "Locate the green line." },
      { kind: "manual", text: "Mark the green line." },
      { kind: "manual", text: "Read the blue label." },
      { kind: "manual", text: "Press the red button." }
    ]
  });
  assert.equal(steps.length, 4);
  assert.match(steps[1].text, /Mark the green line/);
  assert.match(steps[2].text, /Read the blue label/);
  assert.match(steps[3].text, /Press the red button/);
});

test("Task type and step normalization resist unsupported Gemini values", () => {
  assert.equal(taskTypeOf({ taskType: "sort" }), "sort");
  assert.equal(taskTypeOf({ taskType: "unspecified", action: "match" }), "match");
  assert.equal(isMultiObjectTask({ taskType: "match" }), true);
  assert.equal(isMultiObjectTask({ taskType: "find" }), false);
  assert.deepEqual(normalizeGeminiStepPlan([
    { kind: "identify", text: "Find the yellow pencil" },
    { kind: "act", text: "Pick up the yellow pencil" },
    { kind: "check", text: "Check with a new picture" },
    { kind: "unknown", text: "Review instructions" }
  ]).map(step => step.kind), ["find", "manual", "place", "manual"]);
});

test("HueDo route interprets full task before locating objects and checks previous/current photos", async () => {
  const [route, client, ui, tasks] = await Promise.all([
    source("../server/routes/interpret.js"), source("../public/script.js"), source("../public/index.html"), source("../server/routes/tasks.js")
  ]);
  assert.match(route, /Interpret the entire instruction before attempting object localization/);
  assert.doesNotMatch(route, /if \(imagePart && quickTarget\)/);
  assert.match(route, /const multiItemTask = isMultiObjectTask/);
  assert.match(route, /sortItems\(imagePart, instruction/);
  assert.match(route, /const imageParts = reference\.part \? \[reference\.part, imagePart\]/);
  assert.match(client, /checkTask\(\{ mimeType: scene\.mimeType, data: scene\.data \}, \{/);
  assert.match(tasks, /planSteps: cleanStepPlan/);
  assert.match(ui, /id="taskKindSummary"/);
});

test("Contrast and Text buttons are removed from main workspace, keeping Theme and Sound", async () => {
  const [ui, script, css] = await Promise.all([
    source("../public/index.html"), source("../public/script.js"), source("../public/style.css")
  ]);
  assert.doesNotMatch(ui, /id="contrastToggle"|id="textSizeToggle"/);
  assert.doesNotMatch(script, /contrastToggle|textSizeToggle/);
  assert.doesNotMatch(css, /html\.large-text|body\.high-contrast/);
  assert.match(ui, /id="themeToggle"/);
  assert.match(ui, /id="soundToggle"/);
});
