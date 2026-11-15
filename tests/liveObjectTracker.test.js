import test from "node:test";
import assert from "node:assert/strict";
import { LiveObjectTracker } from "../src/vision/liveObjectTracker.js";

function frame(width, height, { objectX = 40, objectY = 35, objectWidth = 36, objectHeight = 24, present = true } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data[at] = 35;
      data[at + 1] = 42;
      data[at + 2] = 39;
      data[at + 3] = 255;
      if (present && x >= objectX && x < objectX + objectWidth && y >= objectY && y < objectY + objectHeight) {
        const localX = x - objectX;
        const localY = y - objectY;
        data[at] = 170 + (localX * 2) % 60;
        data[at + 1] = 55 + (localY * 3) % 70;
        data[at + 2] = 75 + ((localX + localY) * 2) % 80;
      }
    }
  }
  return { data, width, height };
}

test("live tracker follows a seeded object as it moves in the webcam frame", () => {
  const tracker = new LiveObjectTracker({ searchStep: 2 });
  const initial = frame(160, 100);
  assert.equal(tracker.seed(initial, { x: 40 / 160, y: 35 / 100, width: 36 / 160, height: 24 / 100 }), true);

  const moved = frame(160, 100, { objectX: 54, objectY: 43 });
  const result = tracker.update(moved);
  assert.equal(result.visible, true);
  assert.ok(Math.abs(result.center.x - 72) < 7, `expected x near 72, got ${result.center.x}`);
  assert.ok(Math.abs(result.center.y - 55) < 7, `expected y near 55, got ${result.center.y}`);
  assert.ok(result.confidence > 0.6);
});

test("live tracker reports a lost target instead of claiming a background match", () => {
  const tracker = new LiveObjectTracker({ searchStep: 2 });
  const initial = frame(160, 100);
  tracker.seed(initial, { x: 40 / 160, y: 35 / 100, width: 36 / 160, height: 24 / 100 });

  const removed = frame(160, 100, { present: false });
  const result = tracker.update(removed);
  assert.equal(result.visible, false);
  assert.equal(result.lostFrames, 1);
});
