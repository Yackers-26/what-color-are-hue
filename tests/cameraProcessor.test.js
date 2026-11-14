
import test from "node:test";
import assert from "node:assert/strict";

import { analyzeVideoFrame } from "../src/vision/cameraProcessor.js";

// Test 1: Check if the camera is ready.
test("handles a camera that is not ready", () => {
  const video = {
    videoWidth: 0,
    videoHeight: 0,
    readyState: 0
  };

  const canvas = {};

  const result = analyzeVideoFrame(video, canvas);

  assert.equal(result.ready, false);
  assert.deepEqual(result.colors, []);
});

// Test 2: Identify colors from a camera frame.
test("detects colors from a video frame", () => {
  const video = {
    videoWidth: 640,
    videoHeight: 320,
    readyState: 2
  };

  const width = 320;
  const height = 160;

  const data = new Uint8ClampedArray(
    width * height * 4
  );

  // Create a test image with red on the left
  // and blue on the right.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;

      if (x < 160) {
        data.set([255, 0, 0, 255], index);
      } else {
        data.set([0, 0, 255, 255], index);
      }
    }
  }

  // Simulate the canvas without a real webcam.
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage() {},
        getImageData() {
          return { data, width, height };
        }
      };
    }
  };

  const result = analyzeVideoFrame(video, canvas);

  assert.equal(result.ready, true);
  assert.equal(canvas.width, 320);
  assert.equal(canvas.height, 160);

  const names = result.colors.map(
    color => color.name
  );

  assert.ok(names.includes("Red"));
  assert.ok(names.includes("Blue"));
});

// Test 3: Check missing camera inputs.
test("rejects missing video or canvas", () => {
  assert.throws(
    () => analyzeVideoFrame(null, {}),
    /Video and canvas are required/
  );

  assert.throws(
    () => analyzeVideoFrame({}, null),
    /Video and canvas are required/
  );
});
