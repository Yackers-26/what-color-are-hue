import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findSmoothColorContours, matchesTargetColor } from "../src/vision/smoothContours.js";

function frame(width = 240, height = 150, background = [238, 236, 229]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...background, 255], i * 4);
  return { width, height, data, paint(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i >= 0 && j >= 0 && i < width && j < height) data.set([...color, 255], (j * width + i) * 4);
    }
  } };
}

test("HueFind broad red does not outline warm skin, orange, or brown", () => {
  assert.equal(matchesTargetColor(207, 130, 104, "red"), false);
  assert.equal(matchesTargetColor(140, 60, 35, "orange"), false);
  assert.equal(matchesTargetColor(127, 255, 0, "yellow"), false);
  assert.equal(matchesTargetColor(215, 45, 35, "red"), true);
  const scene = frame();
  scene.paint(10, 25, 80, 95, [215, 45, 35]);
  scene.paint(90, 25, 65, 95, [207, 130, 104]);  // touching skin-toned surface
  scene.paint(155, 25, 70, 95, [170, 76, 37]); // touching brown/orange surface
  const regions = findSmoothColorContours(scene, { color: "red", minAreaFraction: .008 });
  assert.equal(regions.length, 1);
  assert.ok(regions[0].bounds.x + regions[0].bounds.width <= 97, "outline should stop near the red edge");
});

test("exact chartreuse mask cannot swallow a neighboring yellow region", () => {
  const scene = frame();
  scene.paint(20, 25, 98, 92, [127, 255, 0]);
  scene.paint(118, 25, 95, 92, [255, 255, 0]);
  const regions = findSmoothColorContours(scene, { color: "green", rgb: { r: 127, g: 255, b: 0 }, strictShade: true });
  assert.equal(regions.length, 1);
  assert.ok(regions[0].bounds.x + regions[0].bounds.width <= 125, "yellow pixels must be excluded");
});

test("ROI restricts a HueDo color outline to the tracked target instead of unrelated matching objects", () => {
  const scene = frame();
  scene.paint(12, 22, 100, 90, [220, 45, 35]);
  scene.paint(150, 32, 65, 75, [220, 45, 35]);
  const regions = findSmoothColorContours(scene, {
    color: "red", roiBounds: { x: 143, y: 24, width: 80, height: 92 },
    minAreaFraction: .004, maxRegions: 2
  });
  assert.equal(regions.length, 1);
  assert.ok(regions[0].center.x > 140, "the other red object should not be tracked");
});

test("unrelated colors do not create a HueDo color-match contour inside its target box", () => {
  const scene = frame();
  scene.paint(50, 25, 90, 80, [225, 215, 40]);
  const regions = findSmoothColorContours(scene, {
    color: "red", roiBounds: { x: 48, y: 20, width: 98, height: 90 },
    minAreaFraction: .004
  });
  assert.equal(regions.length, 0);
});

test("small gaps remain separate and exact-shade mask still makes smooth closed outlines", () => {
  const scene = frame();
  scene.paint(18, 30, 84, 80, [156, 175, 136]);
  scene.paint(110, 30, 84, 80, [156, 175, 136]);
  const regions = findSmoothColorContours(scene, {
    color: "green", rgb: { r: 156, g: 175, b: 136 }, strictShade: true,
    maxRegions: 2
  });
  assert.equal(regions.length, 2);
  assert.ok(regions.every(item => item.points.length === 72));
});

test("photo capture is restricted to HueDo and color tasks use contour boundaries", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
  assert.match(html, /id="snapshotBtn"[^>]*hidden disabled/);
  assert.match(script, /snapshotBtn\.hidden = nextMode !== "do"/);
  assert.match(script, /if \(!streaming \|\| currentMode !== "do"\) return;\s*const scene = await captureCameraScene\(\)/);
  assert.match(script, /roiBounds: objectTarget\?\.bounds \|\| null/);
  assert.match(script, /if \(target\.source === "color"\) \{\s*drawSmoothTargetContour\(target\.points\)/);
});
