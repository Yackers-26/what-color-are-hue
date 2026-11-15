import test from "node:test";
import assert from "node:assert/strict";

import {
  parseInstruction,
  buildGuideSteps,
  describeTask,
  normalizeColorName
} from "../public/js/hueDoParser.js";

test("reads color, object, action, and destination", () => {
  const task = parseInstruction("Place the green block into Box B.");
  assert.equal(task.color, "green");
  assert.equal(task.object, "block");
  assert.equal(task.action, "place");
  assert.equal(task.destination, "Box B");
  assert.equal(task.relation, "into");
  assert.equal(describeTask(task), "Place the green block into Box B.");
});

test("maps color synonyms to colors the camera can track", () => {
  assert.equal(normalizeColorName("Navy"), "blue");
  assert.equal(normalizeColorName("dark teal"), "cyan");
  assert.equal(normalizeColorName("nothing"), "");
});

test("handles 'on' destinations and missing articles", () => {
  const task = parseInstruction("put red cup on tray 2");
  assert.equal(task.color, "red");
  assert.equal(task.object, "cup");
  assert.equal(task.destination, "Tray 2");
  assert.equal(task.relation, "onto");
});

test("keeps the user's color word and reads 'where is' questions", () => {
  const task = parseInstruction("Where is the pink pen?");
  assert.equal(task.color, "pink");
  assert.equal(task.object, "pen");
  assert.equal(task.action, "where");
  assert.equal(task.destination, "");
  assert.equal(describeTask(task), "Find the pink pen.");
  assert.equal(normalizeColorName(task.color), "red");
});

test("a color + destination task gets find then place steps", () => {
  const steps = buildGuideSteps(parseInstruction("Place the green block into Box B."));
  assert.deepEqual(steps.map((step) => step.kind), ["find", "place"]);
  assert.match(steps[1].text, /green block into Box B/);
});

test("a color with no destination gets find then a manual step", () => {
  const task = parseInstruction("identify the blue text");
  assert.equal(task.color, "blue");
  assert.equal(task.object, "text");
  const steps = buildGuideSteps(task);
  assert.deepEqual(steps.map((step) => step.kind), ["find", "manual"]);
});

test("instructions with no target fall back to manual steps", () => {
  const steps = buildGuideSteps({ summary: "Open the door", steps: ["Walk to the door", "Open it"] });
  assert.deepEqual(steps.map((step) => step.kind), ["manual", "manual"]);
});
