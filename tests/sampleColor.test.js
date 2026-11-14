import test from "node:test";
import assert from "node:assert/strict";
import { averagePixelRegion } from "../src/vision/sampleColor.js";

test("averages a camera color patch", () => {
  const patch = { data: new Uint8ClampedArray([200, 20, 10, 255, 220, 40, 30, 255]) };
  assert.deepEqual(averagePixelRegion(patch), { r: 210, g: 30, b: 20 });
});

test("ignores transparent pixels", () => {
  const patch = { data: new Uint8ClampedArray([0, 0, 255, 0, 0, 255, 0, 255]) };
  assert.deepEqual(averagePixelRegion(patch), { r: 0, g: 255, b: 0 });
});

test("rejects missing patches", () => {
  assert.throws(() => averagePixelRegion(null), /image patch/);
});
