import test from "node:test";
import assert from "node:assert/strict";
import { cleanColorMask, findSmoothColorContours, matchesTargetColor, SmoothContourTracker } from "../src/vision/smoothContours.js";

const makeFrame = (width = 180, height = 120, background = [220, 225, 226]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...background, 255], i * 4);
  const paint = (x, y, w, h, rgb) => {
    for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) {
        data.set([...rgb, 255], (py * width + px) * 4);
      }
    }
  };
  return { data, width, height, paint };
};

test("target matching separates red and blue and honors exact-ish shades", () => {
  assert.equal(matchesTargetColor(215, 45, 35, "Red"), true);
  assert.equal(matchesTargetColor(35, 40, 214, "Red"), false);
  assert.equal(matchesTargetColor(35, 40, 214, "Blue"), true);
  assert.equal(matchesTargetColor(215, 45, 35, "Red", { r: 240, g: 45, b: 35 }), true);
  assert.equal(matchesTargetColor(215, 45, 35, "Red", { r: 105, g: 20, b: 10 }), false);
});

test("one connected red object becomes one closed smooth contour", () => {
  const frame = makeFrame();
  frame.paint(30, 20, 78, 75, [230, 40, 30]);
  const regions = findSmoothColorContours(frame, { color: "Red" });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].points.length, 72);
  assert.ok(regions[0].bounds.width > 60);
  assert.ok(regions[0].bounds.height > 60);
});

test("small colored noise is suppressed, not drawn as tiny outlines", () => {
  const frame = makeFrame();
  frame.paint(25, 20, 85, 70, [220, 40, 35]);
  for (let i = 0; i < 18; i++) frame.paint(4 + (i * 31) % 170, 2 + (i * 47) % 110, 2, 2, [230, 30, 25]);
  const regions = findSmoothColorContours(frame, { color: "Red" });
  assert.equal(regions.length, 1);
});

test("noise gaps inside one object are bridged into one boundary", () => {
  const frame = makeFrame();
  frame.paint(40, 15, 90, 85, [225, 35, 30]);
  for (let x = 45; x < 120; x += 9) frame.paint(x, 30 + x % 20, 4, 5, [210, 212, 214]);
  const regions = findSmoothColorContours(frame, { color: "Red" });
  assert.equal(regions.length, 1);
  assert.ok(regions[0].bounds.width >= 80);
});

test("two large separate objects can have separate outlines, no fragments", () => {
  const frame = makeFrame(240, 140);
  frame.paint(18, 22, 75, 90, [220, 45, 35]);
  frame.paint(145, 30, 75, 80, [220, 45, 35]);
  const regions = findSmoothColorContours(frame, { color: "Red" });
  assert.equal(regions.length, 2);
  assert.ok(regions.every((item) => item.points.length === 72));
});

test("tracking preserves an ID and dampens a small movement", () => {
  const first = makeFrame();
  const second = makeFrame();
  first.paint(25, 22, 70, 70, [220, 45, 35]);
  second.paint(31, 25, 70, 70, [220, 45, 35]);
  const tracker = new SmoothContourTracker({ confirmationFrames: 1 });
  const [a] = tracker.update(findSmoothColorContours(first, {color:"Red"}), first.width, first.height);
  const [b] = tracker.update(findSmoothColorContours(second, {color:"Red"}), second.width, second.height);
  assert.equal(a.id, b.id);
  assert.ok(b.center.x > a.center.x && b.center.x < a.center.x + 6);
});

test("tracker holds momentary detection loss and then clears", () => {
  const frame = makeFrame();
  frame.paint(25, 22, 70, 70, [220, 45, 35]);
  const tracker = new SmoothContourTracker({ confirmationFrames: 1, holdFrames: 1 });
  assert.equal(tracker.update(findSmoothColorContours(frame, {color:"Red"}), 180,120).length,1);
  assert.equal(tracker.update([],180,120).length,1);
  assert.equal(tracker.update([],180,120).length,0);
});

test("mask cleaning removes isolated pixel islands", () => {
  const width=30,height=30;
  const mask=new Uint8Array(width*height);
  for(let y=10;y<20;y++)for(let x=10;x<20;x++)mask[y*width+x]=1;
  mask[1*width+1]=1;
  const clean=cleanColorMask(mask,width,height);
  assert.equal(clean[1*width+1],0);
  assert.equal(clean[15*width+15],1);
});
