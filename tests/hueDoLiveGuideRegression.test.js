import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findHueDoColorRegions, isReliableHueDoOutline } from "../src/vision/hueDoColorGuide.js";
import { buildGuideSteps, cleanTaskSummary, describeTarget } from "../public/js/hueDoParser.js";

function scene(width = 320, height = 180, background = [238, 234, 224]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...background, 255], i * 4);
  return { width, height, data, fill(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      data.set([...color, 255], (yy * width + xx) * 4);
    }
  } };
}

function pens() {
  const image = scene();
  image.fill(30, 35, 16, 100, [48, 55, 115]); // dark-blue pen
  image.fill(85, 30, 20, 115, [102, 149, 205]); // lighter-blue pen
  image.fill(150, 40, 18, 80, [224, 80, 96]); // red pen
  image.fill(204, 30, 68, 120, [42, 42, 38]); // black case
  return image;
}

test("dark blue guide highlights the dark pen, not the lighter blue pen or black case", () => {
  const result = findHueDoColorRegions(pens(), "dark blue");
  assert.equal(result.length, 1);
  assert.ok(result[0].center.x < 58, "must select dark-blue pen on the left");
  assert.ok(result[0].bounds.x + result[0].bounds.width < 80);
});

test("light blue guide highlights the lighter blue pen, not the dark pen", () => {
  const result = findHueDoColorRegions(pens(), "light blue");
  assert.equal(result.length, 1);
  assert.ok(result[0].center.x > 80 && result[0].center.x < 115);
});

test("no dark blue area means no contour; black is not treated as dark blue", () => {
  const image = scene();
  image.fill(35, 34, 90, 100, [34, 34, 36]);
  image.fill(153, 25, 80, 115, [102, 149, 205]);
  assert.deepEqual(findHueDoColorRegions(image, "dark blue"), []);
});

test("when Gemini supplies an object region, HueDo keeps the contour inside that region", () => {
  const image = pens();
  const bounded = findHueDoColorRegions(image, "dark blue", {
    roiBounds: { x: 21, y: 26, width: 45, height: 120 }
  });
  assert.equal(bounded.length, 1);
  assert.ok(bounded[0].bounds.x < 66);
  assert.deepEqual(findHueDoColorRegions(image, "dark blue", {
    roiBounds: { x: 190, y: 20, width: 91, height: 135 }
  }), [], "don't label the black pencil case as blue");
});

test("a specific named shade never silently becomes its entire color family", () => {
  const image = scene();
  image.fill(30, 30, 115, 90, [240, 43, 53]);
  assert.deepEqual(findHueDoColorRegions(image, "burgundy"), []);
});

test("guide copy does not say a pen is circled before a contour has been drawn", () => {
  const guide = buildGuideSteps({ color: "dark blue", object: "dark pen", action: "put", destination: "black pencil case" });
  assert.equal(guide[0].kind, "find");
  assert.match(guide[0].text, /Find the dark blue pen/);
  assert.doesNotMatch(guide[0].text, /is circled|are circled/i);
  assert.equal(isReliableHueDoOutline(null), false);
  assert.equal(isReliableHueDoOutline({visible: true, source: "object", points: [[0,0],[1,0],[0,1]]}), false);
  assert.equal(isReliableHueDoOutline({visible: true, source: "color", points: [[0,0],[1,0],[1,1],[0,1]]}), true);
});

test("Gemini repeating the color adjective does not produce 'dark blue dark pen'", () => {
  assert.equal(describeTarget({ color: "dark blue", object: "dark pen" }), "dark blue pen");
  assert.equal(describeTarget({ color: "dark blue", object: "dark blue pen" }), "dark blue pen");
  assert.equal(cleanTaskSummary({
    summary: "Put the dark blue dark pen into the black pencil case.",
    color: "dark blue", object: "dark pen"
  }), "Put the dark blue pen into the black pencil case.");
});

test("HueDo live guide uses selected color region, and only reports verified contours", async () => {
  const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
  assert.match(script, /findHueDoColorRegions\(frame, activeTask\.color/);
  assert.match(script, /isReliableHueDoOutline\(target\)/);
  assert.match(script, /POSSIBLE COLOR/);
  assert.match(script, /No confirmed \$\{activeTask\.color \|\| targetLabel\(\)\} outline yet/);
});
