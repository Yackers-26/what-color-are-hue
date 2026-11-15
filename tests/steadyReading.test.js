import test from "node:test";
import assert from "node:assert/strict";
import { classifyColor } from "../src/vision/colorDetector.js";
import { createSteadyReading } from "../src/vision/steadyReading.js";
import { averagePixelRegion } from "../src/vision/sampleColor.js";

const red = (n = 210) => classifyColor(n, 30, 25);
const blue = () => classifyColor(25, 80, 210);

test("pixel patches average neighboring camera pixels", () => {
  const sample = averagePixelRegion({ data: Uint8ClampedArray.from([200, 30, 20, 255, 210, 40, 30, 255]) });
  assert.deepEqual(sample, { r: 205, g: 35, b: 25 });
});

test("transparent pixels are ignored in the sampled patch", () => {
  const sample = averagePixelRegion({ data: Uint8ClampedArray.from([200, 30, 20, 255, 0, 0, 0, 0]) });
  assert.deepEqual(sample, { r: 200, g: 30, b: 20 });
});

test("single noisy samples do not change the displayed color", () => {
  const tracker = createSteadyReading({ agreement: 3 });
  const first = tracker.observe(red());
  assert.equal(tracker.observe(blue()), first);
  assert.equal(tracker.observe(red()), first);
  assert.equal(tracker.current().name, "Red");
});

test("a different color takes three matching readings before switching", () => {
  const tracker = createSteadyReading({ agreement: 3 });
  tracker.observe(red());
  tracker.observe(blue());
  assert.equal(tracker.observe(blue()).name, "Red");
  assert.equal(tracker.observe(blue()).name, "Blue");
});

test("small RGB fluctuations keep both HEX and RGB unchanged", () => {
  const tracker = createSteadyReading({ threshold: 12 });
  const first = tracker.observe(red(210));
  for (const n of [213, 208, 214, 211, 207]) {
    const result = tracker.observe(red(n));
    assert.deepEqual(result.rgb, first.rgb);
    assert.equal(result.hex, first.hex);
  }
});

test("large consistent RGB changes eventually update HEX and RGB together", () => {
  const tracker = createSteadyReading({ threshold: 12 });
  const first = tracker.observe(red(160));
  for (let i = 0; i < 4; i++) tracker.observe(red(220));
  const updated = tracker.current();
  assert.notEqual(updated.hex, first.hex);
  assert.equal(updated.hex, classifyColor(updated.rgb.r, updated.rgb.g, updated.rgb.b).hex);
});

test("an intentional reposition switches immediately and reset clears state", () => {
  const tracker = createSteadyReading();
  tracker.observe(red());
  assert.equal(tracker.observe(blue(), { immediate: true }).name, "Blue");
  tracker.reset();
  assert.equal(tracker.current(), null);
});
