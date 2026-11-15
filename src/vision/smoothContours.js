import { matchesSavedShade } from "./colorPerception.js";
// HueFind: extract one ordered boundary per substantial color region.
// The mask is cleaned before tracing so isolated camera pixels do not become outlines.
import { classifyColor } from "./colorDetector.js";
import { applyNeutralGains } from "./cameraCalibration.js";

const STEP = 3;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function hueOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  if (!delta) return { hue: 0, saturation: 0, value: max };
  let hue = max === r ? ((g - b) / delta) % 6
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, saturation: delta / max, value: max };
}

export function matchesTargetColor(r, g, b, color, rgb = null) {
  if (!color) return false;
  const name = color.toLowerCase();
  if (rgb) {
    // Compare perceptual hue/chroma so a brightness change doesn't reject a saved shade.
    if (!matchesSavedShade({ r, g, b }, rgb)) return false;
    // A saved red shade can still be red after a lighting shift crosses
    // a rigid red/orange cutoff. The saved color's chroma provides the guard.
    if (!["black", "white", "gray"].includes(name) &&
        classifyColor(rgb.r, rgb.g, rgb.b).name.toLowerCase() === name) return true;
  }
  const basic = classifyColor(r, g, b).name.toLowerCase();
  if (name === "black") return basic === "black";
  if (name === "white" || name === "gray") return basic === name;
  const { hue, saturation, value } = hueOf(r, g, b);
  // Skin and warm shadows can look red at very low chroma. Require a
  // substantially red hue/saturation instead of matching every pink/orange patch.
  if (saturation < (name === "red" ? 0.52 : 0.22) || value < 45) return false;
  const bands = {
    red: [0, 14], orange: [15, 52], yellow: [43, 82], green: [72, 175],
    cyan: [168, 206], blue: [198, 268], purple: [261, 345]
  };
  if (!bands[name]) return basic === name;
  const [from, to] = bands[name];
  return name === "red" ? hue >= 342 || hue <= to : hue >= from && hue <= to;
}

function sampleMask(imageData, color, rgb, step, whiteBalance = null) {
  const { data, width, height } = imageData;
  const columns = Math.ceil(width / step), rows = Math.ceil(height / step);
  const mask = new Uint8Array(columns * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      let red = 0, green = 0, blue = 0, count = 0;
      for (let py = y * step; py < Math.min(height, (y + 1) * step); py++) {
        for (let px = x * step; px < Math.min(width, (x + 1) * step); px++) {
          const at = (py * width + px) * 4;
          if (data[at + 3] < 128) continue;
          red += data[at]; green += data[at + 1]; blue += data[at + 2]; count++;
        }
      }
      if (count) {
        const corrected = applyNeutralGains({r: red / count, g: green / count, b: blue / count}, whiteBalance);
        // Stored reference shades were captured through the camera. Check both
        // original and calibrated samples so calibration does not break old saves.
        if (matchesTargetColor(corrected.r, corrected.g, corrected.b, color, rgb) ||
            (rgb && whiteBalance && matchesTargetColor(red / count, green / count, blue / count, color, rgb))) {
          mask[y * columns + x] = 1;
        }
      }
    }
  }
  return { mask, columns, rows };
}

function morph(mask, columns, rows, radius, method) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      let yes = method === "erode";
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius + 0.5) continue;
          const nx = x + dx, ny = y + dy;
          const exists = nx >= 0 && ny >= 0 && nx < columns && ny < rows;
          const filled = exists && mask[ny * columns + nx] === 1;
          if (method === "dilate" && filled) { yes = true; break; }
          if (method === "erode" && !filled) { yes = false; break; }
        }
        if ((method === "dilate" && yes) || (method === "erode" && !yes)) break;
      }
      out[y * columns + x] = yes ? 1 : 0;
    }
  }
  return out;
}

export function cleanColorMask(mask, columns, rows, { closeRadius = 3 } = {}) {
  if (!mask?.length || columns < 1 || rows < 1) return new Uint8Array();
  // Closing joins small gaps, then opening drops tiny specks.
  const closed = morph(morph(mask, columns, rows, closeRadius, "dilate"), columns, rows, closeRadius, "erode");
  return morph(morph(closed, columns, rows, 1, "erode"), columns, rows, 1, "dilate");
}

function componentCells(mask, columns, rows) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start], cells = [];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor]; cells.push(index);
      const x = index % columns, y = Math.floor(index / columns);
      const neighbors = [x > 0 ? index - 1 : -1, x < columns - 1 ? index + 1 : -1,
        y > 0 ? index - columns : -1, y < rows - 1 ? index + columns : -1];
      for (const next of neighbors) {
        if (next >= 0 && mask[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    components.push(cells);
  }
  return components.sort((a, b) => b.length - a.length);
}

const key = (x, y) => `${x},${y}`;
function traceBoundary(cells, columns, rows) {
  const filled = new Set(cells);
  const edges = [];
  const add = (ax, ay, bx, by) => edges.push({ a: [ax, ay], b: [bx, by] });
  for (const index of cells) {
    const x = index % columns, y = Math.floor(index / columns);
    if (y === 0 || !filled.has(index - columns)) add(x, y, x + 1, y);
    if (x === columns - 1 || !filled.has(index + 1)) add(x + 1, y, x + 1, y + 1);
    if (y === rows - 1 || !filled.has(index + columns)) add(x + 1, y + 1, x, y + 1);
    if (x === 0 || !filled.has(index - 1)) add(x, y + 1, x, y);
  }
  const starts = new Map();
  edges.forEach((edge, index) => {
    const k = key(...edge.a);
    if (!starts.has(k)) starts.set(k, []);
    starts.get(k).push(index);
  });
  const visited = new Uint8Array(edges.length);
  const loops = [];
  for (let first = 0; first < edges.length; first++) {
    if (visited[first]) continue;
    const path = [];
    let index = first;
    const origin = key(...edges[index].a);
    while (index !== undefined && !visited[index] && path.length <= edges.length) {
      visited[index] = 1;
      const edge = edges[index];
      path.push(edge.a);
      const next = key(...edge.b);
      if (next === origin) break;
      index = (starts.get(next) || []).find((candidate) => !visited[candidate]);
    }
    if (path.length > 3) loops.push(path);
  }
  if (!loops.length) return [];
  const area = (path) => Math.abs(path.reduce((sum, p, i) => {
    const q = path[(i + 1) % path.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0));
  return loops.sort((a, b) => area(b) - area(a))[0];
}

function chaikin(points) {
  const smooth = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    smooth.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]);
    smooth.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
  }
  return smooth;
}

function resampleClosed(points, count = 72) {
  if (points.length < 3) return [];
  const lengths = points.map((point, index) => Math.hypot(
    points[(index + 1) % points.length][0] - point[0],
    points[(index + 1) % points.length][1] - point[1]
  ));
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (!perimeter) return [];
  const result = [];
  let edge = 0, cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = i * perimeter / count;
    while (edge < lengths.length - 1 && cursor + lengths[edge] < target) {
      cursor += lengths[edge++];
    }
    const t = clamp((target - cursor) / Math.max(1e-6, lengths[edge]), 0, 1);
    const a = points[edge], b = points[(edge + 1) % points.length];
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return result;
}

function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function findSmoothColorContours(imageData, {
  color, rgb = null, minAreaFraction = .011, relativeMinArea = .24, maxRegions = 3,
  step = STEP, whiteBalance = null
} = {}) {
  if (!imageData?.data || !imageData.width || !imageData.height || !color) return [];
  const { mask, columns, rows } = sampleMask(imageData, color, rgb, step, whiteBalance);
  const cleaned = cleanColorMask(mask, columns, rows);
  const minimum = Math.max(25, Math.round(columns * rows * minAreaFraction));
  const components = componentCells(cleaned, columns, rows);
  if (!components.length) return [];
  const largest = components[0].length;
  const results = [];
  for (const cells of components) {
    if (cells.length < minimum || cells.length < largest * relativeMinArea || results.length >= maxRegions) continue;
    const raw = traceBoundary(cells, columns, rows);
    if (raw.length < 4) continue;
    let polygon = raw.map(([x, y]) => [Math.min(x * step, imageData.width), Math.min(y * step, imageData.height)]);
    polygon = chaikin(chaikin(polygon));
    const points = resampleClosed(polygon);
    if (!points.length) continue;
    const bounds = boundsOf(points);
    results.push({
      samples: cells.length,
      bounds,
      center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      points
    });
  }
  return results;
}

function alignedPoints(previous, current) {
  if (previous.length !== current.length) return current;
  let best = current, bestScore = Infinity;
  for (let shift = 0; shift < current.length; shift++) {
    let score = 0;
    for (let i = 0; i < current.length; i += 3) {
      const a = previous[i], b = current[(i + shift) % current.length];
      score += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    }
    if (score < bestScore) {
      bestScore = score;
      best = current.map((_, i) => current[(i + shift) % current.length]);
    }
  }
  return best;
}

export class SmoothContourTracker {
  constructor({ blend = .46, confirmationFrames = 2, holdFrames = 2 } = {}) {
    this.blend = blend;
    this.confirmationFrames = confirmationFrames;
    this.holdFrames = holdFrames;
    this.reset();
  }
  reset() { this.tracks = []; this.nextId = 1; }
  update(regions, width, height) {
    const matched = new Set();
    const results = [];
    const maxTravel = Math.hypot(width, height) * .22;
    for (const region of regions) {
      let best = null, bestDistance = Infinity;
      for (const track of this.tracks) {
        if (matched.has(track.id)) continue;
        const distance = Math.hypot(track.center.x - region.center.x, track.center.y - region.center.y);
        const oldArea = Math.max(1, track.bounds.width * track.bounds.height);
        const newArea = Math.max(1, region.bounds.width * region.bounds.height);
        const ratio = newArea / oldArea;
        // Sudden huge area changes are usually mask noise, not object movement.
        if (ratio < 0.28 || ratio > 3.5) continue;
        const score = distance + 0.12 * Math.abs(Math.log(ratio)) * maxTravel;
        if (score < bestDistance && distance < maxTravel) { best = track; bestDistance = score; }
      }
      if (!best) {
        best = { ...region, id: `contour-${this.nextId++}`, seen: 0, missed: 0 };
        this.tracks.push(best);
      } else {
        const next = alignedPoints(best.points, region.points);
        const travel = Math.hypot(best.center.x - region.center.x, best.center.y - region.center.y);
        // Calm boundaries when the object is mostly stationary; catch up on real motion.
        const blend = travel < Math.hypot(width, height) * 0.012 ? Math.min(this.blend, .24) : this.blend;
        best.points = best.points.map((point, index) => [
          point[0] + (next[index][0] - point[0]) * blend,
          point[1] + (next[index][1] - point[1]) * blend
        ]);
        best.bounds = boundsOf(best.points);
        best.center = { x: best.bounds.x + best.bounds.width / 2, y: best.bounds.y + best.bounds.height / 2 };
        best.samples = region.samples;
      }
      best.seen += 1;
      best.missed = 0;
      matched.add(best.id);
      if (best.seen >= this.confirmationFrames) results.push({ ...best });
    }
    for (const track of this.tracks) {
      if (matched.has(track.id)) continue;
      track.missed += 1;
      if (track.missed <= this.holdFrames && track.seen >= this.confirmationFrames) results.push({ ...track });
    }
    this.tracks = this.tracks.filter((track) => track.missed <= this.holdFrames);
    return results.sort((a, b) => b.samples - a.samples);
  }
}

// Select one matching object rather than drawing multiple distant patches of color.
// Point and region centers are in analysis-frame pixel coordinates.
export function pickFocusedContour(regions, point, maxNormalizedDistance = .19, width = 320, height = 240) {
  if (!regions?.length || !point) return null;
  let best = null, bestScore = Infinity;
  const diagonal = Math.max(1, Math.hypot(width, height));
  for (const region of regions) {
    if (!region.bounds || !region.center) continue;
    const { x, y, width: w, height: h } = region.bounds;
    const inside = point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
    const distance = Math.hypot(region.center.x - point.x, region.center.y - point.y) / diagonal;
    const score = inside ? distance * 0.25 : distance + 0.15;
    if (score < bestScore) { best = region; bestScore = score; }
  }
  return best && bestScore <= maxNormalizedDistance ? best : null;
}
