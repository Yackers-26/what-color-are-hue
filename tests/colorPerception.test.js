import test from "node:test";
import assert from "node:assert/strict";
import { rgbToLab, rgbHue, labDifference, matchesSavedShade } from "../src/vision/colorPerception.js";
import { matchesTargetColor } from "../src/vision/smoothContours.js";

test("sRGB to Lab maps neutral black to perceptual lightness 0", () => {
  assert.ok(Math.abs(rgbToLab({ r: 0, g: 0, b: 0 }).L) < 0.001);
  assert.ok(Math.abs(rgbToLab({ r: 255, g: 255, b: 255 }).L - 100) < 0.01);
});
test("hue remains broadly stable under proportional exposure changes", () => {
  const bright = rgbHue({ r: 200, g: 60, b: 40 });
  const dark = rgbHue({ r: 125, g: 35, b: 25 });
  assert.ok(Math.abs(bright.hue - dark.hue) < 5);
  assert.equal(matchesSavedShade({ r: 200, g: 60, b: 40 }, { r: 125, g: 35, b: 25 }), true);
});
test("saved blue shade tolerates darker lighting", () => {
  const sample = { r: 90, g: 140, b: 220 };
  const reference = { r: 55, g: 86, b: 130 };
  assert.ok(labDifference(sample, reference) > 20);
  assert.equal(matchesSavedShade(sample, reference), true);
  assert.equal(matchesTargetColor(...Object.values(sample), "Blue", reference), true);
});
test("red reference does not match blue sample", () => {
  assert.equal(matchesSavedShade({ r: 220, g: 30, b: 30 }, { r: 30, g: 30, b: 220 }), false);
  assert.equal(matchesTargetColor(30, 30, 220, "Red", { r: 220, g: 30, b: 30 }), false);
});
test("neutral shades are compared without undefined hue", () => {
  assert.equal(matchesSavedShade({ r: 120, g: 120, b: 120 }, { r: 155, g: 155, b: 155 }), true);
  assert.equal(matchesSavedShade({ r: 120, g: 120, b: 120 }, { r: 120, g: 30, b: 30 }), false);
});
test("reject malformed saved RGB data", () => {
  assert.equal(matchesSavedShade({ r: NaN, g: 10, b: 10 }, { r: 10, g: 10, b: 10 }), false);
  assert.equal(matchesSavedShade({ r: -10, g: 10, b: 10 }, { r: 10, g: 10, b: 10 }), false);
});
test("saved red stays findable if lighting shifts it just into orange", () => {
  const stored = { r: 220, g: 40, b: 35 };
  const current = { r: 200, g: 88, b: 40 };
  assert.equal(matchesTargetColor(current.r, current.g, current.b, "Red", stored), true);
});
