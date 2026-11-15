import test from "node:test";
import assert from "node:assert/strict";
import { describeShade, sanitizeGeminiShade } from "../src/vision/shadeNaming.js";
import { classifyColor } from "../src/vision/colorDetector.js";

function rgb(hex) {
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

test("HueSee identifies standard brown and chocolate as browns, not orange/red", () => {
  for (const hex of ["A52A2A", "D2691E", "6F4E37", "8B4513"]) {
    assert.equal(describeShade(rgb(hex)).family, "Brown", hex);
  }
});
test("HueSee distinguishes lime green and chartreuse from yellow", () => {
  for (const hex of ["32CD32", "7FFF00", "9ACD32", "B6E030"]) {
    assert.equal(describeShade(rgb(hex)).family, "Green", hex);
    assert.match(describeShade(rgb(hex)).name, /green|chartreuse/i, hex);
  }
  assert.equal(describeShade(rgb("FFFF00")).family, "Yellow");
});
test("HueSee shows neutrals instead of forcing gray into colorful groups", () => {
  assert.equal(describeShade(rgb("808080")).name, "Gray");
  assert.equal(describeShade(rgb("708090")).name, "Slate gray");
  assert.equal(describeShade(rgb("FFFFFF")).name, "White");
  assert.equal(describeShade(rgb("000000")).name, "Black");
});
test("HueSee distinguishes familiar shades of muted and warm colors", () => {
  assert.equal(describeShade(rgb("808000")).family, "Olive");
  assert.equal(describeShade(rgb("D2B48C")).name, "Tan");
  assert.equal(describeShade(rgb("800020")).name, "Burgundy");
  assert.equal(describeShade(rgb("F5F5DC")).family, "Beige");
});
test("original broad HSV classification remains unchanged for HueFind", () => {
  assert.equal(classifyColor(255, 0, 0).name, "Red");
  assert.equal(classifyColor(0, 255, 0).name, "Green");
  assert.equal(classifyColor(255, 255, 0).name, "Yellow");
});
test("invalid RGB never produces a confident shade name", () => {
  assert.equal(describeShade({ r: -1, g: 5, b: 3 }).name, "Unknown");
  assert.equal(describeShade({ r: NaN, g: 5, b: 3 }).name, "Unknown");
  assert.equal(describeShade(null).name, "Unknown");
});
test("Gemini suggestions are filtered to short human-readable names", () => {
  assert.deepEqual(sanitizeGeminiShade({ shadeName: "  Warm   olive   brown ", note: "Mid-tone shade\nunder indoor lighting." }),
    { name: "Warm olive brown", note: "Mid-tone shade under indoor lighting." });
  assert.equal(sanitizeGeminiShade({ shadeName: "<script>alert(1)</script>" }), null);
  assert.equal(sanitizeGeminiShade({ shadeName: "A" }), null);
});

test("gray regions appear in HueSee's scene scan while white backgrounds stay ignored", async () => {
  const { summarizeFrameColors } = await import("../src/vision/colorDetector.js");
  const width = 48, height = 28;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gray = x >= 8 && x < 39 && y >= 4 && y < 24;
    data.set(gray ? [125, 126, 127, 255] : [255, 255, 255, 255], (y * width + x) * 4);
  }
  const regions = summarizeFrameColors({ data, width, height });
  assert.ok(regions.find(group => group.name === "Gray")?.regions.length);
  assert.equal(regions.some(group => group.name === "White"), false);
});
