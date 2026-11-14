
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyColor,
  summarizeFrameColors
} from "../src/vision/colorDetector.js";

// Test 1: Identify common colors
test("recognizes basic colors", () => {
  assert.equal(classifyColor(255, 0, 0).name, "Red");
  assert.equal(classifyColor(0, 255, 0).name, "Green");
  assert.equal(classifyColor(0, 0, 255).name, "Blue");
  assert.equal(classifyColor(255, 255, 0).name, "Yellow");
});

// Test 2: Detect multiple colors in one frame
test("detects red and blue in an image", () => {
  const width = 24;
  const height = 12;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;

      if (x < 12) {
        data.set([255, 0, 0, 255], index);
      } else {
        data.set([0, 0, 255, 255], index);
      }
    }
  }

  const results = summarizeFrameColors({
    data,
    width,
    height
  });

  const names = results.map(color => color.name);

  assert.ok(names.includes("Red"));
  assert.ok(names.includes("Blue"));
});

// Test 3: Ignore a white background
test("ignores a completely white image", () => {
  const width = 16;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i += 4) {
    data.set([255, 255, 255, 255], i);
  }

  const results = summarizeFrameColors({
    data,
    width,
    height
  });

  assert.equal(results.length, 0);
});
// Test 4: Keep separate objects as separate camera regions.
test("separates disconnected regions of the same color", () => {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 255, 255, 255], i);

  for (let y = 4; y < 16; y += 1) {
    for (let x = 2; x < 14; x += 1) {
      data.set([255, 0, 0, 255], (y * width + x) * 4);
    }
    for (let x = 26; x < 38; x += 1) {
      data.set([255, 0, 0, 255], (y * width + x) * 4);
    }
  }

  const results = summarizeFrameColors({ data, width, height });
  const red = results.find((color) => color.name === "Red");

  assert.ok(red);
  assert.equal(red.regions.length, 2);
  assert.ok(red.regions.every((region) => region.outline.length > 0));
});
