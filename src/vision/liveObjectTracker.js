// Lightweight, browser-native template tracker for HueDo's live camera guide.
// It is seeded from a target/destination box found in the guide's reference image,
// then follows that patch locally on each webcam frame. It is not a semantic
// detector: if the object leaves view or changes appearance substantially, the
// tracker reports it as temporarily lost rather than inventing a location.

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function readPixel(data, width, height, x, y) {
  const px = clamp(Math.round(x), 0, width - 1);
  const py = clamp(Math.round(y), 0, height - 1);
  const at = (py * width + px) * 4;
  return [data[at], data[at + 1], data[at + 2]];
}

function samplePatch(imageData, bounds, grid) {
  const { width, height, data } = imageData;
  const x = clamp(bounds.x, 0, width - 1);
  const y = clamp(bounds.y, 0, height - 1);
  const w = clamp(bounds.width, 2, width - x);
  const h = clamp(bounds.height, 2, height - y);
  const values = [];
  const mean = [0, 0, 0];
  for (let row = 0; row < grid; row++) {
    for (let column = 0; column < grid; column++) {
      const px = x + ((column + 0.5) / grid) * w;
      const py = y + ((row + 0.5) / grid) * h;
      const rgb = readPixel(data, width, height, px, py);
      values.push(rgb);
      for (let channel = 0; channel < 3; channel++) mean[channel] += rgb[channel];
    }
  }
  const count = values.length;
  for (let channel = 0; channel < 3; channel++) mean[channel] /= count;
  return { values, mean, width: w, height: h };
}

function comparePatches(template, candidate) {
  let meanDifference = 0;
  let textureDifference = 0;
  for (let channel = 0; channel < 3; channel++) {
    meanDifference += Math.abs(template.mean[channel] - candidate.mean[channel]) / 255;
  }
  meanDifference /= 3;
  for (let index = 0; index < template.values.length; index++) {
    const a = template.values[index];
    const b = candidate.values[index];
    for (let channel = 0; channel < 3; channel++) {
      const centeredA = a[channel] - template.mean[channel];
      const centeredB = b[channel] - candidate.mean[channel];
      textureDifference += Math.abs(centeredA - centeredB) / 255;
    }
  }
  textureDifference /= template.values.length * 3;
  // Mean color is important for flat objects; centered texture makes matching
  // less sensitive to global exposure and modest lighting changes.
  return meanDifference * 0.62 + textureDifference * 0.38;
}

function normalizeBox(box, width, height) {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  const x = clamp(box.x, 0, 1);
  const y = clamp(box.y, 0, 1);
  const right = clamp(box.x + box.width, 0, 1);
  const bottom = clamp(box.y + box.height, 0, 1);
  if (right <= x || bottom <= y) return null;
  return { x: x * width, y: y * height, width: (right - x) * width, height: (bottom - y) * height };
}

export class LiveObjectTracker {
  constructor({ grid = 8, threshold = 0.24, searchStep = 4, adaptation = 0.025 } = {}) {
    this.grid = Math.max(4, Math.floor(grid));
    this.threshold = threshold;
    this.searchStep = Math.max(2, Math.floor(searchStep));
    this.adaptation = clamp(adaptation, 0, 0.12);
    this.reset();
  }

  reset() {
    this.template = null;
    this.bounds = null;
    this.confidence = 0;
    this.lostFrames = 0;
    this.frameWidth = 0;
    this.frameHeight = 0;
  }

  seed(imageData, normalizedBox) {
    if (!imageData?.data || !imageData.width || !imageData.height) return false;
    const bounds = normalizeBox(normalizedBox, imageData.width, imageData.height);
    if (!bounds || bounds.width < 5 || bounds.height < 5) return false;
    this.template = samplePatch(imageData, bounds, this.grid);
    this.bounds = bounds;
    this.confidence = 1;
    this.lostFrames = 0;
    this.frameWidth = imageData.width;
    this.frameHeight = imageData.height;
    return true;
  }

  update(imageData) {
    if (!this.template || !this.bounds || !imageData?.data) return null;
    const { width, height } = imageData;
    if (width !== this.frameWidth || height !== this.frameHeight) {
      // Resolution changes invalidate pixel coordinates; preserve normalized position.
      const normalized = {
        x: this.bounds.x / this.frameWidth,
        y: this.bounds.y / this.frameHeight,
        width: this.bounds.width / this.frameWidth,
        height: this.bounds.height / this.frameHeight
      };
      this.bounds = normalizeBox(normalized, width, height);
      this.frameWidth = width;
      this.frameHeight = height;
    }

    const previous = this.bounds;
    const local = this.lostFrames < 2;
    const radiusX = local ? Math.max(24, previous.width * 0.85) : width;
    const radiusY = local ? Math.max(20, previous.height * 0.95) : height;
    const scales = this.lostFrames < 2 ? [0.92, 1, 1.08] : [0.88, 1, 1.12];
    const centerX = previous.x + previous.width / 2;
    const centerY = previous.y + previous.height / 2;
    let best = null;

    for (const scale of scales) {
      const candidateWidth = clamp(previous.width * scale, 6, width);
      const candidateHeight = clamp(previous.height * scale, 6, height);
      const minX = local ? Math.max(0, centerX - radiusX - candidateWidth / 2) : 0;
      const maxX = local ? Math.min(width - candidateWidth, centerX + radiusX - candidateWidth / 2) : width - candidateWidth;
      const minY = local ? Math.max(0, centerY - radiusY - candidateHeight / 2) : 0;
      const maxY = local ? Math.min(height - candidateHeight, centerY + radiusY - candidateHeight / 2) : height - candidateHeight;
      const step = local ? this.searchStep : Math.max(6, this.searchStep + 2);
      for (let y = minY; y <= maxY; y += step) {
        for (let x = minX; x <= maxX; x += step) {
          const candidateBounds = { x, y, width: candidateWidth, height: candidateHeight };
          const candidate = samplePatch(imageData, candidateBounds, this.grid);
          const score = comparePatches(this.template, candidate);
          if (!best || score < best.score) best = { score, bounds: candidateBounds, patch: candidate };
        }
      }
    }

    if (!best || best.score > this.threshold) {
      this.lostFrames++;
      this.confidence = best ? 1 - best.score : 0;
      return { bounds: { ...this.bounds }, center: centerOf(this.bounds), confidence: this.confidence, visible: false, lostFrames: this.lostFrames };
    }

    this.lostFrames = 0;
    this.confidence = 1 - best.score;
    const blend = this.confidence > 0.78 ? 0.72 : 0.42;
    this.bounds = {
      x: previous.x + (best.bounds.x - previous.x) * blend,
      y: previous.y + (best.bounds.y - previous.y) * blend,
      width: previous.width + (best.bounds.width - previous.width) * blend,
      height: previous.height + (best.bounds.height - previous.height) * blend
    };

    // Slowly adapt to pose and lighting changes only when the match is strong.
    if (this.confidence > 0.76 && this.adaptation > 0) {
      for (let index = 0; index < this.template.values.length; index++) {
        for (let channel = 0; channel < 3; channel++) {
          this.template.values[index][channel] += (best.patch.values[index][channel] - this.template.values[index][channel]) * this.adaptation;
        }
      }
      for (let channel = 0; channel < 3; channel++) {
        this.template.mean[channel] += (best.patch.mean[channel] - this.template.mean[channel]) * this.adaptation;
      }
    }

    return { bounds: { ...this.bounds }, center: centerOf(this.bounds), confidence: this.confidence, visible: true, lostFrames: 0 };
  }
}

function centerOf(bounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
