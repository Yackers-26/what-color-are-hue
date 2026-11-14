
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyColor,
  summarizeFrameColors,
  TemporalMaskStabilizer
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


// Temporal label changes must persist before a region is allowed to switch.
test("stabilizes one-frame label changes", () => {
  const stabilizer = new TemporalMaskStabilizer({ holdFrames: 2 });
  const first = stabilizer.stabilize(new Int16Array([1, 1, -1]), 3, 1);
  assert.deepEqual(Array.from(first), [1, 1, -1]);

  const transient = stabilizer.stabilize(new Int16Array([2, 1, -1]), 3, 1);
  assert.deepEqual(Array.from(transient), [1, 1, -1]);

  const persistent = stabilizer.stabilize(new Int16Array([2, 1, -1]), 3, 1);
  assert.deepEqual(Array.from(persistent), [2, 1, -1]);
});

// A single noisy cell inside a large region should not create a new color lasso.
test("removes isolated color noise from region labels", () => {
  const width = 40;
  const height = 40;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set([255, 0, 0, 255], (y * width + x) * 4);
    }
  }
  data.set([0, 0, 255, 255], (18 * width + 18) * 4);

  const results = summarizeFrameColors({ data, width, height });
  assert.deepEqual(results.map((color) => color.name), ["Red"]);
});


test("smooths region geometry while keeping its identity", () => {
  const smoother = new TemporalMaskStabilizer();
  const first = [{
    name: "Red",
    regions: [{
      bounds: { x: 10, y: 10, width: 20, height: 20 },
      center: { x: 20, y: 20 },
      outline: [[10, 10, 30, 10], [10, 30, 30, 30]]
    }]
  }];
  smoother.smoothRegions(first, 320, 180);
  const stableId = first[0].regions[0].id;

  const second = [{
    name: "Red",
    regions: [{
      bounds: { x: 18, y: 10, width: 20, height: 20 },
      center: { x: 28, y: 20 },
      outline: [[18, 10, 38, 10], [18, 30, 38, 30]]
    }]
  }];
  smoother.smoothRegions(second, 320, 180);

  assert.equal(second[0].regions[0].id, stableId);
  assert.ok(second[0].regions[0].center.x > 20);
  assert.ok(second[0].regions[0].center.x < 28);
  assert.ok(second[0].regions[0].outline[0][0] > 10);
  assert.ok(second[0].regions[0].outline[0][0] < 18);
});
