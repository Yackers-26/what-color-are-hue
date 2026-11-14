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

function getRegionOutline(cells, labels, colorId, columns, rows, step, width, height) {
  const segments = [];
  const hasColor = (x, y) =>
    x >= 0 && y >= 0 && x < columns && y < rows && labels[y * columns + x] === colorId;

  for (const cell of cells) {
    const gx = cell % columns;
    const gy = Math.floor(cell / columns);
    const left = gx * step;
    const top = gy * step;
    const right = Math.min(width, left + step);
    const bottom = Math.min(height, top + step);

    if (!hasColor(gx, gy - 1)) segments.push([left, top, right, top]);
    if (!hasColor(gx + 1, gy)) segments.push([right, top, right, bottom]);
    if (!hasColor(gx, gy + 1)) segments.push([right, bottom, left, bottom]);
    if (!hasColor(gx - 1, gy)) segments.push([left, bottom, left, top]);
  }

  return segments;
}

function findColorRegions(labels, colorId, columns, rows, step, width, height, data) {
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
      const pixelIndex = (y * step * width + x * step) * 4;
      red += data[pixelIndex];
      green += data[pixelIndex + 1];
      blue += data[pixelIndex + 2];

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
    const hex = "#" + average.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    regions.push({
      samples: cells.length,
      bounds: { x, y, width: right - x, height: bottom - y },
      center: { x: (x + right) / 2, y: (y + bottom) / 2 },
      rgb: { r: average[0], g: average[1], b: average[2] },
      hex,
      outline: getRegionOutline(cells, labels, colorId, columns, rows, step, width, height)
    });
  }

  return regions.sort((a, b) => b.samples - a.samples);
}

export function summarizeFrameColors(imageData) {
  const { data, width, height } = imageData;
  const columns = Math.ceil(width / SAMPLE_STEP);
  const rows = Math.ceil(height / SAMPLE_STEP);
  const labels = new Int16Array(columns * rows);
  labels.fill(-1);
  const colors = new Map();

  for (let y = 0; y < height; y += SAMPLE_STEP) {
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 128) continue;

      const result = classifyColor(data[index], data[index + 1], data[index + 2]);
      if (result.name === "White" || result.name === "Gray" || result.name === "Unknown") continue;

      let color = colors.get(result.name);
      if (!color) {
        color = {
          id: colors.size,
          name: result.name,
          samples: 0,
          minX: x,
          minY: y,
          maxX: x,
          maxY: y
        };
        colors.set(result.name, color);
      }

      color.samples += 1;
      color.minX = Math.min(color.minX, x);
      color.minY = Math.min(color.minY, y);
      color.maxX = Math.max(color.maxX, x);
      color.maxY = Math.max(color.maxY, y);
      labels[Math.floor(y / SAMPLE_STEP) * columns + Math.floor(x / SAMPLE_STEP)] = color.id;
    }
  }

  return Array.from(colors.values())
    .filter(color => color.samples >= 5)
    .map(color => {
      const regions = findColorRegions(labels, color.id, columns, rows, SAMPLE_STEP, width, height, data);
      const x = color.minX;
      const y = color.minY;
      const right = Math.min(width, color.maxX + SAMPLE_STEP);
      const bottom = Math.min(height, color.maxY + SAMPLE_STEP);
      return {
        name: color.name,
        samples: color.samples,
        bounds: { x, y, width: right - x, height: bottom - y },
        regions
      };
    })
    .sort((a, b) => b.samples - a.samples);
}
