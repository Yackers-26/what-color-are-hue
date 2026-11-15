export function classifyColor(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const difference = max - min;

  let name = "Unknown";

  if (max < 45) {
    name = "Black";
  } else if (difference < 35) {
    name = max > 210 ? "White" : "Gray";
  } else {
    let hue;

    if (max === r) {
      hue = ((g - b) / difference) % 6;
    } else if (max === g) {
      hue = (b - r) / difference + 2;
    } else {
      hue = (r - g) / difference + 4;
    }

    hue = (hue * 60 + 360) % 360;

    if (hue < 18 || hue >= 345) name = "Red";
    else if (hue < 45) name = "Orange";
    else if (hue < 75) name = "Yellow";
    else if (hue < 170) name = "Green";
    else if (hue < 200) name = "Cyan";
    else if (hue < 265) name = "Blue";
    else name = "Purple";
  }

  const hex = "#" + [r, g, b]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return {
    name,
    hex,
    rgb: { r, g, b }
  };
}

const SAMPLE_STEP = 4;
const MIN_REGION_SAMPLES = 7;
const COLOR_NAMES = ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Black", "Gray"];
const COLOR_IDS = new Map(COLOR_NAMES.map((name, index) => [name, index]));

/**
 * Keeps a sampled label until a replacement has appeared for consecutive
 * frames. This is intentionally small (two frames by default): enough to
 * reject webcam noise without making real movement feel delayed.
 */
export class TemporalMaskStabilizer {
  constructor({ holdFrames = 2 } = {}) {
    this.holdFrames = Math.max(1, Math.floor(holdFrames));
    this.reset();
  }

  reset() {
    this.columns = 0;
    this.rows = 0;
    this.stableValues = null;
    this.candidateValues = null;
    this.candidateCounts = null;
    this.regionTracks = [];
    this.nextRegionId = 1;
    this.regionWidth = 0;
    this.regionHeight = 0;
  }

  stabilize(values, columns, rows) {
    if (!values || !values.length) return values;

    const needsReset = !this.stableValues ||
      this.columns !== columns ||
      this.rows !== rows ||
      this.stableValues.length !== values.length ||
      this.stableValues.constructor !== values.constructor;

    if (needsReset) {
      this.columns = columns;
      this.rows = rows;
      this.stableValues = new values.constructor(values);
      this.candidateValues = new Int32Array(values.length);
      this.candidateValues.fill(-32768);
      this.candidateCounts = new Uint8Array(values.length);
      this.regionTracks = [];
      this.nextRegionId = 1;
      return this.stableValues;
    }

    for (let index = 0; index < values.length; index += 1) {
      const nextValue = values[index];
      const stableValue = this.stableValues[index];

      if (nextValue === stableValue) {
        this.candidateValues[index] = -32768;
        this.candidateCounts[index] = 0;
        continue;
      }

      if (this.candidateValues[index] === nextValue) {
        this.candidateCounts[index] = Math.min(255, this.candidateCounts[index] + 1);
      } else {
        this.candidateValues[index] = nextValue;
        this.candidateCounts[index] = 1;
      }

      if (this.candidateCounts[index] >= this.holdFrames) {
        this.stableValues[index] = nextValue;
        this.candidateValues[index] = -32768;
        this.candidateCounts[index] = 0;
      }
    }

    return this.stableValues;
  }

  smoothRegions(colors, width, height) {
    if (this.regionWidth !== width || this.regionHeight !== height) {
      this.regionTracks = [];
      this.nextRegionId = 1;
      this.regionWidth = width;
      this.regionHeight = height;
    }

    const matched = new Set();
    const nextTracks = [];
    const maxDistance = Math.hypot(width, height) * 0.2;
    const blend = 0.38;

    for (const color of colors) {
      for (const region of color.regions || []) {
        const center = region.center || {
          x: region.bounds.x + region.bounds.width / 2,
          y: region.bounds.y + region.bounds.height / 2
        };
        let bestTrack = null;
        let bestScore = Infinity;

        for (const track of this.regionTracks) {
          if (track.colorName !== color.name || matched.has(track.id)) continue;
          const distance = Math.hypot(center.x - track.center.x, center.y - track.center.y);
          const overlap = getBoundsIoU(region.bounds, track.bounds);
          if (distance > maxDistance && overlap < 0.04) continue;
          const score = distance / maxDistance - overlap * 0.8 + track.missed * 0.12;
          if (score < bestScore) {
            bestScore = score;
            bestTrack = track;
          }
        }

        if (bestTrack) {
          matched.add(bestTrack.id);
          region.id = bestTrack.id;
          region.bounds = blendBounds(bestTrack.bounds, region.bounds, blend);
          region.center = {
            x: bestTrack.center.x + (center.x - bestTrack.center.x) * blend,
            y: bestTrack.center.y + (center.y - bestTrack.center.y) * blend
          };
          region.outline = blendOutline(bestTrack.outline, region.outline || [], blend);
        } else {
          region.id = `region-${this.nextRegionId++}`;
        }

        nextTracks.push({
          id: region.id,
          colorName: color.name,
          center: { ...region.center },
          bounds: { ...region.bounds },
          outline: (region.outline || []).map((segment) => segment.slice()),
          missed: 0
        });
      }

      if (color.regions?.length) {
        const left = Math.min(...color.regions.map((region) => region.bounds.x));
        const top = Math.min(...color.regions.map((region) => region.bounds.y));
        const right = Math.max(...color.regions.map((region) => region.bounds.x + region.bounds.width));
        const bottom = Math.max(...color.regions.map((region) => region.bounds.y + region.bounds.height));
        color.bounds = { x: left, y: top, width: right - left, height: bottom - top };
      }
    }

    for (const track of this.regionTracks) {
      if (matched.has(track.id) || nextTracks.some((next) => next.id === track.id)) continue;
      if (track.missed < 1) nextTracks.push({ ...track, missed: track.missed + 1 });
    }

    this.regionTracks = nextTracks;
    return colors;
  }
}

function getBoundsIoU(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function blendBounds(previous, current, amount) {
  return {
    x: previous.x + (current.x - previous.x) * amount,
    y: previous.y + (current.y - previous.y) * amount,
    width: previous.width + (current.width - previous.width) * amount,
    height: previous.height + (current.height - previous.height) * amount
  };
}

function blendOutline(previous, current, amount) {
  if (!previous?.length || !current.length) return current;
  const used = new Set();
  return current.map((segment, index) => {
    let match = null;
    let matchIndex = -1;
    let bestDistance = Infinity;
    const isHorizontal = segment[1] === segment[3];

    if (previous.length === current.length && previous[index]) {
      const candidate = previous[index];
      if ((candidate[1] === candidate[3]) === isHorizontal) {
        match = candidate;
        matchIndex = index;
      }
    }

    if (!match) {
      const midX = (segment[0] + segment[2]) / 2;
      const midY = (segment[1] + segment[3]) / 2;
      for (let candidateIndex = 0; candidateIndex < previous.length; candidateIndex += 1) {
        if (used.has(candidateIndex)) continue;
        const candidate = previous[candidateIndex];
        if ((candidate[1] === candidate[3]) !== isHorizontal) continue;
        const candidateMidX = (candidate[0] + candidate[2]) / 2;
        const candidateMidY = (candidate[1] + candidate[3]) / 2;
        const distance = Math.hypot(midX - candidateMidX, midY - candidateMidY);
        if (distance < bestDistance && distance <= 14) {
          bestDistance = distance;
          match = candidate;
          matchIndex = candidateIndex;
        }
      }
    }

    if (!match) return segment;
    used.add(matchIndex);
    return segment.map((value, coordinate) => match[coordinate] + (value - match[coordinate]) * amount);
  });
}

function averageCell(data, width, height, x, y, step) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let sampleY = y; sampleY < Math.min(height, y + step); sampleY += 1) {
    for (let sampleX = x; sampleX < Math.min(width, x + step); sampleX += 1) {
      const index = (sampleY * width + sampleX) * 4;
      if (data[index + 3] < 128) continue;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      count += 1;
    }
  }

  if (!count) return null;
  return [Math.round(red / count), Math.round(green / count), Math.round(blue / count)];
}

function removeIsolatedLabelNoise(labels, columns, rows) {
  const filtered = new Int16Array(labels);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const index = y * columns + x;
      const current = labels[index];
      const counts = new Map();

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (neighborX < 0 || neighborY < 0 || neighborX >= columns || neighborY >= rows) continue;
          const value = labels[neighborY * columns + neighborX];
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      }

      let dominant = current;
      let dominantCount = counts.get(current) || 0;
      for (const [value, count] of counts) {
        if (count > dominantCount) {
          dominant = value;
          dominantCount = count;
        }
      }

      // Only replace isolated cells; keep genuine narrow edges and details.
      if (dominant !== current && dominantCount >= 7 && (counts.get(current) || 0) <= 1) {
        filtered[index] = dominant;
      }
    }
  }

  return filtered;
}

function mergeIntervals(intervals) {
  if (!intervals?.length) return [];
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0].slice()];

  for (let index = 1; index < sorted.length; index += 1) {
    const interval = sorted[index];
    const last = merged[merged.length - 1];
    if (interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push(interval.slice());
  }

  return merged;
}

function getRegionOutline(cells, labels, colorId, columns, rows, step, width, height) {
  const horizontal = new Map();
  const vertical = new Map();
  const hasColor = (x, y) =>
    x >= 0 && y >= 0 && x < columns && y < rows && labels[y * columns + x] === colorId;
  const addInterval = (map, key, start, end) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push([start, end]);
  };

  for (const cell of cells) {
    const gx = cell % columns;
    const gy = Math.floor(cell / columns);
    const left = gx * step;
    const top = gy * step;
    const right = Math.min(width, left + step);
    const bottom = Math.min(height, top + step);

    if (!hasColor(gx, gy - 1)) addInterval(horizontal, top, left, right);
    if (!hasColor(gx + 1, gy)) addInterval(vertical, right, top, bottom);
    if (!hasColor(gx, gy + 1)) addInterval(horizontal, bottom, left, right);
    if (!hasColor(gx - 1, gy)) addInterval(vertical, left, top, bottom);
  }

  const segments = [];
  for (const [y, intervals] of horizontal) {
    for (const [left, right] of mergeIntervals(intervals)) segments.push([left, y, right, y]);
  }
  for (const [x, intervals] of vertical) {
    for (const [top, bottom] of mergeIntervals(intervals)) segments.push([x, top, x, bottom]);
  }
  return segments.sort((a, b) => {
    const aHorizontal = a[1] === a[3];
    const bHorizontal = b[1] === b[3];
    if (aHorizontal !== bHorizontal) return aHorizontal ? -1 : 1;
    return aHorizontal ? (a[1] - b[1] || a[0] - b[0]) : (a[0] - b[0] || a[1] - b[1]);
  });
}

function findColorRegions(labels, colorId, columns, rows, step, width, height, sampledRgb) {
  const visited = new Uint8Array(labels.length);
  const regions = [];

  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] !== colorId || visited[start]) continue;

    const queue = [start];
    const cells = [];
    visited[start] = 1;
    let cursor = 0;
    let minX = columns, minY = rows, maxX = -1, maxY = -1;
    let red = 0, green = 0, blue = 0;

    while (cursor < queue.length) {
      const index = queue[cursor++];
      cells.push(index);
      const x = index % columns;
      const y = Math.floor(index / columns);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const sampleIndex = index * 3;
      red += sampledRgb[sampleIndex];
      green += sampledRgb[sampleIndex + 1];
      blue += sampledRgb[sampleIndex + 2];

      const neighbors = [
        y > 0 ? index - columns : -1,
        x < columns - 1 ? index + 1 : -1,
        y < rows - 1 ? index + columns : -1,
        x > 0 ? index - 1 : -1
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor] || labels[neighbor] !== colorId) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    if (cells.length < MIN_REGION_SAMPLES) continue;

    const x = minX * step;
    const y = minY * step;
    const right = Math.min(width, (maxX + 1) * step);
    const bottom = Math.min(height, (maxY + 1) * step);
    const average = [red, green, blue].map((value) => Math.round(value / cells.length));
    const center = { x: (x + right) / 2, y: (y + bottom) / 2 };
    const hex = "#" + average.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    const bucketX = Math.max(step * 4, Math.round(width / 8));
    const bucketY = Math.max(step * 4, Math.round(height / 6));

    regions.push({
      id: `${Math.round(center.x / bucketX)}-${Math.round(center.y / bucketY)}`,
      samples: cells.length,
      bounds: { x, y, width: right - x, height: bottom - y },
      center,
      rgb: { r: average[0], g: average[1], b: average[2] },
      hex,
      outline: getRegionOutline(cells, labels, colorId, columns, rows, step, width, height)
    });
  }

  return regions.sort((a, b) => b.samples - a.samples);
}

export function summarizeFrameColors(imageData, stabilizer = null) {
  const { data, width, height } = imageData;
  const columns = Math.ceil(width / SAMPLE_STEP);
  const rows = Math.ceil(height / SAMPLE_STEP);
  const rawLabels = new Int16Array(columns * rows);
  rawLabels.fill(-1);
  const sampledRgb = new Uint8Array(columns * rows * 3);
  for (let y = 0; y < height; y += SAMPLE_STEP) {
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const cellIndex = Math.floor(y / SAMPLE_STEP) * columns + Math.floor(x / SAMPLE_STEP);
      const average = averageCell(data, width, height, x, y, SAMPLE_STEP);
      if (!average) continue;

      const [red, green, blue] = average;
      sampledRgb[cellIndex * 3] = red;
      sampledRgb[cellIndex * 3 + 1] = green;
      sampledRgb[cellIndex * 3 + 2] = blue;

      const result = classifyColor(red, green, blue);
      if (result.name === "White" || result.name === "Unknown") continue;

      rawLabels[cellIndex] = COLOR_IDS.get(result.name);
    }
  }

  const spatiallyFiltered = removeIsolatedLabelNoise(rawLabels, columns, rows);
  const labels = stabilizer
    ? stabilizer.stabilize(spatiallyFiltered, columns, rows)
    : spatiallyFiltered;
  const colors = new Map();
  for (const label of labels) {
    if (label < 0) continue;
    const name = COLOR_NAMES[label];
    if (!name) continue;
    const color = colors.get(name) || { id: label, name, samples: 0 };
    color.samples += 1;
    colors.set(name, color);
  }

  const summarized = Array.from(colors.values())
    .map((color) => {
      const regions = findColorRegions(labels, color.id, columns, rows, SAMPLE_STEP, width, height, sampledRgb);
      if (!regions.length) return null;

      const left = Math.min(...regions.map((region) => region.bounds.x));
      const top = Math.min(...regions.map((region) => region.bounds.y));
      const right = Math.max(...regions.map((region) => region.bounds.x + region.bounds.width));
      const bottom = Math.max(...regions.map((region) => region.bounds.y + region.bounds.height));
      const samples = regions.reduce((total, region) => total + region.samples, 0);

      return {
        name: color.name,
        samples,
        bounds: { x: left, y: top, width: right - left, height: bottom - top },
        regions
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.samples - a.samples);

  return stabilizer ? stabilizer.smoothRegions(summarized, width, height) : summarized;
}
