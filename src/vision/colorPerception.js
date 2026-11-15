// Camera colors depend on light and auto-white-balance. Compare a saved shade's
// perceptual hue/chroma before rejecting it because brightness has changed.
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const linear = v => { const n = clamp(v / 255); return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
const labF = t => t > 216 / 24389 ? Math.cbrt(t) : t * (24389 / 27 / 116) + 16 / 116;
export function rgbToLab({ r, g, b }) {
  const R = linear(r), G = linear(g), B = linear(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
export function labDifference(left, right) {
  const a = rgbToLab(left), b = rgbToLab(right);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}
function hueDifference(a, b) { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }
export function rgbHue({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 1) return { hue: 0, saturation: 0, brightness: max / 255 };
  const h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, saturation: d / Math.max(max, 1), brightness: max / 255 };
}
export function matchesSavedShade(sample, reference, { maxHueDifference = 25, maxChromaDifference = 30 } = {}) {
  if (!sample || !reference) return false;
  for (const rgb of [sample, reference]) {
    if (![rgb.r, rgb.g, rgb.b].every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return false;
  }
  const a = rgbHue(sample), b = rgbHue(reference);
  const first = rgbToLab(sample), second = rgbToLab(reference);
  const chromaA = Math.hypot(first.a, first.b), chromaB = Math.hypot(second.a, second.b);
  // Neutral shades have no meaningful hue: compare chroma and lightness instead.
  if (a.saturation < 0.14 || b.saturation < 0.14)
    return a.saturation < 0.18 && b.saturation < 0.18 && Math.abs(first.L - second.L) <= 35;
  return hueDifference(a.hue, b.hue) <= maxHueDifference &&
    Math.abs(chromaA - chromaB) <= maxChromaDifference &&
    Math.abs(first.L - second.L) <= 48;
}
