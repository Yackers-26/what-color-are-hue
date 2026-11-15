// Optional white/gray-card calibration. Never rewrite the original video/HEX value.
// Neutral reference must occupy the center of the frame and be reasonably bright.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function calculateNeutralGains({ r, g, b }) {
  if (![r, g, b].every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 75 || (max - min) / Math.max(1, max) > 0.34) return null;
  const average = (r + g + b) / 3;
  return {
    r: clamp(average / Math.max(1, r), .74, 1.34),
    g: clamp(average / Math.max(1, g), .74, 1.34),
    b: clamp(average / Math.max(1, b), .74, 1.34)
  };
}

export function applyNeutralGains({ r, g, b }, gains) {
  if (!gains) return { r, g, b };
  return { r: clamp(r * gains.r, 0, 255),
    g: clamp(g * gains.g, 0, 255), b: clamp(b * gains.b, 0, 255) };
}

export function neutralReferenceFromCenter(imageData, radius = 12) {
  if (!imageData?.data || !imageData.width || !imageData.height) return null;
  const { width, height, data } = imageData;
  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  const startX = Math.max(0, cx - radius), endX = Math.min(width, cx + radius + 1);
  const startY = Math.max(0, cy - radius), endY = Math.min(height, cy + radius + 1);
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
  }
  return count ? { r: r / count, g: g / count, b: b / count } : null;
}
