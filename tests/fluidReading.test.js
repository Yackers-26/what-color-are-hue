import test from "node:test";
import assert from "node:assert/strict";
import { createFluidReading } from "../src/vision/fluidReading.js";
import { classifyColor } from "../src/vision/colorDetector.js";

const at = (x, y = .5) => ({ x, y });
test("first sample has immediate readable color, HEX and RGB", () => {
  const result = createFluidReading().observe(classifyColor(210, 42, 35), { position: at(.5) });
  assert.equal(result.name, "Red");
  assert.match(result.hex, /^#[0-9A-F]{6}$/);
  assert.deepEqual(Object.keys(result.rgb), ["r", "g", "b"]);
});
test("hovering a different object responds without three-frame waiting", () => {
  const tracker = createFluidReading();
  tracker.observe(classifyColor(220, 30, 30), { position: at(.2) });
  assert.equal(tracker.observe(classifyColor(30, 65, 225), { position: at(.65) }).name, "Blue");
});
test("small camera noise is smoothed but changes can still update", () => {
  const tracker = createFluidReading();
  const a = tracker.observe(classifyColor(210, 35, 26), { position: at(.5) });
  const b = tracker.observe(classifyColor(211, 36, 26), { position: at(.5) });
  assert.equal(a.hex, b.hex);
  for (let i = 0; i < 4; i++) tracker.observe(classifyColor(160, 50, 40), { position: at(.5) });
  assert.notEqual(tracker.current().hex, a.hex);
});
test("reset clears the previous hover reading", () => {
  const tracker = createFluidReading();
  tracker.observe(classifyColor(20, 100, 205));
  tracker.reset();
  assert.equal(tracker.current(), null);
});
